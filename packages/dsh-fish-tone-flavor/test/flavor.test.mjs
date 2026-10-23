import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const dir = mkdtempSync(join(tmpdir(), 'fish-flavor-test-'))
process.env.DSH_FISH_TONE_FLAVOR_CONFIG = join(dir, 'config.json')

const mod = await import('../lib/index.js')

/* ───────────── 库本身 ───────────── */

test('库：77 条，字段齐全，vibe 合法', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/memes.json', import.meta.url), 'utf8'))
  assert.equal(raw.memes.length, raw.count)
  assert.ok(raw.memes.length >= 60, `只有 ${raw.memes.length} 条`)
  const vibes = new Set(['cute', 'abstract', 'ironic', 'broken', 'work', 'heal', 'hype', 'retro', 'slacker', 'fun'])
  for (const m of raw.memes) {
    assert.ok(m.term, '缺 term')
    assert.ok(m.gloss, `${m.term} 缺 gloss`)
    assert.ok(m.source, `${m.term} 缺 source`)
    assert.ok(Array.isArray(m.vibes) && m.vibes.length > 0, `${m.term} 缺 vibe`)
    for (const v of m.vibes) assert.ok(vibes.has(v), `${m.term} 的 vibe 不认识：${v}`)
  }
})

test('查梗：按词、按味道、按条数', () => {
  assert.ok(mod.searchMemes({ query: '抽象' }).some((m) => m.term.includes('抽象')))
  const cute = mod.searchMemes({ vibe: 'cute', limit: 50 })
  assert.ok(cute.length > 0)
  assert.ok(cute.every((m) => m.vibes.includes('cute')))
  assert.equal(mod.searchMemes({ query: '', limit: 3 }).length, 3)
  assert.deepEqual(mod.searchMemes({ query: '不存在的梗xyz' }), [])
})

test('随机抽梗：同 seed 同结果', () => {
  const a = mod.randomMeme(7)
  const b = mod.randomMeme(7)
  assert.equal(a.term, b.term)
  assert.ok(a.term)
})

/* ───────────── 挂尾巴 ───────────── */

const SAMPLE = '我把这条视频看了三遍。字幕一共二十二段。画面里只有她站在那儿说话。后面的部分我没看完。'

test('可爱：尾巴挂在句号前面，加的是语气词', () => {
  const out = mod.flavor(SAMPLE, { mode: 'cute', rate: 'high', seed: 3 })
  assert.ok(out.hits.length >= 1, '一条都没挂')
  for (const hit of out.hits) {
    assert.equal(hit.mode, 'cute')
    assert.ok(['呀', '嘛', '啦', '哟', '哦', '呢'].includes(hit.tail), hit.tail)
  }
  assert.match(out.text, /(呀|嘛|啦|哟|哦|呢)[。！？]/)
})

test('抽象：挂的是梗，不是语气词', () => {
  const out = mod.flavor(SAMPLE, { mode: 'abstract', rate: 'high', seed: 3 })
  assert.ok(out.hits.length >= 1)
  const tails = mod.abstractTails()
  for (const hit of out.hits) assert.ok(tails.includes(hit.tail), hit.tail)
  assert.match(out.text, /，[^，。]{1,6}。/)
})

test('只加不删：挂完的正文等于原文去掉尾巴', () => {
  const out = mod.flavor(SAMPLE, { mode: 'abstract', rate: 'high', seed: 11 })
  const stripped = out.text.replace(/，[^，。]{1,6}(?=[。！？])/g, '')
  assert.equal(stripped, SAMPLE)
})

test('密度：low 比 high 少，且最多三处', () => {
  const text = SAMPLE.repeat(6)
  const low = mod.flavor(text, { mode: 'cute', rate: 'low', seed: 5 })
  const high = mod.flavor(text, { mode: 'cute', rate: 'high', seed: 5 })
  assert.ok(high.hits.length >= low.hits.length)
  assert.ok(high.hits.length <= 3, `挂了 ${high.hits.length} 处`)
})

test('同一 seed 同一结果，换 seed 可能不同', () => {
  const a = mod.flavor(SAMPLE, { mode: 'cute', rate: 'high', seed: 7 })
  const b = mod.flavor(SAMPLE, { mode: 'cute', rate: 'high', seed: 7 })
  assert.equal(a.text, b.text)
  const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => mod.flavor(SAMPLE, { mode: 'cute', rate: 'high', seed: s }).text))
  assert.ok(seen.size > 1, '换了 seed 也该有点变化')
})

test('代码块、行内代码、URL、标题、列表一行都不碰', () => {
  const text = [
    '## 标题别动这一行',
    '- 列表也别动这一行',
    '```bash',
    'npm run build --silent',
    '```',
    '跑一下 `npm test` 就知道了。',
    '参考 https://example.com/a/b 这个。',
  ].join('\n')
  const out = mod.flavor(text, { mode: 'cute', rate: 'high', seed: 1 })
  assert.equal(out.hits.length, 0)
  assert.equal(out.text, text)
})

test('太短的句子不挂（五个字以下）', () => {
  const out = mod.flavor('好。行。可以吧。', { mode: 'cute', rate: 'high', seed: 1 })
  assert.equal(out.hits.length, 0)
})

/* ───────────── 挂到宿主上 ───────────── */

const sections = []
const tools = []
let route = null

const captured = {}
const root = { inject(deps, fn) { captured[deps[0]] = fn } }
const effect = (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} }
mod.apply(root, { enabled: false })

captured.systemPrompt({
  effect,
  systemPrompt: { section: (s) => { sections.push(s); return () => {} } },
})
captured.tools({ effect, tools: { register: (t) => { tools.push(t) } } })
captured.webServer({ effect, webServer: { register: (r) => { route = r; return () => {} } } })

test('默认关：不挂 prompt 那一节', () => {
  assert.equal(sections.length, 0, '关着的时候不该有 prompt')
  assert.ok(tools.find((t) => t.name === 'fish_meme'))
  assert.ok(tools.find((t) => t.name === 'fish_flavor'))
  assert.ok(route && route.path === '/api/fish-flavor')
})

test('fish_meme 工具：能查、能抽、json 给结构', async () => {
  const t = tools.find((x) => x.name === 'fish_meme')
  const r1 = await t.execute({ query: '破防' })
  assert.ok(r1.ok)
  assert.match(r1.text, /破防/)
  const r2 = await t.execute({ vibe: 'cute', format: 'json' })
  const parsed = JSON.parse(r2.text)
  assert.ok(parsed.count >= 1)
  assert.ok(parsed.memes.every((m) => m.vibes.includes('cute')))
  const r3 = await t.execute({ query: '没有这个梗' })
  assert.match(r3.text, /没有对上的梗/)
})

test('fish_flavor 工具：按参数挂，空文本报错', async () => {
  const t = tools.find((x) => x.name === 'fish_flavor')
  const r = await t.execute({ text: SAMPLE, mode: 'abstract', rate: 'high', seed: 2, format: 'json' })
  const parsed = JSON.parse(r.text)
  assert.equal(parsed.mode, 'abstract')
  assert.ok(parsed.hits.length >= 1)
  const bad = await t.execute({ text: '   ' })
  assert.equal(bad.ok, false)
})

test('设置页接口：status / config / preview / memes', async () => {
  class Req extends EventEmitter {
    constructor(method, url, body) { super(); this.method = method; this.url = url; this._body = body }
    start() { if (this._body !== undefined) this.emit('data', JSON.stringify(this._body)); this.emit('end') }
  }
  const call = (method, path, body) => new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b; resolve(this) } }
    const req = new Req(method, '/api/fish-flavor' + path, body)
    route.handler(req, res)
    req.start()
  })

  const st = JSON.parse((await call('GET', '/status')).body)
  assert.equal(st.ok, true)
  assert.equal(st.enabled, false)
  assert.ok(st.library.count >= 60)

  const cfg = JSON.parse((await call('POST', '/config', { enabled: true, mode: 'abstract', rate: 'normal' })).body)
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.mode, 'abstract')

  const pv = JSON.parse((await call('POST', '/preview', { text: SAMPLE, mode: 'cute', rate: 'high', seed: 3 })).body)
  assert.equal(pv.ok, true)
  assert.equal(pv.mode, 'cute')
  assert.notEqual(pv.text, SAMPLE)

  const ms = JSON.parse((await call('GET', '/memes?limit=5')).body)
  assert.equal(ms.count, 5)

  const bad = JSON.parse((await call('POST', '/preview', { text: ' ' })).body)
  assert.equal(bad.ok, false)
})

/* ───────────── 句式梗 + 震惊档 ───────────── */

test('句式库：24 条，带模板和分开的评论/弹幕计数', async () => {
  const raw = JSON.parse(readFileSync(new URL('../data/constructions.json', import.meta.url), 'utf8'))
  assert.ok(raw.length >= 20, `只有 ${raw.length} 条`)
  for (const c of raw) {
    assert.ok(c.name && c.template && c.effect && c.example, `${c.id} 字段不全`)
    assert.ok(c.corpus && typeof c.corpus.comment === 'number' && typeof c.corpus.danmaku === 'number', `${c.id} 缺计数`)
  }
  const list = mod.searchMemes({ kind: 'construction', limit: 50 })
  assert.equal(list.length, raw.length)
  assert.ok(list.every((m) => m.kind === 'construction'))
})

test('查梗能按 word / construction 分开', () => {
  const words = mod.searchMemes({ kind: 'word', limit: 30 })   // limit 上限 30
  const cons = mod.searchMemes({ kind: 'construction', limit: 30 })
  assert.equal(words.length, 30)
  assert.equal(cons.length, 24)
  assert.ok(!words.some((m) => m.kind === 'construction'))
})

test('震惊档：句号换成「？！」就是基础款，不乱加前綴', () => {
  const src = '这个转场我给满分。后面那段也有点想法。'
  const out = mod.flavor(src, { mode: 'shock', seed: 3 })
  assert.equal(out.hits.length, 1)
  assert.ok(out.text.endsWith('？！'), out.text)
  assert.ok(!out.text.includes('！？'), `不该出现加码版前缀：${out.text}`)
  const inner = out.text.replace(/？！/g, '').replace(/[。]/g, '')
  assert.equal(inner.replace(/\s/g, ''), src.replace(/[。]/g, '').replace(/\s/g, ''))
})

test('震惊档：代码行不碰', () => {
  const src = '```\nnpm run build\n```'
  assert.equal(mod.flavor(src, { mode: 'shock', seed: 1, protect: true }).text, src)
})

test('可爱档：特指问后面不挂「嘛」', () => {
  const src = '你干什么了。你怎么了。这个我挺喜欢的。'
  for (let seed = 1; seed <= 60; seed++) {
    const out = mod.flavor(src, { mode: 'cute', rate: 'high', seed }).text
    assert.equal(/[什么么]了嘛/.test(out), false, `seed ${seed}：${out}`)
  }
})
