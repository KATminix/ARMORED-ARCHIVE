/* Vehicle-specific combat profiles and selected-loadout animations. */
const combatEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const combatLink=(u,t)=>`<a href="${combatEscape(u)}" target="_blank" rel="noopener noreferrer">${combatEscape(t)}</a>`;
const combatProfile=()=>COMBAT_DATA.profiles[family+':'+variant];
const combatUnit=()=>COMBAT_DATA.units[combatProfile().unit];
let combatAmmo=0;
function combatContext(){
 let key='late';
 if(combatProfile().roster)return COMBAT_ROSTERS[combatProfile().roster];
 if(family==='iv'&&variant==='f1')key='early';
 else if(family==='iv'&&['f2','g'].includes(variant))key='mid';
 else if(family==='leopard1')key=variant==='a5'?'lateTanks':'coldTanks';
 else if(family==='flakpanzer')key='support';
 else if(family==='raketenjagdpanzer')key=variant==='rakjpz1'?'earlySupport':variant==='rakjpz2'?'missileSupport':'support';
 else if(family==='marder')key=variant==='a5'?'modernSupport':'lateSupport';
 return COMBAT_ROSTERS[key];
}
function opponentRole(id){
 const br=COMBAT_ROSTERS[combatProfile().roster];if(br?.roles?.[id])return br.roles[id]+(br.service?.[id]?' · '+br.service[id]:'');
 const roster=combatProfile().roster;
 const cold=roster?!['early','mid','late'].includes(roster):['leopard1','flakpanzer','raketenjagdpanzer','marder'].includes(family);
 if(id==='uk_centurion_mk_10')return 'NATO peer';
 const prefix=cold?(['modernTanks','modernSupport'].includes(roster)||(family==='marder'&&variant==='a5')?'Soviet-origin':'Warsaw Pact'):'Allied';
 const role=id.includes('bmp')?'IFV':id.includes('btr')?'APC':id.includes('zsu')?'SPAA':id.includes('2s3')?'self-propelled artillery':/asu_|su_|isu_|it_1|us_m36/.test(id)?'tank destroyer':'tank';
 return prefix+' '+role;
}
function combatOpponents(){
 const context=combatContext();$('combatEra').textContent=context.era+' · '+context.ids.length+' opponents';$('combatEnemyNote').textContent=context.note;
 $('enemyVehicle').innerHTML=context.ids.map(id=>`<option value="${id}">${combatEscape(COMBAT_DATA.units[id].name)}${id==='us_m26_pershing'?' (1945)':''} · ${family==='marder'&&variant==='a5'?opponentRole(id).replace('Warsaw Pact','Soviet-origin'):opponentRole(id)}</option>`).join('');
 combatEnemyShells();
}
function combatEnemyShells(){
 const unit=COMBAT_DATA.units[$('enemyVehicle').value];
 const image=$('opponentCard'),card=OPPONENT_WT_CARDS[unit.id]||{};image.hidden=false;image.onerror=()=>{image.onerror=null;image.hidden=true;};image.src=card.art||'';image.alt=unit.name+' · War Thunder vehicle artwork';image.title=card.art&&card.art.startsWith('/api/local/')?'Read from your War Thunder installation':'';
 $('shell').innerHTML=unit.ammo.map((a,i)=>`<option value="${i}">${combatEscape(a.name)} · ${combatEscape(a.type)}</option>`).join('');
 renderShells();
}
let armorZoneKey='';
const combatProfileNote=()=>combatProfile().note==='Summary plate model only; composite/add-on/ERA protection is not simulated.'?'':combatProfile().note;
function selectedArmorZone(){
 const unit=combatUnit(),surface=$('surface').value,zones=ArmorModel.zones(unit,surface,ARMOR_DATA),key=unit.id+':'+surface;
 const previous=armorZoneKey===key?$('armorZone').value:'';armorZoneKey=key;
 $('armorZone').innerHTML=zones.map(z=>`<option value="${combatEscape(z.id)}">${combatEscape(z.label)}</option>`).join('');
 if(zones.some(z=>z.id===previous))$('armorZone').value=previous;
 return zones.find(z=>z.id===$('armorZone').value)||zones[0];
}
function protectionText(p){
 if(p.min===null||!Number.isFinite(p.min))return 'Unverified';
 if(p.max===null)return '≥ '+Math.round(p.min)+' mm RHAe';
 if(Math.abs(p.max-p.min)<1)return Math.round(p.min)+' mm RHAe';
 return Math.round(p.min)+'–'+Math.round(p.max)+' mm RHAe';
}
function layerProperty(l,kind){
 const rod=l.genericLongRodArmorQuality??l.materialProps?.genericLongRodArmorQuality;
 const eq=kind==='ke'?'kineticProtectionEquivalent':'cumulativeProtectionEquivalent';if(Number.isFinite(l[eq]))return l[eq]+' mm equivalent'+(kind==='ke'&&rod!==undefined?' · long-rod response '+rod+' unresolved':'');
 const q=kind==='ke'?'genericArmorQuality':'cumulativeArmorQuality';const factor=(l[q]??l.materialProps?.[q]??1)*(l.armorQuality??l.materialProps?.armorQuality??1);
 const cap=kind==='ke'?l.genericEffectiveThicknessMax:l.cumulativeEffectiveThicknessMax;
 return 'q '+Number(factor.toFixed(3))+(cap!==undefined?' · cap '+cap+' mm':'');
}
renderArmor=function(){
 const u=combatUnit(),zone=selectedArmorZone(),angle=+$('angle').value,spent=$('eraState').value==='spent',m=ARMOR_DATA.models[u.id];
 const hasERA=zone.layers.some(l=>/era/.test(l.material+' '+l.id)&&!/nera/.test(l.material+' '+l.id));$('eraStateLabel').hidden=!hasERA;
 const ke=ArmorModel.protection(zone,{type:'APFSDS'},angle,spent),ce=ArmorModel.protection(zone,{type:'HEATFS'},angle,spent);
 $('angleVal').textContent=angle+'°';
 $('armorGrid').innerHTML=[['KE · APFSDS',protectionText(ke)],['Chemical · HEAT',protectionText(ce)],['Impact angle',angle+'°'+(zone.reference?' · frontal reference at 0°':'')],['Protection model',zone.reference?'Published zone reference':zone.unresolved?'Unresolved hit path':zone.component?'Isolated component':zone.estimate?'Representative layer path':'Summary plate']].map(([k,v])=>`<div class="armor"><span>${k}</span><b>${combatEscape(v)}</b></div>`).join('');
 $('armorNote').innerHTML=`${combatProfileNote()?'<b class="warn">'+combatEscape(combatProfileNote())+'</b><br>':''}${combatEscape(zone.note||'Single Wiki summary plate. Multiple layers, fitted screens and mantlets are not included in this isolated comparison.')} ${m?combatLink(m.source,'Pinned datamine · '+u.name)+' · '+combatLink(ARMOR_DATA.classSource,'Material classes'):combatLink(u.source,'Wiki armour source')}${zone.reference?'<br>'+Object.values(zone.reference).filter(r=>r?.source).map(r=>combatLink(r.source,r.label)).join(' · '):''}`;
 $('armorLayers').innerHTML=(zone.layers.length?`<details class="layerInventory" ${zone.summary?'':'open'}><summary>${zone.inventory?'Armour component inventory · not a summed mesh ray':'Selected layers · outside to inside'}</summary><div class="scroll"><table><thead><tr><th>Layer / component</th><th>Physical thickness</th><th>Material</th><th>KE parameter</th><th>Chemical parameter</th></tr></thead><tbody>${zone.layers.map(l=>`<tr><td>${combatEscape(l.label)}</td><td>${l.armorThickness===null?'Unpublished':l.armorThickness+' mm'}${l.variableThickness?' · variable':''}</td><td>${combatEscape(l.material)}</td><td>${combatEscape(layerProperty(l,'ke'))}</td><td>${combatEscape(layerProperty(l,'ce'))}</td></tr>`).join('')}</tbody></table></div><p class="source">Physical thickness is not RHA equivalent. Material scalars and caps are preserved from the datamine; the game’s directional NERA response cannot be recovered from these values alone. Spall liners reduce fragments and are not added as frontal penetration resistance.</p></details>`:'')+(u.id==='germ_leopard_2a7v'?`<details class="layerInventory"><summary>Gaijin frontal protection map · 600 mm APFSDS reference</summary><img class="armorReferenceMap" src="combat_sources/armor/leo2a7-reference-map.jpg" alt="Gaijin’s December 2023 Leopard 2A7V frontal map: green weak regions include the mantlet, turret ring and lower hull; dark cheeks resist the illustrated 600 mm APFSDS threat."/><p class="source">Published 22 December 2023. Green indicates vulnerability to the illustrated threat, not ERA coverage. ${combatLink('https://warthunder.com/de/news/6052-dev-blog-antworten-auf-eure-fragen-zu-spall-linern-mbts-und-flugzeugen-de','Original developer explanation')}</p></details>`:'');
};
renderShells=function(){
 if(!$('enemyVehicle').value)return;
 renderArmor();
 const enemy=COMBAT_DATA.units[$('enemyVehicle').value],ammo=enemy.ammo[+$('shell').value||0],zone=selectedArmorZone(),angle=+$('angle').value,range=+$('range').value,method=$('combatMethod').value;
 const result=ArmorModel.assess(zone,ammo,range,angle,method,$('eraState').value==='spent'),dm=CombatEngine.deMarre(ammo);
 $('enemyAmmoDetails').innerHTML=ammoDetails(ammo,enemy);
 $('shellTable').innerHTML=`<tr><td>${combatLink(enemy.source,enemy.name)}<br><b>${combatEscape(ammo.name)}</b> · ${combatEscape(ammo.type)}</td><td>${result.p===null?'—':result.p.toFixed(1)+' mm'}<br><small>${result.protection.reference?'0° RHA table / frontal reference':angle+'° table'} · ${range} m</small></td><td>${combatEscape(protectionText(result.protection))}<br><small>${combatEscape(zone.label)} · ${result.protection.kind==='ke'?'KE':result.protection.kind==='tandem'?'Tandem chemical':'Chemical / special'}</small></td><td class="${result.cls}"><b>${result.status}</b></td><td>${combatEscape(result.detail)}</td></tr>`;
 $('combatReadout').innerHTML=`${combatProfileNote()?'<b class="warn">Reference-profile result, not the historical variant.</b> ':''}${ammo.type.includes('/')?'Belt figures describe the best-penetrating component. ':''}${method==='formula'?(dm===null?'This projectile uses its published Wiki table; the full-calibre De Marre formula does not apply.':`De Marre muzzle estimate: ${dm.toFixed(1)} mm. Range and angle retention use the Wiki table, scaled to that baseline.`):'Published shell penetration tables are retained.'} ${result.protection.reference?'This sourced frontal RHAe reference already includes its armour path; no extra LOS factor is applied.':zone.estimate?'Representative layer calculation: Σ(tᵢ × applicable material modifier), compared with the shell’s angle-adjusted penetration. The angle is not applied a second time. ERA uses explicit KE/chemical equivalents.':'Composite or variable mesh paths are not replaced by a flat-thickness verdict.'} ${result.protection.uncertainty?'Armour uncertainty ±'+Math.round(result.protection.uncertainty*100)+'%, separately from ±5% shell dispersion.':''}`;
};
function clipFor(a,type){
 if(type==='APFSDS')return 'apfsds';if(type==='APDS')return a.type.includes('/')||a.kind.includes('belt')?'apds_belt':'apds';
 if(/APCR|HVAP/.test(type))return a.type.includes('/')?'apcr_belt':'apcr';
 if(type.startsWith('ATGM'))return 'atgm';if(type==='HEATFS')return 'heatfs';if(type==='HEAT')return 'heat';if(type==='HESH')return 'hesh';if(type==='R')return 'rocket';if(type==='Smoke')return 'smoke';
 if(/HEFI|HEI|HEF/.test(type))return 'hei';if(type==='HE')return 'he';if(/API|AP-I/.test(type))return 'api';
 if(type.includes('APHE')||(['APC','APCBC'].includes(type)&&a.props['Explosive Mass']))return 'aphe';
 if(type.startsWith('AP'))return a.type.includes('/')?'ap_belt':'ap';return null;
}
renderDbShells=function(){
 const u=combatUnit();
 if(!u.ammo.length){$('animationAmmo').innerHTML='<option>No independently fired ammunition listed</option>';$('animationAmmo').disabled=true;$('datamineShellTable').innerHTML='<tr><td colspan="3">This vehicle has no published independently fired projectile loadout. Linked system launchers have separate entries in the collection.</td></tr>';$('animationNote').textContent='';$('selectedAmmoDetails').innerHTML='';return}
 $('animationAmmo').disabled=false;
 const a=u.ammo[combatAmmo]||u.ammo[0],types=[...new Set(a.type.split('/'))];
 $('animationAmmo').innerHTML=u.ammo.map((x,i)=>`<option value="${i}" ${i===combatAmmo?'selected':''}>${combatEscape(x.name)} · ${combatEscape(x.type)}</option>`).join('');
 $('datamineShellTable').innerHTML=types.map(type=>{
  const clip=clipFor(a,type);return `<tr><td><b>${combatEscape(a.name)}</b><br>${combatEscape(u.name)}</td><td>${combatEscape(type)}${a.type.includes('/')?'<br><small>Belt component</small>':''}</td><td>${clip?`<video class="dbVideo" src="/media/selected_${clip}.mp4" controls muted loop playsinline preload="metadata"></video>`:'No matching segment identified in the supplied compilation.'}</td></tr>`;
 }).join('');
 const dm=CombatEngine.deMarre(a);
 $('selectedAmmoDetails').innerHTML=ammoDetails(a,u);
 $('animationNote').innerHTML=`${combatProfile().note?combatEscape(combatProfile().note)+' ':''}Illustrations show the shell mechanism, not the exact projectile dimensions or a simulation of this vehicle. ${types.some(t=>/API|HEI|HEFI/.test(t))?'API/HEI clips retain the compilation’s aircraft labels; these illustrate the same incendiary mechanism for autocannon belt components. ':''}${dm!==null?' · De Marre muzzle estimate: '+dm.toFixed(1)+' mm':''}`;
};
renderAmmo=function(){
 const u=combatUnit();$('ammoTitle').textContent='Ammunition & penetration';
 $('ammoTable').innerHTML=u.ammo.map((a,i)=>`<tr class="${i===combatAmmo?'selectedAmmo':''}"><td><button class="btn" data-ammo="${i}">${combatEscape(a.name)} ▶</button></td><td>${combatEscape(a.type)}${ammoGuidance(a)?`<br><span class="guidanceBadge">${combatEscape(ammoGuidance(a))}</span>`:""}</td>${a.pen.map(n=>`<td>${n===null?"—":n}</td>`).join('')}<td>${combatEscape(ammoPayload(a).composition)}</td><td>${combatEscape(ammoPayload(a).mass)}</td><td>${combatEscape(ammoPayload(a).tnt)}</td></tr>`).join('')||'<tr><td colspan="11">No independently fired ammunition is listed for this sensor/control vehicle. Select its launcher entry to view the missile loadout.</td></tr>';
 $('ammoNote').innerHTML=`${combatLink(u.source,u.name+' · War Thunder Wiki')} · Retrieved ${COMBAT_DATA.retrieved}. Values at 0° in mm. Belt values are maximum component penetration. HE/rocket values refer to explosive effects; HESH is affected obstacle thickness. Rifle-calibre machine guns are omitted. ${combatEscape(combatProfile().note)}`;
 document.querySelectorAll('[data-ammo]').forEach(b=>b.onclick=()=>{combatAmmo=+b.dataset.ammo;renderAmmo();renderDbShells()});
};
const beforeCombatRender=renderAll;
renderAll=function(){combatAmmo=0;beforeCombatRender();combatOpponents();renderDbShells()};
$('enemyVehicle').onchange=combatEnemyShells;$('combatMethod').onchange=renderShells;
$('animationAmmo').onchange=()=>{combatAmmo=+$('animationAmmo').value;renderAmmo();renderDbShells()};

// Resolve the current renderer when controls change; the archive's initial
// inline handlers were attached before the sourced combat renderer was loaded.
$('shell').onchange=()=>renderShells();
$('range').onchange=()=>renderShells();

$('armorZone').onchange=()=>{renderArmor();renderShells()};
$('eraState').onchange=()=>{renderArmor();renderShells()};
