/* Pace media work by decoded frames, with no application frame-rate ceiling. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchiveVideoFrames=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 function create(video,{alive,visible,draw,raf=requestAnimationFrame,cancelRaf=cancelAnimationFrame}){
  let pending=null,lastFrame=null,lastTime=null;
  const native=typeof video.requestVideoFrameCallback==='function';
  function schedule(){if(pending!==null||!alive()||video.paused||video.ended)return;pending=native?video.requestVideoFrameCallback(frame):raf(frame);}
  function frame(time,metadata){pending=null;if(!alive()||video.paused||video.ended)return;
   const key=metadata?.presentedFrames??metadata?.mediaTime;
   const changed=native?(key===undefined||key!==lastFrame):video.currentTime!==lastTime;
   if(changed&&visible()){draw();lastFrame=key;lastTime=video.currentTime;}
   schedule();
  }
  function stop(){if(pending===null)return;if(native)video.cancelVideoFrameCallback?.(pending);else cancelRaf(pending);pending=null;}
  return {schedule,stop};
 }
 return {create};
});
