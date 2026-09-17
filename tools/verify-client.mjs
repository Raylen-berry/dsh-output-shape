// 套件：client 半（chip + 设置页）离线渲染与载荷断言。不需要真浏览器、不起 host 半。
//
// 为什么值得单列一套：界面这条路上最容易出的两种事故都是"静默"的 ——
//   ① chip 渲染抛错被槽丢弃 ⇒ 表现成"插件装了但什么都没发生"；
//   ② PUT 载荷漏带某个键 ⇒ 界面拨得动、盘上永远不落（cache-control v1.6.0 真实缺陷）。
// 两者都能在 renderToStaticMarkup + 假 fetch 下断死。
const PLUGIN = process.env.DSH_OS_PLUGIN || 'D:/DeepSeek/dsh-plugins/dsh-output-shape/'
const APP = process.env.DSH_APP_MODULES || 'D:/deepseek-harness/DSH Desktop/resources/app/node_modules/'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

// ---- 最小 DOM / loader / fetch 替身 ----
const styleTags = []
globalThis.document = {
  head: { appendChild: (el) => { styleTags.push(el.textContent); return el }, removeChild: () => {} },
  createElement: () => ({ type: '', textContent: '', setAttribute: () => {}, parentNode: null }),
  addEventListener: () => {}, removeEventListener: () => {},
  documentElement: { style: { removeProperty: () => {} }, removeAttribute: () => {} },
}
// Node 24 起 globalThis.navigator 是只读 getter，不能赋值；client.js 也不读它，跳过。
globalThis.window = globalThis

var loaded = null
globalThis.__ModuleLoader__ = {
  load: function (def) { loaded = def },
}

const calls = []
globalThis.fetch = function (url, init) {
  calls.push({ url: String(url), init: init || {} })
  const method = (init && init.method) || 'GET'
  let body
  if (String(url).includes('/os/settings.json')) {
    body = method === 'PUT'
      ? { ok: true, settings: JSON.parse(init.body), injected: JSON.parse(init.body).alwaysOn === true }
      : { ok: true, settings: { alwaysOn: false }, declared: null, injected: false }
  } else if (String(url).includes('/os/state')) {
    body = {
      ok: true, registered: ['i-have-adhd'], injected: false, disabledByEnv: false,
      skillFile: 'D:/x/skills/i-have-adhd/SKILL.md', settingsFile: 'C:/y/settings.json',
      shape: { bytes: 4867, maxBytes: 16384, truncated: false, originalBytes: 4867, keptBytes: 4867, lines: 93 },
    }
  } else if (String(url).includes('/os/shape.json')) {
    body = { ok: true, text: '# i-have-adhd\n\n规则正文。', bytes: 20, keptBytes: 20 }
  } else {
    body = { ok: false }
  }
  return Promise.resolve({
    ok: body.ok !== false, status: 200,
    json: function () { return Promise.resolve(body) },
  })
}

const React = await import('file:///' + APP + 'react/index.js')
const ReactDOMServer = await import('file:///' + APP + 'react-dom/server.node.js').catch(() => null)
const h = React.createElement

const reqMap = {
  react: React,
  'react-dom': (await import('file:///' + APP + 'react-dom/index.js').catch(() => null)),
}

// client.js 是 __ModuleLoader__ 包装的 UMD 风格文件，用 Function 注入 window 跑它。
const src = (await import('node:fs')).readFileSync(PLUGIN + 'client.js', 'utf8')
new Function('window', 'document', 'fetch', src)(globalThis.window, globalThis.document, globalThis.fetch)
ok('① client.js 注册了 __ModuleLoader__ 模块', !!loaded && loaded.id === 'dsh-output-shape', loaded && loaded.id)

const mod = loaded.factory(function (name) {
  if (reqMap[name] !== undefined && reqMap[name] !== null) return reqMap[name]
  throw new Error('missing require: ' + name)
})
ok('① 导出 apply 与 inject=[slots]', typeof mod.apply === 'function' && Array.isArray(mod.inject) && mod.inject[0] === 'slots')

// ---- ② 槽注册 ----
const regs = []
const slots = {
  inject: function (name, cb) { cb() },
  register: function (entry, render) { regs.push({ entry: entry, render: render }); return function () {} },
}
mod.apply({ get: function (n) { return n === 'slots' ? slots : undefined } })
const names = regs.map(function (r) { return r.entry.name })
ok('② 注册了设置页分区与输入条 chip 两处',
  names.indexOf('settings.section') >= 0 && names.indexOf('conversation.input.right') >= 0, names.join(','))
const sec = regs.find(function (r) { return r.entry.name === 'settings.section' }).entry
const chip = regs.find(function (r) { return r.entry.name === 'conversation.input.right' }).entry
ok('② 分区 label 是 4 字「输出形状」（与本机其它插件同族命名）', sec.label === '输出形状', sec.label)
ok('② 分区 order 落在 cache-control(58) 之后', sec.order > 58, String(sec.order))
ok('② chip order 避开 cache-control 的 200', chip.order !== 200 && chip.order > 200, String(chip.order))

// ---- ③ 渲染 ----
if (!ReactDOMServer || !ReactDOMServer.renderToStaticMarkup) {
  console.log('\n  SKIP  ③④ 需要 react-dom/server（本机 app node_modules 里没有）')
} else {
  const render = ReactDOMServer.renderToStaticMarkup
  // entry.inject 是"给槽的元信息"（modelAware 等），不是渲染函数；渲染函数在 register 的第二参。
  const chipHtml = render(h(mod.internals.ShapeChip))
  ok('③ chip 渲染出「形状」字样与状态徽标', /形状/.test(chipHtml) && /data-os-state/.test(chipHtml), chipHtml.slice(0, 120))
  ok('③ chip 带稳定的 data-os-* 锚点（DOM 断言与样式的契约名）',
    /data-os-chip="1"/.test(chipHtml) && /data-os-toggle="1"/.test(chipHtml))
  const pageHtml = render(h(mod.internals.ShapePage))
  ok('③ 设置页有开关本体（checkbox）', /type="checkbox"/.test(pageHtml) && /data-os-switch/.test(pageHtml))
  ok('③ 设置页写明这份规则在哪生效（R4 已摘出，不会重复注入）', /R4/.test(pageHtml) && pageHtml.includes('摘出'), '')
  ok('③ 设置页显示规则体积与上限', /4\.8 KB/.test(pageHtml) || pageHtml.includes('B /'), '')
  ok('③ 未表态时说明走 config 默认值（不把"没写过"渲染成"已关"）',
    pageHtml.includes('还没写过 settings.json'), '')

  // ---- ④ 保存载荷 ----
  calls.length = 0
  mod.internals.STORE.set({ loaded: true })
  await mod.internals.setAlwaysOn(true)
  const put = calls.find(function (c) { return c.init.method === 'PUT' })
  ok('④ chip/开关点下去发的是 PUT /os/settings.json', !!put && put.url.includes('/os/settings.json'), put && put.url)
  ok('④ 载荷只有 alwaysOn 一个键且是真布尔（不漏键、不夹带）',
    !!put && JSON.parse(put.init.body).alwaysOn === true && Object.keys(JSON.parse(put.init.body)).length === 1,
    put && put.init.body)
  ok('④ 保存成功后 STORE 反映生效值', mod.internals.STORE.state.injected === true)

  calls.length = 0
  mod.internals.STORE.set({ loaded: false, error: '' })
  await mod.internals.setAlwaysOn(true)
  ok('④ 没读到过设置前绝不 PUT（否则会用默认值盖掉用户真实配置）',
    calls.filter(function (c) { return c.init.method === 'PUT' }).length === 0 && /阻止保存/.test(mod.internals.STORE.state.error),
    mod.internals.STORE.state.error.slice(0, 40))

  mod.internals.STORE.set({ loaded: true, error: '' })
  await mod.internals.loadPreview()
  ok('④ 「查看规则正文」读的是 /os/shape.json（注入形态，不是原文）',
    calls.some(function (c) { return c.url.includes('/os/shape.json') }))
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exitCode = fail === 0 ? 0 : 1
