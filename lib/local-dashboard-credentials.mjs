import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const file=new URL('../.work/dashboard-credentials.dpapi',import.meta.url);
async function protect(value,decrypt=false) {
  if(process.platform!=='win32')throw new Error('Automatic credential storage requires Windows; use environment variables on other hosts.');
  const command=decrypt
    ? "$ErrorActionPreference='Stop'; $data=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $data; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }"
    : "$ErrorActionPreference='Stop'; $data=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $data -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $secure))";
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let result='';const timer=setTimeout(()=>child.kill(),10000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{result+=chunk;});child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Windows credential protection unavailable'));});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(result):reject(new Error('Cannot read/write credentials for this Windows account'));});
    child.stdin.end(value);
  });
}
export async function saveDashboardCredentials(env) {
  const encrypted=await protect(JSON.stringify(env));await mkdir(new URL('../.work/',import.meta.url),{recursive:true});await writeFile(file,encrypted,{mode:0o600});
}
export async function loadDashboardCredentials() {
  let data;try{data=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {};throw error;}
  return JSON.parse(await protect(data,true));
}
