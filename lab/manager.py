"""Private lab control plane. Standard library only; works on Python 3.6."""
import hashlib, hmac, json, os, pathlib, secrets, subprocess, threading, time, urllib.request, urllib.error, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs, urlencode

from capacity import MAX_ACTIVE, MAX_QUEUED, next_start, has_capacity

BASE = pathlib.Path('/opt/card-forge-lab')
CONFIG = json.loads((BASE / 'manager-config.json').read_text())
TOKEN = CONFIG['token']
DOCKER = [str(BASE / 'docker/docker'), '-H', 'unix:///run/card-forge-lab-docker.sock']
IMAGE = CONFIG.get('image', 'card-forge-lab:0.1.0')
sessions = {}
lock = threading.RLock()
HARD_TTL = 45 * 60
IDLE_TTL = 5 * 60

def docker(*args):
    try:
        return subprocess.check_output(DOCKER + list(args), stderr=subprocess.STDOUT, universal_newlines=True, timeout=90).strip()
    except subprocess.CalledProcessError as e:
        raise RuntimeError('容器运行失败：' + str(e.output)[-1000:])

def worker(session, path, payload=None, timeout=30):
    req = urllib.request.Request('http://' + session['workerHost'] + ':8720' + path,
        data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode(),
        headers={'Authorization':'Bearer ' + session['workerToken'], 'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.headers.get('Content-Type','application/json'), response.read(24 * 1024 * 1024)
    except urllib.error.HTTPError as e:
        return e.code, 'application/json', e.read(8192)

def public(session):
    queued = sorted([s for s in sessions.values() if s['status'] == 'queued'], key=lambda s:s['createdAt'])
    result = dict((k,session.get(k)) for k in ['id','status','createdAt','expiresAt','revision','error','profile','startupMs'])
    result['queuePosition'] = next((i+1 for i,s in enumerate(queued) if s['id']==session['id']),0)
    return result

def remove_container(session):
    name = session.get('container')
    if name and name == 'forge-lab-' + session['id']:
        try: docker('rm','-f',name)
        except Exception: pass
    session.pop('workerToken',None)
    session.pop('snapshot',None)

def start(session):
    try:
        worker_token = secrets.token_urlsafe(32)
        name = 'forge-lab-' + session['id']
        with lock:
            session['container'] = name; session['workerToken'] = worker_token
        docker('run','-d','--name',name,'--label','card-forge.lab=1','--network','card-forge-lab',
            '--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=512m,uid=1000,gid=1000',
            '--user','1000:1000','--cap-drop','ALL','--cap-add','SYS_CHROOT','--security-opt','no-new-privileges=true',
            '--security-opt','seccomp=' + str(BASE/'seccomp.json'), '--memory','768m','--memory-swap','768m',
            '--pids-limit','384','--cpus','1.0','--shm-size','128m','--init',
            '-e','LAB_WORKER_TOKEN='+worker_token,'-e','NODE_OPTIONS=--max-old-space-size=256',IMAGE)
        with lock:
            if session['status'] != 'starting': remove_container(session); return
            info = json.loads(docker('inspect',name))[0]
            session['workerHost'] = info['NetworkSettings']['Networks']['card-forge-lab']['IPAddress']
            if not session['workerHost']: raise RuntimeError('容器网络尚未就绪')
        for n in range(50):
            try:
                status, _, _ = worker(session, '/health', timeout=2)
                if status == 200: break
            except Exception: pass
            time.sleep(.3)
        status, _, raw = worker(session, '/init', session['snapshot'], timeout=240)
        result = json.loads(raw.decode())
        if status != 200 or not result.get('ready'): raise RuntimeError(result.get('error','酒馆初始化失败'))
        with lock:
            if session['status'] != 'starting': remove_container(session); return
            session['status'] = 'ready'; session['profile'] = result.get('profile'); session['startupMs'] = result.get('startupMs'); session.pop('snapshot',None)
    except Exception as e:
        with lock:
            if session['status'] not in ['closed','expired']:
                session['status'] = 'failed'; session['error'] = str(e)[-1200:]
            remove_container(session)

def sweep():
    while True:
        with lock:
            now = time.time()
            for session in list(sessions.values()):
                active = session['status'] in ['queued','starting','ready']
                if active and (now > session['expiresAt'] or now-session['lastSeen'] > IDLE_TTL):
                    session['status'] = 'expired'; remove_container(session)
                elif session['status']=='ready':
                    try:
                        code,_,raw=worker(session,'/health',timeout=2)
                        if code!=200 or not json.loads(raw.decode()).get('ready'):raise RuntimeError('worker stopped')
                        session['healthFailures']=0
                    except Exception:
                        session['healthFailures']=session.get('healthFailures',0)+1
                        if session['healthFailures']>=3:
                            session['status']='failed';session['error']='酒馆运行环境已中断，请创建新的预览；最后的记录保存在草稿中。';remove_container(session)
                if not active and now-session['lastSeen'] > HARD_TTL:
                    sessions.pop(session['id'],None)
            candidate = next_start(sessions.values())
            if candidate:
                candidate['status']='starting'; threading.Thread(target=start,args=(candidate,),daemon=True).start()
        time.sleep(2)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def respond(self,status,body,ctype='application/json'):
        raw = body if isinstance(body,bytes) else json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(raw)
    def browser(self,session,actor,path,raw):
        if actor!='manual':return self.respond(403,{'error':'Only the user branch has a native view'})
        headers={'Authorization':'Bearer '+session['workerToken']}
        for name in ['Content-Type','X-CSRF-Token','X-Browser-Cookie']:
            if self.headers.get(name):headers[name]=self.headers[name]
        req=urllib.request.Request('http://'+session['workerHost']+':8720/browser?'+urlencode({'actor':actor,'path':path}),data=raw if self.command not in ['GET','HEAD'] else None,headers=headers,method=self.command)
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args):return None
        try:
            response=urllib.request.build_opener(NoRedirect).open(req,timeout=330)
        except urllib.error.HTTPError as e:response=e
        with response:
            self.send_response(response.code)
            for name in ['Content-Type','Cache-Control','Location','X-Content-Type-Options']:
                if response.headers.get(name):self.send_header(name,response.headers[name])
            for cookie in response.headers.get_all('Set-Cookie',[]):self.send_header('Set-Cookie',cookie)
            self.send_header('Connection','close');self.end_headers();self.close_connection=True
            while True:
                chunk=response.read1(65536)
                if not chunk:break
                try:self.wfile.write(chunk);self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):break
    def dispatch(self):
        if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+TOKEN): return self.respond(401,{'error':'Unauthorized'})
        try:
            length = int(self.headers.get('Content-Length','0'))
            if length > 24*1024*1024: return self.respond(413,{'error':'请求过大'})
            url = urlparse(self.path); parts = url.path.strip('/').split('/'); query=parse_qs(url.query)
            raw=self.rfile.read(length) if length else b''
            is_browser=len(parts)==3 and parts[2]=='browser'
            payload = {} if is_browser else (json.loads(raw.decode() or '{}') if length else {})
            owner = self.headers.get('X-Lab-Owner','')
            if url.path == '/health': return self.respond(200,{'available':True,'maxActive':MAX_ACTIVE,'maxQueued':MAX_QUEUED,'maxMinutes':45})
            if len(owner)!=64 or any(c not in '0123456789abcdef' for c in owner): return self.respond(401,{'error':'Owner required'})
            if url.path == '/sessions' and self.command == 'POST':
                if not isinstance(payload.get('card'),dict) or not payload['card'].get('data',{}).get('name'): return self.respond(400,{'error':'缺少角色卡名称'})
                with lock:
                    existing=next((s for s in sessions.values() if s['owner']==owner and s['status'] in ['queued','starting','ready']),None)
                    if existing: return self.respond(409,{'error':'已有一个运行中的预览，请先关闭','session':public(existing)})
                    if not has_capacity(sessions.values()): return self.respond(429,{'error':'预览队列已满，请稍后再试'})
                    now=time.time(); ident=uuid.uuid4().hex
                    revision=hashlib.sha256(json.dumps(payload['card'],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
                    session={'id':ident,'owner':owner,'status':'queued','createdAt':now,'expiresAt':now+HARD_TTL,'lastSeen':now,'snapshot':payload,'revision':revision}
                    sessions[ident]=session
                    return self.respond(201,public(session))
            if len(parts)<2 or parts[0]!='sessions': return self.respond(404,{'error':'Not found'})
            with lock:
                session=sessions.get(parts[1])
                if not session or session['owner']!=owner: return self.respond(404,{'error':'预览不存在或已经回收'})
                session['lastSeen']=time.time()
                if len(parts)==2:
                    if self.command=='DELETE': session['status']='closed'; remove_container(session)
                    return self.respond(200,public(session))
                if session['status']!='ready': return self.respond(409,{'error':'酒馆环境尚未就绪','session':public(session)})
            path=parts[2]
            if path not in ['state','requests','result','chunk','observation','browser']: return self.respond(404,{'error':'Unknown operation'})
            if len(parts)!=3 or (path in ['result','chunk','observation'] and self.command!='POST') or (path not in ['result','chunk','observation','browser'] and self.command!='GET'): return self.respond(405,{'error':'Method not allowed'})
            actor=query.get('actor',['manual'])[0]
            if actor != 'manual': return self.respond(400,{'error':'Unknown branch'})
            if path=='browser':return self.browser(session,actor,query.get('path',['/'])[0],raw)
            status,ctype,raw=worker(session,'/'+path+'?actor='+actor,payload if self.command=='POST' else None,timeout=45)
            return self.respond(status,raw,ctype)
        except Exception as e: return self.respond(502,{'error':'临时酒馆操作失败：'+str(e)[-800:]})
    do_GET=dispatch
    do_POST=dispatch
    do_DELETE=dispatch
    do_HEAD=dispatch

if __name__=='__main__':
    network=json.loads(docker('network','inspect','card-forge-lab'))[0]
    if not network.get('Internal'): raise RuntimeError('Lab network must be internal')
    subnet=network['IPAM']['Config'][0]['Subnet']
    rule=['-s',subnet,'-m','conntrack','--ctstate','NEW','-j','DROP']
    if subprocess.run(['iptables','-C','INPUT']+rule,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        subprocess.check_call(['iptables','-I','INPUT','1']+rule)
    # Reclaim only containers bearing our dedicated label after manager restarts.
    for ident in docker('ps','-aq','--filter','label=card-forge.lab=1').splitlines():
        if ident: docker('rm','-f',ident)
    class Server(ThreadingMixIn,HTTPServer): daemon_threads=True
    threading.Thread(target=sweep,daemon=True).start()
    Server(('127.0.0.1',8791),Handler).serve_forever()
