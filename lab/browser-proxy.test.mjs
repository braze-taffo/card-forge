import test from 'node:test';
import assert from 'node:assert/strict';
import { browserPath, createAssetAdapter } from './browser-proxy.mjs';

test('native proxy paths never select arbitrary hosts or traverse paths',()=>{
    assert.equal(browserPath('/api/chats/get?x=1'),'/api/chats/get?x=1');
    for(const path of ['https://evil.test/','//evil.test/','/x/../private','/%2e%2e/private','/x\\private','/%2f%2fevil.test/'])assert.throws(()=>browserPath(path));
});
test('cached dependencies remain absolute URLs for blob modules and rooted ESM imports',()=>{
    const adapter=createAssetAdapter({'https://cdn.test/npm/vue.js':{file:'fixture'},_prefixes:{'https://cdn.test/npm/':'https://cdn.test/npm/'}},'/unused','https://lab.test');
    const code=adapter.rewrite(Buffer.from('import "https://cdn.test/npm/vue.js"; export {x} from "/npm/x.js";'), 'text/javascript','https://cdn.test/npm/vue.js').toString();
    assert.match(code,/https:\/\/lab.test\/__forge_cdn\/cdn.test\/npm\/vue.js/);
    assert.match(code,/from "https:\/\/lab.test\/__forge_cdn\/cdn.test\/npm\/x.js"/);
});
