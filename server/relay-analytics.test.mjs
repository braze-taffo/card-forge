import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRelayAnalytics } from './relay-analytics.mjs'

const python = process.env.ANALYTICS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const script = fileURLToPath(new URL('./relay-analytics.py', import.meta.url))
test('中转站只读账本：网站令牌与全部调用、跨本地午夜、排除错误日志', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'card-forge-relay-'))
  context.after(() => rmSync(directory, { recursive: true, force: true }))
  const db = join(directory, 'relay.db')
  // 2026-10-06 16:00 UTC 为本地 10 月 7 日午夜。
  const midnight = Date.parse('2026-10-06T16:00:00Z') / 1000
  execFileSync(python, ['-c', `import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
d.executescript('CREATE TABLE tokens(id INTEGER,name TEXT,deleted_at TEXT); CREATE TABLE logs(type INTEGER,created_at INTEGER,token_id INTEGER,model_name TEXT,prompt_tokens INTEGER,completion_tokens INTEGER,ip TEXT);')
d.execute('INSERT INTO tokens VALUES(193,?,NULL)',('card-forge-free-deepseek-step',))
d.executemany('INSERT INTO logs VALUES(?,?,?,?,?,?,?)',[(2,${midnight - 1},193,'step',10,2,''),(2,${midnight},193,'deepseek',20,3,''),(2,${midnight + 1},7,'step',30,4,'192.0.2.1'),(5,${midnight},193,'step',999,999,''),(2,${midnight + 200},193,'step',777,777,'')])
d.commit();d.close()`, db])
  const hash = () => createHash('sha256').update(readFileSync(db)).digest('hex')
  const before = hash()
  const query = period => JSON.parse(execFileSync(python, [script, '--db', db, '--period', period, '--now', String(midnight + 100)], { encoding: 'utf8' }))
  const today = query('today')
  assert.equal(today.site.summary.calls, 1)
  assert.equal(today.site.summary.totalTokens, 23)
  assert.equal(today.total.summary.calls, 2)
  assert.equal(today.total.summary.totalTokens, 57)
  assert.equal(today.total.summary.logsWithIp, 1)
  const all = query('all')
  assert.equal(all.site.summary.calls, 2)
  assert.equal(all.site.summary.totalTokens, 35)
  assert.equal(all.total.summary.calls, 3)
  assert.equal(all.total.summary.totalTokens, 69)
  assert.deepEqual(query('7d').total.summary, all.total.summary)
  assert.equal(hash(), before, '查询不修改中转站数据库')
  const reader = createRelayAnalytics({ relayDatabase: db, analyticsPython: python, quotaTimezone: 'Asia/Singapore' })
  assert.equal((await reader('all')).available, true)
  assert.equal(hash(), before)
})
test('中转站未配置或读取失败时仍可展示网站统计，不泄露路径或错误详情', async () => {
  assert.equal((await createRelayAnalytics({})('all')).available, false)
  const result = await createRelayAnalytics({ relayDatabase: '/private/nonexistent-relay-db', analyticsPython: python, quotaTimezone: 'Asia/Singapore' })('all')
  assert.equal(result.available, false)
  assert.ok(!JSON.stringify(result).includes('/private/'))
})
