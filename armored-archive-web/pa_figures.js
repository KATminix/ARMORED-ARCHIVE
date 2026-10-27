/* Generic, app-drawn module figures fitted to each damage-model part's oriented box, plus armour feature edges.
   These are original stand-in shapes (no game render assets). Shots are always traced against the real
   damage-model geometry; the figures only make the X-ray view easier to read. */
(function(root){
'use strict';
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
// ---------------------------------------------------------------- oriented box by PCA (Jacobi eigen-decomposition)
function jacobi(A){const a=A.map(r=>r.slice()),v=[[1,0,0],[0,1,0],[0,0,1]];
 for(let it=0;it<40;it++){let p=0,q=1;for(const [i,j] of [[0,1],[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}
  if(Math.abs(a[p][q])<1e-12)break;const th=(a[q][q]-a[p][p])/(2*a[p][q]),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
  for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq;}
  for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk;}
  for(let k=0;k<3;k++){const vkp=v[k][p],vkq=v[k][q];v[k][p]=c*vkp-s*vkq;v[k][q]=s*vkp+c*vkq;}}
 return [0,1,2].map(i=>norm([v[0][i],v[1][i],v[2][i]]));}
function obb(vs){const n=vs.length,m=[0,0,0];for(const p of vs)for(let i=0;i<3;i++)m[i]+=p[i]/n;
 const C=[[0,0,0],[0,0,0],[0,0,0]];for(const p of vs){const d=sub(p,m);for(let i=0;i<3;i++)for(let j=0;j<3;j++)C[i][j]+=d[i]*d[j];}
 let axes=jacobi(C);
 // snap to world axes when the part is (nearly) axis-aligned: avoids wobbly frames for boxes
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 const fit=ax=>{const l=[Infinity,Infinity,Infinity],h=[-Infinity,-Infinity,-Infinity];for(const p of vs)for(let i=0;i<3;i++){const t=dot(p,ax[i]);l[i]=Math.min(l[i],t);h[i]=Math.max(h[i],t);}return {l,h,vol:(h[0]-l[0])*(h[1]-l[1])*(h[2]-l[2])};};
 const world=[[1,0,0],[0,1,0],[0,0,1]],fw=fit(world),fp=fit(axes);if(fw.vol<=fp.vol*1.08)axes=world;
 const f=axes===world?fw:fp;const center=[0,0,0];for(let i=0;i<3;i++){const mid=(f.l[i]+f.h[i])/2;for(let k=0;k<3;k++)center[k]+=axes[i][k]*mid;}
 return {center,axes,half:[0,1,2].map(i=>(f.h[i]-f.l[i])/2)};}
// frame helper: pick named local axes from an OBB
function frame(box,{up,fwd}={}){const idx=[0,1,2];let iu=null,ifw=null;
 if(up){iu=idx.reduce((b,i)=>Math.abs(dot(box.axes[i],up))>Math.abs(dot(box.axes[b],up))?i:b,0);}
 const rest=idx.filter(i=>i!==iu);if(fwd){ifw=rest.reduce((b,i)=>Math.abs(dot(box.axes[i],fwd))>Math.abs(dot(box.axes[b],fwd))?i:b,rest[0]);}
 const sign=(i,ref)=>dot(box.axes[i],ref)<0?-1:1;
 const U=iu===null?null:mul(box.axes[iu],sign(iu,up)),F=ifw===null?null:mul(box.axes[ifw],sign(ifw,fwd));
 return {U,F,S:U&&F?cross(F,U):null,hu:iu===null?0:box.half[iu],hf:ifw===null?0:box.half[ifw],hs:U&&F?box.half[idx.find(i=>i!==iu&&i!==ifw)]:0};}
// ---------------------------------------------------------------- primitive mesher (world space, smooth normals)
function Mesher(){const pos=[],nrm=[];
 const tri=(a,b,c,na,nb,nc)=>{pos.push(...a,...b,...c);nrm.push(...na,...nb,...nc);};
 // generic parametric surface: f(u,v) → [point, normal]
 function surf(f,nu,nv){for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const p=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>f(a/nu,b/nv));
   tri(p[0][0],p[1][0],p[2][0],p[0][1],p[1][1],p[2][1]);tri(p[0][0],p[2][0],p[3][0],p[0][1],p[2][1],p[3][1]);}}
 // frustum between centres a and b, radii ra/rb, with optional caps
 function frustum(a,b,ra,rb,seg=14,caps=true){const ax=norm(sub(b,a)),u=norm(cross(ax,Math.abs(ax[1])<.9?[0,1,0]:[1,0,0])),v=cross(ax,u),L=Math.hypot(...sub(b,a)),slope=(ra-rb)/Math.max(L,1e-6);
  surf((s,t)=>{const ang=s*2*Math.PI,r=ra+(rb-ra)*t,dir=add(mul(u,Math.cos(ang)),mul(v,Math.sin(ang)));return [add(add(a,mul(ax,L*t)),mul(dir,r)),norm(add(dir,mul(ax,slope)))];},seg,1);
  if(caps){for(const [c,r,nn] of [[a,ra,mul(ax,-1)],[b,rb,ax]]){if(r<=1e-5)continue;for(let i=0;i<seg;i++){const a0=i/seg*2*Math.PI,a1=(i+1)/seg*2*Math.PI;
    const p0=add(c,add(mul(u,Math.cos(a0)*r),mul(v,Math.sin(a0)*r))),p1=add(c,add(mul(u,Math.cos(a1)*r),mul(v,Math.sin(a1)*r)));tri(c,p0,p1,nn,nn,nn);}}}}
 function ellipsoid(c,ex,ey,ez,rx,ry,rz,seg=12){surf((s,t)=>{const th=s*2*Math.PI,ph=t*Math.PI,x=Math.sin(ph)*Math.cos(th),y=Math.cos(ph),z=Math.sin(ph)*Math.sin(th);
   return [add(c,add(add(mul(ex,x*rx),mul(ey,y*ry)),mul(ez,z*rz))),norm(add(add(mul(ex,x/rx),mul(ey,y/ry)),mul(ez,z/rz)))];},seg,Math.max(6,seg>>1));}
 // rounded box (superellipsoid, e→0 boxy)
 function roundBox(c,ex,ey,ez,hx,hy,hz,e=.22,seg=14){const sp=(w,m)=>Math.sign(w)*Math.pow(Math.abs(w),m);
  surf((s,t)=>{const th=s*2*Math.PI-Math.PI,ph=t*Math.PI-Math.PI/2,cp=Math.cos(ph),sph=Math.sin(ph),ct=Math.cos(th),st=Math.sin(th);
   const x=sp(cp,e)*sp(ct,e),y=sp(sph,e),z=sp(cp,e)*sp(st,e),nx=sp(cp,2-e)*sp(ct,2-e)/hx,ny=sp(sph,2-e)/hy,nz=sp(cp,2-e)*sp(st,2-e)/hz;
   return [add(c,add(add(mul(ex,x*hx),mul(ey,y*hy)),mul(ez,z*hz))),norm(add(add(mul(ex,nx),mul(ey,ny)),mul(ez,nz)))];},seg,Math.max(8,seg>>1));}
 return {pos,nrm,frustum,ellipsoid,roundBox};}
// ---------------------------------------------------------------- figures by module category
const Y=[0,1,0],X=[1,0,0];
function crew(m,box){const f=frame(box,{up:Y,fwd:X});const {U,F,S}=f;let {hu,hf,hs}=f;if(!U||hu<.12||hs<.06)return false;
 const base=sub(box.center,mul(U,hu)),P=(x,y,z)=>add(base,add(add(mul(F,x),mul(U,y)),mul(S,z))),H=2*hu;
 const rHead=Math.min(.105,H*.12,hs*.9),yHead=H-rHead*1.08,rT=Math.min(.17,hs*.8,hf*.75),tTop=yHead-rHead-.04,tBot=Math.max(.28*H,tTop-.55);
 m.ellipsoid(P(.02*hf,yHead,0),F,U,S,rHead*.92,rHead*1.08,rHead*.85);
 m.frustum(P(0,yHead-rHead*.9,0),P(0,tTop+.01,0),rHead*.38,rHead*.42,10);
 m.roundBox(P(-.05*hf,(tTop+tBot)/2,0),F,U,S,rT*.62,(tTop-tBot)/2,rT,.55,12); // torso
 m.roundBox(P(-.02*hf,tBot,0),F,U,S,rT*.7,Math.min(.08,H*.08),rT*.95,.6,10); // pelvis
 const hip=tBot,knee=Math.min(hf*.85,.42),rL=Math.min(.075,hs*.32);
 for(const z of [-rT*.5,rT*.5]){m.frustum(P(0,hip,z),P(knee,hip+.02,z),rL,rL*.85,10);m.frustum(P(knee,hip+.02,z),P(knee*.95,.05,z),rL*.8,rL*.62,10);m.roundBox(P(knee*.95+.05,.03,z),F,U,S,.08,.03,rL*.7,.5,8);}
 const sh=tTop-.04,rA=Math.min(.05,hs*.22);
 for(const z of [-(rT+rA*.6),rT+rA*.6]){const el=P(.22*hf,sh-.26,z*1.02),hand=P(Math.min(hf*.8,.4),sh-.2,z*.75);m.frustum(P(-.02*hf,sh,z),el,rA,rA*.85,8);m.frustum(el,hand,rA*.85,rA*.7,8);m.ellipsoid(hand,F,U,S,rA*.9,rA*.9,rA*.9,8);}
 return true;}
function ammo(m,box){const order=[0,1,2].sort((a,b)=>box.half[b]-box.half[a]),ax=box.axes[order[0]],L=box.half[order[0]],ha=box.half[order[1]],hb=box.half[order[2]];
 if(L<.03)return false;const nose=dot(ax,X)>=0?ax:mul(ax,-1),e1=box.axes[order[1]],e2=box.axes[order[2]];
 const k=Math.max(1,Math.min(8,Math.round(ha/Math.max(hb,1e-4)))),r=Math.min(hb,ha/k)*.9;
 for(let i=0;i<k;i++){const off=k===1?0:-ha+ha*(2*i+1)/k,c=add(box.center,mul(e1,off)),A=add(c,mul(nose,-L)),B=add(c,mul(nose,L));
  const P=t=>add(A,mul(nose,2*L*t));m.frustum(P(0),P(.02),r*.9,r,14,true);m.frustum(P(.02),P(.58),r,r*.94,14,false);m.frustum(P(.58),P(.62),r*.94,r*.82,14,false); // case and shoulder
  m.frustum(P(.62),P(.8),r*.82,r*.8,14,false);m.frustum(P(.8),P(1),r*.8,r*.08,14,true);} // projectile and ogive
 return true;}
function powertrain(m,box,name){const f=frame(box,{up:Y,fwd:X});const {U,F,S,hu,hf,hs}=f;if(!U)return false;
 m.roundBox(sub(box.center,mul(U,hu*.12)),F,U,S,hf*.96,hu*.86,hs*.96,.18,16);
 if(/transmission|gear/i.test(name)){m.frustum(add(box.center,mul(S,-hs*.98)),add(box.center,mul(S,hs*.98)),Math.min(hu,hf)*.62,Math.min(hu,hf)*.62,18);return true;}
 const n=Math.max(2,Math.min(8,Math.round((hf*2)/.18))),r=Math.min(.06,hf/n*.7,hs*.3); // cylinder heads on top
 for(const z of [-hs*.45,hs*.45])for(let i=0;i<n;i++){const x=-hf+hf*(2*i+1)/n,c=add(add(box.center,mul(F,x)),mul(S,z));m.frustum(add(c,mul(U,hu*.6)),add(c,mul(U,hu*.98)),r,r*.85,10);}
 return true;}
function along(m,box,rScale,taper=1){const order=[0,1,2].sort((a,b)=>box.half[b]-box.half[a]),ax=box.axes[order[0]],L=box.half[order[0]],r=Math.min(box.half[order[1]],box.half[order[2]])*rScale;
 if(r<=.003)return false;m.frustum(add(box.center,mul(ax,-L)),add(box.center,mul(ax,L)),r,r*taper,16);return {ax,L,r};}
function breech(m,box){const a=along(m,box,.78);if(!a)return false;const order=[0,1,2].sort((x,y)=>box.half[y]-box.half[x]);
 m.roundBox(add(box.center,mul(a.ax,dot(a.ax,X)>0?-a.L*.55:a.L*.55)),box.axes[order[0]],box.axes[order[1]],box.axes[order[2]],a.L*.42,box.half[order[1]]*.98,box.half[order[2]]*.98,.3,10);return true;}
function figure(node,pp){const vs=node.vertices;if(!vs||vs.length<4)return null;const box=obb(vs),m=Mesher();let ok=false;
 const c=pp.category,name=node.name;
 if(c==='crew')ok=crew(m,box);
 else if(c==='ammunition')ok=ammo(m,box);
 else if(c==='powertrain')ok=powertrain(m,box,name);
 else if(c==='breech')ok=breech(m,box);
 else if(c==='gun')ok=!!along(m,box,.86,.92);
 else if(c==='fuel'){const f=frame(box,{up:Y,fwd:X});if(f.U){m.roundBox(box.center,f.F,f.U,f.S,f.hf*.97,f.hu*.97,f.hs*.97,.35,16);ok=true;}}
 else if(c==='optics'||c==='equipment'){const f=frame(box,{up:Y,fwd:X});if(f.U){m.roundBox(box.center,f.F,f.U,f.S,f.hf*.95,f.hu*.95,f.hs*.95,.28,12);ok=true;}}
 if(!ok||!m.pos.length)return null;
 // keep every figure inside its damage-model part: rescale per OBB axis about the box centre where it overhangs
 const P=m.pos,ext=[0,0,0];for(let i=0;i<P.length;i+=3){const d=[P[i]-box.center[0],P[i+1]-box.center[1],P[i+2]-box.center[2]];for(let k=0;k<3;k++)ext[k]=Math.max(ext[k],Math.abs(dot(d,box.axes[k])));}
 const sc=ext.map((e,k)=>e>box.half[k]&&e>0?box.half[k]/e:1);
 if(sc.some(v=>v<1))for(let i=0;i<P.length;i+=3){const d=[P[i]-box.center[0],P[i+1]-box.center[1],P[i+2]-box.center[2]];let q=box.center.slice();
  for(let k=0;k<3;k++){const t=dot(d,box.axes[k])*sc[k];q=add(q,mul(box.axes[k],t));}P[i]=q[0];P[i+1]=q[1];P[i+2]=q[2];}
 return {pos:P,nrm:m.nrm};}
// ---------------------------------------------------------------- feature edges (crease > 28°, plus open borders)
function edges(node,crease=28){const key=p=>p.map(v=>Math.round(v*1e4)).join(','),idx=new Map(),P=[];const id=p=>{const k=key(p);if(!idx.has(k)){idx.set(k,P.length);P.push(p);}return idx.get(k);};
 const em=new Map(),cosC=Math.cos(crease*Math.PI/180);
 for(const t of node.triangles){const a=node.vertices[t[0]],b=node.vertices[t[1]],c=node.vertices[t[2]],n=norm(cross(sub(b,a),sub(c,a))),ids=[id(a),id(b),id(c)];
  for(const [i,j] of [[0,1],[1,2],[2,0]]){const u=Math.min(ids[i],ids[j]),w=Math.max(ids[i],ids[j]);if(u===w)continue;const k=u+'_'+w;if(!em.has(k))em.set(k,[u,w,[]]);em.get(k)[2].push(n);}}
 const out=[];for(const [u,w,ns] of em.values()){if(ns.length===1||ns.length>2||Math.abs(dot(ns[0],ns[1]))<cosC)out.push(P[u],P[w]);}return out;}
root.PAFigures={figure,edges,obb};if(typeof module!=='undefined')module.exports=root.PAFigures;
})(typeof window!=='undefined'?window:globalThis);
