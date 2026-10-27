/* Centre-ray reconstruction, not native volumetric Protection Analysis.
   Dagor collision geometry + pinned slope presets; provenance in ARMOUR_MODEL.md. */
(function(root){
 'use strict';
 const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const norm=a=>{const d=Math.hypot(...a);return a.map(v=>v/d)};
 function triangle(origin,dir,a,b,c){
  const e1=sub(b,a),e2=sub(c,a),p=cross(dir,e2),det=dot(e1,p);if(Math.abs(det)<1e-10)return null;
  const t=sub(origin,a),u=dot(t,p)/det;if(u< -1e-8||u>1+1e-8)return null;
  const q=cross(t,e1),v=dot(dir,q)/det;if(v< -1e-8||u+v>1+1e-8)return null;
  const distance=dot(e2,q)/det;if(distance<0)return null;
  return {distance,cos:Math.abs(dot(norm(cross(e1,e2)),dir))};
 }
 function trace(mesh,origin,direction,hidden=[],options={}){
  const dir=norm(direction),segments=[];
  for(const node of mesh.nodes){
   if(node.part?.role==='excluded'||node.name.startsWith('cls_')||hidden.includes(node.name))continue; // outside-world proxies/disabled parts are not armour
   if(!node.bounds){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of node.vertices)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],v[i]);hi[i]=Math.max(hi[i],v[i]);}node.bounds=[lo,hi];}
   let near=0,far=Infinity;for(let i=0;i<3;i++){
    const [lo,hi]=node.bounds;if(Math.abs(dir[i])<1e-12){if(origin[i]<lo[i]-1e-6||origin[i]>hi[i]+1e-6){far=-1;break;}continue;}
    const a=(lo[i]-origin[i])/dir[i],b=(hi[i]-origin[i])/dir[i];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
   }if(far<near)continue;
   const hits=node.triangles.map(t=>triangle(origin,dir,...t.map(i=>node.vertices[i]))).filter(Boolean).sort((a,b)=>a.distance-b.distance);
   const unique=hits.filter((h,i)=>!i||h.distance-hits[i-1].distance>1e-5);
   if(!unique.length)continue;
   for(let i=0;i<unique.length;i+=2){const entry=unique[i],exit=unique[i+1];segments.push({node,entry:entry.distance,exit:exit?.distance??null,cos:entry.cos,chord:exit?(exit.distance-entry.distance)*1000:null});}
  }
  segments.sort((a,b)=>a.entry-b.entry);
  if(options.fullPath)return segments;
  const interior=segments.find(s=>isInternal(s.node.part));
  return segments.filter(s=>!isInternal(s.node.part)&&(!interior||s.entry<interior.entry-1e-5));
 }
 function isInternal(part){return part?.role==='interior'||part?.role==='module'&&['crew','ammunition','powertrain','breech','fuel','equipment'].includes(part.category);}
 function interp(points,x){if(x<=points[0][0])return points[0][1];for(let i=1;i<points.length;i++)if(x<=points[i][0]){const [a,b]=points[i-1],[c,d]=points[i];return b+(d-b)*(x-a)/(c-a)}return points.at(-1)[1];}
 function slope(preset,cos,ratio=1){
  if(!preset)return null;
  const rows=Object.values(preset).filter(r=>r&&typeof r==='object'&&Number.isFinite(r.caliberToArmor)).map(r=>{
   const points=[];for(const [key,value] of Object.entries(r))if(key.startsWith('slopeEffect'))for(const p of Array.isArray(value[0])?value:[value])if(p[1]>=1)points.push([Math.sin(p[0]*Math.PI/180),1/p[1]]);
   points.sort((a,b)=>a[0]-b[0]);return [r.caliberToArmor,interp(points,cos)];
  }).sort((a,b)=>a[0]-b[0]);return rows.length?1/interp(rows,ratio):null;
 }
 const canonical=s=>String(s).toLowerCase().replace(/^\d+mm_/,'').replace(/[^a-z0-9]/g,'');
 function shell(ammo,data){
  const number=s=>parseFloat(String(s||'').replace(/,/g,''));
  const name=canonical(ammo.name),v=number(ammo.props?.['Muzzle Velocity']),cal=number(ammo.props?.Caliber)/1000;
  const candidates=data.shells.filter(s=>canonical(s.bulletName)===name&&Math.abs(s.caliber-cal)<.001&&Math.abs(s.speed-v)<=2);
  if(!candidates.length)return null;
  const signature=s=>JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k])=>k!=='sourceFile')));
  if(new Set(candidates.map(signature)).size!==1)return null; // same name is insufficient when stability/warhead data differ
  return candidates[0];
 }
 function charge(segment,kind,S=1){
  const part=segment.node.part;if(!part||part.ambiguous)return null;
  const p=part.properties,m=part.classProperties,t=p.armorThickness??m.armorThickness;
  if(!(t>0)||!Number.isFinite(t)||segment.cos<1e-6)return null;
  if(/era/i.test(part.material)&&!/nera/i.test(part.material))return null; // reactive/long-rod/tandem response is separate
  if(kind==='ke'&&(p.genericLongRodArmorQuality!==undefined||m.genericLongRodArmorQuality!==undefined))return null;
  const meshCharged=(p.armorThrough??m.armorThrough??1)<.1||p.variableThickness||part.material==='armor_tank_engine';
  if(meshCharged&&segment.chord===null)return null;
  const qKey=kind==='ce'?'cumulativeArmorQuality':'genericArmorQuality';
  // A per-part mechanism value overrides its class default; it is not multiplied twice.
  const q=(p[qKey]??m[qKey]??1)*(p.armorQuality??m.armorQuality??1);
  const thin=part.role==='module'&&['crew','ammunition','equipment','optics'].includes(part.category);
  const base=meshCharged?q*segment.chord*segment.cos:q*t;
  let c=kind==='ke'?base*(thin?1:S):base/segment.cos;
  const key=kind==='ke'?'genericEffectiveThicknessMax':'cumulativeEffectiveThicknessMax';
  for(const cap of [p[key]??m[key],p.armorEffectiveThicknessMax??m.armorEffectiveThicknessMax])if(Number.isFinite(cap)&&cap>0)c=Math.min(c,cap);
  return {base,charge:c,cost:meshCharged?c:Math.max(c,p.armorThrough??m.armorThrough??0),meshCharged,q,thin};
 }
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),deg=180/Math.PI;
 function yawFactor(raw,yaw){const points=raw?.stability?.penetrationReduction?.pnt;return Array.isArray(points)&&points.length?interp(points,yaw):1;}
 function yawRate(raw,base,charged,cos){
  const map=raw?.stability?.slopeToOmega;if(!Array.isArray(map)||map.length!==4||!(charged>0)||map[1]<=map[0])return 0;
  const angle=Math.abs(Math.acos(clamp(base/charged,-1,1))-Math.acos(clamp(cos,0,1)))*deg;
  return map[2]+clamp((angle-map[0])/(map[1]-map[0]),0,1)*(map[3]-map[2]);
 }
 function ricochet(segment,raw,data,c){
  const part=segment.node.part;if(!part||!c)return null;
  if(part.role==='module'||part.classProperties.allowRicochet===false||part.properties.allowRicochet===false)return 0;
  if(!raw?.ricochetPreset)return 0;
  const preset=data.ricochet?.[raw.ricochetPreset];if(!preset)return null;
  function curve(row){const points=[];for(const [k,v] of Object.entries(row))if(k.startsWith('ricochetProbability'))for(const p of Array.isArray(v[0])?v:[v])points.push([Math.sin(p[0]/deg),p[1]]);return points.length?interp(points.sort((a,b)=>a[0]-b[0]),segment.cos):null;}
  if(part.properties.simpleRicochet){const angle=part.properties.ricochetAngle??part.classProperties.ricochetAngle,power=part.properties.ricochetCosinePower??part.classProperties.ricochetCosinePower;if(!(angle>0&&power>0))return null;const ct=Math.cos(angle/deg);return segment.cos<ct?1-(segment.cos/ct)**power:0;}
  const rows=Object.values(preset).filter(r=>r&&Number.isFinite(r.caliberToArmor)).map(r=>[r.caliberToArmor,curve(r)]).sort((a,b)=>a[0]-b[0]);
  const t=part.properties.armorThickness??part.classProperties.armorThickness;
  return rows.length?interp(rows,raw.caliber*1000/(c.q*t)):curve(preset);
 }
 function lanzOdermatt(raw,range){
  if(!raw||!(raw.mass>0&&raw.Cx>=0&&raw.speed>0))return null;
  const caliber=raw.ballisticCaliber??raw.caliber;
  const velocity=raw.speed*Math.exp(-1.225*raw.Cx*Math.PI*caliber**2/(8*raw.mass)*range);
  let A,B;
  if(Array.isArray(raw.lanzOdermattCachedMults))[A,B]=raw.lanzOdermattCachedMults;
  else{
   const L=raw.lanzOdermattWorkingLength,D=raw.damageCaliber*1000,rho=raw.lanzOdermattDensity,mat=raw.lanzOdermattMaterial;
   if(!(L>0&&D>0&&rho>0)||!['tungsten','depletedUranium','steel'].includes(mat))return null;
   const mult=mat==='tungsten'?.994:mat==='depletedUranium'?.825:1.104;
   A=mult*L*Math.sqrt(rho/7850)/Math.tanh(.0656*(L/D)+.283);
   if(mat==='steel'&&!(raw.lanzOdermattBrinellHardnessNumber>0))return null; // no guessed 470 BHN
   B=(mat==='tungsten'?-24965.201171875:mat==='depletedUranium'?-17660.76:raw.lanzOdermattBrinellHardnessNumber**-.2342*-73013.0625)/rho;
  }
  const p=A*Math.exp(B/(velocity/1000)**2);return Number.isFinite(p)&&p>0?{p,velocity,A,B}:null;
 }
 function assess(zone,ammo,range,data){
  const kind=root.ArmorModel.mechanism(ammo),wikiP=root.CombatEngine.penetration(ammo,range,0,'wiki'),raw=shell(ammo,data),lo=lanzOdermatt(raw,range);
  const useLO=kind==='ke'&&lo&&wikiP>0&&Math.abs(lo.p/wikiP-1)<.03,P=useLO?lo.p:wikiP;
  const segments=zone.fullSegments||zone.segments||[],rows=[];let remaining=P,total=0,unknown=false,lastExit=segments[0]?.entry,previousPierce=null,rate=0,entered=false,entryResidual=null,ricochetRisk=false;
  if(!['ke','ce'].includes(kind)||P===null||kind==='ke'&&(!raw||ammo.type!=='APFSDS'))return {p:P,protection:{kind,min:null,max:null,unresolved:true},status:'MESH · UNSUPPORTED ROUND',cls:'warn',detail:'This centre-ray reconstruction needs an exact APFSDS slope preset or a simple HEAT jet. ERA/tandem, blast and other kinetic types retain separate models.'};
  for(const s of segments){
   const unitBase=charge(s,kind,1),damageCaliber=(raw?.damageCaliber??raw?.caliber)*1000;
   let S=kind==='ke'&&unitBase?slope(data.slopes[raw.slopeEffectPreset],s.cos,damageCaliber/unitBase.base):1;
   if(kind==='ke'&&unitBase){
    const gate=s.node.part.properties.slopeMinCaliber??s.node.part.classProperties.slopeMinCaliber;
    if((data.globals?.armorBreachK??7)*unitBase.base<=damageCaliber||Number.isFinite(gate)&&damageCaliber<=gate)S=1/s.cos;
    if(S!==null)S=Math.min(S,data.globals?.maxArmorEffectiveScale??20);
   }
   const c=S===null?null:charge(s,kind,S);
   const air=kind==='ce'?Math.max(0,s.entry-lastExit)*(raw?.airArmorEquivalent??data.globals?.cumulativeAirArmor??100):0;
   if(c===null){unknown=true;rows.push({...s,charge:null,arrival:remaining});break;}
   const yaw=kind==='ke'&&previousPierce!==null?Math.max(0,s.entry-previousPierce)*rate:0,factor=kind==='ke'?yawFactor(raw,yaw):1;
   const beforeYaw=remaining;remaining=remaining*factor-air;
   if(remaining<0){rows.push({...s,...c,air,arrival:0,residual:remaining,yaw,factor,gapStop:true});break;}
   if(isInternal(s.node.part)&&!entered){entered=true;entryResidual=remaining;}
   let bounce=kind==='ke'?ricochet(s,raw,data,c):null;
   if(previousPierce!==null&&s.entry-lastExit<=.01)bounce=0;
   if(bounce===null||bounce>0)ricochetRisk=true;
   if(!entered)total+=c.cost+air+(beforeYaw-beforeYaw*factor);
   const arrival=remaining;remaining-=c.cost;
   rows.push({...s,...c,air,arrival,residual:remaining,angle:Math.acos(s.cos)*180/Math.PI,S,yaw,factor,ricochet:bounce});
   lastExit=s.exit??s.entry;
   if(kind==='ce')lastExit=c.meshCharged?(s.exit??s.entry):s.entry;
   if(remaining<0)break;
   rate=yawRate(raw,c.base,c.charge,s.cos);previousPierce=s.entry;
  }
  const stop=remaining<0,margin=Math.abs(remaining),band=(P||0)*.1;
  const status=!segments.length?'MESH · NO ARMOUR HIT':unknown?'MESH · PARTIAL PATH':ricochetRisk?'MESH · RICOCHET / FUZE UNRESOLVED':entered?'MESH ESTIMATE · INTERIOR REACHED':margin<=band?'MESH · BORDERLINE':stop?'MESH ESTIMATE · STOPS':'MESH ESTIMATE · PERFORATES';
  return {p:P,rows,remaining,entered,entryResidual,ricochetRisk,raw,ballistics:useLO?'Lanz–Odermatt + drag':'Published Wiki flat penetration',protection:{kind,min:unknown?null:total,max:unknown?null:total,unresolved:unknown},status,cls:unknown||ricochetRisk||!segments.length||!entered&&margin<=band?'warn':entered?'bad':stop?'ok':'bad',detail:'Extracted collision path through armour and modules; '+(useLO?'Lanz–Odermatt and drag; ':'published flat penetration; ')+(kind==='ke'?raw.slopeEffectPreset+' with per-part yaw loss and ricochet probability. ':'conditional HEAT jet with measured gaps. ')+'Module intersections are not kill predictions. ERA/tandem state changes, native volumetric merging, fuze/spall and seeded damage are not validated; the result remains a reconstruction.'};
 }
 function aim(mesh,surface){
  const candidates=mesh.nodes.filter(n=>n.part?.role==='armor'&&n.vertices.length&&new RegExp(surface==='turret'?'turret_04_front|turret_front|gun_mask':surface==='side'?'body_side':surface==='rear'?'body_back':'body_front').test(n.name));
  const n=candidates.find(n=>n.name==='turret_04_front_dm')||candidates[0]||mesh.nodes.find(n=>n.part?.role==='armor');
  const lo=[0,1,2].map(i=>Math.min(...n.vertices.map(v=>v[i]))),hi=[0,1,2].map(i=>Math.max(...n.vertices.map(v=>v[i])));
  return {x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:(lo[2]+hi[2])/2};
 }
 // A deterministic footprint diagnostic, NOT the native volumetric combiner.
 // Ring placement and calibre units are explicit reconstruction assumptions.
 function footprint(mesh,origin,direction,hidden,raw){
  const p=raw?.tracePattern;if(!p||!(p.caliber>0&&p.circleCount>0&&p.pointCount>0))return null;
  const dir=norm(direction),u=norm(cross(dir,Math.abs(dir[1])<.9?[0,1,0]:[1,0,0])),v=cross(dir,u),radius=p.caliber*.0005;
  const offsets=[[0,0]],circles=Math.min(3,Math.floor(p.circleCount)),points=Math.min(12,Math.floor(p.pointCount));
  for(let ring=1;ring<=circles;ring++)for(let i=0;i<points*ring;i++){const a=i*2*Math.PI/(points*ring),r=radius*ring/circles;offsets.push([Math.cos(a)*r,Math.sin(a)*r]);}
  return {radius,assumed:true,samples:offsets.map(offset=>{const start=origin.map((x,i)=>x+u[i]*offset[0]+v[i]*offset[1]);return {offset,segments:trace(mesh,start,dir,hidden,{fullPath:true})};})};
 }
 root.MeshArmor={triangle,trace,slope,shell,charge,lanzOdermatt,assess,aim,isInternal,yawFactor,yawRate,ricochet,footprint};if(typeof module!=='undefined')module.exports=root.MeshArmor;
})(typeof window!=='undefined'?window:globalThis);
