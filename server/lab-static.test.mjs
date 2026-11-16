import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLabStatic} from './lab-static.mjs'
test('native mirror serves only manifest-listed public files and preserves conditional caching',()=>{
 const dir=mkdtempSync(join(tmpdir(),'forge-static-'))
 try{
  mkdirSync(join(dir,'files'));const hash='a'.repeat(64);writeFileSync(join(dir,'files',hash),'fixture')
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({entries:{'/scripts/bridge.js':{file:hash,type:'text/javascript',etag:'"fixture"'},'/unsafe':{file:'../secret'}}}))
  const serve=createLabStatic(dir),headers={};let status,ended=false
  const res={writeHead(s,h){status=s;Object.assign(headers,h)},end(){ended=true}}
  assert.equal(serve({method:'POST',headers:{}},res,new URL('https://lab.test/scripts/bridge.js'),{}),false)
  for(const path of ['/index.html','/api/chats/get','/unsafe','/scripts/../secrets'])assert.equal(serve({method:'HEAD',headers:{}},res,new URL('https://lab.test'+path),{}),false)
  assert.equal(serve({method:'HEAD',headers:{}},res,new URL('https://lab.test/scripts/bridge.js?version=1'),{'Content-Security-Policy':'fixture'}),true)
  assert.equal(status,200);assert.equal(ended,true);assert.equal(headers['Content-Security-Policy'],'fixture');assert.match(headers['Cache-Control'],/private/)
  serve({method:'GET',headers:{'if-none-match':'"fixture"'}},res,new URL('https://lab.test/scripts/bridge.js'),{})
  assert.equal(status,304)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
