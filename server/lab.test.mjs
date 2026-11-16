import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLab } from './lab.mjs'

test('lab ownership, origin validation and fixed route proxy prevent cross visitor access', async () => {
  const dir=mkdtempSync(join(tmpdir(),'forge-lab-'))
  const calls=[]
  const lab=createLab({ dataDir:dir,labControlUrl:'http://control',labControlToken:'fixture-private',trustProxy:false },{
    clientIp:()=> '127.0.0.1',
    readBody:async req=>{const chunks=[];for await(const c of req) chunks.push(c);return Buffer.concat(chunks)},
    sendJson:(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))},
    fetchImpl:async (url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'a'.repeat(32),status:'queued'}),{status:201,headers:{'Content-Type':'application/json'}})},
  })
  const server=http.createServer((req,res)=>lab.handle(req,res,new URL(req.url,'http://localhost')))
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const url=`http://127.0.0.1:${server.address().port}`
  try {
    const post={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card:{data:{name:'样卡'}},apiKey:'must-not-forward',owner:'forged',enableMvu:true})}
    assert.equal((await fetch(url+'/api/lab/sessions',{...post,headers:{...post.headers,Origin:'https://attacker.test'}})).status,403)
    assert.equal(calls.length,0)
    const created=await fetch(url+'/api/lab/sessions',post)
    assert.equal(created.status,201)
    const cookie=created.headers.get('set-cookie').split(';')[0]
    assert.match(cookie,/cardforge_lab=/)
    assert.match(created.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
    const forwarded=JSON.parse(calls[0].options.body)
    assert.equal(forwarded.apiKey,undefined);assert.equal(forwarded.owner,undefined)
    assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-private')
    assert.match(calls[0].options.headers['X-Lab-Owner'],/^[a-f0-9]{64}$/)
    assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32))).status,404)
    assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32),{headers:{Cookie:cookie+'tampered'}})).status,404)
    await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32),{headers:{Cookie:cookie}})
    assert.equal(calls.length,2)
    assert.equal(calls[1].options.headers['X-Lab-Owner'],calls[0].options.headers['X-Lab-Owner'])
    assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32)+'/arbitrary',{headers:{Cookie:cookie}})).status,404)
    assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32)+'/state?actor=../admin',{headers:{Cookie:cookie}})).status,400)
    const beforeRemoved=calls.length
    for(const operation of ['action','frame']) assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32)+'/'+operation,{headers:{Cookie:cookie}})).status,404)
    assert.equal((await fetch(url+'/api/lab/sessions/'+ 'a'.repeat(32)+'/state?actor=agent',{headers:{Cookie:cookie}})).status,400)
    assert.equal(calls.length,beforeRemoved,'removed automation must never reach the worker')
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})}
})

test('native viewer tickets bind ownership, reject tampering/cross-origin writes and stream only the isolated worker',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forge-native-')),calls=[]
  const hash='b'.repeat(64);mkdirSync(join(dir,'files'));writeFileSync(join(dir,'files',hash),'public fixture')
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({profile:'forge-player-v5',entries:{'/lib/fixture.js':{file:hash,type:'text/javascript',etag:'"fixture"'}}}))
  const session={id:'a'.repeat(32),status:'ready',expiresAt:Date.now()/1000+2700}
  const lab=createLab({dataDir:dir,labControlUrl:'http://control',labControlToken:'private-fixture',labEmbedOrigin:'https://lab.test',labStaticDir:dir,trustProxy:false},{
    clientIp:()=> '127.0.0.1',
    readBody:async req=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks)},
    sendJson:(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))},
    fetchImpl:async(url,options)=>{calls.push({url,options});return url.includes('/browser?')?new Response('native html',{headers:{'Content-Type':'text/html'}}):new Response(JSON.stringify(session),{headers:{'Content-Type':'application/json'}})},
  })
  const server=http.createServer((req,res)=>lab.isBrowserHost(req)?lab.handleBrowser(req,res,new URL(req.url,'http://local')):lab.handle(req,res,new URL(req.url,'http://local')))
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`
  const native=(path,options={})=>new Promise((resolve,reject)=>{
    const request=http.request(url+path,{method:options.method||'GET',headers:{Host:'lab.test',...options.headers}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({status:response.statusCode,headers:new Headers(Object.entries(response.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])),text:async()=>Buffer.concat(chunks).toString()}))});request.on('error',reject);request.end(options.body)
  })
  try{
    const created=await fetch(url+'/api/lab/sessions',{method:'POST',body:JSON.stringify({card:{data:{name:'fixture'}}})})
    const ownerCookie=created.headers.get('set-cookie').split(';')[0]
    assert.equal((await fetch(url+`/api/lab/sessions/${session.id}/embed`)).status,404)
    const view=await(await fetch(url+`/api/lab/sessions/${session.id}/embed`,{headers:{Cookie:ownerCookie}})).json()
    assert.equal(view.origin,'https://lab.test');assert.ok(!view.url.includes('private-fixture'))
    const ticket=new URL(view.url).search
    assert.equal((await native('/')).status,401)
    assert.equal((await native('/lib/fixture.js')).status,401)
    assert.equal((await native('/'+ticket+'tampered')).status,401)
    const login=await native('/'+ticket)
    assert.equal(login.status,303);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)
    const viewCookie=login.headers.get('set-cookie').split(';')[0]
    const before=calls.length,cached=await native('/lib/fixture.js',{headers:{Cookie:viewCookie}})
    assert.equal(await cached.text(),'public fixture');assert.equal(calls.length,before)
    assert.match(cached.headers.get('content-security-policy'),/frame-ancestors/)
    assert.equal((await native('/lib/fixture.js',{headers:{Cookie:viewCookie,'If-None-Match':'"fixture"'}})).status,304)
    assert.equal((await native('/api/chats/save',{method:'POST',headers:{Cookie:viewCookie,Origin:'https://evil.test'},body:'{}'})).status,403)
    const response=await native('/api/characters/all',{method:'POST',headers:{Cookie:viewCookie+'; session-native.sig=fixture; unrelated=do-not-forward',Origin:'https://lab.test','Content-Type':'application/json','X-CSRF-Token':'fixture-csrf'},body:'{}'})
    assert.equal(await response.text(),'native html')
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self' https:\/\/tellev.click/)
    assert.match(calls.at(-1).url,/^http:\/\/control\/sessions\/a{32}\/browser\?actor=manual&path=/)
    assert.equal(calls.at(-1).options.headers['X-Browser-Cookie'],'session-native.sig=fixture')
    assert.equal(calls.at(-1).options.headers['X-CSRF-Token'],'fixture-csrf')
    assert.equal(lab.isBrowserHost({headers:{host:'attacker.test'}}),false)
    const root=await native('/',{headers:{Cookie:viewCookie}})
    assert.equal(root.headers.get('clear-site-data'),'"cache"')
    assert.match(root.headers.get('set-cookie'),/cardforge_assets=forge-player-v5-[a-f0-9]{16}; Path=\/; HttpOnly; SameSite=Strict/)
    const versionCookie=/cardforge_assets=[^;]+/.exec(root.headers.get('set-cookie'))[0]
    const current=await native('/',{headers:{Cookie:viewCookie+'; '+versionCookie}})
    assert.equal(current.headers.get('clear-site-data'),null)
    assert.equal(cached.headers.get('clear-site-data'),null)
    assert.equal(response.headers.get('clear-site-data'),null)
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})}
})
