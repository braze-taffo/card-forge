import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const PORTAL_ORIGIN = 'https://tellev.click';
const TEXT = /javascript|json|text\/|xml|svg/;
const DENIED = /^\/(?:proxy(?:\/|$)|api\/(?:plugins|users\/(?!me(?:\/|$))|secrets\/(?!read(?:\/|$))|extensions\/(?:install|update|delete)|backends\/(?!chat-completions\/)))/;
export function browserPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\x00-\x1f]/.test(value)) throw new Error('无效酒馆路径');
    const decoded = decodeURIComponent(value.split('?')[0]);
    if (decoded.split('/').includes('..') || decoded.includes('\\') || decoded.startsWith('//')) throw new Error('无效酒馆路径');
    return value;
}
export function createAssetAdapter(assets, assetRoot, embedOrigin='https://lab.tellev.click') {
    const domains = [...new Set(Object.keys(assets).filter(x => x.startsWith('https://')).map(x => new URL(x).host))];
    for (const prefix of Object.keys(assets._prefixes || {})) domains.push(new URL(prefix).host);
    // The helper checks its update manifest; serve the fixed installed copy.
    domains.push('gitlab.com');
    const unique = [...new Set(domains)];
    function rewrite(input, contentType, originalUrl = '') {
        if (!TEXT.test(contentType)) return input;
        let text = input.toString('utf8');
        for(const local of ['http://127.0.0.1:8730','http://127.0.0.1:8731','https://lab.tellev.click'])text=text.split(local+'/__forge_cdn/').join(embedOrigin+'/__forge_cdn/');
        for (const host of unique) text = text.split('https://' + host).join(embedOrigin + '/__forge_cdn/' + host);
        if (originalUrl.startsWith('https://') && /javascript/.test(contentType)) {
            const origin = embedOrigin + '/__forge_cdn/' + new URL(originalUrl).host;
            text = text.replace(/((?:\bfrom\s*|\bimport\s*\(?\s*)['"])(\/(?!__forge_cdn\/)[^'"]+)/g, (_, prefix, path) => prefix + origin + path);
        }
        return Buffer.from(text);
    }
    function asset(path) {
        const match = /^\/__forge_cdn\/([^/]+)(\/.*)$/.exec(path);
        if (!match || !unique.includes(match[1])) return null;
        const url = 'https://' + match[1] + match[2];
        if (url.startsWith('https://gitlab.com/api/v4/projects/novi028%2FJS-Slash-Runner/repository/files/manifest.json/raw')) {
            return { contentType: 'application/json', body: readFileSync('/app/tavern/public/scripts/extensions/third-party/JS-Slash-Runner/manifest.json') };
        }
        const prefix = Object.keys(assets._prefixes || {}).find(p => url.startsWith(p));
        const normalized = prefix ? assets._prefixes[prefix] + url.slice(prefix.length) : url;
        const entry = assets[normalized];
        if (!entry) return null;
        const contentType = entry.contentType || 'text/javascript';
        return { contentType, body: rewrite(readFileSync(join(assetRoot, entry.file || entry)), contentType, normalized) };
    }
    return { rewrite, asset };
}
export async function proxyBrowser(req, res, branch, path, adapter, config) {
    path = browserPath(path);
    if (DENIED.test(path.split('?')[0])) { res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('此验收的模型由锻卡炉管理，外部接口与扩展安装不可用。'); }
    if (path.startsWith('/__forge_cdn/')) {
        const cached = adapter.asset(path);
        if (!cached) { res.writeHead(404); return res.end('此资源不在当前测试环境的缓存中'); }
        res.writeHead(200, {'Content-Type':cached.contentType,'Cache-Control':'private, max-age=300'}); return res.end(cached.body);
    }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 24*1024*1024) throw new Error('酒馆请求过大'); chunks.push(chunk); }
    let body = chunks.length ? Buffer.concat(chunks) : undefined, streaming=false;
    if (req.method === 'POST' && path.startsWith('/api/backends/chat-completions/')) {
        const input = JSON.parse(body?.toString() || '{}');
        streaming=path.split('?')[0].endsWith('/generate') && input.stream===true;
        Object.assign(input, { chat_completion_source:'custom', custom_url:`http://127.0.0.1:8750/${branch.actor}/v1`, custom_include_headers:'',custom_include_body:'',reverse_proxy:'',proxy_password:'' });
        body = Buffer.from(JSON.stringify(input));
    }
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const upstream = await fetch(`http://127.0.0.1:${branch.port}${path}`, {
        method:req.method, body, redirect:'manual', signal:controller.signal,
        headers:{ 'Accept-Encoding':'identity', ...(req.headers['content-type'] ? {'Content-Type':req.headers['content-type']} : {}), ...(req.headers['x-csrf-token'] ? {'X-CSRF-Token':req.headers['x-csrf-token']} : {}), ...(req.headers['x-browser-cookie'] ? {Cookie:req.headers['x-browser-cookie']} : {}) },
    });
    const contentType = streaming && upstream.ok ? 'text/event-stream' : upstream.headers.get('content-type') || 'application/octet-stream';
    const headers = { 'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' };
    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) headers['Set-Cookie'] = cookies;
    if (upstream.headers.has('location')) headers.Location = upstream.headers.get('location');
    if (contentType.includes('text/event-stream')) {
        res.writeHead(upstream.status, headers); res.flushHeaders();
        return pipeline(Readable.fromWeb(upstream.body),res);
    }
    let data = adapter.rewrite(Buffer.from(await upstream.arrayBuffer()), contentType);
    if (contentType.includes('text/html') && path.split('?')[0] === '/' && config) {
        const preloads=['/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js','/scripts/extensions/third-party/ST-Prompt-Template/dist/index.js'];
        if(config.preloadMvu)preloads.push('/__forge_cdn/testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@54be11b09f21b1c4266e2d54b6f1ba9a3598db05/artifact/bundle.js');
        const boot = preloads.map(url=>`<link rel="modulepreload" href="${url}">`).join('')+`<script>window.__forgeEmbedConfig=${JSON.stringify(config).replace(/</g,'\\u003c')};window.parent.postMessage({type:'forge:progress',phase:'加载酒馆界面'},'https://tellev.click');if(navigator.serviceWorker){navigator.serviceWorker.register=()=>Promise.reject(new Error('临时预览不注册持久服务'));}</script>`;
        data = Buffer.from(data.toString().replace('<head>','<head>' + boot));
    }
    res.writeHead(upstream.status, headers); res.end(data);
}
