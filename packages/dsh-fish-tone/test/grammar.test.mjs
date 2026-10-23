import test from 'node:test'
import assert from 'node:assert/strict'

import { scan, repair, budgetFor, countSentences } from '../lib/grammar.js'

/* ───────────── 第一层：查得出来 ───────────── */

test('18 条规则每条都查得出来', () => {
  const cases = [
    ['我我觉得这事挺好', 'dup-func'],
    ['这个很好很很好', 'dup-adverb'],
    ['他说完了。。', 'dup-punct'],
    ['这件事防止不再发生', 'double-negative'],
    ['一个同学们都来了', 'measure-people'],
    ['很多同学们都来了', 'measure-plural'],
    ['通过这次分析使我知道了原因', 'through-make'],
    ['慢慢的说了一遍', 'de-di'],
    ['他跑的很快', 'de-de'],
    ['好吧吧', 'dup-particle'],
    ['他做为班长要先说话', 'typo-homophone'],
    ['我觉得挺好,真的', 'mixed-punct'],
    ['原因是数据太少造成的', 'reason-blend'],
    ['本着安全第一为原则', 'blend-basis'],
    ['大约三十分钟左右', 'redundant-approx'],
    ['这件事涉及到很多人', 'redundant-prep'],
    ['这次再次重申了方案', 'redundant-synonym'],
    ['这个非常太离谱了', 'degree-absolute'],
  ]
  for (const [text, rule] of cases) {
    const hits = scan(text).map((h) => h.rule)
    assert.ok(hits.includes(rule), `${text} 应该命中 ${rule}，实际 ${hits.join(',')}`)
  }
})

test('明显的和不明显的分得开', () => {
  const major = scan('一个同学们都来了').find((h) => h.rule === 'measure-people')
  const minor = scan('好吧吧').find((h) => h.rule === 'dup-particle')
  assert.equal(major.severity, 'major')
  assert.equal(minor.severity, 'minor')
})

test('保护区：代码、URL、命令行参数都不查', () => {
  const src = '跑 `npm test` 就行。\n\n```bash\nrm -rf ./dist --silent\n```\n\n看 https://example.com/a?b=1 这个。'
  assert.deepEqual(scan(src), [])
  assert.equal(repair(src, { seed: 7, inject: false }).text, src)
})

test('不误伤正常词：以经济、在次卧', () => {
  assert.deepEqual(scan('以经济角度看，他在次卧室睡觉。'), [])
})

test('修完是干净的：一套病句进去，出来能念', () => {
  const dirty = '通过这次分析使我知道了，原因是数据太少造成的。大约三十分钟左右，涉及到很多同学们。。'
  const out = repair(dirty, { seed: 7, keepRate: 0, inject: false }).text
  assert.equal(out, '这次分析使我知道了，原因是数据太少。大约三十分钟，涉及很多同学。')
})

test('干净的文字扫不出东西', () => {
  assert.equal(scan('这条视频我看了三遍，字幕一共二十二段。').length, 0)
})

/* ───────────── 第二层：修和留的比例 ───────────── */

test('十条语病里修掉大部分，留下两三条', () => {
  const dirty = Array.from({ length: 10 }, (_, i) => `我我觉得第${i + 1}句挺好很很好`).join('。') + '。'
  const r = repair(dirty, { seed: 7 })
  assert.ok(r.found >= 10, `应该扫出至少 10 条，实际 ${r.found}`)
  assert.ok(r.kept.length <= Math.ceil(r.found * 0.4), `留太多：${r.kept.length}/${r.found}`)
  assert.ok(r.fixed > 0)
  assert.ok(r.fixed / r.found > 0.4, `修得太少：${r.fixed}/${r.found}`)
})

test('带病的句子不超过四成（十条里六条以上干净）', () => {
  const dirty = Array.from({ length: 10 }, (_, i) => `这${i + 1}句我我觉得还行很很好`).join('。') + '。'
  const r = repair(dirty, { seed: 11 })
  const dirtySentences = new Set(r.kept.map((k) => k.rule))
  assert.ok(dirtySentences.size <= 4, `带病的规则种类 ${dirtySentences.size} 太多`)
  assert.ok(countSentences(r.text) >= 9)
})

test('配额是语料量的：每 450 字才留一个不明显的', () => {
  const dirty = '我我觉得这个很好很很好。。慢慢的说吧吧'
  const r = repair(dirty, { seed: 3 })
  const minor = r.kept.filter((k) => k.severity === 'minor').length
  assert.ok(minor <= r.budget.minor, `留下 ${minor} 个，配额 ${r.budget.minor}`)
  // 不到 40 字的短评：一个都不留（真人写短评不犯书面语病）
  assert.equal(r.budget.minor, 0)
  assert.equal(re_kept_minor(r), 0)
})

test('不到 2000 字：一个明显语病都不留', () => {
  const dirty = '一个同学们都来了。这件事防止不再发生。通过这次分析使我知道了原因。'
  const r = repair(dirty, { seed: 5 })
  assert.equal(r.kept.filter((k) => k.severity === 'major').length, 0)
  assert.equal(r.text.includes('一个同学们'), false)
  assert.equal(r.text.includes('防止不再'), false)
  assert.equal(r.text.includes('通过这次分析使'), false)
})

test('2000 字以上才允许留一个明显的', () => {
  const long = ('一个同学们都来了。这件事防止不再发生。通过这次分析使我知道了原因。'
    + '我我觉得这个视频很好很很好。慢慢的说了一遍。好吧吧。').repeat(40)
  assert.ok(long.length > 2000)
  let sawMajor = 0
  for (let seed = 1; seed <= 20; seed++) {
    const r = repair(long, { seed })
    const major = r.kept.filter((k) => k.severity === 'major').length
    assert.ok(major <= r.budget.major, `seed ${seed} 明显语病 ${major} 超过配额 ${r.budget.major}`)
    sawMajor += major
  }
  assert.ok(sawMajor <= 20, '明显语病留得太频繁')
})

test('300 字以上才留一个（语料：每 800 字 1.2 个真语病）', () => {
  const short = '我我觉得这个视频很好看，字幕清楚，画面干净，节奏舒服。'
  assert.ok(short.length < 300)
  assert.equal(repair(short, { seed: 1 }).budget.minor, 0, '短评不留语病')

  const long = short.repeat(12)   // >300 字
  assert.ok(long.length >= 300)
  const r = repair(long, { seed: 1 })
  assert.equal(r.budget.minor, 1)
  assert.ok(r.kept.filter((k) => k.severity === 'minor').length <= 1)
})

test('配额随字数长：300 字 1 个，1600 字 2 个，2000 字才有明显的', () => {
  assert.deepEqual(budgetFor(50), { minor: 0, major: 0 })
  assert.deepEqual(budgetFor(299), { minor: 0, major: 0 })
  assert.deepEqual(budgetFor(300), { minor: 1, major: 0 })
  assert.deepEqual(budgetFor(1600), { minor: 2, major: 0 })
  assert.deepEqual(budgetFor(2000), { minor: 2, major: 1 })
})

/* ───────────── 第三层：像人，不像校对软件 ───────────── */

test('正文本来干净、又够 300 字时，补一个手滑', () => {
  const clean = ('这条视频我看了三遍，字幕一共二十二段。画面里只有她站在那儿说话，没有别的东西。'
    + '她说插件就是把话往人的方向掰一点点，我听完就去写了一个。').repeat(6)
  const no = repair(clean, { seed: 7, inject: false })
  assert.equal(no.injected, 0)
  assert.equal(no.text, clean)

  const yes = repair(clean, { seed: 7, inject: true })
  assert.equal(yes.injected, 1)
  assert.equal(yes.text.length, clean.length + 1)
  assert.ok(scan(yes.text).some((h) => h.severity === 'minor'), '注入的应该是小毛病')
})

test('短文本不注入（不够 300 字）', () => {
  const r = repair('这条挺好', { seed: 7, inject: true })
  assert.equal(r.injected, 0)
})

test('同一个 seed 给同一个结果', () => {
  const dirty = '我我觉得这个很好很很好。。慢慢的说吧吧'
  assert.equal(repair(dirty, { seed: 9 }).text, repair(dirty, { seed: 9 }).text)
})

test('空输入和英文不炸', () => {
  assert.equal(repair('', { seed: 1 }).text, '')
  assert.equal(repair('The verdict is loud.', { seed: 1 }).text, 'The verdict is loud.')
})


/** 数一数留下了几个不明显的语病。 */
function re_kept_minor(r) {
  return r.kept.filter((k) => k.severity === 'minor').length
}
