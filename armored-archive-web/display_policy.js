/* Strict luminance policy and BT.2020/D65 colour transforms, shared with tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArchiveHDRPolicy=api})(typeof window==='object'?window:globalThis,()=>{
 const cutoff=1000,trueBlackCutoff=400;
 const srgbTo2020=[[.62740390,.32928304,.04331307],[.06909729,.91954040,.01136232],[.01639144,.08801331,.89559525]];
 const rec2020ToP3=[[1.34357825,-.28217967,-.06139858],[-.06529745,1.07578792,-.01049046],[.00282179,-.01959849,1.01677671]];
 const convert=(matrix,rgb)=>matrix.map(row=>row.reduce((sum,v,i)=>sum+v*rgb[i],0));
 const normalize=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 function coverage(display){
  const triangle=[display.red,display.green,display.blue],reference=[[.68,.32],[.265,.69],[.15,.06]];
  if(!triangle.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>0&&v<1)))return null;
  const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);let polygon=triangle;
  for(let i=0;i<3;i++){const a=reference[i],b=reference[(i+1)%3],next=[];for(let j=0;j<polygon.length;j++){
   const p=polygon[j],q=polygon[(j+1)%polygon.length],pSide=cross(a,b,p),qSide=cross(a,b,q);
   if(pSide>=0)next.push(p);if((pSide>=0)!==(qSide>=0)){const t=pSide/(pSide-qSide);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
  }polygon=next;}
  const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1]},0))/2;
  return Math.min(1,area(polygon)/area(reference));
 }
 function certification(display,metadata,catalog){
  const eligible=m=>m.trueBlack===true?m.tier>=400:m.tier>=1000;
  const name=normalize(display.friendlyName),manufacturer=/DISPLAY#([A-Z]{3})/i.exec(display.devicePath||'')?.[1]?.toUpperCase();
  const vendorIds={ACER:'ACR',ASUS:'AUS',DELL:'DEL',SAMSUNG:'SAM',LENOVO:'LEN',LG:'GSM',GIGABYTE:'GBT',AOC:'AOC',BENQ:'BNQ',MSI:'MSI',VIEWSONIC:'VSC',PHILIPS:'PHL'};
  for(const model of catalog?.models||[]){if(!eligible(model))continue;const [vendor,...rest]=model.model.split(/\s+/);if(name&& (name===normalize(model.model)||(vendorIds[normalize(vendor)]===manufacturer&&name===normalize(rest.join(' ')))))return {...model,matchedBy:'native-monitor-name'};}
  for(const system of catalog?.systems||[]){
   if(!eligible(system)||!display.internalPanel||normalize(metadata.machine?.manufacturer)!==normalize(system.manufacturer))continue;
   const family=normalize(system.family),machine=metadata.machine||{};
   if(![machine.family,machine.product,machine.sku].some(v=>normalize(v).includes(family)))continue;
   if(display.bounds.right-display.bounds.left===system.width&&display.bounds.bottom-display.bounds.top===system.height)return {...system,matchedBy:'verified-internal-panel-specification'};
  }
  return null;
 }
 function decide(metadata,screen,catalog){
  const no=reason=>({enabled:false,reason});
  if(!screen.hdr)return no('browser-sdr');
  if(metadata?.source!=='DXGI_OUTPUT_DESC1')return no('unconfirmed-peak');
  const displays=metadata.displays;if(!Array.isArray(displays)||!displays.length)return no('unconfirmed-display');
  const dpr=Number(screen.dpr);if(!Number.isFinite(dpr)||dpr<=0)return no('unknown-screen-geometry');
  const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=4;
  const candidates=displays.filter(d=>{
   const r=d.bounds,w=d.work;if(!r||!w)return false;
   if(!near(r.right-r.left,screen.width*dpr)||!near(r.bottom-r.top,screen.height*dpr))return false;
   if(!near(w.right-w.left,screen.availWidth*dpr)||!near(w.bottom-w.top,screen.availHeight*dpr))return false;
   return displays.length===1||(near(w.left,screen.availLeft*dpr)&&near(w.top,screen.availTop*dpr));
  });
  if(candidates.length!==1)return no('ambiguous-display');
  const display=candidates[0];let peak=Number(display.peakNits);
  if(display.hdr!==true)return no('windows-sdr');
  const verified=certification(display,metadata,catalog);let qualification;
  if(verified){qualification={route:'certified-model',tier:verified.tier,trueBlack:verified.trueBlack,source:verified.source,matchedBy:verified.matchedBy};if(!Number.isFinite(peak)||peak<80||peak>10000)peak=verified.tier;}
  else {
   if(!Number.isFinite(peak)||peak<400||peak>10000)return no('insufficient-peak');
   const black=Number(display.minNits),full=Number(display.fullFrameNits),gamut=coverage(display);
   // A zero/default black field does not prove a true-black emissive panel.
   if(!Number.isFinite(black)||black<=0||!Number.isFinite(full)||gamut===null||gamut<.95||!Number.isFinite(Number(display.bits))||Number(display.bits)<10)return no('incomplete-hdr-specification');
   if(peak>=400&&full>=250&&black<=.0005)qualification={route:'reported-specification',tier:400,trueBlack:true};
   else if(peak>=1000&&full>=600&&black<=.05)qualification={route:'reported-specification',tier:1000,trueBlack:false};
   else return no('below-requested-vesa-class');
  }
  return {enabled:true,peak,displayId:display.id,qualification,reason:'qualified-windows-hdr',workingSpace:'linear-rec2020',outputSpace:'display-p3'};
 }
 return {cutoff,trueBlackCutoff,decide,coverage,certification,convert,srgbTo2020,rec2020ToP3};
});
