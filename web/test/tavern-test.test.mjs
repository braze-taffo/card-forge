import test from 'node:test'
import assert from 'node:assert/strict'
import { testChannel, relayTavernRequest } from '../src/lib/tavern-test.js'

test('test channel retains custom credentials only in the browser call context', () => {
  const channel = testChannel({ channelMode:'custom', customBaseUrl:' https://example.com/v1 ', customApiKey:' fixture-only ', customModel:' model ' }, {})
  assert.equal(channel.mode,'custom'); assert.equal(channel.apiKey,'fixture-only'); assert.equal(channel.model,'model')
  assert.throws(() => testChannel({ channelMode:'custom' }, {}), /填写完整/)
})
test('free test uses chosen available model and rejects unavailable channels', () => {
  const config = { freeModelAvailable:true,freeModels:[{id:'step'},{id:'deepseek'}] }
  assert.equal(testChannel({freeModel:'deepseek'},config).model,'deepseek')
  assert.equal(testChannel({freeModel:'removed'},config).model,'step')
  assert.throws(() => testChannel({},{}), /没有可用模型/)
})
test('model relay batches ordered deltas before the final receipt and forwards provider failures',async()=>{
  const sent=[]
  const request={id:'fixture',payload:{messages:[]}}
  await relayTavernRequest({request,path:'/sessions/fixture',channel:{mode:'free'},send:async(path,options)=>{sent.push({path,...JSON.parse(options.body)})},generate:async({onDelta})=>{onDelta({text:'第一个片段'});onDelta({text:'，第二个片段',reasoning:'思考'});return {text:'第一个片段，第二个片段',finishReason:'stop'}}})
  assert.equal(sent[0].sequence,1);assert.equal(sent[0].text,'第一个片段，第二个片段');assert.equal(sent[0].reasoning,'思考')
  assert.match(sent[1].path,/result$/);assert.equal(sent[1].text,sent[0].text)
  sent.length=0
  await assert.rejects(relayTavernRequest({request,path:'/sessions/fixture',channel:{mode:'free'},send:async(path,options)=>{sent.push(JSON.parse(options.body))},generate:async()=>{throw new Error('provider failed')}}),/provider failed/)
  assert.equal(sent[0].error,'provider failed')
})
