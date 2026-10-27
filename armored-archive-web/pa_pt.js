/* Progressive WebGPU path tracer for the 3D viewer (Inspect → Textured model).
   Static scene, no denoiser: samples accumulate while the camera is still and restart when anything changes.
   - Geometry: the game's exterior render model (from pa_gamemodel.js), 4-wide BVH built in pa_bvh_worker.js.
   - Materials: the same textures as the raster view (albedo, camo with its own UV set, normal map with
     smoothness/metal in R/B, AO) converted once into one RGBA8 texture array with mips.
   - Light: studio sky dome + sun disk (next-event estimation with MIS), studio floor; Russian roulette.
   - Work is split into one-sample dispatches per frame, sized from measured GPU time, so the browser's GPU
     watchdog never sees a long dispatch and the page stays responsive.
   Software BVH traversal: browsers expose no hardware ray tracing. */
(function(){
'use strict';
const PRESETS={preview:{label:'Preview',spp:128,bounces:2,rr:99,clamp:8},clean:{label:'Clean',spp:512,bounces:3,rr:99,clamp:16},
 high:{label:'High',spp:2048,bounces:4,rr:3,clamp:32},reference:{label:'Reference (unbiased)',spp:10240,bounces:8,rr:3,clamp:0},endless:{label:'Keep refining',spp:Infinity,bounces:8,rr:3,clamp:0}};
const store={get(k,d){try{const v=localStorage.getItem('pa:'+k);return v===null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem('pa:'+k,JSON.stringify(v));}catch{}}};
const BCFMT={bc1:'bc1-rgba-unorm',bc2:'bc2-rgba-unorm',bc3:'bc3-rgba-unorm',bc4:'bc4-r-unorm',bc5:'bc5-rg-unorm',bc6h:'bc6h-rgb-ufloat',bc7:'bc7-rgba-unorm'};
const BLOCK={bc1:8,bc4:8,bc2:16,bc3:16,bc5:16,bc6h:16,bc7:16};
let res=String(store.get('pt:res','view')),gpu=null,initErr=null,scene=null,building=null,enabled=false,wanted=store.get('pt:on',false),preset=store.get('pt:preset','clean'),scale=store.get('pt:scale',1);
let dbgMode=0,probe=null,dbgCanvas=null,dbgInfo='',onDebug=null,dbgPaths=null,dbgReading=false;
let tile=256,tileIdx=0,canvas=null,ctx=null,accum=null,prv=null,W=0,H=0,spp=0,lastKey='',stableSince=0,running=false,batch=1,sppTimes=[],status='',onStatus=null;

// ---------------------------------------------------------------- WGSL
const COMMON=/* wgsl */`
struct U{tgt:vec4f,right:vec4f,up:vec4f,fwd:vec4f,sun:vec4f,sunL:vec4f,studio:vec4f,dims:vec4u,params:vec4f,paint:vec4f,back:vec4f,dbg:vec4u};
@group(0) @binding(0) var<uniform> u:U;
fn heat(x:f32)->vec3f{let t=clamp(x,0.0,1.0);return clamp(vec3f(1.5-abs(4.0*t-3.0),1.5-abs(4.0*t-2.0),1.5-abs(4.0*t-1.0)),vec3f(0.0),vec3f(1.0));}`;
const TRACE=/* wgsl */`${COMMON}
@group(0) @binding(1) var<storage,read> nodes:array<vec4f>;
@group(0) @binding(2) var<storage,read> tg:array<vec4f>;
@group(0) @binding(3) var<storage,read> ti:array<vec4u>;
@group(0) @binding(4) var<storage,read> vx:array<vec4f>;
@group(0) @binding(5) var<storage,read> mats:array<vec4u>;
@group(0) @binding(6) var texs:texture_2d_array<f32>; // fallback group (RGBA8, decoded)
@group(0) @binding(10) var tx0:texture_2d_array<f32>;
@group(0) @binding(11) var tx1:texture_2d_array<f32>;
@group(0) @binding(12) var tx2:texture_2d_array<f32>;
@group(0) @binding(13) var tx3:texture_2d_array<f32>;
@group(0) @binding(14) var tx4:texture_2d_array<f32>;
@group(0) @binding(15) var tx5:texture_2d_array<f32>;
@group(0) @binding(16) var tx6:texture_2d_array<f32>;
@group(0) @binding(17) var tx7:texture_2d_array<f32>;
@group(0) @binding(18) var tx8:texture_2d_array<f32>;
@group(0) @binding(19) var tx9:texture_2d_array<f32>;
@group(0) @binding(20) var tx10:texture_2d_array<f32>;
@group(0) @binding(21) var tx11:texture_2d_array<f32>;
@group(0) @binding(7) var samp:sampler;
@group(0) @binding(8) var<storage,read_write> acc:array<vec4f>;
@group(0) @binding(9) var<storage,read_write> dbgb:array<vec4f>; // debug: 16 recorded paths × (count + 15 vertices)
const PI=3.14159265;const EMPTY=0xFFFFFFFFu;const NONE=0xFFFFu;
var<private> rs:u32;var<private> visits:u32;var<private> probe:bool;var<private> pslot:u32;var<private> pn:u32;
// debug vertex record for the probed pixel: xyz = point, w = kind (0 camera, 1 surface, 2 floor, 3 escaped, 4 sun visible, 5 sun blocked, 6 absorbed)
fn rec(p:vec3f,k:f32){if(probe&&pn<15u){dbgb[pslot+1u+pn]=vec4f(p,k);pn++;}}
fn pcg(v:u32)->u32{let s=v*747796405u+2891336453u;let w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
fn rnd()->f32{rs=pcg(rs);return f32(rs>>8u)/16777216.0;}
// low-discrepancy pairs for the first dimensions: R2 sequence with a per-pixel Cranley-Patterson rotation
fn ld(px:u32,dim:u32,s:u32)->vec2f{let h=vec2f(f32(pcg(px*9781u+dim*6271u)>>8u),f32(pcg(px*7919u+dim*1103u+17u)>>8u))/16777216.0;
 return fract(h+f32(s)*vec2f(0.7548776662,0.5698402910));}
fn lum(c:vec3f)->f32{return dot(c,vec3f(0.2126,0.7152,0.0722));}
struct Hit{t:f32,tri:u32,b:vec2f};
// tref = group<<12 | layer. Group 0 is the decoded RGBA8 fallback; groups 1..12 keep each texture at its native size and
// block format (BC1/3/4/5/7) with the game's own mips. lod arrives in "log2(texels per pixel) per unit texture width" and
// is scaled by each group's width here. BC5 normal maps (flag bit per group in back.w) move X into alpha like BC7 ones.
fn texL(tref:u32,uv:vec2f,lod:f32)->vec4f{let l=i32(tref&4095u);switch(tref>>12u){
 case 1u:{let d=f32(textureDimensions(tx0).x);let c=textureSampleLevel(tx0,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>0u)&1u)!=0u);}
 case 2u:{let d=f32(textureDimensions(tx1).x);let c=textureSampleLevel(tx1,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>1u)&1u)!=0u);}
 case 3u:{let d=f32(textureDimensions(tx2).x);let c=textureSampleLevel(tx2,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>2u)&1u)!=0u);}
 case 4u:{let d=f32(textureDimensions(tx3).x);let c=textureSampleLevel(tx3,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>3u)&1u)!=0u);}
 case 5u:{let d=f32(textureDimensions(tx4).x);let c=textureSampleLevel(tx4,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>4u)&1u)!=0u);}
 case 6u:{let d=f32(textureDimensions(tx5).x);let c=textureSampleLevel(tx5,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>5u)&1u)!=0u);}
 case 7u:{let d=f32(textureDimensions(tx6).x);let c=textureSampleLevel(tx6,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>6u)&1u)!=0u);}
 case 8u:{let d=f32(textureDimensions(tx7).x);let c=textureSampleLevel(tx7,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>7u)&1u)!=0u);}
 case 9u:{let d=f32(textureDimensions(tx8).x);let c=textureSampleLevel(tx8,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>8u)&1u)!=0u);}
 case 10u:{let d=f32(textureDimensions(tx9).x);let c=textureSampleLevel(tx9,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>9u)&1u)!=0u);}
 case 11u:{let d=f32(textureDimensions(tx10).x);let c=textureSampleLevel(tx10,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>10u)&1u)!=0u);}
 case 12u:{let d=f32(textureDimensions(tx11).x);let c=textureSampleLevel(tx11,samp,uv,l,lod+log2(d));return select(c,vec4f(0.0,c.y,0.0,c.x),((bitcast<u32>(u.back.w)>>11u)&1u)!=0u);}
 default:{let d=f32(textureDimensions(texs).x);return textureSampleLevel(texs,samp,uv,l,lod+log2(d));}}}
fn alphaPass(tri:u32,b:vec2f)->bool{let iv=ti[tri];let m=mats[iv.w*2u];if((mats[iv.w*2u+1u].x&2u)==0u||m.x==NONE){return true;}
 let w=vec3f(1.0-b.x-b.y,b.x,b.y);let uv=vx[iv.x*2u].w*w.x+vx[iv.y*2u].w*w.y+vx[iv.z*2u].w*w.z;let uvv=vx[iv.x*2u+1u].x*w.x+vx[iv.y*2u+1u].x*w.y+vx[iv.z*2u+1u].x*w.z;
 return texL(m.x,vec2f(uv,uvv),-30.0).a>=0.5;}
fn trace(o:vec3f,d:vec3f,tmax:f32,shadow:bool)->Hit{
 var h:Hit;h.t=tmax;h.tri=EMPTY;let inv=1.0/select(d,vec3f(1e-12),abs(d)<vec3f(1e-12));
 var stk:array<u32,64>;var sp=0u;var node=0u;
 loop{
  visits++;
  var cn:array<u32,4>;var ct:array<f32,4>;var nc=0u;
  for(var k=0u;k<4u;k++){let lo=nodes[node*8u+k*2u];let hi=nodes[node*8u+k*2u+1u];let cnt=bitcast<u32>(hi.w);if(cnt==EMPTY){continue;}
   let t0=(lo.xyz-o)*inv;let t1=(hi.xyz-o)*inv;let tn=max(max(min(t0.x,t1.x),min(t0.y,t1.y)),max(min(t0.z,t1.z),0.0));let tf=min(min(max(t0.x,t1.x),max(t0.y,t1.y)),max(t0.z,t1.z));
   if(tn>tf||tn>=h.t){continue;}
   let link=bitcast<u32>(lo.w);
   if(cnt==0u){var j=nc;loop{if(j==0u||ct[j-1u]>=tn){break;}cn[j]=cn[j-1u];ct[j]=ct[j-1u];j--;}cn[j]=link;ct[j]=tn;nc++;}
   else{for(var t=link;t<link+cnt;t++){let a=tg[t*3u];let e1=tg[t*3u+1u].xyz;let e2=tg[t*3u+2u].xyz;
     let p=cross(d,e2);let det=dot(e1,p);if(abs(det)<1e-12){continue;}let id=1.0/det;let s=o-a.xyz;let bu=dot(s,p)*id;if(bu<0.0||bu>1.0){continue;}
     let q=cross(s,e1);let bv=dot(d,q)*id;if(bv<0.0||bu+bv>1.0){continue;}let tt=dot(e2,q)*id;if(tt<=1e-4||tt>=h.t){continue;}
     if((bitcast<u32>(a.w)&2u)!=0u&&!alphaPass(t,vec2f(bu,bv))){continue;}
     h.t=tt;h.tri=t;h.b=vec2f(bu,bv);if(shadow){return h;}}}
  }
  // push far children first so the nearest is visited next
  for(var j=0u;j<nc;j++){if(sp<64u){stk[sp]=cn[j];sp++;}}
  if(sp==0u){break;}sp--;node=stk[sp];
 }
 return h;}
fn sky(d:vec3f)->vec3f{let top=vec3f(0.62,0.70,0.82);let hor=vec3f(0.86,0.88,0.90);let gnd=vec3f(0.36,0.36,0.35);
 let k=d.y*0.5+0.5;return mix(gnd,mix(hor,top,max(d.y,0.0)),smoothstep(0.0,1.0,k))*u.sunL.w;}
fn onb(n:vec3f)->mat3x3f{let s=select(-1.0,1.0,n.z>=0.0);let a=-1.0/(s+n.z);let b=n.x*n.y*a;return mat3x3f(vec3f(1.0+s*n.x*n.x*a,s*b,-s*n.x),vec3f(b,s+n.y*n.y*a,-n.y),n);}
fn D(nh:f32,a2:f32)->f32{let d=nh*nh*(a2-1.0)+1.0;return a2/(PI*d*d);}
fn G1(nx:f32,a2:f32)->f32{return 2.0*nx/(nx+sqrt(a2+(1.0-a2)*nx*nx));}
fn evalB(n:vec3f,v:vec3f,l:vec3f,base:vec3f,rough:f32,metal:f32,ps:f32,pdf:ptr<function,f32>)->vec3f{
 let nl=dot(n,l);let nv=max(dot(n,v),1e-4);if(nl<=0.0){*pdf=0.0;return vec3f(0.0);}
 let h=normalize(v+l);let nh=max(dot(n,h),0.0);let vh=max(dot(v,h),0.0);let a=max(rough*rough,1e-3);let a2=a*a;
 let F0=mix(vec3f(0.04),base,metal);let F=F0+(1.0-F0)*pow(1.0-vh,5.0);let dd=D(nh,a2);let g=G1(nl,a2)*G1(nv,a2);
 let spec=dd*g*F/(4.0*nl*nv);let diff=(1.0-F)*(1.0-metal)*base/PI;
 *pdf=ps*dd*G1(nv,a2)/(4.0*nv)+(1.0-ps)*nl/PI;return (diff+spec)*nl;}
fn sampleGGX(v:vec3f,a:f32,r:vec2f)->vec3f{ // visible-normal sampling (Heitz 2018), local frame z=n
 let vh=normalize(vec3f(a*v.x,a*v.y,v.z));let lensq=vh.x*vh.x+vh.y*vh.y;let t1=select(vec3f(1.0,0.0,0.0),vec3f(-vh.y,vh.x,0.0)/sqrt(lensq),lensq>0.0);let t2=cross(vh,t1);
 let rr=sqrt(r.x);let phi=2.0*PI*r.y;let p1=rr*cos(phi);var p2=rr*sin(phi);let s=0.5*(1.0+vh.z);p2=(1.0-s)*sqrt(1.0-p1*p1)+s*p2;
 let nh=p1*t1+p2*t2+sqrt(max(0.0,1.0-p1*p1-p2*p2))*vh;return normalize(vec3f(a*nh.x,a*nh.y,max(0.0,nh.z)));}
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let W=u.dims.x;let H=u.dims.y;let gx=gid.x+(u.dims.w&0xFFFFu);let gy=gid.y+(u.dims.w>>16u);if(gx>=W||gy>=H){return;}let px=gy*W+gx;let s=u.dims.z;rs=pcg(px*1973u+s*9277u+26699u);
 let j=ld(px,0u,s);let sx=(f32(gx)+j.x)/f32(W)*2.0-1.0;let sy=1.0-(f32(gy)+j.y)/f32(H)*2.0;
 var o=u.tgt.xyz+u.right.xyz*sx*u.tgt.w*u.right.w+u.up.xyz*sy*u.tgt.w-u.fwd.xyz*u.up.w;var d=u.fwd.xyz;
 probe=u.dbg.x==1u&&gx==u.dbg.y&&gy==u.dbg.z;pslot=(s%16u)*16u;pn=0u;rec(o,0.0);let dm=select(u.dbg.x,0u,u.dbg.x==5u);
 var thr=vec3f(1.0);var rad=vec3f(0.0);let maxB=u32(u.params.x);let rrS=u32(u.params.y);var lastPdf=0.0;var lastSpec=false;var primaryFade=0.0;
 let L=normalize(u.sun.xyz);let cosMax=u.sun.w;let sunPdf=1.0/(2.0*PI*(1.0-cosMax));let Lsun=u.sunL.xyz;var foot=u.fwd.w;
 for(var b=0u;b<=maxB;b++){
  if(b==0u){visits=0u;}
  let h=trace(o,d,1e30,false);
  if(dm==2u&&b==0u){rad=vec3f(f32(visits),select(0.0,1.0,h.tri!=EMPTY),0.0);break;} // raw node count + vehicle coverage; SHOW colours it
  // studio floor (infinite plane under the vehicle)
  var tf=1e30;if(d.y<-1e-5){tf=(u.studio.z-o.y)/d.y;if(tf<=1e-4){tf=1e30;}}
  if(h.tri==EMPTY&&tf>=1e30){ // escaped: sky, and the sun disk when a sampled direction hits it (MIS)
   if(b==0u){rad=select(u.back.xyz,vec3f(0.0),dm>=3u);rec(o+d*u.up.w*0.6,3.0);break;}
   rec(o+d*u.up.w*0.35,3.0);
   rad+=thr*sky(d);
   if(dot(d,L)>=cosMax){let w=select(lastPdf*lastPdf/(lastPdf*lastPdf+sunPdf*sunPdf),1.0,lastSpec&&lastPdf>1e6);rad+=thr*Lsun*w;}
   break;}
  var p:vec3f;var n:vec3f;var ng:vec3f;var base:vec3f;var rough=0.9;var metal=0.0;
  if(tf<h.t){p=o+d*tf;n=vec3f(0.0,1.0,0.0);ng=n;base=vec3f(0.50,0.51,0.52);rec(p,2.0);
   if(b==0u){let r=length(p.xz-vec2f(u.studio.x,u.studio.y))/u.studio.w;primaryFade=smoothstep(0.55,1.0,r);}}
  else{
   let iv=ti[h.tri];let a=tg[h.tri*3u];let e1=tg[h.tri*3u+1u];let e2=tg[h.tri*3u+2u];p=o+d*h.t;rec(p,1.0);
   let w=vec3f(1.0-h.b.x-h.b.y,h.b.x,h.b.y);let A0=vx[iv.x*2u];let A1=vx[iv.y*2u];let A2=vx[iv.z*2u];let B0=vx[iv.x*2u+1u];let B1=vx[iv.y*2u+1u];let B2=vx[iv.z*2u+1u];
   ng=normalize(cross(e1.xyz,e2.xyz));n=normalize(A0.xyz*w.x+A1.xyz*w.y+A2.xyz*w.z);if(dot(ng,d)>0.0){ng=-ng;}if(dot(n,ng)<0.0){n=-n;}
   let uv=vec2f(A0.w*w.x+A1.w*w.y+A2.w*w.z,B0.x*w.x+B1.x*w.y+B2.x*w.z);let uv2=vec2f(B0.y*w.x+B1.y*w.y+B2.y*w.z,B0.z*w.x+B1.z*w.y+B2.z*w.z);
   // ray-cone style texture level: pixel footprint grows with every bounce
   let lod=select(e1.w+log2(max(foot,1e-9)),-30.0,b==0u);
   let m0=mats[iv.w*2u];let mf=mats[iv.w*2u+1u].x;
   var alb=u.paint.xyz;var al=vec4f(0.45,0.45,0.42,0.0);if(m0.x!=NONE){al=texL(m0.x,uv,lod);}
   var paint=u.paint.xyz;if(m0.y!=NONE){paint=texL(m0.y,uv2,lod).xyz;}
   let lm=dot(al.xyz,vec3f(0.299,0.587,0.114));
   if(m0.x==NONE){alb=paint;}else if((mf&1u)!=0u){alb=mix(paint*clamp(0.42+lm*2.0,0.0,1.5),al.xyz*1.15,al.w*0.22);}else{alb=al.xyz;}
   if(m0.w!=NONE){alb*=mix(1.0,texL(m0.w,uv,lod).x,0.35);}
   base=pow(clamp(alb,vec3f(0.0),vec3f(1.0)),vec3f(2.2));rough=0.62;
   if(m0.z!=NONE){let t=texL(m0.z,uv,lod);var xy=vec2f(t.w,t.y)*2.0-1.0;xy.y*=u.paint.w;let tn=vec3f(xy,sqrt(max(0.0,1.0-dot(xy,xy))));
    let du1=vec2f(A1.w-A0.w,B1.x-B0.x);let du2=vec2f(A2.w-A0.w,B2.x-B0.x);let r=du1.x*du2.y-du2.x*du1.y;
    if(abs(r)>1e-12){let T=normalize((e1.xyz*du2.y-e2.xyz*du1.y)/r-n*dot(n,(e1.xyz*du2.y-e2.xyz*du1.y)/r));let Bt=cross(n,T)*select(-1.0,1.0,r>0.0);n=normalize(T*tn.x+Bt*tn.y+n*tn.z);if(dot(n,-d)<0.0){n=normalize(n-d*dot(n,d)*1.01);}}
    rough=clamp(1.0-t.x*0.85,0.12,1.0);metal=clamp(t.z*1.2,0.0,1.0);}
   if((mf&4u)!=0u){base=vec3f(0.02);rough=0.06;metal=0.0;}
  }
  if(b==0u&&dm==3u){rad=n*0.5+0.5;break;}if(b==0u&&dm==4u){rad=pow(clamp(base,vec3f(0.0),vec3f(1.0)),vec3f(1.0/2.2));break;}
  let v=-d;let nv=max(dot(n,v),1e-4);let F0=mix(vec3f(0.04),base,metal);let Fv=F0+(1.0-F0)*pow(1.0-nv,5.0);
  let ps=clamp(select(lum(Fv)*1.5,0.9,metal>0.5),0.1,0.9);
  // next-event estimation: sample the sun disk, shadow ray, MIS against the BSDF pdf
  { let r2=vec2f(rnd(),rnd());let ct=1.0-r2.x*(1.0-cosMax);let st=sqrt(max(0.0,1.0-ct*ct));let ph=2.0*PI*r2.y;let F=onb(L);let ls=normalize(F*vec3f(st*cos(ph),st*sin(ph),ct));
    if(dot(ls,ng)>0.0){var bp:f32;let f=evalB(n,v,ls,base,rough,metal,ps,&bp);if(bp>0.0){let sh=trace(p+ng*1e-3,ls,1e30,true);if(probe){if(sh.tri==EMPTY){rec(p+ls*u.up.w*0.25,4.0);}else{rec(p+ls*sh.t,5.0);}}if(sh.tri==EMPTY){
     let w=sunPdf*sunPdf/(sunPdf*sunPdf+bp*bp);var c=thr*f*Lsun*w/sunPdf;if(u.params.z>0.0&&b>0u){let lc=lum(c);if(lc>u.params.z){c*=u.params.z/lc;}}rad+=c;}}}}
  if(b==maxB){break;}
  // sample the BSDF for the next bounce
  let Fr=onb(n);let vl=transpose(Fr)*v;var lw:vec3f;let r3=select(vec2f(rnd(),rnd()),ld(px,1u+b,s),b<2u);
  if(rnd()<ps){let a=max(rough*rough,1e-3);let hl=sampleGGX(vl,a,r3);let ll=reflect(-vl,hl);lw=Fr*ll;lastSpec=rough<0.2;}
  else{let rr=sqrt(r3.x);let ph=2.0*PI*r3.y;lw=Fr*vec3f(rr*cos(ph),rr*sin(ph),sqrt(max(0.0,1.0-r3.x)));lastSpec=false;}
  if(dot(lw,ng)<=0.0){break;}
  var pdf:f32;let f=evalB(n,v,lw,base,rough,metal,ps,&pdf);if(pdf<=1e-8){break;}
  thr*=f/pdf;lastPdf=pdf;
  if(b>=rrS){let q=clamp(max(thr.x,max(thr.y,thr.z)),0.05,0.95);if(rnd()>q){rec(p,6.0);break;}thr/=q;}
  if(u.params.z>0.0){let lt=lum(thr);if(lt>u.params.z*4.0){thr*=u.params.z*4.0/lt;}}
  o=p+ng*1e-3;d=lw;foot=foot*1.6+rough*0.15;
 }
 if(dm<2u){rad=mix(rad,u.back.xyz,primaryFade);}
 if(probe){dbgb[pslot]=vec4f(f32(pn),f32(s),0.0,0.0);}
 if(s==0u){acc[px]=vec4f(rad,1.0);}else{acc[px]+=vec4f(rad,1.0);}
}`;
const SHOW=/* wgsl */`${COMMON}
@group(0) @binding(1) var<storage,read> acc:array<vec4f>;
@group(0) @binding(2) var<storage,read> prv:array<vec4f>; // accumulation before the latest sample (live view)
struct VO{@builtin(position) p:vec4f};
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32((i<<1u)&2u);let y=f32(i&2u);o.p=vec4f(x*2.0-1.0,1.0-y*2.0,0.0,1.0);return o;}
fn aces(x:vec3f)->vec3f{return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),vec3f(0.0),vec3f(1.0));}
@fragment fn fs(v:VO)->@location(0) vec4f{let i=u32(v.p.y)*u.dims.x+u32(v.p.x);let a=acc[i];var c=a.xyz/max(a.w,1.0);
 if(u.dbg.x==2u){return vec4f(heat(c.x/64.0)*select(0.6,1.0,c.y>0.5),1.0);}
 if(u.dbg.x==3u||u.dbg.x==4u){return vec4f(clamp(c,vec3f(0.0),vec3f(1.0)),1.0);}
 if(u.dbg.x==5u){let p=prv[i];let n=a.w-p.w;if(n>0.5){c=(a.xyz-p.xyz)/n;}}
 return vec4f(pow(aces(c*0.8),vec3f(1.0/2.2)),1.0);}`;
const BLIT=/* wgsl */`
@group(0) @binding(0) var src:texture_2d<f32>;@group(0) @binding(1) var sm:sampler;@group(0) @binding(2) var<uniform> p:vec4f;
struct VO{@builtin(position) pos:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32((i<<1u)&2u);let y=f32(i&2u);o.pos=vec4f(x*2.0-1.0,1.0-y*2.0,0.0,1.0);o.uv=vec2f(x,y);return o;}
@fragment fn fs(v:VO)->@location(0) vec4f{var c=textureSampleLevel(src,sm,v.uv,p.x);
 if(p.y>0.5){c=vec4f(0.0,c.y,0.0,c.x);} // two-channel normal map: move X into alpha so every normal reads (A,G)
 if(p.z>0.5){c=vec4f(c.x,c.x,c.x,1.0);}return c;}`;
const MIP=/* wgsl */`
@group(0) @binding(0) var src:texture_2d<f32>;@group(0) @binding(1) var sm:sampler;
struct VO{@builtin(position) pos:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32((i<<1u)&2u);let y=f32(i&2u);o.pos=vec4f(x*2.0-1.0,1.0-y*2.0,0.0,1.0);o.uv=vec2f(x,y);return o;}
@fragment fn fs(v:VO)->@location(0) vec4f{return textureSampleLevel(src,sm,v.uv,0.0);}`;


// ---------------------------------------------------------------- hardware gate
// Hard minimum: 12 GB of GPU memory (dedicated VRAM, or unified memory on Apple silicon), never on phones or tablets.
// A large model with native-resolution textures takes over 10 GB while tracing. WebGPU does not report memory, so the
// local server reads it from the OS (/api/gpu-memory, this computer only) and it is matched to the browser's adapter
// by vendor. Anything that cannot be confirmed stays locked.
const MIN_GPU_BYTES=11.5*2**30; // "12 GB" cards report 12 GiB; 11 GB cards stay below
const isMobile=()=>{const ua=navigator.userAgent||'';return !!(navigator.userAgentData?.mobile||/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1));};
let gateState={ok:false,checking:true,reason:'Checking GPU memory…'},gateAdapter=null;
const gb=b=>(b/2**30).toFixed(b>=10*2**30?0:1)+' GB';
const gateReady=(async()=>{const no=reason=>(gateState={ok:false,reason});
 try{
  if(isMobile())return no('Path tracing is not available on phones and tablets');
  if(!navigator.gpu)return no('Path tracing needs WebGPU (Chrome or Edge)');
  const ad=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!ad)return no('No WebGPU adapter');
  let info=ad.info;try{if(!info&&ad.requestAdapterInfo)info=await ad.requestAdapterInfo();}catch{}
  if(ad.isFallbackAdapter||info?.isFallbackAdapter)return no('Path tracing needs a hardware GPU');
  const r=await fetch('/api/gpu-memory',{cache:'no-store'}).then(x=>x.ok?x.json():null).catch(()=>null);
  const all=(r?.gpus||[]).filter(g=>g.bytes>0);
  if(!all.length)return no(r?.source==='remote-client'?'Path tracing is only available on the computer running the server':(r?'Could not confirm GPU memory; path tracing stays locked':'Could not confirm GPU memory (restart the server after updating); path tracing stays locked'));
  const v=String(info?.vendor||'').toLowerCase();const same=all.filter(g=>g.vendor&&v.includes(g.vendor));
  const cand=same.length?same:(v?[]:all);if(!cand.length)return no('Could not match the browser GPU to a known memory size; path tracing stays locked');
  const best=same.length?cand.reduce((a,b)=>b.bytes>a.bytes?b:a):cand.reduce((a,b)=>b.bytes<a.bytes?b:a);
  if(best.bytes<MIN_GPU_BYTES)return no(`Path tracing needs 12 GB of GPU memory; ${best.name} has ${gb(best.bytes)}`);
  gateAdapter=ad;gateState={ok:true,reason:'',gpu:best.name,bytes:best.bytes,unified:!!best.unified};
 }catch(e){no('Could not check the GPU: '+e.message);}
 finally{if(gateState.ok&&wanted){enabled=true;loop();}}
 return gateState;})();
// ---------------------------------------------------------------- device
async function initGPU(){if(gpu||initErr)return gpu;
 try{if(!(await gateReady).ok)throw Error(gateState.reason);
  const adapter=gateAdapter||await navigator.gpu.requestAdapter({powerPreference:'high-performance'});gateAdapter=null;if(!adapter)throw Error('no WebGPU adapter');
  const feats=[];if(adapter.features.has('texture-compression-bc'))feats.push('texture-compression-bc');if(adapter.features.has('timestamp-query'))feats.push('timestamp-query');
  const lim=adapter.limits;
  const device=await adapter.requestDevice({requiredFeatures:feats,requiredLimits:{maxStorageBufferBindingSize:lim.maxStorageBufferBindingSize,maxBufferSize:lim.maxBufferSize,maxTextureArrayLayers:lim.maxTextureArrayLayers,maxStorageBuffersPerShaderStage:Math.min(lim.maxStorageBuffersPerShaderStage,10)}});
  device.addEventListener('uncapturederror',e=>{console.error('WebGPU:',e.error?.message);setStatus('GPU error: '+(e.error?.message||'').slice(0,160));});
  device.lost.then(i=>{console.warn('WebGPU device lost',i.message);gpu=null;scene=null;setStatus('GPU device lost ('+i.message+'); turn path tracing off and on to restart');});
  let info=null;try{info=adapter.info||(adapter.requestAdapterInfo?await adapter.requestAdapterInfo():null);}catch{}
  const mk=(code,label)=>device.createShaderModule({code,label});
  gpu={device,adapter,bc:feats.includes('texture-compression-bc'),info,fmt:navigator.gpu.getPreferredCanvasFormat(),
   trace:device.createComputePipeline({layout:'auto',compute:{module:mk(TRACE,'pt-trace'),entryPoint:'main'}}),
   samp:device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'})};
  gpu.show=device.createRenderPipeline({layout:'auto',vertex:{module:mk(SHOW,'pt-show'),entryPoint:'vs'},fragment:{module:mk(SHOW,'pt-show'),entryPoint:'fs',targets:[{format:gpu.fmt}]},primitive:{topology:'triangle-list'}});
  gpu.blit=device.createRenderPipeline({layout:'auto',vertex:{module:mk(BLIT,'pt-blit'),entryPoint:'vs'},fragment:{module:mk(BLIT,'pt-blit'),entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
  gpu.mip=device.createRenderPipeline({layout:'auto',vertex:{module:mk(MIP,'pt-mip'),entryPoint:'vs'},fragment:{module:mk(MIP,'pt-mip'),entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
  gpu.ubuf=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  gpu.tiny=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE});
  gpu.dbgBuf=device.createBuffer({size:16*16*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  return gpu;}catch(e){initErr=e;console.warn('path tracer unavailable:',e);return null;}}

// ---------------------------------------------------------------- scene
function buildBVH(tris){return new Promise((res,rej)=>{const w=new Worker('pa_bvh_worker.js?v='+(window.PA_BUILD||''));w.onmessage=e=>{w.terminate();res(e.data);};w.onerror=e=>{w.terminate();rej(e);};w.postMessage({id:1,tris},[tris.buffer]);});}
async function fetchTex(name){const r=await fetch('/api/local/texture?name='+encodeURIComponent(name));if(!r.ok)return null;return window.PAGame.parseTexture(await r.arrayBuffer());}
async function buildScene(viewer){
 const g=gpu,dev=g.device,m=window.PAGame?.current?.main;if(!m)throw Error('game model not loaded');
 const skin=viewer.skin||new Map(),key=m.model+'|'+[...skin].join(',');if(scene&&scene.key===key)return scene;
 setStatus('preparing geometry…');
 // triangles per material group; per-triangle flags: 2 = alpha-tested
 const mats=m.materials,T=m.idx.length/3,tris=new Float32Array(T*9),triMat=new Uint32Array(T),triV=new Uint32Array(T*3);let t=0;
 for(const gr of m.groups)for(let k=gr.first;k<gr.first+gr.count;k+=3){for(let c=0;c<3;c++){const vi=m.idx[k+c];triV[t*3+c]=vi;tris[t*9+c*3]=m.pos[vi*3];tris[t*9+c*3+1]=m.pos[vi*3+1];tris[t*9+c*3+2]=m.pos[vi*3+2];}triMat[t]=gr.mat;t++;}
 const triCopy=tris.slice();const bvh=await buildBVH(triCopy);const order=new Uint32Array(bvh.order);
 // textures → one RGBA8 array (layers), each material refers to layers
 const layerOf=new Map(),list=[];const want=(n,kind)=>{if(!n)return 0xFFFF;const k=kind+':'+n;if(!layerOf.has(k)){layerOf.set(k,list.length);list.push({n,kind});}return layerOf.get(k);};
 const matRows=new Uint32Array(Math.max(1,mats.length)*8);
 mats.forEach((mt,i)=>{const masked=/masked/.test(mt.cls||''),atest=/atest/.test(mt.cls||''),glass=/glass/.test(mt.cls||'');
  matRows[i*8]=want(mt.t0,'c');matRows[i*8+1]=masked&&mt.t1?want(skin.get(mt.t1)||mt.t1,'c'):0xFFFF;matRows[i*8+2]=mt.t2&&/_n$/.test(mt.t2)?want(mt.t2,'n'):0xFFFF;matRows[i*8+3]=mt.t3&&/_ao$/.test(mt.t3)?want(mt.t3,'ao'):0xFFFF;
  matRows[i*8+4]=(masked?1:0)|(atest?2:0)|(glass?4:0);});
 // Native-resolution textures: every texture keeps its own size, block format and game mips. Textures sharing a
 // format and size share one array (group 1..12); anything left over (no BC support, or more than 12 distinct
 // shapes) is decoded into the RGBA8 fallback array (group 0) at the largest size among them, so nothing is shrunk.
 const loaded=[];let done=0;
 for(const [li,it] of list.entries()){setStatus(`loading textures ${++done}/${list.length}…`);let tex=null;try{tex=await fetchTex(it.n);}catch{}
  if(!tex||(!g.bc&&tex.fmt!=='rgba8'))continue;
  const mips=[];{let prev=null;for(const mp of tex.mips){if(prev&&(mp.w!==Math.max(1,prev.w>>1)||mp.h!==Math.max(1,prev.h>>1)))break;if(tex.fmt!=='rgba8'&&(mp.w<4||mp.h<4))break;mips.push(mp);prev=mp;}}
  if(!mips.length||(tex.fmt!=='rgba8'&&!BCFMT[tex.fmt]))continue;loaded.push({li,fmt:tex.fmt,mips,key:tex.fmt+'|'+mips[0].w+'x'+mips[0].h});}
 const byKey=new Map();for(const t of loaded){if(!byKey.has(t.key))byKey.set(t.key,[]);byKey.get(t.key).push(t);}
 const groups=[...byKey.values()].filter(l=>l[0].fmt!=='rgba8').sort((a,b)=>b.length*b[0].mips[0].w*b[0].mips[0].h-a.length*a[0].mips[0].w*a[0].mips[0].h);
 const native=groups.slice(0,12),rest=[...groups.slice(12).flat(),...loaded.filter(t=>t.fmt==='rgba8')];
 const refOf=new Map(),arrays=[];let bcFlags=0;
 native.forEach((grp,gi)=>{const t0=grp[0],nm=Math.min(...grp.map(t=>t.mips.length)),fmt=BCFMT[t0.fmt];
  const a=dev.createTexture({size:[t0.mips[0].w,t0.mips[0].h,grp.length],format:fmt,mipLevelCount:nm,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  grp.forEach((t,layer)=>{for(let lv=0;lv<nm;lv++){const mp=t.mips[lv],bw=Math.ceil(mp.w/4),bh=Math.ceil(mp.h/4);
   dev.queue.writeTexture({texture:a,mipLevel:lv,origin:[0,0,layer]},mp.data,{bytesPerRow:bw*BLOCK[t.fmt],rowsPerImage:bh},[bw*4,bh*4,1]);}
   refOf.set(t.li,((gi+1)<<12)|layer);});
  if(t0.fmt==='bc5')bcFlags|=1<<gi;arrays.push(a);});
 // fallback group 0: decode through the blit at the largest size among its members (never downscaled below native)
 const TS=rest.length?Math.min(4096,Math.max(...rest.map(t=>2**Math.ceil(Math.log2(Math.max(t.mips[0].w,t.mips[0].h)))))):4,levels=Math.log2(TS)+1;
 const arr=dev.createTexture({size:[TS,TS,Math.max(1,rest.length)],format:'rgba8unorm',mipLevelCount:levels,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST});
 rest.forEach((t,layer)=>{const isBC=t.fmt!=='rgba8',fmt=isBC?BCFMT[t.fmt]:'rgba8unorm',mips=t.mips;
  const src=dev.createTexture({size:[mips[0].w,mips[0].h],format:fmt,mipLevelCount:mips.length,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  mips.forEach((mp,lv)=>{const bw=isBC?Math.ceil(mp.w/4):mp.w,bh=isBC?Math.ceil(mp.h/4):mp.h,bpr=isBC?bw*BLOCK[t.fmt]:mp.w*4;dev.queue.writeTexture({texture:src,mipLevel:lv},mp.data,{bytesPerRow:bpr,rowsPerImage:bh},[isBC?bw*4:mp.w,isBC?bh*4:mp.h]);});
  const lod=Math.max(0,Math.min(mips.length-1,Math.log2(mips[0].w/TS)));const pu=dev.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  dev.queue.writeBuffer(pu,0,new Float32Array([lod,t.fmt==='bc5'?1:0,t.fmt==='bc4'?1:0,0]));
  const enc=dev.createCommandEncoder();const pass=enc.beginRenderPass({colorAttachments:[{view:arr.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1}),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});
  pass.setPipeline(g.blit);pass.setBindGroup(0,dev.createBindGroup({layout:g.blit.getBindGroupLayout(0),entries:[{binding:0,resource:src.createView()},{binding:1,resource:g.samp},{binding:2,resource:{buffer:pu}}]}));pass.draw(3);pass.end();
  for(let lv=1;lv<levels;lv++){const mp=enc.beginRenderPass({colorAttachments:[{view:arr.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:lv,mipLevelCount:1}),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});
   mp.setPipeline(g.mip);mp.setBindGroup(0,dev.createBindGroup({layout:g.mip.getBindGroupLayout(0),entries:[{binding:0,resource:arr.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:lv-1,mipLevelCount:1})},{binding:1,resource:g.samp}]}));mp.draw(3);mp.end();}
  dev.queue.submit([enc.finish()]);src.destroy?.();refOf.set(t.li,layer);});
 if(!g.dummy)g.dummy=dev.createTexture({size:[4,4,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
 const ok=new Set(refOf.keys());
 for(let i=0;i<mats.length;i++)for(let k=0;k<4;k++){const r=matRows[i*8+k];if(r!==0xFFFF)matRows[i*8+k]=refOf.has(r)?refOf.get(r):0xFFFF;}
 // missing textures fall back to the paint colour
 // triangle buffers in BVH order: geometry (v0,e1,e2 + flags / texture-level bias) and vertex indices
 const tg=new Float32Array(T*12),tgu=new Uint32Array(tg.buffer),ti=new Uint32Array(T*4);
 for(let j=0;j<T;j++){const s=order[j],o=j*12;const ax=tris[s*9],ay=tris[s*9+1],az=tris[s*9+2];const e1=[tris[s*9+3]-ax,tris[s*9+4]-ay,tris[s*9+5]-az],e2=[tris[s*9+6]-ax,tris[s*9+7]-ay,tris[s*9+8]-az];
  tg[o]=ax;tg[o+1]=ay;tg[o+2]=az;tgu[o+3]=(matRows[triMat[s]*8+4]&2)?2:0;tg[o+4]=e1[0];tg[o+5]=e1[1];tg[o+6]=e1[2];tg[o+8]=e2[0];tg[o+9]=e2[1];tg[o+10]=e2[2];
  const cx=e1[1]*e2[2]-e1[2]*e2[1],cy=e1[2]*e2[0]-e1[0]*e2[2],cz=e1[0]*e2[1]-e1[1]*e2[0],wa=Math.hypot(cx,cy,cz)*0.5;
  const i0=triV[s*3],i1=triV[s*3+1],i2=triV[s*3+2];const u0=[m.uv[i0*2],m.uv[i0*2+1]],u1=[m.uv[i1*2],m.uv[i1*2+1]],u2=[m.uv[i2*2],m.uv[i2*2+1]];
  const ua=Math.abs((u1[0]-u0[0])*(u2[1]-u0[1])-(u2[0]-u0[0])*(u1[1]-u0[1]))*0.5;tg[o+7]=0.5*Math.log2(Math.max(ua,1e-12)/Math.max(wa,1e-12));
  ti[j*4]=i0;ti[j*4+1]=i1;ti[j*4+2]=i2;ti[j*4+3]=triMat[s];}
 const nV=m.pos.length/3,vx=new Float32Array(nV*8);for(let i=0;i<nV;i++){vx[i*8]=m.nrm[i*3];vx[i*8+1]=m.nrm[i*3+1];vx[i*8+2]=m.nrm[i*3+2];vx[i*8+3]=m.uv[i*2];vx[i*8+4]=m.uv[i*2+1];const u2=m.uv2||m.uv;vx[i*8+5]=u2[i*2];vx[i*8+6]=u2[i*2+1];}
 const buf=(data)=>{const b=dev.createBuffer({size:Math.max(16,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});dev.queue.writeBuffer(b,0,data);return b;};
 if(scene)for(const b of scene.bufs)b.destroy();if(scene?.arr)scene.arr.destroy();for(const a of scene?.arrays||[])a.destroy();
 const s={key,nodes:buf(new Float32Array(bvh.nodes)),tg:buf(tg),ti:buf(ti),vx:buf(vx),mats:buf(matRows),arr,arrays,bcFlags,TS,stats:{...bvh.stats,textures:ok.size,layers:list.length,nativeGroups:arrays.length,fallback:rest.length}};
 s.bufs=[s.nodes,s.tg,s.ti,s.vx,s.mats];scene=s;return s;}

// ---------------------------------------------------------------- frame loop
function ensureCanvas(viewer){const vp=viewer.c.parentElement;if(!canvas){canvas=document.createElement('canvas');canvas.id='paPT';canvas.className='paPT';canvas.style.visibility='hidden';vp.insertBefore(canvas,viewer.ov);ctx=canvas.getContext('webgpu');requestAnimationFrame(ensureDbgCanvas);ctx.configure({device:gpu.device,format:gpu.fmt,alphaMode:'opaque'});}
 const dpr=Math.min(2,window.devicePixelRatio||1)*scale;let w=Math.max(16,Math.round(viewer.w*dpr)),h=Math.max(16,Math.round(viewer.h*dpr));
 if(res!=='view'){h=+res;w=Math.round(h*16/9);}
 canvas.style.objectFit=res==='view'?'fill':'cover'; // fixed frames keep the viewport's vertical framing; the saved PNG holds the full 16:9
 if(w!==W||h!==H||!accum){W=w;H=h;canvas.width=w;canvas.height=h;accum?.destroy();prv?.destroy();prv=null;accum=gpu.device.createBuffer({size:W*H*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});spp=0;}
 if(dbgMode===5&&!prv)prv=gpu.device.createBuffer({size:W*H*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 if(dbgMode!==5&&prv){prv.destroy();prv=null;}}
function sceneKey(v){return sceneKey0(v)+'|d'+dbgMode+(dbgMode===1&&probe?','+probe.join(','):'');}
function sceneKey0(v){const cam=res==='view'?v.stamp():[v.yaw.toFixed(4),v.pitch.toFixed(4),v.zoom.toFixed(4),v.target.map(x=>x.toFixed(3)).join(',')].join('|'); // fixed frames don't depend on the window size, so fullscreen keeps the samples
 return [cam,v.mode,v.plainModel,v.skin?[...v.skin].join():'',scale,res,preset,window.PAGame?.current?.main?.model].join('#');}
function active(v){return enabled&&v&&v.mode==='inspect'&&v.plainModel&&v.visualOn&&v.visual.main&&window.PAGame?.current?.main;}
function writeUniforms(v,sample,tx=0,ty=0){const {f,r,u}=v.basis(),st=v.studioInfo,P=PRESETS[preset];const a=new Float32Array(48),ui=new Uint32Array(a.buffer);
 a.set([v.target[0],v.target[1],v.target[2],v.zoom],0);a.set([r[0],r[1],r[2],W/H],4);a.set([u[0],u[1],u[2],v.radius*4+5],8);a.set([f[0],f[1],f[2],v.zoom*2/H],12);
 a.set([v.sun[0],v.sun[1],v.sun[2],Math.cos(0.6*Math.PI/180)],16);const sa=2*Math.PI*(1-Math.cos(0.6*Math.PI/180));a.set([3.1/sa,2.95/sa,2.75/sa,0.55],20);
 a.set([st.c[0],st.c[2],st.fy,st.FR],24);ui[28]=W;ui[29]=H;ui[30]=sample;ui[31]=(tx&0xFFFF)|((ty&0xFFFF)<<16);a.set([P.bounces,P.rr,P.clamp,1],32);a.set([...(v.paint||[.56,.53,.40]),v.nrmFlipY],36);a.set([0.50,0.51,0.53,0],40);ui[43]=scene.bcFlags>>>0;ui[44]=dbgMode;ui[45]=probe?probe[0]:0xFFFFFFFF;ui[46]=probe?probe[1]:0xFFFFFFFF;
 gpu.device.queue.writeBuffer(gpu.ubuf,0,a);}
let bindTrace=null,bindShow=null,bindFor=null;
function binds(){if(bindFor===scene&&bindTrace&&bindTrace._acc===accum&&bindShow._prv===prv)return;const d=gpu.device;
 bindTrace=d.createBindGroup({layout:gpu.trace.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:gpu.ubuf}},{binding:1,resource:{buffer:scene.nodes}},{binding:2,resource:{buffer:scene.tg}},{binding:3,resource:{buffer:scene.ti}},{binding:4,resource:{buffer:scene.vx}},{binding:5,resource:{buffer:scene.mats}},{binding:6,resource:scene.arr.createView({dimension:'2d-array'})},{binding:7,resource:gpu.samp},{binding:8,resource:{buffer:accum}},{binding:9,resource:{buffer:gpu.dbgBuf}},...Array.from({length:12},(_,i)=>({binding:10+i,resource:(scene.arrays[i]||gpu.dummy).createView({dimension:'2d-array'})}))]});
 bindTrace._acc=accum;bindShow=d.createBindGroup({layout:gpu.show.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:gpu.ubuf}},{binding:1,resource:{buffer:accum}},{binding:2,resource:{buffer:prv||gpu.tiny}}]});bindShow._prv=prv;bindFor=scene;}
async function step(v){
 const P0=PRESETS[preset],live=dbgMode===5,P={...P0,spp:live?Infinity:P0.spp};if(spp>=P.spp){setStatus(`${spp.toLocaleString()} samples · done in ${fmtTime(sppTimes.total||0)} · ${P.label}`);return false;}
 binds();const t0=performance.now(),tx=Math.ceil(W/tile),ty=Math.ceil(H/tile),per=tx*ty,before=spp;let n=0;
 if(live&&batch>per)batch=Math.floor(batch/per)*per; // end every step on a sample boundary
 for(let i=0;i<batch&&spp<P.spp;i++){const k=tileIdx,x=(k%tx)*tile,y=Math.floor(k/tx)*tile;writeUniforms(v,spp,x,y);
  const enc=gpu.device.createCommandEncoder();if(live&&prv&&tileIdx===0&&batch-i<=per)enc.copyBufferToBuffer(accum,0,prv,0,W*H*16);const pass=enc.beginComputePass();pass.setPipeline(gpu.trace);pass.setBindGroup(0,bindTrace);
  pass.dispatchWorkgroups(Math.ceil(Math.min(tile,W-x)/8),Math.ceil(Math.min(tile,H-y)/8));pass.end();gpu.device.queue.submit([enc.finish()]);n++;
  tileIdx++;if(tileIdx>=per){tileIdx=0;spp++;}}
 // present only whole samples so the image never shows a half-updated pass
 if(spp>before){writeUniforms(v,spp);const enc=gpu.device.createCommandEncoder();const pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});pass.setPipeline(gpu.show);pass.setBindGroup(0,bindShow);pass.draw(3);pass.end();gpu.device.queue.submit([enc.finish()]);canvas.style.visibility='visible';}
 await gpu.device.queue.onSubmittedWorkDone();const dt=performance.now()-t0;sppTimes.total=(sppTimes.total||0)+dt;
 // keep every dispatch short (watchdog) and each frame near 40 ms of GPU work (responsive page)
 const each=dt/Math.max(1,n);
 if(each>60&&tile>32){tile=Math.max(32,tile>>1);tileIdx=0;batch=1;if(spp===0)sppTimes={};}
 else if(each<6&&tile<2048&&tileIdx===0){tile=Math.min(2048,tile<<1);}
 batch=Math.max(1,Math.min(256,Math.round(40/Math.max(each,0.25))));if(window.__ptDebug)console.log('pt step',JSON.stringify({n,dt:Math.round(dt),each:Math.round(each),tile,batch,spp,tileIdx}));
 const done=spp+tileIdx/per,rate=done/Math.max(1e-3,sppTimes.total/1000),left=P.spp===Infinity?null:(P.spp-done)/rate;
 setStatus(`${live?'Live · ':''}${spp.toLocaleString()}${P.spp===Infinity?'':' / '+P.spp.toLocaleString()} samples · ${rate>=10?rate.toFixed(0):rate.toFixed(2)} spp/s · ${left==null?'refining':fmtTime(left*1000)+' left'} · ${W}×${H}`);return true;}
const fmtTime=ms=>{const s=Math.round(ms/1000);return s<60?s+' s':Math.floor(s/60)+' min '+String(s%60).padStart(2,'0')+' s';};
async function loop(){if(running)return;running=true;
 while(true){const v=window.PAUI?.viewer?.();if(!v||!active(v)){if(canvas){if(window.__ptDebug&&canvas.style.visibility!=='hidden')console.log('pt hide: inactive',v&&v.mode,v&&v.plainModel);canvas.style.visibility='hidden';}if(!enabled)break;await sleep(250);continue;}
  if(!gpu){await initGPU();if(!gpu){setStatus('Path tracing unavailable: '+(initErr?.message||'WebGPU missing'));enabled=false;break;}}
  try{if(!scene||scene.key!==(window.PAGame.current.main.model+'|'+[...(v.skin||new Map())].join(','))){canvas&&(canvas.style.visibility='hidden');building=buildScene(v);await building;building=null;}}
  catch(e){console.warn(e);setStatus('Path tracing failed: '+e.message);enabled=false;break;}
  ensureCanvas(v);const k=sceneKey(v);
  if(k!==lastKey){if(window.__ptDebug)console.log('pt reset',k);lastKey=k;stableSince=performance.now();spp=0;tileIdx=0;sppTimes={};batch=1;canvas.style.visibility='hidden';setStatus('waiting for the camera to settle…');}
  if(performance.now()-stableSince<180){await sleep(60);continue;}
  const more=await step(v);await (more?frame():sleep(200));}
 running=false;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),frame=()=>new Promise(r=>{let done=false;const go=()=>{if(!done){done=true;r();}};requestAnimationFrame(go);setTimeout(go,document.visibilityState==='hidden'?0:50);}); // keeps rendering in a background tab too
function setStatus(t){status=t;onStatus?.(t);}

// ---------------------------------------------------------------- debug view: the paths traced for one pixel
// Click a pixel with "Ray paths" on: the tracer records that pixel's next 16 sample paths (camera hit, every bounce,
// each sun shadow ray, escapes and Russian-roulette ends) into a small buffer, drawn here over the image.
const KIND={0:'camera',1:'surface',2:'floor',3:'escaped',4:'sun visible',5:'sun blocked',6:'absorbed'};
function imageBox(){const vp=canvas.parentElement.getBoundingClientRect(),cw=vp.width,ch=vp.height;
 if(res==='view')return {x0:0,y0:0,sx:cw/W,sy:ch/H,cw,ch,vp};const k=Math.max(cw/W,ch/H);return {x0:(cw-W*k)/2,y0:(ch-H*k)/2,sx:k,sy:k,cw,ch,vp};}
function toPixel(v,p){const {r,u}=v.basis(),t=v.target,a=W/H,d=[p[0]-t[0],p[1]-t[1],p[2]-t[2]];
 const sx=(d[0]*r[0]+d[1]*r[1]+d[2]*r[2])/(v.zoom*a),sy=(d[0]*u[0]+d[1]*u[1]+d[2]*u[2])/v.zoom;return [(sx+1)/2*W,(1-sy)/2*H];}
function ensureDbgCanvas(){if(dbgCanvas||!canvas)return;dbgCanvas=document.createElement('canvas');dbgCanvas.className='paPTDbg';canvas.after(dbgCanvas);
 const vp=canvas.parentElement;let down=null;
 vp.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];},true);
 vp.addEventListener('pointerup',e=>{if(dbgMode!==1||!down||!canvas||canvas.style.visibility==='hidden')return;const mv=Math.hypot(e.clientX-down[0],e.clientY-down[1]);down=null;if(mv>4)return;
  if(e.target.closest('.paFsDock,.paFsBar,button,select,input,label'))return;
  const b=imageBox(),x=Math.floor((e.clientX-b.vp.left-b.x0)/b.sx),y=Math.floor((e.clientY-b.vp.top-b.y0)/b.sy);if(x<0||y<0||x>=W||y>=H)return;
  probe=[x,y];dbgPaths=null;gpu.device.queue.writeBuffer(gpu.dbgBuf,0,new Float32Array(16*16*4));drawDbg();},true)
 vp.addEventListener('pointermove',e=>{if(dbgMode<2||dbgMode>4||!canvas)return;const b=imageBox(),x=Math.floor((e.clientX-b.vp.left-b.x0)/b.sx),y=Math.floor((e.clientY-b.vp.top-b.y0)/b.sy);hover=x>=0&&y>=0&&x<W&&y<H&&!e.target.closest('.paFsDock,.paFsBar')?[x,y]:null;drawDbg();},{passive:true});
 vp.addEventListener('pointerleave',()=>{hover=null;drawDbg();});}
async function readDbg(){if(dbgMode!==1||!probe||!gpu||dbgReading)return;dbgReading=true;
 try{const d=gpu.device,rb=d.createBuffer({size:16*16*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const enc=d.createCommandEncoder();enc.copyBufferToBuffer(gpu.dbgBuf,0,rb,0,16*16*16);d.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);const f=new Float32Array(rb.getMappedRange().slice(0));rb.unmap();rb.destroy();
  const paths=[];for(let k=0;k<16;k++){const o=k*64,n=Math.min(15,f[o]|0);if(!n)continue;const pts=[];for(let i=0;i<n;i++)pts.push({p:[f[o+4+i*4],f[o+5+i*4],f[o+6+i*4]],k:f[o+7+i*4]|0});paths.push({sample:f[o+1]|0,pts});}
  dbgPaths=paths;drawDbg();}catch(e){console.warn('ray debug read',e);}finally{dbgReading=false;}}
function setInfo(t){if(t!==dbgInfo){dbgInfo=t;onDebug?.(t);}}
const heatJS=x=>{const t=Math.min(1,Math.max(0,x)),c=k=>Math.min(1,Math.max(0,1.5-Math.abs(4*t-k)));return [c(3),c(2),c(1)];};
// ---------------------------------------------------------------- debug views: BVH cost, normals, albedo, live samples
// The accumulation buffer holds the raw per-pixel values in these modes (node count + vehicle coverage, normal*0.5+0.5,
// albedo), so one read-back gives the statistics and the value under the cursor.
let img=null,imgReading=false,imgAt=0,hover=null,stats='';
const isFloorN=(r,g,b)=>Math.abs(r-.5)<2e-3&&Math.abs(g-1)<2e-3&&Math.abs(b-.5)<2e-3;
const FA=[.50,.51,.52].map(x=>Math.pow(x,1/2.2)),isFloorA=(r,g,b)=>Math.abs(r-FA[0])<3e-3&&Math.abs(g-FA[1])<3e-3&&Math.abs(b-FA[2])<3e-3; // the studio floor's colour in this view
const isSky=(r,g,b)=>r+g+b<1e-5;
const hex=c=>'#'+c.map(x=>Math.round(Math.min(1,Math.max(0,x))*255).toString(16).padStart(2,'0')).join('');
const lin=x=>Math.pow(Math.min(1,Math.max(0,x)),2.2),refl=c=>.2126*lin(c[0])+.7152*lin(c[1])+.0722*lin(c[2]);
const pct=(h,total,q)=>{let a=0;for(let k=0;k<h.length;k++){a+=h[k];if(a>=total*q)return k;}return h.length-1;};
async function readImg(){if(imgReading||!gpu||!accum||!spp||dbgMode<2||dbgMode>4)return;const key=lastKey,want=PRESETS[preset].spp;
 if(img&&img.key===key&&(img.spp===spp||performance.now()-imgAt<800&&spp<want))return;imgReading=true;imgAt=performance.now();
 try{const d=gpu.device,n=W*H*16,rb=d.createBuffer({size:n,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const enc=d.createCommandEncoder();enc.copyBufferToBuffer(accum,0,rb,0,n);d.queue.submit([enc.finish()]);
  const at=spp,w=W,h=H;await rb.mapAsync(GPUMapMode.READ);const f=new Float32Array(rb.getMappedRange().slice(0));rb.unmap();rb.destroy();
  if(key!==lastKey)return;img={f,W:w,H:h,spp:at,key,mode:dbgMode};stats=computeStats();drawDbg();}catch(e){console.warn('debug read',e);}finally{imgReading=false;}}
function px(i){const f=img.f,n=Math.max(1,f[i*4+3]);return [f[i*4]/n,f[i*4+1]/n,f[i*4+2]/n];}
function computeStats(){const N=img.W*img.H,v=window.PAUI?.viewer?.(),fw=v?v.basis().f:[0,0,1];
 if(img.mode===2){const hist=new Uint32Array(1024);let all=0,veh=0,sum=0,max=0;
  for(let i=0;i<N;i++){const c=px(i);all+=c[0];if(c[1]>0.5){veh++;sum+=c[0];max=Math.max(max,c[0]);hist[Math.min(1023,Math.round(c[0]))]++;}}
  const st=scene?.stats||{};
  return `vehicle pixels average ${veh?Math.round(sum/veh):0} nodes per camera ray (median ${pct(hist,veh,.5)}, 95th percentile ${pct(hist,veh,.95)}, max ${Math.round(max)}) · whole frame ${Math.round(all/N)} · ${(st.tris||0).toLocaleString()} triangles in ${(st.wide||0).toLocaleString()} 4-wide nodes`;}
 if(img.mode===3){let veh=0,ob=0,steep=0,up=0;
  for(let i=0;i<N;i++){const c=px(i);if(isSky(...c)||isFloorN(...c))continue;let x=c[0]*2-1,y=c[1]*2-1,z=c[2]*2-1;const l=Math.hypot(x,y,z)||1;x/=l;y/=l;z/=l;
   const a=Math.acos(Math.min(1,Math.abs(x*fw[0]+y*fw[1]+z*fw[2])))*180/Math.PI;veh++;ob+=a;if(a>60)steep++;if(y>0.7)up++;}
  return `colour = surface direction (red +X, green +Y up, blue +Z; flat ground is light green) · vehicle surface averages ${veh?Math.round(ob/veh):0}° to the line of sight, ${veh?Math.round(steep/veh*100):0} % steeper than 60°, ${veh?Math.round(up/veh*100):0} % facing up`;}
 if(img.mode===4){let veh=0;const s3=[0,0,0],h=new Uint32Array(101);
  for(let i=0;i<N;i++){const c=px(i);if(isSky(...c)||isFloorA(...c))continue;veh++;s3[0]+=c[0];s3[1]+=c[1];s3[2]+=c[2];h[Math.round(refl(c)*100)]++;}
  const m=s3.map(x=>veh?x/veh:0);
  return `texture colour only, no light or shadow · vehicle average ${hex(m)} (${Math.round(refl(m)*100)} % reflectance; 5–95 % of pixels between ${pct(h,veh,.05)} and ${pct(h,veh,.95)} %)`;}
 return '';}
function hoverText(){if(!hover||!img||hover[0]>=img.W||hover[1]>=img.H)return '';const c=px(hover[1]*img.W+hover[0]);const v=window.PAUI?.viewer?.();
 if(img.mode===2)return `${Math.round(c[0])} nodes visited${c[1]>0.5?'':' (ground / sky)'}`;
 if(img.mode===3){if(isSky(...c))return 'sky';let x=c[0]*2-1,y=c[1]*2-1,z=c[2]*2-1;const l=Math.hypot(x,y,z)||1;x/=l;y/=l;z/=l;const fw=v?v.basis().f:[0,0,1];
  return `normal ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)} · ${Math.round(Math.acos(Math.min(1,Math.abs(y)))*180/Math.PI)}° from vertical · ${Math.round(Math.acos(Math.min(1,Math.abs(x*fw[0]+y*fw[1]+z*fw[2])))*180/Math.PI)}° to line of sight${isFloorN(...c)?' (ground)':''}`;}
 if(img.mode===4)return isSky(...c)?'sky':`${hex(c)} · ${Math.round(refl(c)*100)} % reflectance${isFloorA(...c)?' (ground)':''}`;
 return '';}
const LABEL={2:'BVH traversal cost',3:'Shading normals',4:'Albedo',5:'Live samples'};
function panel(g,b,lines,y){g.font='12px system-ui,sans-serif';g.textBaseline='middle';const w=Math.max(...lines.map(t=>g.measureText(t).width))+20,h=lines.length*17+10;
 g.fillStyle='rgba(14,17,23,.74)';g.fillRect(12,y-h,w,h);g.fillStyle='#eef2f7';lines.forEach((t,k)=>g.fillText(t,22,y-h+13+k*17));return h;}
function drawDbg(){if(!dbgCanvas)return;const v=window.PAUI?.viewer?.();const show=dbgMode>=1&&canvas&&canvas.style.visibility!=='hidden'&&v;
 const b=canvas?imageBox():null,dpr=window.devicePixelRatio||1;dbgCanvas.style.display=show?'block':'none';if(!show)return;
 dbgCanvas.width=Math.round(b.cw*dpr);dbgCanvas.height=Math.round(b.ch*dpr);const g=dbgCanvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,b.cw,b.ch);
 g.font='12px system-ui,sans-serif';g.textBaseline='middle';
 if(dbgMode===1)return drawPaths(g,b,v);
 if(dbgMode===5){panel(g,b,[`Live noisy samples · sample ${spp.toLocaleString()}`,'Each frame is one new sample per pixel, straight from the tracer.','Turn the debug view off to see the average of all of them.'],b.ch-12);setInfo(`Live samples: sample ${spp.toLocaleString()} · each frame shows one noisy sample per pixel`);return;}
 const ready=img&&img.key===lastKey;setInfo(LABEL[dbgMode]+': '+(ready&&stats?stats:'measuring…'));
 let y=b.ch-12;
 if(dbgMode===2){const bw=220,x0=22;g.fillStyle='rgba(14,17,23,.74)';g.fillRect(12,y-58,bw+20,58);const gr=g.createLinearGradient(x0,0,x0+bw,0);for(let k=0;k<=8;k++){const c=heatJS(k/8);gr.addColorStop(k/8,`rgb(${c.map(z=>Math.round(z*255)).join(',')})`);}
  g.fillStyle=gr;g.fillRect(x0,y-30,bw,10);g.fillStyle='#eef2f7';g.fillText('BVH nodes visited per camera ray',x0,y-44);[0,16,32,48,64].forEach((t,k)=>{const x=x0+bw*k/4;g.textAlign=k===0?'left':k===4?'right':'center';g.fillText(t===64?'64+':String(t),x,y-12);});g.textAlign='left';y-=66;
  panel(g,b,['Ground and sky are dimmed.'],y);}
 if(dbgMode===3)panel(g,b,['Colour = surface direction (after normal maps)','red +X · green +Y (up) · blue +Z','Hover for the angle at one pixel'],y);
 if(dbgMode===4)panel(g,b,['Texture colour only: no light, no shadow','Hover for the value at one pixel'],y);
 const t=hoverText();if(t&&hover){const hx=b.x0+(hover[0]+.5)*b.sx,hy=b.y0+(hover[1]+.5)*b.sy;g.strokeStyle='#fff';g.lineWidth=1.5;g.beginPath();g.arc(hx,hy,5,0,7);g.stroke();
  const w=g.measureText(t).width+16;let tx=hx+12,ty=hy-28;if(tx+w>b.cw-8)tx=hx-12-w;if(ty<8)ty=hy+12;g.fillStyle='rgba(14,17,23,.85)';g.fillRect(tx,ty,w,22);g.fillStyle='#eef2f7';g.fillText(t,tx+8,ty+11);}}
function drawPaths(g,b,v){
 const P=p=>{const q=toPixel(v,p);return [b.x0+q[0]*b.sx,b.y0+q[1]*b.sy];};
 const legend=[['#ffffff','camera hit'],['#ff9f3a','bounce'],['#7ec8ff','escaped to sky'],['#ffe14d','sun visible'],['#ff4d5e','sun blocked'],['#b18cff','absorbed (roulette)']];
 g.font='12px system-ui,sans-serif';g.textBaseline='middle';
 if(!probe){g.fillStyle='rgba(14,17,23,.72)';g.fillRect(12,b.ch-34,300,24);g.fillStyle='#eef2f7';g.fillText('Ray paths: click a pixel to trace it',20,b.ch-22);setInfo('Ray paths: click a pixel');return;}
 const pc=[b.x0+(probe[0]+.5)*b.sx,b.y0+(probe[1]+.5)*b.sy];
 let bounces=0,lit=0,blocked=0,esc=0,abs=0;
 for(const path of dbgPaths||[]){let prev=null,depth=0;
  for(const v2 of path.pts){const q=P(v2.p);
   if(v2.k===0){prev=null;continue;}
   if(v2.k===4||v2.k===5){if(prev){g.strokeStyle=v2.k===4?'rgba(255,225,77,.75)':'rgba(255,77,94,.85)';g.lineWidth=1;g.setLineDash([4,3]);g.beginPath();g.moveTo(prev[0],prev[1]);g.lineTo(q[0],q[1]);g.stroke();g.setLineDash([]);}v2.k===4?lit++:blocked++;continue;}
   if(v2.k===6){abs++;g.fillStyle='#b18cff';g.beginPath();g.arc(q[0],q[1],3,0,7);g.fill();continue;}
   if(prev){g.strokeStyle=v2.k===3?'rgba(126,200,255,.8)':`hsla(${30-depth*18},100%,${62-depth*6}%,.9)`;g.lineWidth=v2.k===3?1.2:1.6;g.beginPath();g.moveTo(prev[0],prev[1]);g.lineTo(q[0],q[1]);g.stroke();}
   if(v2.k===3){esc++;g.fillStyle='#7ec8ff';g.beginPath();g.arc(q[0],q[1],2.5,0,7);g.fill();prev=null;continue;}
   if(depth>0)bounces++;g.fillStyle=depth===0?'#ffffff':'#ff9f3a';g.beginPath();g.arc(q[0],q[1],depth===0?3.5:2.5,0,7);g.fill();prev=q;depth++;}}
 // the probed pixel
 g.strokeStyle='#ffffff';g.lineWidth=1.5;g.beginPath();g.moveTo(pc[0]-9,pc[1]);g.lineTo(pc[0]-3,pc[1]);g.moveTo(pc[0]+3,pc[1]);g.lineTo(pc[0]+9,pc[1]);g.moveTo(pc[0],pc[1]-9);g.lineTo(pc[0],pc[1]-3);g.moveTo(pc[0],pc[1]+3);g.lineTo(pc[0],pc[1]+9);g.stroke();
 const n=(dbgPaths||[]).length;
 setInfo('Ray paths: '+(n?`pixel ${probe[0]}, ${probe[1]} · ${n} sample paths · ${(bounces/n).toFixed(1)} bounces avg · sun ${lit}/${lit+blocked} shadow rays visible · ${esc} escaped · ${abs} ended by roulette`:`pixel ${probe[0]}, ${probe[1]} · waiting for samples…`));
 const lh=17,bw=170,bh=legend.length*lh+10;g.fillStyle='rgba(14,17,23,.72)';g.fillRect(12,b.ch-bh-12,bw,bh);
 legend.forEach(([c,t],k)=>{const y=b.ch-bh-12+10+k*lh;g.fillStyle=c;g.fillRect(20,y-1,14,3);g.fillStyle='#eef2f7';g.fillText(t,42,y);});}
setInterval(()=>{if(dbgMode===1){readDbg();if(!probe||!dbgPaths)drawDbg();}else if(dbgMode>=2){if(dbgMode<5)readImg();drawDbg();}else if(dbgCanvas&&dbgCanvas.style.display!=='none')dbgCanvas.style.display='none';},300);

// ---------------------------------------------------------------- save
async function imageCanvas(){if(!gpu||!accum||!spp)return null;const d=gpu.device,rb=d.createBuffer({size:W*H*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const enc=d.createCommandEncoder();enc.copyBufferToBuffer(accum,0,rb,0,W*H*16);d.queue.submit([enc.finish()]);await rb.mapAsync(GPUMapMode.READ);const f=new Float32Array(rb.getMappedRange().slice(0));rb.unmap();rb.destroy();
 const c2=document.createElement('canvas');c2.width=W;c2.height=H;const g=c2.getContext('2d'),img=g.createImageData(W,H);const ac=x=>Math.min(1,Math.max(0,(x*(2.51*x+.03))/(x*(2.43*x+.59)+.14)));
 const raw=dbgMode===3||dbgMode===4;for(let i=0;i<W*H;i++){const n=Math.max(1,f[i*4+3]);
  if(dbgMode===2){const c=heatJS(f[i*4]/n/64),m=f[i*4+1]/n>0.5?1:0.6;for(let k=0;k<3;k++)img.data[i*4+k]=Math.round(255*c[k]*m);img.data[i*4+3]=255;continue;}
  for(let k=0;k<3;k++){const v=f[i*4+k]/n;img.data[i*4+k]=Math.round(255*(raw?Math.min(1,Math.max(0,v)):Math.pow(ac(v*0.8),1/2.2)));}img.data[i*4+3]=255;}g.putImageData(img,0,0);
 return c2;}
async function saveImage(){const c2=await imageCanvas();if(!c2)return;
 const m=window.PAGame?.current?.main?.model||'vehicle';c2.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`${m}_${preset}_${spp}spp.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);},'image/png');}

// ---------------------------------------------------------------- public
window.PAPT={PRESETS,
 get enabled(){return enabled;},get preset(){return preset;},get scale(){return scale;},get res(){return res;},get status(){return status;},get spp(){return spp;},
 get info(){return gpu?{adapter:gpu.info?`${gpu.info.vendor||''} ${gpu.info.architecture||''} ${gpu.info.description||''}`.trim():'',bc:gpu.bc,scene:scene?.stats||null}:{error:initErr?.message||null};},
 setEnabled(on){on=!!on&&gateState.ok;enabled=on;wanted=on;store.set('pt:on',on);if(enabled)loop();else{if(canvas)canvas.style.visibility='hidden';setStatus('');}},
 setPreset(p){if(PRESETS[p]){preset=p;store.set('pt:preset',p);}},setScale(x){scale=x;store.set('pt:scale',x);},setRes(r){res=String(r);store.set('pt:res',res);},
 get debug(){return dbgMode;},get debugInfo(){return dbgInfo;},onDebug(fn){onDebug=fn;},
 setDebug(m){dbgMode=+m||0;if(dbgMode!==1){probe=null;dbgPaths=null;}img=null;stats='';hover=null;if(!dbgMode)setInfo('');ensureDbgCanvas();drawDbg();},clearProbe(){probe=null;dbgPaths=null;drawDbg();},
 onStatus(fn){onStatus=fn;},saveImage,async debugImage(){const c=await imageCanvas();return c?c.toDataURL('image/png'):null;},available:()=>gateState.ok,get gate(){return gateState;},ready:gateReady};
})();
