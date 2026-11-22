// Windows CurrentUser DPAPI. Plaintext goes only through anonymous process
// pipes, never command-line arguments, environment variables, logs or source.
import {spawn} from 'node:child_process';
import process from 'node:process';
import {mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
export const localAgentHome=()=>join(process.env.LOCALAPPDATA??'', 'EclipsoResearchAgent');
export const serperKeyPath=()=>join(localAgentHome(),'secrets','serper.dpapi');
export const historyKeyPath=()=>join(localAgentHome(),'secrets','history.dpapi');
export const draftKeyPath=()=>join(localAgentHome(),'secrets','draft-review.dpapi');
export const researchSyncKeyPath=()=>join(localAgentHome(),'secrets','research-sync.dpapi');
export const researchReadKeyPath=()=>join(localAgentHome(),'secrets','research-read.dpapi');
function powershell(script,input=''){
  return new Promise((resolve,reject)=>{
    // PowerShell 7's inherited module path can prevent Windows PowerShell 5
    // from finding its own inbox DPAPI cmdlets. Use that runtime's inbox path.
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,PSModulePath:join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/Modules')}});
    let out='',size=0;const timer=setTimeout(()=>{p.kill();reject(new Error('LOCAL_SECRET_OPERATION_TIMEOUT'));},15000);
    p.stdout.on('data',b=>{size+=b.length;if(size>8192){p.kill();reject(new Error('LOCAL_SECRET_RESPONSE_TOO_LARGE'));}else out+=b;});
    p.stderr.on('data',()=>{});p.on('error',()=>{clearTimeout(timer);reject(new Error('LOCAL_SECRET_OPERATION_FAILED'));});
    p.on('exit',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(new Error('LOCAL_SECRET_OPERATION_FAILED'));});
    p.stdin.on('error',()=>{});p.stdin.end(input);
  });
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function saveSerperKey(key){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('WINDOWS_USER_PROFILE_REQUIRED');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{20,200}$/.test(key))throw new Error('INVALID_KEY_FORMAT');
  await mkdir(join(localAgentHome(),'secrets'),{recursive:true});
  await powershell(`$ErrorActionPreference='Stop';$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString -String $v -AsPlainText -Force;$e=ConvertFrom-SecureString -SecureString $s;[IO.File]::WriteAllText(${quote(serperKeyPath())},$e);$v=$null`,key);
}
export async function loadSerperKey(){
  try{await access(serperKeyPath());}catch{return null;}
  const key=await powershell(`$ErrorActionPreference='Stop';$s=ConvertTo-SecureString ([IO.File]::ReadAllText(${quote(serperKeyPath())}));$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`);
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(key))throw new Error('INVALID_STORED_KEY');
  return key;
}
export async function hasSerperKey(){try{await access(serperKeyPath());return true;}catch{return false;}}
export async function saveHistoryKey(key){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('WINDOWS_USER_PROFILE_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(key??''))throw new Error('INVALID_HISTORY_KEY_FORMAT');
  await mkdir(join(localAgentHome(),'secrets'),{recursive:true});
  await powershell(`$ErrorActionPreference='Stop';$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString -String $v -AsPlainText -Force;$e=ConvertFrom-SecureString -SecureString $s;[IO.File]::WriteAllText(${quote(historyKeyPath())},$e);$v=$null`,key);
}
export async function loadHistoryKey(){
  try{await access(historyKeyPath());}catch{return null;}
  const key=await powershell(`$ErrorActionPreference='Stop';$s=ConvertTo-SecureString ([IO.File]::ReadAllText(${quote(historyKeyPath())}));$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`);
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('INVALID_STORED_HISTORY_KEY');return key;
}
export async function saveDraftKey(key){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('WINDOWS_USER_PROFILE_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(key??''))throw new Error('INVALID_DRAFT_KEY_FORMAT');
  await mkdir(join(localAgentHome(),'secrets'),{recursive:true});
  await powershell(`$ErrorActionPreference='Stop';$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString -String $v -AsPlainText -Force;$e=ConvertFrom-SecureString -SecureString $s;[IO.File]::WriteAllText(${quote(draftKeyPath())},$e);$v=$null`,key);
}
export async function loadDraftKey(){
  try{await access(draftKeyPath());}catch{return null;}
  const key=await powershell(`$ErrorActionPreference='Stop';$s=ConvertTo-SecureString ([IO.File]::ReadAllText(${quote(draftKeyPath())}));$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`);
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('INVALID_STORED_DRAFT_KEY');return key;
}

async function saveResearchKey(path,key){
  if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw new Error('WINDOWS_USER_PROFILE_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(key??''))throw new Error('INVALID_RESEARCH_KEY_FORMAT');
  await mkdir(join(localAgentHome(),'secrets'),{recursive:true});
  await powershell(`$ErrorActionPreference='Stop';$v=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString -String $v -AsPlainText -Force;$e=ConvertFrom-SecureString -SecureString $s;[IO.File]::WriteAllText(${quote(path)},$e);$v=$null`,key);
}
async function loadResearchKey(path){
  try{await access(path);}catch{return null;}
  const key=await powershell(`$ErrorActionPreference='Stop';$s=ConvertTo-SecureString ([IO.File]::ReadAllText(${quote(path)}));$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}`);
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('INVALID_STORED_RESEARCH_KEY');return key;
}
export const saveResearchSyncKey=key=>saveResearchKey(researchSyncKeyPath(),key);
export const loadResearchSyncKey=()=>loadResearchKey(researchSyncKeyPath());
export const saveResearchReadKey=key=>saveResearchKey(researchReadKeyPath(),key);
export const loadResearchReadKey=()=>loadResearchKey(researchReadKeyPath());
const outreachQueueKeyPath=()=>join(localAgentHome(),'secrets','discord-outreach-queue.dpapi');
export const saveOutreachQueueKey=key=>saveResearchKey(outreachQueueKeyPath(),key);
export const loadOutreachQueueKey=()=>loadResearchKey(outreachQueueKeyPath());
const outreachPairingKeyPath=()=>join(localAgentHome(),'secrets','outreach-local-pairing.dpapi');
export const saveOutreachPairingKey=key=>saveResearchKey(outreachPairingKeyPath(),key);
export const loadOutreachPairingKey=()=>loadResearchKey(outreachPairingKeyPath());
