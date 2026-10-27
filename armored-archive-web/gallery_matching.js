/* Shared vehicle-subject matching: family references never become exact variant evidence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GalleryMatching=api;})(typeof window!=='undefined'?window:globalThis,function(){
 const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/<[^>]*>/g,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\b(?:panzerkampfwagen|pz\s*kpfw|pzkpfw|pz)\b/g,'panzer').replace(/\b(?:ausf|ausfuhrung)\b/g,' ').replace(/\b(viii|vii|vi|iv|iii|ii|i|v)\b/g,m=>({i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8}[m])).replace(/\b([12])\s*a\s*(\d+[a-z]*)\b/g,'$1 a$2').replace(/\bpanzer\s*5\b/g,'panther').replace(/\s+/g,' ').trim();
 const mention=(s,names)=>names.some(n=>{n=normalize(n);return n.length>2&&(' '+normalize(s)+' ').includes(' '+n+' ')});
 const subject=p=>[p.title,p.objectName].filter(Boolean).join(' ');
 const td=/\b(?:jpz|jgpz|jgdpz|jagdpz)\b|tank destroyer|jagdpanzer|jagdpanther|panzerjager|panzerjaeger|(?:panzer|pz)[\s._-]*(?:iv|4)[\s._/-]*(?:60|70)|sturmpanzer|sturmgesch[uü]tz|sturmhaubitze|\bstu[gh]\b|brummb[aä]r|hummel|nashorn|sdkfz\s*162/i;
 function variant(text,family){const n=normalize(text),patterns={panzer4:/\bpanzer\s*4\s*(c|e|f\s*[12]|g|h|j)\b/g,panzer3:/\bpanzer\s*3\s*(b|e|f|j1?|l|m|n)\b/g,panther:/\bpanther\s*(?:tank\s*)?(a|d|g|f|2)\b/g,leopard1:/\bleopard\s*1\s*(a[1-5]|c[12])\b/g,jagdpanther:/\bjagdpanther\s*(g[12])\b/g,marder1:/\bmarder\s*1\s*(a[135])\b/g,leopard2:/\bleopard\s*2\s*(a[4-7][a-z0-9]*|pl)\b/g};const re=patterns[family];return re?[...n.matchAll(re)].map(m=>m[1].replace(/\s+/g,'')):[];}
 function family(target){const n=normalize(target);if(/panzer 4/.test(n)&&!td.test(target))return'panzer4';if(/panzer 3/.test(n)&&!td.test(target))return'panzer3';if(/\bpanther\b/.test(n)&&!/jagdpanther|coelian/.test(n))return'panther';if(/leopard 1/.test(n))return'leopard1';if(/leopard 2/.test(n))return'leopard2';if(/jagdpanther/.test(n))return'jagdpanther';if(/marder\s*1/.test(n))return'marder1';return'';}
 function classify(config,p){
  const target=[...(config.exact||[]),config.unitName||''].join(' '),name=subject(p),identity=[name,p.categories].join(' '),caption=p.description||'',kind=p.category||'';
  const document=/blueprint|mockup|plan|drawing|reconstruction/.test(kind)||p.documentKind;
  if(document&&!config.prototype)return null;
  if(!p.verified&&/\blego\b|diorama|tamiya|revell|airfix|trumpeter|scale.model|plastic.model|modellbau|\btoy\b|\b1[ /:]35\b|screenshot|gameplay|in.game|war thunder|world of tanks|3d.render|3d.model/i.test(identity))return null;
  const f=family(target)||({iv:'panzer4',panzer3:'panzer3',panther:'panther',leopard1:'leopard1',leopard2:'leopard2',marder:'marder1',jagdpanther:'jagdpanther'}[(config.key||'').split(':')[0]]||'');
  if(/panzer\s*(?:iv|4)[\s/_-]*70/i.test(target)&&/jagdpanzer\s*(?:iv|4).*?(?:l\s*48|\/\s*48)/i.test(name))return null;
  if(/jagdpanzer\s*(?:iv|4).*?l\s*48/i.test(target)&&/panzer\s*(?:iv|4)[\s/_-]*70/i.test(name))return null;

  if((f==='panzer4'||f==='panzer3'||f==='panther')&&td.test(name+' '+(p.categories||'')))return null;
  if(f==='panzer4'&&!p.verified&&!mention(name,['Panzer IV'])&&!mention(identity,['Panzer IV']))return null;
  if(/jagdpanther/i.test(target)&&!p.verified&&!/jagdpanther/i.test(identity))return null;
  if(/stuh|sturmhaubitze/i.test(target)&&!p.verified&&!/stuh|sturmhaubitze/i.test(identity))return null;
  if(/jagdpanzer/i.test(target)&&!p.verified&&!/jagdpanzer|hetzer|(?:panzer|pz)[\s._-]*(?:iv|4)[\s/_-]*70/i.test(identity))return null;
  const targetN=normalize(target),nameN=normalize(name);
  if(/tiger\s*1\b/.test(targetN)&&/jagdtiger|tiger\s*2\b/.test(nameN))return null;
  if(/tiger\s*2\b/.test(targetN)&&/jagdtiger|tiger\s*1\b/.test(nameN))return null;
  if(/tiger\s*2\b/.test(targetN)){
   const wantedTurret=/porsche|tiger\s*2\s*p\b/.test(targetN)?'p':/henschel|tiger\s*2\s*h\b/.test(targetN)?'h':null;
   const subjectTurret=/porsche|tiger\s*2\s*p\b/.test(nameN)?'p':/henschel|tiger\s*2\s*h\b/.test(nameN)?'h':null;
   if(wantedTurret&&subjectTurret&&wantedTurret!==subjectTurret)return null;
  }

  if(f==='leopard1'&&/leopard\s*2\b/.test(nameN))return null;
  if(f==='leopard2'&&/leopard\s*1\b/.test(nameN))return null;
  if(f==='panzer4'&&/panzer\s*(?:2|3)\b/.test(nameN)&&!/panzer\s*4\b/.test(nameN))return null;
  if(f==='panzer3'&&/panzer\s*(?:2|4)\b/.test(nameN)&&!/panzer\s*3\b/.test(nameN))return null;
  if(/marder\s*1(?:\s|a)/.test(targetN)&&/marder\s*3\b/.test(nameN))return null;
  if(/marder\s*3\b/.test(targetN)&&/marder\s*1(?:\s|a)/.test(nameN))return null;
  const wanted=variant(target,f),observed=variant(name,f);if(!wanted.length&&/^panzer[34]$/.test(f)){const m=String(config.key||'').match(/(?:ausf_)([a-z][12]?)$/i);if(m)wanted.push(m[1].toLowerCase());}
  if(wanted.length&&observed.length&&!observed.some(x=>wanted.includes(x)))return null;
  if(/jagdtiger/i.test(target)){const a=/porsche/i.test(target)?'porsche':/henschel/i.test(target)?'henschel':null,b=/porsche/i.test(name)?'porsche':/henschel/i.test(name)?'henschel':null;if(a&&b&&a!==b)return null;}
  if(!p.verified&&!document&&/blueprint|drawing|diagram|sketch|illustration|\.(?:svg|pdf)$/i.test(identity))return null;
  const aliases=config.aliases||config.exact||[],direct=mention(identity,aliases),captionMention=mention(caption,aliases);
  const ambiguous=aliases.some(a=>/^(?:hummel|puma|maus|nashorn|panther|tiger|tam|luchs|boxer|clovis)$/.test(normalize(a)));
  if(!p.verified&&ambiguous&&!/panzer|\btanks?\b|wehrmacht|bundeswehr|armou?red|sdkfz|sd[. ]*kfz|\bifv\b|howitzer|self.propelled|bovington|saumur|kubinka|military vehicle/i.test(identity+' '+caption))return null;
  if(!p.verified&&!direct&&!captionMention)return null;
  const preciseCategory=String(p.categories||'').split('|').some(c=>{const n=normalize(c);return (config.exact||[]).some(e=>{e=normalize(e);return e.length>5&&(n===e||n.startsWith(e+' '));});});
  const preservedProduction=config.key==='sturmtiger:production'&&/sturmtiger/i.test(identity)&&!/prototype/i.test(name)&&/sturmtiger.{0,30}(?:panzermuseum|munster|kubinka)|(?:panzermuseum|kubinka).{0,30}sturmtiger/i.test(identity);
  const special=/\bbfw\b|befehls|command|bef wg/i.test(target),specialSubject=/\bbfw\b|befehls|command|bef wg/i.test(name);
  const exact=p.verified?!!p.match:!config.related&&(preservedProduction||preciseCategory||mention(name,config.exact||[])||(wanted.length&&observed.some(x=>wanted.includes(x))&&direct));
  return{exact:exact&&(!special||specialSubject||p.verified),document:!!document,related:!(exact&&(!special||specialSubject||p.verified))&&!document,direct,captionMention,family:f};
 }
 return{normalize,mention,variant,family,classify};
});
