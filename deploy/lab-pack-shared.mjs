import {resolve,dirname,relative,join} from 'node:path';
import {createHash} from 'node:crypto';
export async function packShared(result,root,esbuild){
 const shared=new Map(),byPath=new Map(result.outputFiles.map(file=>[file.path,file]));
 for(const file of result.outputFiles)if(file.path.startsWith(join(root,'_forge_core')+'/')||file.path.startsWith(join(root,'_forge_core')+'\\')){
  const meta=result.metafile.outputs[Object.keys(result.metafile.outputs).find(key=>resolve(key)===file.path)];
  shared.set(file.path,{prefix:'c'+shared.size,exports:meta.exports,file});
 }
 if(!shared.size)return result.outputFiles;
 const source=[...shared].map(([path,item])=>{
  const url='./'+relative(root,path).replaceAll('\\','/');
  return 'import * as '+item.prefix+'_namespace from '+JSON.stringify(url)+';export{'+item.prefix+'_namespace};export{'+item.exports.map(name=>name+' as '+item.prefix+'_'+name).join(',')+'}from '+JSON.stringify(url)+';';
 }).join('\n');
 const packed=await esbuild.build({stdin:{contents:source,resolveDir:root,sourcefile:'forge-core-entry.js'},outfile:join(root,'_forge_core','packed.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,keepNames:true,write:false,logLevel:'warning',plugins:[{name:'native-core-chunks',setup(build){
  build.onResolve({filter:/.*/},args=>{
   if(args.path==='/lib.js'||args.path.startsWith('/lib/'))return {path:args.path,external:true};
   const path=resolve(args.resolveDir,args.path);
   if(shared.has(path))return {path,namespace:'forge-shared'};
   if(byPath.has(path))return {path:'/'+relative(root,path).replaceAll('\\','/'),external:true};
  });
  build.onLoad({filter:/.*/,namespace:'forge-shared'},args=>({contents:Buffer.from(shared.get(args.path).file.contents).toString(),loader:'js',resolveDir:dirname(args.path)}));
 }}]});
 const bytes=packed.outputFiles[0].contents,hash=createHash('sha256').update(bytes).digest('hex').slice(0,16),packedPath=join(root,'_forge_core','core-'+hash+'.js');
 const outputs=[{path:packedPath,contents:bytes}];
 for(const file of result.outputFiles){
  if(shared.has(file.path))continue;
  let text=Buffer.from(file.contents).toString(),url=relative(dirname(file.path),packedPath).replaceAll('\\','/');if(!url.startsWith('.'))url='./'+url;
  const itemFor=specifier=>shared.get(resolve(dirname(file.path),specifier));
  text=text.replace(/import\{([^}]+)\}from(["'])([^"']+)\2;?/g,(original,clause,quote,specifier)=>{
   const item=itemFor(specifier);if(!item)return original;
   const names=clause.split(',').map(value=>{const [imported,local]=value.trim().split(/\s+as\s+/);if(!item.exports.includes(imported))throw new Error('Unknown shared export');return item.prefix+'_'+imported+' as '+(local||imported)});
   return 'import{'+names.join(',')+'}from '+JSON.stringify(url)+';';
  });
  text=text.replace(/import\*as\s+([A-Za-z_$][\w$]*)from(["'])([^"']+)\2;?/g,(original,name,quote,specifier)=>{const item=itemFor(specifier);return item?'import{'+item.prefix+'_namespace as '+name+'}from '+JSON.stringify(url)+';':original});
  text=text.replace(/import(["'])([^"']+)\1;?/g,(original,quote,specifier)=>itemFor(specifier)?'import '+JSON.stringify(url)+';':original);
  text=text.replace(/import\((["'])([^"']+)\1\)/g,(original,quote,specifier)=>{const item=itemFor(specifier);return item?'import('+JSON.stringify(url)+').then(module=>module.'+item.prefix+'_namespace)':original});
  if(/(?:from|import).{0,5}["'][^"']*chunk-[A-Z0-9]+\.js/.test(text))throw new Error('Unconverted shared module import');
  outputs.push({path:file.path,contents:Buffer.from(text)});
 }
 return outputs;
}
