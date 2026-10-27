/* Reference/component estimates. Collision-mesh shots are handled by pa_engine.js / pa_ui.js. */
(function(root){
 'use strict';
 const developer='https://warthunder.com/de/news/6052-dev-blog-antworten-auf-eure-fragen-zu-spall-linern-mbts-und-flugzeugen-de';
 const wiki7='https://wiki.warthunder.com/5600-leopard-2a7v-punchy-fast-deadly';
 function mechanism(a){const t=a.type||'';if(/HESH|Smoke|HE(?:-|$)|Rocket HE|HEFI|HEI/.test(t)&&!/(AP|HEAT|ATGM|API)/.test(t))return 'special';if(/HEAT|ATGM/.test(t))return /tandem/i.test(t+' '+a.description+' '+a.kind+' '+JSON.stringify(a.props||{}))?'tandem':'ce';return 'ke';}
 const pick=(m,path)=>m?.parts[path];
 function layer(m,path,label){const p=pick(m,path);return p?{...p,label:label||p.label}:null;}
 function make(id,label,layers,extra={}){return {id,label,layers:layers.filter(Boolean),...extra,...(layers.some(l=>!l)?{unresolved:true,missingLayer:true}:{})};}
 function zones(unit,surface,data){
  const m=data.models[unit.id],parts=m?.parts||{},id=unit.id;
  const t=surface==='turret'?unit.armor.turret[0]:unit.armor.hull[{front:0,side:1,rear:2}[surface]];
  const baseline=make('summary','Wiki summary plate · layers excluded',[{label:'Summary steel plate',armorThickness:t,material:'RHA_tank',materialProps:{}}],{summary:true});
  let out=[];
  if(id==='germ_leopard_2a7v'&&surface==='turret')out.push(make('cheek','Turret cheek · intact frontal package',[
   layer(m,'heavy_turret_frontal_screens/ex_armor_l_17_dm','External cheek module'),layer(m,'turret_composite_armor/turret_04_front_dm','Internal composite / NERA array'),layer(m,'hull/turret_front_dm','Steel shell')],{
   reference:{ke:{min:600,max:null,types:['APFSDS'],source:developer,label:'Gaijin frontal protection map · 600 mm APFSDS threshold (22 Dec 2023)'},angle:0},inventory:true,
   note:'The dark turret cheeks in Gaijin’s frontal map resist the 600 mm APFSDS threat. This is a sourced lower threshold, not an exact RHAe measurement or a 1,000 mm claim. The component list is an inventory, not a recovered mesh ray.'}));
  if(id==='germ_leopard_2a7v'&&surface==='front')out.push(make('ufp','Upper frontal hull · intact package',[
   layer(m,'heavy_ufp_screens/ex_armor_body_01_dm','Hull add-on module'),layer(m,'hull_front_composite_armor/body_front_dm','Internal composite array')],{
   reference:{ke:{min:580,max:580,types:['APFSDS'],source:wiki7,label:'War Thunder Wiki author’s approximate UFP example'},ce:{min:1200,max:1200,source:wiki7,label:'War Thunder Wiki author’s approximate UFP example'},angle:0,uncertainty:.15},inventory:true,
   note:'Published frontal example: about 580 mm against KE and 1,200 mm against HEAT. The ±15% band is this site’s estimate uncertainty, not game dispersion. Hit location and ammunition change the effective value.'}));
  // Steel spaced paths: actual air-gap lengths are not supplied by BLK scalars.
  if(id==='germ_marder_1a3'){
   if(surface==='front')out.push(make('spaced-front','Hull front · steel add-on + base plate',[layer(m,'additional_armor/superstructure_front_dm','32 mm add-on steel'),layer(m,'hull_RHA/body_front_dm','32 mm base steel')],{estimate:true,uncertainty:.15,note:'Representative two-plate path, assuming the projectile crosses both plates at the selected obliquity. No invented air gap or shatter bonus is added.'}));
   if(surface==='side')out.push(make('spaced-side','Hull side · steel add-on + base plate',[layer(m,'additional_armor/superstructure_side_dm','8 mm add-on steel'),layer(m,'hull_RHA/body_side_dm','15 mm base steel')],{estimate:true,uncertainty:.15,note:'Representative covered side path. An uncovered section does not receive this add-on.'}));
  }
  if(/^germ_schutzenpanzer_puma/.test(id)&&surface==='side'){
   const era=Object.keys(parts).find(p=>p.startsWith('era_side_box/'));
   const nera=Object.keys(parts).find(p=>p.startsWith('nera_shields/')&&parts[p].armorThickness>1);
   if(era)out.push(make('era-side','Hull side · intact ERA tile + base plate',[layer(m,era,'CLARA ERA tile'),layer(m,'RHAHH_hull/body_side_dm','Base hull steel')],{estimate:true,uncertainty:.15,note:'Representative ERA-covered path. The tile uses explicit datamined KE/chemical equivalents, not its 50 mm physical thickness. A tandem jet has no reliable tile verdict without a tandem response value.'}));
   if(nera)out.push(make('nera-side','Hull side · NERA screen + base plate',[layer(m,nera,'NERA screen'),layer(m,'RHAHH_hull/body_side_dm','Base hull steel')],{unresolved:true,note:'NERA thickness caps and mechanism-specific modifiers are shown. Its directional response and mesh path are unresolved; no whole-path penetration verdict is invented.'}));
  }
  if(m?.advanced&&!out.length)out.push(make('full-path','Full armour path · geometry unverified',[],{unresolved:true,note:'This vehicle has composite, spaced or add-on components. The Wiki summary is insufficient for a full-path verdict. Select a datamined component below to inspect its material data; those components are not a complete hit path.'}));
  if(!m?.advanced&&!out.length)out.push(baseline);
  // Explicitly separate weak steel regions from the strong frontal reference.
  const matching=Object.values(parts).filter(p=>{
   const name=p.id.split('/').at(-1);return surface==='turret'?/^gun_mask.*_dm$/.test(name):surface==='front'?/^(body|superstructure).*front_dm$/.test(name):surface==='side'?/^body_side_dm$/.test(name):/^body_back_dm$/.test(name);
  });
  for(const p of matching){
   const complex=/nera|composite|special|era|spaced|grille/.test(p.material+' '+p.id)||p.variableThickness;
   out.push(make('part:'+p.id,(surface==='turret'?'Mantlet':'Armour component')+' · '+p.label,[p],{component:true,unresolved:complex,note:'Isolated datamined component. Adjacent arrays and backing layers are excluded; this is not a whole-vehicle verdict.'}));
  }
  if(m?.advanced){
   const candidates=Object.values(parts).filter(p=>/nera|composite|era_|spaced|special_armor/.test(p.material+' '+p.id)&&((surface==='turret')?/turret|mask/.test(p.id):surface==='front'?/hull_front|ufp|body_front/.test(p.id):surface==='side'?/side|body_screens|nera_shields|era_side/.test(p.id):/back/.test(p.id)));
   for(const p of candidates.slice(0,16))if(!out.some(z=>z.id==='part:'+p.id))out.push(make('part:'+p.id,'Layer only · '+p.label,[p],{component:true,unresolved:true,note:'Component inventory only. Its scalar modifier does not establish complete protection through the collision mesh.'}));
  }
  if(!out.length)return [baseline];
  if(!out.some(z=>z.id==='summary'))out.push(baseline);return out;
 }
 function contribution(layer,kind,angle=0,spent=false,longRod=false){
  if(!Number.isFinite(layer.armorThickness)||layer.armorThickness<=0)return null;
  const mat=layer.materialProps||{},isERA=/era/.test(layer.material+' '+layer.id)&&!/nera/.test(layer.material+' '+layer.id);
  if(isERA&&spent)return 0;
  if(longRod&&(layer.genericLongRodArmorQuality!==undefined||mat.genericLongRodArmorQuality!==undefined))return null;
  const eq=kind==='ke'?'kineticProtectionEquivalent':kind==='tandem'?'tandemProtectionEquivalent':'cumulativeProtectionEquivalent';
  if(Number.isFinite(layer[eq]))return layer[eq];
  if(isERA&&kind==='tandem')return null;
  if(layer.material==='spaced_armor_air')return kind==='ke'?0:layer.armorThickness*.1/Math.cos(angle*Math.PI/180);
  const quality=kind==='ke'?'genericArmorQuality':kind==='tandem'?'tandemArmorQuality':'cumulativeArmorQuality';
  if(kind==='tandem'&&/nera|composite|special/.test(layer.material)&&layer[quality]===undefined)return null;
  const effectiveQ=layer[quality]??mat[quality]??1,steelQ=layer.armorQuality??mat.armorQuality??1;
  let value=layer.armorThickness/Math.cos(angle*Math.PI/180)*effectiveQ*steelQ;
  const cap=kind==='ke'?layer.genericEffectiveThicknessMax:layer.cumulativeEffectiveThicknessMax;
  if(Number.isFinite(cap))value=Math.min(value,cap);if(Number.isFinite(layer.armorEffectiveThicknessMax))value=Math.min(value,layer.armorEffectiveThicknessMax);
  return value;
 }
 function protection(zone,ammo,angle,spent=false){
  spent=spent&&zone.layers.some(l=>/era/.test(l.material+' '+l.id)&&!/nera/.test(l.material+' '+l.id));
  const kind=mechanism(ammo),ref=zone.reference?.[kind];
  if(ref&&angle===zone.reference.angle&&(!ref.types||ref.types.includes(ammo.type))&&!spent){
   const uncertainty=zone.reference.uncertainty||0;return {kind,min:ref.min*(1-uncertainty),max:ref.max===null?null:ref.max*(1+uncertainty),reference:true,source:ref.source,label:ref.label,angleMode:'frontal-reference',uncertainty};
  }
  // The Wiki angle table already applies projectile slope behaviour. Compare
  // against nominal layer equivalents, not LOS equivalents a second time.
  const values=zone.layers.map(l=>contribution(l,kind,0,spent,ammo.type==='APFSDS'));
  if(kind==='special'||zone.unresolved||zone.reference||values.some(v=>v===null)||!values.length)return {kind,min:null,max:null,unresolved:true,values};
  const total=values.reduce((a,b)=>a+b,0),uncertainty=zone.uncertainty||0;
  return {kind,min:total*(1-uncertainty),max:total*(1+uncertainty),estimate:!!zone.estimate,component:!!zone.component,summary:!!zone.summary,values,uncertainty};
 }
 function assess(zone,ammo,range,angle,method,spent=false){
  const protectionResult=protection(zone,ammo,angle,spent),kind=protectionResult.kind;
  // Frontal RHAe references are compared to the 0-degree table, never LOS again.
  const p=root.CombatEngine.penetration(ammo,range,protectionResult.reference?0:angle,method);
  let result={p,protection:protectionResult};
  if(kind==='special'||p===null)return {...result,status:ammo.type==='Smoke'?'SMOKE':'BLAST / SPECIAL EFFECT',cls:'warn',detail:'Blast, HESH spall and overpressure need a separate damage model.'};
  if(protectionResult.unresolved)return {...result,status:'UNRESOLVED PATH',cls:'warn',detail:'Complete layer geometry or the applicable material response is not verified. A flat steel comparison would be misleading.'};
  const suffix=zone.component?' for this isolated component; complete path unresolved.':zone.summary?' for the summary plate only.':' for the selected covered zone.';
  if(p*1.05<protectionResult.min)return {...result,status:zone.component?'COMPONENT RESISTS':'LIKELY STOPS ROUND',cls:'ok',detail:'Penetration, including +5% dispersion, is below the protection lower bound'+suffix};
  if(protectionResult.max!==null&&p*.95>protectionResult.max)return {...result,status:zone.component?'COMPONENT PERFORATED':'LIKELY PENETRATED',cls:'bad',detail:'Penetration, including −5% dispersion, exceeds the protection upper bound'+suffix};
  return {...result,status:protectionResult.max===null?'ABOVE REFERENCE THRESHOLD':'BORDERLINE',cls:'warn',detail:protectionResult.max===null?'The source establishes only a lower protection bound; a stronger round needs a measured hit-path result.':'Penetration and protection bands overlap; the available data do not settle this hit.'};
 }
 root.ArmorModel={mechanism,zones,contribution,protection,assess};if(typeof module!=='undefined')module.exports=root.ArmorModel;
})(typeof window!=='undefined'?window:globalThis);
