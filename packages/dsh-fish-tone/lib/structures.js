/**
 * 结构腔：不是禁，是按密度压到真人的水平。
 *
 * 真人也会说「不是…而是…」「最…的是」，问题从来不是用不用，是用得多不多。
 * 底下的 per1k 是拿 10 万条 B站评论（其中 3,000 条 ≥150 字的长评论，96 万字）量出来的，
 * 不是估的。同一批句式在 AI 评论里的密度是这些数的 5～37 倍。
 *
 * 用法：scan() 找出来，budget() 算这篇允许多少个，thin() 把超出的、能安全改的改掉。
 */

/** 句式表。tier=strict 的基本只在长文里允许出现，soft 的每几百字允许一个。 */
export const FRAMES = [
  { id: 'not-but', name: '不是X而是Y', tier: 'strict', per1k: 0.06, re: /不是[^。！？]{1,24}(?:，\s*(?:这|那|它|就)?是|而是)/g },
  { id: 'most-de', name: '最…的是', tier: 'strict', per1k: 0.05, re: /最[^，。]{1,8}的是/g },
  { id: 'first-then', name: '先…再…', tier: 'strict', per1k: 0.01, re: /先[^，。]{1,10}再/g },
  { id: 'notonly', name: '不仅…更', tier: 'strict', per1k: 0.01, re: /不仅[^，。]{1,12}(?:更|还)/g },
  { id: 'de-copula', name: 'X的是Y', tier: 'soft', per1k: 0.37, re: /[^的，。！？]{1,8}的是[^，。]/g },
  { id: 'triple', name: '三段并列', tier: 'soft', per1k: 0.23, re: /[^，。、]{2,8}、[^，。、]{2,8}、[^，。、]{2,8}/g },
  { id: 'emdash', name: '破折号', tier: 'soft', per1k: 0.22, re: /——+|—/g, fix: 'comma' },
  { id: 'yue', name: '越…越', tier: 'soft', per1k: 0.16, re: /越[^，。]{1,8}越/g },
  { id: 'really', name: '真正/本质上', tier: 'soft', per1k: 0.17, re: /(?:真正|本质上|归根结底)/g },
  { id: 'roadmap', name: '首先/其次/综上', tier: 'soft', per1k: 0.5, re: /(?:首先|其次|综上所述|总而言之)/g },
]

const MB = new Map(FRAMES.map((f) => [f.id, f]))

/**
 * 一篇多长，就允许多少个。
 * soft 每 240 字起允许 1 个（超过就按比例给）；strict 严格按真人密度算，通常就是 0。
 * @param {number} chars
 * @returns {Record<string, number>}
 */
export function budget(chars) {
  const out = {}
  for (const f of FRAMES) {
    const raw = (f.per1k * chars) / 1000
    out[f.id] = f.tier === 'soft'
      ? Math.max(chars >= 200 ? 1 : 0, Math.round(raw * 2))
      : Math.round(raw)
  }
  return out
}

/**
 * 数句式。
 * @param {string} text
 * @returns {{id: string, name: string, tier: string, count: number, spans: string[]}[]}
 */
export function scan(text) {
  const src = String(text ?? '')
  const rows = []
  for (const f of FRAMES) {
    const spans = [...src.matchAll(f.re)].map((m) => m[0])
    if (spans.length) rows.push({ id: f.id, name: f.name, tier: f.tier, count: spans.length, spans })
  }
  return rows
}

/**
 * 把超出预算的部分压下去。
 * skip(line) 返回 true 的行（代码块、路径、表格）整行不碰。
 * 只有破折号会自动改成逗号；别的只报告，交给写的人自己删。
 * 三段并列原来也自动改，现在不动了 —— 别人的实测是「句内同构排比人类不比 AI 少」，
 * 拿它下刀等于制造新的均匀。
 * @param {string} text
 * @param {{skip?: (line: string) => boolean}} [opts]
 */
export function thin(text, opts = {}) {
  const src = String(text ?? '')
  const skip = opts.skip
  const lines = src.split('\n')
  const ok = lines.map((l) => !skip?.(l))
  const chars = [...lines.filter((_, i) => ok[i]).join('')].length
  if (chars < 80) return { text: src, thinned: 0, over: [] }
  const allow = budget(chars)

  const counts = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (!ok[i]) continue
    for (const row of scan(lines[i])) counts.set(row.id, (counts.get(row.id) ?? 0) + row.count)
  }

  const over = []
  let thinned = 0
  for (const [id, count] of counts) {
    const allowed = allow[id] ?? 0
    if (count <= allowed) continue
    const f = MB.get(id)
    over.push({ id, name: f.name, count, allowed })
    if (!f?.fix) continue
    let surplus = count - allowed
    for (let i = 0; i < lines.length && surplus > 0; i++) {
      if (!ok[i]) continue
      lines[i] = lines[i].replace(f.re, (m) => {
        if (surplus <= 0) return m
        surplus -= 1
        thinned += 1
        return f.fix === 'comma' ? m.replace(/——+|—/g, '，').replace(/、/g, '，') : m
      })
    }
  }
  return { text: lines.join('\n'), thinned, over }
}

/** 每千字的句式总密度，拿来跟真人基线比。 */
export function density(text) {
  const src = String(text ?? '')
  const chars = Math.max(1, [...src].length)
  const rows = scan(src)
  const total = rows.reduce((a, r) => a + r.count, 0)
  return { chars, total, per1k: +((total / chars) * 1000).toFixed(2), rows }
}
