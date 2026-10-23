/**
 * 训练用：拿真人写的评论当标尺，量插件到底掰多了还是掰少了。
 *
 *   node tools/calibrate.mjs <语料.json>
 *
 * 语料 = 一段真人手写的短句（评论、聊天记录都行，一个 JSON 数组，
 * 或者带 content/text 字段的对象数组）。它是「人味」的标尺，不是插件输出。
 * 不给文件就用内置的中性样例，只够跑通，不足以校准。
 *
 * 量三个数：
 *   改动率   这条评论被改动了没有（%）
 *   尾巴率   每 100 个句子挂了多少个尾巴
 *   插字比   插进去的字 ÷ 原文长度
 */
import { readFileSync } from 'node:fs'
import { applyTone } from '../lib/index.js'

function loadCorpus(p) {
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const arr = Array.isArray(raw) ? raw : (raw.events || raw.items || [])
    const texts = arr.map((x) => x.content || x.text || '').filter((t) => t && t.trim())
    if (texts.length) return texts
  } catch { /* fall through */ }
  // 内置样例：中性、无个人信息，只用来确认脚本能跑
  return [
    '这条我看了两遍，第二遍才注意到窗外在下雨',
    '一开始以为是个教程，看到一半发现是段子',
    '声音比画面好，可惜后半段有点拖',
    '居然真的是现场收音，一点没修',
  ]
}

const corpusPath = process.argv[2]
if (!corpusPath) console.log('（没给语料文件，用内置样例跑一遍；要真校准请传 <语料.json>）\n')
const texts = loadCorpus(corpusPath)
const LEVELS = ['off', 'light', 'normal', 'max']
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1)

const SOFT = new Set([...'的吧啦嘛啊呀哦呢么吗呗'])
const humanTail = texts.filter((t) => SOFT.has(t.replace(/\[[^\]]+\]/g, '').slice(-1))).length / texts.length
const humanLen = texts.reduce((a, b) => a + b.length, 0) / texts.length

console.log(`语料：${texts.length} 条真人评论，平均 ${humanLen.toFixed(1)} 字`)
console.log(`真人自己的语气词收尾率：${(humanTail * 100).toFixed(1)}%（这就是标尺）\n`)
console.log('档位     改动率   尾巴率   插字比   平均插字')
console.log('─────────────────────────────────────────────')

const rows = []
for (const strength of LEVELS) {
  let changed = 0
  let tails = 0
  let units = 0
  let inserted = 0
  let chars = 0
  for (const seed of SEEDS) {
    for (const t of texts) {
      const r = applyTone(t, { strength, seed })
      if (r.text !== t) changed += 1
      tails += r.stats.tails
      units += r.stats.units
      inserted += r.stats.insertedChars
      chars += t.length
    }
  }
  const n = SEEDS.length * texts.length
  const row = {
    strength,
    changed: changed / n,
    tailRate: units ? tails / units : 0,
    insertedRatio: inserted / chars,
    avgInserted: inserted / n,
  }
  rows.push(row)
  console.log(
    `${strength.padEnd(8)} ${(row.changed * 100).toFixed(1).padStart(6)}%  ` +
    `${(row.tailRate * 100).toFixed(1).padStart(6)}%  ` +
    `${(row.insertedRatio * 100).toFixed(1).padStart(6)}%  ` +
    `${row.avgInserted.toFixed(1).padStart(7)} 字`,
  )
}

console.log('\n判断：')
const light = rows.find((r) => r.strength === 'light')
if (light.tailRate > 0.2) console.log(`  ⚠️ light 的尾巴率 ${(light.tailRate * 100).toFixed(0)}% 比真人高太多，该降`)
else if (light.tailRate < 0.04 && humanTail > 0.05) console.log(`  ⚠️ light 的尾巴率比真人还低，可以再放一点`)
else console.log(`  ✅ light 的尾巴率跟真人（${(humanTail * 100).toFixed(0)}%）在一个量级`)
if (light.changed > 0.5) console.log('  ⚠️ 一半以上的句子都被动过，这不是「掰一点点」')
else console.log(`  ✅ light 只改动 ${(light.changed * 100).toFixed(0)}% 的评论`)
