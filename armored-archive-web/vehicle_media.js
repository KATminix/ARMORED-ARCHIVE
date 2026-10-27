// Shared by the browser and backend. Broad photographic retrieval with explicit match labels.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VehicleMedia=api})(typeof window==='object'?window:globalThis,function(){
 const families={
  sturmtiger:{queries:['"Sturmtiger"','"Sturmmörser"'],family:/\bsturmtiger\b|\bsturmm[oö]rser(?:wagen)?\b|\btiger[- ]m[oö]rser\b/i},
  leopard1:{queries:['"Leopard 1"','"Leopard 1A5"','"Leopard 1A1"'],family:/\bleopard\s*(?:1|i)(?:\s*a\d[a-z\d]*)?\b/i},
  flakpanzer:{queries:['"Flakpanzer Gepard"','"Flugabwehrkanonenpanzer Gepard"'],family:/\b(?:flakpanzer|flugabwehrkanonenpanzer)\s*gepard\b|\bgepard\s*1a[12]\b|\bgepard\b.{0,90}(?:35\s*mm|anti[- ]aircraft|spaag|leopard)|(?:anti[- ]aircraft|spaag).{0,90}\bgepard\b/i},
  raketenjagdpanzer:{queries:['"Raketenjagdpanzer"','"Jaguar 1" tank'],family:/\braketenjagdpanzer\b|\brak(?:jg|j)pz\b|\bjaguar\s*1(?:a\d)?\b.{0,80}(?:tank|panzer|hot|atgm)|(?:tank|jagdpanzer|hot|atgm).{0,80}\bjaguar\s*1(?:a\d)?\b/i},
  marder:{queries:['"Marder 1A3"','"Marder 1A5"','"Marder" "infantry"'],family:/\bmarder\s*1(?:\s*a[1-5][a-z\d-]*)?\b|\bmarder\s*a[1-5]\b|\bmarder\b.{0,80}(?:infantry fighting|ifv|sch[uü]tzenpanzer)|(?:infantry fighting|ifv|sch[uü]tzenpanzer).{0,80}\bmarder\b/i}
 };
 const variants={
  'sturmtiger:prototype':/\b(?:sturmtiger|sturmm[oö]rser)\s*(?:prototype|prototyp|1943)\b|\b(?:prototype|prototyp)\s*(?:sturmtiger|sturmm[oö]rser)\b/i,
  'sturmtiger:production':/\bsturmtiger\b.{0,40}\bproduction\b|\bproduction\s*sturmtiger\b/i,
  'leopard1:a0':/\bleopard\s*1\s*a0\b|\bleopard\s*1\b.{0,50}\b(?:196[5-9]|original)\b/i,
  'leopard1:a1':/\bleopard\s*1\s*a1\b(?!a\d)/i,
  'leopard1:a5':/\bleopard\s*1\s*a5\b/i,
  'flakpanzer:gepard':/\b(?:flakpanzer|flugabwehrkanonenpanzer)\s*gepard\b|\bgepard\b/i,
  'raketenjagdpanzer:rakjpz1':/\braketenjagdpanzer\s*1\b|\brak(?:jg|j)pz\s*1\b/i,
  'raketenjagdpanzer:rakjpz2':/\braketenjagdpanzer\s*2\b|\brak(?:jg|j)pz\s*2\b/i,
  'raketenjagdpanzer:jaguar1':/\bjaguar\s*1(?:a\d)?\b|\brak(?:jg|j)pz\s*(?:3|2\s*\(?hot\)?)\b/i,
  'marder:a3':/\bmarder\s*1\s*a3\b/i,
  'marder:a5':/\bmarder\s*1\s*a5\b/i
 };
 const notPhoto=/\b(?:lego|diorama|replica|tamiya|revell|airfix|trumpeter|toy|scale model|modellbau|screenshot|war thunder|world of tanks|drawing|illustration|blueprint|diagram|sketch|operators|map|stamp|coin)\b|\.(?:svg|pdf)$/i;
 const normalize=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/[_–—]/g,' ').replace(/\s+/g,' ');
 function classify(key,p){
  const [f]=key.split(':'),cfg=families[f];if(!cfg)return null;
  const identity=normalize([p.title,p.objectName].join(' ')),categories=normalize(p.categories),desc=normalize(p.description);
  if(notPhoto.test(identity+' '+categories))return null;
  const direct=cfg.family.test(identity),category=cfg.family.test(categories),mention=cfg.family.test(desc);
  if(!direct&&!category&&!mention)return null;
  // Broad caption mentions are accepted, but never presented as verified visual identification.
  const exact=variants[key]?.test(identity+' '+categories)||false;
  const matched=exact?'VARIANT METADATA MATCH':direct||category?'FAMILY PHOTO (variant unconfirmed)':'CAPTION MENTION (subject unconfirmed)';
  return {...p,kind:'photo',match:exact,matchLabel:matched,score:exact?100:direct?65:category?55:25,identification:exact?'Variant named in title or category':direct?'Vehicle family named in title':category?'Vehicle family identified by Commons category':'Vehicle mentioned in caption; inspect the photograph for the subject'};
 }
 const photoId=p=>p.page||p.original||p.url||p.full||p.title;
 function rank(key,photos,max=30){
  const unique=new Map();for(const p of photos){const result=classify(key,p);if(!result)continue;const id=photoId(p),prev=unique.get(id);if(!prev||prev.score<result.score)unique.set(id,result)}
  return [...unique.values()].sort((a,b)=>b.score-a.score).slice(0,max);
 }
 return {families,variants,classify,rank,photoId};
});
