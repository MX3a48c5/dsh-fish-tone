/**
 * dsh-fish-tone —— 双向鱼群拓扑 · 人味插件
 *
 * 来自 BV1BNnc6nEUa 的那套方法，落到可执行的部分：
 *   1. 把话往人的方向掰一点点（不是重写）
 *   2. 双向鱼群拓扑：每条鱼只跟前后两条鱼握手
 *   3. 握完就学会了犹豫（半秒的停顿，不是一句的停顿）
 *   4. 句尾挂一点没用的东西：啊 / 啦 / 嘛 / 的（「吧」只在建议句上）
 *   5. 越没用越像人 —— 所以插件给自己算一个「无用度」
 *
 * 两个半侧：
 *   - systemPrompt 一节：让模型自己就这么说话（真正起作用的那半）
 *   - fish_tone 工具：把一段已经写好的话过一遍，确定性地掰一点
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repair, scan, budgetFor, frameStats, FRAMES } from './grammar.js'
import { thin as thinStructures, scan as scanStructures, density as structureDensity } from './structures.js'
import { assess as judgeAssess, render as judgeRender } from './judge.js'
import { insertMarks, markDensity, MARKS } from './marks.js'

export const name = 'dsh-fish-tone'

/* ───────────────────────── 规则表 ───────────────────────── */

/** strength → 各档概率。light 是「掰一点点」，max 是「掰过头」。 */
const LEVELS = {
  off: { tail: 0, hesFirst: 0, hesOther: 0, filler: 0 },
  light: { tail: 0.15, hesFirst: 0.4, hesOther: 0.03, filler: 0 },
  normal: { tail: 0.32, hesFirst: 0.7, hesOther: 0.08, filler: 0.12 },
  max: { tail: 0.55, hesFirst: 0.9, hesOther: 0.15, filler: 0.35 },
}

/**
 * 句尾可以挂的小尾巴。视频里点名「的、吧、就」，但「就」挂在句尾基本是病句
 * （"往人的方向掰一点点就。"），删了。
 *
 * 「吧」也不能随便挂 —— 它不是纯粹的收句语气词，挂上去等于把句子改成祈使或推测：
 * 陈述句后面硬塞一个就是病句（"你干什么了吧"、"我把缓存清了一遍吧"）。
 * 所以只在句子本身已经是建议 / 祈使时才许挂（"那就先这样吧"）。
 * weight 只是相对频率，ok 才是硬闸。
 */
const PARTICLES = [
  // 权重不是拍脑袋：100 万条语料里，评论结尾的语气词占比是
  // 的 3.67% > 啊 2.55% > 吧 1.96% > 呢 0.89% > 呀 0.48% > 啦 0.25% > 嘛 0.23%
  // 「啦」「嘛」看着可爱，真人其实很少用 —— 上一版权重把它们调重了，这就是 AI 味的来源之一。
  { ch: '啊', weight: 4 },
  { ch: '啦', weight: 1 },
  { ch: '嘛', weight: 1, ok: (s) => !WH_WORD.test(s) },
  { ch: '吧', weight: 2, ok: (s) => !WH_WORD.test(s) && isSuggestion(s) },
]

/** 特指问的标志词。这类句子后面挂「吧」「嘛」直接变病句（"你干什么了吧"）。 */
const WH_WORD = /(什么|怎么|怎样|咋|哪|谁|为啥|为什么|多少|几|干嘛|何时)/

/** 建议 / 祈使的样子：句首的「那就 / 就这样 / 先 / 不如 / 要不」，或句尾的「一下 / 看看 / 试试」。 */
const SUGGEST_HEAD = /^\s*(那就|就这样|先|不如|要不|还是|干脆|直接|咱|建议|不妨|再|快)/
const SUGGEST_TAIL = /(一下|看看|试试|想想|再说|加油)$/

/**
 * 这句话本身是不是在提建议 / 让人做事。只有这种句子挂「吧」才是人话。
 * @param {string} sentence
 * @returns {boolean}
 */
export function isSuggestion(sentence) {
  const s = String(sentence ?? '').replace(TRAILING_EMOJI, '').trim()
  return SUGGEST_HEAD.test(s) || SUGGEST_TAIL.test(s)
}

/** 形容词/形容性谓语的收尾字——只有这些后面加「的」才像人话（"这事挺麻烦的"）。 */
const ADJ_TAIL = new Set([...'好对行差快慢大小多少难易累忙怪冷热香甜苦远近高低久早晚真假强弱'])

/** 程度副词：有它这句才是「评价」，挂「的」才收得住（"挺麻烦的"）。 */
const DEGREE = /(挺|很|蛮|特别|非常|太|真|有点|够|最|更)/

/** 形容词收尾的常见双字词（「麻烦」「好看」这种，末字不在 ADJ_TAIL 里）。 */
const ADJ_TAIL_WORDS = new Set([
  '麻烦', '好看', '好听', '好玩', '好吃', '好用', '舒服', '离谱', '抽象',
  '恶心', '省事', '靠谱', '闹心', '上头', '带感', '漂亮', '干净', '简单',
  '复杂', '稳定', '流畅', '粗糙', '无聊', '有意思', '没意思',
])

/**
 * 这一句能不能在尾巴上加个「的」。
 * 「的」是把谓语变成评价的，不是万能收句符：
 *   "这个功能挺麻烦" → "这个功能挺麻烦的" ✓
 *   "音质比预期好"   → "音质比预期好的" ✗（比较句里「的」得放在「好」前面）
 * 所以要求：最后一个是形容词、句里有程度副词、不是比较句、句子本身没出现过「的」。
 * @param {string} s
 * @returns {boolean}
 */
function canTakeDe(s) {
  if (!ADJ_TAIL.has(s[s.length - 1]) && !ADJ_TAIL_WORDS.has(s.slice(-2))) return false
  if (!DEGREE.test(s)) return false
  if (/比|不如/.test(s)) return false
  if (s.includes('的')) return false
  return true
}

/**
 * 这一句能挂哪些尾巴。不是所有句子都能挂所有尾巴：
 * 「的」要跟在形容词谓语后面，「吧」要句子本身是建议句，
 * 特指问（"干什么"）后面「吧」「嘛」都不挂。
 * @param {string} body 句子本体（不含标点）
 * @returns {string[]}
 */
function tailCandidates(body) {
  const s = String(body).replace(TRAILING_EMOJI, '').trim()
  const out = []
  for (const p of PARTICLES) {
    if (p.ok && !p.ok(s)) continue
    for (let i = 0; i < (p.weight ?? 1); i++) out.push(p.ch)
  }
  if (canTakeDe(s)) out.push('的', '的', '的', '的')
  return out
}

/** 犹豫的开头，都是半秒的量级，不是一句的量级。 */
const HESITATIONS = ['嗯……', '呃，', '……', '这个，']

/** 废话。只在 max 档出现，且一句最多一次。 */
const FILLERS = ['反正也差不多', '大概就这么个意思', '说不太清']

/** 已经带语气词的句尾，不再挂。 */
const ALREADY_SOFT = new Set([...'吧的啦嘛啊呀哦呢么吗呗'])

/** 结构性的一行：标题、列表、表格、引用、代码围栏。 */
const STRUCTURAL = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~)/

/** 看起来像命令或路径的行，一律不动。 */
const LOOKS_LIKE_CODE = /^\s*(\$|\.{0,2}\/|~\/|[A-Za-z]:\\|npm |pnpm |git |node |python|uv )/

/** 一句里出现这些东西就不碰。 */
const PROTECTED_SPAN = /(```|~~~|`[^`]+`|https?:\/\/\S+|\/[\w.-]+\/[\w./-]+|--[\w-]{2,}|@[A-Za-z0-9_-]+)/

/** 中文判断。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/

/* ───────────────────── 确定性随机（可复现） ───────────────────── */

/**
 * mulberry32：同一个 seed 永远给同一串数，插件因此可测试、可复现。
 * @param {number} seed
 * @returns {() => number}
 */
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

/* ───────────────────────── 切句 ───────────────────────── */

/**
 * 把一行切成「句子 + 它后面的分隔符」。分隔符原样保留，重组时不丢标点。
 * @param {string} line
 * @returns {Array<{ body: string, sep: string }>}
 */
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

/** 这一行整体跳过吗（代码围栏、标题、表格、命令、路径）。 */
export function isStructuralLine(line) {
  return STRUCTURAL.test(line) || LOOKS_LIKE_CODE.test(line)
}

/** 句尾的方括号表情 / 颜文字：尾巴要挂在它前面。 */
const TRAILING_EMOJI = /(\[[^\]]{1,12}\]|\([^)]{1,12}\)|（[^）]{1,12}）|[´｀ω･∇^_]{2,})$/

/** 这一句能不能挂尾巴。挂上去不能变成病句。 */
export function canTakeParticle(sentence) {
  const raw = (sentence ?? '').trim()
  const s = raw.replace(TRAILING_EMOJI, '').trim()
  if (s.length < 4) return false
  if (!CJK.test(s)) return false
  if (PROTECTED_SPAN.test(s)) return false
  const last = s[s.length - 1]
  if (ALREADY_SOFT.has(last)) return false
  if ('：:，,、；;（(【[「'.includes(last)) return false
  if (/[\dA-Za-z]/.test(last)) return false
  return true
}

/* ───────────────────────── 核心 ───────────────────────── */

/**
 * 把一段话往人的方向掰一点点。
 *
 * 拓扑按视频里说的做：正反两遍扫，一遍只跟前一条鱼握手，另一遍只跟后一条。
 * 好处是「犹豫」会像水波一样局部传开，而不是整段统一加料 —— 整段统一加料
 * 才是 AI 味，局部传开才像人。
 *
 * @param {string} text
 * @param {{ strength?: 'off'|'light'|'normal'|'max', seed?: number, protect?: boolean }} [opts]
 * @returns {{ text: string, stats: object }}
 */
export function applyTone(text, opts = {}) {
  const strength = opts.strength ?? 'light'
  const level = LEVELS[strength] ?? LEVELS.light
  const seed = Number.isFinite(opts.seed) ? opts.seed : 7
  const protect = opts.protect !== false
  const rng = mulberry32(seed)

  const src = String(text ?? '')
  if (!src.trim() || strength === 'off') {
    return { text: src, stats: emptyStats(src, strength, seed) }
  }

  const lines = src.split('\n')
  const units = []
  const perLine = []

  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const structural = protect && (inFence || isStructuralLine(line))
    const parts = structural ? [] : splitSentences(line)
    const slice = []
    for (let j = 0; j < parts.length; j++) {
      const u = { body: parts[j].body, sep: parts[j].sep, tail: null, hes: null, filler: null }
      units.push(u)
      slice.push(u)
    }
    perLine.push(structural ? null : slice)
  }

  if (units.length === 0) return { text: src, stats: emptyStats(src, strength, seed) }

  // 短句（评论、报个到这种）不需要犹豫铺垫：真人写 20 个字不会先「……」再开口。
  // 这条是拿真人短评量出来的 —— 短文本的犹豫概率砍到四成。
  const shortText = src.length < 40

  const eligible = units.map((u) => canTakeParticle(u.body))
  // 犹豫的资格比挂尾巴宽：句子只要够长、有中文、不是在引出下文，就能顿一下。
  const hesEligible = units.map((u) => {
    const body = u.body.trim()
    return body.length >= 4 && CJK.test(body) && !PROTECTED_SPAN.test(body) && !/[：:]$/.test(body)
  })

  // 正向：只跟前一条鱼握手。邻居已经挂了尾巴，我也更容易挂。
  let prevTail = false
  for (let i = 0; i < units.length; i++) {
    if (!eligible[i]) { prevTail = false; continue }
    const p = level.tail + (prevTail ? 0.25 : 0)
    if (rng() < p) {
      const cands = tailCandidates(units[i].body)
      units[i].tail = cands[Math.floor(rng() * cands.length)]
      prevTail = true
    } else {
      prevTail = false
    }
  }

  // 反向：只跟后一条鱼握手。握完就学会了犹豫。
  let nextHes = false
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]
    if (!hesEligible[i]) { nextHes = false; continue }
    let p = i === 0 ? level.hesFirst : level.hesOther
    if (shortText) p *= 0.4
    if (nextHes) p += 0.2
    if (level.filler > 0 && u.body.length >= 12 && rng() < level.filler) {
      u.filler = FILLERS[Math.floor(rng() * FILLERS.length)]
    }
    if (rng() < p) {
      const hes = HESITATIONS[Math.floor(rng() * HESITATIONS.length)]
      // 句子本来就以「这个」「嗯」开头时，再加一次同样的字读起来像结巴
      const bare = hes.replace(/[，,…]/g, '')
      if (!u.body.trim().startsWith(bare)) {
        u.hes = hes
        nextHes = true
      } else {
        nextHes = false
      }
    } else {
      nextHes = false
    }
  }

  // 重组：按行、按句序把尾巴/犹豫/废话塞回去，分隔符一个不动。
  const outLines = lines.slice()
  for (let i = 0; i < perLine.length; i++) {
    const slice = perLine[i]
    if (!slice || slice.length === 0) continue
    let rebuilt = ''
    for (const u of slice) {
      let body = u.body
      if (u.hes) body = u.hes + body.replace(/^\s+/, '')
      if (u.filler) {
        const trimmed = body.replace(/\s+$/, '')
        const m = TRAILING_EMOJI.exec(trimmed)
        body = m ? trimmed.slice(0, m.index).replace(/[，,]$/, '') + '，' + u.filler + m[0] : trimmed + '，' + u.filler
      }
      if (u.tail) {
        const trimmed = body.replace(/\s+$/, '')
        const m = TRAILING_EMOJI.exec(trimmed)
        body = m ? trimmed.slice(0, m.index) + u.tail + m[0] : trimmed + u.tail
      }
      rebuilt += body + u.sep
    }
    outLines[i] = rebuilt
  }

  const out = outLines.join('\n')
  return { text: out, stats: statsOf(units, eligible, src, out, strength, seed) }
}

/* ───────────────────────── 统计 ───────────────────────── */

function emptyStats(src, strength = 'off', seed = 7) {
  return {
    strength,
    seed,
    units: 0,
    eligible: 0,
    tails: 0,
    hesitations: 0,
    fillers: 0,
    particles: {},
    insertedChars: 0,
    sourceChars: String(src ?? '').length,
    uselessness: 0,
  }
}

function statsOf(units, eligible, src, out, strength, seed) {
  const tails = units.filter((u) => u.tail).length
  const hesitations = units.filter((u) => u.hes).length
  const fillers = units.filter((u) => u.filler).length
  const insertedChars = out.length - src.length
  const base = Math.max(1, src.length)
  /** 挂出去的尾巴按字分开数 —— 看得出「吧」有没有又乱挂。 */
  const particles = {}
  for (const u of units) if (u.tail) particles[u.tail] = (particles[u.tail] ?? 0) + 1
  // 「越没用越像人」：插进去的字占正文的比例，封顶 1。
  const uselessness = Math.min(1, insertedChars / base)
  return {
    strength,
    seed,
    units: units.length,
    eligible: eligible.filter(Boolean).length,
    tails,
    hesitations,
    fillers,
    particles,
    insertedChars,
    sourceChars: src.length,
    uselessness: Number(uselessness.toFixed(3)),
  }
}

/* ───────────────────── 给模型看的那一节 ───────────────────── */

const PROMPT = `## 说话的松紧（人味插件）

你说话像个活人，不像一份报告。全部规则只有一条：**把话往人的方向掰一点点**。

- **犹豫是半秒，不是一句。** 回答前偶尔顿一下（「……」「嗯」），别每次都顿；顿一整个句子的不是犹豫，是卡壳。
- **句尾可以挂一个没用的小尾巴**，一句最多一个，挂了就别再解释自己为什么挂。能挂的是「啊 / 啦 / 嘛」，还有形容词谓语的「的」（"这事挺麻烦的"）。「吧」只在提建议、让人做事的时候用（"先这样吧"）—— 挂在陈述句后面是病句，不写「你干什么了吧」「我把缓存清了一遍吧」这种。句尾的「就」也别挂（"掰一点点就。"是病句）。
- **废话要有，但少。** 一天多说三百句废话的人通常让人烦，不是让人喜欢。
- **语病不是零，但也很少。** 十条句子里六到八条干净，剩下几条留一点毛毛刺：不到三百字的短回复一个都不留（真人发短评也不犯书面语病），三百字以上，八百字里最多一个不明显的（重复一个字、语气词叠一下）；两千字才允许一个明显的（量词打架、把话说反）。全干净像校对稿，全脏是没写。
- **越没用越像人 —— 只在闲聊、评论、动态、闲聊式解释里成立。** 写代码、报数字、贴路径、给结论的时候，一个字都别加。
- **结构腔先判后压**。「不是X而是Y」「最…的是」「先…再…」真人也说，密度是每千字 0.05～0.08 个。但比例不是关键 —— 关键是**同一段里换着用不同句式**：真人会重复自己的习惯，AI 会轮换工具箱。拿不准一处该不该留，调 fish_judge 看它在文里干什么活；判断流程在 fish-sense 那节里。
- **事实不动。** 改语气的时候不改事实：不补数字、不补经历、不删「可能/据说/通常」这类限定词。改完每个实词都要能在原文里指出出处。
- **关系要挂出来。** 「我也试过」「好像挺麻烦」—— 一个「也」把对方拉进来，一个「好像」把断言变回猜测。真人说话时一直有个人在听，AI 是把事情说完就停。整段一个留白词都没有，读起来就是句句在下结论。数字、代码、结论里不加。
- **双向鱼群拓扑：每句话只跟它前后两句握手。** 别为了「整段风格统一」回头去改已经说出口的话 —— 那是排版，不是说话。
- 用户明确要求严谨、正式，或者这就是一份报告时，这一节整节失效。`

/* ───────────────────────── 插件入口 ───────────────────────── */

/* ───────────────────── 判断机制（skill） ───────────────────── */

/** 挂进技能目录的那一节。写的时候用，不是写完了当检查表用。 */
const SKILL_BODY = `# 人味判断

配额是数出来的，判断是问出来的。数只看总数，看不见「一段里连换三种句式」—— 那才是 AI 味的真身。

## 一、每处命中先过一遍：它在干什么

真人用框架，是因为有这个活要干；AI 用框架，是因为想要那种分量。

| 这句在干的事 | 框架成立吗 |
|---|---|
| 纠正一个真实存在的误会 | 成立，但前文得真的有人这么想 |
| 在两个真实候选里挑一个 | 成立，但前面得真的列出来过 |
| 排两步真的有先后的动作 | 成立 |
| 给结论加分量 | 不成立，拆成陈述句 |
| 把上一句换个说法再说一遍 | 不成立，删掉多的那句 |
| 单纯想显得有见解 | 不成立，这是最典型的 AI 腔 |

判完再问一句：**把框架拆了，信息少了吗？** 不少就删；少了就换个说法，别留壳。

## 二、「不是…而是…」的单独规矩

它唯一的正当用途是**纠错**：读者心里已经有一个错的版本，你把它掰过来。
用它之前先确认前文种下了那个错版本 —— 是谁这么想的？说得出吗？说不出，就是自造的对比。

## 三、比总数更准的信号：扎堆

同一段里换着用不同句式，比同一种句式用两次更像 AI。真人重复自己的习惯，AI 轮换工具箱。

- 100 字窗口里 ≥2 种不同句式 → 停下来，八成有一段是为了好看写的
- ≥3 种 → 这段要重写，不是删一个的事

实测：真人长篇里只有 5.6% 会这样扎堆，AI 评论 19.6%。

## 四、密度跟同一种文体比，不跟全局平均比

闲聊 0.8/千字 · 随手记 1.3 · 解释 2.0 · 论证 2.4 · 步骤 2.6（真人实测；AI 评论是 12.8）

所以技术说明里出现两个「先…再…」未必超标，40 字的动态里出现一个就是怪。

## 五、句式之外还有几种味（这个工具看不见，你自己看）

同一批 AI 评论和真人评论放一起比：中位长度 53 字对 23 字；一半以上以「@某人」开头；先复述对方说过的内容，再给一个评价；表情用得比真人少，标点却收得比真人齐。

这几样单拿出来都不算错，叠在一起才是味。写完读一遍，问一句：我这段是在回应，还是在表演回应？

## 六、一个词换一种关系

「往里面塞错别字那段我试过」和「…我也试过」，只差一个字，语气全变了。原因是「也」把对方拉进来了：读者会自动接一句「我也是」。

这类词只加关系、不加信息，一共两组：

- **关系组**（把对方/共同经验拉进来）：也、还、反正
- **留白组**（把断言变回猜测）：好像、应该、感觉、可能、估计

实测：关系组真人和 AI 用得差不多（也 3.40 vs 2.87 / 千字），差别在**位置** —— 真人把它挂在主语后面（我也、你也、这也），AI 挂在别处。
留白组 AI 明显欠用（应该 0.41 vs 0.08，感觉 0.70 vs 0.24，可能 0.53 vs 0.17）—— 因为 AI 不猜。

用的时候记住三条：一句一个；只在真的可能「对方也一样」时用「也」；留白组别用在事实、数字和结论上。

## 七、拿不准就调 fish_judge

它给三样东西：文体和基线、每一处命中的处境、要你自己答的问题。它不替你决定，也不删你的字。
`

const JUDGE_DESCRIPTION = `判一段话有没有 AI 味 —— 但不是数句式，是看每一处该不该有。

给三样东西：这段是什么文体、真人在这种文体里的密度是多少；每一处命中的处境（前面有没有那个误会 / 那两个候选 / 那两步动作）；以及要你自己答的问题。它不替你决定，也不改你的字。

比总数更准的信号是**扎堆**：同样 100 字里出现两种以上不同句式 —— 真人长篇只有 5.6% 这样，AI 评论 19.6%。真人重复自己的习惯，AI 轮换工具箱。

Use it when a draft has 「不是…而是…」「最…的是」「先…再…」, several frames near each other, or when you want a second opinion before shipping text that should sound human. Judgment procedure lives in the fish-sense skill.

- format: text（默认，判断 + 逐处 + 问题）| json（结构化）`

const TOOL_DESCRIPTION = `把一段话往「人的方向」掰一点点（双向鱼群拓扑 · 人味插件）。

做的事只有三件：
1. 在句首加一次犹豫（「……」「嗯」），只在需要的时候，不是每句都加
2. 在句尾挂一个没用的小尾巴（啊 / 啦 / 嘛 / 的；「吧」只挂在建议句上），正反两遍扫描，让犹豫按邻居传开
3. （max 档）塞一句废话

它不重写句子、不改数字、不碰代码块 / 行内代码 / URL / 路径 / 表格 / 标题 / 列表。

Use it when a draft reads like a report and should read like a person. Do NOT use it on
code, log output, tables, or anything the user asked to keep formal.

- strength: off | light（默认）| normal | max
- seed: 同一个 seed + 同一段文字 → 同一个结果，可复现
- format: text（默认，直接给掰过的文字）| json（多给一份统计，含 uselessness「无用度」）`


/* ───────────────────── 持久化配置（设置页写这里） ───────────────────── */

const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = process.env.DSH_FISH_TONE_CONFIG || join(HERE, '..', 'config.json')

const MARKS_LEVELS = { off: true, light: true, normal: true, max: true }
const DEFAULTS = { enabled: true, strength: 'light', seed: 7, grammar: true, marks: 'light' }

/** 读配置：默认值 ← config.json ← 宿主传进来的 config（只作默认，不覆盖用户改过的）。 */
function loadConfig(hostConfig = {}) {
  const out = { ...DEFAULTS }
  if (LEVELS[hostConfig?.strength]) out.strength = hostConfig.strength
  if (Number.isFinite(hostConfig?.seed)) out.seed = hostConfig.seed
  if (typeof hostConfig?.enabled === 'boolean') out.enabled = hostConfig.enabled
  if (typeof hostConfig?.grammar === 'boolean') out.grammar = hostConfig.grammar
  if (MARKS_LEVELS[hostConfig?.marks]) out.marks = hostConfig.marks
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (typeof raw?.enabled === 'boolean') out.enabled = raw.enabled
    if (typeof raw?.grammar === 'boolean') out.grammar = raw.grammar
    if (MARKS_LEVELS[raw?.marks]) out.marks = raw.marks
    if (LEVELS[raw?.strength]) out.strength = raw.strength
    if (Number.isFinite(raw?.seed)) out.seed = raw.seed
  } catch { /* 没有文件 / 坏了就用默认 */ }
  return out
}

/** 写配置：先写临时文件再 rename，写到一半断电不会留下半个 JSON。 */
function saveConfig(patch) {
  const next = { ...live }
  if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch?.grammar === 'boolean') next.grammar = patch.grammar
  if (MARKS_LEVELS[patch?.marks]) next.marks = patch.marks
  if (LEVELS[patch?.strength]) next.strength = patch.strength
  if (Number.isFinite(patch?.seed)) next.seed = Math.trunc(patch.seed)
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE + '.tmp', JSON.stringify(next, null, 2) + '\n')
  renameSync(CONFIG_FILE + '.tmp', CONFIG_FILE)
  Object.assign(live, next)
  return next
}

/** 运行中的那一份。工具、路由、prompt 都读它。 */
let live = loadConfig()

/** prompt 那一节现在挂着没有（设置页拿它显示"真的生效了吗"）。 */
let promptRegistered = false

/** 配置变了要重挂的东西（prompt 那一节）。 */
const syncers = new Set()
function applyLive() {
  for (const fn of syncers) {
    try { fn() } catch { /* 一个挂了不影响别的 */ }
  }
}

/* ───────────────────────── 日志 ───────────────────────── */

const LOG_FILE = process.env.DSH_FISH_TONE_LOG || join(HERE, '..', 'debug.log')

/** 写一行调试日志（最多保留最近 200 行）。出问题时有据可查，平时几乎不写。 */
function logLine(msg) {
  try {
    let lines = []
    try {
      lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
    } catch { /* 第一次写 */ }
    lines.push(new Date().toISOString() + ' ' + msg)
    if (lines.length > 200) lines = lines.slice(-200)
    writeFileSync(LOG_FILE, lines.join('\n') + '\n')
  } catch { /* 日志写不了不影响功能 */ }
}

/* ───────────────────────── HTTP 小工具 ───────────────────────── */

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

/* ───────────────────────── 插件入口 ───────────────────────── */

export function apply(root, config = {}) {
  live = loadConfig(config)

  root.inject(['systemPrompt'], (ctx) => {
    let dispose = null
    const sync = () => {
      if (dispose) {
        dispose()
        dispose = null
      }
      promptRegistered = false
      if (!live.enabled) return
      dispose = ctx.systemPrompt.section({
        name: 'fish-tone:voice',
        order: 920,
        text: PROMPT,
      })
      promptRegistered = true
    }
    sync()
    syncers.add(sync)
    ctx.effect(() => () => {
      syncers.delete(sync)
      promptRegistered = false
      if (dispose) dispose()
    }, 'dsh-fish-tone: 人味 prompt 那一节')
  })

  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'fish_tone',
      description: TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要掰的那段话。整段传进来，不要自己先切句。' },
          strength: {
            type: 'string',
            enum: ['off', 'light', 'normal', 'max'],
            description: '掰多少。不传就用设置页里定的那一档。',
          },
          seed: { type: 'number', description: '随机种子；同一个 seed 给同一个结果。不传用设置页里的。' },
          marks: {
            type: 'string',
            enum: ['off', 'light', 'normal', 'max'],
            description: '补微标记的量（「我也试过」的也、「好像挺麻烦」的好像）。不传用设置页里的。',
          },
          format: {
            type: 'string',
            enum: ['text', 'json'],
            description: 'text 直接给掰过的文字；json 额外给统计（含 uselessness 无用度）。',
          },
          protect: {
            type: 'boolean',
            description: '默认 true：跳过代码块、行内代码、URL、路径、表格、标题、列表。',
          },
        },
        required: ['text'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'text'],
          properties: {
            ok: { type: 'boolean' },
            text: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
      },
      execute: async (args) => {
        const src = String(args?.text ?? '')
        if (!src.trim()) return { ok: false, text: '没有收到文字（text 是空的）。' }
        const strength = LEVELS[args?.strength] ? args.strength : live.strength
        const seed = Number.isFinite(args?.seed) ? args.seed : live.seed
        const { text, stats } = applyTone(src, {
          strength,
          seed,
          protect: args?.protect !== false,
        })
        // 掰完再过一遍语病：扫掉大部分，按配额留几个
        // （语料：评论 1.39/千字 ≈ 每 700 字一个 → 不到 300 字一个不留，300 字以上每 800 字一个）
        let outText = text
        let grammar = null
        if (live.grammar && strength !== 'off') {
          const g = repair(text, { seed, inject: true })
          outText = g.text
          grammar = { found: g.found, fixed: g.fixed, kept: g.kept, injected: g.injected, budget: g.budget }
        }
        // 代码块、路径、行内代码整行不碰
        let fence = false
        const skipLine = (line) => {
          if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return true }
          if (fence) return true
          if (line.includes('`') || line.includes('http')) return true
          return isStructuralLine(line)
        }

        // 微标记：一个词换一种关系（「我试过」→「我也试过」／「挺麻烦」→「好像挺麻烦」）
        let micro = null
        const marksLevel = MARKS_LEVELS[args?.marks] ? args.marks : live.marks
        if (marksLevel && marksLevel !== 'off') {
          const r = insertMarks(outText, { level: marksLevel, seed, skip: skipLine })
          outText = r.text
          micro = { inserted: r.count, hits: r.hits, density: markDensity(outText) }
        }
        // 判断归判断，兜底归兜底：只有判成模板腔才动手压，
        // 平时一处两处的留给写的人自己判 —— 压出来的均匀本身也是机器味。
        const before = judgeAssess(outText)
        const st = before.band === 'template'
          ? thinStructures(outText, { skip: skipLine })
          : { text: outText, thinned: 0, over: [] }
        outText = st.text
        const structures = {
          thinned: st.thinned,
          over: st.over,
          judged: before.band,
          density: structureDensity(outText),
        }
        if (args?.format === 'json') {
          return { ok: true, text: JSON.stringify({ text: outText, stats, grammar, micro, structures }, null, 2) }
        }
        return { ok: true, text: outText }
      },
    })

    ctx.tools.register({
      name: 'fish_grammar',
      description: `查一段话的语病，或者把它修干净（不回话，只报清单）。

扫 18 条规则，按五个结构框架分组：
- 输入法手滑：同音字（做为/因该/即然）、状语「的/地」、补语「得」
- 手速重复：标点连打（。。/，，）、虚词连打（我我/这这）
- 语气加载：语气词叠用（吧吧）、副词重复（很很）
- 格式混用：中文里夹英文逗号句号
- 书面语病：通过…使… 缺主语、防止…不… 说反、一个…们、很多…们、
  原因是…造成的、本着…为原则、约…左右、涉及到、再次重申、非常太

代码块、行内代码、URL、路径、命令行参数不查。

- fix: false（默认）只报不改，给出每条语病的位置、类型、明显程度
- fix: true 全部修掉（keepRate 0），修不了的也会原样说明
- 明显的（major）和不明显的（minor）分开列

Use it when the user asks 校对/查语病/改病句，或者你想确认一句话有没有毛病。
闲聊里随手用 fish_tone 就行，它已经带语病层了。`,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要查的那段话。' },
          fix: { type: 'boolean', description: 'true = 顺手修干净；false（默认）= 只报清单。' },
          format: { type: 'string', enum: ['text', 'json'], description: 'text 默认給人看的清单；json 给结构化。' },
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
        const issues = scan(src)
        if (args?.fix === true) {
          const r = repair(src, { seed: live.seed, keepRate: 0, inject: false })
          const left = scan(r.text)
          if (args?.format === 'json') {
            return { ok: true, text: JSON.stringify({ text: r.text, fixed: r.fixed, found: r.found, remaining: left }, null, 2) }
          }
          const rest = left.length
            ? `\n还剩 ${left.length} 条修不动的（要重写句子）：` + left.map((h) => `\n  · ${h.note}：${h.text}`).join('')
            : '\n修干净了。'
          return { ok: true, text: r.text + rest }
        }
        if (args?.format === 'json') {
          return { ok: true, text: JSON.stringify({ issues, count: issues.length, budget: budgetFor(src.length) }, null, 2) }
        }
        if (issues.length === 0) return { ok: true, text: '没扫出语病。' }
        const major = issues.filter((h) => h.severity === 'major')
        const minor = issues.filter((h) => h.severity === 'minor')
        const fmt = (list) => list.map((h) => `\n  · [${h.severity === 'major' ? '明显' : '不明显'}] ${h.note}：${h.text || '（句末）'}`).join('')
        const stats = frameStats(issues)
        const frames = Object.entries(stats)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${FRAMES[k]?.name ?? k} ${n}`)
          .join(' · ')
        return {
          ok: true,
          text: `扫出 ${issues.length} 条语病（明显 ${major.length} / 不明显 ${minor.length}）`
            + (frames ? `\n按框架：${frames}` : '')
            + (major.length ? '\n明显的：' + fmt(major) : '')
            + (minor.length ? '\n不明显的：' + fmt(minor) : ''),
        }
      },
    })

    ctx.tools.register({
      name: 'fish_judge',
      description: JUDGE_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要判的那段话。整段传进来，别先删掉可疑的句子 —— 那正是要判的东西。' },
          format: {
            type: 'string',
            enum: ['text', 'json'],
            description: 'text 默认给判断清单；json 给结构化（含每处的 verdict：keep / ask / cut）。',
          },
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
        const v = judgeAssess(src)
        if (args?.format === 'json') {
          return { ok: true, text: JSON.stringify(v, null, 2) }
        }
        return { ok: true, text: judgeRender(v) }
      },
    })
  })

  // 判断机制挂在技能里：不是检查表，是写的时候就照着问的那套流程。
  root.inject(['skills'], (ctx) => {
    try {
      ctx.effect(() => ctx.skills.register({
        name: 'fish-sense',
        description: '写中文之前/之后判断一处句式该不该放：先看它在干什么，再看扎堆和密度，最后才决定删还是留。',
        whenToUse: '一段话里出现了「不是…而是」「最…的是」「先…再…」，或者连着用了几种句式、拿不准要不要留的时候。',
        content: SKILL_BODY,
        source: 'runtime',
        resourceBase: { kind: 'opaque', description: 'dsh-fish-tone 插件内置' },
      }), 'dsh-fish-tone: fish-sense 技能')
      logLine('已挂 fish-sense 技能')
    } catch (e) {
      logLine('挂 fish-sense 技能失败：' + (e?.message ?? String(e)))
    }
  })

  root.inject(['webServer'], (ctx) => {
    const handler = async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.replace(/^\/api\/fish-tone/, '') || '/'

      if (req.method === 'GET' && (path === '/' || path === '/status')) {
        return sendJson(res, 200, {
          ok: true,
          enabled: live.enabled,
          strength: live.strength,
          seed: live.seed,
          grammar: live.grammar,
          marks: live.marks,
          levels: Object.keys(LEVELS),
          promptRegistered,
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
        const strength = LEVELS[body?.strength] ? body.strength : live.strength
        const seed = Number.isFinite(body?.seed) ? body.seed : live.seed
        const { text, stats } = applyTone(src, { strength, seed })
        let outText = text
        let grammar = null
        if (live.grammar && strength !== 'off') {
          const g = repair(text, { seed, inject: true })
          outText = g.text
          grammar = { found: g.found, fixed: g.fixed, kept: g.kept, injected: g.injected, budget: g.budget }
        }
        return sendJson(res, 200, { ok: true, text: outText, stats, grammar, original: src })
      }

      return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
    }

    const server = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
    // headless / 测试里没有 webServer 是正常的，不写日志
    if (!server || typeof server.register !== 'function') return
    try {
      ctx.effect(() => server.register({
        kind: 'prefix',
        path: '/api/fish-tone',
        handler: (req, res) => {
          Promise.resolve(handler(req, res)).catch((e) => {
            try { sendJson(res, 500, { ok: false, error: e?.message ?? String(e) }) } catch { /* 已经走了 */ }
          })
        },
      }), 'dsh-fish-tone: /api/fish-tone')
      logLine('已挂 /api/fish-tone（设置页接口）')
    } catch (e) {
      logLine('挂 /api/fish-tone 失败：' + (e?.message ?? String(e)))
    }
  })
}
