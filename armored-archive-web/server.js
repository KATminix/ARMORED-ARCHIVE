// Armored Archive â€” standalone Node.js backend (no npm dependencies)
// Serves the archive over HTTP, supports byte-range video streaming, persists
// preferences/events to JSON, and proxies/caches Wikimedia Commons images so
// the browser never has to talk directly to Commons.
const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
const crypto=require('crypto');
const displayProbe=require('./display_probe.cjs');
const gpuProbe=require('./gpu_probe.cjs');
const root=__dirname;
const port=Number(process.env.PORT||8787);
const publicRoot=path.join(root);
const mediaRoot=path.join(root,'armored_archive_shell_assets');
const dataDir=path.join(root,'backend_data');
const imageCache=path.join(dataDir,'images');
fs.mkdirSync(imageCache,{recursive:true});
const dbFile=path.join(dataDir,'archive.json');
let db={version:1,preferences:{theme:'dark',tanks:{},families:{},nations:{},roles:{},shells:{}},events:[]};
try{if(fs.existsSync(dbFile))db={...db,...JSON.parse(fs.readFileSync(dbFile,'utf8'))}}catch(e){console.warn('DB load:',e.message)}
function saveDb(){fs.writeFile(dbFile,JSON.stringify(db,null,2),()=>{});}
function send(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(typeof body==='string'?body:JSON.stringify(body));}
function safeJoin(base,rel){const target=path.resolve(base,rel);if(target!==path.resolve(base)&&!target.startsWith(path.resolve(base)+path.sep))return null;return target;}
const mime={'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4'};
function streamFile(req,res,file){
  let st;try{st=fs.statSync(file)}catch{return send(res,404,{error:'Not found'})}
  if(!st.isFile())return send(res,404,{error:'Not found'});
  const total=st.size, ext=path.extname(file).toLowerCase();
  const headers={'Content-Type':mime[ext]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':['.html','.js','.cjs','.json'].includes(ext)?'no-store':'public, max-age=86400'};
  const range=req.headers.range;
  if(!range){headers['Content-Length']=total;res.writeHead(200,headers);fs.createReadStream(file).pipe(res);return;}
  const m=/bytes=(\d*)-(\d*)/.exec(range);
  if(!m){res.writeHead(416,{'Content-Range':`bytes */${total}`});return res.end();}
  let start=m[1]?Number(m[1]):Math.max(0,total-(Number(m[2])+1));
  let end=m[2]?Number(m[2]):total-1;
  if(start<0||start>=total||end<start){res.writeHead(416,{'Content-Range':`bytes */${total}`});return res.end();}
  end=Math.min(end,total-1);headers['Content-Range']=`bytes ${start}-${end}/${total}`;headers['Content-Length']=end-start+1;
  res.writeHead(206,headers);fs.createReadStream(file,{start,end}).pipe(res);
}
const sourceRequests=require('./source_requests.cjs')(root);
const pipelineModule=require('./gallery_pipeline.cjs');
const galleryPipeline=pipelineModule(root,sourceRequests);
const galleryWarm=require('./gallery_warm.cjs')(root,sourceRequests,pipelineModule);
async function proxyImage(res,target,localOnly=false){
 let u;try{u=new URL(target)}catch{return send(res,400,{error:'Bad image URL'})}
 if(!pipelineModule.allowedImage(target))return send(res,403,{error:'Image host not allowed'});
 const file=pipelineModule.cacheFile(root,target);
 if(fs.existsSync(file)){if(pipelineModule.imageType(fs.readFileSync(file)))return streamFile({headers:{}},res,file);fs.unlinkSync(file);}
 if(localOnly)return send(res,404,{cached:false}); // the page then loads it itself and hands it back (POST /api/image-cache)
 const result=await sourceRequests.image(u);
 if(!pipelineModule.imageType(result.buffer))return send(res,502,{error:'Source did not return an image'});
 const buf=result.buffer;fs.writeFileSync(file,buf);res.writeHead(200,{'Content-Type':pipelineModule.imageType(result.buffer),'Cache-Control':'public, max-age=604800','Content-Length':buf.length});res.end(buf);
}
function record(body){const e={...body,ts:Date.now()};db.events.push(e);if(db.events.length>5000)db.events=db.events.slice(-5000);const p=db.preferences;
 if(body.type==='theme')p.theme=body.value;
 if(body.type==='tank'){for(const k of ['tanks','families','nations','roles']){const v=body[k];if(v)p[k][v]=(p[k][v]||0)+1}}
 if(body.type==='shell')p.shells[body.value]=(p.shells[body.value]||0)+1;saveDb();}
let wtAssets=null;const localAssets=()=>wtAssets||(wtAssets=import('./local_assets/wt_assets.mjs'));
const isLocalClient=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
// Reads render models/textures from the War Thunder install on this computer at request time (nothing is copied
// into the project). Served to this computer only.
async function localAssetRoute(req,res,u){
 if(!isLocalClient(req))return send(res,403,{error:'Local game assets are only available on the computer running the server.'});
 const A=await localAssets();
 if(req.method==='GET'&&u.pathname==='/api/local/status')return send(res,200,await A.status());
 if(req.method==='POST'&&u.pathname==='/api/local/game-dir'){
  const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(res,403,{error:'Same-origin request required'});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(res,413,{error:'Request too large'})}
  try{return send(res,200,A.saveGameDir(String(JSON.parse(raw).dir||'')))}catch(e){return send(res,400,{error:e.message})}
 }
 const bin=b=>{res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','Content-Length':b.length});res.end(b);};
 if(req.method==='GET'&&u.pathname==='/api/local/model')return bin(A.encodeModel(await A.loadModel(u.searchParams.get('unit')||'',u.searchParams.get('model')||'',u.searchParams.get('variant')==='xray'?'xray':'main')));
 if(req.method==='GET'&&u.pathname==='/api/local/unit-image'){const im=A.loadUnitImage(u.searchParams.get('unit')||'');res.writeHead(200,{'Content-Type':im.type,'Cache-Control':'private, max-age=86400','Content-Length':im.bytes.length});return res.end(im.bytes);}
 if(req.method==='GET'&&u.pathname==='/api/local/texture')return bin(A.encodeTexture(await A.loadTexture(u.searchParams.get('name')||'')));
 return send(res,404,{error:'Unknown local asset route'});
}
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname.startsWith('/api/local/'))return await localAssetRoute(req,res,u);
  if(u.pathname==='/backend_data/local_game.json'||u.pathname.startsWith('/local_assets/'))return send(res,403,{error:'Forbidden'});
  if(req.method==='GET'&&u.pathname==='/api/display-capabilities'){
   const address=req.socket.remoteAddress;
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))return send(res,200,{source:'remote-client',displays:[]});
   return send(res,200,await displayProbe());
  }
  if(req.method==='GET'&&u.pathname==='/api/gpu-memory')return send(res,200,isLocalClient(req)?await gpuProbe():{source:'remote-client',gpus:[]});
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,backend:'node',version:'20261012-pa41'});
  if(req.method==='GET'&&u.pathname==='/api/gallery'){
   const library=JSON.parse(fs.readFileSync(path.join(root,'gallery_library.json'),'utf8'));
   const key=u.searchParams.get('key');const entry=library.vehicles[key];
   return send(res,entry?200:404,entry?{version:library.version,key,...entry}:{error:'Unknown vehicle'});
  }
  if(req.method==='GET'&&u.pathname==='/api/gallery-status')return send(res,200,{...galleryPipeline.status(),warm:galleryWarm.status()});
  if(req.method==='POST'&&u.pathname==='/api/gallery-warm'){if(!isLocalClient(req))return send(res,403,{error:'Local only'});galleryWarm.run();return send(res,202,galleryWarm.status());}
  if(req.method==='GET'&&['/api/gallery-discover','/api/vehicle-photos','/api/photos'].includes(u.pathname))return send(res,410,{error:'Live image search has been retired. Use /api/gallery with a vehicle key for source-assigned photographs.'});
  if(req.method==='POST'&&u.pathname==='/api/gallery-evict'){
   const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(res,403,{error:'Same-origin request required'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return send(res,413,{error:'Request too large'})}
   let body;try{body=JSON.parse(raw)}catch{return send(res,400,{error:'Invalid JSON'})}return send(res,200,galleryPipeline.evict(body));
  }
  if(req.method==='GET'&&u.pathname==='/api/preferences')return send(res,200,db.preferences);
  if(req.method==='POST'&&u.pathname==='/api/events'){
   let raw='';req.on('data',c=>{raw+=c});req.on('end',()=>{try{record(JSON.parse(raw));send(res,204,'')}catch(e){send(res,400,{error:e.message})}});return;
  }
  if(req.method==='GET'&&u.pathname==='/api/image')return await proxyImage(res,u.searchParams.get('url'),u.searchParams.get('local')==='1');
  // the page fetched an assigned photo straight from an allowed host and stores it in the local cache (this computer only)
  if(req.method==='POST'&&u.pathname==='/api/image-cache'){
   if(!isLocalClient(req))return send(res,403,{error:'Local only'});const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return send(res,403,{error:'Same-origin request required'});
   const target=u.searchParams.get('url');if(!target||!pipelineModule.allowedImage(target))return send(res,403,{error:'Image host not allowed'});
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>20*1024*1024)return send(res,413,{error:'Image too large'});chunks.push(c);}
   const buf=Buffer.concat(chunks);if(!pipelineModule.imageType(buf))return send(res,415,{error:'Not an image'});
   const file=pipelineModule.cacheFile(root,target);if(!fs.existsSync(file))fs.writeFileSync(file,buf);return send(res,201,{cached:true});
  }
  if(req.method==='GET'&&u.pathname.startsWith('/media/')){
   const name=decodeURIComponent(u.pathname.slice('/media/'.length));const file=safeJoin(mediaRoot,name);if(!file)return send(res,403,{error:'Forbidden'});return streamFile(req,res,file);
  }
  if(req.method==='GET'){
   let rel=decodeURIComponent(u.pathname);if(rel==='/'||rel==='')rel='/index.html';const file=safeJoin(publicRoot,'.'+rel);if(!file)return send(res,403,{error:'Forbidden'});return streamFile(req,res,file);
  }
  send(res,405,{error:'Method not allowed'});
 }catch(e){console.error(e.message);if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));send(res,e.status||500,{error:e.message});}
});
server.on('error',err=>{
 if(err.code==='EADDRINUSE')console.error(`Port ${port} is already in use. Another server is running. Close that server or choose a different PORT before starting this copy. Folder: ${root}`);
 else console.error(err);
 process.exitCode=1;
});
server.listen(port,()=>{
 console.log(`Armored Archive - FLUENT EDITION`);
 console.log(`Serving folder: ${root}`);
 console.log(`Open: http://localhost:${server.address().port}/?v=20261012-pa41`);
});
