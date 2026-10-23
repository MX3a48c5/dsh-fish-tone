import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* 配置落到临时文件，别把插件目录那份真配置改掉 */
const dir = mkdtempSync(join(tmpdir(), 'fish-tone-test-'))
process.env.DSH_FISH_TONE_CONFIG = join(dir, 'config.json')
process.env.DSH_FISH_TONE_LOG = join(dir, 'debug.log')
const mod = await import('../lib/index.js')

/* ───────────── 把 apply() 挂到一个假 root 上 ───────────── */

const sections = []      // 挂上去的 prompt 节
const disposed = []      // 被撤掉的节
const tools = []
let route = null

const root = {
  inject(deps, fn) {
    captured[deps[0]] = fn
  },
}
const captured = {}
mod.apply(root, { strength: 'light', seed: 7, enabled: true })

const effect = (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} }
captured.systemPrompt({
  effect,
  systemPrompt: {
    section: (s) => {
      sections.push(s)
      return () => disposed.push(s.name)
    },
  },
})
captured.tools({ effect, tools: { register: (t) => { tools.push(t) } } })
captured.webServer({
  effect,
  webServer: { register: (r) => { route = r; return () => {} } },
})

/* ───────────── 假请求 / 假响应 ───────────── */

class Req extends EventEmitter {
  constructor(method, url, body) {
    super()
    this.method = method
    this.url = url
    this._body = body
  }
  start() {
    if (this._body !== undefined) this.emit('data', JSON.stringify(this._body))
    this.emit('end')
  }
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(b) { this.body = b ?? ''; this.done() },
  }
  const p = new Promise((resolve) => { res.done = () => resolve(res) })
  res.wait = p
  return res
}

async function call(method, path, body) {
  const req = new Req(method, path, body)
  const res = makeRes()
  const p = route.handler(req, res)
  req.start()
  await p
  const r = await res.wait
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null }
}

/* ───────────── 用例 ───────────── */

test('路由挂在 /api/fish-tone 这个前缀上', () => {
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/api/fish-tone')
  assert.equal(typeof route.handler, 'function')
})

test('prompt 那一节第一次就挂上了', () => {
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'fish-tone:voice')
  assert.equal(sections[0].order, 920)
})

test('GET /status 说清当前状态', async () => {
  const r = await call('GET', '/api/fish-tone/status')
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.enabled, true)
  assert.equal(r.json.strength, 'light')
  assert.equal(r.json.seed, 7)
  assert.equal(r.json.promptRegistered, true)
  assert.deepEqual(r.json.levels, ['off', 'light', 'normal', 'max'])
})

test('关掉总开关：节被撤下来，配置写盘', async () => {
  const r = await call('POST', '/api/fish-tone/config', { enabled: false })
  assert.equal(r.status, 200)
  assert.equal(r.json.enabled, false)
  assert.deepEqual(disposed, ['fish-tone:voice'])
  assert.equal(sections.length, 1, '关掉后不该再挂新的节')

  const saved = JSON.parse(readFileSync(process.env.DSH_FISH_TONE_CONFIG, 'utf8'))
  assert.equal(saved.enabled, false)

  const st = await call('GET', '/api/fish-tone/status')
  assert.equal(st.json.promptRegistered, false)
})

test('再打开：节重新挂上', async () => {
  await call('POST', '/api/fish-tone/config', { enabled: true })
  assert.equal(sections.length, 2, '应该重新注册了一节')
  const st = await call('GET', '/api/fish-tone/status')
  assert.equal(st.json.promptRegistered, true)
})

test('改档位：立刻影响工具的默认档', async () => {
  await call('POST', '/api/fish-tone/config', { strength: 'max', seed: 21 })
  const tool = tools.find((t) => t.name === 'fish_tone')
  const out = await tool.execute({ text: '这条视频我看了三遍。字幕一共二十二段。', format: 'json' })
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.stats.strength, 'max')
  assert.equal(parsed.stats.seed, 21)
})

test('非法档位不写进去', async () => {
  await call('POST', '/api/fish-tone/config', { strength: 'ultra' })
  const st = await call('GET', '/api/fish-tone/status')
  assert.equal(st.json.strength, 'max', '非法值应该被忽略，保留前一档')
})

test('POST /preview 给出掰过的文字和统计', async () => {
  const r = await call('POST', '/api/fish-tone/preview', { text: '我把这条视频看了三遍。' })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.equal(typeof r.json.text, 'string')
  assert.ok(r.json.stats.units >= 1)
  assert.equal(r.json.original, '我把这条视频看了三遍。')
})

test('空文字的预览明确报错，不是 500', async () => {
  const r = await call('POST', '/api/fish-tone/preview', { text: '   ' })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
})

test('不认识的路径回 404', async () => {
  const r = await call('GET', '/api/fish-tone/nope')
  assert.equal(r.status, 404)
  assert.equal(r.json.ok, false)
})


test('语病开关：关掉之后工具不再过语病层', async () => {
  await call('POST', '/api/fish-tone/config', { grammar: false, strength: 'max', seed: 7 })
  const tool = tools.find((t) => t.name === 'fish_tone')
  const out = await tool.execute({ text: '这个很好很很好。。慢慢的说了一遍。', format: 'json' })
  const parsed = JSON.parse(out.text)
  assert.equal(parsed.grammar, null, '关掉语病层后不该有 grammar 统计')
  assert.ok(parsed.text.includes('很很'), '关掉后应该保留原样')
})

test('语病开回来：工具会修掉大部分、按配额留几个', async () => {
  await call('POST', '/api/fish-tone/config', { grammar: true })
  const tool = tools.find((t) => t.name === 'fish_tone')
  const dirty = Array.from({ length: 10 }, () => '我我觉得这个很好很很好').join('。') + '。'
  const out = await tool.execute({ text: dirty, format: 'json' })
  const parsed = JSON.parse(out.text)
  assert.ok(parsed.grammar, '应该有 grammar 统计')
  assert.ok(parsed.grammar.fixed > 0)
  const minor = parsed.grammar.kept.filter((k) => k.severity === 'minor').length
  assert.ok(minor <= parsed.grammar.budget.minor, `留下 ${minor} 个，配额 ${parsed.grammar.budget.minor}`)
})

test('fish_grammar：只查不改 / 修干净', async () => {
  const tool = tools.find((t) => t.name === 'fish_grammar')
  assert.ok(tool, '要有 fish_grammar 这个工具')

  const report = await tool.execute({ text: '我我觉得这个很好很很好。。' })
  assert.ok(report.text.includes('扫出'), report.text)

  const fixed = await tool.execute({ text: '我我觉得这个很好很很好。。', fix: true })
  assert.equal(fixed.text.includes('我我觉得'), false, fixed.text)
  assert.equal(fixed.text.includes('。。'), false, fixed.text)

  const clean = await tool.execute({ text: '这条视频我看了三遍。' })
  assert.equal(clean.text, '没扫出语病。')
})
