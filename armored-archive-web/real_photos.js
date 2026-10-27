/* Decode explicitly assigned source images before displaying them. No live search. */
const galleryDecodedCache=new Map(),gallerySourceCooldown=new Map();
let galleryImageQueue=Promise.resolve();let remoteActive=0;const remoteWaiting=[];
function remoteSlot(fn){return new Promise((ok,ko)=>{const go=()=>{remoteActive++;fn().then(ok,ko).finally(()=>{remoteActive--;remoteWaiting.shift()?.();});};remoteActive<3?go():remoteWaiting.push(go);});}
const galleryKnownInvalid=new Set();
function realPhotoId(p){if(p.photoId)return p.photoId;if(p.page&&/\/wiki\/File:/i.test(p.page))return p.page;return p.original||p.url||p.full||p.thumb||VehicleMedia.photoId(p);}
function safeGalleryLink(href){try{const u=new URL(href);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null}}
function photoCategory(p){if(p.category)return p.category;const t=[p.title,p.objectName,p.categories,p.description].join(' ');if(/museum|musée|musee|panzermuseum|bovington|saumur|kubinka|memorial|preserved|surviving|displayed|exhibit/i.test(t))return'survivor';if(/bundesarchiv|194[0-5]|193[0-9]|wartime|battlefield|combat footage|destroyed|knocked.out/i.test(t))return'period';return'service';}
function standardPhotoURL(source,size,cache=true){
 const assets=cache?(window.PHOTO_ASSETS||{}):{};if(assets[source]&&!galleryKnownInvalid.has(assets[source]))return assets[source];
 try{const proxy=new URL(source,location.origin),url=new URL(proxy.pathname==='/api/image'?proxy.searchParams.get('url'):source,location.origin);if(assets[url.href]&&!galleryKnownInvalid.has(assets[url.href]))return assets[url.href];
 const canonical=new URL(url);canonical.search='';if(canonical.pathname.includes('/thumb/'))canonical.pathname=canonical.pathname.replace('/thumb/','/').split('/').slice(0,-1).join('/');if(assets[canonical.href]&&!galleryKnownInvalid.has(assets[canonical.href]))return assets[canonical.href];
 if(!/(^|\.)wikimedia\.org$/.test(url.hostname)||!url.pathname.startsWith('/wikipedia/commons/'))return url.origin===location.origin?source:'/api/image?url='+encodeURIComponent(url.href);
 const file=canonical.pathname.split('/').pop();if(!/\.(?:jpe?g|png)$/i.test(file))return source;
 return'/api/image?url='+encodeURIComponent('https://upload.wikimedia.org'+canonical.pathname.replace('/commons/','/commons/thumb/')+'/'+size+'px-'+file);
 }catch{return source}
}
function gallerySourceKey(url){try{const p=new URL(url,location.origin),host=new URL(p.searchParams.get('url')||url,location.origin).hostname;return /(?:wikimedia|wikipedia)\.org$/.test(host)?'wikimedia':host}catch{return url}}
const galleryStatusReady=fetch('/api/gallery-status',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(s=>{for(const asset of s.invalidAssets||[])galleryKnownInvalid.add(asset)}).catch(()=>{});
async function evictGalleryAsset(asset,upstream){
 galleryKnownInvalid.add(asset);galleryDecodedCache.delete(asset);for(const [key,value]of Object.entries(window.PHOTO_ASSETS||{}))if(value===asset)delete PHOTO_ASSETS[key];
 let remote;try{const u=new URL(upstream,location.origin);remote=u.pathname==='/api/image'?u.searchParams.get('url'):u.origin!==location.origin?u.href:undefined}catch{}
 try{await fetch('/api/gallery-evict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset,upstream:remote})});}catch{}
}
// Remote photos: the server's cache first; if it is not cached yet, load the file straight from the allowed host
// (upload.wikimedia.org serves CORS) and hand it to the server cache, so the next visit is local. The server's own
// rate-limited fetch remains the last resort.
const upstreamOf=url=>{try{return new URL(url,location.origin).searchParams.get('url')}catch{return null}};
function storeInCache(upstream,blob){fetch('/api/image-cache?'+new URLSearchParams({url:upstream}),{method:'POST',body:blob}).catch(()=>{});}
async function fetchViaCache(url){
 const local=await fetch(url+'&local=1',{cache:'no-store'}).catch(()=>null);if(local&&local.ok)return local;
 const upstream=upstreamOf(url);
 if(upstream&&/^https:\/\/upload\.wikimedia\.org\//.test(upstream)){try{const r=await fetch(upstream,{mode:'cors',signal:AbortSignal.timeout(30000)});
  if(r.ok){const blob=await r.blob();if(/^image\//.test(blob.type)){storeInCache(upstream,blob);return new Response(blob,{status:200,headers:{'Content-Type':blob.type}});}}}catch{}}
 return fetch(url,{cache:'reload',signal:AbortSignal.timeout(30000)});
}
async function decodeGalleryImage(url,isActive){
 if(galleryDecodedCache.has(url))return galleryDecodedCache.get(url);
 const execute=async()=>{if(!isActive())throw Error('Selection changed');
  const source=gallerySourceKey(url),remote=url.startsWith('/api/image'),until=gallerySourceCooldown.get(source)||0;
  if(remote&&until>Date.now())throw Error('Source cooldown');
  const response=remote?await fetchViaCache(url):await fetch(url,{cache:'reload',signal:AbortSignal.timeout(30000)});
  if(!response.ok){if(remote&&[429,503].includes(response.status))gallerySourceCooldown.set(source,Date.now()+(Number(response.headers.get('Retry-After'))||60)*1000);const e=Error('Image HTTP '+response.status);e.badCache=!remote&&[404,410].includes(response.status);throw e;}
  const blob=await response.blob();if(!blob.size||!/^image\//.test(blob.type)){const e=Error('Invalid cached image');e.badCache=true;throw e;}
  const decoded=URL.createObjectURL(blob),image=new Image();image.src=decoded;
  try{await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw Error('No image dimensions');return decoded;}catch{URL.revokeObjectURL(decoded);const e=Error('Corrupt cached image');e.badCache=true;throw e;}
 };
 const job=url.startsWith('/api/image')?remoteSlot(execute):execute();
 galleryDecodedCache.set(url,job);try{return await job}catch(e){galleryDecodedCache.delete(url);throw e}
}
// Load a maintained vehicle library. Search results are never promoted into the gallery.
let gallerySession;
let galleryLibraryPromise;
function loadGalleryLibrary(){return galleryLibraryPromise ||= fetch('/gallery_library.json?v=20261012-photos4',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Gallery library unavailable');return r.json()}).catch(e=>{galleryLibraryPromise=null;throw e})}
const vehicleGalleryCache=new Map();
async function loadVehicleGallery(key){
 if(vehicleGalleryCache.has(key))return vehicleGalleryCache.get(key);
 const job=(async()=>{try{const r=await fetch('/api/gallery?'+new URLSearchParams({key}),{cache:'no-store'});if(r.ok){const data=await r.json();if(Array.isArray(data.photos))return data;}}catch{}
  const library=await loadGalleryLibrary();return library.vehicles[key]||{photos:[],links:[]};})();
 vehicleGalleryCache.set(key,job);try{return await job}catch(e){vehicleGalleryCache.delete(key);throw e}
}
initMedia=function(){
 const v=current(),key=family+':'+v.id,revision=++mediaRevision;curKey=key;clearMedia();
 const art=CLEAN_WT_CARDS[key]||WT_CARDS[key];
 const session=gallerySession={key,revision,ready:new Map(),checking:true,rejected:new Set()};
 const active=()=>revision===mediaRevision;
 const order={survivor:0,component:1,display:1,service:2,capture:3,trial:3,period:3,assembly:4,mockup:4,blueprint:5,reconstruction:6};
 const labels={survivor:'PRESERVED EXAMPLE',component:'SURVIVING COMPONENT',display:'REAL VEHICLE DISPLAY',service:'SERVICE PHOTOGRAPH',capture:'UNFINISHED / CAPTURED PROTOTYPE',trial:'PROTOTYPE TESTING',period:'HISTORICAL PHOTOGRAPH',assembly:'PROTOTYPE ASSEMBLY',mockup:'FULL-SIZE MOCKUP',blueprint:'PLAN / DRAWING',reconstruction:'WAR THUNDER RECONSTRUCTION — NOT A PHOTO'};
 function draw(){if(!active())return;const selected=items[sel],id=selected?.kind==='wt'?'wt':selected?.photoId;
  const photos=[...session.ready.values()].sort((a,b)=>(!!a.related-!!b.related)||(order[a.category]??3)-(order[b.category]??3)||Math.min(b.width||800,1280)-Math.min(a.width||800,1280)); // small source images go after the sharp ones
  items=[...(art?[art]:[]),...photos];drawThumbs();if(items.length)show(Math.max(0,items.findIndex(p=>(p.kind==='wt'?'wt':p.photoId)===id)));
  const main=photos.filter(p=>!p.related).length;
  $('mediaNote').textContent=session.error|| (session.checking?'Loading saved vehicle photographs…':photos.length?`${main} vehicle photographs / documents available`+(photos.length>main?` · ${photos.length-main} explicitly labelled configuration references`:'')+'. Sources and configuration notes accompany each image.':'No source-identified photograph is bundled for this configuration yet. The War Thunder card remains available.');
 }
 $('mediaLinks').textContent='';const refs=$('galleryReferences');if(refs){refs.textContent='';refs.hidden=true;}
 draw();
 (async()=>{try{const entry=await loadVehicleGallery(key);await galleryStatusReady;if(!active())return;
  for(const l of [{label:'War Thunder Wiki',url:art?.page},...(entry.links||[])]){const url=safeGalleryLink(l.url);if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=l.label;$('mediaLinks').append(a)}}
  const publish=async(p)=>{let source=standardPhotoURL(p.thumb,500);if(galleryKnownInvalid.has(source))source=standardPhotoURL(p.upstream,500,false);try{let decoded;
   try{decoded=await decodeGalleryImage(source,active)}catch(e){if(!e.badCache)throw e;await evictGalleryAsset(source,p.upstream);source=standardPhotoURL(p.upstream,500,false);if(!source)throw e;decoded=await decodeGalleryImage(source,active)}
   if(!active())return;session.ready.set(p.photoId,{...p,thumb:decoded,full:decoded,assetSource:source,ready:true,matchLabel:(p.related?'RELATED CONFIGURATION · ':'')+(labels[p.category]||'SOURCE-IDENTIFIED VEHICLE')});draw();
  }catch{session.rejected.add(p.photoId)}};
  const local=entry.photos.filter(p=>!standardPhotoURL(p.thumb,500).startsWith('/api/image')),remote=entry.photos.filter(p=>standardPhotoURL(p.thumb,500).startsWith('/api/image'));
  await Promise.all(local.map(p=>publish(p)));if(!active())return;
  // Recovery only reacquires an explicitly assigned source image, never arbitrary search hits.
  for(const p of remote){if(!active())return;await publish(p)}
 }catch{if(active())session.error='The saved gallery library could not be loaded. Reload this page after restarting the server.'}
 finally{if(active()){session.checking=false;draw()}}})();
};
drawThumbs=function(){
 const box=$('thumbs');box.textContent='';const related=items.filter(p=>p.kind!=='wt'&&p.related);let more,relatedBox=box;
 if(related.length){more=document.createElement('details');more.className='online-photo-sources';const summary=document.createElement('summary');summary.textContent='Other configurations — see identification notes ('+related.length+')';relatedBox=document.createElement('div');relatedBox.className='online-photo-thumbs';more.append(summary,relatedBox);}
 items.forEach((it,i)=>{const b=document.createElement('button');b.dataset.index=String(i);b.className='thumb'+(it.kind==='wt'?' wt':'');b.title=it.kind==='wt'?'War Thunder card: '+(it.name||current().name):it.title;const image=document.createElement('img');image.alt='';image.src=it.kind==='wt'?it.art:it.thumb;const label=document.createElement('b');label.textContent=it.kind==='wt'?'WT CARD':it.category==='blueprint'?'PLAN':it.category==='mockup'?'MOCKUP':it.category==='reconstruction'?'MODEL':'PHOTO';b.append(image,label);b.onclick=()=>show(i);(it.related?relatedBox:box).append(b);});if(more)box.append(more);
};
const showReadyGallery=show;
// the gallery decodes 500 px thumbnails; the large views then switch to a 1280 px copy (cached by the server after first use)
function upgradeLargeImage(i){const p=items[i];if(!p||p.kind==='wt'||(p.width&&p.width<=700))return;const hi=standardPhotoURL(p.upstream||'',1280,false);if(!hi||!hi.startsWith('/api/image')||hi===p.assetSource)return;
 const key=curKey;decodeGalleryImage(hi,()=>curKey===key&&items[sel]===p).then(url=>{if(curKey!==key||items[sel]!==p)return;$('heroImg').src=url;$('variantImg').src=url;}).catch(()=>{});}
show=function(i){showReadyGallery(i);const p=items[i];if(!p||p.kind==='wt')return;upgradeLargeImage(i);for(const ref of p.references||[]){const url=safeGalleryLink(ref.url);if(!url)continue;const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=ref.label||'Source document';$('imgSource').append(' · ',a);}if(p.documentKind)$('imgSource').append(' · '+p.documentKind.replaceAll('-',' '));};

// Fill the local photo cache in the background so galleries open from disk: every assigned photograph at the sizes the
// page shows (500 px thumbnail, 1280 px large view). Runs once per page load after the page has been idle for a while.
(function warmPhotoCache(){
 const start=async()=>{try{const lib=await loadGalleryLibrary();const urls=new Set();
  for(const e of Object.values(lib.vehicles||{}))for(const p of e.photos||[]){
   const t=standardPhotoURL(p.thumb,500);if(t&&t.startsWith('/api/image'))urls.add(t);
   if(!p.width||p.width>700){const l=standardPhotoURL(p.upstream||'',1280,false);if(l&&l.startsWith('/api/image'))urls.add(l);}}
  const list=[...urls];let i=0,stored=0;
  const next=async()=>{while(i<list.length){const url=list[i++];
    const local=await fetch(url+'&local=1',{method:'GET',cache:'no-store'}).catch(()=>null);if(local&&local.ok){local.body?.cancel?.();continue;}
    const upstream=upstreamOf(url);if(!upstream||!/^https:\/\/upload\.wikimedia\.org\//.test(upstream))continue;
    try{const r=await fetch(upstream,{mode:'cors'});if(r.ok){const b=await r.blob();if(/^image\//.test(b.type)){storeInCache(upstream,b);stored++;}}}catch{}
    await new Promise(r=>setTimeout(r,400));}};
  await Promise.all([next(),next()]);window.__photoCacheWarm={total:list.length,stored};}catch{}};
 const kick=()=>setTimeout(()=>('requestIdleCallback' in window?requestIdleCallback(start,{timeout:5000}):start()),8000);
 if(document.readyState==='complete')kick();else addEventListener('load',kick,{once:true});
})();
