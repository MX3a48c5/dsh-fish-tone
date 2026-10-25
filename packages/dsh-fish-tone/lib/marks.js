/**
 * 微标记：一个词换一种关系。
 *
 * 「往里面塞错别字那段我试过」→「…我也试过」。只多一个「也」，句子就从陈述变成了搭话 ——
 * 因为它把「你」拉进来了，读者会自动接一句「我也是」。
 *
 * 这类词的共同点：不增加信息，只增加关系或留白。AI 说话是把事情说完就停，人不这样，
 * 人说话的时候一直有个人在听。
 *
 * 数字是 10 万条 B 站评论量的（每条 / 千字）：
 *   也 3.40 / 还 3.37 / 就 5.22 —— 这几个真人和 AI 用得差不多，差别不在多少
 *   好像 0.25 vs 0.09 / 应该 0.41 vs 0.08 / 感觉 0.70 vs 0.24 / 可能 0.53 vs 0.17
 *   —— 这几个 AI 明显欠用：它不猜。
 *
 * 所以「也」那一类要改的是**位置**，「好像」那一类要改的是**多少**。
 *
 * @module marks
 */

/** 微标记表。human / ai 是每千字出现次数，实测值。 */
export const MARKS = [
  { ch: '也', kind: 'relate', human: 3.4, ai: 2.87, why: '把对方拉进来：你也是' },
  { ch: '还', kind: 'relate', human: 3.37, ai: 3.22, why: '在已有的基础上再添一层' },
  { ch: '反正', kind: 'relate', human: 0.06, ai: 0.02, why: '不打算解释了，收口' },
  { ch: '好像', kind: 'hedge', human: 0.25, ai: 0.09, why: '不确定就说不确定' },
  { ch: '应该', kind: 'hedge', human: 0.41, ai: 0.08, why: '推断，不是断言' },
  { ch: '感觉', kind: 'hedge', human: 0.7, ai: 0.24, why: '标出这是感受不是结论' },
  { ch: '可能', kind: 'hedge', human: 0.53, ai: 0.17, why: '留个口子' },
  { ch: '估计', kind: 'hedge', human: 0.07, ai: 0.03, why: '猜，并且承认是猜' },
  // 加强组：人夸张，AI 校准。这几个真人用得比 AI 多一个量级。
  { ch: '根本', kind: 'intensify', human: 0.15, ai: 0.03, why: '「根本不识字」—— 把描述改成吐槽' },
  { ch: '全都', kind: 'intensify', human: 0.04, ai: 0.0, why: '范围说满' },
  { ch: '简直', kind: 'intensify', human: 0.07, ai: 0.01, why: '夸张一步' },
  { ch: '特别', kind: 'intensify', human: 0.17, ai: 0.02, why: '程度往上抬一格' },
  { ch: '贼', kind: 'intensify', human: 0.07, ai: 0.0, why: '口语的极端程度' },
  { ch: '巨', kind: 'intensify', human: 0.09, ai: 0.0, why: '同上，更年轻' },
  { ch: '竟然', kind: 'intensify', human: 0.07, ai: 0.01, why: '反预期' },
  { ch: '到底', kind: 'intensify', human: 0.14, ai: 0.02, why: '问句里的追问' },
  { ch: '明明', kind: 'intensify', human: 0.08, ai: 0.02, why: '先摆事实再反驳' },
]

const MB = new Map(MARKS.map((m) => [m.ch, m]))

/** 补「好像」时，句子里已经有留白标记就不再补。 */
const OCCUPIED = /好像|估计|感觉|可能|大概|应该/
/** 紧跟在人称后面的这几个字 —— 有了就别再插，插了会变成「我也还试过」。 */
const TAKEN = /[也还就才都又倒]/
/**
 * 分句。空格也算断点 —— 真人打字用空格断句，不认识标点。
 * 保留分隔符，方便原样拼回去。
 */
function clauses(text) {
  const out = []
  const re = /([^，。！？；\n\s]+)([，。！？；\n\s]?)/g
  for (const m of String(text ?? '').matchAll(re)) out.push({ body: m[1], sep: m[2] })
  return out
}

/// 第一二人称后面紧跟这些动作时，补「也 / 还」不会变意思
const VERB_HEAD = /^(试|用|写|看|觉得|以为|发现|跑|玩|弄|改|删|装|做|算|说|想|买|学|读|翻|遇到|踩|卡)/
/// 评价副词前面补「好像」最轻（挺麻烦 → 好像挺麻烦）
const HEDGE_HEAD = /(挺|有点|很|太)/
/// 已经带了加强词就不再加
const INTENSIFIED = /(根本|全都|简直|特别|贼|巨|非常|十分|极其)/
/// 「不」后面这些是连词/习惯搭配，补「根本」会变成病句
const NOT_PLAIN = /不(是|但|过|管|仅|同|少|断|久|光|如|乏|及|去|要|好)/
/// 「不」前面紧跟这些字，说明它是词内成分（分不清 / 说不上 / 差不多），不能往里插
const VERB_BEFORE = /[分说看听数受弄搞用做想觉拿找算变长来去动忙够值爱恨怕差像要敢能会]$/
/// 「全」后面这些是名词，不能补「都」
const QUAN_NOUN = /全(部|国|球|文|班|体|新|程|家|员|局|网|校|年|天|月)/
/// 全 + 这些动词 → 全都 + 动词
const QUAN_VERB = /全(?=[删改看用给扔换清跑丢忘写说吃拿做整是有在没])/
/// 光秃秃的评价形容词（前面没有程度词）
const BARE_ADJ = /(麻烦|别扭|怪|离谱|干|尴尬|抽象|蠢|傻|难|累|慢|快|贵|香|硬|假|好看|好听|好玩|好用)/
/// 前面紧挨着程度词就不补
const HAS_DEGREE = /(挺|很|太|特别|贼|巨|非常|十分|极其|有点|有些|最|更|这么|那么)$/
/// 能补「稍微」的动词
const SLIGHT_HEAD = /(改|动|调|等|慢|快|轻|早|晚|多|少|长|短)/

/**
 * 数一遍微标记。
 * @param {string} text
 * @returns {{ch: string, kind: string, count: number}[]}
 */
export function scanMarks(text) {
  const src = String(text ?? '')
  const out = []
  for (const m of MARKS) {
    const n = [...src.matchAll(new RegExp(m.ch, 'g'))].length
    if (n) out.push({ ch: m.ch, kind: m.kind, count: n })
  }
  return out
}

/** 每千字的微标记密度，关系类和留白类分开算。 */
export function markDensity(text) {
  const src = String(text ?? '')
  const chars = Math.max(1, src.length)
  let relate = 0
  let hedge = 0
  let intensify = 0
  for (const row of scanMarks(src)) {
    if (row.kind === 'relate') relate += row.count
    else if (row.kind === 'intensify') intensify += row.count
    else hedge += row.count
  }
  return {
    chars,
    relate: +((relate / chars) * 1000).toFixed(2),
    hedge: +((hedge / chars) * 1000).toFixed(2),
    intensify: +((intensify / chars) * 1000).toFixed(2),
    // 真人：关系约 5/千字，留白约 2/千字，加强约 0.9/千字
    relateLine: 6.8,
    hedgeline: 2.0,
    intensifyLine: 0.9,
  }
}

const LEVELS = { off: 0, light: 0.3, normal: 0.55, max: 0.85 }

/** 简单可复现的随机数（跟主插件同算法，别改）。 */
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

/**
 * 往句子里补微标记。只补三种，都挑语法上不会塌的位置：
 *   也 / 还 —— 第一二人称后面紧跟动词时（「我试过」→「我也试过」）
 *   好像 —— 谓语头（「挺麻烦」→「好像挺麻烦」）
 *
 * @param {string} text
 * @param {{level?: 'off'|'light'|'normal'|'max', seed?: number, skip?: (line: string) => boolean}} [opts]
 */
export function insertMarks(text, opts = {}) {
  const src = String(text ?? '')
  const rate = LEVELS[opts.level ?? 'light'] ?? 0
  const rng = mulberry32((Number.isFinite(opts.seed) ? opts.seed : 7) ^ 0x5f356495)
  const skip = opts.skip
  const lines = src.split('\n')
  const hits = []

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (skip?.(line)) continue
    let rebuilt = ''
    for (const c of clauses(line)) {
      let body = c.body
      if (body.length >= 4 && rng() < rate) {
        // 一、第一二人称 + 动作 → 补「也 / 还」：「我试过」→「我也试过」
        const pron = /(我|你|咱|俺)(们)?(?=(?:试|用|写|看|觉得|以为|发现|跑|玩|弄|改|删|装|做|算|说|想|买|学|读|翻|遇到|踩|卡))/.exec(body)
        if (pron) {
          const at = pron.index + pron[0].length
          const word = rng() < 0.8 ? '也' : '还'
          if (TAKEN.test(body[at] ?? '')) { rebuilt += body + c.sep; continue }
          body = body.slice(0, at) + word + body.slice(at)
          hits.push({ ch: word, body: body.slice(0, 20) })
          rebuilt += body + c.sep
          continue
        }
        // 二、评价副词前面 → 补「好像」：「挺麻烦」→「好像挺麻烦」
        const h = HEDGE_HEAD.exec(body)
        if (h && h.index > 0 && !OCCUPIED.test(body)) {
          body = body.slice(0, h.index) + '好像' + body.slice(h.index)
          hits.push({ ch: '好像', body: body.slice(0, 20) })
          rebuilt += body + c.sep
          continue
        }
        // 三、加强语气。人一激动就往下加词，AI 从头到尾都是同一个音量。
        if (!INTENSIFIED.test(body)) {
          // 根本不 X ——「像个不识字的人」→「像个根本不识字的人」
          const neg = /不/.exec(body)
          // A不A（像不像）和词内的「不」（分不清）都不能插
          const dup = neg && body[neg.index + 1] === body[neg.index - 1]
          const inWord = neg && (VERB_BEFORE.test(body.slice(0, neg.index)) || body.slice(neg.index + 1, neg.index + 2) === '了')
          if (neg && !dup && !inWord && !NOT_PLAIN.test(body.slice(neg.index, neg.index + 2)) && body.length >= 6) {
            const word = rng() < 0.75 ? '根本' : '压根'
            // 「都/也/还/就」在「不」前面时要插到它前面：「都根本不敢」是病句，「根本都不敢」才对
            let at = neg.index
            while (at > 0 && /[都也还就才又]/.test(body[at - 1])) at -= 1
            body = body.slice(0, at) + word + body.slice(at)
            hits.push({ ch: word, body: body.slice(0, 20) })
            rebuilt += body + c.sep
            continue
          }
          // 全 X → 全都 X ——「东西后来全删了」→「…全都删了」
          const quan = QUAN_VERB.exec(body)
          if (quan && !QUAN_NOUN.test(body.slice(quan.index, quan.index + 2))) {
            body = body.slice(0, quan.index + 1) + '都' + body.slice(quan.index + 1)
            hits.push({ ch: '全都', body: body.slice(0, 20) })
            rebuilt += body + c.sep
            continue
          }
          // 像 → 简直像
          const xiang = /(?<!不)像(?=[\u4e00-\u9fff])(?!不)/.exec(body)
          if (xiang && xiang.index > 0) {
            body = body.slice(0, xiang.index) + '简直' + body.slice(xiang.index)
            hits.push({ ch: '简直', body: body.slice(0, 20) })
            rebuilt += body + c.sep
            continue
          }
          // 很/非常 → 特别 / 贼 / 巨
          const deg = /(很|非常)/.exec(body)
          if (deg && deg.index > 0) {
            let word = ['特别', '贼', '巨'][Math.floor(rng() * 3)]
            if (word === '巨' && body.length < 10) word = '特别'
            body = body.slice(0, deg.index) + word + body.slice(deg.index + deg[0].length)
            hits.push({ ch: word, body: body.slice(0, 20) })
            rebuilt += body + c.sep
            continue
          }
          // 光秃秃的形容词前面垫一个程度词 ——「读起来别扭」→「读起来特别别扭」
          const adj = BARE_ADJ.exec(body)
          if (adj && adj.index > 0 && !HAS_DEGREE.test(body.slice(0, adj.index))) {
            const word = ['特别', '贼', '巨'][Math.floor(rng() * 3)]
            body = body.slice(0, adj.index) + word + body.slice(adj.index)
            hits.push({ ch: word, body: body.slice(0, 20) })
            rebuilt += body + c.sep
            continue
          }
          // 明明 + 不 ——「就不对」→「明明就不对」
          const bm = /不/.exec(body)
          const bmWord = bm && (VERB_BEFORE.test(body.slice(0, bm.index)) || body[bm.index + 1] === body[bm.index - 1])
          if (bm && !bmWord && bm.index >= 2 && !NOT_PLAIN.test(body.slice(bm.index, bm.index + 2))) {
            body = body.slice(0, bm.index) + '明明' + body.slice(bm.index)
            hits.push({ ch: '明明', body: body.slice(0, 20) })
          }
        }
      }
      rebuilt += body + c.sep
    }
    lines[li] = rebuilt
  }
  return { text: lines.join('\n'), hits, count: hits.length }
}
