// 套件：dsh-output-shape 的技能注册 / 注入形态 / 开关语义 / 三条路由。
//
// 全程在临时 DSH_HOME 里跑，不读也不写真实 $DSH_HOME。
// A/B 复现：设 DSH_OS_INDEX 指向改动前那份 index.js 即可看断言变红。
//
// 用法：node tools/verify-shape.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const INDEX = process.env.DSH_OS_INDEX || path.join(ROOT, 'index.js')

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-os-verify-'))
process.env.DSH_HOME = HOME
delete process.env.DSH_OUTPUT_SHAPE_DISABLE

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}
const B = (s) => Buffer.byteLength(s, 'utf8')
const J = (o) => JSON.stringify(o).slice(0, 160)

const m = await import(pathToFileURL(INDEX).href)
const MAX = m.SHAPE_MAX_BYTES

// ---- ① 技能包：解析 + 注册 ----
console.log('\n— ① 技能包 —')
const skills = await m.loadSkills(path.join(ROOT, 'skills'))
ok('① 找到 1 个技能', skills.length === 1, J(skills.map((s) => s.name)))
const skill = skills[0] || {}
ok('① 技能名是 i-have-adhd', skill.name === 'i-have-adhd', skill.name)
ok('① description 是完整一句话（不是被块标量坑成 ">"）',
  typeof skill.description === 'string' && skill.description.length > 30, String(skill.description).slice(0, 40))
ok('① whenToUse 解析出来了', typeof skill.whenToUse === 'string' && skill.whenToUse.length > 10,
  String(skill.whenToUse).slice(0, 40))
ok('① 正文里没有 frontmatter 残留',
  !skill.contentRange.startsWith('---') && skill.contentRange.includes('# i-have-adhd'))

// ---- ② 常驻注入形态：剥 frontmatter + 花括号中和 ----
console.log('\n— ② 注入形态 —')
const raw = fs.readFileSync(path.join(ROOT, 'skills', 'i-have-adhd', 'SKILL.md'), 'utf8')
const body = m.shapeBody(raw)
ok('② shapeBody 剥掉了 frontmatter', !body.startsWith('---') && body.includes('# i-have-adhd'))
ok('② 剥完的内容与原文件正文逐字节一致（去掉首尾空白）', body.trim() === raw.split(/^---$/m).slice(2).join('---').trim())

const hostile = '前文\n{{model}} 合法变量\n{{bogus_var}} 未知变量\n{{unclosed 只有开\na } b {{ 孤立'
const clean = m.sanitizeShapeText(hostile)
ok('② 成对花括号已全部中和', !/\{\{|\}\}/.test(clean), clean.slice(0, 40).replace(/\n/g, ' '))
ok('② 变量名没被替换成真值', !clean.includes('qwen') && clean.includes('bogus_var'))
ok('② 孤立单花括号原样保留（不误伤正文）', clean.includes('a } b'))
ok('② 行数未被破坏', clean.split('\n').length === hostile.split('\n').length)

// ---- ③ 截断：三元事实 + 两个边界 ----
console.log('\n— ③ 截断 —')
const over = m.truncateBytes('规'.repeat(Math.ceil((MAX + 3000) / 3)), MAX)
ok('③ 超长 ⇒ truncated=true 且原/留长度都带出',
  over.truncated === true && over.originalBytes === B('规'.repeat(Math.ceil((MAX + 3000) / 3))) && over.keptBytes < over.originalBytes,
  J({ f: over.truncated, o: over.originalBytes, k: over.keptBytes }))
ok('③ 保留长度落在 (0.85×上限, 上限]', over.keptBytes <= MAX && over.keptBytes > MAX * 0.85, over.keptBytes + ' / ' + MAX)
ok('③ 保留文本带省略提示', over.text.includes('已省略'))
// 旧判据（bytes >= max）在这两个样本上会给出错误答案，必须用显式标记。
ok('③ 照妖镜：超长样本 bytes < maxBytes，靠长度比会漏判',
  B(over.text) < MAX && over.truncated === true, B(over.text) + ' < ' + MAX)
const exact = m.truncateBytes('x'.repeat(MAX), MAX)
ok('③ 恰好等于上限 ⇒ truncated=false 且逐字节原样',
  exact.truncated === false && exact.text === 'x'.repeat(MAX) && exact.bytes === undefined && exact.keptBytes === MAX)
ok('③ 照妖镜：恰好压线时 bytes === maxBytes，靠长度比会误报',
  B(exact.text) === MAX && exact.truncated === false)
const under = m.truncateBytes('y'.repeat(MAX - 1), MAX)
ok('③ 上限 -1 ⇒ truncated=false 且原样', under.truncated === false && under.keptBytes === MAX - 1)

// ---- ④ apply：技能注册 + 段注册 + 开关语义 ----
console.log('\n— ④ apply —')
const registeredSkills = []
const registeredRoutes = new Map()
const sections = []
const webServer = { register: (r) => { registeredRoutes.set(r.path, r.handler); return () => registeredRoutes.delete(r.path) } }
const ctx = {
  get: (n) => {
    if (n === 'webServer') return webServer
    if (n === 'skills') return { register: (s) => { registeredSkills.push(s); return () => {} } }
    return undefined
  },
  effect: (fn) => fn(),
  inject: (deps, cb) => { cb({ systemPrompt: { section: (s) => { sections.push(s); return () => {} } } }) },
}
await m.apply(ctx, {})
ok('④ 技能注册了 i-have-adhd', registeredSkills.length === 1 && registeredSkills[0].name === 'i-have-adhd',
  J(registeredSkills.map((s) => s.name)))
ok('④ 技能可被模型与用户调用',
  registeredSkills[0].invocation.modelInvocable === true && registeredSkills[0].invocation.userInvocable === true)
ok('④ 段名与 order 符合契约',
  sections.length === 1 && sections[0].name === 'dsh-output-shape:output-shape' && sections[0].order === 405,
  J({ n: sections[0] && sections[0].name, o: sections[0] && sections[0].order }))
const sectionText = () => sections[0].text()
ok('④ 默认不注入：text() 返回空串（宿主会丢弃空段）', sectionText() === '', JSON.stringify(sectionText()))

const settingsPath = path.join(HOME, 'dsh-output-shape', 'settings.json')
fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify({ alwaysOn: true }), 'utf8')
ok('④ settings.json 表态开 ⇒ text() 给出规则正文',
  sectionText().includes('# i-have-adhd') && sectionText().includes('首行即可行动'), sectionText().slice(0, 30).replace(/\n/g, ' '))
ok('④ 注入形态里没有 frontmatter（不会把 YAML 送进提示词）', !sectionText().startsWith('---'))
fs.writeFileSync(settingsPath, JSON.stringify({ alwaysOn: false }), 'utf8')
ok('④ settings.json 表态关 ⇒ text() 又回到空串（改盘即生效，无需重启）', sectionText() === '')
process.env.DSH_OUTPUT_SHAPE_DISABLE = '1'
fs.writeFileSync(settingsPath, JSON.stringify({ alwaysOn: true }), 'utf8')
ok('④ 逃生开关压过一切：env=1 ⇒ 即使设置开着也不注入', sectionText() === '')
delete process.env.DSH_OUTPUT_SHAPE_DISABLE
ok('④ 去掉逃生开关 ⇒ 立即恢复注入', sectionText().includes('# i-have-adhd'))

// config 兜底：settings.json 不存在（传 null）时才轮到 config.alwaysOn
fs.rmSync(settingsPath, { force: true })
ok('④ 没表过态 + config.alwaysOn=true ⇒ 用 config 兜底',
  m.shapeEnabled({ alwaysOn: true, maxBytes: MAX }, null) === true)
ok('④ 没表过态 + config.alwaysOn=false ⇒ 不注入',
  m.shapeEnabled({ alwaysOn: false, maxBytes: MAX }, null) === false)
ok('④ 表过态时 config 不参与：settings=false 压过 config=true',
  m.shapeEnabled({ alwaysOn: true, maxBytes: MAX }, { alwaysOn: false }) === false)

// ---- ⑤ HTTP 路由 ----
console.log('\n— ⑤ 路由 —')
const server = http.createServer((req, res) => {
  const h = registeredRoutes.get((req.url || '').split('?')[0])
  if (!h) { res.writeHead(404); res.end('{}'); return }
  h(req, res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const getJ = async (p) => { const r = await fetch(base + p, { cache: 'no-store' }); return { status: r.status, body: await r.json() } }
const putJ = async (p, obj) => {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
  return { status: r.status, body: await r.json() }
}

const putRaw = async (p, raw) => {
  const r = await fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: raw })
  return { status: r.status, body: await r.json() }
}

const st = await getJ('/os/state')
ok('⑤ GET /os/state 可用且报出段名/order/技能',
  st.status === 200 && st.body.ok === true && st.body.section === 'dsh-output-shape:output-shape'
  && st.body.order === 405 && st.body.registered.includes('i-have-adhd'), J({ s: st.status }))
ok('⑤ /os/state 带注入文本的截断三元组',
  st.body.shape && typeof st.body.shape.truncated === 'boolean'
  && typeof st.body.shape.originalBytes === 'number' && typeof st.body.shape.keptBytes === 'number'
  && st.body.shape.keptBytes === st.body.shape.bytes, J(st.body.shape))
ok('⑤ 当前规则远未触及上限（不是"标了未截断其实被砍"）',
  st.body.shape.truncated === false && st.body.shape.bytes < st.body.shape.maxBytes,
  st.body.shape.bytes + ' / ' + st.body.shape.maxBytes)

const g0 = await getJ('/os/settings.json')
ok('⑤ GET /os/settings.json：还没表态时 settings 为 null（不是伪装成 false）',
  g0.status === 200 && g0.body.settings === null && g0.body.injected === false, J(g0.body))

const p1 = await putJ('/os/settings.json', { alwaysOn: true })
ok('⑤ PUT 打开 ⇒ 落盘且立即生效', p1.status === 200 && p1.body.settings.alwaysOn === true && p1.body.injected === true, J(p1.body))
ok('⑤ PUT 之后 GET 读到的就是新值', (await getJ('/os/settings.json')).body.settings.alwaysOn === true)
ok('⑤ PUT 之后段文本真的出来了', sectionText().includes('# i-have-adhd'))

const p2 = await putJ('/os/settings.json', { alwaysOn: 'yes' })
ok('⑤ 非布尔值一律视为关（不被真值污染）',
  p2.status === 200 && p2.body.settings.alwaysOn === false && p2.body.injected === false, J(p2.body))

const pBad = await putRaw('/os/settings.json', '{not json')
ok('⑤ 坏 JSON 返回 400 而不是 500', pBad.status === 400, String(pBad.status))
ok('⑤ 坏 JSON 不会把已表态的设置改坏',
  (await getJ('/os/settings.json')).body.settings.alwaysOn === false)

const g405 = await fetch(base + '/os/state', { method: 'POST' })
ok('⑤ 只读路由拒 POST（405）', g405.status === 405, String(g405.status))
const g405b = await fetch(base + '/os/skills/reload')
ok('⑤ POST 路由拒 GET（405）', g405b.status === 405, String(g405b.status))
const rl = await fetch(base + '/os/skills/reload', { method: 'POST' })
ok('⑤ POST /os/skills/reload 可用', rl.status === 200 && (await rl.json()).registered.includes('i-have-adhd'))

// ---- ⑥ 契约：段名唯一 + 与 CI 清单一致 ----
console.log('\n— ⑥ 契约 —')
ok('⑥ 段名带插件前缀（宿主内唯一）', /^dsh-output-shape:/.test(m.SHAPE_SECTION), m.SHAPE_SECTION)
ok('⑥ order 落在会话守则(400) 与 plan 政策(500) 之间', m.SHAPE_SECTION_ORDER > 400 && m.SHAPE_SECTION_ORDER < 500)
ok('⑥ 上限与会话守则同口径（16 KB）', MAX === 16 * 1024, String(MAX))

server.closeAllConnections?.()
await new Promise((r) => server.close(r))
fs.rmSync(HOME, { recursive: true, force: true })

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exitCode = fail === 0 ? 0 : 1
