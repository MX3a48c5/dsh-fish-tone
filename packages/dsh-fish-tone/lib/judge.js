/**
 * 判断层：不问「有几个」，问「这一处该不该有」。
 *
 * 配额是治标的。它只看总数，看不见「一段里连换三种句式」，而那才是 AI 味的真身：
 * 真人会重复自己的习惯（同一种句式来两次），AI 会轮换工具箱（一段里三种各一次）。
 *
 * 语料实测（10 万条真人评论 + 2180 条 AI 评论，同一个 100 字窗口）：
 *   窗口里出现 ≥2 种不同句式 —— 真人长篇 5.6%，AI 19.6%（3.5 倍）
 *   窗口里出现 ≥2 个（同种也算）—— 真人 10.1%，AI 21.2%（2.1 倍）
 * 也就是说：扎堆出现在**不同种**上，才是 AI 的指纹。
 *
 * 所以这层不替你决定。它给三样东西：文体基线、每一处命中的处境、要你自己答的问题。
 *
 * @module judge
 */

import { FRAMES } from './structures.js'
import { markDensity } from './marks.js'

/* ───────────────────────── 文体与基线 ───────────────────────── */

/**
 * 文体基线（句式总数 / 千字），来自 10 万条真人评论按长度与信号的实测：
 *   0-20 字 0.78 · 20-50 字 1.27 · 50-100 字 1.84 · 100-150 字 1.94
 *   150-300 字 2.39 · 300-600 字 2.18 · 600 字以上 1.98
 * 真人写长了反而更省，因为长文自己有结构；这里按文体给到 0.8～2.6 的带。
 */
export const REGISTERS = {
  chat: { label: '闲聊', per1k: 0.8, hint: '短、口语；这种长度里框架基本是凭空多出来的' },
  note: { label: '随手记', per1k: 1.3, hint: '不长的一段话，一两个框架就到顶了' },
  explain: { label: '解释', per1k: 2.0, hint: '在说明一件事；框架有活可干，但也不是越多越好' },
  argue: { label: '论证', per1k: 2.4, hint: '在跟某个说法较劲；对比和纠正本来就需要框架' },
  steps: { label: '步骤', per1k: 2.6, hint: '在排动作；先…再…在这里是真干活' },
}

/**
 * 猜这段是什么文体。规则很土，但每条都能说清为什么。
 * @param {string} text
 * @returns {keyof REGISTERS}
 */
export function registerOf(text) {
  const s = String(text ?? '')
  const n = s.length
  const count = (re) => (s.match(re) || []).length

  const casual = count(/哈哈|笑死|草|emmm|嗯嗯|诶|啊这|233|awsl|好耶/gu) +
    count(/\p{Extended_Pictographic}/gu) + count(/[（(][^)）]{0,6}[)）]/g)
  const steps = count(/然后|接着|第一步|第二步|之后|再是|最后|先是/g)
  const argue = count(/但是|可是|其实|问题是|然而|不过|反而|恰恰|我觉得|我认为|说句|不是这样/g)
  const explain = count(/因为|所以|也就是说|相当于|意思是|本质上|原因|意味着|换句话说/g)

  if (casual >= 2) return 'chat'
  if (steps >= 3) return 'steps'   // 短的排动作也算步骤，不能因为短就归成闲聊
  if (n < 40) return 'chat'
  if (argue >= 2) return 'argue'
  if (explain >= 2) return 'explain'
  if (n < 150) return 'note'
  return 'explain'
}

/* ───────────────────────── 命中 ───────────────────────── */

/**
 * 找出所有命中，带位置。
 * @param {string} text
 * @returns {{id: string, name: string, tier: string, at: number, span: string}[]}
 */
export function hits(text) {
  const src = String(text ?? '')
  const out = []
  for (const f of FRAMES) {
    const re = new RegExp(f.re.source, f.re.flags.includes('g') ? f.re.flags : f.re.flags + 'g')
    for (const m of src.matchAll(re)) {
      out.push({ id: f.id, name: f.name, tier: f.tier, at: m.index ?? 0, span: m[0] })
      if (!m[0]) re.lastIndex += 1
    }
  }
  out.sort((a, b) => a.at - b.at)

  // 同一截字不要被两个句式各算一次（「最值得的是」同时像 最…的是 和 X的是Y）。
  // 留更具体的那个：strict 优先，其次更长的 span。
  const rank = (h) => (h.tier === 'strict' ? 2 : 1) * 100 + h.span.length
  const kept = []
  for (const h of out) {
    const end = h.at + h.span.length
    const hit = kept.find((k) => h.at < k.at + k.span.length && k.at < end)
    if (!hit) { kept.push(h); continue }
    if (rank(h) > rank(hit)) kept[kept.indexOf(hit)] = h
  }
  return kept.sort((a, b) => a.at - b.at)
}

/** 滑窗里最多有几个命中、最多种句式。窗口从每个命中的位置起算（这样取到的就是极大值）。 */
export function cluster(hs, width = 100) {
  let maxHits = 0
  let maxDistinct = 0
  let at = -1
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i].at
    const win = hs.filter((h) => h.at >= a && h.at < a + width)
    if (win.length > maxHits) { maxHits = win.length; at = a }
    const d = new Set(win.map((h) => h.id)).size
    if (d > maxDistinct) { maxDistinct = d; at = a }
  }
  return { width, maxHits, maxDistinct, at }
}

/* ───────────────────────── 必要性 ───────────────────────── */

const SENT_END = /[。！？!?\n]/

/** 命中所在的那一句。 */
export function sentenceAt(text, at) {
  const src = String(text ?? '')
  let s = at
  while (s > 0 && !SENT_END.test(src[s - 1])) s--
  let e = at
  while (e < src.length && !SENT_END.test(src[e])) e++
  return src.slice(s, Math.min(src.length, e + 1)).trim()
}

/** 命中之前 n 个字（判断「前文有没有种下那个误会 / 那个候选集」）。 */
function before(text, at, n = 80) {
  return String(text ?? '').slice(Math.max(0, at - n), at)
}

/**
 * 两串字的重复度，0～1。
 * 取两种算法的较大值：字级包含率（管「慢」⊂「慢吞吞的」这种短串）和二字组包含率（管长串）。
 */
export function overlap(a, b) {
  const x = String(a ?? '').replace(/[\s，。！？、]/gu, '')
  const y = String(b ?? '').replace(/[\s，。！？、]/gu, '')
  if (!x || !y) return 0
  const cont = (setA, setB) => {
    if (!setA.size) return 0
    let n = 0
    for (const g of setA) if (setB.has(g)) n += 1
    return n / setA.size
  }
  const cx = new Set([...x])
  const cy = new Set([...y])
  const chars = Math.max(cont(cx, cy), cont(cy, cx))
  const grams = (s) => {
    const out = new Set()
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
    return out
  }
  const bigrams = x.length < 2 || y.length < 2 ? 0 : Math.max(cont(grams(x), grams(y)), cont(grams(y), grams(x)))
  return Math.max(chars, bigrams)
}

/** 「有人这么想过」的标记 —— 有它，纠正才不是自造的。 */
const MISCONCEPTION = /(以为|觉得|听说|很多人|别人说|常说|有人|都说|看上去|看起来|好像|不少人|总有人|认为|被当成|被说成)/

/**
 * 这一处的必要性。
 * 只给三种结论：keep（有活干）/ ask（看不出来，要写的人答一句）/ cut（大概率是摆设）。
 * @returns {{verdict: 'keep'|'ask'|'cut', why: string, ask?: string}|null}
 */
export function necessity(hit, text, reg) {
  const src = String(text ?? '')
  const prev = before(src, hit.at)

  switch (hit.id) {
    case 'not-but': {
      const tail = src.slice(hit.at, hit.at + 60)
      const m = /不是([^，。！？]{1,24}?)(?:，\s*)?(?:这|那|它|就)?(?:是|而是)([^，。！？]{1,24})/.exec(tail)
      if (!m) return { verdict: 'ask', why: '看不成对的两半', ask: '这个「不是」否定的是谁的说法？' }
      const x = m[1].trim()
      const y = m[2].trim()
      if (overlap(x, y) > 0.55) {
        return { verdict: 'cut', why: `「${y}」只是把「${x}」换个说法，不是真的对立`, ask: `「${y}」和「${x}」是两件事吗？` }
      }
      if (MISCONCEPTION.test(prev)) {
        return { verdict: 'keep', why: '前面确实种下了一个可能被误解的说法，这个对比有活干' }
      }
      return { verdict: 'ask', why: '前面没有人这么想过，这个对立是自造的', ask: '前半句否定的是真有人持有的看法吗？说得出是谁吗？' }
    }

    case 'most-de': {
      const near = src.slice(Math.max(0, hit.at - 120), hit.at)
      const items = (near.match(/[、，]|和|跟|或|还有|一是|二是|第一|第二/g) || []).length
      if (items >= 2) return { verdict: 'keep', why: '前面列过几个候选，这个「最」是比出来的' }
      return { verdict: 'ask', why: '前面没有候选集，「最」没有可比的东西', ask: '跟什么比出来的「最」？比的东西在文中出现过吗？' }
    }

    case 'first-then': {
      if (reg === 'steps') return { verdict: 'keep', why: '这段在排动作，先后是真的' }
      if (src.length < 150) return { verdict: 'cut', why: '这么短的文里，「先…再…」多半只是顺口', ask: '这两步真的分先后吗？' }
      return { verdict: 'ask', why: '看不出这两步有没有硬先后', ask: '把「先」和「再」调过来，意思会变吗？不会变就是多余的' }
    }

    case 'emdash': {
      const after = src.slice(hit.at + hit.span.length, hit.at + hit.span.length + 40)
      if (/^(因为|就是|也就是|意思是|指的是|说白了|相当于)/.test(after.trim())) {
        return { verdict: 'keep', why: '破折号后面是真的解释' }
      }
      if (src.length < 120) return { verdict: 'cut', why: '短话里的破折号基本都是换气', ask: '换成逗号，意思会丢吗？' }
      return { verdict: 'ask', why: '破折号后面不是解释性内容', ask: '这里是需要一个停顿，还是只是想让句子显得重一点？' }
    }

    case 'roadmap': {
      const total = (src.match(/首先|其次|综上所述|总而言之/g) || []).length
      if (src.length < 300) return { verdict: 'cut', why: '不到 300 字的文不需要目录', ask: '这段真的分了好几层吗？' }
      if (total >= 3) return { verdict: 'ask', why: '短文里排了一整套目录', ask: '这三层各自解决的是不同的问题吗？' }
      return null
    }

    case 'triple': {
      const parts = hit.span.split('、')
      if (parts.every((p) => p.length <= 2)) {
        return { verdict: 'ask', why: '三个都是短抽象词，像凑数', ask: '这三样真的同一层级的并列吗？' }
      }
      return null
    }

    default:
      return null
  }
}

/* ───────────────────────── 总判 ───────────────────────── */

const BANDS = {
  clean: { label: '像人', tone: '这个密度和扎堆程度都在真人范围里。' },
  slight: { label: '略重', tone: '稍微多了一点，还不刺眼。' },
  heavy: { label: '重', tone: '已经能看出来了，读的人会觉得这人在端着。' },
  template: { label: '模板腔', tone: '这段不是写出来的，是套出来的。' },
}

/**
 * 判一整段。
 * @param {string} text
 * @param {{skipped?: boolean}} [opts]
 */
export function assess(text) {
  const src = String(text ?? '')
  const chars = src.length
  const reg = registerOf(src)
  const base = REGISTERS[reg]
  const hs = hits(src)
  const cl = cluster(hs)

  // 短文本的比率没有统计意义（30 字里出现 1 个 = 33/千字），按 120 字起算
  const denom = Math.max(chars, 120)
  const per1k = +((hs.length / denom) * 1000).toFixed(1)
  const ratio = +(per1k / base.per1k).toFixed(1)
  // 这段长度下，真人大概写几个。比「倍数」好懂，也是判档的主要依据。
  const expected = +((base.per1k * denom) / 1000).toFixed(2)
  const over = +(hs.length - expected).toFixed(2)

  // 阈值不是拍的，是从 10 万条真人评论的分布上取的：
  //   ratio 的 p95 是 6.4 倍（真人也会撞上），所以只看倍数会误伤 17%；
  //   「窗口里 ≥2 种不同句式」才是干净的分界：真人 2.2%，AI 29.6%；
  //   ≥3 种：真人 0.4%，AI 7.4%。
  // 短文本另算：几十个字里出现一个框架，按绝对超出量看是看不出来的（真人这段本来就 0 个），
  // 但它确实是众数之外的东西。
  const short = chars < 150
  let band
  if (hs.length === 0) band = 'clean'
  else if (cl.maxDistinct >= 3) band = 'template'
  else if (cl.maxDistinct >= 2) band = 'heavy'
  else if (over >= 3) band = 'heavy'
  else if (short && hs.length >= 2) band = 'heavy'
  else if (over >= 1.5) band = 'slight'
  else if (short && hs.length >= 1) band = 'slight'
  else band = 'clean'

  const rows = hs.map((h) => {
    const v = necessity(h, src, reg)
    return {
      ...h,
      sentence: sentenceAt(src, h.at),
      verdict: v?.verdict ?? 'count',
      why: v?.why ?? '',
      ask: v?.ask ?? '',
    }
  })

  const questions = []
  for (const r of rows) {
    if (r.ask && questions.length < 3) questions.push(r.ask)
  }
  if (cl.maxDistinct >= 2) {
    questions.unshift(
      `最挤的那 ${cl.width} 字里挤了 ${cl.maxDistinct} 种不同句式 —— 它们是不是在解决同一件事？如果是，留一处就够。`,
    )
  }

  return {
    band,
    bandLabel: BANDS[band].label,
    bandTone: BANDS[band].tone,
    register: reg,
    registerLabel: base.label,
    baseline: base.per1k,
    chars,
    per1k,
    ratio,
    expected,
    over,
    cluster: cl,
    hits: rows,
    marks: markDensity(src),
    questions: questions.slice(0, 3),
    blind: '这一步只认句式。换个说法把同一句再说一遍、每段都收个小结论、语气齐得不像人 —— 这些它看不见，得你自己读一遍。',
  }
}

/** 把判断结果摊成人能看的一段话。给模型看的，所以先结论、再依据、最后是问题。 */
export function render(v) {
  if (!v) return ''
  const L = []
  L.push(`[判断] ${v.bandLabel} —— ${v.bandTone}`)
  L.push(`[文体] ${v.registerLabel} · 真人同文体基线 ${v.baseline}/千字`)
  L.push(`[个数] 这段长度，真人大概写 ${v.expected} 个；你写了 ${v.hits.length} 个（${v.per1k}/千字，${v.ratio} 倍）`)
  if (v.cluster.maxDistinct >= 2) {
    L.push(`[扎堆] 最挤的 ${v.cluster.width} 字里有 ${v.cluster.maxDistinct} 种不同句式 —— 这比总数更说明问题`)
  } else {
    L.push('[扎堆] 没有段落内的句式轮换')
  }

  if (v.hits.length) {
    L.push('[逐处]')
    const NAME = { keep: '可以留', ask: '要你判', cut: '建议删', count: '只计数' }
    for (let i = 0; i < v.hits.length; i++) {
      const h = v.hits[i]
      L.push(`  ${i + 1}. 「${h.span}」 ${h.name} → ${NAME[h.verdict]}${h.why ? `：${h.why}` : ''}`)
    }
  }

  if (v.marks) {
    const m = v.marks
    L.push(`[微标记] 关系类（也/还/反正）${m.relate}/千字，留白类（好像/应该/感觉）${m.hedge}/千字 —— 真人后一类约 2/千字，一个都没有就是句句在下断言`)
  }
  if (v.questions.length) {
    L.push('[要你自己答]')
    for (const q of v.questions) L.push(`  - ${q}`)
  }
  L.push('[不动] 比喻、设问、句长参差、被动句、名词化、正文里的「首先/其次」—— 这几样实测人类用得不比 AI 少，一律不改')
  if (v.blind) L.push(`[看不见] ${v.blind}`)
  return L.join('\n')
}
