"""Cache pinned MVU ESM dependencies for a network-isolated browser image."""
import concurrent.futures, hashlib, json, pathlib, re, urllib.request, urllib.parse
root = pathlib.Path(__file__).resolve().parents[1]
out = root / '_gui-test/lab-build/assets'
out.mkdir(parents=True, exist_ok=True)
manifest = {}
seen = set()
main_url = 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@54be11b09f21b1c4266e2d54b6f1ba9a3598db05/artifact/bundle.js'
prefixes = {
    'https://testingcf.jsdelivr.net/npm/jquery/': 'https://testingcf.jsdelivr.net/npm/jquery@3.7.1/',
    'https://testingcf.jsdelivr.net/npm/jquery-ui/': 'https://testingcf.jsdelivr.net/npm/jquery-ui@1.13.3/',
    'https://testingcf.jsdelivr.net/npm/vue/': 'https://testingcf.jsdelivr.net/npm/vue@3.5.21/',
    'https://testingcf.jsdelivr.net/npm/vue-router/': 'https://testingcf.jsdelivr.net/npm/vue-router@4.5.1/',
    'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free/': 'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/',
}
aliases = {
    'https://testingcf.jsdelivr.net/npm/jquery-ui-touch-punch': 'https://testingcf.jsdelivr.net/npm/jquery-ui-touch-punch@0.2.3/jquery.ui.touch-punch.min.js',
    'https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner/src/iframe/node_modules/log.js': 'https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@ed8b2360b32d9cfb96770d44e5c4ae45c2071a86/src/iframe/node_modules/log.js',
}
queue = [main_url] + list(aliases.values()) + [
    'https://testingcf.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
    'https://testingcf.jsdelivr.net/npm/jquery-ui@1.13.3/dist/jquery-ui.min.js',
    'https://testingcf.jsdelivr.net/npm/jquery-ui@1.13.3/themes/base/theme.min.css',
    'https://testingcf.jsdelivr.net/npm/vue@3.5.21/dist/vue.runtime.global.prod.min.js',
    'https://testingcf.jsdelivr.net/npm/vue-router@4.5.1/dist/vue-router.global.prod.min.js',
    'https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/css/all.min.css',
]
def fetch(url):
    target = out / (hashlib.sha256(url.encode()).hexdigest() + '.js')
    if target.exists(): data = target.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=45) as response: data = response.read(12 * 1024 * 1024)
        target.write_bytes(data)
    ctype = 'text/css' if '.css' in url else 'font/woff2' if '.woff2' in url else 'font/ttf' if '.ttf' in url else 'image/png' if '.png' in url else 'text/javascript'
    text = data.decode('utf-8') if ctype in ['text/css','text/javascript'] else ''
    imports = re.findall(r'(?:\bfrom\s*|\bimport\s*\(?\s*)[\"\']([^\"\']+)[\"\']', text)
    imports += re.findall(r'\bexport\s*[^;]*?\bfrom\s*[\"\']([^\"\']+)[\"\']', text)
    if ctype == 'text/css': imports += re.findall(r'url\([\"\']?([^\)\"\']+)',text)
    return url, {'file':target.name,'contentType':ctype}, [urllib.parse.urljoin(url, u) for u in imports if not u.startswith(('data:','#')) and (ctype=='text/css' or u.startswith(('https://','http://','/','./','../')))]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    while queue:
        batch = sorted(set(queue) - seen)
        if not batch: break
        if len(seen) + len(batch) > 500: raise RuntimeError('Dependency limit exceeded')
        seen.update(batch); queue = []
        for url, filename, imports in pool.map(fetch, batch):
            manifest[url] = filename
            queue.extend(u for u in imports if urllib.parse.urlparse(u).hostname in ['testingcf.jsdelivr.net','cdn.jsdelivr.net','esm.sh'])
        print('Cached:', len(manifest), 'pending:', len(set(queue)-seen), flush=True)
main = manifest[main_url]
for host in ['testingcf.jsdelivr.net','cdn.jsdelivr.net','fastly.jsdelivr.net','gcore.jsdelivr.net']:
    for revision in ['', '@master', '@54be11b09f21b1c4266e2d54b6f1ba9a3598db05']:
        manifest['https://' + host + '/gh/MagicalAstrogy/MagVarUpdate' + revision + '/artifact/bundle.js'] = main
for alias,target in aliases.items(): manifest[alias]=manifest[target]
manifest['_prefixes']=prefixes
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
