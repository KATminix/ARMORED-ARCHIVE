/* 3D protection analysis panel: target = selected archive vehicle, shooter/shell/range = Protection estimate selection. */
(function(){
'use strict';
const PA=window.PAEngine,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get(k,d){try{const v=localStorage.getItem('pa:'+k);return v===null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem('pa:'+k,JSON.stringify(v));}catch{}}};
const anchor=document.getElementById('combatReadout')?.closest('section.card');
const sec=document.createElement('section');sec.className='card pad';sec.id='pa3d';
sec.innerHTML=`<div class="sectionTitle">Protection analysis · 3D collision model <span class="paBadge" title="Documented native rules; native shot agreement is tracked below">rule-based reconstruction</span></div>
<div class="paLayout">
 <div class="paMain">
  <div class="paToolbar" role="toolbar" aria-label="View">
   <div class="paSeg" id="paViews"><button data-pav="front">Front</button><button data-pav="left">Left</button><button data-pav="right">Right</button><button data-pav="rear">Rear</button><button data-pav="top">Top</button><button data-pav="iso">3/4</button></div>
   <div class="paSeg" id="paModes"><button data-m="armor" class="on">Armour</button><button data-m="modules">X-ray</button><button data-m="inspect" title="Hover or click any part to read its details; nothing is fired">Inspect</button></div>
   <label class="paInline">Modules <select id="paStyle"><option value="figures">Detailed figures</option><option value="hitbox">Hitboxes</option></select></label>
   <div class="paFilter" id="paFilterBox"><button class="btn paFilterBtn" id="paFilterBtn" aria-expanded="false">X-ray part filter</button><div class="paFilterMenu" id="paFilterMenu" hidden></div></div>
   <label class="paInline">Protection map <select id="paMap"><option value="off">Off</option><option value="centre">Centre ray (fast)</option><option value="multi">Multiray (volumetric)</option></select></label>
  </div>
  <div class="paViewport" id="paViewport"><canvas id="paCanvas"></canvas><div class="paFsBar"><span id="paFsStat"></span><span class="paFsPT" id="paFsPT" hidden><select class="paFsSel" id="paFsQ" aria-label="Quality" title="Quality"></select><select class="paFsSel" id="paFsRes" aria-label="Resolution" title="Resolution"></select></span><button class="paFsBtn" id="paFsSave" hidden title="Save the path-traced image">Save image</button><button class="paFsBtn" id="paFsBtn" title="Fullscreen (Esc to leave)" aria-label="Fullscreen">⛶</button></div><canvas id="paOverlay" aria-label="Collision model. Drag to rotate, right-drag to pan, wheel to zoom, click to fire."></canvas>
   <div class="paHud" id="paHud" hidden></div><div class="paStatus" id="paStatus">Loading collision model…</div>
   <div class="paLegend" id="paLegend" hidden><span class="pen">Penetration</span><span class="pos">Possible / ricochet</span><span class="nop">No penetration</span><span class="unk">Unresolved</span></div></div>
  <p class="source">Drag to rotate · right-drag or shift-drag to pan · wheel to zoom · click to fire along the view direction. Same colour convention as the in-game map: green penetrates, yellow is possible, red is stopped.</p>
  <p class="source paCredit">Collision and damage-model geometry, part data and projectile data © Gaijin Entertainment (War Thunder), read from the installed client and the public datamine for non-commercial reference; War Thunder is a trademark of Gaijin Entertainment. In “Detailed figures” mode the crew, ammunition, engine and other module shapes are generic stand-ins drawn by this app and fitted to each damage-model part; shots are always traced against the real damage-model geometry.</p>
 <details class="layerInventory" open id="paRecordsBox"><summary>Shot records</summary><div class="scroll" id="paRecords"><p class="source">Fire a shot to list every record: ricochet roll, multiray merge, charge, carry and residual.</p></div></details>
<details class="layerInventory" id="paDamageBox"><summary>Damage and crew</summary><div id="paDamage"><p class="source">No shot yet.</p></div></details>
<details class="layerInventory" id="paModelBox"><summary>Model rules, sources and validation status</summary><div id="paModel"></div></details>
 </div>
 <aside class="paSide">
  <div class="paInspect" id="paInspect" hidden></div>
  <div class="paVerdict" id="paVerdict"><b>No shot yet</b><span>Click the model to fire the selected shell.</span></div>
  <div class="paShell" id="paShell"></div>
  <div class="paOpts">
   <label>Seed <span class="paRow"><input id="paSeed" type="number" min="0" step="1"><button class="btn" id="paNewSeed" title="New random seed">New</button></span></label>
   <label>Monte Carlo shots <select id="paRuns"><option value="0">Off</option><option value="32">32</option><option value="64" selected>64</option><option value="128">128</option><option value="256">256</option></select></label>
   <label style="grid-column:1/-1">ERA response <select id="paEra"><option value="quality">Per-mechanism quality · q·T/cos with caps</option><option value="equivalent">Listed tile equivalents (flat)</option></select></label>
   <label class="paCheck"><input type="checkbox" id="paMulti" checked> Multiray shell volume</label>
   <label class="paCheck"><input type="checkbox" id="paFitted"> Optional equipment fitted</label>
   <label class="paCheck"><input type="checkbox" id="paAmmo" checked> Ammunition racks loaded</label>
   <label class="paCheck"><input type="checkbox" id="paPersist"> Keep damage between shots</label>
   <span class="paRow" style="grid-column:1/-1"><button class="btn" id="paReset">Repair vehicle</button><button class="btn" id="paClearShots" title="Remove shot traces, fragments and labels from the 3D view">Clear shots</button></span>
   <label class="paCheck" style="grid-column:1/-1"><input type="checkbox" id="paAutoClear" checked> Clear shots after 1 min without activity</label>
  </div>
  <div class="paMC" id="paMC"></div>
  <div class="paReplay"><b>Check against the game</b>
   <span class="paRow"><button class="btn" id="paExport" disabled>Export shot (.blk)</button><label class="btn paFile">Import ReplayHits…<input type="file" id="paImport" accept=".blk,.txt"></label></span>
   <label class="paCheck"><input type="checkbox" id="paFlipZ"> Mirror Z for ReplayHits frame</label>
   <div id="paValidation"></div></div>
 </aside>
</div>
`;
if(anchor)anchor.after(sec);else document.querySelector('main')?.append(sec);
const $$=id=>document.getElementById(id);
let viewer=null;try{viewer=new PAViewer($$('paCanvas'),$$('paOverlay'));}catch(e){$$('paStatus').textContent='3D view needs WebGL2: '+e.message;}
const worker=new Worker('pa_worker.js?v='+PA.version);
let unit=null,mesh=null,prep=null,loading=null,lastShot=null,mapId=0,mcId=0,state={dead:[],hp:{}},workerUnit=null;
$$('paSeed').value=store.get('seed',1337);$$('paRuns').value=String(store.get('runs',64));$$('paMap').value=store.get('map','centre');
for(const id of ['paMulti','paFitted','paAmmo','paPersist'])$$(id).checked=store.get(id,$$(id).checked);
// ---------------------------------------------------------------- selection
function selection(){const enemyId=document.getElementById('enemyVehicle')?.value,enemy=COMBAT_DATA.units[enemyId];if(!enemy)return null;
 const ai=+document.getElementById('shell').value||0,ammo=enemy.ammo[ai],range=+document.getElementById('range').value||10,si=PA_DATA.match[enemyId]?.[ai];
 const shell=si==null?null:PA_DATA.shells[si];let wikiP=null;try{wikiP=CombatEngine.penetration(ammo,range,0,'wiki');}catch{}
 return {enemy,ammo,range,si,shell,wikiP};}
const hidden=()=>mesh?($$('paFitted').checked?mesh.fittedHidden:mesh.defaultHidden)||[]:[];
// opponents without a bundled wiki card carry tables computed from the same datamine physics; name that source honestly
const srcOf=(src,sel)=>sel?.ammo?.penSource?String(src||'').replace(/^published Wiki table/,sel.ammo.penSource):src;
const opts=sel=>({range:sel.range,wikiP:sel.wikiP,volumetric:$$('paMulti').checked,hidden:hidden(),state:$$('paPersist').checked?state:{dead:[],hp:{}},ammoLoaded:$$('paAmmo').checked,eraModel:$$('paEra').value});
// ---------------------------------------------------------------- loading
function sync(){const u=combatUnit()?.id;if(!u||!MESH_DATA.index[u]){$$('paStatus').textContent='No collision model is bundled for this configuration.';$$('paStatus').hidden=false;return;}
 if(u!==unit){unit=u;loadMesh(u);}else{renderShellInfo();requestMap();}}
async function loadMesh(u){const url=MESH_DATA.index[u].url+'?v='+MESH_DATA.version;$$('paStatus').hidden=false;$$('paStatus').textContent='Loading collision model…';
 loading=u;try{const m=await (await fetch(url)).json();if(loading!==u)return;mesh=m;prep=PA.prepare(m,PA_DATA);state={dead:[],hp:{}};lastShot=null;pinned=null;
  worker.postMessage({type:'load',unit:u,url});workerUnit=null;
  if(viewer){viewer.setMesh(prep,hidden());viewer.setView(store.get('view','iso'));viewer.setLines([]);viewer.marker=null;viewer.labels=[];window.PAGame?.onMesh(m,viewer);}
  $$('paStatus').hidden=true;$$('paRecords').innerHTML='<p class="source">Fire a shot to list every record.</p>';$$('paVerdict').innerHTML='<b>No shot yet</b><span>Click the model to fire the selected shell.</span>';$$('paMC').innerHTML='';$$('paExport').disabled=true;
  renderShellInfo();renderModel();if(viewer?.mode==='inspect')renderInspector();}catch(e){$$('paStatus').textContent='Collision model unavailable: '+e.message;}}
worker.onmessage=e=>{const m=e.data;
 if(m.type==='loaded'){workerUnit=m.unit;requestMap();}
 else if((m.type==='mapRows'||m.type==='mapDone')&&m.id===mapId&&viewer){const job=viewer._mapJob;if(!job)return;job.data.set(m.data);viewer.setMap({...job,stamp:job.stamp});if(m.type==='mapDone')$$('paLegend').hidden=false;}
 else if(m.type==='mcProgress'&&m.id===mcId)$$('paMC').innerHTML=`<div class="paBar"><i style="width:${(m.done/m.total*100).toFixed(0)}%"></i></div><p class="source">Monte Carlo ${m.done}/${m.total}…</p>`;
 else if(m.type==='mcDone'&&m.id===mcId)renderMC(m.result);
 else if(m.type==='error')console.warn('PA worker',m.message);};
// ---------------------------------------------------------------- protection map
let mapTimer=0;
function requestMap(){clearTimeout(mapTimer);mapTimer=setTimeout(runMap,180);}
function runMap(){if(!viewer||!prep)return;const mode=$$('paMap').value,sel=selection();mapId++;
 if(mode==='off'||!sel?.shell||workerUnit!==unit){viewer.setMap(null);$$('paLegend').hidden=true;worker.postMessage({type:'cancel'});return;}
 const cell=mode==='multi'?9:6,cols=Math.ceil(viewer.w/cell),rows=Math.ceil(viewer.h/cell);const {f,r,u}=viewer.basis();
 const top=viewer.ray(0,0).origin,job={cols,rows,cell,data:new Uint8Array(cols*rows),stamp:viewer.stamp()};viewer._mapJob=job;
 const down=u.map(x=>-x*viewer.zoom*2/viewer.h),right=r.map(x=>x*viewer.zoom*2/viewer.h);
 worker.postMessage({type:'map',id:mapId,unit,shellIndex:sel.si,range:sel.range,wikiP:sel.wikiP,eraModel:$$('paEra').value,volumetric:mode==='multi',hidden:hidden(),dead:$$('paPersist').checked?state.dead:[],cols,rows,cell:1,
  origin0:top,right:right.map(x=>x*cell),up:down.map(x=>x*cell),dir:f});}
// ---------------------------------------------------------------- hover readout (nominal, fast)
let hoverRaf=0,hoverXY=null;
function hover(x,y){hoverXY=x===null?null:[x,y];if(!hoverRaf)hoverRaf=requestAnimationFrame(doHover);}
function doHover(){hoverRaf=0;const hud=$$('paHud');hud.classList.remove('inspect','armorCard');
 if(!hoverXY||!prep){hud.hidden=true;if(viewer){viewer.setHover(null);viewer.marker=lastShot?viewer.marker:null;viewer.drawOverlay();}return;}
 if(viewer.mode!=='armor')return inspectHover(hud);
 // armour view: the game's armour card (thickness, slope, impact angle, effective thickness) plus the shot preview
 const [x,y]=hoverXY,ray=viewer.ray(x,y),mask=PA.makeMask(prep,hidden(),new Set($$('paPersist').checked?state.dead:[]));
 prep.props.forEach((pp,i)=>{if(pp&&pp.role!=='armor')mask[i]=0;});
 const sg=PA.segments(prep,ray.origin,ray.dir,mask)[0];if(!sg){hud.hidden=true;viewer.setHover(null);return;}
 viewer.setHover(sg.node);const pp=prep.props[sg.node],sel=selection();let line='';
 const n=sg.normal,slope=Math.round(Math.asin(Math.min(1,Math.abs(n[1])))*180/Math.PI),imp=Math.round(Math.acos(Math.min(1,Math.abs(sg.cos)))*180/Math.PI),eff=losOf(sg,pp);
 if(sel?.shell){const r=PA.shoot(prep,PA_DATA,sel.shell,ray.origin,ray.dir,{...opts(sel),volumetric:false,damage:false,spall:false,maxFragments:0});
  const ric=r.rows.find(q=>q.ricochet>0);line=`<div class="paHudShot"><span class="paHudV ${r.verdict}">${verdictText(r.verdict)}</span>${ric?` · ricochet ${(ric.ricochet*100).toFixed(0)} %`:''} <small>${esc(sel.ammo?.name||'')}</small></div>`;}
 hud.classList.add('inspect','armorCard');
 hud.innerHTML=`<b class="paHudT">${esc(matName(pp.material))}</b><div class="paHudFacts"><div><span>Thickness</span> ${pp.armorThickness??'—'} mm</div><div><span>Constructional armor slope angle</span> ${slope}°</div><div><span>Impact angle</span> ${imp}°</div>${eff?`<div><span>Effective thickness</span> ${Math.round(eff)} mm</div>`:''}</div><div class="paHudDim">${esc(partTitle(prep.nodes[sg.node].name))}</div>${line}`;
 hud.hidden=false;hud.style.left=Math.min(x+18,viewer.w-350)+'px';hud.style.top=Math.max(8,Math.min(y-10,viewer.h-hud.offsetHeight-8))+'px';}
const verdictText=v=>({penetration:'Penetration','no-penetration':'No penetration',ricochet:'Ricochet',unresolved:'Unresolved path',unsupported:'Unsupported round'}[v]||v);

// ---------------------------------------------------------------- inspect mode (read part details, nothing is fired)
// Titles, materials, engine/gun/crew/ammo details and composite-armour layers come from the game's own x-ray data
// and English text (pa_xray_info.js, pinned datamine); MAT_NAMES/PART_WORDS are only fallbacks.
const XR=window.PA_XRAY||null,L=k=>XR?.lang?.[k];
const cap=t=>!t?t:/^[a-z]{2,4}$/.test(t)&&!/^(ammo|tank|gun|fuel)$/.test(t)?t.toUpperCase():String(t).charAt(0).toUpperCase()+String(t).slice(1);
const MAT_NAMES={RHA_tank:'Rolled homogeneous armour',RHA_tank_modern:'Rolled homogeneous armour',RHAHH_tank:'High-hardness rolled armour',RHAHH_tank_modern:'High-hardness rolled armour',
 CHA_tank:'Cast homogeneous armour',CHA_tank_modern:'Cast homogeneous armour',tank_structural_steel:'Structural steel',tank_steel_wheels:'Steel road wheel',tank_traks:'Track',car_wheels:'Wheel',
 armor_tank_engine:'Engine block',steel_tankman:'Crew member',optics_tank:'Optics',tank_barrel:'Gun barrel steel',spaced_armor_air:'Air gap'};
const matName=id=>L('armor_class/'+id)||MAT_NAMES[id]||String(id||'—').replace(/_/g,' ');
const CAT_NAMES={crew:'Crew',ammunition:'Ammunition',fuel:'Fuel',powertrain:'Powertrain',breech:'Breech',gun:'Armament',optics:'Optics',equipment:'Equipment',xray:'Armour array'};
const PART_WORDS=[[/^machine_gunner/,'Machine gunner'],[/^driver/,'Driver'],[/^gunner/,'Gunner'],[/^commander/,'Commander'],[/^loader/,'Loader'],[/^engine/,'Engine'],[/^transmission/,'Transmission'],[/^radiator/,'Radiator'],
 [/^fuel_tank/,'Fuel tank'],[/^ammo_turret/,'Ammo rack (turret)'],[/^ammo_body/,'Ammo rack (hull)'],[/^ammo/,'Ammo rack'],[/^cannon_breech/,'Cannon breech'],[/^gun_barrel/,'Gun barrel'],[/^drive_turret_h/,'Horizontal turret drive'],
 [/^drive_turret_v/,'Vertical cannon drive'],[/^optic/,'Optics'],[/^mg/,'Machine gun'],[/^track/,'Track'],[/^wheel/,'Road wheel'],[/^composite_armor/,'Composite armour'],[/^ex_era/,'Reactive armour'],[/^ex_armor/,'Add-on armour'],[/^era/,'Reactive armour'],
 [/^gun_mask|^mantlet/,'Gun mantlet'],[/^superstructure/,'Superstructure'],[/^body/,'Hull'],[/^turret/,'Turret'],[/^screen|^skirt/,'Side skirt']];
const SIDE_WORDS={front:'front',back:'rear',rear:'rear',side:'side',top:'roof',bottom:'floor',l:'left',r:'right',lower:'lower',upper:'upper',glacis:'glacis'};
function fallbackTitle(name){const b=String(name).replace(/_dm$/,'');const w=PART_WORDS.find(([re])=>re.test(b));if(!w)return cap(b.replace(/_/g,' '));
 const rest=b.replace(w[0],'').split('_').filter(Boolean),num=rest.filter(t=>/^\d+$/.test(t)).map(t=>+t),words=rest.filter(t=>SIDE_WORDS[t]&&!w[1].toLowerCase().includes(SIDE_WORDS[t])).map(t=>SIDE_WORDS[t]);
 return w[1]+(words.length?' — '+[...new Set(words)].join(' '):'')+(num.length?' #'+num.join('.'):'');}
const xu=()=>XR?.units?.[unit]||null;
const stemOf=name=>String(name).replace(/_dm$/,'').replace(/(_[lr])?(_\d+)+$/,'').replace(/_[lr]$/,'');
function partTitle(name){const u=xu(),stem=stemOf(name);
 const ov=u?.overrides?.[name];if(ov?.title){const t=L('dmg_msg_short/tank_'+ov.title);if(t)return cap(t);}
 const cr=u?.crew?.[name];if(cr){const t=L('crew/'+cr.roles[0]);if(t)return t+(cr.roles.length>1?' / '+cr.roles.slice(1).map(r=>L('crew/'+r)||r).join(' / '):'');}
 const aa=u?.armorArrays?.[name];if(aa){const t=(aa.title&&L('armor_class/'+aa.title))||L('armor_class/'+stem);if(t)return t;}
 if(u?.ammo?.[name])return fallbackTitle(name);
 const t=L('dmg_msg_short/tank_'+stem);if(t)return cap(t)+(/_\d+$/.test(name.replace(/_dm$/,''))&&!/^(engine|transmission)$/.test(stem)?' #'+name.replace(/_dm$/,'').match(/(\d+)$/)[1].replace(/^0/,''):'');
 return fallbackTitle(name);}
// x-ray marker volumes (excluded from ballistics) that carry the game's composite-armour text
function pinfo(ni){const pp=prep.props[ni];if(pp)return pp;const nm=prep.nodes[ni].name,aa=xu()?.armorArrays?.[nm];if(!aa)return null;
 const part=prep.mesh.nodes[ni].part||{};return {role:'xray',category:'xray',material:part.material,armorThickness:null,name:nm};}
let pickMode=store.get('pick','modules'),pinned=null;window.__paPick=pickMode; // pinned: {ray, segs, focus}
function inspectMask(){const m=PA.makeMask(prep,hidden());const aa=xu()?.armorArrays;if(aa&&viewer.xfilter.has('armor'))for(const nm of Object.keys(aa)){const i=prep.nameIndex.get(nm);if(i!==undefined)m[i]=1;}
 prep.props.forEach((pp,i)=>{if(pp&&m[i]&&!viewer.catVisible(pp,prep.nodes[i].name))m[i]=0;});return m;}
function inspectRay(ray){return PA.segments(prep,ray.origin,ray.dir,inspectMask()).filter(sg=>pinfo(sg.node));}
// like the hangar x-ray: modules and composite arrays are picked through plain plates; otherwise the nearest surface
function pickOf(segs){if(!segs.length)return null;const pickMode=viewer.mode==='inspect'?window.__paPick||store.get('pick','modules'):'modules';if(pickMode==='surface')return segs[0];
 if(pickMode==='armor')return segs.find(sg=>{const q=pinfo(sg.node);return q.role==='armor'||q.role==='xray';})||segs[0];
 return segs.find(sg=>{const q=pinfo(sg.node);return q.role==='module'||q.role==='xray';})||segs[0];}
const isPlate=sg=>pinfo(sg.node)?.role==='armor';
// one line per armour plate: material, nominal and line-of-sight thickness
function plateLine(sg){const q=pinfo(sg.node),l=losOf(sg,q);return `${partTitle(prep.nodes[sg.node].name)} — ${matName(q.material)} ${q.armorThickness??'—'} mm${l?` (${Math.round(l)} LOS)`:''}`;}
const losOf=(sg,pp)=>pp?.armorThickness&&Math.abs(sg.cos)>0.02?pp.armorThickness/Math.abs(sg.cos):null;
function partStatus(name){if(state.dead.includes(name))return {t:'Destroyed',c:'dead'};const pp=prep.props[prep.nameIndex.get(name)],hp=state.hp?.[name];
 if(hp!==undefined&&pp?.hp&&hp<pp.hp)return {t:`Damaged · ${Math.max(0,Math.round(hp))}/${pp.hp} HP`,c:'dmg'};return null;}
function layerThickness(l){const ni=prep.nameIndex.get(l.part),part=ni!==undefined?prep.mesh.nodes[ni].part:null;
 const t=l.text!=null?(Array.isArray(l.text)?`${l.text[0]}–${l.text[1]}`:l.text):part?.properties?.armorThickness;return {mat:part?.material,t};}
function weaponName(w){const t=L('weapons/'+w.name);if(t)return t;
 const cal=w.name.match(/^(\d+(?:_\d+)?)mm/),names=[...new Set((COMBAT_DATA.units[unit]?.ammo||[]).map(a=>a.weapon).filter(Boolean))];
 if(cal){const c=cal[1].replace('_','.');const hit=names.find(n=>n.startsWith(c+' mm'));if(hit)return hit;}
 return w.name.replace(/_user_(cannon|machinegun)$/,' $1').replace(/^(\d+)_(\d+)mm_/,'$1.$2 mm ').replace(/^(\d+)mm_/,'$1 mm ').replace(/_/g,' ').replace('machinegun','machine gun');}
const fmtLim=a=>Array.isArray(a)?`${a[0]>0?'+':''}${a[0]}° / ${a[1]>0?'+':''}${a[1]}°`:null;
// [label, value] rows of what the game tells about this part
function gameFacts(ni){const u=xu(),nm=prep.nodes[ni].name,q=pinfo(ni),rows=[];if(!u)return rows;const add=(k,v)=>{if(v!=null&&v!=='')rows.push([k,v]);};
 for(const w of u.weapons||[]){
  if(w.barrel===nm||w.breech===nm){add('Weapon',weaponName(w));add('Ammunition',w.bullets!=null?`${w.bullets} rounds`:null);if(w.reload)add('Fire interval',`${w.reload} s`);
   add('Vertical guidance',fmtLim(w.pitch));add('Horizontal guidance',w.yaw&&Math.abs(w.yaw[1]-w.yaw[0])>=359?'360°':fmtLim(w.yaw));}
  if(w.verDrive.includes(nm)){add('Drives',weaponName(w));add('Vertical guidance',fmtLim(w.pitch));add('Vertical speed',w.speedPitch!=null?`${w.speedPitch}°/s`:null);}
  if(w.horDrive.includes(nm)){add('Drives',weaponName(w));add('Horizontal guidance',w.yaw&&Math.abs(w.yaw[1]-w.yaw[0])>=359?'360°':fmtLim(w.yaw));add('Horizontal speed',w.speedYaw!=null?`${w.speedYaw}°/s`:null);}}
 const stem=stemOf(nm);
 if(stem==='engine'&&u.engine){const e=u.engine;const model=e.model?(L('engine_model/'+e.model)||e.model):null;
  add(L('xray/model')||'Model',model?(e.maker&&!model.toLowerCase().includes(String(e.maker).toLowerCase())?(e.maker.length<=4?e.maker.toUpperCase():cap(e.maker))+' ':'')+model:null);
  add('Type',e.type?(L('engine_type/'+e.type)||e.type):null);add('Power',e.hp?`${e.hp} hp${e.maxRpm?` at ${e.maxRpm} rpm`:''}`:null);
  if(e.hp&&u.mass)add('Power-to-weight',`${(e.hp/(u.mass/1000)).toFixed(1)} hp/t at ${(u.mass/1000).toFixed(1)} t`);}
 if(stem==='transmission'&&u.transmission){const t=u.transmission;add(L('xray/transmission/forwardGears')?.replace(/:$/,'')||'Forward gears',t.fwd||null);add(L('xray/transmission/backwardGears')?.replace(/:$/,'')||'Reverse gears',t.rev||null);
  add(L('xray/transmission/maxSpeed/forward')||'Max speed, forward',t.maxFwd!=null?`${Math.round(t.maxFwd)} km/h`:null);add(L('xray/transmission/maxSpeed/backward')||'Max speed, backward',t.maxRev!=null?`${Math.round(t.maxRev)} km/h`:null);}
 const cr=u.crew?.[nm];if(cr){add('Role',cr.roles.map(r=>L('crew/'+r)||r).join(', '));const seats=new Map(Object.values(u.crew).map(c=>[c.seat,c])),subs=cr.substitute.filter(r=>seats.has(r));if(subs.length)add('Replaced by',subs.map(r=>{const c=seats.get(r);return L('crew/'+c.roles[0])||cap(r.replace(/_/g,' '));}).join(', '));}
 const am=u.ammo?.[nm];if(am){const w=(u.weapons||[]).find(x=>x.trigger===am.trigger);if(w)add('Weapon',weaponName(w));add('Rounds here',am.count);add('Stowage',`${am.stowage.replace(/^ammo/,'rack group ')}${am.kind==='charges'?' (charges)':''}`);
  if(am.firstStage)add(L('xray/ammo/first_stage')||'Ready rack','yes'+(am.replenish?` · refilled in ${am.replenish} s`:''));add('If hit',am.fatalExplosion?'can detonate':am.fatalFire?'can burn':'not fatal');}
 const fu=u.fuel?.[nm];if(fu||stem.startsWith('fuel_tank')){add('Mounting',fu?.external?'external':'internal');if(u.fuelMass)add('Total fuel aboard',`${u.fuelMass} kg`);}
 return rows;}
function compositionOf(ni){const aa=xu()?.armorArrays?.[prep.nodes[ni].name];return aa?aa.layers.map(layerThickness):null;}
function hudCard(ni,sg){const pp=pinfo(ni),name=prep.nodes[ni].name,st=partStatus(name);let h=`<b class="paHudT">${esc(partTitle(name))}</b>`;
 const comp=compositionOf(ni);
 if(comp){h+=`<div class="paHudSub">${esc(L('xray/armor_composition')||'Composition')}:</div><ul class="paHudList">${comp.map(c=>`<li>${esc(matName(c.mat))}${c.t!=null?` (${c.t} mm)`:''}</li>`).join('')}</ul>`;}
 else if(pp.role==='module'){const f=gameFacts(ni);h+=f.length?`<div class="paHudFacts">${f.slice(0,5).map(([k,v])=>`<div><span>${esc(k)}</span> ${esc(v)}</div>`).join('')}</div>`:`<div class="paHudSub">${esc(CAT_NAMES[pp.category]||'Module')}${pp.hp?` · ${pp.hp} HP`:''}</div>`;}
 else{h+=`<div class="paHudSub">${esc(matName(pp.material))} · ${pp.armorThickness??'—'} mm</div>`;const l=losOf(sg,pp);if(l)h+=`<div class="paHudDim">${Math.round(Math.acos(Math.min(1,Math.abs(sg.cos)))*180/Math.PI)}° to this view · ${Math.round(l)} mm line of sight</div>`;}
 if(st)h+=`<div class="paHudSt ${st.c}">${esc(st.t)}</div>`;return h;}
function inspectHover(hud){const [x,y]=hoverXY,ray=viewer.ray(x,y),segs=inspectRay(ray),sg=pickOf(segs);
 if(!sg){hud.hidden=true;viewer.setHover(null);return;}viewer.setHover(sg.node);hud.classList.add('inspect');let h=hudCard(sg.node,sg);
 const k=segs.indexOf(sg),front=segs.slice(0,k).filter(isPlate),q=pinfo(sg.node);
 if(front.length){const tot=front.reduce((a,f)=>a+(losOf(f,pinfo(f.node))||0),0);h+=`<div class="paHudSec">Armour in front${tot?` · ${Math.round(tot)} mm LOS total`:''}</div><ul class="paHudList">${front.slice(0,4).map(f=>`<li>${esc(plateLine(f))}</li>`).join('')}${front.length>4?`<li>+${front.length-4} more</li>`:''}</ul>`;}
 if(q.role!=='module'){const behind=segs.slice(k+1).find(s=>pinfo(s.node).role==='module');if(behind)h+=`<div class="paHudSec">Behind it</div><div class="paHudSub">${esc(partTitle(prep.nodes[behind.node].name))} · ${((behind.entry-sg.entry)*100).toFixed(0)} cm deeper</div>`;}
 hud.innerHTML=h;
 hud.hidden=false;hud.style.left=Math.min(x+18,viewer.w-350)+'px';hud.style.top=Math.max(8,Math.min(y-10,viewer.h-hud.offsetHeight-8))+'px';}
function inspectPin(x,y){if(!prep)return;const ray=viewer.ray(x,y),segs=inspectRay(ray),sg=pickOf(segs);pinned=sg?{ray,segs,focus:sg.node}:null;focusPart(pinned?.focus);}
function focusPart(ni){let names=[];if(ni!=null){const nm=prep.nodes[ni].name,comp=xu()?.armorArrays?.[nm];names=comp?comp.layers.map(l=>l.part):[nm];}
 viewer.highlight=new Set(names);viewer.rebuildColors();viewer.draw();renderInspector(ni);}
function detailRows(ni){const pp=pinfo(ni),name=prep.nodes[ni].name,rows=[];const add=(k,v)=>{if(v!==undefined&&v!==null&&v!=='')rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`);};
 for(const [k,v] of gameFacts(ni))add(k,esc(v));
 const comp=compositionOf(ni);
 if(comp){add(L('xray/armor_composition')||'Composition',`<ul class="paInsComp">${comp.map(c=>`<li>${esc(matName(c.mat))}${c.t!=null?` <b>${c.t} mm</b>`:''}</li>`).join('')}</ul>`);
  add('Note','Hits are traced through the individual layers; this volume itself is not hit-tested.');}
 else{add('Type',esc(pp.role==='module'?CAT_NAMES[pp.category]||'Module':'Armour'));add('Material',`${esc(matName(pp.material))} <small>${esc(pp.material)}</small>`);
  if(pp.role!=='module')add('Nominal thickness',pp.armorThickness!=null?`${pp.armorThickness} mm`:null);}
 add('Hit points',pp.hp?`${pp.hp}`:null);if(pp.role!=='xray'){const st=partStatus(name);add('State',st?`<span class="paSt ${st.c}">${esc(st.t)}</span>`:'Intact');}
 add('Armour quality',pp.armorQuality!=null?pp.armorQuality:null);add('vs HEAT/shaped charge',pp.cumulativeArmorQuality!=null?`× ${pp.cumulativeArmorQuality}`:null);
 add('Ricochet from',pp.ricochetAngle!=null?`${pp.ricochetAngle}° off normal`:null);add('Fire protection',pp.fireProtectionHp!=null?`${pp.fireProtectionHp} HP`:null);
 add('Damage-model part',`<code>${esc(name)}</code>`);add('Group',pp.path?`<code>${esc(String(pp.path).split('/').slice(0,-1).join(' / ')||'—')}</code>`:null);
 if(viewer.xrayCover().has(name))add('Shown with','game x-ray mesh');else if(pp.role==='module')add('Shown with',viewer.moduleStyle==='hitbox'?'damage-model box':'stand-in figure');
 return `<dl class="paDl">${rows.join('')}</dl>`;}
const ptNote=P=>P.available()?'(WebGPU, accumulates while the camera is still)':'('+(P.gate?.reason||'unavailable')+')';
function ptControls(){const P=window.PAPT,on=P.enabled;
 return `<div class="paPTBox ${P.available()?'':'paPTLocked'}"><label class="paCheck"><input type="checkbox" id="paPTOn" ${on?'checked':''} ${P.available()?'':'disabled'}> Path traced <small class="paPTStat" id="paPTNote">${esc(ptNote(P))}</small></label>
 <div class="paRow"><label class="paInline">Quality <select id="paPTPreset">${Object.entries(P.PRESETS).map(([k,v])=>`<option value="${k}" ${k===P.preset?'selected':''}>${esc(v.label)}${Number.isFinite(v.spp)?' · '+v.spp.toLocaleString()+' spp':''}</option>`).join('')}</select></label>
 <label class="paInline">Resolution <select id="paPTRes">${[['view','Viewport'],['1080','1920 × 1080'],['1440','2560 × 1440'],['2160','3840 × 2160 (4K)']].map(([v,l])=>`<option value="${v}" ${v===P.res?'selected':''}>${l}</option>`).join('')}</select></label>
 <label class="paInline" ${P.res==='view'?'':'hidden'} id="paPTScaleBox">Scale <select id="paPTScale">${[[1,'100 %'],[0.75,'75 %'],[0.5,'50 %']].map(([v,l])=>`<option value="${v}" ${v===P.scale?'selected':''}>${l}</option>`).join('')}</select></label>
 <button class="btn" id="paPTSave" ${on?'':'disabled'}>Save image</button></div>
 <div class="paRow"><label class="paInline" title="Debug views of the path tracer">Debug view <select id="paPTDebug">${[[0,'Off'],[1,'Ray paths (click a pixel)'],[2,'BVH traversal cost'],[3,'Shading normals'],[4,'Albedo'],[5,'Live noisy samples']].map(([v,l])=>`<option value="${v}" ${v===(P.debug||0)?'selected':''}>${l}</option>`).join('')}</select></label> <button class="btn" id="paPTLive" title="Fullscreen view of every sample as it is traced, before averaging">Watch samples fullscreen</button></div>
 <div class="paPTStat" id="paPTDbgInfo" ${P.debug?'':'hidden'}>${esc(P.debugInfo||'')}</div>
 <div class="paPTStat" id="paPTStat">${esc(P.status||'')}</div></div>`;}
function bindPT(){const P=window.PAPT;if(!P||!$$('paPTOn'))return;
 P.ready?.then(()=>{const c=$$('paPTOn');if(!c)return;c.disabled=!P.available();c.checked=P.enabled;$$('paPTNote').textContent=ptNote(P);c.closest('.paPTBox').classList.toggle('paPTLocked',!P.available());$$('paPTSave').disabled=!P.enabled;});
 $$('paPTOn').onchange=()=>{P.setEnabled($$('paPTOn').checked);$$('paPTSave').disabled=!$$('paPTOn').checked;};
 $$('paPTPreset').onchange=()=>P.setPreset($$('paPTPreset').value);$$('paPTScale').onchange=()=>P.setScale(+$$('paPTScale').value);$$('paPTRes').onchange=()=>{P.setRes($$('paPTRes').value);$$('paPTScaleBox').hidden=$$('paPTRes').value!=='view';};$$('paPTSave').onclick=()=>P.saveImage();
 $$('paPTDebug').onchange=()=>{const m=+$$('paPTDebug').value;P.setDebug(m);$$('paPTDbgInfo').hidden=!m;};
 P.onDebug(t=>{const el=$$('paPTDbgInfo');if(el)el.textContent=t;});
 $$('paPTLive').onclick=()=>{$$('paPTDebug').value='5';$$('paPTDebug').onchange();if(!$$('paViewport').classList.contains('paFs'))$$('paFsBtn').click();};
 P.onStatus(t=>{const el=$$('paPTStat');if(el)el.textContent=t;});}
function syncInspectArmor(){if(!viewer)return;const on=viewer.mode==='inspect'&&pickMode==='armor';if(viewer.inspectArmor!==on){viewer.inspectArmor=on;viewer.rebuildColors();viewer.draw();}}
// every armour plate, grouped by damage-model group, plus the game's composite blocks
function armourList(focus){const groups=new Map();
 prep.props.forEach((pp,i)=>{if(pp?.role!=='armor'||viewer.hidden.has(prep.nodes[i].name))return;const g=String(pp.path||'').split('/').slice(0,-1).join(' / ')||'other';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(i);});
 const aa=xu()?.armorArrays||{},comps=Object.keys(aa).map(n=>prep.nameIndex.get(n)).filter(i=>i!==undefined);
 const total=[...groups.values()].reduce((a,b)=>a+b.length,0);
 const chip=(i,label)=>{const st=partStatus(prep.nodes[i].name);return `<button class="paChip ${i===focus?'on':''} ${st?st.c:''}" data-ni="${i}">${esc(label)}</button>`;};
 let h=`<details class="paInsAll" ${focus==null&&pickMode==='armor'?'open':''}><summary>All armour (${total} plates${comps.length?`, ${comps.length} composite blocks`:''})</summary>`;
 if(comps.length)h+=`<div class="paInsCat"><span class="paSw" style="background:#9fb7d6"></span>Composite blocks <small>${comps.length}</small></div><div class="paInsChips">${comps.map(i=>chip(i,partTitle(prep.nodes[i].name)+' '+prep.nodes[i].name.replace(/^composite_armor_|_dm$/g,'').replace(/_/g,' '))).join('')}</div>`;
 for(const [g,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0])))h+=`<div class="paInsCat"><span class="paSw" style="background:#7d8a9c"></span>${esc(g.replace(/_/g,' '))} <small>${list.length}</small></div><div class="paInsChips">${list.sort((a,b)=>prep.nodes[a].name.localeCompare(prep.nodes[b].name,undefined,{numeric:true})).map(i=>chip(i,`${partTitle(prep.nodes[i].name)} · ${prep.props[i].armorThickness??'—'} mm`)).join('')}</div>`;
 return h+'</details>';}
function renderInspector(ni){syncInspectArmor();if(viewer&&viewer.plainModel!==(store.get('inspectView','xray')==='model'))viewer.setPlainModel(store.get('inspectView','xray')==='model');const el=$$('paInspect');if(!el||!prep)return;
 const focus=ni!=null?ni:pinned?.focus;const plain=store.get('inspectView','xray')==='model';
 let h=`<div class="paInsBar"><div class="paSeg paView" role="group" aria-label="View"><button data-iview="xray" class="${plain?'':'on'}">X-ray</button><button data-iview="model" class="${plain?'on':''}" title="Just the textured vehicle: no armour, boxes or outlines">Textured model</button></div>`+(plain&&!viewer.visual?.main?`<span class="source">Game model not loaded: showing the plain hull.</span>`:'')+`</div>`+(plain&&window.PAPT?ptControls():'')+`<div class="paSeg paPick" role="group" aria-label="What to pick"><button data-pick="modules" class="${pickMode==='modules'?'on':''}" title="Like the hangar x-ray: modules and composite arrays are picked through plain plates">Modules</button><button data-pick="armor" class="${pickMode==='armor'?'on':''}" title="Pick armour plates and composite blocks; plates are drawn solid">Armour</button><button data-pick="surface" class="${pickMode==='surface'?'on':''}" title="Whatever is in front">Nearest surface</button></div>`;
 if(focus!=null)h+=`<div class="paInsHead"><b>${esc(partTitle(prep.nodes[focus].name))}</b><button class="btn" id="paInsClear" title="Back to the parts list">All parts</button></div>${detailRows(focus)}`;
 else h+=`<div class="paInsHead"><b>Inspect</b></div><p class="source">Hover any part to read it; click to pin it here with everything along that line. Nothing is fired in this mode.${XR?'':' (Game x-ray text not loaded: pa_xray_info.js missing.)'}</p>`;
 if(pinned?.segs?.length){h+=`<div class="paInsSub">Along this line (front to back)</div><div class="scroll"><table class="paTable paInsTable"><thead><tr><th>Part</th><th title="Nominal thickness">mm</th><th title="Line-of-sight thickness for this view">LOS</th><th title="Distance behind the first surface">Depth</th></tr></thead><tbody>${pinned.segs.map(sg=>{const q=pinfo(sg.node),nm=prep.nodes[sg.node].name,st=partStatus(nm),plate=q.role==='armor';
   return `<tr data-ni="${sg.node}" class="${sg.node===focus?'on':''} ${st?'st-'+st.c:''} ${q.role==='xray'?'xr':''}"><td>${esc(partTitle(nm))}<small>${esc(q.role==='module'?CAT_NAMES[q.category]||'Module':q.role==='xray'?'composite array (text only)':matName(q.material))}</small></td><td>${plate?q.armorThickness??'—':'—'}</td><td>${plate?Math.round(losOf(sg,q)||0)||'—':'—'}</td><td>${((sg.entry-pinned.segs[0].entry)*100).toFixed(0)} cm</td></tr>`;}).join('')}</tbody></table></div>`;}
 const groups=new Map();prep.props.forEach((pp,i)=>{if(pp?.role!=='module'||viewer.hidden.has(prep.nodes[i].name))return;const c=pp.category||'equipment';if(!groups.has(c))groups.set(c,[]);groups.get(c).push(i);});
 const order=['crew','ammunition','fuel','powertrain','breech','gun','optics','equipment'];
 h+=armourList(focus);
 h+=`<details class="paInsAll" ${focus==null&&pickMode!=='armor'?'open':''}><summary>All modules (${[...groups.values()].reduce((a,b)=>a+b.length,0)})</summary>${order.filter(c=>groups.has(c)).map(c=>`<div class="paInsCat"><span class="paSw" style="background:${PAViewer.MODULE_COLORS[c]||'#ccc'}"></span>${esc(CAT_NAMES[c])} <small>${groups.get(c).length}</small></div><div class="paInsChips">${groups.get(c).sort((a,b)=>prep.nodes[a].name.localeCompare(prep.nodes[b].name,undefined,{numeric:true})).map(i=>{const st=partStatus(prep.nodes[i].name);return `<button class="paChip ${i===focus?'on':''} ${st?st.c:''}" data-ni="${i}">${esc(partTitle(prep.nodes[i].name).replace(/^Ammo rack \((hull|turret)\)/,'Ammo $1'))}</button>`;}).join('')}</div>`).join('')}</details>`;
 el.innerHTML=h;
 el.querySelectorAll('[data-ni]').forEach(b=>b.addEventListener('click',()=>{const i=+b.dataset.ni;if(pinned&&!pinned.segs.some(sg=>sg.node===i))pinned=null;if(pinned)pinned.focus=i;focusPart(i);}));
 el.querySelectorAll('[data-iview]').forEach(b=>b.addEventListener('click',()=>{store.set('inspectView',b.dataset.iview);viewer.setPlainModel(b.dataset.iview==='model');renderInspector(pinned?.focus??undefined);}));
 el.querySelectorAll('[data-pick]').forEach(b=>b.addEventListener('click',()=>{pickMode=b.dataset.pick;window.__paPick=pickMode;store.set('pick',pickMode);syncInspectArmor();if(pinned){const sg=pickOf(pinned.segs);pinned.focus=sg?.node;focusPart(pinned.focus);}else renderInspector();}));
 $$('paInsClear')?.addEventListener('click',()=>{pinned=null;focusPart(null);});bindPT();}
// ---------------------------------------------------------------- firing
function fire(x,y,given){if(!prep)return;const sel=selection();if(!sel?.shell){$$('paVerdict').innerHTML='<b>Round not matched</b><span>This shell has no exact datamine projectile match, so it cannot be simulated.</span>';return;}
 const ray=given||viewer.ray(x,y),seed=(+$$('paSeed').value)>>>0;store.set('seed',seed);
 const o={...opts(sel),rng:PA.makeRng(seed)};const t0=performance.now(),r=PA.shoot(prep,PA_DATA,sel.shell,ray.origin,ray.dir,o),ms=performance.now()-t0;
 lastShot={ray,sel,seed,result:r,ms,origin:ray.origin,dir:ray.dir};
 const hit=r.rows[0]?.point;if(viewer){viewer.marker=hit?{point:hit}:null;drawShot(r);}
 if($$('paPersist').checked&&r.damage)state=r.damage.state;
 renderResult(r,sel,ms);$$('paExport').disabled=false;runMC();if($$('paPersist').checked)requestMap();}
function drawShot(r){const L=[],C={shell:[1,1,1,.95],body:[1,1,1,.95],precharge:[1,.85,.3,.95],jet:[.35,.9,1,.95],ricochet:[1,.55,.2,.95]};
 for(const s of r.stages){const pts=s.path||[];for(let i=0;i+1<pts.length;i++)L.push({a:pts[i],b:pts[i+1],color:i>0&&s.kind!=='jet'?C.ricochet:C[s.kind]||C.shell});
  for(const l of s.legs)for(const rec of l.records){if(!rec.point)continue;const col=rec.state==='stopped'||rec.state==='gap'?[1,.35,.3,1]:rec.state==='ricochet'?[1,.55,.2,1]:[.6,1,.7,1],k=.035;
   L.push({a:[rec.point[0],rec.point[1]-k,rec.point[2]],b:[rec.point[0],rec.point[1]+k,rec.point[2]],color:col},{a:[rec.point[0],rec.point[1],rec.point[2]-k],b:[rec.point[0],rec.point[1],rec.point[2]+k],color:col});}}
 for(const cone of r.out.cones)for(const f of cone.fragments.slice(0,140)){const t=f.stopT??f.range;L.push({a:f.origin,b:f.origin.map((v,i)=>v+f.dir[i]*t),color:f.hits.length?[1,.4,.25,.55]:[1,.7,.35,.18]});}
 const wf=r.burst?.fragments?.fragments||[];for(const f of wf.slice(0,220)){const t=f.stopT??f.range;L.push({a:f.origin,b:f.origin.map((v,i)=>v+f.dir[i]*Math.min(t,3)),color:f.hits.length?[.85,.5,1,.6]:[.75,.55,1,.12]});}
 viewer.labels=[];if(r.burst)viewer.labels.push({p:r.burst.point,t:r.mechanism==='kinetic'?'APHE burst':r.mechanism==='tandem'?'tandem burst':'burst',c:'#ffd27a'});
 const stop=r.rows.filter(x=>x.state==='stopped'||x.state==='gap').pop();if(stop)viewer.labels.push({p:stop.point,t:'stopped · '+stop.name,c:'#ff9b8f'});
 const dmg=r.damage,dead=new Set([...(dmg?.state?.dead||[])]),damaged=new Map((dmg?.damaged||[]).map(d=>[d.name,d.damage]));viewer.highlight=new Set();
 viewer.setState(dead,damaged);viewer.setLines(L);shotShown=true;armIdle();}
function renderResult(r,sel,ms){
 const d=r.damage,crew=d?`${d.crewDead.length}/${d.crewTotal} crew lost`:'';const cls=d?.fatal||r.verdict==='penetration'?'pen':r.verdict==='no-penetration'?'nop':'pos';
 $$('paVerdict').className='paVerdict '+cls;
 $$('paVerdict').innerHTML=`<b>${d?.fatal?'Vehicle destroyed · '+esc(d.fatal.kind):verdictText(r.verdict)}</b><span>${d?.fatal?verdictText(r.verdict)+(d.fatal.part?' · '+esc(d.fatal.part):''):esc(d?d.outcome:'')}${!d?.fatal&&d?.effects?.some(e=>e.blowout)?' · ammo vented through blow-out panels':''}${crew?' · '+crew:''}</span><small>${esc(r.mechanism)} · seed ${r.seed} · ${ms.toFixed(0)} ms${r.interior?` · interior with ${r.interior.residual.toFixed(0)} mm left`:''}${r.stoppedAt&&r.verdict!=='penetration'?` · stopped by ${esc(r.stoppedAt)}`:''}${r.note?' · '+esc(r.note):''}</small>`;
 const rows=r.rows.map(x=>`<tr class="st-${x.state}"><td>${esc(x.stage)}</td><td>${esc(x.name)}<br><small>${esc(x.category||x.material||'')}${x.hp?` · ${x.hp} HP`:''}${x.merged?` · merged: ${esc(x.merged.join(', '))}`:''}</small></td><td>${x.angle!==undefined?x.angle.toFixed(1)+'°':'—'}${x.weight<1?`<br><small>weight ${(x.weight*100).toFixed(0)} %</small>`:''}</td>
  <td>${x.arrival!==undefined?x.arrival.toFixed(1):'—'}${x.factor!==undefined&&x.factor<.9999?`<br><small>yaw ×${x.factor.toFixed(3)}</small>`:''}${x.air?`<br><small>air −${x.air.toFixed(1)}</small>`:''}</td>
  <td>${x.cost!==undefined?x.cost.toFixed(1):'—'}${x.charge!==undefined&&Math.abs(x.charge-x.cost)>.05?`<br><small>charge ${x.charge.toFixed(1)}</small>`:''}${x.S?`<br><small>S ${x.S.toFixed(2)} · q ${x.q.toFixed(2)}${x.mesh?' · mesh':''}</small>`:''}${x.rule&&x.rule!=='single'?`<br><small>${esc(x.rule)}</small>`:''}${x.era?`<br><small>ERA: ${esc(x.era)}</small>`:''}</td>
  <td>${x.ricochet?(x.ricochet*100).toFixed(1)+' %':'—'}</td><td><b>${esc(x.state)}</b>${x.residual!==undefined?`<br><small>${x.residual.toFixed(1)} mm</small>`:''}${x.armed?'<br><small>fuse armed</small>':''}</td></tr>`).join('');
 const burst=r.burst?`<p class="source">Burst: ${esc(r.burst.reason)}${r.burst.fragments?` · ${r.burst.fragments.N} body fragments (${esc(r.burst.fragments.class)}, R ${r.burst.fragments.R.toFixed(1)} m, ${r.burst.fragments.P.toFixed(1)} mm)`:''}${r.burst.pressure?` · overpressure ${r.burst.pressure.compartments.map(c=>esc(c.name)+(c.triggered?' applied':' not triggered')).join(', ')}`:''}${r.burst.splash?` · splash ${r.burst.splash.penetration.toFixed(1)} mm vs ${r.burst.splash.plate.toFixed(1)} mm plate`:''}</p>`:'';
 const jet=r.jet?`<p class="source">Jet: start ${r.jet.P0.toFixed(0)} mm (cumulativePierceDispersion draw), range ${r.jet.L} m, ended: ${esc(r.jet.end)}.</p>`:'';
 $$('paRecords').innerHTML=`<table class="paTable"><thead><tr><th>Stage</th><th>Part</th><th>Angle</th><th>Arrival mm</th><th>Cost mm</th><th>Ricochet</th><th>Result</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No part was hit.</td></tr>'}</tbody></table>${jet}${burst}<p class="source">${r.out.cones.length} spall cone(s), ${r.out.cones.reduce((s,c)=>s+c.fragments.length,0)} fragments traced · start penetration ${r.P0?.toFixed(1)} mm from ${esc(srcOf(r.pSource,sel))} at ${sel.range} m.</p>`;
 if(d){const killed=d.killed.map(k=>`<li><b>${esc(k.name)}</b> <small>${esc(k.why)}</small></li>`).join('')||'<li>None</li>';
  const eff=d.effects.map(e=>`<li>${esc(e.part)}: <b>${esc(e.effect)}</b> <small>p ${(e.p*100).toFixed(0)} % · ${esc(e.cause)}${e.blowout?' · vented (blow-out panel)':''}</small></li>`).join('')||'<li>None triggered</li>';
  $$('paDamage').innerHTML=`<div class="paCols"><div><b>Destroyed parts</b><ul>${killed}</ul></div><div><b>Damage effects</b><ul>${eff}</ul></div></div><p class="source">Crew: ${d.crewTotal-d.crewDead.length}/${d.crewTotal} alive (vehicle lost below ${d.minAlive}). ${d.damaged.length} parts took damage. Assumptions: ${d.assumptions.map(esc).join('; ')}. Part hp, hit rules and stowage flags come from the unit file; the 16-bit hp state and rule choice follow the documented runtime.</p>`;}
}
function runMC(){const n=+$$('paRuns').value;store.set('runs',n);if(!lastShot||!n||workerUnit!==unit){$$('paMC').innerHTML='';return;}const s=lastShot,sel=s.sel;mcId++;
 worker.postMessage({type:'mc',id:mcId,unit,shellIndex:sel.si,range:sel.range,wikiP:sel.wikiP,volumetric:$$('paMulti').checked,hidden:hidden(),state:$$('paPersist').checked?state:{dead:[],hp:{}},ammoLoaded:$$('paAmmo').checked,eraModel:$$('paEra').value,origin:s.origin,dir:s.dir,n,seed:s.seed});}
function renderMC(m){const pc=k=>(m[k]/m.n*100).toFixed(0);const bar=(label,k,c)=>`<div class="paStat"><span>${label}</span><div class="paBar ${c}"><i style="width:${pc(k)}%"></i></div><b>${pc(k)} %</b></div>`;
 const top=Object.entries(m.parts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`<li>${esc(k)} <b>${(v/m.n*100).toFixed(0)} %</b></li>`).join('');
 $$('paMC').innerHTML=`<b>Same shot, ${m.n} seeds</b>${bar('Penetration','penetration','pen')}${bar('Ricochet','ricochet','pos')}${bar('Vehicle destroyed','destroyed','bad')}${bar('Crew knocked out','crewKO','bad')}${bar('Ammo detonation','ammo','bad')}<p class="source">Mean crew lost ${(m.crewLost/m.n).toFixed(2)}. Most often destroyed:</p><ul class="paTop">${top||'<li>none</li>'}</ul><p class="source">Spread comes from the documented draws: ±2.5 % carry, jet start dispersion, ricochet rolls with normal jitter, spall directions and damage-effect rolls. The draw stream is seeded and reproducible, not the game's own RNG.</p>`;}
function renderShellInfo(){const sel=selection();const el=$$('paShell');if(!sel){el.innerHTML='';return;}
 if(!sel.shell){el.innerHTML=`<b>${esc(sel.ammo.name)}</b> · ${esc(sel.ammo.type)}<br><small class="warn">No exact datamine projectile match; this round is not simulated.</small>`;return;}
 const s=sel.shell,st=PA.startPenetration(s,sel.range,sel.wikiP),mech=PA.mechanismOf(s),pat=PA.rayOffsets(s,PA_DATA,true);
 el.innerHTML=`<b>${esc(sel.enemy.name)}</b> → <b>${esc(sel.ammo.name)}</b> <small>${esc(s.bulletName)} · ${esc(s.bulletType)}${sel.ammo.type.includes('/')?' · belt: fires its best-penetrating round':''}</small><br><small>${esc(mech)} · ${st.p?.toFixed(0)} mm at ${sel.range} m (${esc(srcOf(st.source,sel))})${s.cumulativeDamage?` · jet ${s.cumulativeDamage.armorPower} mm over ${s.cumulativeDamage.distance} m`:''}${mech==='tandem'?` · precharge ${Object.values(s.armorpower||{})[0]?.[0]??50} mm`:''} · ${pat.offsets.length} rays${pat.pattern?` (${esc(pat.pattern.src)})`:''}</small>`;}
// ---------------------------------------------------------------- ReplayHits interchange
function exportShot(){if(!lastShot)return;const s=lastShot,sel=s.sel,flip=$$('paFlipZ').checked,f=v=>flip?[v[0],v[1],-v[2]]:v;
 const blk=PA.writeReplayHit({object:mesh.unit,offenderObject:sel.enemy.id,weapon:'gameData/Weapons/groundModels_weapons/'+sel.shell.sourceFile.replace(/\.blkx$/,'.blk'),ammo:sel.shell.bulletName,ammoType:sel.shell.bulletType,lPos:f(s.origin),lDir:f(s.dir),distance:sel.range,seed:s.seed});
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([blk],{type:'text/plain'}));a.download=`aa_${mesh.unit}_${sel.shell.bulletName}_${s.seed}.blk`;document.body.append(a);a.click();a.remove();}
async function importShot(file){const h=PA.parseReplayHit(await file.text()),box=$$('paValidation');
 if(!h.lPos||!h.lDir||!h.ammo){box.innerHTML='<p class="warn">Not a ReplayHits file (needs ammo, lPos and lDir).</p>';return;}
 if(h.object&&mesh&&h.object.toLowerCase()!==mesh.unit.toLowerCase()){box.innerHTML=`<p class="warn">This hit targets ${esc(h.object)}; select that vehicle first (current: ${esc(mesh.unit)}).</p>`;return;}
 const si=PA_DATA.shells.findIndex(s=>s.bulletName===h.ammo);if(si<0){box.innerHTML=`<p class="warn">Projectile ${esc(h.ammo)} is not in the bundled library.</p>`;return;}
 const flip=$$('paFlipZ').checked,f=v=>flip?[v[0],v[1],-v[2]]:v,shell=PA_DATA.shells[si];
 let wikiP=null;for(const [uid,arr] of Object.entries(PA_DATA.match)){const i=arr.indexOf(si);if(i>=0){try{wikiP=CombatEngine.penetration(COMBAT_DATA.units[uid].ammo[i],h.distance||10,0,'wiki');}catch{}break;}}
 const sel={enemy:{id:h.offenderObject||'?',name:h.offenderObject||'ReplayHits shooter'},ammo:{name:h.ammo,type:h.ammoType||''},range:h.distance||10,si,shell,wikiP};
 const seed=(h.seed??+$$('paSeed').value)>>>0;$$('paSeed').value=seed;const ray={origin:f(h.lPos),dir:f(h.lDir)};
 const disabled=h.disabled.map(i=>mesh.nodes[i]?.name).filter(Boolean);
 const o={...opts(sel),state:{dead:disabled,hp:{}},rng:PA.makeRng(seed)},r=PA.shoot(prep,PA_DATA,shell,ray.origin,ray.dir,o);
 lastShot={ray,sel,seed,result:r,origin:ray.origin,dir:ray.dir,imported:file.name};if(viewer){viewer.marker=r.rows[0]?{point:r.rows[0].point}:null;drawShot(r);}renderResult(r,sel,0);
 box.innerHTML=`<p class="source">Replayed <b>${esc(file.name)}</b> (seed ${seed}${disabled.length?`, ${disabled.length} disabled parts`:''}). Our result: <b>${verdictText(r.verdict)}</b>. What did the game show for this file?</p>
  <span class="paRow"><button class="btn" data-native="penetration">Penetration</button><button class="btn" data-native="no-penetration">No penetration</button><button class="btn" data-native="ricochet">Ricochet</button></span>`;
 box.querySelectorAll('[data-native]').forEach(b=>b.onclick=()=>{const log=store.get('validation',[]);log.push({file:file.name,target:mesh.unit,ammo:h.ammo,seed,ours:r.verdict,game:b.dataset.native,firstPart:r.rows[0]?.name||null,time:new Date().toISOString()});store.set('validation',log);renderModel();box.innerHTML='<p class="source">Saved to the validation log below.</p>';});}
// ---------------------------------------------------------------- model / validation table
function renderModel(){const log=store.get('validation',[]),agree=log.filter(x=>x.ours===x.game).length;
 const rule=(m,s,v,c)=>`<tr><td>${m}</td><td>${s}</td><td class="${c}">${v}</td></tr>`;
 $$('paModel').innerHTML=`<div class="scroll"><table class="paTable"><thead><tr><th>Mechanism</th><th>Rule and source</th><th>Status</th></tr></thead><tbody>
 ${rule('Start penetration','Lanz–Odermatt / De Marre with exponential drag; published table kept when the reconstruction differs by more than 3 %','Matches the Wiki tables for every bundled full-calibre AP/APC/APCBC/APHE round. Lanz–Odermatt constants reproduce your client’s protectionMapTestParams A=1005.17, B=−1.42658','ok')}
 ${rule('Per-part charge','plain q·T·S, mesh-charged q·chord·cosθ·S, thin modules q·T, caps after slope, cost max(charge, armorThrough) [doc 4.6]','Documented live within 0.15 %','ok')}
 ${rule('Slope table','cos-space interpolation of 1/S, caliberToArmor blend, breach (armorBreachK 7) and scale cap 20 [doc 2.8, 2.11]','Live within 0.075 % for apds_fs_long; full-calibre blend static','ok')}
 ${rule('Multiray volume','centre + rings, chain step 0.0006·cal·clamp(tanθ), weight = ray share, used/min/max overlap 0.1/0.3/0.8, record cos = max [doc 4.6]','Constants confirmed by your client dump (shellVolume "multiray", 0.3/0.8). Ring scale for sub-calibre patterns assumed','pos')}
 ${rule('Ricochet','preset rows by caliberToArmor, roll before the pen test, reflection with normal jitter 0.01, ricochetPenetrationModifier, speed × 0.3, yaw rate 0.25·angle [doc 2.10]','Rules live-checked; jitter and modifier curve match your client dump','ok')}
 ${rule('Carry and yaw','±2.5 % uniform arrival spread (pierceDispersion 0.05), stability penetrationReduction compounding [doc 4.6]','Live, 59 values replayed in the source','ok')}
 ${rule('HEAT jet','start armorPower·(1+0.05u), u~N(0,0.3) clipped; air loss entry-to-entry (exit for mesh-charged); q·T/cos, mesh q·chord [doc 3.4]','Static + live; d=0.05 is the source’s guess','pos')}
 ${rule('Tandem / ERA','precharge body (50 mm, tandemPrechargeArmorQuality) pierces or stops; burst fuseDelayDist+0.01 past the record or at the face; jet starts at that plate, so pierced ERA is bypassed [doc 3.3b]','Live-checked rules. ERA charged by per-mechanism quality: Kontakt-1 cumulative 2.86·70/cos60° = 400 mm equals its listed equivalent','ok')}
 ${rule('Long-rod vs heavy ERA','genericLongRodArmorQuality replaces generic quality when present','Assumption (combine not decoded)','warn')}
 ${rule('Fuse / APHE burst','arming on a perforated part with charge > explodeTreshold; burst fuseDelayDist after entry; statistical shatters drawn as rays','Arming live; APHE statistical model approximated','pos')}
 ${rule('Spall cones','one cone per perforated plate, axis = flight, uniform solid angle, preset scale curves, gates 3.3 mm / ×90, fragment pen/damage along the ray [doc 3.2]','Live-checked rules; sabot petals and post-draw removals not modelled','pos')}
 ${rule('Damage','16-bit hp state, highest matching rule, onHit gate, exclusive onKill, crew minimum, stowage fatal flags, overpressure compartments [doc 3.5, 3.4b]','Static + partial live. Ammo occupancy assumed full; splash voxels not modelled','pos')}
 ${rule('Random stream','seeded mulberry32 for every documented draw','Native RNG not decoded: same seed ≠ same game outcome','warn')}
 ${rule('Native shot agreement','ReplayHits files replayed here and compared with the game',log.length?`${agree}/${log.length} saved comparisons agree`:'No saved game shots yet (your ReplayHits folder was empty)',log.length&&agree===log.length?'ok':'warn')}
 </tbody></table></div>${log.length?`<details><summary>Validation log (${log.length})</summary><div class="scroll"><table class="paTable"><thead><tr><th>File</th><th>Ammo</th><th>Ours</th><th>Game</th></tr></thead><tbody>${log.map(x=>`<tr class="${x.ours===x.game?'':'st-stopped'}"><td>${esc(x.file)}</td><td>${esc(x.ammo)}</td><td>${esc(x.ours)}</td><td>${esc(x.game)}</td></tr>`).join('')}</tbody></table></div><button class="btn" id="paClearLog">Clear log</button></details>`:''}
 <p class="source">How to compare with the game: fire a shot here, export it, copy the .blk into the game's ReplayHits folder, open Protection Analysis on the same vehicle and load the file (the shooter must carry that ammunition). Or save a shot in the game (HitsAnalysis, PC) and import it here. A shot only counts as agreement for the same seed and part state. Sources: <a href="https://github.com/FURRO404/WT_KNOWLEDGE_DOCS/blob/88ae223105419a11ce5a2b68d223ec99c77e3532/docs/06-ballistics-and-armor.md" target="_blank" rel="noopener noreferrer">WT_KNOWLEDGE_DOCS 06 @88ae223</a> · <a href="https://github.com/gszabi99/War-Thunder-Datamine/tree/bdb4575cf12de70a513eff44e6bd1ef29cf2fb75" target="_blank" rel="noopener noreferrer">datamine @bdb4575</a> · combat_sources/native/protectionMapTestParams.blk (your client).</p>`;
 $$('paClearLog')?.addEventListener('click',()=>{store.set('validation',[]);renderModel();});}

// ---------------------------------------------------------------- X-ray part filter (same groups as the game's filter)
function renderFilter(){const menu=$$('paFilterMenu');if(!menu||!viewer)return;const cats=PAViewer.XCATS,on=viewer.xfilter;
 menu.innerHTML=`<label class="paFAll"><input type="checkbox" data-all ${cats.every(c=>on.has(c[0]))?'checked':''}> Select All</label>`+cats.map(([k,label,col])=>`<label><span class="paSw" style="background:${col}"></span>${esc(label)}<input type="checkbox" data-cat="${k}" ${on.has(k)?'checked':''}></label>`).join('');
 menu.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{let set=new Set(viewer.xfilter);if(inp.dataset.all!==undefined)set=inp.checked?new Set(cats.map(c=>c[0])):new Set();else if(inp.checked)set.add(inp.dataset.cat);else set.delete(inp.dataset.cat);
  viewer.setFilter(set);store.set('xfilter',[...set]);renderFilter();if(viewer.mode==='inspect')renderInspector();});
 const n=cats.filter(c=>on.has(c[0])).length;$$('paFilterBtn').textContent=n===cats.length?'X-ray part filter':`X-ray part filter (${n}/${cats.length})`;}
if(viewer){const saved=store.get('xfilter',null);if(Array.isArray(saved))viewer.xfilter=new Set(saved);
 $$('paFilterBtn').onclick=e=>{e.stopPropagation();const m=$$('paFilterMenu');m.hidden=!m.hidden;$$('paFilterBtn').setAttribute('aria-expanded',String(!m.hidden));if(!m.hidden)renderFilter();};
 document.addEventListener('click',e=>{if(!$$('paFilterBox').contains(e.target)){$$('paFilterMenu').hidden=true;$$('paFilterBtn').setAttribute('aria-expanded','false');}});renderFilter();}
// ---------------------------------------------------------------- fullscreen viewport
// Real fullscreen where the browser allows it; otherwise (embedded browsers, kiosk shells) the view fills the window.
{const vp=$$('paViewport'),btn=$$('paFsBtn');let pseudo=false;
 const isFs=()=>document.fullscreenElement===vp||pseudo;
 // fullscreen dock: the toolbar and the Inspect panel move into the fullscreen view (and back on exit), so every
 // option keeps working there; "Options" hides the dock to admire the image
 const dock=document.createElement('div');dock.className='paFsDock';dock.innerHTML='<div class="paFsTop" id="paFsTop"></div><div class="paFsSide" id="paFsSide"></div>';vp.appendChild(dock);
 const optBtn=document.createElement('button');optBtn.className='paFsBtn';optBtn.id='paFsOpt';optBtn.textContent='Options';optBtn.title='Show or hide the options in fullscreen';$$('paFsBtn').before(optBtn);
 optBtn.onclick=()=>{const hide=!vp.classList.contains('paFsNoDock');vp.classList.toggle('paFsNoDock',hide);store.set('fsDock',!hide);};
 if(store.get('fsDock',true)===false)vp.classList.add('paFsNoDock');
 let homes=null;
 const dockIn=()=>{if(homes)return;const tb=sec.querySelector('.paToolbar'),ins=$$('paInspect');homes=[[tb,tb.parentNode,tb.nextSibling],[ins,ins.parentNode,ins.nextSibling]];$$('paFsTop').appendChild(tb);$$('paFsSide').appendChild(ins);};
 const dockOut=()=>{if(!homes)return;for(const [el,par,next] of homes)par.insertBefore(el,next);homes=null;};
 const sync=()=>{const on=isFs();on?dockIn():dockOut();optBtn.hidden=!on;vp.classList.toggle('paFs',on);vp.classList.toggle('paFsWin',pseudo);document.documentElement.classList.toggle('paFsLock',pseudo);
  btn.textContent=on?'✕':'⛶';btn.title=on?'Leave fullscreen (Esc)':'Fullscreen (Esc to leave)';btn.setAttribute('aria-label',on?'Leave fullscreen':'Fullscreen');
  const P=window.PAPT,pt=!!(on&&P&&P.enabled&&viewer?.mode==='inspect'&&viewer.plainModel);$$('paFsSave').hidden=!pt;$$('paFsPT').hidden=!pt||!vp.classList.contains('paFsNoDock');if(pt)fillFs();$$('paFsStat').textContent=pt?P.status:'';
  if(viewer)requestAnimationFrame(()=>{viewer.resize();viewer.draw();});};
 const setPseudo=on=>{pseudo=on;sync();};
 btn.onclick=async()=>{if(document.fullscreenElement){document.exitFullscreen();return;}if(pseudo){setPseudo(false);return;}
  try{if(!vp.requestFullscreen)throw Error('no fullscreen API');await vp.requestFullscreen({navigationUI:'hide'});}catch(e){setPseudo(true);}};
 $$('paFsSave').onclick=()=>window.PAPT?.saveImage();
 // quality and resolution are also changeable in fullscreen; both stay in sync with the Inspect panel
 const RES=[['view','Viewport'],['1080','1920 × 1080'],['1440','2560 × 1440'],['2160','3840 × 2160 (4K)']];
 const fillFs=()=>{const P=window.PAPT;if(!P)return;const q=$$('paFsQ'),r=$$('paFsRes');
  if(!q.options.length)q.innerHTML=Object.entries(P.PRESETS).map(([k,v])=>`<option value="${k}">${esc(v.label)}${Number.isFinite(v.spp)?' · '+v.spp.toLocaleString():''}</option>`).join('');
  if(!r.options.length)r.innerHTML=RES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
  if(document.activeElement!==q)q.value=P.preset;if(document.activeElement!==r)r.value=P.res;};
 $$('paFsQ').onchange=()=>{const v=$$('paFsQ').value;window.PAPT?.setPreset(v);if($$('paPTPreset'))$$('paPTPreset').value=v;};
 $$('paFsRes').onchange=()=>{const v=$$('paFsRes').value;window.PAPT?.setRes(v);if($$('paPTRes'))$$('paPTRes').value=v;if($$('paPTScaleBox'))$$('paPTScaleBox').hidden=v!=='view';};
 document.addEventListener('fullscreenchange',sync);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pseudo){setPseudo(false);}});
 // path-tracing progress shown on the image while in fullscreen
 setInterval(()=>{if(!isFs())return;const P=window.PAPT,on=!!(P&&P.enabled&&viewer?.mode==='inspect'&&viewer.plainModel);$$('paFsStat').textContent=on?P.status:'';$$('paFsSave').hidden=!on;$$('paFsPT').hidden=!on||!vp.classList.contains('paFsNoDock');if(on)fillFs();},500);}
// ---------------------------------------------------------------- wiring
if(viewer){viewer.on('hover',hover);viewer.on('shoot',(x,y)=>viewer.mode==='inspect'?inspectPin(x,y):fire(x,y));viewer.on('view',()=>{if(viewer.map&&viewer.map.stamp!==viewer.stamp())viewer.setMap(null);requestMap();});}
$$('paViews').addEventListener('click',e=>{const v=e.target.dataset.pav;if(v&&viewer){viewer.setView(v);store.set('view',v);}});
$$('paModes').addEventListener('click',e=>{const m=e.target.dataset.m;if(!m||!viewer)return;viewer.setMode(m);$$('paLegend').classList.toggle('paHide',m!=='armor');$$('paInspect').hidden=m!=='inspect';$$('pa3d').classList.toggle('paInspecting',m==='inspect');if(m!=='inspect'&&viewer.inspectArmor){viewer.inspectArmor=false;viewer.rebuildColors();viewer.draw();}if(m==='inspect')renderInspector();else if(pinned){pinned=null;viewer.highlight=new Set();viewer.rebuildColors();viewer.draw();}[...$$('paModes').children].forEach(b=>b.classList.toggle('on',b.dataset.m===m));});
$$('paEra').value=store.get('era','quality');$$('paEra').onchange=()=>{store.set('era',$$('paEra').value);if(lastShot)fire(0,0,lastShot.ray);requestMap();};
$$('paStyle').value=store.get('style','figures');if(viewer)viewer.moduleStyle=$$('paStyle').value;$$('paStyle').onchange=()=>{store.set('style',$$('paStyle').value);viewer?.setModuleStyle($$('paStyle').value);};
$$('paMap').onchange=()=>{store.set('map',$$('paMap').value);requestMap();};
$$('paNewSeed').onclick=()=>{$$('paSeed').value=Math.floor(Math.random()*4294967295);if(lastShot)fire(0,0,lastShot.ray);};
$$('paSeed').onchange=()=>{if(lastShot)fire(0,0,lastShot.ray);};
$$('paRuns').onchange=runMC;
for(const id of ['paMulti','paFitted','paAmmo','paPersist'])$$(id).onchange=()=>{store.set(id,$$(id).checked);if(id==='paFitted'&&viewer)viewer.setHidden(hidden());if(lastShot)fire(0,0,lastShot.ray);requestMap();};
// ---------------------------------------------------------------- clearing shots (button, or after 1 min without activity)
let shotShown=false,idleTimer=0;
function clearShots(){if(!viewer)return;shotShown=false;clearTimeout(idleTimer);viewer.setLines([]);viewer.marker=null;viewer.labels=[];viewer.highlight=new Set();
 viewer.setState($$('paPersist').checked?state.dead:[],new Map());
 $$('paVerdict').className='paVerdict';$$('paVerdict').innerHTML='<b>Shots cleared</b><span>Click the model to fire the selected shell.</span>';}
function armIdle(){clearTimeout(idleTimer);if(shotShown&&$$('paAutoClear').checked)idleTimer=setTimeout(clearShots,60000);}
$$('paClearShots').onclick=clearShots;
$$('paAutoClear').checked=store.get('autoClear',true);$$('paAutoClear').onchange=()=>{store.set('autoClear',$$('paAutoClear').checked);armIdle();};
for(const ev of ['pointerdown','pointermove','wheel','keydown'])$$('pa3d').addEventListener(ev,()=>{if(shotShown)armIdle();},{passive:true});
$$('paReset').onclick=()=>{state={dead:[],hp:{}};if(viewer)viewer.setState([],new Map());requestMap();};
$$('paExport').onclick=exportShot;$$('paImport').onchange=e=>{const f=e.target.files[0];if(f)importShot(f);e.target.value='';};
const prevRender=window.renderShells;window.renderShells=function(){prevRender.apply(this,arguments);try{sync();if(lastShot&&prep){const s=selection();if(s?.shell)fire(0,0,lastShot.ray);}}catch(e){console.warn('PA sync',e);}};
renderModel();sync();
window.PAUI={fire:(o,d)=>fire(0,0,{origin:o,dir:d}),viewer:()=>viewer,mesh:()=>mesh,last:()=>lastShot,prep:()=>prep,selection};
})();
