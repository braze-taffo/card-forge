import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdmin } from './admin.mjs'

test('后台需要密码，会话退出后失效，配置保存后立即生效并跨重启保留', (context) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'card-forge-admin-'))
  context.after(() => rmSync(dataDir, { recursive: true, force: true }))
  const credentials = join(dataDir, 'credentials.json')
  writeFileSync(credentials, JSON.stringify({ username: 'admin', password: 'test-only-password-1234' }))
  const config = { dataDir, adminCredentialsFile: credentials, ratePerMinute: 6, dailyRequestsPerIp: 30,
    freeModels: [{ id: 'step', name: 'Step', ratePerMinute: 30, dailyRequestsPerIp: 120 }, { id: 'deepseek', name: 'DeepSeek', ratePerMinute: 10, dailyRequestsPerIp: 90 }] }
  const admin = createAdmin(config)
  assert.equal(admin.session(''), null)
  assert.equal(admin.login('admin', 'wrong', 'ip').status, 401)
  const login = admin.login('admin', 'test-only-password-1234', 'ip')
  assert.equal(login.status, 200)
  const cookie = `cardforge_admin=${login.token}`
  assert.equal(admin.session(cookie).username, 'admin')
  assert.ok(!readFileSync(join(dataDir, 'admin-auth.json'), 'utf8').includes('test-only-password'))
  const next = admin.models()
  next[0].ratePerMinute = 31
  next[1].enabled = false
  admin.saveModels(next)
  assert.equal(admin.enabledModels().length, 1)
  assert.equal(createAdmin(config).models()[0].ratePerMinute, 31)
  assert.equal(createAdmin(config).models()[1].enabled, false)
  assert.throws(() => admin.saveModels([{ ...next[0], id: 'unlisted' }, next[1]]))
  assert.throws(() => admin.saveModels([{ ...next[0], ratePerMinute: -1 }, next[1]]))
  assert.equal(admin.models()[0].ratePerMinute, 31)
  admin.logout(cookie)
  assert.equal(admin.session(cookie), null)
  for (let i = 0; i < 5; i++) assert.equal(admin.login('admin', 'wrong', 'blocked-ip').status, 401)
  assert.equal(admin.login('admin', 'test-only-password-1234', 'blocked-ip').status, 429)
})
