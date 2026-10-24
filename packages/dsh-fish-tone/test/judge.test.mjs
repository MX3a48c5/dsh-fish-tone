import test from 'node:test'
import assert from 'node:assert/strict'

import { assess, cluster, hits, necessity, overlap, registerOf, render, REGISTERS } from '../lib/judge.js'

test('registerOf：短口语是闲聊，排动作是步骤，讲原因是解释', () => {
  assert.equal(registerOf('哈哈哈哈这也太离谱了吧'), 'chat')
  assert.equal(registerOf('先装依赖，然后跑测试，接着看日志，最后提交'), 'steps')
  assert.equal(registerOf('其实问题不在代码，而是我们对这个接口的理解一开始就错了。不过这一点可以后面再说，先把跑通的版本留下来。'), 'argue')
  assert.equal(registerOf('因为这个服务每次都要重新算一遍，所以慢是正常的，也就是说时间花在计算上，不是网络'), 'explain')
})

test('cluster：不同句式扎堆才算扎堆，同一种重复不算', () => {
  // 同一种句式重复两次 —— 真人的习惯，只有 maxHits 涨，maxDistinct 还是 1
  const same = hits('越用越顺手。越改越乱。')
  assert.equal(cluster(same).maxDistinct, 1)
  assert.equal(cluster(same).maxHits, 2)

  // 三种不同句式挤在 40 字里
  const mixed = hits('这不是姿势问题，而是习惯问题。最值得改的是那句——先想再写。')
  const c = cluster(mixed)
  assert.ok(c.maxDistinct >= 3, `应认出 3 种以上，实际 ${c.maxDistinct}`)
})

test('同截字不被两个句式重复计数', () => {
  const hs = hits('最值得改的是那句。')
  const ids = hs.map((h) => h.id)
  assert.equal(ids.filter((i) => i === 'most-de' || i === 'de-copula').length, 1, ids.join(','))
})

test('necessity：「不是…而是…」换说法就砍，真纠正就留，自造就交给人判', () => {
  const restate = '不是慢，而是慢吞吞的。'
  assert.equal(necessity(hits(restate)[0], restate, 'note').verdict, 'cut')

  const fix = '很多人以为慢是网络问题，其实不是网络，而是每次都重算。'
  assert.equal(necessity(hits(fix)[0], fix, 'explain').verdict, 'keep')

  const selfMade = '这个插件不是加词，而是换一种说话方式。'
  assert.equal(necessity(hits(selfMade)[0], selfMade, 'note').verdict, 'ask')
})

test('necessity：「最…的是」前面没有候选集就只是个情绪词', () => {
  const bare = '最值得的是它把权重重配了。'
  assert.equal(necessity(hits(bare)[0], bare, 'note').verdict, 'ask')

  const listed = '它做了三件事：改权重、换句式表、补测试。最值得说的是补测试那一步。'
  const h = hits(listed).find((x) => x.id === 'most-de')
  assert.equal(necessity(h, listed, 'explain').verdict, 'keep')
})

test('overlap：短串包含也算重复', () => {
  assert.ok(overlap('慢', '慢吞吞的') > 0.55)
  assert.ok(overlap('加词', '换个说法') < 0.3)
  assert.ok(overlap('不喜欢', '不想说') < 0.55)
})

test('assess：模板腔会同时报密度和扎堆，并给出问题', () => {
  const bot = '这个视频不是讲技巧，而是讲方法。最值得的是它先量再改——本质上是个校准器。'
  const v = assess(bot)
  assert.equal(v.band, 'template')
  assert.ok(v.ratio > 5, `比值 ${v.ratio}`)
  assert.ok(v.cluster.maxDistinct >= 2)
  assert.ok(v.questions.length >= 1)
  assert.ok(REGISTERS[v.register].per1k > 0)
})

test('assess：正常的长解释不该被判成模板腔', () => {
  const human = '这个插件做的事其实很简单，就是把句尾的语气词按语料重新配了权重。'
    + '之前的问题是「啦」「嘛」给得太重，看着像在撒娇，真人很少那么说话。'
    + '改完之后读起来顺手多了，不过要不要开也看场合，正式的东西我就关掉。'
  const v = assess(human)
  assert.ok(v.band === 'clean' || v.band === 'slight', `判成了 ${v.band}（${v.per1k}/千字）`)
})

test('render：先结论，再逐处，最后是问题', () => {
  const out = render(assess('这不是姿势问题，而是习惯问题。最值得改的是那句——先想再写。'))
  assert.ok(out.includes('[判断]'), out)
  assert.ok(out.includes('[文体]'), out)
  assert.ok(out.includes('[要你自己答]'), out)
  assert.ok(out.includes('[不动]'), out)
  assert.ok(/[1]\. 「/.test(out), '应有逐处清单')
})
