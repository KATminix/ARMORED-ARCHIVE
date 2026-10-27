/* Armored Archive protection-analysis engine (build 20261011-pa1).
   Rebuilds a War Thunder–style shot from the installed collision mesh plus pinned datamine physics.
   Rules tagged [doc] follow the live/static reads in WT_KNOWLEDGE_DOCS 06-ballistics-and-armor.md @88ae223
   and the game's own protectionMapTestParams dump; rules tagged [assume] are this project's choices where
   the native code is not decoded. Nothing here is claimed to be native-validated until a saved game shot
   (ReplayHits) is compared — see ARMOUR_MODEL.md. Runs in browser, worker and Node. */
(function(root){
'use strict';
const PA={version:'20261011-pa1'};
// ---------------------------------------------------------------- math
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]),norm=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l]},at=(o,d,t)=>[o[0]+d[0]*t,o[1]+d[1]*t,o[2]+d[2]*t];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,t)=>a+(b-a)*t,DEG=180/Math.PI;
function basis(d){const u=norm(cross(d,Math.abs(d[1])<.9?[0,1,0]:[1,0,0]));return [u,cross(d,u)];}
// blkx curve shapes: {p0:[x,y]}, {pnt:[[x,y]]}, {mod1:[x,y],mod3:[[x,y],[x,y]]}, [[x,y]...], or a dict mixing these.
function points(obj){const out=[];const push=v=>{if(Array.isArray(v)&&v.length===2&&typeof v[0]==='number')out.push(v);else if(Array.isArray(v))v.forEach(push);};
 if(Array.isArray(obj))push(obj);else if(obj&&typeof obj==='object')for(const v of Object.values(obj))push(v);return out.sort((a,b)=>a[0]-b[0]);}
function interp(p,x){if(!p.length)return NaN;if(x<=p[0][0])return p[0][1];for(let i=1;i<p.length;i++)if(x<=p[i][0]){const [a,b]=p[i-1],[c,d]=p[i];return c===a?d:b+(d-b)*(x-a)/(c-a);}return p[p.length-1][1];}
function curve4(c,x){if(!Array.isArray(c)||c.length<4)return 1;const t=c[1]===c[0]?1:clamp((x-c[0])/(c[1]-c[0]),0,1);return c[2]+(c[3]-c[2])*t;} // [doc] clamped linear map
// ---------------------------------------------------------------- seeded RNG
// The native RNG is not decoded [doc 3.2/3.6]; mulberry32 gives reproducible draws for one seed.
function makeRng(seed){let s=(seed>>>0)||0x9e3779b9,spare=null;
 const next=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
 return {seed:seed>>>0,nominal:false,next,normal(){if(spare!==null){const v=spare;spare=null;return v;}let u=0,v=0;while(u<=1e-12)u=next();v=next();const r=Math.sqrt(-2*Math.log(u));spare=r*Math.sin(2*Math.PI*v);return r*Math.cos(2*Math.PI*v);}};}
const NOMINAL={seed:null,nominal:true,next:()=>.5,normal:()=>0};
PA.makeRng=makeRng;PA.NOMINAL=NOMINAL;
// ---------------------------------------------------------------- geometry: flat triangle soup + BVH
function prepare(mesh,data){
 const nodes=mesh.nodes,N=nodes.length,classes=data?.armorClasses||{};
 let triCount=0;for(const n of nodes)triCount+=n.triangles.length;
 const A=new Float64Array(triCount*3),E1=new Float64Array(triCount*3),E2=new Float64Array(triCount*3),NRM=new Float64Array(triCount*3),owner=new Int32Array(triCount);
 const cmin=new Float64Array(triCount*3),cmax=new Float64Array(triCount*3);let k=0;
 const props=[];
 nodes.forEach((n,ni)=>{
  const p=n.part;let pp=null;
  if(p&&p.role&&p.role!=='excluded'&&!n.name.startsWith('cls_')){
   const full=classes[p.material]||{};pp={...full,...(p.classProperties||{}),...(p.properties||{})};
   pp.role=p.role;pp.category=p.category||null;pp.material=p.material;pp.name=n.name;pp.path=p.path;pp.ambiguous=!!p.ambiguous;
   pp.classAllowRicochet=(p.classProperties?.allowRicochet??full.allowRicochet);pp.classCreateShatters=(p.classProperties?.createSecondaryShatters??full.createSecondaryShatters);
  }
  props.push(pp);
  for(const t of n.triangles){const a=n.vertices[t[0]],b=n.vertices[t[1]],c=n.vertices[t[2]];
   for(let i=0;i<3;i++){A[k*3+i]=a[i];E1[k*3+i]=b[i]-a[i];E2[k*3+i]=c[i]-a[i];cmin[k*3+i]=Math.min(a[i],b[i],c[i]);cmax[k*3+i]=Math.max(a[i],b[i],c[i]);}
   const nn=norm(cross([E1[k*3],E1[k*3+1],E1[k*3+2]],[E2[k*3],E2[k*3+1],E2[k*3+2]]));NRM[k*3]=nn[0];NRM[k*3+1]=nn[1];NRM[k*3+2]=nn[2];owner[k]=ni;k++;}
 });
 // BVH (median split on the longest centroid axis, 4 triangles per leaf)
 const idx=new Int32Array(triCount);for(let i=0;i<triCount;i++)idx[i]=i;
 const bmin=[],bmax=[],left=[],right=[],start=[],count=[];
 function build(s,e){const id=bmin.length/3;let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],clo=[Infinity,Infinity,Infinity],chi=[-Infinity,-Infinity,-Infinity];
  for(let i=s;i<e;i++){const t=idx[i];for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],cmin[t*3+a]);hi[a]=Math.max(hi[a],cmax[t*3+a]);const c=(cmin[t*3+a]+cmax[t*3+a])/2;clo[a]=Math.min(clo[a],c);chi[a]=Math.max(chi[a],c);}}
  bmin.push(lo[0]-1e-7,lo[1]-1e-7,lo[2]-1e-7);bmax.push(hi[0]+1e-7,hi[1]+1e-7,hi[2]+1e-7);left.push(-1);right.push(-1);start.push(s);count.push(e-s);
  if(e-s<=4)return id;
  let ax=0;for(let a=1;a<3;a++)if(chi[a]-clo[a]>chi[ax]-clo[ax])ax=a;
  const sub=Array.from(idx.subarray(s,e)).sort((x,y)=>(cmin[x*3+ax]+cmax[x*3+ax])-(cmin[y*3+ax]+cmax[y*3+ax]));idx.set(sub,s);
  const m=(s+e)>>1;count[id]=0;left[id]=build(s,m);right[id]=build(m,e);return id;}
 if(triCount)build(0,triCount);
 const nameIndex=new Map(nodes.map((n,i)=>[n.name,i]));
 let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 nodes.forEach((n,i)=>{if(!props[i]||props[i].role!=='armor')return;for(const v of n.vertices)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],v[a]);hi[a]=Math.max(hi[a],v[a]);}});
 return {mesh,nodes,props,triCount,A,E1,E2,NRM,owner,idx,bmin:Float64Array.from(bmin),bmax:Float64Array.from(bmax),left:Int32Array.from(left),right:Int32Array.from(right),start:Int32Array.from(start),count:Int32Array.from(count),nameIndex,bounds:[lo,hi]};
}
PA.prepare=prepare;
// Active node mask: hidden optional equipment and dead parts are not armour-tested [doc 4.6 "Disabled parts"].
function makeMask(prep,hidden=[],dead=null){const m=new Uint8Array(prep.nodes.length);const h=new Set(hidden);
 prep.nodes.forEach((n,i)=>{m[i]=prep.props[i]&&!h.has(n.name)&&!(dead&&dead.has(n.name))?1:0;});return m;}
PA.makeMask=makeMask;
const STACK=new Int32Array(256);
function castAll(prep,o,d,mask,tmax=Infinity){
 const hits=[];if(!prep.triCount)return hits;const inv=[1/d[0],1/d[1],1/d[2]];let sp=0;STACK[sp++]=0;
 const {bmin,bmax,left,right,start,count,idx,A,E1,E2,NRM,owner}=prep;
 while(sp){const id=STACK[--sp];let t0=0,t1=tmax;
  for(let a=0;a<3;a++){let ta=(bmin[id*3+a]-o[a])*inv[a],tb=(bmax[id*3+a]-o[a])*inv[a];if(ta>tb){const x=ta;ta=tb;tb=x;}if(ta>t0)t0=ta;if(tb<t1)t1=tb;if(t0>t1)break;}
  if(t0>t1)continue;
  if(count[id]){for(let i=start[id],e=start[id]+count[id];i<e;i++){const t=idx[i],ni=owner[t];if(!mask[ni])continue;
    const e1x=E1[t*3],e1y=E1[t*3+1],e1z=E1[t*3+2],e2x=E2[t*3],e2y=E2[t*3+1],e2z=E2[t*3+2];
    const px=d[1]*e2z-d[2]*e2y,py=d[2]*e2x-d[0]*e2z,pz=d[0]*e2y-d[1]*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-12)continue;
    const tx=o[0]-A[t*3],ty=o[1]-A[t*3+1],tz=o[2]-A[t*3+2],u=(tx*px+ty*py+tz*pz)/det;if(u<-1e-9||u>1+1e-9)continue;
    const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<-1e-9||u+v>1+1e-9)continue;
    const dist=(e2x*qx+e2y*qy+e2z*qz)/det;if(dist<1e-6||dist>tmax)continue;
    const c=NRM[t*3]*d[0]+NRM[t*3+1]*d[1]+NRM[t*3+2]*d[2];hits.push({t:dist,node:ni,tri:t,cos:Math.abs(c),sign:c});}}
  else{STACK[sp++]=left[id];STACK[sp++]=right[id];}}
 return hits;
}
PA.castAll=castAll;
// Per-part segments: hits on one part sorted and paired entry/exit (closed collision shells).
function segments(prep,o,d,mask,tmax){
 const hits=castAll(prep,o,d,mask,tmax),by=new Map();for(const h of hits){if(!by.has(h.node))by.set(h.node,[]);by.get(h.node).push(h);}
 const segs=[];
 for(const [ni,hs] of by){hs.sort((a,b)=>a.t-b.t);const u=hs.filter((h,i)=>!i||h.t-hs[i-1].t>1e-5);
  for(let i=0;i<u.length;i+=2){const en=u[i],ex=u[i+1];const nrm=[prep.NRM[en.tri*3],prep.NRM[en.tri*3+1],prep.NRM[en.tri*3+2]];
   segs.push({node:ni,entry:en.t,exit:ex?ex.t:null,cos:en.cos,exitCos:ex?ex.cos:null,chord:ex?(ex.t-en.t)*1000:null,normal:en.sign>0?mul(nrm,-1):nrm});}}
 return segs.sort((a,b)=>a.entry-b.entry);
}
PA.segments=segments;
PA.pick=function(prep,o,d,mask){let best=null;for(const h of castAll(prep,o,d,mask))if(!best||h.t<best.t)best=h;return best?{t:best.t,node:best.node,point:at(o,d,best.t),name:prep.nodes[best.node].name}:null;};
// ---------------------------------------------------------------- classification
const INTERNAL=['crew','ammunition','powertrain','breech','fuel','equipment'];
const isInternal=pp=>!!pp&&(pp.role==='interior'||pp.role==='module'&&INTERNAL.includes(pp.category));
const isExternalArmor=pp=>!!pp&&pp.role==='armor'&&(/track|wheel|screen|skirt|fender|^ex_|era|antenna|box|_net|equipment/i.test(pp.name)||/screen|rubber|traks|wheels|ERA|textolite|wood/i.test(pp.material)&&!/nera/i.test(pp.material));
PA.isInternal=isInternal;PA.isExternalArmor=isExternalArmor;
// ---------------------------------------------------------------- ballistics
function impactSpeed(shell,range){const cal=shell.ballisticCaliber??shell.caliber;if(shell.isRocket)return shell.endSpeed??shell.maxSpeed??shell.speed??0;
 if(!(shell.Cx>=0&&shell.mass>0&&cal>0&&shell.speed>0))return shell.speed??0;return shell.speed*Math.exp(-1.225*shell.Cx*Math.PI*cal*cal/(8*shell.mass)*range);} // [doc 1]
function lanzOdermatt(shell,v){let A,B;
 if(Array.isArray(shell.lanzOdermattCachedMults))[A,B]=shell.lanzOdermattCachedMults;
 else{const L=shell.lanzOdermattWorkingLength,D=(shell.damageCaliber??shell.caliber)*1000,rho=shell.lanzOdermattDensity,mat=shell.lanzOdermattMaterial||'steel';
  if(!(L>0&&D>0&&rho>0))return null;const m=mat==='tungsten'?.994:mat==='depletedUranium'?.825:1.104;A=m*L*Math.sqrt(rho/7850)/Math.tanh(.0656*(L/D)+.283);
  const bhn=shell.lanzOdermattBrinellHardnessNumber;if(mat==='steel'&&!(bhn>0))return null;
  B=(mat==='tungsten'?-24965.201171875:mat==='depletedUranium'?-17660.76:bhn**-.2342*-73013.0625)/rho;}
 const p=A*Math.exp(B/(v/1000)**2);return Number.isFinite(p)&&p>0?{p,A,B}:null;} // [doc 2.2]
function deMarre(shell,v){const K=shell.kinetic_demarrePenetrationK;if(!(K>0))return null;
 const m=shell.damageMass??shell.mass,dc=(shell.damageCaliber??shell.caliber)*1000;
 const C=100*K*m**(shell.kinetic_demarreMassPow??.71)*(dc*.01)**-(shell.kinetic_demarreCaliberPow??1.07);
 let p=C*(v/1900)**(shell.kinetic_demarreSpeedPow??1.43);
 if(shell.explosiveMass>0&&shell.mass>0)p*=interp([[.0065,1],[.016,.93],[.02,.9],[.03,.85],[.04,.75]],shell.explosiveMass/shell.mass); // [doc 3.3] damagemodel penetrationByExplosiveMassModifier
 return {p,C};} // [doc 2.5]
function armorpowerTable(shell,range){const pts=Object.values(shell.armorpower||{}).filter(v=>Array.isArray(v)&&v.length===2).map(([p,r])=>[r,p]).sort((a,b)=>a[0]-b[0]);return pts.length?interp(pts,range):null;}
// Starting flat penetration. A reconstructed value is used only when it is within 3 % of the published table
// at the same range; otherwise the published Wiki value is kept and the source says so.
function startPenetration(shell,range,wikiP){
 const v=impactSpeed(shell,range);let rec=null,src='';
 if(shell.cumulativeDamage?.armorPower>0&&mechanismOf(shell)!=='kinetic'){rec=shell.cumulativeDamage.armorPower;src='datamine jet armorPower';
  return {p:rec,v,source:src+(wikiP>0&&Math.abs(rec/wikiP-1)>.03?' (Wiki lists '+wikiP.toFixed(0)+' mm)':''),reconstructed:rec};}
 if(shell.lanzOdermattWorkingLength||shell.lanzOdermattCachedMults){const lo=lanzOdermatt(shell,v);if(lo){rec=lo.p;src='Lanz–Odermatt + drag';}}
 else if(shell.kinetic_demarrePenetrationK){const dm=deMarre(shell,v);if(dm){rec=dm.p;src='De Marre + drag';}}
 if(rec===null){const t=armorpowerTable(shell,range);if(t!==null){rec=t;src='datamine armorpower table';}}
 if(wikiP>0&&(rec===null||Math.abs(rec/wikiP-1)>.03))return {p:wikiP,v,source:'published Wiki table'+(rec!==null?' (reconstruction '+rec.toFixed(0)+' mm differs >3 %)':''),reconstructed:rec};
 return {p:rec,v,source:src,reconstructed:rec};
}
PA.impactSpeed=impactSpeed;PA.lanzOdermatt=lanzOdermatt;PA.deMarre=deMarre;PA.startPenetration=startPenetration;
// ---------------------------------------------------------------- slope & ricochet tables
// [doc 2.8] node position cos(90°−key)=sin(key), value 1/S, linear in cos θ; caliberToArmor rows blended on 1/S.
function slopeRows(preset){return Object.values(preset||{}).filter(r=>r&&typeof r==='object'&&Number.isFinite(r.caliberToArmor)).map(r=>{const p=[];
 for(const [k,v] of Object.entries(r))if(k.startsWith('slopeEffect'))for(const q of Array.isArray(v[0])?v:[v])if(q[1]>=1)p.push([Math.sin(q[0]/DEG),1/q[1]]);
 p.sort((a,b)=>a[0]-b[0]);const mono=p.filter((q,i)=>!i||q[0]>p[i-1][0]);return [r.caliberToArmor,mono];}).sort((a,b)=>a[0]-b[0]);}
const slopeCache=new WeakMap();
function slopeS(preset,cos,ratio){if(!preset)return 1/Math.max(cos,1e-6);let rows=slopeCache.get(preset);if(!rows){rows=slopeRows(preset);slopeCache.set(preset,rows);}
 if(!rows.length)return 1/Math.max(cos,1e-6);const inv=rows.map(([c,p])=>[c,interp(p,cos)]);return 1/interp(inv,ratio);}
function ricochetCurve(row,cos){const p=[];for(const [k,v] of Object.entries(row))if(k.startsWith('ricochetProbability'))for(const q of Array.isArray(v[0])?v:[v])p.push([Math.sin(q[0]/DEG),q[1]]);return p.length?interp(p.sort((a,b)=>a[0]-b[0]),cos):null;}
PA.slopeS=slopeS;
// ---------------------------------------------------------------- per-part charge
function quality(pp,mech){
 if(mech==='tandemPrecharge')return pp.tandemPrechargeArmorQuality??pp.armorQuality??1; // [doc 3.3b] class without the key uses plain quality
 if(mech==='cumulative')return (pp.cumulativeArmorQuality??1)*(pp.armorQuality??1);
 if(mech==='explosiveFormedProjectile')return (pp.explosiveFormedProjectileArmorQuality??pp.cumulativeArmorQuality??1)*(pp.armorQuality??1);
 if(mech==='genericLongRod'&&pp.genericLongRodArmorQuality!==undefined)return pp.genericLongRodArmorQuality*(pp.armorQuality??1); // [assume] long-rod quality replaces generic
 return (pp.genericArmorQuality??1)*(pp.armorQuality??1);
}
const isERA=pp=>!!pp&&(/^ERA|_era_|era_m_|^era/i.test(pp.material||'')&&!/nera/i.test(pp.material||'')||pp.kineticProtectionEquivalent!==undefined||pp.cumulativeProtectionEquivalent!==undefined);
PA.isERA=isERA;
const meshCharged=pp=>(pp.armorThrough??1)<.1||!!pp.variableThickness||pp.material==='armor_tank_engine';
const thinModule=pp=>pp.role==='module'&&['crew','ammunition','equipment','optics'].includes(pp.category);
// Kinetic charge [doc 4.6]: plain q·T·S, mesh-charged q·chord·cosθ·S, thin modules q·T, caps after slope.
function kineticCharge(pp,e,shell,mech,data,eraModel){
 if(!pp||pp.ambiguous)return null;
 if(eraModel==='equivalent'&&mech!=='tandemPrecharge'&&isERA(pp)&&Number.isFinite(pp.kineticProtectionEquivalent)){const c=pp.kineticProtectionEquivalent;return {q:1,base:c,S:1,charge:c,cost:Math.max(c,pp.armorThrough??1),mesh:false,thin:false,through:pp.armorThrough??1,T:pp.armorThickness,era:'listed KE equivalent'};}const T=pp.armorThickness,cos=e.cos;if(!(T>0)||cos<1e-6)return null;
 const mc=meshCharged(pp);if(mc&&e.chord===null)return null;
 const q=quality(pp,mech),thin=thinModule(pp),base=mc?q*e.chord*cos:q*T;const g=data.globals;
 let S=1;
 if(!thin){const dcal=(shell.damageCaliber??shell.caliber)*1000;
  if(mech==='tandemPrecharge'||!shell.slopeEffectPreset)S=1/cos; // [doc 3.3b] precharge nominal·q/cos
  else{S=slopeS(data.presets.slopes[shell.slopeEffectPreset],cos,dcal/Math.max(base,1e-6));
   if((g.armorBreachK??7)*base<=dcal||Number.isFinite(pp.slopeMinCaliber)&&dcal<=pp.slopeMinCaliber)S=1/cos;} // [doc 2.11] breach & gate
  S=Math.min(S,g.maxArmorEffectiveScale??20);}
 let c=base*S;
 const capKey=mech==='genericLongRod'?(pp.genericLongRodEffectiveThicknessMax!==undefined?'genericLongRodEffectiveThicknessMax':'genericEffectiveThicknessMax'):mech==='tandemPrecharge'?'tandemPrechargeEffectiveThicknessMax':'genericEffectiveThicknessMax';
 for(const cap of [pp[capKey],pp.armorEffectiveThicknessMax])if(Number.isFinite(cap)&&cap>0)c=Math.min(c,cap);
 const through=pp.armorThrough??1;
 return {q,base,S,charge:c,cost:mc?c:Math.max(c,through),mesh:mc,thin,through,T};
}
// Jet charge [doc 3.4]: plates q·T/cos, mesh-charged q·chord (no cos, no slope), cumulativeByNormal (HESH) q·T.
function jetCharge(pp,e,shell,mech,eraModel){
 if(!pp||pp.ambiguous)return null;
 if(eraModel==='equivalent'&&isERA(pp)&&Number.isFinite(pp.cumulativeProtectionEquivalent)){const c=pp.cumulativeProtectionEquivalent;return {q:1,charge:c,cost:Math.max(c,pp.armorThrough??1),mesh:false,through:pp.armorThrough??1,T:pp.armorThickness,era:'listed CE equivalent'};}const T=pp.armorThickness;if(!(T>0)||e.cos<1e-6)return null;const mc=meshCharged(pp);if(mc&&e.chord===null)return null;
 const q=quality(pp,mech);let c=mc?q*e.chord:shell.cumulativeByNormal?q*T:q*T/e.cos;
 const capKey=mech==='explosiveFormedProjectile'?'explosiveFormedProjectileEffectiveThicknessMax':'cumulativeEffectiveThicknessMax';
 for(const cap of [pp[capKey],pp.armorEffectiveThicknessMax])if(Number.isFinite(cap)&&cap>0)c=Math.min(c,cap);
 const through=pp.armorThrough??1;return {q,charge:c,cost:Math.max(c,through),mesh:mc,through,T};
}
PA.kineticCharge=kineticCharge;PA.jetCharge=jetCharge;PA.quality=quality;
function ricochetProbability(pp,cos,shell,data,base){
 if(!pp||pp.role==='module')return 0;
 if(pp.classAllowRicochet===false||pp.classAllowRicochet===undefined&&pp.allowRicochet===false)return 0; // [doc 3.5] class false wins over group true
 if(pp.simpleRicochet){const ang=pp.ricochetAngle,pw=pp.ricochetCosinePower;if(!(ang>0&&pw>0))return 0;const ct=Math.cos(ang/DEG);return cos<ct?1-(cos/ct)**pw:0;}
 const preset=shell.ricochetPreset&&data.presets.ricochet[shell.ricochetPreset];if(!preset)return 0; // [doc 2.10] no preset never ricochets
 const rows=Object.values(preset).filter(r=>r&&typeof r==='object'&&Number.isFinite(r.caliberToArmor)).map(r=>[r.caliberToArmor,ricochetCurve(r,cos)]).filter(r=>r[1]!==null).sort((a,b)=>a[0]-b[0]);
 if(!rows.length){const c=ricochetCurve(preset,cos);return c===null?0:clamp(c,0,1);}
 return clamp(interp(rows,1000*shell.caliber/Math.max(base,1e-6)),0,1);
}
PA.ricochetProbability=ricochetProbability;
function yawFactor(shell,yaw){const p=points(shell.stability?.penetrationReduction);return p.length?interp(p,yaw):1;}
function yawRate(shell,base,charge,cos){const m=shell.stability?.slopeToOmega;if(!Array.isArray(m)||m.length!==4||!(charge>0)||m[1]<=m[0])return 0;
 const ang=Math.abs(Math.acos(clamp(base/charge,-1,1))-Math.acos(clamp(cos,0,1)))*DEG;return m[2]+clamp((ang-m[0])/(m[1]-m[0]),0,1)*(m[3]-m[2]);} // [doc 4.6]
// ---------------------------------------------------------------- volumetric (multiray) records
function patternFor(shell,data){
 if(shell.tracePattern?.circleCount>0)return {scale:shell.tracePattern.caliber,circles:shell.tracePattern.circleCount,points:shell.tracePattern.pointCount,src:'shell tracePattern'};
 const cal=shell.caliber*1000;let row=null;for(const r of Object.values(data.presets.traceStrategy||{}))if(cal>=r.minCaliber&&(!row||r.minCaliber>row.minCaliber))row=r;
 return row?{scale:cal,circles:row.circleCount,points:row.pointCount,src:'damage-model traceStrategy'}:null;
}
// [doc 3.2/4.6] ring i of circleCount at i/circleCount of the outer radius, ring i holds pointCount·i points; outer radius 0.0005·scale m.
// [assume] the scale is the explicit pattern calibre for sub-calibre rounds and the bore for full-calibre rows.
function rayOffsets(shell,data,volumetric){const p=volumetric?patternFor(shell,data):null;const out=[[0,0]];if(!p)return {offsets:out,radius:0,pattern:null};
 const R=.0005*p.scale;for(let ring=1;ring<=p.circles;ring++){const n=p.points*ring;for(let i=0;i<n;i++){const a=2*Math.PI*i/n,r=R*ring/p.circles;out.push([Math.cos(a)*r,Math.sin(a)*r]);}}
 return {offsets:out,radius:R,pattern:p};}
PA.rayOffsets=rayOffsets;
function kineticRecords(prep,origin,dir,shell,mask,data,volumetric){
 const {offsets,radius}=rayOffsets(shell,data,volumetric),[u,v]=basis(dir),nRays=offsets.length,g=data.globals;
 const perRay=offsets.map(([a,b])=>segments(prep,add(origin,add(mul(u,a),mul(v,b))),dir,mask));
 if(nRays===1)return perRay[0].map(s=>({entry:s.entry,exit:s.exit??s.entry,cos:s.cos,normal:s.normal,weight:1,entries:[{...s,weight:1,rays:1,chords:[s.chord]}],primary:s.node}));
 const cross=[];perRay.forEach((segs,r)=>segs.forEach(s=>cross.push({...s,ray:r})));cross.sort((a,b)=>a.entry-b.entry);
 const calmm=shell.caliber*1000,groups=[];let cur=[];
 for(const c of cross){if(cur.length){const prev=cur[cur.length-1],tan=Math.sqrt(Math.max(0,1-c.cos*c.cos))/Math.max(c.cos,1e-6);
   if(c.entry-prev.entry>.0006*calmm*clamp(tan,.1,10)){groups.push(cur);cur=[];}}cur.push(c);} // [doc 4.6] chain step
 if(cur.length)groups.push(cur);
 const records=[];
 for(const grp of groups){const by=new Map();
  for(const c of grp){let e=by.get(c.node);if(!e){e={node:c.node,rays:new Set(),entry:c.entry,exit:c.exit??c.entry,cos:0,chords:[],normal:c.normal,first:c};by.set(c.node,e);}
   e.rays.add(c.ray);e.entry=Math.min(e.entry,c.entry);e.exit=Math.max(e.exit,c.exit??c.entry);if(c.cos>e.cos){e.cos=c.cos;}e.chords.push(c.chord);if(c.ray===0)e.normal=c.normal;}
  const entries=[...by.values()].map(e=>({node:e.node,entry:e.entry,exit:e.exit,cos:e.cos,normal:e.normal,weight:Math.min(1,e.rays.size/nRays),rays:e.rays.size,
   chord:e.chords.some(c=>c===null)?null:e.chords.reduce((s,c)=>s+c,0)/e.chords.length,chords:e.chords})).sort((a,b)=>a.entry-b.entry);
  // [doc 4.6] a part owning every ray leaves the group as its own record
  const solo=entries.filter(e=>e.weight>=1),rest=entries.filter(e=>e.weight<1);
  for(const e of solo)records.push({entry:e.entry,exit:e.exit,cos:e.cos,normal:e.normal,weight:1,entries:[e],primary:e.node});
  if(rest.length){const heavy=rest.reduce((a,b)=>b.weight>a.weight?b:a);// [assume] a merged record takes the distance of its heaviest entry (the entry it copies or that dominates the mean)
  records.push({entry:heavy.entry,exit:heavy.exit,cos:Math.max(...rest.map(e=>e.cos)),normal:heavy.normal,weight:heavy.weight,entries:rest,primary:heavy.node,merged:true});}
 }
 records.sort((a,b)=>a.entry-b.entry);records.radius=radius;records.rays=nRays;return records;
}
PA.kineticRecords=kineticRecords;
// [doc 4.6] merge rule: entries need weight ≥ usedArmorOverlap and charge > 0; strongest > maxArmorOverlap is copied,
// otherwise any ≥ minArmorOverlap gives a weighted mean (max for armorThrough/caps), otherwise the heaviest is copied.
function mergeCharge(rec,prep,fn,data){const g=data.globals;
 const evald=rec.entries.map(e=>({e,pp:prep.props[e.node],c:fn(prep.props[e.node],{...e,cos:rec.entries.length>1?rec.cos:e.cos})}));
 if(evald.some(x=>x.c===null&&x.e.weight>=(g.usedArmorOverlap??.1)))return {unknown:evald.find(x=>x.c===null).pp};
 const counted=evald.filter(x=>x.c&&x.e.weight>=(g.usedArmorOverlap??.1)&&x.c.charge>0);
 if(!counted.length)return null;
 const heavy=counted.reduce((a,b)=>b.e.weight>a.e.weight?b:a);
 if(counted.length===1||heavy.e.weight>(g.maxArmorOverlap??.8))return {...heavy.c,pp:heavy.pp,node:heavy.e.node,rule:counted.length===1?'single':'copy strongest (>'+(g.maxArmorOverlap??.8)+')'};
 if(counted.some(x=>x.e.weight>=(g.minArmorOverlap??.3))){const W=counted.reduce((s,x)=>s+x.e.weight,0),wm=k=>counted.reduce((s,x)=>s+x.e.weight*x.c[k],0)/W;
  const charge=wm('charge'),through=Math.max(...counted.map(x=>x.c.through)),allMesh=counted.every(x=>x.c.mesh);
  return {...heavy.c,charge,base:wm('base'),S:wm('S'),through,cost:allMesh?charge:Math.max(charge,through),pp:heavy.pp,node:heavy.e.node,rule:'weighted mean of '+counted.length+' parts'};}
 return {...heavy.c,pp:heavy.pp,node:heavy.e.node,rule:'copy heaviest (<'+(g.minArmorOverlap??.3)+')'};
}
// ---------------------------------------------------------------- shot simulation
function mechanismOf(shell){const t=shell.bulletType||'';
 if(shell.cumulativeDamage&&/atgm|heat|rocket/.test(t))return shell.kineticDamage?.damageType==='tandemPrecharge'?'tandem':'heat';
 if(/hesh/.test(t)&&shell.cumulativeDamage)return 'hesh';
 if(/^he|frag|smoke|shrapnel|practice|grenade/.test(t)&&!/heat/.test(t))return 'he';
 if(/^(aam|sam)/.test(t))return 'he'; // anti-air missiles: blast-fragmentation warhead on contact
 if(shell.cumulativeDamage)return 'heat';return 'kinetic';}
PA.mechanismOf=mechanismOf;
function kineticDamageType(shell){return shell.kineticDamage?.damageType||shell.kinetic_damageType||'generic';}
function kineticEnergyDamage(data,mass,v){return interp(points(data.presets.kineticEnergyToDamage),.5*mass*v*v);}
function explosiveTNT(data,shell,kind){const t=data.presets.explosiveTypes?.[shell.explosiveType]||{};return (shell.explosiveMass||0)*(kind==='brisance'?(t.brisanceEquivalent??1):(t.strengthEquivalent??1));}
function sphereDir(axis,cosOuter,cosInner,rng,i,n){ // uniform in solid angle between the inner and outer cone [doc 3.2]
 let a,b;if(rng.nominal){const gold=Math.PI*(3-Math.sqrt(5));a=(i+.5)/n;b=(i*gold)/(2*Math.PI);}else{a=rng.next();b=rng.next();}
 const c=cosInner-(cosInner-cosOuter)*a,s=Math.sqrt(Math.max(0,1-c*c)),phi=2*Math.PI*b,[u,v]=basis(axis);
 return norm(add(mul(axis,c),add(mul(u,s*Math.cos(phi)),mul(v,s*Math.sin(phi)))));}
// Fragment flight [doc 3.2 "Fragment flight through parts"].
function traceFragment(ctx,origin,dir,range,penPair,dmgPair,scale,type,skipNode,shotMask){
 const segs=segments(ctx.prep,origin,dir,shotMask,range),hits=[];let used=0,stopT=null;
 for(const s of segs){if(s.node===skipNode&&s.entry<.002)continue;const pp=ctx.prep.props[s.node];
  const tf=s.entry/range,pen=lerp(penPair[1],penPair[0],clamp(tf,0,1))*scale.pen,rem=pen-used;if(rem<=0){stopT=s.entry;break;}
  let charge,cost;
  if(pp.role==='module'){charge=(pp.secondaryShatterArmorQuality??pp.genericArmorQuality??1)*(pp.armorThickness??0);const cap=pp.secondaryShatterEffectiveThicknessMax??pp.genericEffectiveThicknessMax;if(cap>0)charge=Math.min(charge,cap);cost=Math.max(charge,pp.armorThrough??1);}
  else{const q=type==='shatter'?(pp.shatterArmorQuality??pp.genericArmorQuality??1):(pp.secondaryShatterArmorQuality??pp.genericArmorQuality??1);
   charge=q*(pp.armorThickness??0)*Math.min(1/Math.max(s.cos,1e-6),ctx.data.globals.maxShatterEffectiveMult??3); // [assume] plate charge q·T·min(1/cos, maxShatterEffectiveMult)
   const cap=(type==='shatter'?pp.shatterEffectiveThicknessMax:pp.secondaryShatterEffectiveThicknessMax)??pp.armorEffectiveThicknessMax;if(cap>0)charge=Math.min(charge,cap);cost=Math.max(charge,pp.armorThrough??1);}
  if(pp.hp>0&&pp.role==='module'){const lo=penPair[1]*scale.pen,hi=penPair[0]*scale.pen;let d=Array.isArray(dmgPair)?(rem<=lo?dmgPair[0]:rem>=hi?dmgPair[1]:lerp(dmgPair[0],dmgPair[1],(rem-lo)/Math.max(hi-lo,1e-6))):dmgPair;
   d*=scale.dmg*(pp[type+'DamageMult']??1);if(rem<charge)d*=(pp.restrainDamage??0);if(d>0)hits.push({node:s.node,damage:d});}
  if(cost>rem){stopT=s.entry;break;}used+=cost;}
 return {origin,dir,range,stopT,hits};
}
function spallCone(ctx,rec,point,dir,arrival,cost,presetName,isJet,shotMask,out){
 const pp=ctx.prep.props[rec.primary],g=ctx.data.globals,preset=ctx.data.presets.shatters?.[presetName];
 if(!preset||!pp)return;if(pp.createSecondaryShatters===false||pp.classCreateShatters===false)return; // [doc 3.2]
 const residual=arrival-cost;if(residual<=0||cost<(g.armorFragmentsThicknessThreshold??3.3)||arrival>cost*(g.armorFragmentsPierceThreshold??90))return; // [doc 3.2] cone gates
 const dcal=(ctx.shell.damageCaliber??ctx.shell.caliber)*1000,massBased=!!preset.shellMassToShatterCount,cone={origin:point,dir,preset:presetName,residual,sections:[],fragments:[]};
 const shellTotal=massBased?curve4(preset.shellMassToShatterCount,ctx.shell.damageMass??ctx.shell.mass):0,armorTotal=massBased?curve4(preset.armorMassToShatterCount,24.19*((dcal/1000)**2)*cost):0;
 for(const [k,sec] of Object.entries(preset)){if(!k.startsWith('section')||!sec?.shatter)continue;const sh=sec.shatter;
  let count,ps,ds;
  if(massBased){const shellS=!!sh.shellShatter;count=Math.floor((shellS?shellTotal:armorTotal)*(sh.countPortion??0)+.5);
   ps=curve4(preset[shellS?'residualPenetrationToShellShatterPenetrationMult':'residualPenetrationToArmorShatterPenetrationMult'],residual);
   ds=curve4(preset[shellS?'residualPenetrationToShellShatterDamageMult':'residualPenetrationToArmorShatterDamageMult'],residual);}
  else{count=Math.round((sh.count??0)*curve4(preset.residualArmorPenetrationToShatterCountMult,residual)*(isJet?1:curve4(preset.caliberToArmorToShatterCountMult,dcal/Math.max(cost,1e-6))));
   ps=curve4(preset.residualArmorPenetrationToShatterPenetrationMult,residual);ds=curve4(preset.residualArmorPenetrationToShatterDamageMult,residual);}
  if(!(count>0))continue;
  const cO=Math.cos((sec.angles?.[1]??0)/DEG),cI=Math.cos((sec.angles?.[0]??0)/DEG),agg=sh.aggregateDamage!==false,sum=new Map();
  for(let i=0;i<count;i++){const d=sphereDir(dir,cO,cI,ctx.rng,i,count),f=traceFragment(ctx,point,d,sh.distance??3,sh.penetration||[0,0],sh.damage||[0,0],{pen:ps,dmg:ds},'secondaryShatter',rec.primary,shotMask);
   cone.fragments.push(f);for(const h of f.hits){if(agg)sum.set(h.node,(sum.get(h.node)||0)+h.damage);else out.messages.push({node:h.node,type:'secondaryShatter',damage:h.damage,source:'spall '+k,fire:sh.onHitChanceMultFire??1});}}
  for(const [n,d] of sum)out.messages.push({node:n,type:'secondaryShatter',damage:d,source:'spall '+k,fire:sh.onHitChanceMultFire??1});
  cone.sections.push({name:k,count,angles:sec.angles,distance:sh.distance,penetration:(sh.penetration||[]).map(x=>x*ps),damageScale:ds});
 }
 out.cones.push(cone);
}
// Warhead body fragments / APHE synthetic shatters approximated as rays [doc 3.2 "real shatters"].
function warheadFragments(ctx,point,dir,shotMask,out,synthetic){
 const sh=ctx.shell,classes=ctx.data.presets.shatterClasses;if(!(sh.explosiveMass>0)||!classes)return null;
 const m=explosiveTNT(ctx.data,sh,'brisance'),fill=m/sh.mass;let cls=null,cname='';for(const [k,c] of Object.entries(classes))if(c.fillingRatio>=fill){cls=c;cname=k;break;}
 if(!cls){const e=Object.entries(classes);[cname,cls]=e[e.length-1];}
 const R=interp(points(cls.explosiveMassToRadius),m),P=interp(points(cls.explosiveMassToPenetration),m),D=interp(points(cls.explosiveMassToDamage),m);
 let N=interp(points(cls.bodyMassToShattersCount),sh.mass-m);const segsDef=synthetic?null:sh.shatter?.segment;
 const bands=segsDef?(Array.isArray(segsDef)?segsDef:[segsDef]):[{angles:[0,180],countPortion:1,radiusScale:1,penetrationScale:1,damageScale:1}];
 if(!synthetic)N*=sh.shatter?.countPortion??1;
 const cap=ctx.opts.maxFragments??600,total=Math.min(Math.round(N),cap),scaleCount=N>0?total/N:0,sum=new Map(),frags=[];
 for(const b of bands){let a0=b.angles?.[0]??0,a1=b.angles?.[1]??180;if(a1>180){a0=360-a1;a1=360-(b.angles?.[0]??0);} // [doc] bands past 180° mirror
  const n=Math.round(N*(b.countPortion??1)*scaleCount);const cO=Math.cos(Math.max(a0,a1)/DEG),cI=Math.cos(Math.min(a0,a1)/DEG);
  for(let i=0;i<n;i++){const d=sphereDir(dir,cO,cI,ctx.rng,i,n),f=traceFragment(ctx,point,d,R*(b.radiusScale??1),[P*(b.penetrationScale??1),P*(b.penetrationScale??1)],D*(b.damageScale??1),{pen:1,dmg:1/Math.max(scaleCount,1e-6)},'shatter',-1,shotMask);
   frags.push(f);for(const h of f.hits)sum.set(h.node,(sum.get(h.node)||0)+h.damage);}}
 for(const [n,d] of sum)out.messages.push({node:n,type:'shatter',damage:d,source:synthetic?'APHE burst (statistical model approximated)':'warhead fragments'});
 return {point,class:cname,R,P,D,N:Math.round(N),traced:frags.length,fragments:frags};
}
function overpressure(ctx,point,out){
 const sh=ctx.shell,P=ctx.data.presets;if(!sh.pressureDamage||!(sh.explosiveMass>0)||!P.pressure)return null;
 const tnt=explosiveTNT(ctx.data,sh,'strength'),ds=ctx.prep.mesh.damageState||{},res=[];
 for(const [name,meta] of Object.entries(ds.MetaParts||{})){
  const eff=[].concat(meta.effect||[]),closed=eff.some(e=>e.pressure),open=eff.some(e=>e.pressureOpen);if(!closed&&!open)continue;
  const parts=new Set([].concat(meta.part||[]));const curves=open&&!closed?P.pressureOpen:P.pressure;
  // [doc 3.4b] closed compartments apply only when this burst's splash/fragments damaged one of their parts
  const triggered=open||out.messages.some(m=>(m.type==='shatter'||m.type==='explosion')&&parts.has(ctx.prep.nodes[m.node].name));
  const inner=interp(points(curves.explosiveMassToInnerRadius),tnt),outer=interp(points(curves.explosiveMassToOuterRadius),tnt),pen=interp(points(curves.explosiveMassToPenetration),tnt),dmg=interp(points(curves.explosiveMassToDamage),tnt);
  res.push({name,triggered,inner,outer,pen,dmg});if(!triggered)continue;
  for(const pn of parts){const ni=ctx.prep.nameIndex.get(pn);if(ni===undefined)continue;const pp=ctx.prep.props[ni];if(!pp||!(pp.pressureDamageMult>0))continue; // [doc] no pressureDamageMult → nothing
   const n=ctx.prep.nodes[ni];let c=[0,0,0];for(const v of n.vertices){c[0]+=v[0];c[1]+=v[1];c[2]+=v[2];}c=mul(c,1/n.vertices.length);const r=len(sub(c,point));if(r>=outer)continue;
   let d=r<=inner?dmg:dmg*(outer-r)/Math.max(outer-inner,1e-6);if(pen<(pp.armorThickness??0)*(pp.armorQuality??1)*(ctx.data.globals.splashPenetrationToArmorThreshold??.33))d=0;
   d*=pp.pressureDamageMult;if(d>0)out.messages.push({node:ni,type:'pressure',damage:d,source:'overpressure '+name});}}
 return {tnt,compartments:res};
}
function partLabel(prep,ni){const pp=prep.props[ni];return {name:prep.nodes[ni].name,role:pp?.role,category:pp?.category,material:pp?.material,hp:pp?.hp};}
// Kinetic flight through records with ricochet roll, charge, carry spread, yaw, spall, fuse [doc 2.10, 4.6, 3.1, 3.2].
function flyKinetic(ctx,origin,dir,P,mech,stage,hooks){
 const {prep,shell,data,rng,opts}=ctx,g=data.globals;let pen=P,rate=0,lastPierce=null,prevExit=null,o=origin,d=dir,ricochets=0;
 const path=[o];let armed=null,burstAt=null;
 for(let guard=0;guard<6;guard++){
  const records=kineticRecords(prep,o,d,shell,ctx.mask,data,opts.volumetric!==false),seg={from:o,dir:d,records:[]};stage.legs.push(seg);let restarted=false;
  for(const rec of records){
   if(rec.entry<1e-5)continue;
   if(burstAt!==null&&rec.entry>=burstAt){const p=at(o,d,burstAt);path.push(p);return {end:'burst',point:p,dir:d,pen,burstReason:'fuse delay in air'};}
   const ch=mergeCharge(rec,prep,(pp,e)=>kineticCharge(pp,e,shell,mech,data,opts.eraModel),data),point=at(o,d,rec.entry);
   const row={stage:stage.kind,...partLabel(prep,rec.primary),entry:rec.entry,exit:rec.exit,point,cos:rec.cos,angle:Math.acos(clamp(rec.cos,0,1))*DEG,weight:rec.weight,merged:rec.merged?rec.entries.map(e=>prep.nodes[e.node].name+' '+Math.round(e.weight*100)+'%'):null};
   if(ch&&ch.unknown){row.state='unresolved';row.note='open or unmapped geometry';seg.records.push(row);path.push(point);return {end:'unresolved',point,pen};}
   if(!ch){row.state='skip';row.note='zero-charge record';seg.records.push(row);continue;}
   const yaw=lastPierce!==null?Math.max(0,rec.entry-lastPierce)*rate:0,factor=yawFactor(shell,yaw);
   const spread=rng.nominal?1:1+(g.pierceDispersion??.05)*(rng.next()-.5); // [doc 4.6] ≈ ±2.5 % arrival spread
   const arrival=pen*factor*spread;Object.assign(row,{arrival,charge:ch.charge,cost:ch.cost,base:ch.base,S:ch.S,q:ch.q,mesh:ch.mesh,yaw,factor,rule:ch.rule,era:ch.era});
   // ricochet roll before the penetration test; skipped for modules and records ≤ 1 cm after the previous record [doc 2.10]
   let p=ricochetProbability(ch.pp,rec.cos,shell,data,ch.q*ch.T||ch.base);if(prevExit!==null&&rec.entry-prevExit<=.01)p=0;row.ricochet=p;
   if(p>0&&(rng.nominal?p>=.5:rng.next()<p)){
    row.state='ricochet';row.charge=ch.q*ch.T/Math.max(rec.cos,1e-6);seg.records.push(row);path.push(point);ricochets++;
    const modp=interp(points(data.presets.ricochetPenetrationModifier).map(([k,v])=>[Math.sin(k/DEG),v]).sort((a,b)=>a[0]-b[0]),rec.cos);
    pen=arrival*modp;rate=.25*Math.acos(clamp(rec.cos,0,1))*DEG;lastPierce=0; // [doc] ricochet rate 0.25·angle per metre
    let n=rec.normal;if(!rng.nominal){const j=g.ricochetNormalRandomMult??.01;n=norm(add(n,[j*(rng.next()*2-1),j*(rng.next()*2-1),j*(rng.next()*2-1)]));}
    const nd=norm(sub(d,mul(n,2*dot(d,n))));stage.ricochets.push({point,from:d,to:nd,probability:p,penAfter:pen});
    if(hooks.onRicochet&&hooks.onRicochet()===false)return {end:'ricochet',point,pen};
    if(ricochets>(opts.maxRicochets??2))return {end:'ricochet',point,pen};
    o=at(point,nd,2e-3);d=nd;prevExit=null;burstAt=burstAt===null?null:Math.max(0,burstAt-rec.entry);restarted=true;break;}
   if(hooks.beforeTest){const r=hooks.beforeTest(rec,ch,arrival,row,seg,o,d);if(r)return r;}
   if(arrival<=ch.cost){row.state='stopped';row.residual=arrival-ch.cost;seg.records.push(row);path.push(point);
    hooks.onModule?.(rec,ch,arrival,row);return {end:'stopped',point,pen:arrival-ch.cost,rec,row,dir:d};}
   row.state='perforated';row.residual=arrival-ch.cost;seg.records.push(row);
   hooks.onModule?.(rec,ch,arrival,row);
   const exitPt=at(o,d,rec.exit);if(opts.spall!==false&&hooks.spallPreset)spallCone(ctx,rec,exitPt,d,arrival,ch.cost,hooks.spallPreset,false,ctx.mask,ctx.out);
   pen=arrival-ch.cost;rate=yawRate(shell,ch.base,ch.charge,rec.cos);lastPierce=rec.entry;prevExit=rec.exit;
   if(hooks.fuse&&armed===null&&ch.charge>(shell.explodeTreshold??Infinity)){armed=rec.entry;burstAt=hooks.fuse(rec);row.armed=true;} // [doc 3.1] perforated part with charge > threshold arms
  }
  if(!restarted){const far=at(o,d,(seg.records.at(-1)?.exit??0)+.5);path.push(far);
   if(burstAt!==null)return {end:'burst',point:at(o,d,burstAt),dir:d,pen,burstReason:'fuse delay in air'};
   return {end:'exited',point:far,pen,dir:d};}
 }
 return {end:'exited',point:o,pen,dir:d};
}
// Jet [doc 3.4]: start armorPower·(1+d·u), traced for cumulativeDamage.distance, air loss entry-to-entry (exit for mesh-charged).
function flyJet(ctx,start,dir,burstPoint,stage){
 const {prep,shell,data,rng}=ctx,g=data.globals,cd=shell.cumulativeDamage,mech=cd.damageType==='explosiveFormedProjectile'?'explosiveFormedProjectile':'cumulative';
 const u=rng.nominal?0:clamp(rng.normal()*.3,-1,1),P0=cd.armorPower*(1+(g.cumulativePierceDispersion??.05)*u),L=cd.distance??0,air=cd.airArmorEquivalent??g.cumulativeAirArmor??100;
 const startOff=len(sub(start,burstPoint)),o=at(start,dir,-1e-4),segs=segments(prep,o,dir,ctx.mask,Math.max(0,L-startOff)+1e-4);
 let pen=P0,ref=null;const seg={from:start,dir,records:[],P0,L};stage.legs.push(seg);let endPt=at(start,dir,Math.max(0,L-startOff));let end='range';
 for(const s of segs){const pp=prep.props[s.node],point=at(o,dir,s.entry);if(startOff+s.entry>L){break;}
  const gap=ref===null?0:Math.max(0,s.entry-ref),loss=gap*air;const row={stage:'jet',...partLabel(prep,s.node),entry:s.entry+startOff,exit:(s.exit??s.entry)+startOff,point,cos:s.cos,angle:Math.acos(clamp(s.cos,0,1))*DEG,air:loss,weight:1};
  if(loss>pen){row.state='gap';row.arrival=pen-loss;seg.records.push(row);endPt=at(o,dir,ref+pen/air);end='gap';pen=0;break;}
  pen-=loss;const ch=jetCharge(pp,s,shell,mech,ctx.opts.eraModel);
  if(!ch){row.state='unresolved';seg.records.push(row);endPt=point;end='unresolved';break;}
  Object.assign(row,{arrival:pen,charge:ch.charge,cost:ch.cost,q:ch.q,mesh:ch.mesh,era:ch.era});
  if(pen<=ch.cost){row.state='stopped';row.residual=pen-ch.cost;seg.records.push(row);endPt=point;end='stopped';
   if(pp.role==='module'&&pp.hp>0)ctx.out.messages.push({node:s.node,type:mech,damage:(cd.damage??0)*(pp[mech+'DamageMult']??1)*(pp.restrainDamage??0),source:'jet (stopped)',fire:cd.onHitChanceMultFire});
   break;}
  row.state='perforated';row.residual=pen-ch.cost;seg.records.push(row);
  if(pp.hp>0&&(pp.role==='module'||/era/i.test(pp.material)&&!/nera/i.test(pp.material)))ctx.out.messages.push({node:s.node,type:mech,damage:(cd.damage??0)*(pp[mech+'DamageMult']??1),source:'jet',fire:cd.onHitChanceMultFire});
  const exitPt=at(o,dir,s.exit??s.entry);
  if(ctx.opts.spall!==false&&shell.cumulativeSecondaryShattersPreset)spallCone(ctx,{primary:s.node},exitPt,dir,pen,ch.cost,shell.cumulativeSecondaryShattersPreset,true,ctx.mask,ctx.out);
  pen-=ch.cost;ref=ch.mesh?(s.exit??s.entry):s.entry;}
 stage.path=[start,endPt];return {end,pen,P0,L,point:endPt};
}
// Main entry. ammo: {wikiP, type}; opts: {range, rng, volumetric, spall, damage, hidden, state, maxRicochets}
function shoot(prep,data,shell,origin,dir,opts={}){
 dir=norm(dir);const rng=opts.rng||NOMINAL,mech=mechanismOf(shell),dead=new Set(opts.state?.dead||[]);
 const mask=makeMask(prep,opts.hidden||[],dead),out={messages:[],cones:[]};
 const ctx={prep,data,shell,rng,opts,mask,out},res={mechanism:mech,stages:[],seed:rng.seed,out,warnings:[]};
 const start=startPenetration(shell,opts.range??10,opts.wikiP);res.P0=start.p;res.pSource=start.source;res.speed=start.v;
 const dmgType=kineticDamageType(shell);
 if(mech==='kinetic'){
  if(!(start.p>0)){res.unsupported='No starting penetration for this round';return finish(ctx,res);}
  const stage={kind:'shell',legs:[],ricochets:[]};res.stages.push(stage);const hasFuse=shell.explosiveMass>0&&shell.fuseDelayDist!==undefined;
  const mass=shell.damageMass??shell.mass;let speedNow=start.v;
  const r=flyKinetic(ctx,origin,dir,start.p,dmgType,stage,{spallPreset:shell.secondaryShattersPreset,
   fuse:hasFuse?rec=>rec.entry+shell.fuseDelayDist:null,
   onModule:(rec,ch,arrival,row)=>{const pp=ch.pp;if(!(pp.hp>0))return;if(pp.role!=='module'&&!(/era/i.test(pp.material)&&!/nera/i.test(pp.material)))return;
    const v=arrival>0&&start.p>0?speedNow*Math.pow(Math.max(arrival,0)/start.p,start.source.startsWith('De Marre')?1/1.43:.5):0; // [assume] speed from penetration ratio
    let dmg=kineticEnergyDamage(data,mass,v)*(pp.genericDamageMult??1);if(arrival<ch.charge)dmg*=pp.restrainDamage??0;
    if(dmg>0)out.messages.push({node:rec.primary,type:dmgType,damage:dmg,source:'shell'});}});
  res.end=r.end;res.endPoint=r.point;stage.path=collectPath(stage,origin,r.point);
  if(hasFuse&&(r.end==='burst'||r.end==='stopped'&&stage.legs.some(l=>l.records.some(x=>x.armed)))){
   const off=shell.explosive?.offset??data.globals.defaultExplosionOffset??.05,bp=r.end==='burst'?r.point:at(r.point,r.dir||dir,-off);
   res.burst={point:bp,reason:r.end==='burst'?'fuse delay':'stopped after arming',fragments:warheadFragments(ctx,bp,r.dir||dir,mask,out,true)};}
 }else if(mech==='heat'||mech==='tandem'){
  if(!(shell.cumulativeDamage?.armorPower>0)){res.unsupported='No jet data';return finish(ctx,res);}
  const bodyP=armorpowerTable(shell,opts.range??10)??5,bodyMech=mech==='tandem'?'tandemPrecharge':'generic';
  const stage={kind:mech==='tandem'?'precharge':'body',legs:[],ricochets:[]};res.stages.push(stage);
  const off=shell.explosive?.offset??data.globals.defaultExplosionOffset??.05;let fuseRec=null,jetStart=null,burst=null,fuseBurstAt=null;
  const r=flyKinetic(ctx,origin,dir,bodyP,bodyMech,stage,{
   beforeTest:(rec,ch,arrival,row,seg,o,d)=>{
    if(fuseRec===null&&ch.charge>(shell.explodeTreshold??.1)){fuseRec=rec;row.armed=true;
     if(arrival<=ch.cost){row.state='stopped';row.residual=arrival-ch.cost;seg.records.push(row);const p=at(o,d,rec.entry);burst=at(p,d,-off);jetStart=p;return {end:'fuse-stop',point:p,dir:d};}
     fuseBurstAt=rec.exit+(shell.fuseDelayDist??.05)+.01;return null;} // [doc 3.3b] burst fuseDelayDist + 0.01 m past the record end
    if(fuseRec!==null&&arrival<=ch.cost){row.state='stopped';row.residual=arrival-ch.cost;seg.records.push(row);const p=at(o,d,rec.entry);burst=at(p,d,-off);jetStart=p;return {end:'fuse-stop',point:p,dir:d};}
    if(fuseRec!==null&&rec.entry>=fuseBurstAt){const p=at(o,d,fuseBurstAt);burst=p;jetStart=p;return {end:'fuse-delay',point:p,dir:d};}
    return null;},
   onRicochet:()=>true});
  if(fuseRec!==null&&!burst&&fuseBurstAt!==null&&(r.end==='exited'||r.end==='burst')){const d=r.dir||dir;const p=at(stage.legs.at(-1).from,d,fuseBurstAt);burst=p;jetStart=p;}
  stage.path=collectPath(stage,origin,burst||r.point);res.end=r.end;
  if(!burst){res.end=r.end==='ricochet'?'ricochet':'no-fuse';res.note=r.end==='ricochet'?'Ricochet: no jet is formed [doc 3.4].':'The fuse was not armed by any record.';return finish(ctx,res);}
  const jd=r.dir||dir;res.burst={point:burst,reason:mech==='tandem'?'tandem main charge':'HEAT fuse'};
  const js={kind:'jet',legs:[]};res.stages.push(js);const jr=flyJet(ctx,jetStart,jd,burst,js);res.jet=jr;res.end=jr.end==='stopped'||jr.end==='gap'?'jet-stopped':'jet-'+jr.end;
  res.burst.fragments=warheadFragments(ctx,burst,jd,mask,out,false);res.burst.pressure=overpressure(ctx,burst,out);
 }else if(mech==='hesh'){
  const stage={kind:'body',legs:[],ricochets:[]};res.stages.push(stage);let hit=null;
  const r=flyKinetic(ctx,origin,dir,armorpowerTable(shell,opts.range??10)??5,'generic',stage,{beforeTest:(rec,ch,arrival,row,seg,o,d)=>{row.state='contact';seg.records.push(row);hit=at(o,d,rec.entry);return {end:'contact',point:hit,dir:d};},onRicochet:()=>true});
  stage.path=collectPath(stage,origin,r.point);
  if(hit){res.burst={point:hit,reason:'HESH contact'};const js={kind:'jet',legs:[]};res.stages.push(js);res.jet=flyJet(ctx,hit,r.dir||dir,hit,js);res.end=res.jet.end==='stopped'?'jet-stopped':'jet-'+res.jet.end;
   res.burst.fragments=warheadFragments(ctx,at(hit,r.dir||dir,-.05),r.dir||dir,mask,out,false);res.burst.pressure=overpressure(ctx,hit,out);}else res.end=r.end;
 }else{ // HE / smoke: contact burst, warhead fragments and overpressure; splash penetration breach check [assume]
  const stage={kind:'body',legs:[],ricochets:[]};res.stages.push(stage);let hit=null,hitRec=null,hitCh=null;
  const r=flyKinetic(ctx,origin,dir,armorpowerTable(shell,opts.range??10)??5,'generic',stage,{beforeTest:(rec,ch,arrival,row,seg,o,d)=>{row.state='contact';seg.records.push(row);hit=at(o,d,rec.entry);hitRec=rec;hitCh=ch;return {end:'contact',point:hit,dir:d};},onRicochet:()=>true});
  stage.path=collectPath(stage,origin,r.point);res.end=r.end;
  if(hit&&shell.explosiveMass>0){const off=shell.explosive?.offset??data.globals.defaultExplosionOffset??.05,bp=at(hit,r.dir||dir,-off);
   const tnt=explosiveTNT(data,shell,'strength'),splashPen=data.presets.splash?interp(points(data.presets.splash.explosiveMassToPenetration),tnt):0;
   const pp=prep.props[hitRec.primary],plate=(pp.explosionArmorQuality??pp.armorQuality??1)*(pp.armorThickness??0);
   res.burst={point:bp,reason:'contact fuse',splash:{penetration:splashPen,plate,breach:splashPen>plate}};
   res.burst.fragments=warheadFragments(ctx,bp,r.dir||dir,mask,out,false);
   if(splashPen>plate)out.messages.push({node:hitRec.primary,type:'explosion',damage:1,source:'splash breach'});
   res.burst.pressure=overpressure(ctx,bp,out);if(splashPen>plate){res.end='splash-breach';}}
 }
 return finish(ctx,res);
}
function collectPath(stage,origin,endPoint){const pts=[origin];for(const r of stage.ricochets)pts.push(r.point);pts.push(endPoint);return pts;}
function finish(ctx,res){
 const prep=ctx.prep,rows=res.stages.flatMap(s=>s.legs.flatMap(l=>l.records));res.rows=rows;
 const firstInternal=rows.find(r=>isInternal(prep.props[prep.nameIndex.get(r.name)])&&r.arrival>0&&r.state!=='ricochet');
 // Interior reached: a module hit by the shell/jet, or ≥0.1 m of free flight after the last perforated main-armour record [assume],
 // or spall/fragments damaging an internal module.
 let mainPerforated=false;
 for(const s of res.stages)for(const l of s.legs){const rr=l.records;for(let i=0;i<rr.length;i++){const r=rr[i];if(r.state!=='perforated'||r.role!=='armor'||isExternalArmor(prep.props[prep.nameIndex.get(r.name)]))continue;
  const next=rr.slice(i+1).find(x=>x.state!=='skip');if(!next||next.entry-(r.exit??r.entry)>=.1||next.state==='gap')mainPerforated=true;}}
 if(!mainPerforated&&res.out.messages.some(m=>m.type==='secondaryShatter'&&isInternal(prep.props[m.node])))mainPerforated=true;
 res.unresolved=rows.some(r=>r.state==='unresolved');res.ricochet=res.stages.some(s=>(s.ricochets||[]).length);
 res.penetrated=!!firstInternal||mainPerforated||res.end==='splash-breach';res.interior=firstInternal?{name:firstInternal.name,residual:firstInternal.arrival}:null;
 res.verdict=res.unsupported?'unsupported':res.unresolved?'unresolved':res.penetrated?'penetration':res.ricochet?'ricochet':'no-penetration';
 const stops=rows.filter(r=>r.state==='stopped');res.stoppedAt=stops.length?stops[stops.length-1].name:null;
 const exterior=rows.filter(r=>r.role==='armor'&&r.state!=='ricochet'&&r.cost!==undefined);res.armorCharged=exterior.reduce((s,r)=>s+(r.state==='perforated'?r.cost:Math.max(0,r.arrival??0)),0);
 if(ctx.opts.damage!==false)res.damage=resolveDamage(ctx,res);return res;
}
// ---------------------------------------------------------------- damage resolution [doc 3.5]
function effectRules(ds,name){const parts=[].concat(ds?.DamageEffects?.part||[]);const out=[];for(const p of parts){const names=[].concat(p.name||[]);if(names.includes(name))out.push(p);}return out;}
// damage_types.blkx inheritance (genericLongRod → generic, fireExplosion → explosion …); a rule list without the exact type
// falls back to the parent, and shatter ↔ secondaryShatter stand in for each other when a part lists only one [assume]
const DMG_PARENT={genericLongRod:'generic',genericFirearm:'generic',tandemPrecharge:'generic',snowball:'generic',fireExplosion:'explosion',explosiveFormedProjectile:'cumulative',napalm:'fire',hydroShock:'pressure'};
function typeMatches(rt,t){if(rt===undefined)return null;const list=[].concat(rt);return list.includes(t)||!!DMG_PARENT[t]&&list.includes(DMG_PARENT[t]);}
function typedRules(rules,t){const exact=rules.filter(x=>typeMatches(x.damageType,t));if(exact.length)return exact;
 const alt=t==='shatter'?'secondaryShatter':t==='secondaryShatter'?'shatter':null;return alt?rules.filter(x=>typeMatches(x.damageType,alt)):[];}
const EFFECT_KEYS=['expl','full_expl','fire','break','kill','destruction','break_fuse','cut'];
function resolveDamage(ctx,res){
 const {prep,rng}=ctx,ds=prep.mesh.damageState||{},state=ctx.opts.state||{},hp=new Map(Object.entries(state.hp||{})),dead=new Set(state.dead||[]);
 const effects=[],killed=[],damaged=new Map();const g=ctx.data.globals;
 const kill=(name,why)=>{if(dead.has(name))return;dead.add(name);hp.set(name,0);killed.push({name,why});};
 for(const m of res.out.messages){const name=prep.nodes[m.node].name,pp=prep.props[m.node];if(!pp||!(pp.hp>0)||dead.has(name))continue;
  const before=hp.has(name)?hp.get(name):1,frac=m.damage/pp.hp;const after=m.damage>=pp.hp?0:Math.max(0,before-Math.ceil(frac*65535)/65535); // [doc] 16-bit hp state
  hp.set(name,after);damaged.set(name,(damaged.get(name)||0)+m.damage);
  const rules=effectRules(ds,name);
  for(const r of rules){const onHit=[].concat(r.onHit||[]).filter(x=>x&&typeof x==='object');
   const typed=typedRules(onHit,m.type).sort((a,b)=>(b.damage??0)-(a.damage??0));
   let rule=typed.find(x=>(x.damage??0)<m.damage);if(!rule)rule=onHit.find(x=>x.damageType===undefined&&(x.damage??0)<m.damage);
   if(rule){const gate=clamp((1-after)/(g.partDamageEffectThreshold??.01),0,1);
    for(const k of EFFECT_KEYS)if(typeof rule[k]==='number'&&rule[k]>0){let p=rule[k]*gate;if(k==='fire'&&m.fire)p*=1;if(p>0&&(rng.nominal?p>=.5:rng.next()<p))effects.push({part:name,effect:k,p,cause:m.source,type:m.type});}}}
  if(after<=0){kill(name,m.source);
   for(const r of rules){let ok=r.onKill;if(Array.isArray(ok)){const list=ok.filter(x=>x&&typeof x==='object');ok=typedRules(list,m.type)[0]||list.find(x=>x.damageType===undefined);}if(!ok||typeof ok!=='object')continue;const w=Object.entries(ok).filter(([k,v])=>typeof v==='number'&&EFFECT_KEYS.includes(k));
    const tot=w.reduce((s,[,v])=>s+v,0);if(tot>0){let x=(rng.nominal?.5:rng.next())*Math.max(1,tot),pick=null;for(const [k,v] of w){if(x<v){pick=k;break;}x-=v;}if(pick)effects.push({part:name,effect:pick,p:ok[pick]/Math.max(1,tot),cause:'onKill',type:m.type});}
    for(const [k,v] of Object.entries(ok))if(/_dm$/.test(k)&&typeof v==='number'&&(rng.nominal?v>=.5:rng.next()<v))kill(k,'linked to '+name);
    if(ok.action?.kill&&ok.action.part)kill(ok.action.part,'linked to '+name);}}}
 // vehicle outcome
 const crewDef=ds.tank_crew||{},crewParts=Object.values(crewDef).filter(c=>c&&typeof c==='object'&&c.dmPart).map(c=>c.dmPart).filter(n=>prep.nameIndex.has(n));
 const crewDead=crewParts.filter(n=>dead.has(n)),minAlive=crewDef.minCrewMemberAliveCount??2;
 const stowages=[];for(const st of Object.values(ds.ammoStowages||{}))if(st&&typeof st==='object')for(const sh of [].concat(st.shells||[],st.charges||[]))if(sh&&typeof sh==='object')stowages.push({fatalFire:st.fatalFire,fatalExplosion:st.fatalExplosion,...sh});
 const stowageOf=n=>stowages.find(s=>s[n]!==undefined);let fatal=null;
 for(const e of effects){const pp=prep.props[prep.nameIndex.get(e.part)];if(pp?.category!=='ammunition')continue;const st=stowageOf(e.part);
  if(['expl','full_expl'].includes(e.effect)){if(ctx.opts.ammoLoaded===false)continue;if(!st||st.fatalExplosion!==false){fatal={kind:'ammo detonation',part:e.part};break;}e.blowout=true;}
  if(e.effect==='fire'&&st&&st.fatalFire===true&&!fatal)fatal={kind:'ammo fire (fatal)',part:e.part};}
 if(dead.has('body_dm')&&!fatal)fatal={kind:'hull destroyed',part:'body_dm'};
 const crewKO=crewParts.length>0&&crewParts.length-crewDead.length<minAlive;
 const crippled=['engine_dm','transmission_dm','cannon_breech_dm','gun_barrel_dm'].filter(n=>dead.has(n));
 const outcome=fatal?'destroyed':crewKO?'knocked out (crew)':killed.length?'damaged':damaged.size?'hit, no part killed':'no damage';
 return {outcome,fatal,crewKO,crewDead,crewTotal:crewParts.length,minAlive,killed,damaged:[...damaged].map(([n,d])=>({name:n,damage:d,hp:prep.props[prep.nameIndex.get(n)]?.hp})),effects,crippled,
  state:{dead:[...dead],hp:Object.fromEntries(hp)},assumptions:[ctx.opts.ammoLoaded===false?'ammunition racks empty':'every ammunition rack treated as loaded','native RNG not decoded; seeded mulberry32 draws']};
}
PA.shoot=shoot;
// ---------------------------------------------------------------- Monte Carlo over seeds
PA.monteCarlo=function(prep,data,shell,origin,dir,opts,n=64,seed=1){
 const tally={n,penetration:0,ricochet:0,noPen:0,unresolved:0,destroyed:0,crewKO:0,ammo:0,crewLost:0,parts:new Map(),outcomes:new Map()};
 for(let i=0;i<n;i++){const r=shoot(prep,data,shell,origin,dir,{...opts,rng:makeRng((seed+i*2654435761)>>>0)});
  if(r.verdict==='penetration')tally.penetration++;else if(r.verdict==='ricochet')tally.ricochet++;else if(r.verdict==='unresolved'||r.verdict==='unsupported')tally.unresolved++;else tally.noPen++;
  const d=r.damage;if(d){if(d.outcome==='destroyed')tally.destroyed++;if(d.crewKO)tally.crewKO++;if(d.fatal?.kind==='ammo detonation')tally.ammo++;tally.crewLost+=d.crewDead.length;
   tally.outcomes.set(d.outcome,(tally.outcomes.get(d.outcome)||0)+1);for(const k of d.killed)tally.parts.set(k.name,(tally.parts.get(k.name)||0)+1);}}
 return {...tally,parts:Object.fromEntries(tally.parts),outcomes:Object.fromEntries(tally.outcomes)};
};
// ---------------------------------------------------------------- protection-map cell (nominal, no damage)
PA.mapCell=function(prep,data,shell,origin,dir,opts){const r=shoot(prep,data,shell,origin,dir,{...opts,rng:NOMINAL,damage:false,spall:false,maxFragments:0});
 const hitAny=r.rows.length>0;if(!hitAny)return 0; // 0 none, 1 no pen, 2 possible, 3 penetration, 4 unresolved
 if(r.verdict==='unresolved'||r.verdict==='unsupported')return 4;
 const ric=r.rows.find(x=>x.ricochet>0);if(ric&&ric.ricochet>.1&&ric.ricochet<.9)return 2;
 if(r.verdict==='penetration'){const m=r.interior?.residual;return m!==undefined&&m<.05*(r.P0||1)?2:3;}
 const last=r.rows.filter(x=>x.state==='stopped').pop();if(last&&last.arrival>.9*last.cost)return 2;return 1;};
// ---------------------------------------------------------------- ReplayHits BLK (validation interchange) [doc 3.6]
PA.parseReplayHit=function(text){const g=(k,t)=>{const m=text.match(new RegExp('(?:^|\\n)\\s*'+k+':'+t+'\\s*=\\s*([^\\r\\n]+)'));return m?m[1].trim():null;};
 const str=k=>{const v=g(k,'t');return v===null?null:v.replace(/^"|"$/g,'');},num=k=>{const v=g(k,'[ri]');return v===null?null:parseFloat(v);},p3=k=>{const v=g(k,'p3');return v===null?null:v.split(',').map(Number);};
 const disabled=[...text.matchAll(/disabled:i\s*=\s*(\d+)/g)].map(m=>+m[1]),parts=[...text.matchAll(/part:ip3\s*=\s*([\d\s,]+)/g)].map(m=>m[1].split(',').map(Number));
 return {version:num('version'),object:str('object'),offenderObject:str('offenderObject'),weapon:str('weapon'),ammo:str('ammo'),ammoType:str('ammoType'),lPos:p3('lPos'),lDir:p3('lDir'),
  distance:num('distance'),shotDistance:num('shotDistance'),speed:num('speed'),seed:num('seed'),isSabot:/isSabot:b\s*=\s*yes/.test(text),disabled,parts};};
PA.writeReplayHit=function(h){const f=v=>Number(v).toFixed(6).replace(/\.?0+$/,'');
 return ['version:i=0','damageRole:t="victim"',`object:t="${h.object}"`,`offenderObject:t="${h.offenderObject}"`,`spawnerObject:t="${h.offenderObject}"`,`weapon:t="${h.weapon}"`,`ammo:t="${h.ammo}"`,`ammoType:t="${h.ammoType||''}"`,
  'bulletSetNo:i=0','ammoNo:i=0','isBelt:b=no','supportGun:b=no',`lPos:p3=${h.lPos.map(f).join(', ')}`,`lDir:p3=${h.lDir.map(f).join(', ')}`,`distance:r=${f(h.distance)}`,`shotDistance:r=${f(h.distance)}`,
  `seed:i=${h.seed>>>0}`,'isSabot:b=no','isSecond:b=no','testProperties:b=no',''].join('\r\n');};
// Native collision axis handedness: a DAE/OBJ export negates z [doc 3.6]; our assets are native-frame already.
PA.provenance={docs:'WT_KNOWLEDGE_DOCS 06-ballistics-and-armor.md @88ae223',datamine:'gszabi99/War-Thunder-Datamine @bdb4575 (2.59.0.62)',nativeDump:'protectionMapTestParams (installed client)'};
root.PAEngine=PA;if(typeof module!=='undefined')module.exports=PA;
})(typeof window!=='undefined'?window:typeof self!=='undefined'?self:globalThis);
