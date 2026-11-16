// Bundle pinned ST core modules while keeping each original ESM import path.
// Shared chunks preserve live bindings used by extensions and TavernHelper.
import {createRequire} from 'node:module';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {readdirSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packShared} from './lab-pack-shared.mjs';
const require=createRequire(import.meta.url);
let esbuild;try{esbuild=require('esbuild')}catch{esbuild=require('../web/node_modules/esbuild')}
const root=resolve(process.argv[2]||'/app/tavern/public'),entries=[join(root,'script.js')];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 const path=join(dir,entry.name);
 if(entry.name==='extensions'||/worker/i.test(entry.name))continue;
 if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.js'))entries.push(path);
}}
walk(join(root,'scripts'));
const options={entryPoints:entries,outbase:root,outdir:root,entryNames:'[dir]/[name]',chunkNames:'_forge_core/[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,keepNames:true,write:false,metafile:true,allowOverwrite:true,logLevel:'warning',plugins:[{name:'native-library',setup(build){build.onResolve({filter:/.*/},args=>{const spec=args.path.replaceAll(String.fromCharCode(92),'/');if(spec==='lib.js'||spec.endsWith('/lib.js'))return {path:'/lib.js',external:true};const index=spec.lastIndexOf('/lib/');if(index>=0)return {path:spec.slice(index),external:true}})}}]};
const probe=await esbuild.build(options);
// Any core-imported module also gets a facade, so addon imports share its state.
const all=new Set(entries);
for(const input of Object.keys(probe.metafile.inputs)){const path=resolve(input),r=relative(root,path);if(!r.startsWith('..')&&!isAbsolute(r)&&path.endsWith('.js'))all.add(path)}
const result=await esbuild.build({...options,entryPoints:[...all]});
const outputFiles=await packShared(result,root,esbuild);
if(!process.argv.includes('--dry'))for(const file of outputFiles){mkdirSync(dirname(file.path),{recursive:true});writeFileSync(file.path,file.contents)}
// Preserve the exact source and order of upstream's consecutive classic scripts.
// They otherwise block HTML parsing one request at a time over a distant network.
const htmlPath=join(root,'index.html'),html=readFileSync(htmlPath,'utf8');
const classic=html.match(/(?:[ \t]*<script src="lib\/[^"\n]+"><\/script>\r?\n)+/g);
if(classic?.length!==1)throw new Error('Pinned classic script sequence changed');
const paths=[...classic[0].matchAll(/src="([^"]+)"/g)].map(match=>match[1]);
const vendor=paths.map(path=>{const source=readFileSync(join(root,path),'utf8');if(source.includes('document.currentScript'))throw new Error('Script depends on its original URL');return ';\n/* '+path+' */\n'+source+'\n;'}).join('\n');
const vendorPath='_forge_core/vendor-'+createHash('sha256').update(vendor).digest('hex').slice(0,16)+'.js';
if(!process.argv.includes('--dry')){writeFileSync(join(root,vendorPath),vendor);writeFileSync(htmlPath,html.replace(classic[0],'    <script src="/'+vendorPath+'"></script>\n'))}
const entry=result.metafile.outputs[Object.keys(result.metafile.outputs).find(path=>result.metafile.outputs[path].entryPoint===relative(process.cwd(),join(root,'script.js')).replaceAll(String.fromCharCode(92),'/'))];
console.log(JSON.stringify({sourceModules:Object.keys(result.metafile.inputs).length,facades:all.size,files:outputFiles.length,sharedRequestsBefore:entry?.imports.length,sharedRequestsAfter:1,classicRequestsBefore:paths.length,classicRequestsAfter:1,bytes:outputFiles.reduce((n,file)=>n+file.contents.length,0),dryRun:process.argv.includes('--dry')}));
