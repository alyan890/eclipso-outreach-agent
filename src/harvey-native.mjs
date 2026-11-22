import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
export const NATIVE_REVISION='b7038562f1679038c2c08d222eaddf774890380f';
export function createNativeHarvey(){
 const child=spawn('C:/Users/Work/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',['-u',fileURLToPath(new URL('../tools/harvey-data-bridge.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout}),pending=[];let dead=false;
 child.stderr.on('data',()=>{});
 lines.on('line',line=>{const p=pending.shift();if(!p)return;clearTimeout(p.timer);try{const result=JSON.parse(line);result.ok?p.resolve(result.result):p.reject(new Error(result.reason?.startsWith('SEARCH_')?result.reason:'NATIVE_HARVEY_'+result.reason));}catch{p.reject(new Error('NATIVE_RESPONSE_INVALID'));}});
 const fail=()=>{dead=true;for(const p of pending.splice(0)){clearTimeout(p.timer);p.reject(new Error('NATIVE_RUNTIME_STOPPED'));}};
 child.on('exit',fail);child.on('error',fail);child.stdin.on('error',fail);
 return {request(input){if(dead)return Promise.reject(new Error('NATIVE_RUNTIME_STOPPED'));return new Promise((resolve,reject)=>{const p={resolve,reject,timer:setTimeout(()=>{child.kill();reject(new Error('NATIVE_RUNTIME_TIMEOUT'));},60000)};pending.push(p);child.stdin.write(JSON.stringify(input)+'\n');});},close(){child.stdin.end();lines.close();child.kill();}};
}
