import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineFetch } from '../lib/plugins/research/deadline.js';

test('expired search budget does not start the next provider request', async()=>{ let calls=0; await assert.rejects(()=>deadlineFetch(async()=>{calls++},Date.now()-1)('https://unused.example'),/budget/i);assert.equal(calls,0); });
test('slow requests are cancelled, not just ignored after timeout',async()=>{ let aborted=false;const f=async(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);})); const keep=setTimeout(()=>{},200);try{await assert.rejects(()=>deadlineFetch(f,Date.now()+25)('https://unused.example'));assert.equal(aborted,true);}finally{clearTimeout(keep);} });