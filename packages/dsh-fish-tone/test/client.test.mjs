import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const code = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 把 client.js 跑在假沙箱里：window.__ModuleLoader__ + document + react 都是假的。 */
function boot() {
  const loaded = []
  const styles = []
  const document = {
    head: { appendChild: (el) => styles.push(el) },
    createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
  }
  const React = {
    createElement: (type, props, ...kids) => ({ type, props, kids }),
    useState: (v) => [v, () => {}],
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f,
    useEffect: () => {},
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (def) => loaded.push(def) } },
    document,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  return { loaded, styles, React, document }
}

test('自注册脚本：id 必须等于包名', () => {
  const { loaded } = boot()
  assert.equal(loaded.length, 1, '应该只 load 一次')
  assert.equal(loaded[0].id, 'dsh-fish-tone')
  assert.equal(typeof loaded[0].factory, 'function')
})

test('factory 交回 inject + apply', () => {
  const { loaded, React } = boot()
  const plugin = loaded[0].factory((name) => {
    if (name === 'react') return React
    throw new Error('不该 require ' + name)
  })
  assert.deepEqual([...plugin.inject], ['slots'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 往 settings.section 里登记「人味插件」这一页', () => {
  const { loaded, styles, React } = boot()
  const plugin = loaded[0].factory((n) => (n === 'react' ? React : null))

  const registered = []
  let injected = null
  const slots = {
    inject: (slot, fn) => { injected = slot; fn() },
    register: (opts, factory) => { registered.push({ opts, factory }); return () => {} },
  }
  const ctx = {
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get: (name) => (name === 'slots' ? slots : undefined),
  }
  plugin.apply(ctx)

  assert.equal(injected, 'settings.section')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].opts.name, 'settings.section')
  assert.equal(registered[0].opts.id, 'fish-tone')
  assert.equal(registered[0].opts.label, '人味插件')
  assert.equal(typeof registered[0].opts.order, 'number')

  // 工厂交回的是一棵元素树（h(Panel)），组件本身在 .type 上
  const el = registered[0].factory()
  assert.equal(typeof el.type, 'function', '工厂要交回一个组件')
  assert.equal(styles.length, 1, '样式应该注入了一次')
})

test('没有 slots 服务时不炸', () => {
  const { loaded, React } = boot()
  const plugin = loaded[0].factory((n) => (n === 'react' ? React : null))
  const ctx = { effect: (fn) => fn(), get: () => undefined }
  assert.doesNotThrow(() => plugin.apply(ctx))
})
