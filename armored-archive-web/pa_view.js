/* WebGL2 collision-model viewer for the protection analysis panel.
   Orthographic camera so every pixel's shot is parallel to the view direction (matches the protection map). */
(function(root){
'use strict';
const V={sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s],
 cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],norm:a=>{const l=Math.hypot(...a)||1;return a.map(x=>x/l)}};
const VS=`#version 300 es
in vec3 aPos;in vec3 aNrm;in vec4 aCol;uniform mat4 uVP;out vec3 vN;out vec4 vC;
void main(){vN=aNrm;vC=aCol;gl_Position=uVP*vec4(aPos,1.0);}`;
const FS=`#version 300 es
precision highp float;in vec3 vN;in vec4 vC;uniform vec3 uL;uniform vec3 uV;uniform int uCut;uniform int uCutSide;out vec4 o;
void main(){if(uCut==1&&gl_FrontFacing==(uCutSide==1))discard;vec3 n=normalize(vN);if(dot(n,uV)>0.0)n=-n;float d=max(dot(n,-uL),0.0);float h=0.5+0.5*n.y;
 if(vC.a<0.01)discard;vec3 c=vC.rgb*(0.34+0.30*h+0.52*d);o=vec4(c,vC.a);}`;
const LVS=`#version 300 es
in vec3 aPos;in vec4 aCol;uniform mat4 uVP;out vec4 vC;void main(){vC=aCol;gl_Position=uVP*vec4(aPos,1.0);gl_Position.z-=0.0005*gl_Position.w;}`;
const LFS=`#version 300 es
precision highp float;in vec4 vC;out vec4 o;void main(){o=vC;}`;
const GVS=`#version 300 es
in vec3 aPos;in vec3 aNrm;in vec2 aUV;in vec2 aUV2;uniform mat4 uVP;out vec3 vN;out vec2 vUV;out vec2 vUV2;out vec3 vP;
void main(){vN=aNrm;vUV=aUV;vUV2=aUV2;vP=aPos;gl_Position=uVP*vec4(aPos,1.0);}`;
// shared studio lighting: fixed sun (key), sky dome, ground bounce, ACES tone map
const LIGHT_GLSL=`
uniform vec3 uSun;uniform sampler2D uShadow;uniform mat4 uSunVP;uniform int uHasShadow;uniform int uLit;
const vec3 SUN_COL=vec3(3.1,2.95,2.75);const vec3 SKY_TOP=vec3(0.62,0.70,0.82);const vec3 SKY_HOR=vec3(0.86,0.88,0.90);const vec3 GROUND=vec3(0.36,0.36,0.35);
float shadowAt(vec3 p,vec3 n,float soft){if(uHasShadow==0)return 1.0;vec4 s=uSunVP*vec4(p+n*0.025,1.0);vec3 q=s.xyz/s.w*0.5+0.5;
 if(q.x<0.0||q.y<0.0||q.x>1.0||q.y>1.0||q.z>1.0)return 1.0;vec2 ts=soft/vec2(textureSize(uShadow,0));float sum=0.0;
 for(int i=-2;i<=2;i++)for(int j=-2;j<=2;j++){float d=texture(uShadow,q.xy+vec2(float(i),float(j))*ts).r;sum+=(q.z-0.0012<=d)?1.0:0.0;}return sum/25.0;}
vec3 skyAmb(vec3 n){float k=n.y*0.5+0.5;return mix(GROUND,mix(SKY_HOR,SKY_TOP,max(n.y,0.0)),smoothstep(0.0,1.0,k));}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec3 shade(vec3 base,vec3 n,vec3 V,float rough,float metal,float ao,float sh){
 vec3 L=normalize(uSun),H=normalize(L+V);float nl=max(dot(n,L),0.0),nv=max(dot(n,V),1e-3),nh=max(dot(n,H),0.0),vh=max(dot(V,H),0.0);
 float a=rough*rough,a2=a*a,d=nh*nh*(a2-1.0)+1.0,D=a2/(3.14159*d*d),k=(rough+1.0)*(rough+1.0)/8.0,G=nl/(nl*(1.0-k)+k)*nv/(nv*(1.0-k)+k);
 vec3 F0=mix(vec3(0.04),base,metal),F=F0+(1.0-F0)*pow(1.0-vh,5.0);vec3 spec=D*G*F/max(4.0*nl*nv,1e-3);
 vec3 diff=(1.0-F)*(1.0-metal)*base/3.14159;vec3 R=reflect(-V,n);vec3 env=skyAmb(R)*(F0+(1.0-F0)*pow(1.0-nv,5.0))*(1.0-rough*0.85);
 return (diff*3.14159*skyAmb(n)*0.55+env*0.6)*ao+(diff+spec)*SUN_COL*nl*sh;}
vec3 toDisplay(vec3 c){return pow(aces(c*0.8),vec3(1.0/2.2));}`;
const GFS=`#version 300 es
precision highp float;in vec3 vN;in vec2 vUV;in vec2 vUV2;in vec3 vP;uniform vec3 uL;uniform vec3 uV;uniform sampler2D uAlb;uniform sampler2D uCamo;uniform sampler2D uAO;uniform sampler2D uNrm;
uniform int uHasAlb;uniform int uHasCamo;uniform int uHasAO;uniform int uHasNrm;uniform int uMasked;uniform int uAtest;uniform vec4 uTint;uniform vec3 uPaint;uniform float uCamoScale;uniform float uNrmFlipY;out vec4 o;
${'${LIGHT}'}
void main(){vec3 ng=normalize(vN);vec3 V=-uV;if(dot(ng,V)<0.0)ng=-ng;
 vec4 a=uHasAlb==1?texture(uAlb,vUV):vec4(0.45,0.45,0.42,0.0);if(uAtest==1&&uHasAlb==1&&a.a<0.5)discard;
 vec3 paint=uHasCamo==1?texture(uCamo,vUV2*uCamoScale).rgb:uPaint;float lum=dot(a.rgb,vec3(0.299,0.587,0.114));
 vec3 alb=uHasAlb==0?paint:uMasked==1?mix(paint*clamp(0.42+lum*2.0,0.0,1.5),a.rgb*1.15,a.a*0.22):a.rgb;
 float ao=uHasAO==1?mix(0.35,1.0,texture(uAO,vUV).r):1.0;
 if(uLit==0){vec3 c=alb*ao*(0.36+0.30*(0.5+0.5*ng.y)+0.55*max(dot(ng,-uL),0.0));o=vec4(mix(c,uTint.rgb,uTint.a),1.0);return;}
 vec3 n=ng;float rough=0.62,metal=0.0;
 if(uHasNrm==1){vec4 t=texture(uNrm,vUV);vec2 xy=vec2(t.a,t.g)*2.0-1.0;xy.y*=uNrmFlipY;vec3 tn=vec3(xy,sqrt(max(0.0,1.0-dot(xy,xy))));
  vec3 dp1=dFdx(vP),dp2=dFdy(vP);vec2 du1=dFdx(vUV),du2=dFdy(vUV);vec3 p2=cross(dp2,ng),p1=cross(ng,dp1);vec3 T=p2*du1.x+p1*du2.x,B=p2*du1.y+p1*du2.y;
  float m=max(dot(T,T),dot(B,B));if(m>1e-20){float inv=inversesqrt(m);n=normalize(mat3(T*inv,B*inv,ng)*tn);}rough=clamp(1.0-t.r*0.85,0.12,1.0);metal=clamp(t.b*1.2,0.0,1.0);}
 vec3 base=pow(clamp(alb,0.0,1.0),vec3(2.2));vec3 c=shade(base,n,V,rough,metal,ao,shadowAt(vP,ng,1.2));
 o=vec4(mix(toDisplay(c),uTint.rgb,uTint.a),1.0);}`.replace('${LIGHT}',LIGHT_GLSL);
// studio floor: soft shadow, contact darkening, fades into the backdrop
const FLOOR_VS=`#version 300 es
in vec3 aPos;uniform mat4 uVP;out vec3 vP;void main(){vP=aPos;gl_Position=uVP*vec4(aPos,1.0);}`;
const FLOOR_FS=`#version 300 es
precision highp float;in vec3 vP;uniform vec3 uC;uniform float uR;uniform vec3 uV;out vec4 o;
${'${LIGHT}'}
void main(){float r=length(vP.xz-uC.xz)/uR;vec3 base=vec3(0.50,0.51,0.52);float sh=shadowAt(vP,vec3(0,1,0),2.6);
 vec3 c=base*(skyAmb(vec3(0,1,0))*0.62+SUN_COL*max(normalize(uSun).y,0.0)*sh*0.32);vec3 bg=vec3(0.80,0.82,0.85);
 vec3 col=toDisplay(c);o=vec4(mix(col,pow(aces(bg*0.8*0.62),vec3(1.0/2.2)),smoothstep(0.55,1.0,r)),1.0);}`.replace('${LIGHT}',LIGHT_GLSL);
const BG_VS=`#version 300 es
in vec2 aPos;out vec2 vQ;void main(){vQ=aPos;gl_Position=vec4(aPos,0.9999,1.0);}`;
const BG_FS=`#version 300 es
precision highp float;in vec2 vQ;out vec4 o;void main(){vec3 top=vec3(0.86,0.88,0.91),bot=vec3(0.74,0.76,0.79);o=vec4(mix(bot,top,vQ.y*0.5+0.5),1.0);}`;
const DEPTH_VS=`#version 300 es
in vec3 aPos;uniform mat4 uVP;void main(){gl_Position=uVP*vec4(aPos,1.0);}`;
const DEPTH_FS=`#version 300 es
precision highp float;out vec4 o;void main(){o=vec4(1.0);}`;
const XFS=`#version 300 es
precision highp float;in vec3 vN;in vec2 vUV;in vec2 vUV2;uniform vec3 uV;uniform vec4 uCol;out vec4 o;
void main(){vec3 n=normalize(vN);float rim=1.0-abs(dot(n,uV));o=vec4(uCol.rgb,uCol.a*(0.35+0.65*rim*rim));}`;
function compile(gl,vs,fs,locs){const p=gl.createProgram();if(locs)locs.forEach((n,i)=>gl.bindAttribLocation(p,i,n));for(const [t,s] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));gl.attachShader(p,sh);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function hex(c,a=1){const n=parseInt(c.slice(1),16);return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255,a];}
// X-ray categories and colours modelled on the game's hangar X-ray and its part filter
const XCATS=[['armor','Armor parts','#4f7db6'],['spall','Spall liner','#e8eef5'],['weapon','Weapon','#c0242c'],['autoloader','Autoloader','#9a4a2c'],['ammo','Ammo','#e3342f'],
 ['propulsion','Propulsion','#3fa645'],['crew','Crew','#d9c2a1'],['fuel','Fuel','#e8890f'],['optics','Sensors and optics','#86c0cf'],['drives','Weapon drives','#3f74c4'],['electronic','Electronic','#9353cc']];
const XCAT_COLORS=Object.fromEntries(XCATS.map(c=>[c[0],c[2]]));
function xcatOf(pp,name){if(!pp)return 'armor';name=name||pp.name||'';
 if(pp.role==='armor'||pp.role==='xray')return /aramid|spall|liner/i.test(pp.material+' '+name)?'spall':'armor';
 if(/autoloader|ammo_belt_feed|loading_mechanism/.test(name))return 'autoloader';
 switch(pp.category){case 'crew':return 'crew';case 'ammunition':return 'ammo';case 'fuel':return 'fuel';case 'powertrain':return 'propulsion';case 'gun':case 'breech':return 'weapon';case 'optics':return 'optics';}
 if(/^drive_turret|turret_drive|elevation|traverse/.test(name))return 'drives';if(/radiator|engine|transmission|cooling/.test(name))return 'propulsion';if(/^mg|machine_gun|gun_barrel|cannon/.test(name))return 'weapon';
 if(/optic|sight|periscope|thermal|camera|rangefinder|sensor|radar/.test(name))return 'optics';return 'electronic';}
const MODULE_COLORS={crew:XCAT_COLORS.crew,ammunition:XCAT_COLORS.ammo,fuel:XCAT_COLORS.fuel,powertrain:XCAT_COLORS.propulsion,breech:XCAT_COLORS.weapon,equipment:XCAT_COLORS.electronic,optics:XCAT_COLORS.optics,gun:XCAT_COLORS.weapon};
// armour view: nominal thickness → colour, thin teal/green through yellow to red
const TSTOPS=[[0,[.17,.70,.63]],[15,[.25,.74,.36]],[40,[.55,.80,.25]],[80,[.93,.82,.22]],[150,[.94,.55,.17]],[300,[.86,.27,.18]],[600,[.70,.12,.16]]];
function thicknessColor(t){t=t||0;for(let i=1;i<TSTOPS.length;i++)if(t<=TSTOPS[i][0]){const [a,ca]=TSTOPS[i-1],[b,cb]=TSTOPS[i],k=(t-a)/(b-a);return ca.map((v,j)=>v+(cb[j]-v)*k);}return TSTOPS[TSTOPS.length-1][1];}
function armorColor(pp){const m=pp.material||'',t=pp.armorThickness||0;
 if(/ERA/.test(m)&&!/nera/i.test(m))return hex('#e0703c');
 if(/nera|composite|special|ceramic|textolite|aramide/i.test(m)||(pp.armorThrough??1)<.1)return hex('#d9b25a');
 if(/screen|rubber|traks|wheels/i.test(m))return hex('#7d8796');
 const k=Math.min(1,Math.log10(1+t)/Math.log10(301));return [.42+.40*k,.50+.18*k-.08*k*k,.62-.30*k,1];}
class Viewer{
 constructor(canvas,overlay){this.c=canvas;this.ov=overlay;this.ctx=overlay.getContext('2d');
  const gl=canvas.getContext('webgl2',{antialias:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL2 unavailable');this.gl=gl;
  this.prog=compile(gl,VS,FS,['aPos','aNrm','aCol']);this.lprog=compile(gl,LVS,LFS);const GL=['aPos','aNrm','aUV','aUV2'];this.gprog=compile(gl,GVS,GFS,GL);this.fprog=compile(gl,FLOOR_VS,FLOOR_FS,['aPos']);this.bgprog=compile(gl,BG_VS,BG_FS,['aPos']);this.dprog=compile(gl,DEPTH_VS,DEPTH_FS,['aPos']);this.studio=true;this.lit=true;this.nrmFlipY=1;this.sun=V.norm([0.55,0.78,0.30]);this.xprog=compile(gl,GVS,XFS,GL);this.visual={};this.visualOn=true;this.xfilter=new Set(XCATS.map(c=>c[0]));this.hover=null;this.texCache=new Map();this.yaw=Math.PI*.82;this.pitch=.32;this.zoom=4;this.target=[0,1,0];this.mode='armor';
  this.lines=[];this.map=null;this.marker=null;this.listeners={};this.bindInput();this.resize();
  new ResizeObserver(()=>{this.resize();this.draw();}).observe(canvas.parentElement);}
 on(e,f){this.listeners[e]=f;}
 emit(e,...a){this.listeners[e]?.(...a);}
 resize(){const r=this.c.parentElement.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);const w=Math.max(10,Math.round(r.width)),h=Math.max(10,Math.round(r.height));
  for(const el of [this.c,this.ov]){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);el.style.width=w+'px';el.style.height=h+'px';}this.dpr=dpr;this.w=w;this.h=h;}
 setMesh(prep,hidden){this.prep=prep;this._cover=null;this.hidden=new Set(hidden||[]);const [lo,hi]=prep.bounds;this.center=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2];
  this.radius=Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])/2;this.target=this.center.slice();this.zoom=this.radius*1.05;this.dead=new Set();this.damaged=new Map();this.highlight=new Set();this.hover=undefined;this.hoverCount=0;this.hoverEdges=0;this.hoverDm=null;this.rebuild();}
 setState(dead,damaged){this.dead=new Set(dead||[]);this.damaged=damaged||new Map();this.rebuildColors();this.draw();}
 setMode(m){this.mode=m;this.hover=undefined;this.setHover(null);this.rebuildColors();this.draw();}
 setHidden(h){this.hidden=new Set(h||[]);this.rebuild();}
 rebuild(){const gl=this.gl,prep=this.prep;if(!prep)return;const pos=[],nrm=[],owner=[];
  const figs=this.moduleStyle!=='hitbox'&&root.PAFigures;prep._fig=prep._fig||[];prep._edge=prep._edge||[];const ep=[],eo=[];
  prep.nodes.forEach((n,ni)=>{const pp=prep.props[ni];if(!pp||this.hidden.has(n.name))return;if(pp.role!=='armor'&&pp.role!=='module')return;
   if(figs&&pp.role==='module'){if(prep._fig[ni]===undefined)prep._fig[ni]=root.PAFigures.figure(n,pp)||null;const f=prep._fig[ni];
    if(f){for(let k=0;k<f.pos.length;k+=3){pos.push(f.pos[k],f.pos[k+1],f.pos[k+2]);nrm.push(f.nrm[k],f.nrm[k+1],f.nrm[k+2]);owner.push(ni);}return;}}
   for(const t of n.triangles){const a=n.vertices[t[0]],b=n.vertices[t[1]],c=n.vertices[t[2]],f=V.norm(V.cross(V.sub(b,a),V.sub(c,a)));
    for(const v of [a,b,c]){pos.push(v[0],v[1],v[2]);nrm.push(f[0],f[1],f[2]);owner.push(ni);}}
   if(root.PAFigures){if(!prep._edge[ni])prep._edge[ni]=root.PAFigures.edges(n);for(const v of prep._edge[ni]){ep.push(v[0],v[1],v[2]);eo.push(ni);}}});
  this.edgePos=new Float32Array(ep);this.edgeOwner=eo;
  this.owner=owner;this.count=owner.length;this._srcPos={p:new Float32Array(pos),n:new Float32Array(nrm)};
  if(!this.vao){this.vao=gl.createVertexArray();this.bp=gl.createBuffer();this.bn=gl.createBuffer();this.bc=gl.createBuffer();this.lvao=gl.createVertexArray();this.lb=gl.createBuffer();this.lc=gl.createBuffer();this.evao=gl.createVertexArray();this.eb=gl.createBuffer();this.ec=gl.createBuffer();
   gl.bindVertexArray(this.vao);const P=this.prog;
   for(const [buf,name,size] of [[this.bp,'aPos',3],[this.bn,'aNrm',3],[this.bc,'aCol',4]]){const loc=gl.getAttribLocation(P,name);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}}
  {const gl2=gl;gl2.bindVertexArray(this.evao);const lp=gl2.getAttribLocation(this.lprog,'aPos'),lc=gl2.getAttribLocation(this.lprog,'aCol');gl2.bindBuffer(gl2.ARRAY_BUFFER,this.eb);gl2.bufferData(gl2.ARRAY_BUFFER,this.edgePos,gl2.STATIC_DRAW);gl2.enableVertexAttribArray(lp);gl2.vertexAttribPointer(lp,3,gl2.FLOAT,false,0,0);gl2.bindBuffer(gl2.ARRAY_BUFFER,this.ec);gl2.enableVertexAttribArray(lc);gl2.vertexAttribPointer(lc,4,gl2.FLOAT,false,0,0);}
  this.rebuildColors();}
 setModuleStyle(st){this.moduleStyle=st;if(this.prep){this.rebuild();this.draw();}}
 setFilter(set){this.xfilter=new Set(set);this._cover=null;this.rebuildColors();this.draw();}
 catVisible(pp,name){return this.xfilter.has(xcatOf(pp,name));}
 // colour of one damage-model part for the current mode (alpha 0 = not drawn)
 partColor(ni){const prep=this.prep,pp=prep.props[ni],name=prep.nodes[ni].name,isMod=pp.role==='module',xray=this.mode!=='armor',vis=this.visualOn&&this.visual.main;
  if(this.mode==='inspect'&&this.plainModel)return isMod?[0,0,0,0]:[.56,.58,.52,1];
  if(this.dead.has(name))return [.55,.12,.12,xray&&!this.catVisible(pp,name)?0:1];if(this.damaged.has(name))return [1,.62,.2,xray&&!this.catVisible(pp,name)?0:1];
  if(this.highlight.has(name))return [.39,.88,.94,1];
  if(!xray){if(isMod)return pp.category==='gun'&&!vis?[.55,.58,.62,1]:[0,0,0,0];const c=thicknessColor(pp.armorThickness);return [...c,vis?.40:1];}
  if(!this.catVisible(pp,name))return [0,0,0,0];
  const cat=xcatOf(pp,name),c=hex(XCAT_COLORS[cat]);
  if(isMod)return this.xrayCover().has(name)?[0,0,0,0]:c;
  if(cat==='spall')return [c[0],c[1],c[2],.22];
  return [c[0],c[1],c[2],this.mode==='inspect'&&this.inspectArmor?.78:.42];}
 rebuildColors(){const gl=this.gl,prep=this.prep;if(!prep||!this.owner)return;const col=new Float32Array(this.count*4);this._cover=null;
  // order: damaged/dead first (drawn over the game model), opaque, then transparent
  const opaque=[],trans=[],dmg=[],pc=new Map();
  for(let i=0;i<this.count;i+=3){const ni=this.owner[i],name=prep.nodes[ni].name;let c=pc.get(ni);if(!c){c=this.partColor(ni);pc.set(ni,c);}
   for(let k=0;k<3;k++)col.set(c,(i+k)*4);if(c[3]<=0)continue;(c[3]>=.99?(this.dead.has(name)||this.damaged.has(name)?dmg:opaque):trans).push(i);}
  this.recolorXray();
  this.colors=col;this.opaque=dmg.concat(opaque);this.trans=trans;
  const order=[...dmg,...opaque,...trans];this.nDmg=dmg.length*3;this.nOpaque=(dmg.length+opaque.length)*3;this.nDraw=order.length*3;
  const remap=(src,sz)=>{const out=new Float32Array(order.length*3*sz);order.forEach((tri,j)=>{out.set(src.subarray(tri*sz,(tri+3)*sz),j*3*sz);});return out;};
  gl.bindVertexArray(this.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.bp);gl.bufferData(gl.ARRAY_BUFFER,remap(this._srcPos.p,3),gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.bn);gl.bufferData(gl.ARRAY_BUFFER,remap(this._srcPos.n,3),gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,this.bc);gl.bufferData(gl.ARRAY_BUFFER,remap(col,4),gl.DYNAMIC_DRAW);
  if(this.edgeOwner){const ec=new Float32Array(this.edgeOwner.length*4),xray=this.mode!=='armor';
   this.edgeOwner.forEach((ni,i)=>{const pp=prep.props[ni],nm=prep.nodes[ni].name,c=pc.get(ni)||this.partColor(ni);let e;
    if(pp.role==='module'||c[3]<=0)e=[0,0,0,0];
    else if(!xray)e=[Math.min(1,c[0]*1.25+.08),Math.min(1,c[1]*1.25+.08),Math.min(1,c[2]*1.25+.08),.75];
    else e=xcatOf(pp,nm)==='spall'?[1,1,1,.55]:[.80,.88,.98,.32];
    if(this.dead.has(nm))e=[.3,.05,.05,.8];ec.set(e,i*4);});
   gl.bindVertexArray(this.evao);gl.bindBuffer(gl.ARRAY_BUFFER,this.ec);gl.bufferData(gl.ARRAY_BUFFER,ec,gl.DYNAMIC_DRAW);this.edgeCount=this.edgeOwner.length;}}
 // hovered part: bright fill + outline (yellow in the armour view, white in X-ray like the game)
 setHover(ni){if(this.mode==='inspect'&&this.plainModel)ni=null;if(ni===this.hover)return;this.hover=ni;const gl=this.gl,prep=this.prep;
  if(!this.hvao){this.hvao=gl.createVertexArray();this.hb=gl.createBuffer();this.hn=gl.createBuffer();this.hc=gl.createBuffer();this.hevao=gl.createVertexArray();this.heb=gl.createBuffer();this.hec=gl.createBuffer();}
  this.hoverCount=0;this.hoverEdges=0;const prevDm=this.hoverDm;this.hoverDm=null;
  if(ni!=null&&prep){const n=prep.nodes[ni],pp=prep.props[ni]||{},name=n.name,xray=this.mode!=='armor';
   if(xray&&this.visualOn&&this.visual.xray?.dm?.includes(name))this.hoverDm=name; // lighten the game's own x-ray mesh
   if(!(xray&&this.xrayCover().has(name))){const pos=[],nrm=[];const fig=pp.role==='module'&&this.moduleStyle!=='hitbox'?prep._fig?.[ni]:null;
    if(fig){pos.push(...fig.pos);nrm.push(...fig.nrm);}else for(const t of n.triangles){const a=n.vertices[t[0]],b=n.vertices[t[1]],c=n.vertices[t[2]],f=V.norm(V.cross(V.sub(b,a),V.sub(c,a)));for(const v of [a,b,c]){pos.push(...v);nrm.push(...f);}}
    const col=xray?[1,1,1,.30]:[1,.93,.25,.62],cc=new Float32Array(pos.length/3*4);for(let k=0;k<cc.length;k+=4)cc.set(col,k);
    gl.bindVertexArray(this.hvao);for(const [buf,data,loc,size] of [[this.hb,pos,0,3],[this.hn,nrm,1,3],[this.hc,cc,2,4]]){gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}
    this.hoverCount=pos.length/3;
    const ed=!fig&&root.PAFigures?(prep._edge[ni]||(prep._edge[ni]=root.PAFigures.edges(n))):[];
    if(ed.length){const ep=new Float32Array(ed.length*3),ecol=new Float32Array(ed.length*4),lc=xray?[1,1,1,.95]:[1,.97,.55,1];ed.forEach((v,k)=>{ep.set(v,k*3);ecol.set(lc,k*4);});
     gl.bindVertexArray(this.hevao);const lp=gl.getAttribLocation(this.lprog,'aPos'),la=gl.getAttribLocation(this.lprog,'aCol');
     gl.bindBuffer(gl.ARRAY_BUFFER,this.heb);gl.bufferData(gl.ARRAY_BUFFER,ep,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(lp);gl.vertexAttribPointer(lp,3,gl.FLOAT,false,0,0);
     gl.bindBuffer(gl.ARRAY_BUFFER,this.hec);gl.bufferData(gl.ARRAY_BUFFER,ecol,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(la);gl.vertexAttribPointer(la,4,gl.FLOAT,false,0,0);this.hoverEdges=ed.length;}}}
  if(prevDm!==this.hoverDm)this.recolorXray();this.draw();}
 basis(){const cp=Math.cos(this.pitch),f=V.norm([-Math.cos(this.yaw)*cp,-Math.sin(this.pitch),-Math.sin(this.yaw)*cp]);const r=V.norm(V.cross([0,1,0],f));const u=V.norm(V.cross(f,r));return {f,r,u};} // assets are x-forward, y-up, z-left (Dagor): screen-right = up × forward keeps left/right correct

 viewProj(){const {f,r,u}=this.basis(),a=this.w/this.h,hh=this.zoom,hw=hh*a,eye=V.sub(this.target,V.mul(f,this.radius*4+5)),near=.1,far=this.radius*8+20;
  const tx=-V.dot(r,eye),ty=-V.dot(u,eye),tz=V.dot(f,eye);
  // column-major: ortho * lookAt
  const sx=1/hw,sy=1/hh,sz=-2/(far-near),oz=-(far+near)/(far-near);
  return new Float32Array([sx*r[0],sy*u[0],sz*-f[0],0, sx*r[1],sy*u[1],sz*-f[1],0, sx*r[2],sy*u[2],sz*-f[2],0, sx*tx,sy*ty,sz*tz+oz,1]);}
 // pixel → parallel shot ray (origin outside the vehicle)
 ray(px,py){const {f,r,u}=this.basis(),a=this.w/this.h,x=(px/this.w*2-1)*this.zoom*a,y=(1-py/this.h*2)*this.zoom;
  const o=V.add(V.add(this.target,V.mul(r,x)),V.mul(u,y));return {origin:V.sub(o,V.mul(f,this.radius*2+4)),dir:f};}
 project(p){const m=this.viewProj(),x=m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],y=m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13];return [(x+1)/2*this.w,(1-y)/2*this.h];}
 setView(name){const views={front:[0,.12],rear:[Math.PI,.12],left:[-Math.PI/2*this.sideSign(),.1],right:[Math.PI/2*this.sideSign(),.1],top:[Math.PI*.999,1.45],iso:[Math.PI*.22,.42]};
  // yaw 0 places the camera on +x (vehicle front)
  const v=views[name]||views.iso;this.yaw=v[0];this.pitch=v[1];this.target=this.center.slice();this.zoom=Math.max(this.radius*(name==='top'?1.05:.82),this.radius*.95*this.h/this.w);this.emit('view');this.draw();}
 sideSign(){const prep=this.prep;if(!prep)return 1;let l=0,r=0,nl=0,nr=0;prep.nodes.forEach(n=>{const m=n.name.match(/_(l|r)(_|\d|$)/);if(!m||!n.vertices.length)return;const z=n.vertices.reduce((s,v)=>s+v[2],0)/n.vertices.length;if(m[1]==='l'){l+=z;nl++;}else{r+=z;nr++;}});
  return nl&&nr?(l/nl<r/nr?1:-1):1;} // +1 when the vehicle's left side is −z
 setVisual(kind,m){const gl=this.gl;if(this.visual[kind]?.vao)gl.deleteVertexArray(this.visual[kind].vao);if(!m){delete this.visual[kind];this._cover=null;this.rebuildColors();this.draw();return;}
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);const bufs=[];
  for(const [data,loc,size] of [[m.pos,0,3],[m.nrm,1,3],[m.uv,2,2],[m.uv2||m.uv,3,2]]){const b=gl.createBuffer();bufs.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}
  const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.idx,gl.STATIC_DRAW);
  const v=this.visual[kind]={vao,groups:m.groups,materials:m.materials||[],count:m.idx.length};
  if(kind==='main')this.setupStudio(m,vao);
  if(kind==='main'&&m.part&&m.parts?.length){ // running gear (wheels, tracks, suspension) stays textured in X-ray, like the game
   const keep=m.parts.map(n=>/^(wheel|track|suspension|bone_wheel|bone_phx_wheel|sprocket|idler)/.test(n||'')),idx=[],groups=[];
   for(const g of m.groups){const first=idx.length;for(let t=g.first;t<g.first+g.count;t+=3){if(keep[m.part[m.idx[t]]])idx.push(m.idx[t],m.idx[t+1],m.idx[t+2]);}if(idx.length>first)groups.push({mat:g.mat,first,count:idx.length-first});}
   if(idx.length){v.cvao=gl.createVertexArray();gl.bindVertexArray(v.cvao);for(const [b,loc,size] of [[bufs[0],0,3],[bufs[1],1,3],[bufs[2],2,2],[bufs[3],3,2]]){gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}
    const cib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,cib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(idx),gl.STATIC_DRAW);v.cgroups=groups;gl.bindVertexArray(null);}}
  if(kind==='xray'&&m.part&&m.parts?.length){ // the game's x-ray meshes are named <part>_xray, matching damage-model part <part>_dm
   v.part=m.part;v.dm=m.parts.map(n=>/_xray$/.test(n)?n.replace(/_xray$/,'_dm'):null);
   v.svao=gl.createVertexArray();gl.bindVertexArray(v.svao);
   for(const [b,loc,size] of [[bufs[0],0,3],[bufs[1],1,3]]){gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}
   v.cbuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v.cbuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(m.part.length*4),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,0,0);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bindVertexArray(null);}
  this._cover=null;this.rebuildColors();this.draw();}
 setPlainModel(on){this.plainModel=!!on;this.hover=undefined;this.setHover(null);this.rebuildColors();this.draw();}
 // studio: bounds, floor quad, sun shadow map (rendered once per vehicle: the scene and the sun are static)
 setupStudio(m,vao){const gl=this.gl;let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];for(let i=0;i<m.pos.length;i+=3)for(let k=0;k<3;k++){const x=m.pos[i+k];if(x<lo[k])lo[k]=x;if(x>hi[k])hi[k]=x;}
  const c=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2],R=Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2])/2,fy=lo[1]+0.003,FR=R*3.4;
  this.studioInfo={c,R,fy,FR,lo,hi};
  if(!this.fvao){this.fvao=gl.createVertexArray();this.fb=gl.createBuffer();this.bgvao=gl.createVertexArray();const bb=gl.createBuffer();gl.bindVertexArray(this.bgvao);gl.bindBuffer(gl.ARRAY_BUFFER,bb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);}
  gl.bindVertexArray(this.fvao);gl.bindBuffer(gl.ARRAY_BUFFER,this.fb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([c[0]-FR,fy,c[2]-FR,c[0]+FR,fy,c[2]-FR,c[0]-FR,fy,c[2]+FR,c[0]+FR,fy,c[2]+FR]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  // orthographic sun camera framing the vehicle and the floor around it
  const S=this.sun,f=V.mul(S,-1),up=Math.abs(S[1])>.95?[1,0,0]:[0,1,0],r=V.norm(V.cross(up,f)),u=V.cross(f,r),ext=R*1.9,eye=V.add([c[0],fy+R*.5,c[2]],V.mul(S,R*4)),near=.1,far=R*9;
  const tx=-V.dot(r,eye),ty=-V.dot(u,eye),tz=V.dot(f,eye),sx=1/ext,sy=1/ext,sz=-2/(far-near),oz=-(far+near)/(far-near);
  this.sunVP=new Float32Array([sx*r[0],sy*u[0],sz*-f[0],0, sx*r[1],sy*u[1],sz*-f[1],0, sx*r[2],sy*u[2],sz*-f[2],0, sx*tx,sy*ty,sz*tz+oz,1]);
  const N=2048;if(!this.shadowTex){this.shadowTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.shadowTex);gl.texStorage2D(gl.TEXTURE_2D,1,gl.DEPTH_COMPONENT24,N,N);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   this.shadowFb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,this.shadowTex,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFb);gl.viewport(0,0,N,N);gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.BLEND);
  gl.useProgram(this.dprog);gl.uniformMatrix4fv(gl.getUniformLocation(this.dprog,'uVP'),false,this.sunVP);gl.bindVertexArray(vao);gl.drawElements(gl.TRIANGLES,m.idx.length,gl.UNSIGNED_INT,0);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.hasShadow=true;}
 lightUniforms(P){const gl=this.gl,U=n=>gl.getUniformLocation(P,n);gl.uniform3fv(U('uSun'),this.sun);gl.uniformMatrix4fv(U('uSunVP'),false,this.sunVP||new Float32Array(16));gl.uniform1i(U('uHasShadow'),this.hasShadow&&this.lit?1:0);
  gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.hasShadow?this.shadowTex:null);gl.uniform1i(U('uShadow'),4);gl.uniform1i(U('uLit'),this.lit?1:0);gl.activeTexture(gl.TEXTURE0);}
 drawStudio(vp,f){const gl=this.gl,st=this.studioInfo;if(!st)return;gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.useProgram(this.bgprog);gl.bindVertexArray(this.bgvao);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.useProgram(this.fprog);const U=n=>gl.getUniformLocation(this.fprog,n);gl.uniformMatrix4fv(U('uVP'),false,vp);gl.uniform3fv(U('uC'),st.c);gl.uniform1f(U('uR'),st.FR);gl.uniform3fv(U('uV'),f);this.lightUniforms(this.fprog);
  gl.bindVertexArray(this.fvao);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,2);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.disable(gl.POLYGON_OFFSET_FILL);}
 setStudio(on){this.studio=!!on;this.draw();}
 setLit(on){this.lit=!!on;this.draw();}
 setSkin(map){this.skin=map&&map.size?map:null;this.draw();} // camouflage: standard camo texture → skin texture
 setVisualOn(on){this.visualOn=!!on;this._cover=null;this.rebuildColors();this.draw();}
 // damage-model module names drawn by the game's x-ray meshes (only those whose part exists in this damage model)
 xrayCover(){const x=this.visual.xray;if(!this.visualOn||!x?.svao||!this.prep)return new Set();if(this._cover)return this._cover;
  return this._cover=new Set(x.dm.filter(n=>n&&this.prep.nameIndex.has(n)&&this.prep.props[this.prep.nameIndex.get(n)]?.role==='module'));}
 xrayColor(dm){const prep=this.prep;const i=dm!=null?prep.nameIndex.get(dm):undefined;
  if(i===undefined)return this.xfilter.has('electronic')?[.60,.64,.70,1]:[0,0,0,0]; // x-ray detail with no damage-model part (racks, brackets)
  if(this.hidden.has(dm))return [0,0,0,0];
  let pp=prep.props[i];const raw=prep.mesh?.nodes?.[i]?.part;
  // composite inserts, firewalls and trunnions: the game draws their x-ray meshes (NERA screens etc.) as pale steel
  const insert=(pp&&pp.role==='armor')||(!pp&&(raw?.role==='excluded'||raw?.role==='armor')&&/armor|armour|composite|era|screen/.test(dm));
  if(!pp)pp={role:insert?'armor':'module',category:null,material:raw?.material||'',name:dm}; // x-ray-only parts (power system, driver controls)
  if(!this.catVisible(pp,dm))return [0,0,0,0];
  let c;if(this.highlight.has(dm))c=[.39,.88,.94,1];else if(this.dead.has(dm))c=[.55,.12,.12,1];else if(this.damaged.has(dm))c=[1,.62,.2,1];else c=insert?[.80,.84,.89,1]:hex(XCAT_COLORS[xcatOf(pp,dm)]);
  if(dm===this.hoverDm)c=[c[0]+(1-c[0])*.5,c[1]+(1-c[1])*.5,c[2]+(1-c[2])*.5,1];return c;}
 recolorXray(){const x=this.visual.xray;if(!x?.svao||!this.prep)return;const gl=this.gl,col=new Float32Array(x.part.length*4),cache=x.dm.map(n=>this.xrayColor(n));
  for(let k=0;k<x.part.length;k++)col.set(cache[x.part[k]],k*4);gl.bindBuffer(gl.ARRAY_BUFFER,x.cbuf);gl.bufferData(gl.ARRAY_BUFFER,col,gl.DYNAMIC_DRAW);}

 compressedFormats(){if(this._fmts)return this._fmts;const gl=this.gl,f={};const s3=gl.getExtension('WEBGL_compressed_texture_s3tc'),rg=gl.getExtension('EXT_texture_compression_rgtc'),bp=gl.getExtension('EXT_texture_compression_bptc');
  if(s3){f.bc1=s3.COMPRESSED_RGBA_S3TC_DXT1_EXT;f.bc2=s3.COMPRESSED_RGBA_S3TC_DXT3_EXT;f.bc3=s3.COMPRESSED_RGBA_S3TC_DXT5_EXT;}if(rg){f.bc4=rg.COMPRESSED_RED_RGTC1_EXT;f.bc5=rg.COMPRESSED_RED_GREEN_RGTC2_EXT;}if(bp){f.bc7=bp.COMPRESSED_RGBA_BPTC_UNORM_EXT;f.bc6h=bp.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT;}
  return this._fmts=f;}
 uploadTexture(name,t){const gl=this.gl,fmts=this.compressedFormats();
  // keep only a gap-free mip chain: a missing level makes the texture incomplete and it samples black
  {const ms=[t.mips[0]];for(const m of t.mips.slice(1)){const l=ms[ms.length-1];if(m.w===Math.max(1,l.w>>1)&&m.h===Math.max(1,l.h>>1))ms.push(m);else break;}t={...t,mips:ms};}
 const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);let n=0;
  if(t.fmt==='rgba8'){for(const m of t.mips){gl.texImage2D(gl.TEXTURE_2D,n++,gl.RGBA,m.w,m.h,0,gl.RGBA,gl.UNSIGNED_BYTE,m.data);}}
  else{const glf=fmts[t.fmt];if(!glf){gl.deleteTexture(tex);return false;}for(const m of t.mips){if(n>0&&(m.w<4||m.h<4))break;gl.compressedTexImage2D(gl.TEXTURE_2D,n++,glf,m.w,m.h,0,m.data);}}
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,Math.max(0,n-1));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,n>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  const an=gl.getExtension('EXT_texture_filter_anisotropic');if(an)gl.texParameterf(gl.TEXTURE_2D,an.TEXTURE_MAX_ANISOTROPY_EXT,8);
  this.texCache.set(name,tex);if(gl.getError()!==gl.NO_ERROR){this.texCache.delete(name);return false;}this.draw();return true;}
 drawVisual(vp,f,L,chassisOnly){const gl=this.gl,v=this.visual.main;if(!v)return false;const vao=chassisOnly?v.cvao:v.vao,groups=chassisOnly?v.cgroups:v.groups;if(!vao)return false;
  const P=this.gprog,U=n=>gl.getUniformLocation(P,n);gl.useProgram(P);gl.uniformMatrix4fv(U('uVP'),false,vp);gl.uniform3fv(U('uL'),L);gl.uniform3fv(U('uV'),f);
  gl.uniform1i(U('uAlb'),0);gl.uniform1i(U('uCamo'),1);gl.uniform1i(U('uAO'),2);gl.uniform3fv(U('uPaint'),this.paint||[.56,.53,.40]);gl.uniform4fv(U('uTint'),chassisOnly?[.10,.12,.15,.20]:[0,0,0,0]);gl.uniform1i(U('uNrm'),3);gl.uniform1f(U('uNrmFlipY'),this.nrmFlipY);this.lightUniforms(P);
  gl.bindVertexArray(vao);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
  for(const g of groups){const m=v.materials[g.mat]||{};const bind=(unit,name,flag)=>{const t=name&&this.texCache.get(name);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t||null);gl.uniform1i(U(flag),t?1:0);};
   bind(0,m.t0,'uHasAlb');gl.uniform1i(U('uMasked'),/masked/.test(m.cls||'')?1:0);gl.uniform1i(U('uAtest'),/atest/.test(m.cls||'')?1:0);bind(1,/masked/.test(m.cls||'')?(this.skin?.get(m.t1)||m.t1):null,'uHasCamo');bind(2,m.t3&&/_ao$/.test(m.t3)?m.t3:null,'uHasAO');bind(3,m.t2&&/_n$/.test(m.t2)?m.t2:null,'uHasNrm');gl.uniform1f(U('uCamoScale'),1);
   gl.drawElements(gl.TRIANGLES,g.count,gl.UNSIGNED_INT,g.first*4);}
  gl.activeTexture(gl.TEXTURE0);return true;}
 setLines(lines){this.lines=lines||[];this.draw();}
 setMap(map){this.map=map;this.drawOverlay();}
 draw(){const gl=this.gl;if(!this.prep){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);return;}
  gl.viewport(0,0,this.c.width,this.c.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.colorMask(true,true,true,true);
  const vp=this.viewProj(),{f}=this.basis(),L=V.norm([f[0]*.6-.3,-.7,f[2]*.6+.2]);
  const useProg=()=>{gl.useProgram(this.prog);gl.uniformMatrix4fv(gl.getUniformLocation(this.prog,'uVP'),false,vp);gl.uniform3fv(gl.getUniformLocation(this.prog,'uL'),L);gl.uniform3fv(gl.getUniformLocation(this.prog,'uV'),f);};
  const useVis=this.visualOn&&this.visual.main,blend=on=>{if(on){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);}else gl.disable(gl.BLEND);};
  const edges=()=>{if(!this.edgeCount||this.showEdges===false)return;gl.useProgram(this.lprog);gl.uniformMatrix4fv(gl.getUniformLocation(this.lprog,'uVP'),false,vp);gl.bindVertexArray(this.evao);blend(true);gl.depthMask(false);gl.drawArrays(gl.LINES,0,this.edgeCount);gl.depthMask(true);};
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
  if(useVis&&this.studio&&this.studioInfo)this.drawStudio(vp,f);
  if(this.mode==='inspect'&&this.plainModel){
   if(useVis)this.drawVisual(vp,f,L,false);
   else{useProg();gl.bindVertexArray(this.vao);blend(false);gl.drawArrays(gl.TRIANGLES,0,this.nDraw);} // no game installed: plain grey hull
   blend(false);gl.useProgram(this.prog);gl.bindVertexArray(this.vao);
   if(this.lines.length)this.drawLines(vp);this.drawOverlay();return;}
  if(this.mode==='armor'){
   if(useVis){ // textured vehicle, then the armour as one translucent thickness-coloured layer on top (nearest surface only)
    this.drawVisual(vp,f,L,false);useProg();gl.bindVertexArray(this.vao);blend(false);
    if(this.nDmg){gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-2);gl.drawArrays(gl.TRIANGLES,0,this.nDmg);gl.disable(gl.POLYGON_OFFSET_FILL);}
    gl.clear(gl.DEPTH_BUFFER_BIT);gl.colorMask(false,false,false,false);gl.drawArrays(gl.TRIANGLES,this.nOpaque,this.nDraw-this.nOpaque);gl.colorMask(true,true,true,true);
    blend(true);gl.depthMask(false);gl.uniform1i(gl.getUniformLocation(this.prog,'uCut'),this.cutaway===false?0:1);gl.uniform1i(gl.getUniformLocation(this.prog,'uCutSide'),this.cutSide??0);
   gl.drawArrays(gl.TRIANGLES,this.nOpaque,this.nDraw-this.nOpaque);gl.uniform1i(gl.getUniformLocation(this.prog,'uCut'),0);gl.depthMask(true);edges();}
   else{useProg();gl.bindVertexArray(this.vao);blend(false);gl.drawArrays(gl.TRIANGLES,0,this.nOpaque);edges();}}
  else{ // X-ray like the game: running gear textured, armour as tinted glass, modules always in full view on top of it
   if(useVis)this.drawVisual(vp,f,L,true);
   useProg();gl.bindVertexArray(this.vao);blend(true);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,this.nOpaque,this.nDraw-this.nOpaque);gl.depthMask(true);edges();
   gl.clear(gl.DEPTH_BUFFER_BIT);useProg();gl.bindVertexArray(this.vao);blend(false);gl.drawArrays(gl.TRIANGLES,0,this.nOpaque);
   if(useVis&&this.visual.xray?.svao){gl.bindVertexArray(this.visual.xray.svao);gl.drawElements(gl.TRIANGLES,this.visual.xray.count,gl.UNSIGNED_INT,0);gl.bindVertexArray(this.vao);}}
  if(this.hoverCount){useProg();gl.bindVertexArray(this.hvao);blend(true);gl.depthMask(false);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-2,-4);
   if(this.mode==='armor')gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.TRIANGLES,0,this.hoverCount);gl.enable(gl.DEPTH_TEST);gl.disable(gl.POLYGON_OFFSET_FILL);gl.depthMask(true);}
  if(this.hoverEdges){gl.useProgram(this.lprog);gl.uniformMatrix4fv(gl.getUniformLocation(this.lprog,'uVP'),false,vp);gl.bindVertexArray(this.hevao);blend(true);gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.LINES,0,this.hoverEdges);gl.enable(gl.DEPTH_TEST);}
  blend(false);gl.useProgram(this.prog);gl.bindVertexArray(this.vao);
  if(this.lines.length)this.drawLines(vp);
  this.drawOverlay();}
 drawLines(vp){const gl=this.gl;{const p=[],c=[];for(const l of this.lines){p.push(...l.a,...l.b);c.push(...l.color,...l.color);}
   gl.useProgram(this.lprog);gl.uniformMatrix4fv(gl.getUniformLocation(this.lprog,'uVP'),false,vp);gl.bindVertexArray(this.lvao);
   const lp=gl.getAttribLocation(this.lprog,'aPos'),lc=gl.getAttribLocation(this.lprog,'aCol');
   gl.bindBuffer(gl.ARRAY_BUFFER,this.lb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(p),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(lp);gl.vertexAttribPointer(lp,3,gl.FLOAT,false,0,0);
   gl.bindBuffer(gl.ARRAY_BUFFER,this.lc);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(c),gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(lc);gl.vertexAttribPointer(lc,4,gl.FLOAT,false,0,0);
   gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.LINES,0,p.length/3);gl.enable(gl.DEPTH_TEST);}}
 drawOverlay(){const x=this.ctx,d=this.dpr;x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,this.w,this.h);
  if(this.map&&this.map.stamp===this.stamp()&&this.mode==='armor'){const m=this.map,cs=m.cell;const cols=['','rgba(226,84,74,.42)','rgba(240,196,64,.48)','rgba(86,204,120,.46)','rgba(150,150,170,.35)'];
   for(let j=0;j<m.rows;j++)for(let i=0;i<m.cols;i++){const v=m.data[j*m.cols+i];if(v>0&&v<5){x.fillStyle=cols[v];x.fillRect(i*cs,j*cs,cs+.5,cs+.5);}}}
  if(this.marker){const [px,py]=this.marker.screen||this.project(this.marker.point);x.strokeStyle='#64e1ef';x.lineWidth=1.6;x.beginPath();x.arc(px,py,8,0,7);x.moveTo(px-15,py);x.lineTo(px-5,py);x.moveTo(px+5,py);x.lineTo(px+15,py);x.moveTo(px,py-15);x.lineTo(px,py-5);x.moveTo(px,py+5);x.lineTo(px,py+15);x.stroke();}
  for(const lab of this.labels||[]){const [px,py]=this.project(lab.p);x.font='600 11px "Segoe UI",system-ui,sans-serif';const w=x.measureText(lab.t).width+10,lx=Math.max(4,Math.min(px+6,this.w-w-4));x.fillStyle='rgba(16,19,26,.82)';x.fillRect(lx,py-18,w,17);x.fillStyle=lab.c||'#fff';x.fillText(lab.t,lx+5,py-6);}}
 stamp(){return [this.yaw.toFixed(4),this.pitch.toFixed(4),this.zoom.toFixed(4),this.target.map(v=>v.toFixed(3)).join(','),this.w,this.h].join('|');}
 bindInput(){const el=this.ov;let down=null,moved=false,pinch=null;
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);down={x:e.clientX,y:e.clientY,b:e.button,shift:e.shiftKey,yaw:this.yaw,pitch:this.pitch,t:this.target.slice()};moved=false;});
  el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();
   if(!down){this.emit('hover',e.clientX-r.left,e.clientY-r.top);return;}
   const dx=e.clientX-down.x,dy=e.clientY-down.y;if(Math.hypot(dx,dy)>4)moved=true;if(!moved)return;
   if(down.b===2||down.shift||down.b===1){const {r:rr,u}=this.basis(),s=this.zoom*2/this.h;this.target=V.add(V.add(down.t,V.mul(rr,-dx*s)),V.mul(u,dy*s));}
   else{this.yaw=down.yaw+dx*.008;this.pitch=Math.max(-1.45,Math.min(1.5,down.pitch+dy*.006));}
   this.draw();this.emit('view');});
  el.addEventListener('pointerup',e=>{const r=el.getBoundingClientRect();if(down&&!moved&&down.b===0)this.emit('shoot',e.clientX-r.left,e.clientY-r.top);down=null;});
  el.addEventListener('pointerleave',()=>this.emit('hover',null));
  el.addEventListener('wheel',e=>{e.preventDefault();this.zoom=Math.max(.3,Math.min(this.radius*3,this.zoom*Math.exp(e.deltaY*.0012)));this.draw();this.emit('view');},{passive:false});
  el.addEventListener('touchstart',e=>{if(e.touches.length===2){const [a,b]=e.touches;pinch={d:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),z:this.zoom};down=null;}},{passive:true});
  el.addEventListener('touchmove',e=>{if(pinch&&e.touches.length===2){const [a,b]=e.touches;this.zoom=Math.max(.3,pinch.z*pinch.d/Math.max(10,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)));this.draw();this.emit('view');}},{passive:true});
  el.addEventListener('touchend',()=>{pinch=null;},{passive:true});
  el.tabIndex=0;el.addEventListener('keydown',e=>{const k=e.key;if(k==='ArrowLeft')this.yaw-=.08;else if(k==='ArrowRight')this.yaw+=.08;else if(k==='ArrowUp')this.pitch=Math.min(1.5,this.pitch+.06);else if(k==='ArrowDown')this.pitch=Math.max(-1.45,this.pitch-.06);else if(k==='+'||k==='=')this.zoom*=.9;else if(k==='-')this.zoom/=.9;else return;e.preventDefault();this.draw();this.emit('view');});}
}
root.PAViewer=Viewer;root.PAViewer.MODULE_COLORS=MODULE_COLORS;root.PAViewer.XCATS=XCATS;root.PAViewer.XCAT_COLORS=XCAT_COLORS;root.PAViewer.xcatOf=xcatOf;root.PAViewer.thicknessColor=thicknessColor;
})(window);
