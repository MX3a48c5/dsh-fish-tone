import test from 'node:test'
import assert from 'node:assert/strict'

import { scan, budget, thin, density, FRAMES } from '../lib/structures.js'

test('scan：认出结构腔句式', () => {
  const s = '这不是懒惰，而是身体需要休息。最值得抄的是那条备份纪律，破折号——还有——两个。'
  const ids = scan(s).map((r) => r.id)
  assert.ok(ids.includes('not-but'), ids.join(','))
  assert.ok(ids.includes('most-de'), ids.join(','))
  assert.ok(ids.includes('emdash'), ids.join(','))
})

test('budget：短文本一个都不给，长文本按真人密度给', () => {
  const short = budget(120)
  for (const k of Object.keys(short)) assert.equal(short[k], 0, `${k} 短文本不该给额度`)
  const long = budget(4000)
  assert.ok(long['de-copula'] >= 1, '软档长文应至少允许一个')
  assert.equal(long['not-but'], 0, '「不是…而是…」4000 字仍不该给额度')
})

test('thin：超标的破折号改成逗号，代码行不碰', () => {
  const body = '这不是懒惰，而是身体需要休息。'.repeat(5) + '\n破折号——还有——两个。'
  const code = '\n```js\nconst a = 1——2\n```\n下一行也——不动。'
  let fence = false
  const skip = (l) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return true }
    return fence
  }
  const r = thin(body + code, { skip })
  assert.ok(r.text.includes('const a = 1——2'), '代码行被改了')
  assert.ok(r.text.includes('破折号，还有，两个'), r.text)
  assert.ok(r.text.includes('下一行也，不动'), '围栏外面的正文应该照常压')
  assert.ok(r.over.some((o) => o.id === 'not-but'), '超标的「不是…而是」应该被报出来')
})

test('density：按千字给密度', () => {
  const d = density('这不是懒惰，而是身体需要休息。')
  assert.ok(d.per1k > 0)
  assert.equal(d.chars, '这不是懒惰，而是身体需要休息。'.length)
})

test('句式表：每个都有真人基线', () => {
  assert.ok(FRAMES.length >= 8)
  for (const f of FRAMES) {
    assert.ok(f.id && f.name && f.re instanceof RegExp)
    assert.ok(f.per1k >= 0 && f.per1k < 10, f.id)
    assert.ok(['strict', 'soft'].includes(f.tier), f.id)
  }
})
