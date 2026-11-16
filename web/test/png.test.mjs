// PNG tEXt 往返测试 + 服务端工具函数测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCardJson, embedCardJson } from '../src/lib/png.js'

// 标准 1x1 PNG（IHDR 13B + IDAT 10B + IEND）。
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

test('嵌入并提取角色卡 JSON（chara + ccv3 双写）', async () => {
  const card = { spec: 'chara_card_v2', data: { name: '阿焰', first_mes: '你好，旅人。', tags: ['测试'] } }
  const embedded = embedCardJson(TINY_PNG, card)
  // 签名与 IHDR 保留
  assert.deepEqual([...embedded.slice(0, 8)], [...TINY_PNG.slice(0, 8)])
  const extracted = await extractCardJson(embedded)
  assert.equal(extracted.data.name, '阿焰')
  assert.equal(extracted.data.first_mes, '你好，旅人。')
})

test('重复嵌入覆盖旧 chara，不叠加', async () => {
  const once = embedCardJson(TINY_PNG, { data: { name: '一' } })
  const twice = embedCardJson(once, { data: { name: '二' } })
  const extracted = await extractCardJson(twice)
  assert.equal(extracted.data.name, '二')
  const text = new TextDecoder('latin1').decode(twice)
  assert.equal((text.match(/chara/g) ?? []).length, 1)
})

test('非 PNG 输入被拒绝', () => {
  assert.throws(() => embedCardJson(new Uint8Array([1, 2, 3]), {}), /PNG/)
})

test('无卡数据的 PNG 提取返回 null', async () => {
  assert.equal(await extractCardJson(TINY_PNG), null)
})
