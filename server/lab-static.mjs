import {existsSync,readFileSync,createReadStream} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
export function createLabStatic(directory){
 let entries={},profile=''
 if(directory&&existsSync(join(directory,'manifest.json'))){const source=readFileSync(join(directory,'manifest.json'));const manifest=JSON.parse(source);entries=manifest.entries||{};profile=manifest.profile?manifest.profile+'-'+createHash('sha256').update(source).digest('hex').slice(0,16):''}
 function serve(req,res,url,headers){
  if(!['GET','HEAD'].includes(req.method))return false
  const key=url.pathname.startsWith('/__forge_cdn/')?url.pathname+url.search:url.pathname
  const item=entries[key]
  if(!item||! /^[a-f0-9]{64}$/.test(item.file||''))return false
  const file=join(directory,'files',item.file)
  if(!existsSync(file))return false
  const responseHeaders={...headers,'Content-Type':item.type,'Cache-Control':'private, max-age=300',ETag:item.etag}
  if(req.headers['if-none-match']===item.etag){res.writeHead(304,responseHeaders);res.end();return true}
  res.writeHead(200,responseHeaders)
  if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res)
  return true
 }
 serve.profile=profile
 return serve
}
