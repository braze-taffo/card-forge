import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('HTTP 后台鉴权、跨站拒绝、即时停用和独立模型额度', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'card-forge-http-'))
  const credentials = join(directory, 'admin.json')
  const password = 'test-only-http-password-1234'
  writeFileSync(credentials, JSON.stringify({ username:'admin', password }))
  const upstream = http.createServer((req,res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
    const payload = JSON.parse(Buffer.concat(chunks))
    assert.equal(payload.stream_options.include_usage, true)
    const mode = payload.messages[0].content
    if (mode === 'error') { res.writeHead(500); res.end('{"error":{"message":"synthetic failure"}}'); return }
    if (mode === 'cancel') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); return }
    if (mode === 'truncated') { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); return }
    res.writeHead(200, {'Content-Type':'text/event-stream'})
    res.end('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve))
  const reservation = http.createServer()
  await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath,[fileURLToPath(new URL('./index.mjs',import.meta.url))], {
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:directory,ADMIN_CREDENTIALS_FILE:credentials,ACCESS_CODE:'',DEEPSEEK_API_KEY:'search-test-key',FREE_API_KEY:'test-key',FREE_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,FREE_MODELS:JSON.stringify([{id:'step',name:'Step',ratePerMinute:10,dailyRequestsPerIp:1},{id:'deepseek',name:'DeepSeek',ratePerMinute:10,dailyRequestsPerIp:2}])},
    stdio:['ignore','pipe','pipe'],
  })
  context.after(async () => {
    if (child.exitCode === null) {
      const ended = new Promise(resolve => child.once('exit',resolve))
      child.kill()
      await ended
    }
    await new Promise(resolve => upstream.close(resolve))
    rmSync(directory,{recursive:true,force:true})
  })
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>reject(new Error('Server startup timeout')),5000)
    child.once('error',reject)
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited: '+code))})
    child.stdout.on('data',data=>{if(String(data).includes('listening on')){clearTimeout(timeout);resolve()}})
  })
  const base = `http://127.0.0.1:${port}`
  const call = (path, method='GET', body, cookie='', origin=base) => fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:origin},...(body?{body:JSON.stringify(body)}:{})})
  assert.equal((await call('/api/admin/settings')).status,401)
  assert.equal((await call('/api/admin/analytics')).status,401)
  assert.equal((await call('/api/admin/login','POST',{username:'admin',password},'','https://foreign.example')).status,403)
  const login = await call('/api/admin/login','POST',{username:'admin',password})
  assert.equal(login.status,200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  assert.match(login.headers.get('set-cookie'),/HttpOnly/)
  assert.match(login.headers.get('set-cookie'),/SameSite=Strict/)
  const publicConfig = await (await call('/api/config')).json()
  assert.equal(publicConfig.freeModels[0].dailyRequestsPerIp,1)
  assert.ok(!JSON.stringify(publicConfig).includes('test-key'))
  assert.equal(publicConfig.webSearchAvailable, true)
  assert.equal((await call('/api/tools/web-search', 'POST', { query: ' ' })).status, 400)
  const chat = model => call('/api/v1/chat/completions','POST',{model,messages:[{role:'user',content:'OK'}]})
  await (await call('/')).text()
  await (await call('/')).text()
  await (await call('/admin')).text()
  await (await call('/brand/card-forge-icon.png')).arrayBuffer()
  await call('/', 'HEAD')
  assert.equal((await chat('unlisted')).status,400)
  const streamed = await chat('step')
  assert.equal(streamed.status,200)
  assert.ok((await streamed.text()).includes('"total_tokens":14'))
  assert.equal((await chat('step')).status,429)
  assert.equal((await chat('deepseek')).status,200)
  const stats = await (await call('/api/admin/analytics?period=all','GET',undefined,cookie)).json()
  assert.equal(stats.summary.uniqueVisitors,1)
  assert.equal(stats.summary.visits,2)
  assert.equal(stats.summary.calls,2)
  assert.equal(stats.summary.requests,3)
  assert.equal(stats.summary.blocked,1)
  assert.equal(stats.summary.totalTokens,28)
  assert.equal(stats.ips[0].models.step.calls,1)
  assert.equal(stats.ips[0].models.deepseek.calls,1)
  const settings = await (await call('/api/admin/settings','GET',undefined,cookie)).json()
  settings.models[0].dailyRequestsPerIp=20
  assert.equal((await call('/api/admin/settings','PUT',settings,cookie)).status,200)
  const modeCall = (mode, signal) => fetch(base+'/api/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'step',messages:[{role:'user',content:mode}]}), signal })
  assert.equal((await modeCall('error')).status,500)
  assert.ok((await (await modeCall('truncated')).text()).includes('partial'))
  const controller = new AbortController()
  const cancellation = await modeCall('cancel',controller.signal)
  await cancellation.body.getReader().read()
  controller.abort()
  let finalStats
  for (let attempt=0;attempt<100;attempt++) {
    finalStats = await (await call('/api/admin/analytics?period=all','GET',undefined,cookie)).json()
    if (!finalStats.summary.inFlight) break
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.equal(finalStats.summary.inFlight,0)
  assert.equal(finalStats.summary.calls,5)
  assert.equal(finalStats.summary.failed,1)
  assert.equal(finalStats.summary.interrupted,2)
  assert.equal(finalStats.summary.usageMissing,3)
  assert.equal(finalStats.summary.totalTokens,28)
  await (await fetch(base+'/',{headers:{'X-Forwarded-For':'192.0.2.77, 127.0.0.1'}})).text()
  const safeIp = await (await call('/api/admin/analytics?period=all','GET',undefined,cookie)).json()
  assert.equal(safeIp.summary.uniqueVisitors,1,'客户端伪造 XFF 首项不能成为访客 IP')
  assert.equal(safeIp.ips[0].ip,'127.0.0.1')
  settings.models[0].enabled=false
  assert.equal((await call('/api/admin/settings','PUT',settings,cookie)).status,200)
  const disabled = await (await call('/api/config')).json()
  assert.deepEqual(disabled.freeModels.map(model=>model.id),['deepseek'])
  assert.equal((await chat('step')).status,400)
  assert.equal((await call('/api/admin/logout','POST',{},cookie)).status,200)
  assert.equal((await call('/api/admin/settings','GET',undefined,cookie)).status,401)
})
