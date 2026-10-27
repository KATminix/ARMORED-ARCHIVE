/* Optional local game-model layer for the protection-analysis viewer.
   When the server can see a War Thunder installation on this computer, the exterior render model,
   its x-ray model and textures are read from the game at request time (never copied into the project)
   and drawn in place of the collision mesh. Without an installation everything falls back silently to
   the collision mesh and the app's own stand-in module figures. Shots, maps and picking always use the
   damage-model collision geometry. */
(function(){
'use strict';
const store={get(k,d){try{const v=localStorage.getItem('pa:'+k);return v===null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem('pa:'+k,JSON.stringify(v));}catch{}}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
let status=null,current=null,token=0;
const texPending=new Map();

// ---------------------------------------------------------------- payload parsing
function header(buf,magic){const dv=new DataView(buf);const tag=String.fromCharCode(...new Uint8Array(buf,0,4));if(tag!==magic)throw Error('Unexpected payload '+tag);
 const n=dv.getUint32(4,true);return {json:JSON.parse(new TextDecoder().decode(new Uint8Array(buf,8,n))),off:8+n};}
function parseModel(buf){const {json:h,off}=header(buf,'AAM1');let o=off;const take=(T,n)=>{const a=new T(buf,o,n);o+=n*T.BYTES_PER_ELEMENT;return a;};
 const m={...h,pos:take(Float32Array,h.verts*3),nrm:take(Float32Array,h.verts*3),uv:take(Float32Array,h.verts*2),idx:take(Uint32Array,h.indices)};
 if(h.uv2)m.uv2=take(Float32Array,h.verts*2);
 if(h.parts?.length&&o+h.verts*2<=buf.byteLength)m.part=take(Uint16Array,h.verts);return m;}
function parseTexture(buf){const {json:h,off}=header(buf,'AAT1');let o=off;return {...h,mips:h.mips.map(m=>{const data=new Uint8Array(buf,o,m.size);o+=m.size;return {w:m.w,h:m.h,data};})};}

// ---------------------------------------------------------------- UI
function ui(){if($('paExterior'))return;const tb=document.querySelector('#pa3d .paToolbar');if(!tb)return;
 const lab=document.createElement('label');lab.className='paInline';lab.innerHTML='Exterior <select id="paExterior"><option value="game">Game model</option><option value="collision">Collision mesh</option></select>';
 tb.appendChild(lab);
 const cam=document.createElement('label');cam.className='paInline';cam.id='paCamoBox';cam.hidden=true;cam.innerHTML='Camouflage <select id="paCamo"></select>';tb.appendChild(cam);
 $('paCamo').onchange=()=>applyCamo($('paCamo').value);
 const sel=$('paExterior');sel.value=store.get('exterior','game');
 sel.onchange=()=>{store.set('exterior',sel.value);const v=window.PAUI?.viewer?.();if(v)v.setVisualOn(sel.value==='game');credit();};
 const p=document.createElement('p');p.className='source';p.id='paGame';const cr=document.querySelector('#pa3d .paCredit');cr.parentNode.insertBefore(p,cr);
 renderStatus();}
function credit(){const el=$('paGameCredit')||(()=>{const c=document.querySelector('#pa3d .paCredit');if(!c)return null;const s=document.createElement('p');s.className='source paCredit';s.id='paGameCredit';c.after(s);return s;})();if(!el)return;
 const on=current?.main&&$('paExterior')?.value!=='collision';el.hidden=!on;
 if(on)el.textContent=`Exterior render model${current.textures?' and textures':''} © Gaijin Entertainment, read at runtime from the War Thunder installation on this computer (${current.main.pack}); nothing is copied into this project or served beyond localhost.`;}
function renderStatus(msg){const el=$('paGame');if(!el)return;const ex=$('paExterior');if(ex)ex.closest('label').hidden=!status?.found;
 if(status?.found){el.innerHTML=`Game models: reading from <code>${esc(status.dir)}</code>${status.source?` <small>(${esc(status.source)})</small>`:''}${msg?' · '+esc(msg):''} · <a href="#" id="paGameChange">change</a>`;}
 else if(status&&status.local===false){el.textContent='Game models are only available on the computer running the server; showing the collision mesh and stand-in figures.';return;}
 else{el.innerHTML=`War Thunder not found — showing the collision mesh and stand-in figures. <a href="#" id="paGameChange">Set game folder</a>`;}
 const a=$('paGameChange');if(a)a.onclick=e=>{e.preventDefault();askPath();};}
function askPath(){const el=$('paGame');el.innerHTML=`<span class="paRow"><input id="paGameDir" type="text" placeholder="e.g. E:\\SteamLibrary\\steamapps\\common\\War Thunder" value="${esc(status?.dir||'')}" style="min-height:30px"><button class="btn" id="paGameSave">Use folder</button><button class="btn" id="paGameCancel">Cancel</button></span>`;
 $('paGameCancel').onclick=()=>renderStatus();
 $('paGameSave').onclick=async()=>{const dir=$('paGameDir').value.trim();try{const r=await fetch('/api/local/game-dir',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dir})});const j=await r.json();
  if(!r.ok)throw Error(j.error||r.status);status=j;renderStatus();const m=window.PAUI?.mesh?.(),v=window.PAUI?.viewer?.();if(m&&v)onMesh(m,v);}catch(e){renderStatus('folder not accepted: '+e.message);}};}

async function probe(){try{const r=await fetch('/api/local/status');if(r.status===403){status={found:false,local:false};}else if(r.ok)status=await r.json();else status={found:false};}catch{status={found:false};}renderStatus();return status;}

// ---------------------------------------------------------------- loading
async function fetchModel(mesh,variant){const pack=String(mesh.pack||mesh.unit||'').replace(/\.grp$/i,'');
 const r=await fetch(`/api/local/model?unit=${encodeURIComponent(pack)}&model=${encodeURIComponent(mesh.model||'')}&variant=${variant}`);
 if(!r.ok)throw Object.assign(Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status)),{status:r.status});return parseModel(await r.arrayBuffer());}
async function loadTex(viewer,name){if(!name||viewer.texCache.has(name))return true;if(texPending.has(name))return texPending.get(name);
 const job=(async()=>{try{const r=await fetch('/api/local/texture?name='+encodeURIComponent(name));if(!r.ok)return false;return viewer.uploadTexture(name,parseTexture(await r.arrayBuffer()));}catch(e){console.warn('texture',name,e);return false;}finally{texPending.delete(name);}})();
 texPending.set(name,job);return job;}
// ---------------------------------------------------------------- camouflage (the game's skins: swap the standard camo texture)
const COUNTRY=/^(ger|germ|ussr|us|usa|uk|brit|jp|jap|it|ita|fr|fra|cn|chn|sw|swe|il|isr)_/;
function camoName(id){const t=String(id||'').replace(COUNTRY,'').replace(/^camo_/,'').split('_').map(w=>({carc:'CARC',nato:'NATO',un:'UN',threecolor:'three-colour',bicolor:'two-colour',tricolor:'three-colour',fourcolor:'four-colour'}[w]||w)).join(' ');return t.charAt(0).toUpperCase()+t.slice(1);}
let camoUnit=null;
function camoInfo(){return window.PA_XRAY?.units?.[camoUnit]?.camo||null;}
function fillCamo(unit){camoUnit=unit;const box=$('paCamoBox'),sel=$('paCamo'),info=camoInfo();if(!box||!sel)return;
 if(!info||!current?.main){box.hidden=true;return;}
 const std=info.standard?` (${camoName(info.standard)})`:'';
 sel.innerHTML=`<option value="">Standard${esc(std)}</option>`+info.skins.map(k=>`<option value="${esc(k.name)}">${esc(window.PA_XRAY.lang?.[k.loc]||camoName(k.name==='winter'?k.swaps[0].to:k.name))}</option>`).join('');
 const saved=store.get('camo:'+unit,'');sel.value=info.skins.some(k=>k.name===saved)?saved:'';box.hidden=false;if(sel.value)applyCamo(sel.value);}
async function applyCamo(name){const v=window.PAUI?.viewer?.(),info=camoInfo();if(!v||!info)return;store.set('camo:'+camoUnit,name);
 const skin=info.skins.find(k=>k.name===name),swaps=new Map((skin?.swaps||[]).map(r=>[r.from,r.to]));
 // make sure the replacement textures are on the GPU before switching
 const need=[...swaps.values()];let ok=0;for(const n of need)if(await loadTex(v,n))ok++;
 v.setSkin(swaps);if(need.length&&ok<need.length)renderStatus(`camouflage texture ${need.filter(n=>!v.texCache.has(n)).join(', ')} not found in this installation`);}
function clear(viewer){viewer.setSkin?.(new Map());if($('paCamoBox'))$('paCamoBox').hidden=true;viewer.setVisual('main',null);viewer.setVisual('xray',null);current=null;credit();}
async function onMesh(mesh,viewer){ui();const my=++token;clear(viewer);viewer.visualOn=$('paExterior')?.value!=='collision';
 if(!status)await probe();if(!status?.found||my!==token)return;
 renderStatus('loading '+(mesh.model||mesh.unit)+'…');
 let main=null;try{main=await fetchModel(mesh,'main');}catch(e){if(my===token)renderStatus('no render model for this vehicle ('+e.message+')');return;}
 if(my!==token)return;viewer.setVisual('main',main);current={main,textures:0};credit();
 fillCamo(mesh.unit);fetchModel(mesh,'xray').then(x=>{if(my===token)viewer.setVisual('xray',x);}).catch(()=>{});
 const names=new Set();for(const m of main.materials){if(m.t0)names.add(m.t0);if(/masked/.test(m.cls||'')&&m.t1)names.add(m.t1);if(m.t3&&/_ao$/.test(m.t3))names.add(m.t3);if(m.t2&&/_n$/.test(m.t2))names.add(m.t2);}
 const list=[...names];let done=0,ok=0;renderStatus(`${main.verts.toLocaleString()} vertices · textures 0/${list.length}`);
 const next=async()=>{while(list.length&&my===token){const n=list.shift();if(await loadTex(viewer,n))ok++;done++;if(my===token)renderStatus(`${main.verts.toLocaleString()} vertices · textures ${done}/${names.size}`);}};
 await Promise.all([next(),next(),next(),next()]);if(my!==token)return;current.textures=ok;credit();
 renderStatus(`${main.model} · ${main.verts.toLocaleString()} vertices · ${ok}/${names.size} textures`);}

window.PAGame={onMesh,probe,parseModel,parseTexture,get status(){return status;},get current(){return current;}};
const init=()=>{ui();probe().then(()=>{const m=window.PAUI?.mesh?.(),v=window.PAUI?.viewer?.();if(m&&v&&!current&&!token)onMesh(m,v);});};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
