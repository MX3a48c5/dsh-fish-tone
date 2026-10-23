/**
 * dsh-fish-tone-flavor —— 浏览器半端：设置页里的「人味插件 · 附属包」
 *
 * 这一页只管性格层：可爱 / 抽象 / 热梗库。
 * 主插件（dsh-fish-tone）那一页在它旁边，两页互不依赖：卸载这一包，主插件照常工作。
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-tone-flavor',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/fish-flavor'

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

    const MODES = [
      { id: 'cute', label: '可爱', note: '句尾挂软语气词' },
      { id: 'abstract', label: '抽象', note: '句尾挂一个短梗' },
    ]
    const RATES = [
      { id: 'low', label: '低', note: '默认' },
      { id: 'normal', label: '中', note: '' },
      { id: 'high', label: '高', note: '预览用' },
    ]
    const VIBE_LABEL = {
      cute: '可爱', abstract: '抽象', ironic: '阴阳', broken: '破防', work: '职场',
      heal: '治愈', hype: '热血', retro: '怀旧', slacker: '摆烂', fun: '搞笑',
    }
    const SAMPLE = '我把这条视频看了三遍。字幕一共二十二段。画面里只有她站在那儿说话。后面的部分我没看完。'

    const CSS = `
[data-ff-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;}
[data-ff-sec]{display:flex;flex-direction:column;gap:8px;}
[data-ff-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ff-row]{display:flex;align-items:center;gap:10px;}
[data-ff-grow]{flex:1;min-width:0;}
[data-ff-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ff-note][data-warn]{color:#d97706;}
[data-ff-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-ff-sw][data-on]{background:#3b82f6;}
[data-ff-sw]::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:8px;
  background:#fff;transition:transform .15s;}
[data-ff-sw][data-on]::after{transform:translateX(16px);}
[data-ff-seg]{display:flex;gap:6px;}
[data-ff-seg] button{flex:1;padding:6px 0;border-radius:8px;cursor:pointer;font-size:12px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));background:transparent;color:inherit;}
[data-ff-seg] button[data-on]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-ff-seg] button small{display:block;font-size:10px;opacity:.75;margin-top:2px;}
[data-ff-in]{width:100%;box-sizing:border-box;resize:vertical;min-height:72px;padding:10px 12px;
  border-radius:10px;font:inherit;font-size:13px;line-height:20px;color:inherit;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-bg-base,transparent);}
[data-ff-btn]{padding:7px 14px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.28));
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:inherit;}
[data-ff-btn][disabled]{opacity:.5;cursor:default;}
[data-ff-out]{padding:12px 14px;border-radius:10px;font-size:13px;line-height:22px;white-space:pre-wrap;
  background:var(--dsw-alias-bg-hover,rgba(128,128,128,.10));}
[data-ff-meta]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ff-toggle]{padding:14px 16px;border-radius:12px;display:flex;flex-direction:column;gap:10px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.22));}
[data-ff-toggle][data-off]{opacity:.62;}
[data-ff-card]{padding:12px 14px;border-radius:10px;display:flex;flex-direction:column;gap:6px;
  border:1px solid var(--dsw-alias-border-default,rgba(128,128,128,.22));}
[data-ff-card] b{font-size:15px;}
[data-ff-tag]{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:999px;font-size:10px;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18));}
`

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [out, setOut] = React.useState('')
      const [note, setNote] = React.useState('')
      const [bad, setBad] = React.useState(false)
      const [card, setCard] = React.useState(null)
      const [busy, setBusy] = React.useState('')

      const load = React.useCallback(async () => {
        try { setSt(await jget('/status')) } catch (e) { setBad(true); setNote('读不到状态：' + e.message) }
      }, [])
      React.useEffect(() => { load() }, [load])

      const patch = async (body) => {
        setBusy('cfg')
        try {
          const next = await jpost('/config', body)
          setSt((s) => ({ ...(s || {}), ...next }))
          setNote('已保存')
          setTimeout(() => setNote(''), 1600)
        } catch (e) {
          setBad(true); setNote('保存失败：' + e.message)
        } finally { setBusy('') }
      }

      const preview = async () => {
        setBusy('preview')
        try {
          const r = await jpost('/preview', { text: SAMPLE })
          setOut(r.ok ? r.text : '预览失败：' + (r.error || '未知'))
        } catch (e) { setOut('预览失败：' + e.message) } finally { setBusy('') }
      }

      const drawMeme = async () => {
        setBusy('meme')
        try {
          const r = await jget('/memes?limit=30')
          const list = r.memes || []
          setCard(list.length ? list[Math.floor(Math.random() * list.length)] : null)
        } catch (e) { setNote('抽梗失败：' + e.message) } finally { setBusy('') }
      }

      if (!st) return h('div', { 'data-ff-page': '' }, h('div', { 'data-ff-note': '' }, note || '读取中…'))

      const on = !!st.enabled
      return h('div', { 'data-ff-page': '' },
        h('div', { 'data-ff-sec': '' },
          h('div', { 'data-ff-h': '' }, '附属包'),
          h('div', { 'data-ff-toggle': '', 'data-off': on ? undefined : '' },
            h('div', { 'data-ff-row': '' },
              h('div', { 'data-ff-grow': '' },
                h('div', {}, '性格层'),
                h('div', { 'data-ff-note': '' }, on ? '开着：说话会带一点性格' : '关着：一个字都不加（默认）')),
              h('button', {
                'data-ff-sw': '', 'data-on': on ? '' : undefined,
                onClick: () => patch({ enabled: !on }),
              })),
            h('div', { 'data-ff-note': '' },
              '主插件保持中性，可爱 / 抽象只活在这一包里。关掉就跟没装一样。'))),

        h('div', { 'data-ff-sec': '' },
          h('div', { 'data-ff-h': '' }, '性格'),
          h('div', { 'data-ff-seg': '' },
            MODES.map((m) => h('button', {
              key: m.id, 'data-on': (st.mode || 'cute') === m.id ? '' : undefined,
              disabled: !on, onClick: () => patch({ mode: m.id }),
            }, m.label, h('small', {}, m.note))))),

        h('div', { 'data-ff-sec': '' },
          h('div', { 'data-ff-h': '' }, '密度'),
          h('div', { 'data-ff-seg': '' },
            RATES.map((r) => h('button', {
              key: r.id, 'data-on': (st.rate || 'low') === r.id ? '' : undefined,
              disabled: !on, onClick: () => patch({ rate: r.id }),
            }, r.label, h('small', {}, r.note || ' '))))),

        h('div', { 'data-ff-sec': '' },
          h('div', { 'data-ff-h': '' }, '预览'),
          h('div', { 'data-ff-row': '' },
            h('button', { 'data-ff-btn': '', disabled: busy === 'preview', onClick: preview },
              busy === 'preview' ? '跑…' : '拿一段话试试'),
            out ? h('button', { 'data-ff-btn': '', onClick: () => { setOut(''); setCard(null) } }, '清掉') : null),
          out ? h('div', { 'data-ff-out': '' }, out) : h('div', { 'data-ff-note': '' }, SAMPLE)),

        h('div', { 'data-ff-sec': '' },
          h('div', { 'data-ff-row': '' },
            h('div', { 'data-ff-h': '', 'data-ff-grow': '' }, '热梗库 · ' + (st.library?.count ?? 0) + ' 条'),
            h('button', { 'data-ff-btn': '', disabled: busy === 'meme', onClick: drawMeme },
              busy === 'meme' ? '抽…' : '抽一条')),
          card
            ? h('div', { 'data-ff-card': '' },
              h('div', {}, h('b', {}, card.term),
                card.year ? '  ' + card.year : '',
                (card.vibes || []).map((v) => h('span', { key: v, 'data-ff-tag': '' }, VIBE_LABEL[v] || v))),
              h('div', { 'data-ff-note': '' }, card.gloss),
              h('div', { 'data-ff-meta': '' }, '用法：' + card.usage),
              h('div', { 'data-ff-meta': '' }, '来源：' + card.source +
                (card.corpus?.hits ? ' · 语料 ' + card.corpus.hits + ' 次 / ' + card.corpus.videos + ' 个视频' : '')))
            : h('div', { 'data-ff-note': '' },
              (st.library?.builtAt ? '库构建于 ' + st.library.builtAt + '。' : '') + '点「抽一条」看看；模型那边用 fish_meme 查。')),

        h('div', { 'data-ff-note': '' },
          'prompt 那一节：' + (st.promptRegistered ? '挂着（会真的影响模型）' : '没挂')
          + ' · 配置存在 ' + String(st.configFile || 'config.json')),
        note ? h('div', { 'data-ff-note': '', 'data-warn': bad ? '' : undefined }, note) : null
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-fish-tone-flavor')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-fish-tone-flavor: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish-tone-flavor', order: 35, label: '人味插件 · 附属包' },
          () => h(Panel),
        ))
      },
    }
  },
})
