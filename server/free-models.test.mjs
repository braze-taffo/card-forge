import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFreeModels, selectFreeModel } from './free-models.mjs'

test('保留旧单模型配置与默认模型选择', () => {
  const models = normalizeFreeModels(undefined, 'legacy', '旧免费模型')
  assert.deepEqual(models, [{ id: 'legacy', name: '旧免费模型' }])
  assert.equal(selectFreeModel(models, undefined).id, 'legacy')
  assert.deepEqual(normalizeFreeModels(undefined), [])
})
test('DeepSeek 和 Step 可分别选择，其他模型不允许转发', () => {
  const models = normalizeFreeModels('[{"id":"deepseek","name":"DeepSeek"},{"id":"step","name":"Step"}]')
  assert.equal(selectFreeModel(models, 'deepseek').name, 'DeepSeek')
  assert.equal(selectFreeModel(models, 'step').name, 'Step')
  for (const request of ['unlisted', 'STEP', '../step', { id: 'step' }, null, 1]) {
    assert.equal(selectFreeModel(models, request), null)
  }
})
test('拒绝损坏或有歧义的服务端模型白名单', () => {
  for (const raw of ['bad-json', '{}', '[{}]', '[{"id":"step"},{"id":"step"}]']) {
    assert.throws(() => normalizeFreeModels(raw))
  }
})
