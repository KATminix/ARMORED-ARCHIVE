// On-demand Commons retrieval, persistent result cache and attribution metadata.
const fs=require('fs'),path=require('path');
const matching=require('./vehicle_media.js');
module.exports=function(root,search){
 const cacheFile=path.join(root,'backend_data','photo_search_cache.json');
 let disk={};try{disk=JSON.parse(fs.readFileSync(cacheFile,'utf8'))}catch{}
 const seed=JSON.parse(fs.readFileSync(path.join(root,'vehicle_photo_index.json'),'utf8'));
 const inflight=new Map(),lastAttempt=new Map();
 // The shared source requester serializes all Commons searches and image requests.
 function scheduled(query){return search(query,50)}
 function refresh(f){
  if(inflight.has(f))return inflight.get(f);
  lastAttempt.set(f,Date.now());
  const job=(async()=>{
   const combined=new Map((disk[f]?.photos||[]).map(p=>[matching.photoId(p),p]));let successes=0;
   for(const query of matching.families[f].queries){
    try{for(const p of await scheduled(query))combined.set(matching.photoId(p),p);successes++}catch(e){console.warn('Photo search:',query,e.message);if(e.retryAfter||e.status===503)break}
   }
   if(successes){disk[f]={updated:Date.now(),photos:[...combined.values()]};fs.writeFileSync(cacheFile,JSON.stringify(disk,null,2))}
  })().finally(()=>inflight.delete(f));inflight.set(f,job);return job;
 }
 async function get(key){
  const [f]=key.split(':');if(!matching.families[f]||!matching.variants[key])return null;
  const stale=!disk[f]||Date.now()-disk[f].updated>24*60*60*1000;
  // Return known web-source results immediately while refreshing; failures retain existing photographs.
  if(stale&&Date.now()-(lastAttempt.get(f)||0)>15*60*1000)refresh(f).catch(e=>console.warn('Photo refresh:',e.message));
  return {photos:matching.rank(key,[...(seed[f]||[]),...(disk[f]?.photos||[])]),refreshing:inflight.has(f),updated:disk[f]?.updated||null};
 }
 return {get};
};
