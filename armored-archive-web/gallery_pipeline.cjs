const fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm');
const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const plain=s=>decode(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
function imageType(b){if(!Buffer.isBuffer(b)||b.length<24)return null;if(b.subarray(0,3).equals(Buffer.from([255,216,255]))&&b.includes(Buffer.from([255,217]),b.length-20))return'image/jpeg';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.includes(Buffer.from('IEND'),b.length-20))return'image/png';if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'&&b.readUInt32LE(4)+8<=b.length)return'image/webp';if(/^GIF8[79]a$/.test(b.toString('ascii',0,6))&&b[b.length-1]===59)return'image/gif';return null;}
function allowedImage(raw){try{const u=new URL(raw);return u.protocol==='https:'&&(!u.username&&!u.password)&&(/(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/i.test(u.hostname)||['i.redd.it','i.imgur.com','preview.redd.it','external-preview.redd.it','forum-en-cdn.warthunder.com','www.ulrichwrede.de','www.posix.com','attachment.tapatalk-cdn.com','tanks-encyclopedia.com','www.tanks-encyclopedia.com','www.worldwarphotos.info','www.landmarkscout.com','live.staticflickr.com','www.communitystories.ca','preservedtanks.com','www.preservedtanks.com','www.historyofwar.org','panzerbaer.de','www.panzerbaer.de','www.flugzeug-lexikon.de','www.argentina.gob.ar','www.bundeswehr.de','wiki-ru.warthunder.com','www.panzernet.net','forum-ru-cdn.warthunder.com','i.pinimg.com','army-guide.com','defencehub.live','panzer-dokumentationszentrum.ovh','www.infodefensa.com','esut.de','staticfiles.warthunder.com'].includes(u.hostname)||(u.hostname==='s3-ap-southeast-2.amazonaws.com'&&u.pathname.startsWith('/awm-media/')))}catch{return false}}
function cacheFile(root,url){const u=new URL(url),ext=path.extname(u.pathname).toLowerCase();return path.join(root,'backend_data','images',crypto.createHash('sha256').update(String(url)).digest('hex')+(['.jpg','.jpeg','.png','.webp'].includes(ext)?ext:'.jpg'));}
module.exports=function(root,requests,options={}){
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'collection_scope.js'),'utf8'),ctx,{timeout:1000});
 const config=ctx.window.REAL_PHOTO_CONFIG||{},scope=ctx.window.TANK_COLLECTION_SCOPE||{};
 const dir=path.join(root,'backend_data','gallery_discovery');fs.mkdirSync(dir,{recursive:true});const jobs=new Map();
 const invalidFile=path.join(dir,'invalid_assets.json');let invalidAssets=[];try{invalidAssets=JSON.parse(fs.readFileSync(invalidFile,'utf8'))}catch{}
 function mark(asset){if(asset&&!invalidAssets.includes(asset)){invalidAssets.push(asset);fs.writeFileSync(invalidFile,JSON.stringify(invalidAssets))}}
 function evict({asset,upstream}={}){
  const rel=String(asset||'').split('?')[0];let removed=false,kind='proxy';
  if(/^\/backend_data\/images\/[a-f0-9]{64}\.(png|jpe?g|webp)$/i.test(rel)){
   const file=path.resolve(root,'.'+rel),base=path.resolve(root,'backend_data','images');if(path.dirname(file)!==base)throw Object.assign(new Error('Invalid image path'),{status:400});
   if(fs.existsSync(file)){fs.unlinkSync(file);removed=true;}mark(rel);
  }else if(/^\/vehicle_images\/(?:curated\/)?[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif)$/i.test(rel)){kind='bundled';mark(rel);}
  else if(!String(asset||'').startsWith('/api/image?')&&!upstream)throw Object.assign(new Error('Only a specific gallery image may be evicted'),{status:400});
  let target=upstream;try{if(!target&&String(asset).startsWith('/api/image?'))target=new URL(asset,'http://localhost').searchParams.get('url')}catch{}
  if(target){if(!allowedImage(target))throw Object.assign(new Error('Image host not allowed'),{status:400});const file=cacheFile(root,target);if(fs.existsSync(file)){fs.unlinkSync(file);removed=true;}mark('/api/image?url='+encodeURIComponent(target));}
  return{evicted:removed,kind,invalidAssets,reason:kind==='bundled'?'Marked invalid; original preserved':undefined};
 }
 async function discover(key,stage){
  if(!scope[key]||!config[key])throw Object.assign(new Error('Unknown vehicle'),{status:404});
  if(!['warthunder','tankporn','forum'].includes(stage))throw Object.assign(new Error('Unknown discovery stage'),{status:400});
  const id=crypto.createHash('sha256').update(key+':'+stage).digest('hex'),file=path.join(dir,id+'.json');let old;
  try{old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.schemaVersion===2&&Date.now()-old.updated<(old.status==='ok'?86400000:900000))return{...old,cached:true}}catch{}
  if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
   const result={schemaVersion:2,key,stage,status:'ok',candidates:[],references:[],updated:Date.now()},seen=new Set(),refs=new Set();
   const query=String((config[key].exact||config[key].queries||[])[0]||key.split(':')[1]).replace(/\b(?:suspension|turret|original production)\b/gi,'').replace(/\s+/g,' ').trim();
   const broader=(config[key].queries||[]).find(q=>q!==query&&q.length<query.length)||(config[key].aliases||[]).filter(q=>q!==query&&q.length>3).sort((a,b)=>a.length-b.length)[0];

   function reference(raw,label,sourcePage,provenance='source post'){try{const u=new URL(decode(raw));if(!/^https?:$/.test(u.protocol))return;const identity=u.href+'|'+(sourcePage||'')+'|'+plain(label);if(refs.has(identity))return;refs.add(identity);result.references.push({label:plain(label).slice(0,180)||u.hostname,url:u.href,sourcePage,provenance})}catch{}}
   function links(html,sourcePage,provenance){
    for(const m of String(html||'').matchAll(/https?:\/\/[^\s<>"')\]]+/g))reference(m[0],'Reference cited in source',sourcePage,provenance);
    const text=plain(html);for(const m of text.matchAll(/(?:Panzer Tracts\s*[0-9][0-9-]*|ISBN[ :]*[0-9Xx-]{8,20}|(?:Jentz|Doyle|Spielberger)[^.!?]{0,95})/gi))reference(sourcePage,'Citation: '+m[0],sourcePage,provenance);
   }
   function candidate(raw,title,page,description,sourceName,imageAlt=""){raw=decode(raw);if(!allowedImage(raw)||seen.has(raw))return;seen.add(raw);result.candidates.push({title:plain(title),description:plain(description),page,sourceName,artist:'See linked source and original attribution',lic:'Rights retained by original author; see source',thumb:'/api/image?url='+encodeURIComponent(raw),full:'/api/image?url='+encodeURIComponent(raw),upstream:raw,discoveryStage:stage,verified:false,references:[]});
    const added=result.candidates[result.candidates.length-1],prototype=config[key].prototype||/^proto_|:prototype$/.test(key);
    if(prototype&&/blueprint|drawing|diagram|schematic|elevation|technical plan/i.test(imageAlt))Object.assign(added,{category:'blueprint',documentKind:'source-described-drawing',matchLabel:'SOURCE-DESCRIBED DRAWING â€” CHECK PROVENANCE',identification:'Source caption describes a drawing; see the cited report or book for authorship and historical status.'});
   }
   try{
    if(stage==='forum'){
     let data=await requests.json('https://forum.warthunder.com/search.json?q='+encodeURIComponent('"'+query+'"'));
     if(!(data.topics||[]).length&&!(data.posts||[]).length&&broader)data=await requests.json('https://forum.warthunder.com/search.json?q='+encodeURIComponent('"'+broader+'"'));
     const topicIds=[...new Set([...(data.topics||[]).map(t=>t.id),...(data.posts||[]).map(p=>p.topic_id)])].filter(Number.isFinite).slice(0,2);
     for(const id of topicIds){const topic=await requests.json('https://forum.warthunder.com/t/'+id+'.json'),page='https://forum.warthunder.com/t/'+id;reference(page,topic.title||query,page);
      for(const post of (topic.post_stream?.posts||[]).slice(0,8)){const html=post.cooked||'',postPage=page+'/'+(post.post_number||1);links(html,postPage,'forum post');for(const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)){let src=decode(m[1]);try{src=new URL(src,page).href}catch{continue}candidate(src,topic.title||query,postPage,html,'War Thunder Forum',(m[0].match(/\balt=["']([^"']+)["']/i)||[])[1]||'')}}
     }
    }else{
     const sub=stage==='warthunder'?'Warthunder':'TankPorn';const suffix=stage==='warthunder'?' (museum OR historical OR "real life" OR source OR report OR document)':'';
     let data=await requests.json('https://www.reddit.com/r/'+sub+'/search.json?restrict_sr=on&sort=relevance&t=all&limit=8&q='+encodeURIComponent('"'+query+'"'+suffix));
     if(!(data.data?.children||[]).length&&broader)data=await requests.json('https://www.reddit.com/r/'+sub+'/search.json?restrict_sr=on&sort=relevance&t=all&limit=8&q='+encodeURIComponent('"'+broader+'"'+suffix));

     const posts=(data.data?.children||[]).map(x=>x.data).filter(Boolean);
     for(const p of posts){const countBefore=result.candidates.length;const page='https://www.reddit.com'+p.permalink;reference(page,p.title,page);if(p.url_overridden_by_dest||p.url)reference(p.url_overridden_by_dest||p.url,'Media or document linked by post',page);links(p.selftext,page,'Reddit post');candidate(p.url_overridden_by_dest||p.url,p.title,page,p.selftext,'Reddit r/'+sub);
      for(const media of Object.values(p.media_metadata||{})){if(media.status==='valid')candidate(media.s?.u,p.title,page,p.selftext,'Reddit r/'+sub)}
      if(result.candidates.length===countBefore)for(const im of p.preview?.images||[])candidate(im.source?.url,p.title,page,p.selftext,'Reddit r/'+sub);
     }
     for(const p of posts.slice(0,2)){try{const comments=await requests.json('https://www.reddit.com'+p.permalink.replace(/\/$/,'')+'.json?limit=8&depth=1');for(const c of comments[1]?.data?.children||[])links(c.data?.body,'https://www.reddit.com'+p.permalink,'Reddit comment'+(c.data?.permalink?' https://www.reddit.com'+c.data.permalink:''))}catch(e){result.note='Some comment references were unavailable';if(e.retryAfter)break}}
    }
   }catch(e){result.status='unavailable';result.error=e.message;if(e.retryAfter)result.retryAfter=e.retryAfter;if(old){result.candidates=old.candidates||[];result.references=old.references||[];result.stale=true}}
   for(const candidate of result.candidates)candidate.references=result.references.filter(r=>r.sourcePage===candidate.page&&(r.url!==candidate.page||r.label.startsWith('Citation:')));
   result.candidates=result.candidates.slice(0,24);result.references=result.references.slice(0,60);fs.writeFileSync(file,JSON.stringify(result));return result;
  })().finally(()=>jobs.delete(id));jobs.set(id,job);return job;
 }
 return{discover,evict,status:()=>({invalidAssets:[...invalidAssets]})};
};
module.exports.imageType=imageType;module.exports.allowedImage=allowedImage;module.exports.cacheFile=cacheFile;
