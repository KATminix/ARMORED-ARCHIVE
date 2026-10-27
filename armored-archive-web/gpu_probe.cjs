// Reports how much memory this computer's GPUs have, for the path-tracer minimum (12 GB).
// Dedicated VRAM on Windows/Linux; unified memory on Apple-silicon Macs. Read-only, cached.
const {execFile}=require('node:child_process'),fs=require('node:fs'),os=require('node:os');
const run=(cmd,args)=>new Promise(r=>execFile(cmd,args,{windowsHide:true,timeout:8000,maxBuffer:1<<20},(e,out)=>r(e?'':String(out))));
const vendorOf=n=>/nvidia|geforce|quadro|rtx|tesla/i.test(n)?'nvidia':/amd|radeon|ati /i.test(n)?'amd':/intel|arc /i.test(n)?'intel':/apple/i.test(n)?'apple':'';
const GB=2**30;
async function windows(){
 // Win32_VideoController lists only adapters that are present; the display class key holds the 64-bit VRAM size
 // (AdapterRAM in WMI is a 32-bit field and stops at 4 GB).
 const ps=`$p=@(Get-CimInstance Win32_VideoController|%{$_.Name});`+
  `Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -EA SilentlyContinue|?{$_.DriverDesc -and ($p -contains $_.DriverDesc)}|%{`+
  `$m=$_.'HardwareInformation.qwMemorySize';if($m -eq $null){$m=$_.'HardwareInformation.MemorySize'};`+
  `if($m -is [byte[]]){$b=[byte[]]::new(8);[Array]::Copy($m,$b,[Math]::Min(8,$m.Length));$m=[BitConverter]::ToInt64($b,0)};`+
  `@{name=$_.DriverDesc;bytes=[int64]$m}}|ConvertTo-Json -Compress`;
 let list=[];try{const v=JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps])).trim()||'[]');list=(Array.isArray(v)?v:[v]).map(g=>({name:g.name,bytes:+g.bytes||0}));}catch{}
 if(!list.some(g=>g.bytes>0))list=await nvidiaSmi();
 return list;}
async function nvidiaSmi(){return (await run('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader,nounits'])).trim().split('\n').filter(Boolean)
 .map(l=>{const i=l.lastIndexOf(',');return {name:l.slice(0,i).trim(),bytes:Math.round(+l.slice(i+1)*2**20)};});}
async function linux(){const list=await nvidiaSmi();
 try{for(const c of fs.readdirSync('/sys/class/drm')){if(!/^card\d+$/.test(c))continue;try{list.push({name:'AMD Radeon '+c,bytes:+fs.readFileSync(`/sys/class/drm/${c}/device/mem_info_vram_total`,'utf8')});}catch{}}}catch{}
 return list;}
async function mac(){
 if(process.arch==='arm64')return [{name:'Apple GPU (unified memory)',bytes:os.totalmem(),unified:true}];
 let list=[];try{for(const d of JSON.parse(await run('system_profiler',['SPDisplaysDataType','-json'])).SPDisplaysDataType||[]){
  const m=/([\d.]+)\s*(GB|MB)/i.exec(d.spdisplays_vram||d.spdisplays_vram_shared||'');list.push({name:d.sppci_model||'GPU',bytes:m?+m[1]*(m[2].toUpperCase()==='GB'?GB:2**20):0});}}catch{}
 return list;}
let cached=null;
module.exports=async function gpuProbe(){
 if(cached)return cached;
 const gpus=(await (process.platform==='win32'?windows():process.platform==='darwin'?mac():linux())).map(g=>({...g,vendor:vendorOf(g.name)||(g.unified?'apple':'')}));
 const r={source:process.platform,gpus};if(gpus.length)cached=r;return r;};
