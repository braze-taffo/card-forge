import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {createLabStatic} from './lab-static.mjs'

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y) }
export function createLab(config, { readBody, sendJson, clientIp, fetchImpl = fetch }) {
  const enabled = Boolean(config.labControlUrl && config.labControlToken)
  let secret
  if (enabled) {
    mkdirSync(config.dataDir, { recursive: true })
    const file = join(config.dataDir, 'lab-owner-secret')
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
    secret = readFileSync(file, 'utf8').trim()
  }
  const createWindows = new Map()
  const serveStatic=createLabStatic(config.labStaticDir)
  const browserHeaders=()=>({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':`default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob: data:; frame-ancestors 'self' https://tellev.click; base-uri 'self'; form-action 'self'; object-src 'none'`})
  const sign = value => createHmac('sha256', secret).update(value).digest('hex')
  const embedOrigin = config.labEmbedOrigin ? new URL(config.labEmbedOrigin).origin : ''
  const seal = value => { const data=Buffer.from(JSON.stringify(value)).toString('base64url'); return `${data}.${sign('view:'+data)}` }
  function unseal(value) {
    const [data,signature]=String(value||'').split('.')
    if (!data || !same(signature||'',sign('view:'+data))) return null
    try { const claim=JSON.parse(Buffer.from(data,'base64url')); return /^[a-f0-9]{32}$/.test(claim.id||'') && /^[a-f0-9]{64}$/.test(claim.owner||'') && claim.actor==='manual' && Number.isFinite(claim.expiresAt) && claim.expiresAt>Date.now() ? claim : null } catch{return null}
  }
  const isBrowserHost = req => Boolean(enabled && embedOrigin && req.headers.host===new URL(embedOrigin).host)
  async function handleBrowser(req,res,url) {
    if(!isBrowserHost(req))return sendJson(res,404,{error:{message:'Unknown native host'}})
    if(req.headers.origin && req.headers.origin!==embedOrigin)return sendJson(res,403,{error:{message:'请在酒馆会话中操作'}})
    if(!['GET','HEAD','POST'].includes(req.method))return sendJson(res,405,{error:{message:'Method not allowed'}})
    const bootstrap=url.searchParams.get('__forge_ticket')
    if(bootstrap){
      const claim=unseal(bootstrap)
      if(req.method!=='GET'||url.pathname!=='/'||!claim||claim.loginUntil<Date.now())return sendJson(res,401,{error:{message:'酒馆入口已过期，请回到锻卡炉重新打开'}})
      const age=Math.max(1,Math.floor((claim.expiresAt-Date.now())/1000))
      res.writeHead(303,{'Location':'/','Set-Cookie':`cardforge_view=${bootstrap}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}; Secure`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end()
    }
    const claim=unseal(/(?:^|;\s*)cardforge_view=([^;]+)/.exec(req.headers.cookie||'')?.[1])
    if(!claim)return sendJson(res,401,{error:{message:'酒馆会话未授权，请从锻卡炉进入'}})
    if(serveStatic(req,res,url,browserHeaders()))return
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),340_000)
    const aborted=()=>{if(!res.writableEnded)controller.abort()};res.on('close',aborted)
    try{
      const payload=req.method==='POST'?await readBody(req,24*1024*1024):undefined
      const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>/^session-[^=]+=/.test(s)).join('; ')
      const response=await fetchImpl(`${config.labControlUrl}/sessions/${claim.id}/browser?actor=manual&path=${encodeURIComponent(url.pathname+url.search)}`,{
        method:req.method,body:payload,redirect:'manual',signal:controller.signal,
        headers:{Authorization:`Bearer ${config.labControlToken}`,'X-Lab-Owner':claim.owner,'X-Browser-Cookie':cookie,...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(req.headers['x-csrf-token']?{'X-CSRF-Token':req.headers['x-csrf-token']}:{})},
      })
      const headers={...browserHeaders(),'Content-Type':response.headers.get('content-type')||'application/octet-stream'}
      const cookies=response.headers.getSetCookie?.()||[]
      if(cookies.length)headers['Set-Cookie']=cookies.map(c=>c.replace(/;\s*Domain=[^;]+/ig,'')+(/;\s*Secure/i.test(c)?'':'; Secure'))
      // Clear old module responses once when the pinned public asset profile changes.
      // Keep cookies, storage, drafts and the native chat untouched.
      const assetVersion=encodeURIComponent(serveStatic.profile)
      const loadedVersion=/(?:^|;\s*)cardforge_assets=([^;]+)/.exec(req.headers.cookie||'')?.[1]
      if(url.pathname==='/'&&req.method==='GET'&&response.ok&&assetVersion&&loadedVersion!==assetVersion){
        headers['Clear-Site-Data']='"cache"'
        headers['Set-Cookie']=[...(headers['Set-Cookie']||[]),`cardforge_assets=${assetVersion}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000; Secure`]
      }
      const location=response.headers.get('location');if(location){if(!location.startsWith('/')||location.startsWith('//'))throw new Error('不允许离开临时酒馆');headers.Location=location}
      res.writeHead(response.status,headers);res.flushHeaders()
      if(req.method==='HEAD'||!response.body)return res.end()
      await pipeline(Readable.fromWeb(response.body),res)
    }catch(error){if(!res.headersSent)sendJson(res,502,{error:{message:'原生酒馆连接暂时中断，请刷新酒馆；草稿仍在锻卡炉'}});else res.destroy()}
    finally{clearTimeout(timeout);res.off('close',aborted)}
  }
  function owner(req, res, create) {
    const value = /(?:^|;\s*)cardforge_lab=([^;]+)/.exec(req.headers.cookie || '')?.[1] || ''
    const [id, signature] = value.split('.')
    if (/^[a-f0-9]{48}$/.test(id || '') && same(signature || '', sign(id))) return sign(`owner:${id}`)
    if (!create) return null
    const newId = randomBytes(24).toString('hex')
    const secure = req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https')
    res.setHeader('Set-Cookie', `cardforge_lab=${newId}.${sign(newId)}; Path=/api/lab; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? '; Secure' : ''}`)
    return sign(`owner:${newId}`)
  }
  async function handle(req, res, url) {
    if (!enabled) return sendJson(res, 503, { error: { message: '临时酒馆尚未配置' } })
    const secure = req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https')
    const origin = `${secure ? 'https' : 'http'}://${req.headers.host}`
    if (req.headers.origin && req.headers.origin !== origin) return sendJson(res, 403, { error: { message: '请在锻卡炉中操作预览环境' } })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, 403, { error: { message: '请在本站操作' } })
    const path = url.pathname.replace(/^\/api\/lab/, '')
    if (path === '/health' && req.method === 'GET') {
      try {
        const response = await fetchImpl(`${config.labControlUrl}/health`, { headers: { Authorization: `Bearer ${config.labControlToken}` }, signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error('Unavailable')
        return sendJson(res, 200, await response.json())
      } catch { return sendJson(res, 503, { error: { message: '预览服务器暂时未连接' } }) }
    }
    const isCreate = path === '/sessions' && req.method === 'POST'
    if (!isCreate && !/^\/sessions\/[a-f0-9]{32}(?:\/(state|requests|result|chunk|observation|embed))?$/.test(path)) return sendJson(res, 404, { error: { message: '未知预览接口' } })
    const identity = owner(req, res, isCreate)
    if (!identity) return sendJson(res, 404, { error: { message: '预览不存在或已过期' } })
    if(path.endsWith('/embed')&&req.method==='GET'){
      if(!embedOrigin)return sendJson(res,503,{error:{message:'原生酒馆入口尚未启用'}})
      try{
        const response=await fetchImpl(config.labControlUrl+path.slice(0,-6),{headers:{Authorization:`Bearer ${config.labControlToken}`,'X-Lab-Owner':identity},signal:AbortSignal.timeout(5000)})
        if(!response.ok)return sendJson(res,response.status,{error:{message:'预览不存在或不可用'}})
        const session=await response.json();if(session.status!=='ready')return sendJson(res,409,{error:{message:'酒馆尚未就绪'}})
        const ticket=seal({id:session.id,owner:identity,actor:'manual',expiresAt:session.expiresAt*1000,loginUntil:Date.now()+120_000})
        return sendJson(res,200,{url:embedOrigin+'/?__forge_ticket='+ticket,origin:embedOrigin})
      }catch{return sendJson(res,502,{error:{message:'无法获取原生酒馆入口'}})}
    }
    if (isCreate) {
      const ip = clientIp(req), now = Date.now()
      const list = (createWindows.get(ip) || []).filter(t => now-t < 3600_000)
      if (list.length >= 6) return sendJson(res, 429, { error: { message: '每小时最多新建 6 次预览，请稍后再试' } })
      list.push(now); createWindows.set(ip, list)
      if (createWindows.size > 10000) for (const [key, list] of createWindows) if (list.every(t => now-t >= 3600_000)) createWindows.delete(key)
    }
    let payload
    if (req.method === 'POST') {
      try { payload = JSON.parse((await readBody(req, path.endsWith('/result') ? 24*1024*1024 : 8*1024*1024)).toString('utf8')) }
      catch { return sendJson(res, 400, { error: { message: '预览数据格式无效' } }) }
      if (isCreate) {
        if (!payload?.card?.data?.name || typeof payload.card.data.name !== 'string') return sendJson(res, 400, { error: { message: '请先填写角色名称' } })
        payload = { card: payload.card, persona: String(payload.persona || '玩家').slice(0, 80), enableMvu: payload.enableMvu === true, mobile: payload.mobile === true }
      }
    }
    const actor = url.searchParams.get('actor') || 'manual'
    if (actor !== 'manual' || (payload?.actor && payload.actor !== 'manual')) return sendJson(res, 400, { error: { message: '仅支持玩家预览' } })
    try {
      const response = await fetchImpl(`${config.labControlUrl}${path}?actor=${actor}`, {
        method: req.method,
        headers: { Authorization: `Bearer ${config.labControlToken}`, 'X-Lab-Owner': identity, 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(55_000),
      })
      const result = await response.json()
      if (typeof result.error === 'string') result.error = { message: result.error }
      sendJson(res, response.status, result)
    } catch { sendJson(res, 502, { error: { message: '无法连接预览服务器，请稍后重试；草稿仍保存在浏览器中' } }) }
  }
  return { enabled, handle, isBrowserHost, handleBrowser }
}
