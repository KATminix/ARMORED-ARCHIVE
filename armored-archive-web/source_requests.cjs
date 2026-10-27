// Per-source throttling and persistent cooldowns. Never retries a denied request.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(root,options={}){
 const clock=options.now||Date.now,wait=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms))),fetcher=options.fetch||fetch;
 const dir=path.join(root,'backend_data','source_requests');fs.mkdirSync(dir,{recursive:true});
 const stateFile=path.join(dir,'limits.json');let state={};try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch{}
 const queues=new Map(),inflight=new Map();
 // image files from upload.wikimedia.org: 5 s spacing (Wikimedia throttled 2 s); the API and pages keep 10 s
 const policy=host=>host==='upload.wikimedia.org'?{key:'wikimedia-upload',delay:5000}:/\.?wikimedia\.org$|\.?wikipedia\.org$/.test(host)?{key:'wikimedia',delay:10000}:/(^|\.)reddit\.com$|(^|\.)redd\.it$/.test(host)?{key:'reddit',delay:10000}:/(^|\.)warthunder\.com$/.test(host)?{key:'war-thunder',delay:5000}:{key:host,delay:6000};
 function save(){fs.writeFileSync(stateFile,JSON.stringify(state));}
 function failure(message,status,retryAfter){const e=new Error(message);e.status=status;e.retryAfter=Math.max(1,Math.ceil(retryAfter/1000));return e;}
 function schedule(url,run){
  const p=policy(new URL(url).hostname),s=state[p.key]||(state[p.key]={next:0,blocked:0});
  if(s.blocked>clock())return Promise.reject(failure('Source is cooling down; cached photographs remain available.',503,s.blocked-clock()));
  const q=queues.get(p.key)||{tail:Promise.resolve(),count:0};queues.set(p.key,q);
  if(q.count>=40)return Promise.reject(failure('Source request queue is full; try again later.',503,p.delay*40));
  q.count++;
  const job=q.tail.then(async()=>{
   if(s.blocked>clock())throw failure('Source is cooling down; cached photographs remain available.',503,s.blocked-clock());
   if(s.next>clock())await wait(s.next-clock());
   s.next=clock()+p.delay;save();
   try{return await run(s)}finally{s.next=Math.max(s.next,clock()+p.delay);save()}
  }).finally(()=>q.count--);
  q.tail=job.catch(()=>{});return job;
 }
 async function request(url,{json=false,ttl=24*60*60*1000}={}){
  url=String(url);const id=crypto.createHash('sha256').update(url).digest('hex'),file=path.join(dir,id+'.json');let cached;
  if(json){try{cached=JSON.parse(fs.readFileSync(file,'utf8'));if(clock()-cached.updated<ttl)return cached.value}catch{}}
  if(inflight.has(url))return inflight.get(url);
  const job=schedule(url,async s=>{
   const r=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error',headers:{'User-Agent':'ArmoredArchive/1.0 (local educational archive; cached, rate-limited requests)'}});
   if(!r.ok){
    if([403,429,503].includes(r.status)){
     const raw=r.headers.get('retry-after'),seconds=Number(raw),until=raw?(Number.isFinite(seconds)?clock()+seconds*1000:Date.parse(raw)):0;
     s.blocked=Math.max(clock()+(r.status===403?60*60*1000:15*60*1000),Number.isFinite(until)?until:0);save();
    }
    throw failure('Upstream source HTTP '+r.status,r.status===403||r.status===429?503:r.status,Math.max(1000,(s.blocked||0)-clock()));
   }
   if(json){const value=await r.json();fs.writeFileSync(file,JSON.stringify({updated:clock(),value}));return value;}
   return {buffer:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')||'application/octet-stream'};
  }).catch(e=>{if(json&&cached&&clock()-cached.updated<30*24*60*60*1000)return cached.value;throw e}).finally(()=>inflight.delete(url));
  inflight.set(url,job);return job;
 }
 return {json:(url,options)=>request(url,{...options,json:true}),image:url=>request(url),policy};
};
