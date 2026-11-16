// One player ST session. Import directly; the native player page initializes scripts.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createAssetAdapter, proxyBrowser, PORTAL_ORIGIN } from './browser-proxy.mjs';
import { convertCharacterBook } from './worldbook-converter.mjs';
import sanitize from '/app/tavern/node_modules/sanitize-filename/index.js';

const token = process.env.LAB_WORKER_TOKEN;
if (!token) throw new Error('Missing worker credential');
const profile = JSON.parse(readFileSync('/app/profile.json', 'utf8'));
const assets = JSON.parse(readFileSync('/app/assets/manifest.json', 'utf8'));
const assetAdapter = createAssetAdapter(assets, '/app/assets');
const branches = new Map();
const pending = new Map();
const errors = [];
const nativeSessionId=randomUUID();
let snapshot, initializing = false, totalRequests = 0;
const record = (actor, message, kind = 'error') => { errors.push({ actor, kind, at: Date.now(), message: String(message).slice(0, 1600) }); if (errors.length > 60) errors.shift(); };
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req, limit = 8 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('请求过大'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
const authorized = (req) => {
    const input = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    return input.length === expected.length && timingSafeEqual(input, expected);
};
function hasMvu(value) {
    if (!value || typeof value !== 'object' || value.enabled === false) return false;
    if (typeof value.content === 'string' && /MagicalAstrogy\/MagVarUpdate/i.test(value.content)) return true;
    return Object.values(value).some(v => Array.isArray(v) ? v.some(hasMvu) : typeof v === 'object' && hasMvu(v));
}
function actorOf(value) { if (value !== 'manual') throw new Error('仅支持玩家预览'); return branches.get(value); }

// Loopback proxy used only during initialization.
for(const [actor,port] of [['manual',8730]]){
    const adapter=createAssetAdapter(assets,'/app/assets',`http://127.0.0.1:${port}`);
    http.createServer(async(req,res)=>{
        const branch=branches.get(actor);
        if(!branch){res.writeHead(503);return res.end('Starting')}
        req.headers['x-browser-cookie']=req.headers.cookie||'';
        res.setHeader('Content-Security-Policy',"default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob: data:; object-src 'none'");
        try{await proxyBrowser(req,res,branch,req.url,adapter,branch.nativeDetached?{...branch.selected,sessionId:nativeSessionId,parentOrigin:PORTAL_ORIGIN}:null)}catch(error){record(actor,error.message,error.name==='AbortError'?'server-log':'error');if(!res.headersSent&&!res.destroyed)json(res,502,{error:error.message});else res.destroy()}
    }).listen(port,'127.0.0.1');
}

// The ST backend calls this local endpoint. The user's browser fulfills requests;
// credentials remain on the user's browser and normal site quotas still apply.
http.createServer(async (req, res) => {
    try {
        const actor = 'manual';
        if (!req.url.startsWith('/manual/v1/')) return json(res, 404, {});
        if (req.url.endsWith('/models')) return json(res, 200, { object: 'list', data: [{ id: 'forge-lab', object: 'model' }] });
        if (!req.url.endsWith('/chat/completions') || req.method !== 'POST') return json(res, 404, {});
        const payload = await body(req);
        if (!Array.isArray(payload.messages)) throw new Error('缺少酒馆提示词');
        const branch=branches.get(actor);
        if(branch)branch.modelCalls=(branch.modelCalls||0)+1;
        if (++totalRequests > 40) return json(res, 429, { error: { message: '本次酒馆预览已达到 40 次模型调用上限' } });
        const id = randomUUID();
        const timer = setTimeout(() => {
            pending.delete(id);
            if (!res.writableEnded) {const error={error:{message:'模型桥接超时，请保持锻卡炉预览窗口打开'}};if(res.headersSent)res.end(`data: ${JSON.stringify(error)}\n\ndata: [DONE]\n\n`);else json(res,504,error)}
        }, 300_000);
        const slot = { id, actor, payload, res, timer, claimedAt: 0, stream: !!payload.stream, sequence:0, text:'', reasoning:'' };
        pending.set(id, slot);
        res.on('close', () => { clearTimeout(timer); pending.delete(id); });
    } catch (e) { if (!res.headersSent) json(res, 400, { error: { message: e.message } }); }
}).listen(8750, '127.0.0.1');

async function startBranch(actor, port) {
    const base = join('/tmp/session', actor);
    const user = join(base, 'data', 'default-user');
    mkdirSync(user, { recursive: true });
    const settings = JSON.parse(readFileSync('/app/tavern/default/content/settings.json', 'utf8'));
    settings.firstRun = false; settings.username = snapshot.persona || '玩家'; settings.main_api = 'openai';
    settings.oai_settings = { ...settings.oai_settings, chat_completion_source: 'custom', custom_url: `http://127.0.0.1:8750/${actor}/v1`, custom_model: 'forge-lab', custom_prompt_post_processing: 'none', stream_openai: true, openai_max_context: 32768, openai_max_tokens: 2048, max_context_unlocked: true, temp_openai: 0.9 };
    settings.oai_settings.prompts.find(p => p.identifier === 'main').content = 'Write {{char}}’s next reply in a fictional roleplay with {{user}}. Follow the character, world, examples and current scene. Leave {{user}}’s decisions and dialogue to the player.';
    settings.extension_settings.tavern_helper = { render: { enabled: true }, script: { enabled: { global: true, characters: [] }, scripts: snapshot.enableMvu && !hasMvu(snapshot.card.data.extensions?.tavern_helper) ? [{ type: 'script', id: 'forge-mvu', name: 'MVU（固定测试版本）', enabled: true, content: "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@54be11b09f21b1c4266e2d54b6f1ba9a3598db05/artifact/bundle.js';", info: '', button: { enabled: false, buttons: [] } }] : [] } };
    settings.extension_settings.disabledExtensions = [];
    writeFileSync(join(user, 'settings.json'), JSON.stringify(settings));
    const cfg = readFileSync('/app/tavern/default/config.yaml', 'utf8')
        .replace(/dataRoot: .*/, `dataRoot: ${base}/data`)
        .replace(/port: 8000/, `port: ${port}`)
        .replace(/enabled: true/, 'enabled: false')
        .replace(/whitelistDockerHosts: true/, 'whitelistDockerHosts: false')
        .replace(/enableServerPlugins: true/, 'enableServerPlugins: false')
        .replace(/autoUpdate: true/, 'autoUpdate: false')
        .replace(/autoDownload: true/, 'autoDownload: false');
    writeFileSync(join(base, 'config.yaml'), cfg);
    const child = spawn('node', ['server.js', '--configPath', join(base, 'config.yaml'), '--dataRoot', join(base, 'data'), '--port', String(port)], { cwd: '/app/tavern', stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', b => record(actor, b.toString(), 'server-log'));
    child.on('exit', code => record(actor, `酒馆进程退出 ${code}`));
    for (let n = 0; n < 90; n++) {
        try { const r = await fetch(`http://127.0.0.1:${port}/csrf-token`); if (r.ok) break; } catch {}
        if (n === 89) throw new Error('酒馆启动超时');
        await new Promise(r => setTimeout(r, 500));
    }
    const viewport = { width: snapshot.mobile ? 390 : 1100, height: 780 };
    branches.set(actor,{actor,port,child});
    const csrfResponse = await fetch(`http://127.0.0.1:${port}/csrf-token`);
    const csrf = await csrfResponse.json();
    const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const headers = { 'X-CSRF-Token': csrf.token, Cookie: cookie };
    const testCard = structuredClone(snapshot.card);
    const embeddedBook = testCard.data.character_book;
    const bookName = embeddedBook?.entries?.length ? sanitize(embeddedBook.name || testCard.data.name + '的世界书') : '';
    if(bookName){
        const importedBook=await fetch(`http://127.0.0.1:${port}/api/worldinfo/edit`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:bookName,data:convertCharacterBook(embeddedBook)})});
        if(!importedBook.ok)throw new Error('世界书导入失败');
    }
    if (bookName) testCard.data.extensions = { ...testCard.data.extensions, world: bookName };
    const form = new FormData();
    form.set('avatar', new Blob([JSON.stringify(testCard)], { type: 'application/json' }), 'forge.json');
    form.set('file_type', 'json');
    const imported = await fetch(`http://127.0.0.1:${port}/api/characters/import`, { method: 'POST', headers, body: form });
    const importedData = await imported.json();
    if (!imported.ok || !importedData.file_name) throw new Error('角色卡导入失败');
    const avatar = importedData.file_name + '.png';
    settings.extension_settings.tavern_helper.script.enabled.characters = [avatar];
    settings.extension_settings.character_allowed_regex = [avatar];
    settings.extension_settings.notifyUpdates = false;
    settings.active_character = '';
    writeFileSync(join(user, 'settings.json'), JSON.stringify(settings));
    branches.set(actor, { actor, port, child, viewport, selected: { avatar, bookName, preloadMvu: snapshot.enableMvu && !hasMvu(snapshot.card.data.extensions?.tavern_helper) }, nativeDetached: true,
        lastInspection: { character: testCard.data.name, awaitingPlayer: true, messages: [], source: 'native-browser' } });
}

async function inspect(actor) {
    const branch = actorOf(actor);
    if (!branch) return { initializing: true, profile };
    return { ...branch.lastInspection, source: 'native-browser', modelPending: pending.size,
        modelCalls: branch.modelCalls || 0, requests: totalRequests, profile,
        errors: errors.filter(e => e.kind !== 'server-log'), runtimeLogs: errors.filter(e => e.kind === 'server-log') };
}

http.createServer(async (req, res) => {
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
    const url = new URL(req.url, 'http://worker');
    try {
        if (url.pathname === '/health') return json(res, 200, { ready: branches.size === 1 && !initializing && [...branches.values()].every(b => b.nativeDetached && b.child.exitCode === null), initializing, profile, errors: errors.slice(-10) });
        if (url.pathname === '/browser') {
            const branch=actorOf(url.searchParams.get('actor')||'manual');
            if(!branch || branch.actor!=='manual')throw new Error('原生网页只供用户会话使用');
            const path=url.searchParams.get('path')||'/';
            return await proxyBrowser(req,res,branch,path,assetAdapter,{...branch.selected,sessionId:nativeSessionId,parentOrigin:PORTAL_ORIGIN});
        }
        if(url.pathname==='/observation' && req.method==='POST'){
            const input=await body(req,2*1024*1024),branch=actorOf('manual');
            if(!branch?.nativeDetached)throw new Error('用户网页尚未接入');
            if(!input.observation || typeof input.observation!=='object')throw new Error('观察数据无效');
            branch.lastInspection={...input.observation,source:'native-browser',observedAt:Date.now(),profile,requests:totalRequests};
            return json(res,200,{ok:true});
        }
        if (url.pathname === '/init' && req.method === 'POST') {
            if (snapshot) return json(res, 409, { error: '环境已初始化' });
            snapshot = await body(req); if (!snapshot.card?.data?.name) throw new Error('缺少角色卡');
            initializing = true;
            const startedAt = Date.now();
            await startBranch('manual', 8000);
            const startupMs = Date.now() - startedAt;
            initializing = false; return json(res, 200, { ready: true, profile, startupMs });
        }
        if (url.pathname === '/state') return json(res, 200, await inspect(url.searchParams.get('actor') || 'manual'));
        if (url.pathname === '/requests') {
            const list = [];
            for (const slot of pending.values()) {
                // Claim once: refreshing a browser must not silently replay a billed request.
                if (slot.claimedAt) continue;
                slot.claimedAt = Date.now(); list.push({ id: slot.id, actor: slot.actor, payload: slot.payload });
            }
            return json(res, 200, { requests: list });
        }
        if(url.pathname==='/chunk' && req.method==='POST'){
            const input=await body(req,128*1024),slot=pending.get(input.id);
            if(!slot)return json(res,409,{error:'请求已结束'});
            if(input.sequence===slot.sequence)return json(res,200,{ok:true});
            if(input.sequence!==slot.sequence+1 || typeof input.text!=='string' || input.text.length>32000 || String(input.reasoning||'').length>32000)return json(res,409,{error:'片段序号或内容无效'});
            slot.sequence=input.sequence;slot.text+=input.text;slot.reasoning+=String(input.reasoning||'');
            if(slot.stream){if(!slot.res.headersSent)slot.res.writeHead(200,{'Content-Type':'text/event-stream'});slot.res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:input.text,...(input.reasoning?{reasoning_content:input.reasoning}:{})},finish_reason:null}]})}\n\n`)}
            return json(res,200,{ok:true});
        }
        if (url.pathname === '/result' && req.method === 'POST') {
            const result = await body(req, 24 * 1024 * 1024);
            const slot = pending.get(result.id); if (!slot) return json(res, 409, { error: '请求已结束' });
            if(!result.error && slot.stream && !String(result.text||'').startsWith(slot.text))return json(res,409,{error:'回复片段与最终文本不一致'});
            clearTimeout(slot.timer); pending.delete(slot.id);
            if (result.error) {
                record(slot.actor,'模型调用失败：'+String(result.error).slice(0,1200));
                const error={error:{message:String(result.error).slice(0,1200)}};
                if(slot.res.headersSent)slot.res.end(`data: ${JSON.stringify(error)}\n\ndata: [DONE]\n\n`);else json(slot.res,502,error);
            }
            else {
                const message = { role: 'assistant', content: String(result.text || '') };
                if (slot.stream) { if(!slot.res.headersSent)slot.res.writeHead(200, { 'Content-Type': 'text/event-stream' }); const text=String(result.text||'');slot.res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {...message,content:text.slice(slot.text.length)}, finish_reason: result.finishReason||'stop' }] })}\n\ndata: [DONE]\n\n`); }
                else json(slot.res, 200, { id: slot.id, object: 'chat.completion', model: 'forge-lab', choices: [{ index: 0, message, finish_reason: result.finishReason || 'stop' }] });
            }
            return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'Not found' });
    } catch (e) { record('system', e.message); if (!res.headersSent) json(res, 400, { error: e.message }); }
}).listen(8720, '0.0.0.0');
