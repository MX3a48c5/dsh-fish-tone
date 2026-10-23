/**
 * dsh-fish-tone-flavor —— 人味插件的**附属包**
 *
 * 主插件（dsh-fish-tone）只管「把话往人的方向掰一点点」，它自己是中性的。
 * 可爱、抽象、热梗这些**性格**都放在这里，而且默认是关的：
 *   关着 → 只多两个工具（fish_meme / fish_flavor），不往 prompt 里塞任何东西
 *   开着 → 挂一节性格层 prompt + 让 fish_flavor 真的会挂软尾巴 / 梗尾巴
 *
 * 为什么拆开：性格是偏好，不是语言能力。换个心情可能就不想可爱了，
 * 也可能只想看热梗库、不想让模型说话带梗 —— 一个开关比一次改代码便宜。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-fish-tone-flavor'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/* ───────────────────────── 热梗库 ───────────────────────── */

/** @type {{note:string, builtAt:string, count:number, memes:Array<any>}} */
let LIB = { note: '', builtAt: '', count: 0, memes: [] }
/** 句式梗：一套模板，往格式里填东西（！？X？！ / X了 / 单字判词） */
let CONS = []

function loadLib() {
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'memes.json'), 'utf8'))
    if (Array.isArray(raw?.memes)) LIB = raw
  } catch { /* 没数据也能跑，只是查不到梗 */ }
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'constructions.json'), 'utf8'))
    if (Array.isArray(raw)) CONS = raw
  } catch { /* 句式库可缺 */ }
}
loadLib()

/** 把句式梗和词汇梗拍成同一个形状，查询和输出都不用分叉。 */
function constructionAsMeme(c) {
  return {
    id: c.id,
    kind: 'construction',
    term: c.name,
    template: c.template,
    gloss: c.effect,
    usage: c.example,
    vibes: c.vibes || [],
    year: '2024–2026',
    source: 'B站评论区句式（语料称重）',
    corpus: { comment: c.corpus?.comment ?? 0, danmaku: c.corpus?.danmaku ?? 0 },
  }
}

/** 全部梗（词汇 + 句式），统一形状。 */
export function allMemes() {
  const words = LIB.memes.map((m) => ({ ...m, kind: m.kind || 'word' }))
  return [...words, ...CONS.map(constructionAsMeme)]
}

const VIBES = ['cute', 'abstract', 'ironic', 'broken', 'work', 'heal', 'hype', 'retro', 'slacker', 'fun']

/**
 * 查梗。
 * @param {{query?:string, vibe?:string, limit?:number}} [opts]
 * @returns {Array<any>}
 */
export function searchMemes(opts = {}) {
  const q = String(opts.query ?? '').trim().toLowerCase()
  const vibe = String(opts.vibe ?? '').trim()
  const limit = Math.max(1, Math.min(30, Number(opts.limit) || 8))
  let list = allMemes()
  if (opts.kind === 'word' || opts.kind === 'construction') list = list.filter((m) => m.kind === opts.kind)
  if (vibe) list = list.filter((m) => (m.vibes || []).includes(vibe))
  if (q) {
    list = list.filter((m) =>
      m.term.toLowerCase().includes(q)
      || (m.aliases || []).some((a) => a.toLowerCase().includes(q))
      || String(m.gloss ?? '').includes(q)
      || String(m.usage ?? '').includes(q)
      || String(m.template ?? '').includes(q))
  }
  return list.slice(0, limit)
}

/** 随一个梗。同一个 seed 给同一个，方便测试。 */
export function randomMeme(seed = 7, opts = {}) {
  const pool = searchMemes({ ...opts, limit: 999 })
  if (pool.length === 0) return null
  return pool[Math.floor(mulberry32(seed)() * pool.length)]
}

/* ───────────────────────── 性格档 ───────────────────────── */

/** 挂尾巴的概率（按句子算）。low 是默认：一段话里大概挂一处。 */
export const RATES = { low: 0.07, normal: 0.16, high: 0.3 }

/** 可爱档的软尾巴。都只加在句尾、标点前面，一句最多一个。 */
const CUTE_TAILS = ['呀', '嘛', '啦', '哟', '哦', '呢']

/** 特指问（干什么/为什么/多少）：这种句子后面挂「嘛」是病句（"你干什么了嘛"）。 */
const WH_WORD = /(什么|怎么|怎样|咋|哪|谁|为啥|为什么|多少|几|干嘛|何时)/

/** 抽象档的梗尾巴：能直接「，X」收句的那几个。宁缺毋滥，凑数的读起来像营销号。 */
const TAIL_PHRASES = new Set(['典', '绝了', '离谱', '逆天', '这很难评', '我不理解', '就这', '好家伙', '绷不住了', '笑死', '已阅', '那咋了', '不讲不讲', '抽象'])
export function abstractTails() {
  const inLib = new Set(LIB.memes.map((m) => m.term))
  return [...TAIL_PHRASES].filter((t) => inLib.has(t))
}

const ALREADY_SOFT = new Set([...'吧啦嘛啊呀哦呢么吗呗诶欸捏'])
/** 判断句的线索词：梗挂在这类句尾才像评价，不像硬塞。 */
const JUDGE = /(有点|有一点|挺|太|真的|感觉|觉得|难|不错|拖|尬|怪|离谱|一般|不行|还行)/
const STRUCTURAL = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~)/
const LOOKS_LIKE_CODE = /^\s*(\$|\.{0,2}\/|~\/|[A-Za-z]:\\|npm |pnpm |git |node |python|uv )/
const PROTECTED_SPAN = /(```|~~~|`[^`]+`|https?:\/\/\S+|\/[\w.-]+\/[\w./-]+|--[\w-]{2,})/

/** 这一行整行跳过。 */
export function isStructuralLine(line) {
  return STRUCTURAL.test(line) || LOOKS_LIKE_CODE.test(line) || PROTECTED_SPAN.test(line)
}

/** 切句：句子本体 + 它后面的标点。 */
export function splitSentences(line) {
  const out = []
  const re = /([^。！？!?…；;]+)([。！？!?…；;]*)/g
  let m
  while ((m = re.exec(line)) !== null) {
    if (m[0] === '') break
    out.push({ body: m[1], sep: m[2] })
  }
  return out
}

/**
 * 把话往「性格」方向掰一点。只加尾巴，不改句子。
 * @param {string} text
 * @param {{mode?:'cute'|'abstract', rate?:'low'|'normal'|'high', seed?:number, protect?:boolean}} [opts]
 * @returns {{text:string, hits:Array<{mode:string, tail:string, body:string}>, considered:number}}
 */
export function flavorize(text, opts = {}) {
  const src = String(text ?? '')
  if (opts.mode === 'shock') return wrapShock(src, opts)
  const mode = opts.mode === 'abstract' ? 'abstract' : 'cute'
  const rate = RATES[opts.rate] ?? RATES.low
  const seed = Number.isFinite(opts.seed) ? opts.seed : 7
  const protect = opts.protect !== false
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const tails = mode === 'cute' ? CUTE_TAILS : abstractTails()
  if (tails.length === 0) return { text: src, hits: [], considered: 0 }

  const lines = src.split('\n')
  const hits = []
  let considered = 0
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (protect && isStructuralLine(line)) continue
    const parts = splitSentences(line)
    if (parts.length === 0) continue

    // 先挑出这一行里能挂的位置（太短、已经带语气词的不要）
    const eligible = []
    for (let i = 0; i < parts.length; i++) {
      const body = parts[i].body
      const trimmed = body.trimEnd()
      const last = trimmed[trimmed.length - 1] ?? ''
      considered += 1
      const ok = trimmed.length >= 5
        && /[\u4e00-\u9fff]/.test(last)
        && !ALREADY_SOFT.has(last)
        && !ALREADY_SOFT.has(trimmed[trimmed.length - 2] ?? '')
      if (ok) eligible.push(i)
    }
    const targets = new Map()  // 句子下标 → 尾巴下标
    // 抽象的梗挂在**最后一个**判断句上才顺（「后面那段有点拖，这很难评」），
    // 挂在陈述句中间像硬塞 —— 所以从后往前找第一个掷中的。可爱档不挑位置。
    // 判断句优先（有「有点/挺/太/真/感觉…」这类评价词的那几句）
    const judged = mode === 'abstract' ? eligible.filter((i) => JUDGE.test(parts[i].body)) : []
    const order = mode === 'abstract' ? [...(judged.length ? judged : eligible)].reverse() : eligible
    // 抽象档一段只挂一处，所以命中率按「段」算，不然会稀得看不见
    const p = mode === 'abstract' ? Math.min(0.85, rate * 2.5) : rate
    for (const i of order) {
      const draw = rng()
      const pick = Math.floor(rng() * tails.length)
      // 硬闸：特指问后面不挂「嘛」（"你干什么了嘛"），别的站不住脚的搭配也一样处理
      if (tails[pick] === '嘛' && WH_WORD.test(parts[i].body)) continue
      if (draw < p && hits.length + targets.size < 3) {
        targets.set(i, pick)
        if (mode === 'abstract') break
      }
    }

    let rebuilt = ''
    for (let i = 0; i < parts.length; i++) {
      const body = parts[i].body
      const tail = tails[targets.get(i) ?? 0]
      if (!targets.has(i)) { rebuilt += body + parts[i].sep; continue }
      const trimmed = body.trimEnd()
      const joined = mode === 'cute' ? `${trimmed}${tail}` : `${trimmed}，${tail}`
      hits.push({ mode, tail, body: trimmed.slice(-14) })
      rebuilt += joined + body.slice(trimmed.length) + parts[i].sep
    }
    lines[li] = rebuilt
  }
  // 一段话里最多挂三处：再多就不是性格，是口音（循环里已经卡住，这里只是兜底）
  return { text: lines.join('\n'), hits, considered }
}

/**
 * 震惊档：最后一句的句号换成「？！」。
 *
 * 这是基础款 —— 「14.69？！」。网上更常见的是「！？X？！」那种把东西整个夹住的写法，
 * 但那是加码版：中间得是两个叠字（强强 / 电电）或者抽象名词，用在抽象视频底下。
 * 不分场合乱加就成了模仿梗，所以这里只做基础款，加码的交给 prompt 里的人判断。
 * @param {string} text
 * @param {{seed?:number, protect?:boolean}} [opts]
 */
export function wrapShock(text, opts = {}) {
  const src = String(text ?? '')
  const seed = Number.isFinite(opts.seed) ? opts.seed : 7
  const protect = opts.protect !== false
  const rng = mulberry32(seed ^ 0x85ebca6b)
  const lines = src.split('\n')
  for (let li = lines.length - 1; li >= 0; li--) {
    const line = lines[li]
    if (!line.trim()) continue
    if (protect && isStructuralLine(line)) continue
    const parts = splitSentences(line).filter((p) => p.body.trim().length >= 4)
    if (parts.length === 0) continue
    const target = parts[Math.min(parts.length - 1, Math.floor(rng() * parts.length))]
    const body = target.body.trim()
    const idx = line.indexOf(target.body)
    if (idx < 0) continue
    const replaced = `${body}？！`
    lines[li] = line.slice(0, idx) + replaced + line.slice(idx + target.body.length + target.sep.length)
    return { text: lines.join('\n'), hits: [{ mode: 'shock', tail: '？！', body: body.slice(-14) }], considered: parts.length }
  }
  return { text: src, hits: [], considered: 0 }
}

/**
 * 只挂前 N 处的版本（flavorize 本身不截断文本，这里给它兜底）。
 * @param {string} text
 * @param {object} opts
 */
export function flavor(text, opts = {}) {
  const out = flavorize(text, opts)
  if (out.hits.length <= 3) return out
  return { ...out, hits: out.hits.slice(0, 3) }
}

/* ───────────────────── 确定性随机 ───────────────────── */

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ───────────────────────── 配置 ───────────────────────── */

const CONFIG_FILE = process.env.DSH_FISH_TONE_FLAVOR_CONFIG || join(ROOT, 'config.json')
const DEFAULTS = { enabled: false, mode: 'cute', rate: 'low', seed: 7 }

function loadConfig(hostConfig = {}) {
  const out = { ...DEFAULTS }
  if (typeof hostConfig?.enabled === 'boolean') out.enabled = hostConfig.enabled
  if (hostConfig?.mode === 'cute' || hostConfig?.mode === 'abstract') out.mode = hostConfig.mode
  if (RATES[hostConfig?.rate]) out.rate = hostConfig.rate
  if (Number.isFinite(hostConfig?.seed)) out.seed = hostConfig.seed
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (typeof raw?.enabled === 'boolean') out.enabled = raw.enabled
    if (raw?.mode === 'cute' || raw?.mode === 'abstract') out.mode = raw.mode
    if (RATES[raw?.rate]) out.rate = raw.rate
    if (Number.isFinite(raw?.seed)) out.seed = raw.seed
  } catch { /* 没文件就用默认 */ }
  return out
}

function saveConfig(patch) {
  const next = { ...live }
  if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled
  if (patch?.mode === 'cute' || patch?.mode === 'abstract') next.mode = patch.mode
  if (RATES[patch?.rate]) next.rate = patch.rate
  if (Number.isFinite(patch?.seed)) next.seed = Math.trunc(patch.seed)
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(next, null, 2) + '\n')
  renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE)
  Object.assign(live, next)
  return next
}

let live = loadConfig()
let promptRegistered = false
const syncers = new Set()
function applyLive() {
  for (const fn of syncers) {
    try { fn() } catch { /* 一个坏不影响别的 */ }
  }
}

/* ───────────────────────── prompt ───────────────────────── */

function promptFor(cfg) {
  const cute = cfg.mode === 'cute'
  return `## 性格层（附属包 · 可选，用户自己开的）

现在这一层是开着的：${cute ? '**可爱一点**' : '**抽象一点**'}。密度很低，低到对方不一定说得出来哪句怪。

- ${cute
    ? '句尾偶尔挂一个软语气词（呀 / 诶 / 嘛 / 啦 / 呜 / 哟），一句最多一个，一段最多两处。'
    : '句尾偶尔用一个热梗收尾（典 / 绝了 / 这很难评 / 我不理解 / 就这 / 好家伙），一段最多一处，不连用。'}
- 热梗要查就用 \`fish_meme\`，别自己编。意思拿不准、场合不合适，宁可不挂。
- 全篇都是梗的是营销号，不是人。**越省着用越像人。**
- 代码、数字、路径、正式报告、用户说「严谨点」的时候：这一节整节失效。

这一层可以随时关掉，关掉之后一个字都不加。`
}

/* ───────────────────────── HTTP ───────────────────────── */

function sendJson(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 1_000_000) req.destroy() })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

/* ───────────────────────── 工具文案 ───────────────────────── */

const MEME_TOOL = `查 B 站这阵子的热梗（不联网，本地一份语料养出来的库）。

每条给：梗本身、哪年、什么味道（可爱/抽象/阴阳/破防/职场/治愈…）、一句话意思、怎么用、来源，以及它在本地语料里出现过几次。

- query: 关键词，可留空
- vibe: 按味道过滤（cute / abstract / ironic / broken / work / heal / hype / retro / slacker / fun）
- limit: 几条，默认 8
- random: true = 随机抽一条

Use it when the user asks 这个梗什么意思 / 最近有什么梗 / 帮我想个梗。不要拿它当常识库：
库里没有的梗，说没有就好。`

const FLAVOR_TOOL = `给一段话挂一点性格（附属包 · 可爱 / 抽象）。

只加尾巴，不改句子：
- cute：句尾挂软语气词（呀 / 嘛 / 啦 / 哟 / 哦 / 呢）
- abstract：句尾挂一个短梗（典 / 绝了 / 这很难评 / 我不理解 / 就这 / 好家伙）
- shock：句号换「？！」（14.69？！）—— 只做基础款，「！？X？！」是加码版，插件不自动加

密度很低（默认 low ≈ 每十几句一处，最多三处）。跳过代码块、行内代码、URL、路径、表格、标题、列表。

- rate: low（默认）| normal | high
- seed: 同一个 seed + 同一段文字 → 同一个结果`

/* ───────────────────────── 入口 ───────────────────────── */

export function apply(root, config = {}) {
  live = loadConfig(config)

  root.inject(['systemPrompt'], (ctx) => {
    let dispose = null
    const sync = () => {
      if (dispose) { dispose(); dispose = null }
      promptRegistered = false
      if (!live.enabled) return
      dispose = ctx.systemPrompt.section({
        name: 'fish-tone:flavor',
        order: 921,
        text: promptFor(live),
      })
      promptRegistered = true
    }
    sync()
    syncers.add(sync)
    ctx.effect(() => () => {
      syncers.delete(sync)
      promptRegistered = false
      if (dispose) dispose()
    }, 'dsh-fish-tone-flavor: 性格层 prompt')
  })

  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'fish_meme',
      description: MEME_TOOL,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，可留空。' },
          kind: { type: 'string', enum: ['word', 'construction'], description: 'word=词（破防/绝了），construction=句式（！？X？！ / 单字判词）。' },
          vibe: { type: 'string', enum: VIBES, description: '按味道过滤。' },
          limit: { type: 'number', description: '几条，默认 8，最多 30。' },
          random: { type: 'boolean', description: 'true = 随机抽一条。' },
          format: { type: 'string', enum: ['text', 'json'], description: 'text 给人看；json 给结构化。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'text'],
          properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: async (args) => {
        const list = args?.random
          ? [randomMeme(Number.isFinite(args?.seed) ? args.seed : 7, { vibe: args?.vibe })].filter(Boolean)
          : searchMemes({ query: args?.query, vibe: args?.vibe, kind: args?.kind, limit: args?.limit })
        if (args?.format === 'json') {
          return { ok: true, text: JSON.stringify({ count: list.length, memes: list }, null, 2) }
        }
        if (list.length === 0) return { ok: true, text: '库里没有对上的梗。要么换个词，要么这个梗还没进库。' }
        const one = (m) => m.kind === 'construction'
          ? `· ${m.term}${m.template ? `  ${m.template}` : ''}\n  ${m.gloss}\n  例：${m.usage}`
            + `\n  语料：评论 ${m.corpus.comment} 次 / 弹幕 ${m.corpus.danmaku} 次`
          : `· ${m.term}${m.year ? `（${m.year}）` : ''} — ${m.gloss}\n  用法：${m.usage}`
            + `\n  来源：${m.source}${m.corpus?.hits ? `；本地语料出现 ${m.corpus.hits} 次 / ${m.corpus.videos} 个视频` : '；本地语料没见到'}`
        return { ok: true, text: `找到 ${list.length} 条：\n` + list.map(one).join('\n') }
      },
    })

    ctx.tools.register({
      name: 'fish_flavor',
      description: FLAVOR_TOOL,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要挂性格的那段话。' },
          mode: { type: 'string', enum: ['cute', 'abstract', 'shock'], description: '可爱 / 抽象 / 震惊（句号换？！）。不传用设置页里的。' },
          rate: { type: 'string', enum: ['low', 'normal', 'high'], description: '密度。默认 low。' },
          seed: { type: 'number', description: '随机种子；同一个 seed 给同一个结果。' },
          protect: { type: 'boolean', description: '默认 true：跳过代码块、行内代码、URL、路径、表格、标题、列表。' },
          format: { type: 'string', enum: ['text', 'json'], description: 'text 直接给掰过的文字；json 多给统计。' },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'text'],
          properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: async (args) => {
        const src = String(args?.text ?? '')
        if (!src.trim()) return { ok: false, text: '没有收到文字（text 是空的）。' }
        const mode = args?.mode === 'abstract' ? 'abstract' : args?.mode === 'cute' ? 'cute' : live.mode
        const rate = RATES[args?.rate] ? args.rate : live.rate
        const seed = Number.isFinite(args?.seed) ? args.seed : live.seed
        const out = flavor(src, { mode, rate, seed, protect: args?.protect !== false })
        if (args?.format === 'json') {
          return { ok: true, text: JSON.stringify({ text: out.text, mode, rate, hits: out.hits, considered: out.considered }, null, 2) }
        }
        return { ok: true, text: out.text }
      },
    })
  })

  root.inject(['webServer'], (ctx) => {
    const handler = async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.replace(/^\/api\/fish-flavor/, '') || '/'

      if (req.method === 'GET' && (path === '/' || path === '/status')) {
        return sendJson(res, 200, {
          ok: true,
          enabled: live.enabled,
          mode: live.mode,
          rate: live.rate,
          seed: live.seed,
          rates: Object.keys(RATES),
          vibes: VIBES,
          promptRegistered,
          library: { count: LIB.memes.length, builtAt: LIB.builtAt, note: LIB.note },
          configFile: CONFIG_FILE,
        })
      }

      if (req.method === 'POST' && path === '/config') {
        const body = await readBody(req)
        const next = saveConfig(body)
        applyLive()
        return sendJson(res, 200, { ok: true, ...next })
      }

      if (req.method === 'POST' && path === '/preview') {
        const body = await readBody(req)
        const src = String(body?.text ?? '')
        if (!src.trim()) return sendJson(res, 200, { ok: false, error: '没有文字' })
        const mode = body?.mode === 'abstract' ? 'abstract' : body?.mode === 'cute' ? 'cute' : live.mode
        const rate = RATES[body?.rate] ? body.rate : live.rate
        const seed = Number.isFinite(body?.seed) ? body.seed : live.seed
        const out = flavor(src, { mode, rate, seed })
        return sendJson(res, 200, { ok: true, text: out.text, original: src, hits: out.hits, mode, rate })
      }

      if (req.method === 'GET' && path === '/memes') {
        const q = url.searchParams.get('q') || ''
        const vibe = url.searchParams.get('vibe') || ''
        const list = searchMemes({ query: q, vibe, limit: Number(url.searchParams.get('limit')) || 8 })
        return sendJson(res, 200, { ok: true, count: list.length, memes: list })
      }

      return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    }

    const server = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
    if (!server || typeof server.register !== 'function') return
    try {
      ctx.effect(() => server.register({
        kind: 'prefix',
        path: '/api/fish-flavor',
        handler: (req, res) => {
          Promise.resolve(handler(req, res)).catch((e) => {
            try { sendJson(res, 500, { ok: false, error: e?.message ?? String(e) }) } catch { /* 走了 */ }
          })
        },
      }), 'dsh-fish-tone-flavor: /api/fish-flavor')
    } catch { /* 没有 webServer 也正常 */ }
  })
}
