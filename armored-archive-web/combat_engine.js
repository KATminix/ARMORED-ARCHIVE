/* Published WT tables already incorporate projectile-specific slope behaviour. */
(function(root){
 const ranges=[10,100,500,1000,1500,2000];
 const numeric=s=>parseFloat(String(s||'').replace(/,/g,''));
 const kilograms=s=>numeric(s)*(String(s).includes('kg')?1:.001);
 function deMarre(a){
  if(!['AP','APC','APBC','APCBC','APHE','APHEBC'].includes(a.type))return null;
  const p=a.props||{},m=kilograms(p['Projectile Mass']),v=numeric(p['Muzzle Velocity']),c=numeric(p.Caliber);
  if(!(m>0&&v>0&&c>0))return null;
  const x=(p['Explosive Mass']?kilograms(p['Explosive Mass']):0)/m*100;
  const pts=[[.65,1],[1.6,.93],[2,.9],[3,.85],[4,.75]];let k=1;
  if(x>=4)k=.75;else for(let i=1;i<pts.length;i++)if(x>=pts[i-1][0]&&x<pts[i][0])k=pts[i-1][1]+(x-pts[i-1][0])/(pts[i][0]-pts[i-1][0])*(pts[i][1]-pts[i-1][1]);
  return v**1.43*m**.71/(1900**1.43*(c/100)**1.07)*100*k*(a.type==='APCBC'?1:.9);
 }
 function penetration(a,range,angle,method='wiki'){
  if(!a.angles||!ranges.includes(range)||angle<0||angle>60)return null;
  const row=a.angles[ranges.indexOf(range)],i=angle<=30?0:1;
  let result=row[i]+(row[i+1]-row[i])*(angle-i*30)/30;
  const dm=deMarre(a);if(method==='formula'&&dm!==null)result*=dm/a.pen[0];
  return result;
 }
 function assess(a,thickness,range,angle,method){
  const p=penetration(a,range,angle,method);
  if(p===null)return {p:null,status:a.type==='Smoke'?'SMOKE':'BLAST / SPECIAL EFFECT',cls:'warn',detail:'No direct-penetration verdict; blast, spall and damage to exposed equipment need a separate model.'};
  if(!(thickness>0))return {p,status:'UNKNOWN PLATE',cls:'warn',detail:'A positive verified thickness is required.'};
  if(p*.95>thickness)return {p,status:'LIKELY PENETRATED',cls:'bad',detail:'Penetration exceeds this single plate even at −5%.'};
  if(p*1.05<thickness)return {p,status:'LIKELY STOPS ROUND',cls:'ok',detail:'This plate exceeds penetration even at +5%; other hit locations remain vulnerable.'};
  return {p,status:'BORDERLINE',cls:'warn',detail:'Within the ±5% comparison band; no reliable stop/penetrate verdict.'};
 }
 root.CombatEngine={ranges,deMarre,penetration,assess};
 if(typeof module!=='undefined')module.exports=root.CombatEngine;
})(typeof window!=='undefined'?window:globalThis);
