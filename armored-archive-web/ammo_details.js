/* Published Wiki ammunition cards, shared by own and opposing loadouts. */
const AMMO_GUIDE='https://wiki.warthunder.com/weapon/2544-tank-ammunition';
function ammoGuidance(a){return a.props.Guidance||'';}
function ammoMechanism(a){
 const t=a.type,p=a.props;
 if(t.includes('/'))return 'A repeating belt of the listed projectile types.';
 if(t.startsWith('ATGM'))return 'Guided missile with a shaped-charge warhead.';
 if(t==='APFSDS')return 'Fin-stabilised penetrator; the sabot separates after firing.';
 if(t==='APDS')return 'Sub-calibre penetrator with a discarding sabot.';
 if(/APCR|HVAP/.test(t))return 'Hard penetrator inside a non-discarding carrier.';
 if(t.startsWith('HEAT'))return 'Shaped-charge jet; penetration does not fall with distance.';
 if(t==='HESH')return 'Squash-head explosive generates fragments from the armour interior.';
 if(t==='Smoke')return 'Produces a smoke screen.';
 if(t==='Shrapnel')return 'Explosive charge disperses preformed projectiles.';
 if(t==='R')return 'Unguided explosive rocket.';
 if(t.startsWith('HE'))return t==='HE-VT'?'High-explosive fragmentation with a proximity fuze.':'Blast and fragmentation on detonation.';
 if(t.startsWith('AP'))return p['Explosive Mass']?'Kinetic penetration followed by an explosive burst.':'Kinetic shot; damage comes from impact and fragments.';
 return '';
}

function ammoPayload(a){
 const p=a.props,has=!!p['Explosive Mass'],belt=a.type.includes('/')||a.kind.includes('belt');
 const unavailable=belt?'Not published per projectile':a.type==='Smoke'?'Not published':'No explosive filler';
 return {composition:p['Explosive Type']||unavailable,mass:p['Explosive Mass']||unavailable,tnt:p['TNT equivalent']||(has?'Not published':unavailable)};
}
function ammoPayloadDetails(a){
 const p=ammoPayload(a),e=combatEscape;
 return `<section class="ammoPayload" aria-label="Explosive payload"><h4>Explosive composition &amp; TNT yield</h4><dl class="payloadStats"><div><dt>Explosive composition</dt><dd>${e(p.composition)}</dd></div><div><dt>Explosive filler mass</dt><dd>${e(p.mass)}</dd></div><div class="payloadYield"><dt>TNT equivalent</dt><dd>${e(p.tnt)}</dd></div></dl>${a.tntCalculation?`<p class="source">Game TNT equivalent: ${e(a.tntCalculation.mass)} × ${a.tntCalculation.multiplier} strength multiplier = ${e(p.tnt)}. ${combatLink(a.tntCalculation.source,'Datamine explosive multipliers')}.</p>`:''}${a.type==='Smoke'?'<p class="source">Smoke composition is a smoke-producing payload; its game equivalence does not imply the blast effect of an HE warhead.</p>':''}${a.type.includes('/')||a.kind.includes('belt')?'<p class="source">Explosive or incendiary content depends on the belt component. The vehicle Wiki tooltip does not publish individual filler masses.</p>':''}</section>`;
}

function ammoDetails(a,u){
 const e=combatEscape,g=ammoGuidance(a),values=a.pen.filter(Number.isFinite),max=values.length?Math.max(...values):null;
 const label=a.type==='HESH'?'Affected obstacle thickness':/^(HE|HE-VT|R|Shrapnel)$/.test(a.type)?'Explosive-effect reference':a.type==='Smoke'?'Penetration reference':a.type.includes('/')?'Maximum belt-component penetration':'Maximum armour penetration';
 const guidance=g.includes('SACLOS')?'Semi-automatic command to line of sight: keep the sight on the target while the guidance system steers the missile.':g.includes('MCLOS')?'Manual command to line of sight: steer the missile yourself in Ground Realistic. Ground Arcade uses simplified semi-automatic control.':'';
 const effects=(a.effects||[]).map(f=>`<div class="ammoEffect"><h4>${e(f.label)}</h4>${f.rows?`<div class="scroll"><table><thead><tr>${f.rows[0].map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${f.rows.slice(1).map(r=>`<tr>${r.map(v=>`<td>${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="source">Penetration in mm; angles measured from the plate normal.</p>`:`<b>${e(f.value)}</b>`}</div>`).join('');
 return `<article class="ammoCard" aria-label="${e(a.name)} ammunition details">
 <div class="ammoHeading">${a.icon?`<img class="ammoIcon" src="${e(a.icon)}" alt="" loading="lazy">`:''}<div><div class="eyebrow">${e(u.name)} · ammunition</div><h3>${e(a.name)}</h3><p>${e(a.description||a.type)}</p></div>${g?`<span class="guidanceBadge">${e(g)}</span>`:''}</div>
 ${ammoMechanism(a)?`<p class="ammoMechanism">${e(ammoMechanism(a))}</p>`:''}
 ${guidance?`<div class="guidanceNote"><b>${e(g)}</b><p>${e(guidance)}</p></div>`:''}
 ${ammoPayloadDetails(a)}
 <dl class="ammoStats"><div class="ammoPrimary"><dt>${e(label)}</dt><dd>${max===null?"Not published":max+" mm"}</dd></div>${Object.entries(a.props).filter(([k])=>!['Explosive Type','Explosive Mass','TNT equivalent'].includes(k)).map(([k,v])=>`<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
 ${a.type.includes('/')?`<div class="beltInfo"><h4>Belt composition</h4><p class="beltSequence">${a.type.split('/').map(t=>`<span>${e(t)}</span>`).join('<span aria-hidden="true">→</span>')}</p>${a.components?.length?`<ul>${a.components.map(c=>`<li>${e(c)}</li>`).join('')}</ul>`:''}<p class="source">Belt-level penetration is the best-penetrating component. The Wiki vehicle tooltip does not publish individual projectile mass, velocity or fuze fields for this belt.</p></div>`:''}
 ${effects?`<details class="ammoEffects"><summary>Detailed penetration &amp; explosive effects</summary><p class="source">Separate Wiki effect channels. Blast and fragment values are not interchangeable with a shaped-charge jet or kinetic penetration.</p>${effects}</details>`:''}
 <div class="ammoFoot">${a.weapon?`<span>${a.weaponSource?combatLink(a.weaponSource,a.weapon):e(a.weapon)}</span>`:''}<span>${a.penSource?`${combatLink(u.source,'War Thunder Wiki · '+u.name)} · projectile data from the pinned datamine · penetration: ${e(a.penSource)}`:combatLink(u.source,'War Thunder Wiki · projectile data')} · ${combatLink(AMMO_GUIDE,'Shell types & guidance')} · Retrieved ${e(COMBAT_DATA.retrieved)}</span></div>
 ${a.props['Fuze Delay']||a.props['Fuze Sensitivity']?'<p class="source">Fuze delay in metres is travel after activation, not time. Fuze sensitivity is the minimum triggering thickness. TNT equivalent expresses explosive yield relative to TNT.</p>':''}
 </article>`;
}
