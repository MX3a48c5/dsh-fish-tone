/**
 * dsh-fish-tone —— 浏览器半端：设置页里的一页（「人味插件」）
 *
 * 约定（抄 dsh-bili-scroll 的写法，2026-10）：
 *   1. client bundle **不是 ESM**，是自注册脚本：window.__ModuleLoader__.load({ id, factory })
 *   2. 进「设置」靠 slots.inject('settings.section', ...)，label 就是左侧导航那一项
 *   3. 宿主那边开 /api/fish-tone，这一页只做 fetch
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-tone',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/fish-tone'

    const asJson = async (res) => {
      if (res.ok) return res.json()
      throw new Error('HTTP ' + res.status)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const LEVELS = [
      { id: 'off', label: '关', note: '一个字都不掰' },
      { id: 'light', label: '轻', note: '默认。掰一点点' },
      { id: 'normal', label: '中', note: '尾巴明显多一点' },
      { id: 'max', label: '猛', note: '会塞废话，不建议日常开' },
    ]

    const SAMPLE = '我把这条视频看了三遍。字幕一共二十二段。画面里只有她站在那儿说话。'

    const CSS = `
[data-ft-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;}
[data-ft-sec]{display:flex;flex-direction:column;gap:8px;}
[data-ft-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ft-row]{display:flex;align-items:center;gap:10px;}
[data-ft-grow]{flex:1;min-width:0;}
[data-ft-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ft-note][data-warn]{color:#d97706;}
[data-ft-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-ft-sw][data-on]{background:#3b82f6;}
[data-ft-sw]::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:8px;
  background:#fff;transition:transform .15s;}
[data-ft-sw][data-on]::after{transform:translateX(16px);}
[data-ft-seg]{display:flex;gap:6px;}
[data-ft-seg] button{flex:1;padding:6px 0;border-radius:8px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:transparent;color:inherit;}
[data-ft-seg] button[data-on]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-ft-seg] button small{display:block;font-size:10px;opacity:.75;margin-top:2px;}
[data-ft-in]{width:100%;box-sizing:border-box;resize:vertical;min-height:72px;padding:10px 12px;
  border-radius:10px;font:inherit;font-size:13px;line-height:20px;color:inherit;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-bg-base,transparent);}
[data-ft-num]{width:96px;padding:6px 10px;border-radius:8px;font:inherit;font-size:13px;color:inherit;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-bg-base,transparent);}
[data-ft-btn]{padding:7px 14px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:inherit;}
[data-ft-btn][disabled]{opacity:.5;cursor:default;}
[data-ft-out]{padding:12px 14px;border-radius:10px;font-size:13px;line-height:22px;white-space:pre-wrap;
  background:var(--dsw-alias-bg-hover,rgba(128,128,128,.10));}
[data-ft-meta]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ft-toggle]{padding:14px 16px;border-radius:12px;display:flex;flex-direction:column;gap:10px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.22));}
[data-ft-toggle][data-off]{opacity:.62;}
`

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [draft, setDraft] = React.useState(null)   // 本地草稿，避免重载回来把输入冲掉
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [bad, setBad] = React.useState(false)
      const [text, setText] = React.useState(SAMPLE)
      const [out, setOut] = React.useState(null)
      const [stats, setStats] = React.useState(null)

      const view = draft || st
      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])

      const load = React.useCallback(async () => {
        try {
          const s = await jget('/status')
          if (alive.current) setSt(s)
        } catch (e) {
          if (alive.current) { setMsg('读状态失败：' + e.message); setBad(true) }
        }
      }, [])
      React.useEffect(() => { load() }, [load])

      const save = async (patch) => {
        const before = view
        setDraft({ ...before, ...patch })       // 乐观更新
        setBusy('save')
        setMsg('')
        try {
          const s = await jpost('/config', patch)
          if (!alive.current) return
          setSt(s)
          setDraft(null)
          setMsg('已保存')
          setBad(false)
        } catch (e) {
          if (!alive.current) return
          setDraft(null)                        // 失败就回落到真值
          setMsg('保存失败：' + e.message)
          setBad(true)
        } finally {
          if (alive.current) setBusy('')
        }
      }

      const preview = async () => {
        setBusy('preview')
        setMsg('')
        try {
          const r = await jpost('/preview', {
            text,
            strength: (view && view.strength) || 'light',
            seed: (view && view.seed) || 7,
          })
          if (!alive.current) return
          if (!r.ok) { setMsg(r.error || '预览失败'); setBad(true); return }
          setOut(r.text)
          setStats(r.stats)
          setBad(false)
        } catch (e) {
          if (alive.current) { setMsg('预览失败：' + e.message); setBad(true) }
        } finally {
          if (alive.current) setBusy('')
        }
      }

      if (!st) {
        return h('div', { 'data-ft-page': '' },
          h('div', { 'data-ft-h': '' }, '人味插件'),
          h('div', { 'data-ft-note': '' }, msg || '读取中……'))
      }

      const on = !!view.enabled

      return h('div', { 'data-ft-page': '' },
        h('div', { 'data-ft-sec': '' },
          h('div', { 'data-ft-h': '' }, '人味插件 · 双向鱼群拓扑'),
          h('div', { 'data-ft-note': '' },
            '来自 BV1BNnc6nEUa：每条鱼只跟前后两条鱼握手，握完就学会了犹豫，句尾挂一点没用的东西，越没用越像人。')),

        h('div', { 'data-ft-toggle': '', 'data-off': on ? undefined : '' },
          h('div', { 'data-ft-row': '' },
            h('button', {
              'data-ft-sw': '',
              'data-on': on ? '' : undefined,
              'aria-label': on ? '关闭人味插件' : '打开人味插件',
              disabled: busy === 'save',
              onClick: () => save({ enabled: !on }),
            }),
            h('div', { 'data-ft-grow': '' },
              h('div', { 'data-ft-label': '', style: { fontSize: '13px' } }, on ? '已开启' : '已关闭'),
              h('div', { 'data-ft-note': '' },
                on
                  ? (st.promptRegistered ? '说话的松紧那一节已经挂进系统提示，现在生效。' : '已开启，但那一节还没挂上（重载后生效）。')
                  : '关掉以后，「说话的松紧」整节从系统提示里撤掉，工具还在但按 off 走。')))),

        h('div', { 'data-ft-sec': '' },
          h('div', { 'data-ft-row': '' },
            h('button', {
              'data-ft-sw': '',
              'data-on': view.grammar !== false ? '' : undefined,
              disabled: busy === 'save',
              'aria-label': '开关语病层',
              onClick: () => save({ grammar: view.grammar === false }),
            }),
            h('div', { 'data-ft-grow': '' },
              h('div', { 'data-ft-label': '', style: { fontSize: '13px' } }, view.grammar !== false ? '语病层：开' : '语病层：关'),
              h('div', { 'data-ft-note': '' },
                '开：扫掉大部分语病，按配额留一点。配额按语料量：不到 300 字一个都不留，300 字以上每 800 字留一个不明显的，明显的每 2000 字才留一个。关：一个都不留。')))),

        h('div', { 'data-ft-sec': '' },
          h('div', { 'data-ft-h': '' }, '掰多少'),
          h('div', { 'data-ft-seg': '' },
            LEVELS.map((lv) => h('button', {
              key: lv.id,
              'data-on': view.strength === lv.id ? '' : undefined,
              disabled: busy === 'save',
              onClick: () => save({ strength: lv.id }),
            }, lv.label, h('small', null, lv.note))))),

        h('div', { 'data-ft-sec': '' },
          h('div', { 'data-ft-h': '' }, '种子'),
          h('div', { 'data-ft-row': '' },
            h('input', {
              'data-ft-num': '',
              type: 'number',
              value: view.seed,
              disabled: busy === 'save',
              onChange: (e) => {
                const n = Number(e.target.value)
                setDraft({ ...view, seed: Number.isFinite(n) ? n : view.seed })
              },
              onBlur: () => { if (draft && draft.seed !== st.seed) save({ seed: draft.seed }) },
            }),
            h('div', { 'data-ft-note': '' }, '同一个种子 + 同一段话 = 同一个结果'))),

        h('div', { 'data-ft-sec': '' },
          h('div', { 'data-ft-h': '' }, '试一下'),
          h('textarea', {
            'data-ft-in': '',
            value: text,
            onChange: (e) => setText(e.target.value),
            rows: 3,
          }),
          h('div', { 'data-ft-row': '' },
            h('button', { 'data-ft-btn': '', disabled: busy === 'preview', onClick: preview },
              busy === 'preview' ? '掰着……' : '掰一下'),
            h('div', { 'data-ft-grow': '' }),
            stats ? h('div', { 'data-ft-meta': '' },
              '尾巴 ' + stats.tails + ' · 犹豫 ' + stats.hesitations + ' · 废话 ' + stats.fillers +
              ' · 无用度 ' + stats.uselessness) : null),
          out ? h('div', { 'data-ft-out': '' }, out) : null),

        msg ? h('div', { 'data-ft-note': '', 'data-warn': bad ? '' : undefined }, msg) : null,
        h('div', { 'data-ft-note': '' },
          '改完立刻生效，不用重启。配置存在 ' + String(st.configFile || 'config.json'))
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-fish-tone')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-fish-tone: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish-tone', order: 34, label: '人味插件' },
          () => h(Panel),
        ))
      },
    }
  },
})
