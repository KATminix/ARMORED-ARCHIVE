/* Automatic HDR: verified DisplayHDR 1000 / True Black 400 class or better.
   No controls, no user preference override, and unknown capabilities remain SDR. */
(()=>{
 'use strict';
 const range=matchMedia('(dynamic-range: high)'),media=new Map();
 const certificates=fetch('display_certifications.json?v=20261011-modules1',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 const settings={peak:1000,white:203,strength:0.6};
 let device,pipeline,sampler,gpuJob,active=false,revision=0,state={enabled:false,reason:'checking-display'};
 try{localStorage.removeItem('armoredArchive.display.v1')}catch{}
 const shader=`struct Params {fit:vec2f,pad:vec2f, peak:f32, strength:f32, unused1:f32, unused2:f32};
 @group(0) @binding(0) var tex:texture_2d<f32>;
 @group(0) @binding(1) var smp:sampler;
 @group(0) @binding(2) var<uniform> p:Params;
 struct V { @builtin(position) pos:vec4f, @location(0) uv:vec2f };
 @vertex fn vs(@builtin(vertex_index) i:u32)->V {let xy=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:V;o.pos=vec4f(xy[i],0,1);o.uv=vec2f((xy[i].x+1)*0.5,(1-xy[i].y)*0.5);return o;}
 fn to2020(c:vec3f)->vec3f {return mat3x3f(vec3f(.62740390,.06909729,.01639144),vec3f(.32928304,.91954040,.08801331),vec3f(.04331307,.01136232,.89559525))*c;}
 fn toP3(c:vec3f)->vec3f {return mat3x3f(vec3f(1.34357825,-.06529745,.00282179),vec3f(-.28217967,1.07578792,-.01959849),vec3f(-.06139858,-.01049046,1.01677671))*c;}
 fn encode(c:vec3f)->vec3f {return select(12.92*c,1.055*pow(max(c,vec3f(0)),vec3f(1.0/2.4))-0.055,c>vec3f(0.0031308));}
 @fragment fn fs(v:V)->@location(0) vec4f {
  let uv=(v.uv-vec2f(0.5))/p.fit+vec2f(0.5);
  if(any(uv<vec2f(0))||any(uv>vec2f(1))){return vec4f(0);}
  let c=textureSampleLevel(tex,smp,uv,0.0);let working=to2020(c.rgb);let y=dot(working,vec3f(0.2627,0.6780,0.0593));
  let h=clamp((y-0.55)/0.45,0.0,1.0);let gain=1.0+(p.peak-1.0)*p.strength*h*h;
  // Cap by the largest channel, so saturated colours cannot exceed the chosen target.
  let expanded=working*gain;let maxc=max(max(expanded.r,expanded.g),expanded.b);
  let mapped=toP3(expanded*min(1.0,p.peak/max(maxc,0.00001)));let largest=max(max(mapped.r,mapped.g),mapped.b);return vec4f(encode(max(mapped,vec3f(0))*min(1.0,p.peak/max(largest,0.00001))),c.a);
 }`;
 async function gpu(){
  if(gpuJob)return gpuJob;
  gpuJob=(async()=>{if(!navigator.gpu)throw Error('This browser does not provide WebGPU.');
   const adapter=await navigator.gpu.requestAdapter({powerPreference:'low-power'});if(!adapter)throw Error('No WebGPU adapter is available.');
   device=await adapter.requestDevice();device.addEventListener('uncapturederror',()=>fallback('HDR rendering was interrupted. Original SDR media is displayed.'));
   device.lost.then(()=>{gpuJob=null;fallback('The graphics device was reset. Original SDR media is displayed.');});
   const module=device.createShaderModule({code:shader});const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error('The HDR shader could not compile.');
   pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
   sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
  })();return gpuJob;
 }
 function release(r){r.texture?.destroy();r.uniform?.destroy();r.texture=null;r.uniform=null;r.bind=null;r.context?.unconfigure();r.configured=false;r.canvas.hidden=true;}
 function dispose(r){r.frames?.stop();release(r);r.resize?.disconnect();for(const [event,handler] of r.handlers||[])r.element.removeEventListener(event,handler);const frame=r.canvas.parentElement;if(frame?.classList.contains('hdrMediaFrame')){frame.before(r.element);frame.remove();}}
 function fallback(reason){active=false;state={enabled:false,reason};delete document.documentElement.dataset.displayHdr;for(const r of media.values())dispose(r);media.clear();}
 function configure(r){
  if(r.configured)return;
  if(!r.context){r.context=r.canvas.getContext('webgpu');if(!r.context)throw Error('HDR canvas is unavailable.');}
  r.context.configure({device,format:'rgba16float',colorSpace:'display-p3',alphaMode:'premultiplied',toneMapping:{mode:'extended'}});
  const config=r.context.getConfiguration?.();if(!config||config.toneMapping?.mode!=='extended'||config.colorSpace!=='display-p3'||config.format!=='rgba16float')throw Error('Confirmed floating-point HDR colour output is unavailable.');
  r.configured=true;
 }
 function render(r,source){
  const w=source?.videoWidth||source?.naturalWidth||1,h=source?.videoHeight||source?.naturalHeight||1;
  if(!r.texture||r.w!==w||r.h!==h){r.texture?.destroy();r.bind=null;r.w=w;r.h=h;r.texture=device.createTexture({size:[w,h],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});}
  if(source)device.queue.copyExternalImageToTexture({source},{texture:r.texture,colorSpace:'srgb',premultipliedAlpha:false},[w,h]);
  let fx=1,fy=1;
  {const style=getComputedStyle(source),paddingX=parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),paddingY=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),bounds=source.getBoundingClientRect();
   const innerW=Math.max(1,bounds.width-paddingX),innerH=Math.max(1,bounds.height-paddingY),scale=style.objectFit==='cover'?Math.max(innerW/w,innerH/h):Math.min(innerW/w,innerH/h);
   fx=w*scale/bounds.width;fy=h*scale/bounds.height;}
  if(!r.uniform)r.uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(r.uniform,0,new Float32Array([fx,fy,0,0,settings.peak/settings.white,settings.strength,0,0]));
  const bind=r.bind ||= device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:r.texture.createView()},{binding:1,resource:sampler},{binding:2,resource:{buffer:r.uniform}}]});
  const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:r.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
  pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);r.canvas.hidden=false;
 }
 function draw(r){
  if(!active||!r.element?.isConnected||r.element.hidden||media.get(r.element)!==r)return;
  const el=r.element;if(el.tagName==='IMG'&&(!el.complete||!el.naturalWidth))return;if(el.tagName==='VIDEO'&&el.readyState<2)return;
  try{const bounds=el.getBoundingClientRect();if(!bounds.width||!bounds.height)return;const ratio=Math.min(devicePixelRatio||1,1600/Math.max(bounds.width,bounds.height)),width=Math.round(bounds.width*ratio),height=Math.round(bounds.height*ratio);if(r.canvas.width!==width)r.canvas.width=width;if(r.canvas.height!==height)r.canvas.height=height;configure(r);render(r,el);r.error=null;}
  catch(e){release(r);r.error=e.message;}
 }
 function discover(){
  for(const [el,r] of media)if(!el.isConnected){dispose(r);media.delete(el)}
  if(!active)return;
  document.querySelectorAll('#variantImg, #datamineShellTable video').forEach(el=>{
   if(media.has(el))return;const canvas=document.createElement('canvas');canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
   const frame=document.createElement('div');frame.className='hdrMediaFrame';el.before(frame);frame.append(el,canvas);
   const r={element:el,canvas,handlers:[]};media.set(el,r);const on=(event,handler)=>{el.addEventListener(event,handler);r.handlers.push([event,handler])};on('load',()=>draw(r));on('loadeddata',()=>draw(r));
   if(el.tagName==='VIDEO'){
    r.frames=ArchiveVideoFrames.create(el,{alive:()=>active&&!document.hidden&&el.isConnected&&media.get(el)===r,visible:()=>{const b=el.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight;},draw:()=>draw(r)});
    on('play',r.frames.schedule);on('pause',r.frames.stop);on('ended',r.frames.stop);on('seeked',()=>draw(r));if(!el.paused)r.frames.schedule();
    r.resume=r.frames.schedule;
   }
   r.resize=new ResizeObserver(()=>draw(r));r.resize.observe(el);draw(r);
  });
  for(const r of media.values())if(r.element.tagName==='VIDEO'&&!r.element.paused)r.resume?.();
 }
 const observer=new MutationObserver(records=>{if(!records.some(r=>r.type==='childList'||r.target.tagName==='IMG'||r.target.tagName==='VIDEO'))return;for(const mutation of records){const r=media.get(mutation.target);if(r&&mutation.type==='attributes')r.canvas.hidden=true;}discover();});observer.observe(document.querySelector('main'),{childList:true,subtree:true,attributes:true,attributeFilter:['src','hidden']});

 function geometry(){const s=window.screen;return {hdr:range.matches,width:s.width,height:s.height,availWidth:s.availWidth,availHeight:s.availHeight,availLeft:s.availLeft,availTop:s.availTop,dpr:devicePixelRatio};}
 async function apply(){
  const request=++revision;
  if(!range.matches){fallback('browser-sdr');return;}
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)){fallback('remote-display-unconfirmed');return;}
  try{
   const response=await fetch('/api/display-capabilities',{cache:'no-store',signal:AbortSignal.timeout(9000)});
   const metadata=response.ok?await response.json():null;if(request!==revision)return;
   const catalog=await certificates;if(request!==revision)return;
   const decision=ArchiveHDRPolicy.decide(metadata,geometry(),catalog);
   if(!decision.enabled){fallback(decision.reason);return;}
   if(active&&state.displayId===decision.displayId&&settings.peak===decision.peak){state=decision;return;}
   await gpu();if(request!==revision)return;
   // Verify the requested HDR colour space before changing any surfaces.
   const test={canvas:document.createElement('canvas')};configure(test);test.context.unconfigure();
   settings.peak=decision.peak;state=decision;active=true;document.documentElement.dataset.displayHdr='active';discover();for(const r of media.values())draw(r);
  }catch{if(request===revision)fallback('capabilities-or-renderer-unavailable');}
 }
 range.addEventListener('change',apply);
 addEventListener('focus',apply);addEventListener('resize',apply);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){apply();discover()}else for(const r of media.values())r.frames?.stop()});
 setInterval(()=>{if(!document.hidden)apply()},2000);
 window.ArchiveDisplay={get active(){return active},get state(){return {...state}},get mediaStatus(){return [...media.values()].map(r=>({type:r.element.tagName,source:r.element.currentSrc,ready:!r.canvas.hidden,error:r.error||null}))},refresh:apply};apply();
})();
