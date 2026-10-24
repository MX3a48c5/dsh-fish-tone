import test from 'node:test'
import assert from 'node:assert/strict'

import { scanMarks, markDensity, insertMarks, MARKS } from '../lib/marks.js'

test('scanMarks：数出关系和留白两类', () => {
  const rows = scanMarks('我也试过，好像挺麻烦的')
  assert.ok(rows.some((r) => r.ch === '也' && r.kind === 'relate'))
  assert.ok(rows.some((r) => r.ch === '好像' && r.kind === 'hedge'))
})

test('insertMarks：第一人称后面补「也」，别的字不碰', () => {
  const r = insertMarks('我试过这个 明天再说', { level: 'max', seed: 3 })
  assert.equal(r.count, 1)
  assert.match(r.text, /我[也还]试过这个/)
  assert.match(r.text, /明天再说/)
})

test('insertMarks：已经有标记的不重复插', () => {
  const r = insertMarks('我也试过这个', { level: 'max', seed: 3 })
  assert.equal(r.count, 0, r.text)
})

test('insertMarks：评价副词前面补「好像」，句子没有评价就不补', () => {
  const a = insertMarks('这个插件挺麻烦', { level: 'max', seed: 3 })
  assert.match(a.text, /好像挺麻烦/)
  const b = insertMarks('写完了才发现错了', { level: 'max', seed: 3 })
  assert.equal(b.count, 0, b.text)
})

test('insertMarks：代码/路径行跳过，同 seed 结果一样', () => {
  const skip = (l) => l.includes('http') || l.includes('`')
  const t = '我试过 https://example.com 我试过 `code` 我试过这个'
  const r = insertMarks(t, { level: 'max', seed: 9, skip })
  assert.ok(!/https?:\/\/[^\s]*[也还]/.test(r.text), r.text)
  assert.equal(r.text, insertMarks(t, { level: 'max', seed: 9, skip }).text)
})

test('markDensity：留白类分开算，并给出真人参照线', () => {
  const d = markDensity('我也试过，好像挺麻烦')
  assert.ok(d.relate > 0)
  assert.ok(d.hedge > 0)
  assert.ok(d.hedgeline > 0)
  assert.equal(MARKS.find((m) => m.ch === '也').kind, 'relate')
})

test('insertMarks：加强组 —— 根本不 / 全都 / 简直', () => {
  const a = insertMarks('代码里不能加', { level: 'max', seed: 3 })
  assert.match(a.text, /(根本|压根)不能加/, a.text)

  const b = insertMarks('加的东西后来全删了', { level: 'max', seed: 3 })
  assert.match(b.text, /全都删了/, b.text)

  const c = insertMarks('塞完读起来像个不识字的人', { level: 'max', seed: 3 })
  assert.match(c.text, /(根本|压根|简直)/, c.text)
})

test('insertMarks：已经有加强词就不再叠', () => {
  const r = insertMarks('代码里根本不能加', { level: 'max', seed: 3 })
  assert.equal(r.count, 0, r.text)
  const q = insertMarks('真的特别麻烦', { level: 'max', seed: 3 })
  assert.ok(!/特别特别/.test(q.text), q.text)
})

test('markDensity：加强类单独一个数', () => {
  const d = markDensity('根本不行，简直了')
  assert.ok(d.intensify > 0)
  assert.ok(d.intensifyLine > 0)
})
