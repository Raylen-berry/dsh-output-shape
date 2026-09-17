// ============================================================================
// dsh-output-shape · Client half
//
// 两处入口，共用同一份数据源（host 的 /os/* 路由）：
//   ① 输入条右侧 chip「形状」——点一下直接切常驻注入（开/关）。
//   ② 设置 → 输出形状 —— 同一个开关 + 状态明细 + 规则正文预览。
//
// 为什么开关是「常驻注入」而不是「技能」：技能装了就在目录里、按需加载不占 token，
// 没有"开/关"可言；用户要能拨的那个东西就是**每请求都注入**这条路径。
//
// 仿 dsh-cache-control 的 __ModuleLoader__ 封装。两个从那边学来的硬规矩照抄：
//   · 没成功读到过设置之前不许保存（否则 PUT 会把默认值盖到用户的真实配置上）；
//   · chip 渲染抛错要有边界显示出来，不能被槽静默吞掉（那表现为"插件没生效"）。
// ============================================================================

window.__ModuleLoader__.load({
  id: 'dsh-output-shape',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    var styles = {
      insert: function (css) {
        var el = document.createElement('style')
        el.type = 'text/css'
        el.setAttribute('data-os-styles', '1')
        el.textContent = css
        document.head.appendChild(el)
        return function () { if (el.parentNode) el.parentNode.removeChild(el) }
      },
    }

    var CSS = [
      '.os-page{display:flex;flex-direction:column;gap:18px;max-width:680px}',
      '.os-h{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0 0 4px}',
      '.os-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 10px;line-height:1.7}',
      '.os-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.os-row{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.os-note{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7;border-left:2px solid var(--dsw-alias-brand-primary,#4d6bfe);padding-left:10px}',
      '.os-warn{font-size:12px;color:var(--dsw-alias-label-warning,#b8860b);line-height:1.7}',
      '.os-err{font-size:12px;color:var(--dsw-alias-label-danger,#e5534b)}',
      '.os-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.os-path{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.6}',
      '.os-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px}',
      '.os-k{color:var(--dsw-alias-label-secondary)}',
      '.os-v{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.os-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);height:26px;padding:0 10px;border-radius:7px;font-size:12px;cursor:pointer}',
      '.os-btn:hover{border-color:var(--dsw-alias-border-l3)}',
      '.os-btn:disabled{opacity:.55;cursor:default}',
      // ---- chip：一枚可点的段 + 状态徽标（与 cache-control 同族尺寸，视觉不抢）----
      '.os-chip{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:transparent;height:22px;color:var(--dsw-alias-label-primary);white-space:nowrap;border-radius:999px;align-items:center;gap:2px;padding:0 2px 0 4px;font-size:11.5px;line-height:1;display:inline-flex;transition:border-color .12s,color .12s;position:relative;top:1.2px}',
      '.os-chip.on{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.4))}',
      '.os-seg{display:inline-flex;align-items:center;gap:.35em;white-space:nowrap;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;line-height:1;height:20px;padding:0 5px;border-radius:999px;cursor:pointer;transition:background-color .12s}',
      '.os-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.os-seg:disabled{cursor:default;opacity:.55}',
      '.os-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.os-dot.on{background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.os-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:15px;padding:0 3px;border-radius:4px;font-size:10.5px;line-height:1;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}',
      '.os-badge.on{color:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.os-badge.dim{color:var(--dsw-alias-label-warning,#b8860b)}',
      // ---- 「说明」抽屉：默认收起 ----
      '.os-fold{margin-top:6px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.25))}',
      '.os-foldBtn{display:inline-flex;align-items:center;gap:4px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.5;cursor:pointer;padding:0;border-radius:4px}',
      '.os-foldBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.os-pre{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 9px;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;font-family:var(--dsw-font-mono,ui-monospace,monospace)}',
      // 开关本体用原生 checkbox 配 accent-color，避免依赖宿主组件版本
      '.os-switch{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer}',
    ].join('\n')

    // ---------------------------------------------------------------- store --
    var STORE = {
      state: {
        loading: true,
        loaded: false,       // 成功从 host 读到过；未读到前禁止保存
        saving: false,
        error: '',
        injected: false,     // 常驻注入是否真的生效（env 逃生开关也算在内）
        declared: null,      // null = 还没写过 settings.json
        disabledByEnv: false,
        registered: [],
        shape: { bytes: 0, maxBytes: 0, truncated: false, originalBytes: 0, keptBytes: 0, lines: 0 },
        skillFile: '',
        settingsFile: '',
        previewOpen: false,
        previewText: '',
        previewLoading: false,
        previewError: '',
      },
      listeners: [],
      set: function (patch) {
        var next = {}
        for (var k in this.state) next[k] = this.state[k]
        for (var p in patch) next[p] = patch[p]
        this.state = next
        for (var i = 0; i < this.listeners.length; i++) this.listeners[i]()
      },
      subscribe: function (fn) {
        this.listeners.push(fn)
        var self = this
        return function () {
          var i = self.listeners.indexOf(fn)
          if (i >= 0) self.listeners.splice(i, 1)
        }
      },
    }

    function useShape() {
      var pair = React.useState(0)
      var force = pair[1]
      React.useEffect(function () {
        return STORE.subscribe(function () { force(function (x) { return x + 1 }) })
      }, [])
      return STORE.state
    }

    function kb(n) {
      n = Number(n) || 0
      return n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'
    }

    function pull(body) {
      var patch = {
        loading: false,
        loaded: true,
        injected: body.injected === true,
        error: '',
      }
      if (body.settings && typeof body.settings.alwaysOn === 'boolean') patch.alwaysOnWanted = body.settings.alwaysOn
      if ('declared' in body) patch.declared = body.declared
      STORE.set(patch)
    }

    function load() {
      fetch('/os/settings.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
        .then(function (j) {
          pull(j)
          // /os/state 只用来填状态明细；它挂了不影响开关本身，故单独 catch。
          return fetch('/os/state', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null })
            .then(function (s) {
              if (!s || s.ok !== true) return
              STORE.set({
                declared: typeof s.declared === 'boolean' ? s.declared : STORE.state.declared,
                injected: s.injected === true,
                disabledByEnv: s.disabledByEnv === true,
                registered: Array.isArray(s.registered) ? s.registered : [],
                shape: s.shape || STORE.state.shape,
                skillFile: s.skillFile || '',
                settingsFile: s.settingsFile || '',
              })
            })
            .catch(function () { /* 状态明细读不到就算了 */ })
        })
        .catch(function (e) {
          STORE.set({ loading: false, error: '加载失败: ' + String(e) })
        })
    }

    /**
     * 写常驻注入开关。
     *
     * `loaded` 守卫照抄 cache-control：没成功读到过就绝不 PUT —— 那时 STORE 里是默认值，
     * 一次保存就会把用户真实配置盖掉。
     */
    function setAlwaysOn(next) {
      var want = !!next
      if (!STORE.state.loaded) {
        STORE.set({ error: '还没从宿主读到设置，已阻止保存（否则会用默认值盖掉你现在的配置）。刷新页面后重试。' })
        return Promise.resolve()
      }
      STORE.set({ saving: true, injected: want, error: '' })
      return fetch('/os/settings.json', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alwaysOn: want }),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (res) {
          if (!res.ok || !res.j || res.j.ok !== true) {
            throw new Error((res.j && res.j.error) || 'http ' + (res.j && res.j.status))
          }
          STORE.set({ saving: false, injected: res.j.injected === true, declared: want, error: '' })
        })
        .catch(function (e) {
          STORE.set({ saving: false, error: '保存失败: ' + String(e) })
          load()   // 失败后回读真值，别让界面停在"看起来已经改了"的假状态上
        })
    }

    function loadPreview() {
      if (STORE.state.previewText) return
      STORE.set({ previewLoading: true, previewError: '' })
      fetch('/os/shape.json', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
        .then(function (j) { STORE.set({ previewLoading: false, previewText: String(j.text || ''), shape: j }) })
        .catch(function (e) { STORE.set({ previewLoading: false, previewError: '读取失败: ' + String(e) }) })
    }

    // ------------------------------------------------------------- widgets --
    // ---- 错误边界：chip 渲染抛错要显示占位，不能被槽静默丢弃 ----
    // （从 cache-control 学来：静默丢弃的表现是"插件装了但什么都没发生"，最难查。）
    class ChipBoundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(e) { return { err: String((e && e.message) || e) } }
      render() {
        if (this.state.err) return h('span', { 'data-os-err': '1', style: { fontSize: '11px', color: '#c0392b' } }, '形状(错误)')
        return this.props.children
      }
    }

    function ShapeChip() {
      var s = useShape()
      var on = s.injected === true
      var label = s.loading ? '…' : (on ? '开' : '关')
      var cls = 'os-badge' + (on ? ' on' : '') + (s.error ? ' dim' : '')
      return h(
        'div',
        { className: 'os-chip' + (on ? ' on' : ''), 'data-os-chip': '1' },
        h(
          'button',
          {
            type: 'button',
            className: 'os-seg',
            'data-os-toggle': '1',
            disabled: s.saving,
            title: '常驻注入输出形状规则（当前' + (on ? '开' : '关') + '）。开着时每个请求都会重复计费这段文本。',
            onClick: function () { setAlwaysOn(!on) },
          },
          h('span', { className: 'os-dot' + (on ? ' on' : '') }),
          h('span', null, '形状'),
          h('span', { className: cls, 'data-os-state': '1' }, label),
        ),
      )
    }

    function ShapePage() {
      var s = useShape()
      var on = s.injected === true
      var skillOk = s.registered.indexOf('i-have-adhd') >= 0
      return h(
        'div',
        { className: 'os-page', 'data-os-page': '1' },
        h('div', { className: 'os-h' }, '输出形状'),
        h('div', { className: 'os-sub' }, '把回复整形成"读完就能动手"的形状：首行给下一步、多步编号、跑题后置、无开场白无客套。规则来自 ayghri/i-have-adhd（MIT）。'),

        h(
          'div',
          { className: 'os-card' },
          h(
            'label',
            { className: 'os-row' },
            h('input', {
              className: 'os-switch',
              type: 'checkbox',
              checked: on,
              disabled: s.saving || !s.loaded,
              'data-os-switch': '1',
              onChange: function (e) { setAlwaysOn(e.target.checked) },
            }),
            h('span', null, '常驻注入 system prompt'),
            h('span', { className: 'os-muted' }, on ? '（开）' : '（关）'),
          ),
          h(
            'div',
            { className: 'os-note' },
            '开＝每条回复都被这套形状规则约束，代价是这段文本每个请求重复计费（还会在每个子代理里再乘一遍）。关＝只在需要时由模型或你调用技能 ',
            h('code', null, 'i-have-adhd'),
            '，不占常驻 token。',
          ),
          s.error ? h('div', { className: 'os-err' }, s.error) : null,
        ),

        h(
          'div',
          { className: 'os-card' },
          h('div', { className: 'os-h' }, '这份规则在哪生效'),
          h(
            'div',
            { className: on ? 'os-note' : 'os-warn' },
            on
              ? '本插件是这套形状规则的真源：会话策略（dsh-cache-control）守则里的 R4 已于 2026-09-16 摘出，只剩一句归属声明，不会重复注入。若你在别处又常驻了一份同样的规则，关掉这里的开关或删掉那份。'
              : '已关闭：现在没有任何一份形状规则在常驻注入（会话策略里的 R4 也已摘出）。要恢复就打开上面的开关；也可以不调开关、让模型按需调用技能 i-have-adhd，那样不占常驻 token。',
          ),
        ),

        h(
          'div',
          { className: 'os-card' },
          h('div', { className: 'os-h' }, '状态'),
          h(
            'div',
            { className: 'os-kv' },
            h('span', { className: 'os-k' }, '技能注册'),
            h('span', { className: 'os-v' }, skillOk ? 'i-have-adhd ✓' : (s.registered.length ? s.registered.join(', ') : '未注册（改过 skills/ 需重启桌面端）')),
            h('span', { className: 'os-k' }, '实际注入'),
            h('span', { className: 'os-v' }, on ? '是（每个 model step）' : '否'),
            h('span', { className: 'os-k' }, '是否表过态'),
            h('span', { className: 'os-v' }, s.declared === null ? '还没写过 settings.json（当前走 bundle config 的默认值）' : (s.declared ? '开' : '关')),
            h('span', { className: 'os-k' }, '规则体积'),
            h('span', { className: 'os-v' }, kb(s.shape.bytes) + ' / 上限 ' + kb(s.shape.maxBytes) + '（' + (s.shape.lines || 0) + ' 行）' + (s.shape.truncated ? ' ⚠ 已被截断' : '')),
            h('span', { className: 'os-k' }, '逃生开关'),
            h('span', { className: 'os-v' }, s.disabledByEnv ? 'DSH_OUTPUT_SHAPE_DISABLE=1 正在强制关闭' : '未启用'),
          ),
          s.skillFile ? h('div', { className: 'os-path' }, '规则真源：' + s.skillFile) : null,
          s.settingsFile ? h('div', { className: 'os-path' }, '开关落盘：' + s.settingsFile) : null,
          h(
            'div',
            { className: 'os-row' },
            h('button', { type: 'button', className: 'os-btn', disabled: s.saving, onClick: load }, '重新读取'),
          ),
          h(
            'div',
            { className: 'os-fold' },
            h(
              'button',
              {
                type: 'button',
                className: 'os-foldBtn',
                'data-os-preview-btn': '1',
                onClick: function () {
                  var next = !s.previewOpen
                  STORE.set({ previewOpen: next })
                  if (next) loadPreview()
                },
              },
              (s.previewOpen ? '收起' : '查看') + '模型实际看到的规则正文',
            ),
            s.previewOpen
              ? h(
                'div',
                null,
                h('div', { className: 'os-muted', style: { margin: '8px 0 6px' } }, '这就是注入形态（已剥 frontmatter、花括号已中和、按上限截断）——预览即模型所见。'),
                s.previewLoading ? h('div', { className: 'os-muted' }, '读取中…') : null,
                s.previewError ? h('div', { className: 'os-err' }, s.previewError) : null,
                s.previewText ? h('pre', { className: 'os-pre', 'data-os-preview': '1' }, s.previewText) : null,
              )
              : null,
          ),
        ),
      )
    }

    // ---------------------------------------------------------------- apply --
    function apply(ctx) {
      var slots = ctx.get('slots')
      var disposeStyle = styles.insert(CSS)
      var errors = []
      if (slots !== undefined) {
        try {
          slots.inject('settings.section', function () {
            return slots.register(
              { name: 'settings.section', id: 'output-shape', order: 66, label: '输出形状' },
              function () { return h(ShapePage) })
          })
        } catch (e) { errors.push('settings.section: ' + String((e && e.message) || e)) }
        try {
          slots.inject('conversation.input.right', function () {
            return slots.register(
              { name: 'conversation.input.right', id: 'output-shape', order: 210, label: '输出形状', inject: function () { return { modelAware: true } } },
              function () { return h(ChipBoundary, null, h(ShapeChip)) })
          })
        } catch (e) { errors.push('conversation.input.right: ' + String((e && e.message) || e)) }
      }
      load()
      if (errors.length) console.warn('[dsh-output-shape] slot issues: ' + errors.join(' | '))
      console.log('[dsh-output-shape] client up')
      return function () {
        try { disposeStyle() } catch (e) { /* 样式已随页面销毁 */ }
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    // 离线回归用的测试缝（浏览器端不读）：chip 点击落到哪个函数、保存载荷长什么样，
    // 只能靠直接调用这些来断言。
    exports.internals = {
      STORE: STORE,
      setAlwaysOn: setAlwaysOn,
      load: load,
      loadPreview: loadPreview,
      ShapeChip: ShapeChip,
      ShapePage: ShapePage,
      kb: kb,
    }

    return module.exports
  },
})
