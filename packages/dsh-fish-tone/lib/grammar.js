/**
 * dsh-fish-tone / 语病层
 *
 * 目标不是「零语病」——零语病听起来像说明书。目标是一个配额：
 *   · 扫掉大部分语病，留下一点点，让人知道这是条会打嗝的鱼，不是校对软件
 *   · 配额是拿 B 站真实语料量的（见 docs/corpus-report.md），不是拍脑袋
 *
 * 规则按「结构框架」分组 —— 语病不是一张平铺的病历，是几台不同的机器出的错：
 *   typo   输入法手滑：同音字上屏、补语助词混用
 *   speed  手速重复：连打两次、标点叠字
 *   tone   语气加载：语气词、副词堆叠
 *   format 格式混用：中英标点混排
 *   formal 书面语病：成分残缺、结构杂糅、成分赘余（学校教的那套）
 *
 * 语料实测（17019 条 / 23.9 万字）：formal 层几乎零命中，typo/speed/tone 层才是日常。
 * 所以 formal 规则的 severity 定得高（一眼就看出），typo/speed/tone 定得低（扫过去不停）。
 */

/* ───────────────────────── 结构框架 ───────────────────────── */

export const FRAMES = {
  typo: { name: '输入法手滑', desc: '同音字上屏、的地得混用' },
  speed: { name: '手速重复', desc: '同一个字/标点连打两次' },
  tone: { name: '语气加载', desc: '语气词、副词堆叠' },
  format: { name: '格式混用', desc: '中文里夹英文标点' },
  formal: { name: '书面语病', desc: '成分残缺、结构杂糅、成分赘余' },
}

/* ───────────────────────── 规则表 ───────────────────────── */

/** 同音字 → 正字。只收确定不会误伤的。 */
const HOMOPHONES = {
  做为: '作为',
  因该: '应该',
  即然: '既然',
  必竟: '毕竟',
  象这样: '像这样',
}

/** 同义反复 → 砍掉前面那个。 */
const REDUNDANT = {
  再次重申: '重申',
  重新再来: '再来',
  唯一仅有: '唯一',
  各自分别: '各自',
  互相彼此: '互相',
  彻底根除: '根除',
  多次反复: '多次',
  提前预支: '预支',
  过分溺爱: '溺爱',
}

const CN_PUNCT = { ',': '，', ';': '；', ':': '：', '.': '。' }

/**
 * 每条规则：pattern 全局正则，fix 给出替换。
 * severity: major = 一眼就看出来的；minor = 多数人扫过去不会停。
 */
const RULES = [
  /* ── typo：输入法手滑 ── */
  {
    id: 'typo-homophone',
    frame: 'typo',
    severity: 'minor',
    note: '同音字上屏',
    // 「以经济」「在次卧」这种正常词不能误伤，所以带前瞻
    pattern: /(做为|因该|即然|必竟|象这样)/g,
    fix: (_m, w) => HOMOPHONES[w] ?? w,
  },
  {
    id: 'de-di',
    frame: 'typo',
    severity: 'minor',
    note: '状语后面该用「地」',
    pattern: /(慢慢|认真|仔细|好好|安静|悄悄|努力|主动|开心|高兴|随便)的(?=[\u4e00-\u9fff])/g,
    fix: (_m, w) => `${w}地`,
  },
  {
    id: 'de-de',
    frame: 'typo',
    severity: 'minor',
    note: '补语前面该用「得」',
    pattern: /(跑|走|做|说|看|听|写|吃|睡|玩|笑|哭|长|变|飞|唱|讲|画|弄|搞|整|来|去)的(很|太|真|特别|好|快|慢|多|少)/g,
    fix: (_m, v, adv) => `${v}得${adv}`,
  },

  /* ── speed：手速重复 ── */
  {
    id: 'dup-adverb',
    frame: 'tone',
    severity: 'minor',
    note: '副词重复',
    pattern: /(很|非常|特别|挺|太|超级|十分)\1+/g,
    fix: (_m, p) => p,
  },

  {
    id: 'dup-punct',
    frame: 'speed',
    severity: 'major',
    note: '标点连打（。。/，，）',
    // 「！！」「？？」是表达，不是语病——语料里 ！！ 3.84/千字，。。 只有 0.44/千字
    pattern: /([，。；：])\1+/g,
    fix: (_m, p) => p,
  },
  {
    id: 'dup-func',
    frame: 'speed',
    severity: 'minor',
    note: '虚词/代词连打',
    runAware: true,
    // 只抓正好两次：三次以上多是有意的（「不不不」「我我我」是情绪，不是手滑）
    pattern: /(我|你|他|她|它|这|那|是|不|就|都|也|很|太|在|有|和|的|了)\1(?!\1)/g,
    fix: (_m, p) => p,
  },

  /* ── tone：语气加载 ── */
  {
    id: 'dup-particle',
    frame: 'tone',
    severity: 'minor',
    note: '语气词叠用',
    runAware: true,
    pattern: /([的吧啦嘛啊呀哦了呢诶欸])\1(?!\1)/g,
    fix: (_m, p) => p,
  },

  /* ── format：中英标点混排 ── */
  {
    id: 'mixed-punct',
    frame: 'format',
    severity: 'minor',
    note: '中文里夹了英文标点',
    // 三个点以上的省略号是标点，不是忘了切输入法
    pattern: /([\u4e00-\u9fff])([,;:]|\.(?!\.))/g,
    fix: (_m, ch, p) => `${ch}${CN_PUNCT[p] ?? p}`,
  },

  /* ── formal：成分残缺 / 结构杂糅 / 成分赘余 ── */
  {
    id: 'through-make',
    frame: 'formal',
    severity: 'major',
    note: '「通过…使…」缺主语',
    pattern: /(通过|经过|由于)([^，。]{2,18}?)使(得)?/g,
    // 砍掉介词，主语就回来了：「通过这次分析使我知道了」→「这次分析使我知道了」
    fix: (_m, _prep, mid, de) => `${mid}使${de ?? ''}`,
  },
  {
    id: 'double-negative',
    frame: 'formal',
    severity: 'major',
    note: '「防止…不…」把意思说反了',
    pattern: /(防止|避免|杜绝|切忌|以免|以防)([^，。！？的]{0,8}?)不(?!小心)(再|会|要|能)/g,
    fix: (_m, verb, mid, tail) => `${verb}${mid}${tail}`,
  },
  {
    id: 'measure-people',
    frame: 'formal',
    severity: 'major',
    note: '量词和「们」打架',
    pattern: /一(个|位|名)([^，。儿]{0,3}?)们/g,
    fix: (_m, _q, noun) => `这些${noun}`,
  },
  {
    id: 'measure-plural',
    frame: 'formal',
    severity: 'minor',
    note: '「很多/几个」已经表复数了，不用再加「们」',
    pattern: /(很多|好多|几个|数个|一群)([^，。]{0,4}?)们/g,
    fix: (_m, q, noun) => `${q}${noun}`,
  },
  {
    id: 'reason-blend',
    frame: 'formal',
    severity: 'major',
    note: '「原因是…造成的」句式杂糅',
    pattern: /(原因是|根源是|是因为)([^，。！？]{1,24}?)(造成的|所导致|引起的)/g,
    fix: (_m, head, mid) => `${head}${mid}`,
  },
  {
    id: 'blend-basis',
    frame: 'formal',
    severity: 'major',
    note: '「本着…为原则」句式杂糅',
    pattern: /(本着|根据|按照|基于)([^，。]{1,16}?)(为原则|为宗旨|为基础)/g,
    fix: (_m, _prep, mid, tail) => `以${mid}${tail}`,
  },
  {
    id: 'redundant-approx',
    frame: 'formal',
    severity: 'minor',
    note: '「约…左右」同义反复',
    pattern: /(大约|约|将近|差不多)([^，。]{0,8}?)(左右|上下)/g,
    fix: (_m, head, mid) => `${head}${mid}`,
  },
  {
    id: 'redundant-prep',
    frame: 'formal',
    severity: 'minor',
    note: '介词冗余（涉及到/来自于/付诸于）',
    pattern: /(涉及|来自|付诸|见诸|截至|诉诸|莅临)(于|到)/g,
    fix: (_m, verb) => verb,
  },
  {
    id: 'redundant-synonym',
    frame: 'formal',
    severity: 'minor',
    note: '同义堆叠（再次重申/彻底根除）',
    pattern: /(再次重申|重新再来|唯一仅有|各自分别|互相彼此|彻底根除|多次反复|提前预支|过分溺爱)/g,
    fix: (_m, w) => REDUNDANT[w] ?? w,
  },
  {
    id: 'degree-absolute',
    frame: 'formal',
    severity: 'minor',
    note: '程度副词撞上绝对词（非常太…）',
    pattern: /(非常|特别|十分|极其)太/g,
    fix: () => '太',
  },
]

export const RULE_LIST = RULES.map(({ id, frame, severity, note }) => ({ id, frame, severity, note }))

/* ───────────────────────── 保护区 ───────────────────────── */

/** 这些地方不查语病：代码、行内代码、URL、路径、命令行参数、表格与标题行。 */
const PROTECT_PATTERNS = [
  /```[\s\S]*?```/g,
  /~~~[\s\S]*?~~~/g,
  /`[^`\n]+`/g,
  /https?:\/\/[^\s)>\]]+/g,
  /(?:^|\s)(?:\.{0,2}\/|~\/)[\w./-]+/g,
  /--[a-z][\w-]*/g,
  /[ \t]*(?:#{1,6}[ \t]|\|)[^\n]*/g,
]

function protectedRanges(src) {
  const out = []
  for (const re of PROTECT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      if (m[0] === '') { re.lastIndex += 1; continue }
      out.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return out
}

/* ───────────────────────── 只查不改 ───────────────────────── */

/**
 * 扫一遍，按出现位置返回语病清单。
 * @param {string} text
 * @returns {Array<{rule:string, frame:string, severity:'minor'|'major', note:string, start:number, end:number, text:string, fixable:boolean}>}
 */
export function scan(text, opts = {}) {
  const src = String(text ?? '')
  const ranges = opts.protect === false ? [] : protectedRanges(src)
  const inRange = (a, b) => ranges.some((r) => a < r.end && b > r.start)
  const hits = []
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let m
    while ((m = rule.pattern.exec(src)) !== null) {
      if (m[0] === '') { rule.pattern.lastIndex += 1; continue }
      if (ranges.length && inRange(m.index, m.index + m[0].length)) continue
      // 长串（我我我我 / 不不不）是有意的情绪，只在正好两次、且前一个字不同时才算是手滑
      if (rule.runAware && m.index > 0 && src[m.index - 1] === m[0][0]) continue
      hits.push({
        rule: rule.id,
        frame: rule.frame,
        severity: rule.severity,
        note: rule.note,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        fix: rule.fix ? m.slice() : null,
        fixable: typeof rule.fix === 'function',
      })
    }
  }
  // 同一条规则可能重叠；按位置排好，重叠的只留前面那个
  hits.sort((a, b) => a.start - b.start || (a.severity === 'major' ? -1 : 1))
  const out = []
  let lastEnd = -1
  for (const h of hits) {
    if (h.start < lastEnd) continue
    out.push(h)
    lastEnd = Math.max(lastEnd, h.end)
  }
  return out
}

/** 每条框架各命中几次。 */
export function frameStats(hits) {
  const out = {}
  for (const k of Object.keys(FRAMES)) out[k] = 0
  for (const h of hits) out[h.frame] = (out[h.frame] ?? 0) + 1
  return out
}

/* ───────────────────────── 配额 ───────────────────────── */

/**
 * 这段文字允许留几个语病。数字不是拍脑袋来的，是拿 B 站评论区语料量的：
 * 17019 条真实语料（1416 条评论 + 15603 条弹幕，共 23.9 万字）里：
 *   书面语病（通过…使…/防止…不…/一个同学们/句式杂糅/同义堆叠）**全部零命中**
 *   手滑类：重复字 0.09/千字（虚词）、标点连打 0.44/千字、语气词叠用 0.49/千字
 *   → 真正能算语病的大约 **每千字 1.2 个，也就是每 800 字一个**。
 *
 * 所以：
 *   · 不到 300 字，一个都不留（真人写短评/发弹幕基本不犯书面语病）
 *   · 300 字以上，每 800 字留一个不明显的
 *   · 明显的语病，每 2000 字才允许留一个
 *
 * @param {number} chars 字数
 * @returns {{minor:number, major:number}}
 */
export function budgetFor(chars) {
  const n = Math.max(0, Math.floor(chars))
  return {
    minor: n >= 300 ? Math.max(1, Math.floor(n / 800)) : 0,
    major: Math.floor(n / 2000),
  }
}

/** 有多少个句子（按句末标点切）。 */
export function countSentences(text) {
  const parts = String(text ?? '').split(/[。！？…]+/).filter((s) => s.trim().length > 0)
  return Math.max(1, parts.length)
}

/* ───────────────────────── 修 + 留 ───────────────────────── */

function applyFix(src, hit) {
  if (!hit.fix) return src
  const [match, ...groups] = hit.fix
  const rule = RULES.find((r) => r.id === hit.rule)
  if (!rule || typeof rule.fix !== 'function') return src
  const replacement = rule.fix(match, ...groups)
  return src.slice(0, hit.start) + replacement + src.slice(hit.end)
}

/** 句子索引：这个位置落在第几句（用来保证 6~8/10 的干净率）。 */
function sentenceIndexOf(text, pos) {
  let n = 0
  for (let i = 0; i < pos && i < text.length; i++) {
    if ('。！？…'.includes(text[i])) n += 1
  }
  return n
}

/**
 * 扫掉大部分语病，按配额留几个。
 *
 * @param {string} text
 * @param {{seed?:number, keepRate?:number, inject?:boolean}} [opts]
 *   keepRate 想留几成（默认 0.1，再被 budgetFor 的配额卡住）；inject 允许在正文干净时补一点小毛病
 * @returns {{text:string, found:number, fixed:number, kept:Array, injected:number, budget:object, frames:object}}
 */
export function repair(text, opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : 7
  const keepRate = Number.isFinite(opts.keepRate) ? opts.keepRate : 0.1
  const inject = opts.inject === true
  const rng = mulberry32(seed ^ 0x5f3759df)

  let src = String(text ?? '')
  const ranges = opts.protect === false ? [] : protectedRanges(src)
  const found = scan(src, { protect: opts.protect })
  const budget = budgetFor(src.length)
  const sentences = countSentences(src)
  const maxDirtySentences = Math.max(1, Math.floor(sentences * 0.4)) // 最多 40% 的句子带病

  // 先摇：哪些语病「留」，哪些「修」。明显的默认更容易被修掉。
  const wanted = []
  for (const hit of found) {
    const keepProb = hit.severity === 'major' ? keepRate * 0.4 : keepRate
    if (rng() < keepProb) wanted.push(hit)
  }

  // 再按配额筛选：不明显的优先留，明显的尽量修
  wanted.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'minor' ? -1 : 1))
  const kept = []
  const dirtySentences = new Set()
  let keptMinor = 0
  let keptMajor = 0
  for (const hit of wanted) {
    const sIdx = sentenceIndexOf(src, hit.start)
    if (hit.severity === 'major') {
      if (keptMajor >= budget.major) continue
      keptMajor += 1
    } else {
      if (keptMinor >= budget.minor) continue
      keptMinor += 1
    }
    // 同一条句子最多带两个毛病：再多就不是「偶尔」，是没写完
    const inSentence = kept.filter((k) => sentenceIndexOf(src, k.start) === sIdx).length
    if (inSentence >= 2) continue
    if (!dirtySentences.has(sIdx) && dirtySentences.size >= maxDirtySentences) continue
    dirtySentences.add(sIdx)
    kept.push(hit)
  }

  // 从后往前修，位置才不会被前面的替换带偏
  const keptKeys = new Set(kept.map((k) => `${k.start}:${k.end}`))
  let fixed = 0
  for (let i = found.length - 1; i >= 0; i--) {
    const hit = found[i]
    if (keptKeys.has(`${hit.start}:${hit.end}`)) continue
    const before = src
    src = applyFix(src, hit)
    if (src !== before) fixed += 1
  }

  // 配额没被「留下的语病」占满 —— 补几个像手滑的小毛病，免得像校对过的稿子。
  // 补的种类来自语料里真实出现过的三类（语气词叠用 / 虚词连打 / 句号连打）。
  let injected = 0
  if (inject && budget.minor > 0) {
    const want = Math.min(3, Math.max(0, budget.minor - kept.length))
    if (want > 0) {
      const done = injectSlips(src, rng, want, ranges)
      src = done.text
      injected = done.count
    }
  }

  return {
    text: src,
    found: found.length,
    fixed,
    kept: kept.map((k) => ({ rule: k.rule, frame: k.frame, severity: k.severity, note: k.note, text: k.text })),
    injected,
    budget,
    frames: frameStats(found),
  }
}

/**
 * 补几个最小、最像手滑的毛病。三类，和语料对得上：
 *   语气词叠用（吧吧/啊啊） — 语料 0.60/千字
 *   虚词连打（我我/这这）  — 语料 0.12/千字
 *   句号连打（。。）    — 语料 0.73/千字，但太扎眼，权重压低
 */
function injectSlips(text, rng, count, ranges) {
  const usable = (at) => at > 6 && !ranges.some((r) => at >= r.start && at < r.end)
  const cands = []
  const add = (re, kind, weight) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex += 1; continue }
      const at = m.index + (m[0].length - m[1].length)
      if (!usable(at)) continue
      cands.push({ at, ch: m[1], kind, weight })
    }
  }
  add(/([我你他她这那])(?=[\u4e00-\u9fff])/g, 'dup-func', 2)
  add(/([的吧啦嘛啊呀哦了呢诶欸])(?=[，。！？…\s]|$)/g, 'dup-particle', 3)
  add(/(。)(?=\n|$)/gm, 'dup-punct', 1)
  if (cands.length === 0) return { text, count: 0 }

  // 按权重抽，抽过的位置挪开至少 40 字，免得一句里挤两个
  const pool = cands.slice()
  const picked = []
  while (picked.length < count && pool.length) {
    const totalWeight = pool.reduce((a, c) => a + c.weight, 0)
    let r = rng() * totalWeight
    let idx = 0
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight
      if (r <= 0) break
    }
    idx = Math.min(idx, pool.length - 1)
    const pick = pool.splice(idx, 1)[0]
    if (picked.some((p) => Math.abs(p.at - pick.at) < 40)) continue
    picked.push(pick)
  }
  if (picked.length === 0) return { text, count: 0 }

  let out = text
  for (const p of picked.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, p.at) + p.ch + out.slice(p.at)
  }
  return { text: out, count: picked.length }
}

/* ───────────────────── 确定性随机（和主模块同款） ───────────────────── */

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
