import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
const base='http://127.0.0.1:5182';const evidence=[];
async function test(name,work){await work();evidence.push({name,result:'pass'});}
async function post(data,headers={}){return fetch(base+'/api/test',{method:'POST',headers:{'Content-Type':'application/json','X-WaveScope':'local-action',...headers},body:JSON.stringify(data)});}
await test('health and static root',async()=>{assert.equal((await fetch(base)).status,200);assert.equal((await (await fetch(base+'/api/health')).json()).status,'ok');});
await test('real OS snapshot schema',async()=>{const r=await (await fetch(base+'/api/network')).json();assert.ok(Array.isArray(r.ip));assert.ok(r.timestamp);assert.equal(r.rssi,null);});
await test('cross-origin requests denied',async()=>{assert.equal((await post({},{Origin:'https://example.com'})).status,403);});
await test('missing action header denied',async()=>{assert.equal((await fetch(base+'/api/test',{method:'POST',body:'{}'})).status,403);});
await test('command injection rejected',async()=>{assert.equal((await post({kind:'icmp',host:'x;calc.exe',count:4,interval:1})).status,400);});
await test('invalid sampling rejected',async()=>{assert.equal((await post({kind:'icmp',host:'127.0.0.1',count:9999,interval:1})).status,400);});
await test('real ICMP loopback probes',async()=>{const response=await post({kind:'icmp',host:'127.0.0.1',count:4,interval:1});assert.equal(response.status,200);const result=await response.json();assert.equal(result.samples.length,4);assert.ok(result.samples.every(n=>n===null||n>=0));evidence.push({name:'loopback response count',value:result.samples.filter(n=>n!==null).length});});
await test('cached nearby scan response',async()=>{const response=await fetch(base+'/api/scan',{method:'POST',headers:{'X-WaveScope':'local-action','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.ok(Array.isArray((await response.json()).networks));});
mkdirSync('qa',{recursive:true});writeFileSync('qa/api-check.json',JSON.stringify({at:new Date().toISOString(),evidence},null,2));
process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
