import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyTone,
  apply,
  canTakeParticle,
  isStructuralLine,
  isSuggestion,
  mulberry32,
  splitSentences,
} from '../lib/index.js'

/* ───────────── 第一层：纯函数 & 切句 ───────────── */

test('mulberry32 同 seed 同序列，不同 seed 不同序列', () => {
  const seqA = Array.from({ length: 5 }, mulberry32(7))
  const seqB = Array.from({ length: 5 }, mulberry32(7))
  const seqC = Array.from({ length: 5 }, mulberry32(8))
  assert.deepEqual(seqA, seqB)
  assert.notDeepEqual(seqA, seqC)
  for (const v of seqA) assert.ok(v >= 0 && v < 1)
})

test('切句保留分隔符，重组一字节不差', () => {
  const line = '先看一眼，再说。第二句！第三句？'
  const parts = splitSentences(line)
  assert.equal(parts.map((p) => p.body + p.sep).join(''), line)
  assert.equal(parts.length, 3)
})

test('结构性行一律不碰', () => {
  for (const line of [
    '# 标题',
    '- 列表项',
    '1. 有序列表',
    '| a | b |',
    '> 引用',
    '```js',
    '$ npm test',
    './run.sh',
    'git commit -m "x"',
  ]) {
    assert.equal(isStructuralLine(line), true, line)
  }
})

test('挂尾巴的资格：太短/英文/已带语气词/含命令都不行', () => {
  assert.equal(canTakeParticle('好'), false)
  assert.equal(canTakeParticle('hello world'), false)
  assert.equal(canTakeParticle('这个不错吧'), false)
  assert.equal(canTakeParticle('跑 node --test 试试'), false)
  assert.equal(canTakeParticle('时间大概在十分钟左右'), true)
})

/* ───────────── 第二层：掰完还对不对 ───────────── */

const SAMPLE = '我把这条视频看了三遍。字幕一共二十二段。画面里没有别的东西，只有她站在那儿说话。'

test('off 档一个字都不改', () => {
  const out = applyTone(SAMPLE, { strength: 'off' })
  assert.equal(out.text, SAMPLE)
  assert.equal(out.stats.insertedChars, 0)
})

test('light 档：会改，但不改句子数量、不删字', () => {
  const out = applyTone(SAMPLE, { strength: 'light', seed: 7 })
  assert.ok(out.text.length >= SAMPLE.length, '只能加字，不能减字')
  const before = splitSentences(SAMPLE).length
  const after = splitSentences(out.text).length
  assert.equal(after, before, '句子数不能变')
  assert.equal(out.stats.units, before)
})

test('同 seed 可复现，换 seed 会变', () => {
  const a = applyTone(SAMPLE, { strength: 'max', seed: 42 }).text
  const b = applyTone(SAMPLE, { strength: 'max', seed: 42 }).text
  const c = applyTone(SAMPLE, { strength: 'max', seed: 43 }).text
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('数字、URL、路径、行内代码原样保留', () => {
  const src = [
    '我算了一下，2:19 那条一共 43 分钟只有 4 个播放。',
    '报告在 /home/user/project/lib/index.js 里。',
    '参考 https://www.bilibili.com/video/BV1BNnc6nEUa 这条。',
    '命令是 `node --test test/tone.test.mjs`，别改它。',
  ].join('\n')
  const out = applyTone(src, { strength: 'max', seed: 3 }).text
  for (const token of ['2:19', '43', '4', '/home/user/project/lib/index.js',
    'https://www.bilibili.com/video/BV1BNnc6nEUa', '`node --test test/tone.test.mjs`']) {
    assert.ok(out.includes(token), `丢了 ${token}`)
  }
})

test('代码块整块不动，块外的句子照掰', () => {
  const src = '下面是代码，别动它：\n```js\nconst a = 1\nconsole.log(a)\n```\n就这三行，很好懂。'
  const out = applyTone(src, { strength: 'max', seed: 6 }).text
  assert.ok(out.includes('```js\nconst a = 1\nconsole.log(a)\n```'), '代码块被改了')
  assert.notEqual(out, src, '块外也没动，说明整段被放弃了')
})

test('以冒号收尾的引出句：不挂尾巴、不犹豫', () => {
  const src = '改这一行：\n```js\nconst x = 1\n```\n改完就跑测试。'
  for (let seed = 1; seed <= 12; seed++) {
    const out = applyTone(src, { strength: 'max', seed }).text
    assert.equal(/[：:]\s*[的吧就啦嘛啊]/.test(out), false, `seed ${seed}: ${out.split('\n')[0]}`)
    assert.equal(out.split('\n')[0], '改这一行：', `seed ${seed} 引出句被动了`)
  }
})

test('三档真的拉开差距：max 挂的尾巴不少于 light', () => {
  const long = Array.from({ length: 24 }, () => '这条视频我看了三遍，画面里只有她说话').join('。') + '。'
  const light = applyTone(long, { strength: 'light', seed: 21 }).stats.tails
  const normal = applyTone(long, { strength: 'normal', seed: 21 }).stats.tails
  const max = applyTone(long, { strength: 'max', seed: 21 }).stats.tails
  assert.ok(light <= normal && normal <= max, `light=${light} normal=${normal} max=${max}`)
  assert.ok(max > 0, 'max 一个都没挂')
})

test('英文行不动', () => {
  const src = 'The verdict is 143 BPM and it is loud.'
  assert.equal(applyTone(src, { strength: 'max', seed: 9 }).text, src)
})

test('不会出现两个语气词连挂', () => {
  const src = Array.from({ length: 40 }, () => '今天也没人看这条视频').join('。') + '。'
  const out = applyTone(src, { strength: 'max', seed: 11 }).text
  assert.equal(/[的吧就啦嘛啊]{2}/.test(out), false, out.slice(0, 120))
})

test('越没用越像人：max 塞进去的字不少于 light', () => {
  const light = applyTone(SAMPLE.repeat(6), { strength: 'light', seed: 1 }).stats.insertedChars
  const max = applyTone(SAMPLE.repeat(6), { strength: 'max', seed: 1 }).stats.insertedChars
  assert.ok(max >= light, `light=${light} max=${max}`)
})

/* ───────────── 「吧」不许乱挂 ───────────── */

test('isSuggestion：只有建议 / 祈使句算', () => {
  for (const s of ['那就先这样', '不如先跑一遍', '你再看看', '先放着', '就这样']) {
    assert.equal(isSuggestion(s), true, s)
  }
  for (const s of ['这个功能昨天还好好的', '我把缓存清了一遍', '大概就是这样', '你干什么了']) {
    assert.equal(isSuggestion(s), false, s)
  }
})

test('「吧」只挂在建议句上，陈述句和特指问后面不出现', () => {
  const src = '你干什么了。我把缓存清了一遍。这个功能昨天还好好的。大概就是这样。那就先这样。'
  let sawBa = 0
  for (let seed = 1; seed <= 80; seed++) {
    const { text, stats } = applyTone(src, { strength: 'max', seed })
    assert.equal(
      /干什么了吧|清了一遍吧|还好好的吧|就是这样吧/.test(text),
      false,
      `seed ${seed} 陈述句后面挂了「吧」：${text}`,
    )
    if (stats.particles['吧']) sawBa += 1
  }
  assert.ok(sawBa > 0, '建议句上一个「吧」都没挂 —— 规则收得太死，等于把「吧」删了')
})

test('特指问后面不挂「嘛」（"你干什么了嘛"也是病句）', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const out = applyTone('你干什么了。你怎么了。', { strength: 'max', seed }).text
    assert.equal(/[什么么]了嘛/.test(out), false, `seed ${seed}：${out}`)
  }
})

test('「的」不挂在比较句上（"音质比预期好的"是病句）', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const out = applyTone('音质比预期好。整体比上周快。', { strength: 'max', seed }).text
    assert.equal(/[好快]的/.test(out), false, `seed ${seed}：${out}`)
  }
})

test('「的」只挂在程度副词 + 形容词的句子上', () => {
  let saw = 0
  for (let seed = 1; seed <= 120; seed++) {
    const out = applyTone('这个功能挺麻烦。', { strength: 'max', seed }).text
    if (out.includes('麻烦的')) saw += 1
  }
  assert.ok(saw > 0, '「挺麻烦的」这种最自然的搭配一个都没出现')
})

test('犹豫不跟句子开头撞字（不写"这个，这个功能…"）', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const out = applyTone('这个功能挺好。这个我昨天试过。', { strength: 'max', seed }).text
    assert.equal(/这个[，,]\s*这个/.test(out), false, `seed ${seed}：${out}`)
  }
})

test('stats.particles 跟挂出去的尾巴对得上', () => {
  const { text, stats } = applyTone(SAMPLE.repeat(3), { strength: 'max', seed: 5 })
  const counted = Object.values(stats.particles).reduce((a, b) => a + b, 0)
  assert.equal(counted, stats.tails)
  for (const p of Object.keys(stats.particles)) assert.ok(text.includes(p), p)
})

/* ───────────── 第三层：插件把东西挂上了吗 ───────────── */

test('apply() 挂了一节 prompt、三个工具和一个技能', () => {
  const sections = []
  const tools = []
  const skills = []
  const root = {
    inject(_deps, fn) {
      fn({
        effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
        systemPrompt: { section: (s) => sections.push(s) },
        tools: { register: (t) => tools.push(t) },
        skills: { register: (k) => { skills.push(k); return () => {} } },
      })
    },
  }
  apply(root, { strength: 'normal', seed: 5 })

  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'fish-tone:voice')
  assert.ok(Number.isFinite(sections[0].order))
  assert.ok(sections[0].text.includes('双向鱼群拓扑'))
  assert.ok(sections[0].text.includes('fish_judge'), 'prompt 要提到判断工具')

  assert.equal(tools.length, 3, '现在挂了 fish_tone、fish_grammar、fish_judge 三个工具')
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, ['fish_grammar', 'fish_judge', 'fish_tone'])

  assert.equal(skills.length, 1)
  assert.equal(skills[0].name, 'fish-sense')
  assert.ok(skills[0].description.length > 0)
  assert.ok(skills[0].content.includes('扎堆'), '技能正文要有扎堆那节')
  assert.ok(skills[0].whenToUse.includes('不是'), 'whenToUse 要写清什么时候用')
  const tone = tools.find((t) => t.name === 'fish_tone')
  assert.deepEqual(tone.parameters.required, ['text'])
  assert.equal(typeof tone.execute, 'function')
})

test('工具 execute：默认档位、json 输出、空输入报错', async () => {
  const tools = []
  const root = {
    inject(_deps, fn) {
      fn({
        effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
        systemPrompt: { section: () => {} },
        tools: { register: (t) => tools.push(t) },
      })
    },
  }
  apply(root, { strength: 'light', seed: 7 })
  const tool = tools[0]

  const plain = await tool.execute({ text: SAMPLE })
  assert.equal(plain.ok, true)
  assert.equal(typeof plain.text, 'string')

  const asJson = await tool.execute({ text: SAMPLE, format: 'json' })
  const parsed = JSON.parse(asJson.text)
  assert.equal(parsed.stats.strength, 'light')
  assert.ok(parsed.stats.units > 0)

  const empty = await tool.execute({ text: '   ' })
  assert.equal(empty.ok, false)
})

test('掰过一遍的话再掰一遍，不会叠出两个尾巴', () => {
  const src = '我把这条视频看了三遍。字幕一共二十二段。画面里只有她站在那儿说话。'
  const once = applyTone(src, { strength: 'max', seed: 13 }).text
  const twice = applyTone(once, { strength: 'max', seed: 13 }).text
  assert.equal(/[的吧就啦嘛啊]{2}/.test(twice), false, twice)
})

test('产出永远是输入的超集（只加不删）', () => {
  const src = '这条 2:19 的视频发了 43 分钟只有 4 个播放。'
  for (let seed = 1; seed <= 20; seed++) {
    const out = applyTone(src, { strength: 'max', seed }).text
    const stripped = out.replace(/[嗯呃…，的吧就啦嘛啊]/g, '')
    const origStripped = src.replace(/[嗯呃…，的吧就啦嘛啊]/g, '')
    assert.equal(stripped.length >= origStripped.length, true, `seed ${seed}: ${out}`)
  }
})

test('句尾是数字的句子：挂不了尾巴，但可以犹豫', () => {
  const src = '这条视频总长 2:19。我看了三遍。'
  let hes = 0
  let tailsOnNumberLine = 0
  for (let seed = 1; seed <= 40; seed++) {
    const out = applyTone(src, { strength: 'normal', seed })
    if (/^[嗯呃…]|^……/.test(out.text) || /^这个，/.test(out.text)) hes += 1
    if (/2:19[的吧就啦嘛啊]/.test(out.text)) tailsOnNumberLine += 1
  }
  assert.equal(tailsOnNumberLine, 0, '数字后面被挂了尾巴')
  assert.ok(hes > 0, '犹豫一次都没出现，资格判定太紧了')
})

test('「就」不再当句尾尾巴（"掰一点点就。" 是病句）', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const out = applyTone('我把这条视频看了三遍。方法其实很简单。', { strength: 'max', seed }).text
    assert.equal(/就[。！？…]/.test(out), false, `seed ${seed}: ${out}`)
  }
})

test('「的」只跟在形容词谓语后面', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const adj = applyTone('这个方法挺好。', { strength: 'max', seed }).text
    if (adj.includes('好')) assert.equal(/好[。！？…]/.test(adj) || /好[的吧啦嘛啊]/.test(adj), true, adj)
    const verb = applyTone('我下午去现场。', { strength: 'max', seed }).text
    assert.equal(/现场[的]/.test(verb), false, `seed ${seed}: ${verb}`)
  }
})

test('fish_judge 工具能跑出判断（不删字，只报处境和问题）', async () => {
  const tools = []
  const root = {
    inject(_deps, fn) {
      fn({
        effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
        systemPrompt: { section: () => {} },
        tools: { register: (t) => tools.push(t) },
        skills: { register: () => () => {} },
      })
    },
  }
  apply(root, { strength: 'normal', seed: 5 })
  const judge = tools.find((t) => t.name === 'fish_judge')
  const draft = '这个视频不是讲技巧，而是讲方法。最值得的是它先量再改——本质上是个校准器。'
  const r = await judge.execute({ text: draft })
  assert.equal(r.ok, true)
  assert.ok(r.text.includes('[判断]'), r.text)
  assert.ok(r.text.includes('[要你自己答]'), r.text)
  assert.ok(!r.text.includes(draft.slice(0, 10)), '判断工具不该原样回吐/改写字')

  const j = await judge.execute({ text: draft, format: 'json' })
  const v = JSON.parse(j.text)
  assert.equal(v.band, 'template')
  assert.ok(v.hits.every((h) => ['keep', 'ask', 'cut', 'count'].includes(h.verdict)))
})
