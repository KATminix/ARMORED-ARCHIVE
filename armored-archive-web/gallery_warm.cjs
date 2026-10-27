// Fills the local image cache (backend_data/images) for every photograph assigned in gallery_library.json, in the
// background, so galleries open from disk instead of waiting on Wikimedia one image at a time. Uses the same URLs the
// page requests (real_photos.js standardPhotoURL): the 500 px thumbnail first, then the 1280 px view for the large image.
// Requests go through source_requests.cjs, so per-host spacing, cooldowns and 429 back-off still apply.
const fs=require('fs'),path=require('path');
module.exports=function(root,sourceRequests,pipeline){
 const state={total:0,cached:0,fetched:0,failed:0,running:false,startedAt:0,finishedAt:0};
 let assets={};try{const s=fs.readFileSync(path.join(root,'photo_assets.js'),'utf8');assets=JSON.parse(s.slice(s.indexOf('{'),s.lastIndexOf('}')+1));}catch{}
 // port of standardPhotoURL(): returns the upstream URL behind /api/image, or null for files already served locally
 function upstreamFor(source,size,useAssets){
  if(!source)return null;if(useAssets&&assets[source])return null;
  let url;try{const proxy=new URL(source,'http://local');if(proxy.pathname!=='/api/image')return null;url=new URL(proxy.searchParams.get('url'));}catch{return null}
  if(useAssets&&assets[url.href])return null;
  const canonical=new URL(url.href);canonical.search='';if(canonical.pathname.includes('/thumb/'))canonical.pathname=canonical.pathname.replace('/thumb/','/').split('/').slice(0,-1).join('/');
  if(useAssets&&assets[canonical.href])return null;
  if(!/(^|\.)wikimedia\.org$/.test(url.hostname)||!url.pathname.startsWith('/wikipedia/commons/'))return url.href;
  const file=canonical.pathname.split('/').pop();if(!/\.(?:jpe?g|png)$/i.test(file))return null;
  return 'https://upload.wikimedia.org'+canonical.pathname.replace('/commons/','/commons/thumb/')+'/'+size+'px-'+file;
 }
 function jobs(){
  let lib;try{lib=JSON.parse(fs.readFileSync(path.join(root,'gallery_library.json'),'utf8'));}catch{return []}
  const thumbs=new Set(),large=new Set();
  for(const e of Object.values(lib.vehicles||{}))for(const p of e.photos||[]){
   const t=upstreamFor(p.thumb,500,true)||(p.thumb&&!p.thumb.startsWith('/api/image')?null:upstreamFor(p.upstream,500,false));if(t)thumbs.add(t);
   const l=upstreamFor(p.upstream||p.full,1280,false);if(l&&(!p.width||p.width>700))large.add(l);}
  return [...thumbs,...[...large].filter(u=>!thumbs.has(u))];
 }
 async function run(){
  if(state.running)return;state.running=true;state.startedAt=Date.now();state.finishedAt=0;state.cached=state.fetched=state.failed=0;
  const list=jobs().filter(u=>pipeline.allowedImage(u));state.total=list.length;
  for(const url of list){
   const file=pipeline.cacheFile(root,url);
   if(fs.existsSync(file)){state.cached++;continue;}
   try{const r=await sourceRequests.image(new URL(url));if(!pipeline.imageType(r.buffer))throw Error('not an image');fs.writeFileSync(file,r.buffer);state.fetched++;}
   catch(e){state.failed++;if(e.status===503&&e.retryAfter>60){state.pausedUntil=Date.now()+e.retryAfter*1000;await new Promise(r=>setTimeout(r,e.retryAfter*1000));delete state.pausedUntil;}}
  }
  state.running=false;state.finishedAt=Date.now();
 }
 return {run,status:()=>({...state}),upstreamFor};
};
