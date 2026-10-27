/* Background protection-map and Monte Carlo jobs, so orbiting the model stays smooth. */
self.window=self;
importScripts('pa_data.js?v=20261011-pa2','pa_data_opponents.js?v=20261012-br1','pa_engine.js?v=20261011-pa2');
const PA=self.PAEngine;let prep=null,meshUnit=null,mapJob=0,mcJob=0;
self.onmessage=async e=>{const m=e.data;
 if(m.type==='load'){mapJob++;mcJob++;try{const mesh=await (await fetch(m.url)).json();prep=PA.prepare(mesh,PA_DATA);meshUnit=m.unit;self.postMessage({type:'loaded',unit:m.unit});}catch(err){self.postMessage({type:'error',message:String(err)});}return;}
 if(m.type==='cancel'){mapJob++;return;}
 if(!prep||m.unit!==meshUnit){self.postMessage({type:'error',message:'mesh not loaded'});return;}
 const shell=PA_DATA.shells[m.shellIndex];
 if(m.type==='map'){const my=++mapJob,{cols,rows,origin0,right,up,dir,cell}=m;const data=new Uint8Array(cols*rows);
  const opts={range:m.range,wikiP:m.wikiP,volumetric:m.volumetric,hidden:m.hidden,state:{dead:m.dead||[]},eraModel:m.eraModel};
  const [lo,hi]=prep.bounds;
  for(let j=0;j<rows;j++){
   for(let i=0;i<cols;i++){const o=[0,1,2].map(k=>origin0[k]+right[k]*(i+.5)*cell+up[k]*(j+.5)*cell);
    // quick reject against the armour bounds
    let t0=-Infinity,t1=Infinity;for(let k=0;k<3;k++){if(Math.abs(dir[k])<1e-12){if(o[k]<lo[k]||o[k]>hi[k]){t1=-1;break;}continue;}const a=(lo[k]-o[k])/dir[k],b=(hi[k]-o[k])/dir[k];t0=Math.max(t0,Math.min(a,b));t1=Math.min(t1,Math.max(a,b));}
    data[j*cols+i]=t1<t0?0:PA.mapCell(prep,PA_DATA,shell,o,dir,opts);}
   if(j%4===3||j===rows-1){await new Promise(r=>setTimeout(r,0));if(my!==mapJob)return;self.postMessage({type:'mapRows',id:m.id,rows:j+1,data:data.slice(0,(j+1)*cols)});}
  }
  self.postMessage({type:'mapDone',id:m.id,data});return;}
 if(m.type==='mc'){const my=++mcJob;const opts={range:m.range,wikiP:m.wikiP,volumetric:m.volumetric,hidden:m.hidden,state:m.state,ammoLoaded:m.ammoLoaded,eraModel:m.eraModel,maxFragments:250};
  const step=8,acc=[];for(let i=0;i<m.n;i+=step){const n=Math.min(step,m.n-i);acc.push(PA.monteCarlo(prep,PA_DATA,shell,m.origin,m.dir,opts,n,(m.seed+i*2654435761)>>>0));
   await new Promise(r=>setTimeout(r,0));if(my!==mcJob)return;self.postMessage({type:'mcProgress',id:m.id,done:i+n,total:m.n});}
  const sum={n:0,penetration:0,ricochet:0,noPen:0,unresolved:0,destroyed:0,crewKO:0,ammo:0,crewLost:0,parts:{},outcomes:{}};
  for(const a of acc){for(const k of ['n','penetration','ricochet','noPen','unresolved','destroyed','crewKO','ammo','crewLost'])sum[k]+=a[k];for(const [k,v] of Object.entries(a.parts))sum.parts[k]=(sum.parts[k]||0)+v;for(const [k,v] of Object.entries(a.outcomes))sum.outcomes[k]=(sum.outcomes[k]||0)+v;}
  self.postMessage({type:'mcDone',id:m.id,result:sum});}
};
