// ============================================================================
// dsh-output-shape · 宿主端（Host half）
//
// 把 ayghri/i-have-adhd 的输出形状规则做成 DSH 可用的两种形态：
//
//   ① 技能 `i-have-adhd`（默认开）—— 注册进 ctx.skills，按需调用；
//      正文只有一份：skills/i-have-adhd/SKILL.md。
//   ② 常驻注入（默认**关**）—— 走 ctx.systemPrompt.section，段名
//      `dsh-output-shape:output-shape`、order 405（紧跟在会话守则 400 之后、
//      plan 政策 500 之前）。开之前请先把 dsh-cache-control 的 session-gate.md
//      里那节 R4 删掉，否则同一套规则会被注入两遍、每请求多花一份 token。
//
// 常驻注入的文本**直接取 SKILL.md 的正文**（剥掉 frontmatter）——上游的
// always-on hook 就是这么干的。好处是规则只有一份真源，永远不会漂。
//
// ── Cordis 插件契约（照 dsh-term-design / dsh-cache-control 对齐）──
//   ① 入口必须叫 apply：`export async function apply(ctx, rawConfig)`。
//   ② config 是 apply 的第二个参数，不是 ctx.config。
//   ③ 路由用 ctx.effect(() => webServer.register({ kind, path, handler }))；
//      没有顶层 method 字段，方法在 handler 内部判断。
//   ④ apply 不返回 dispose 对象；清理统一交给 ctx.effect。
// ============================================================================

import { existsSync, readFileSync, statSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-output-shape'
export const inject = ['webServer']

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.')
const SKILLS_ROOT = path.join(PACKAGE_ROOT, 'skills')
const SKILL_FILE = path.join(SKILLS_ROOT, 'i-have-adhd', 'SKILL.md')

/** 段名列全宿主唯一，重名会被宿主直接抛错。 */
export const SHAPE_SECTION = 'dsh-output-shape:output-shape'
/** 400 = dsh-cache-control 的会话守则；500 = plan 政策。405 落在两者之间。 */
export const SHAPE_SECTION_ORDER = 405
/** 常驻注入文本的字节上限。这段文本每请求重复计费，必须留硬闸（与会话守则同口径）。 */
export const SHAPE_MAX_BYTES = 16 * 1024
/** 逃生开关：置 1 则无论设置如何都不注入常驻段（技能注册不受影响）。 */
export const DISABLE_ENV = 'DSH_OUTPUT_SHAPE_DISABLE'

const DEFAULTS = {
  registerSkills: true,
  alwaysOn: false,
  maxBytes: SHAPE_MAX_BYTES,
}

export function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh')
}

export function settingsFile() {
  return path.join(dshHome(), 'dsh-output-shape', 'settings.json')
}

export function normalizeConfig(raw) {
  const config = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const maxBytes = Number(config.maxBytes)
  return {
    registerSkills: config.registerSkills !== false,
    alwaysOn: config.alwaysOn === true,
    maxBytes: Number.isFinite(maxBytes) && maxBytes >= 1024 ? Math.floor(maxBytes) : SHAPE_MAX_BYTES,
  }
}

// ---------------------------------------------------------------------------
// SKILL.md 解析
// ---------------------------------------------------------------------------

/**
 * 只取本插件需要的 frontmatter 字段。
 *
 * 必须处理 YAML 块标量（`description: >` / `|` 后跟缩进正文）：只认单行 `key: value`
 * 的实现会把块标量解析成字面量 ">"，description 变成 1 个字符 —— 技能目录里就会出现
 * 一个说不清自己干什么的技能。
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { attrs: {}, body: text }
  const lines = match[1].split(/\r?\n/)
  const attrs = {}
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i])
    if (!kv) continue
    const key = kv[1]
    const inline = kv[2].trim()
    if (/^[>|][+-]?\d*$/.test(inline)) {
      const folded = inline.startsWith('>')
      const block = []
      let j = i + 1
      for (; j < lines.length; j += 1) {
        const line = lines[j]
        if (line.trim() === '') { block.push(''); continue }
        if (!/^[ \t]/.test(line)) break
        block.push(line.replace(/^[ \t]+/, ''))
      }
      i = j - 1
      const blockText = folded
        ? block.join(' ').replace(/[ \t]+/g, ' ').trim()
        : block.join('\n').trim()
      if (blockText !== '') attrs[key] = blockText
      continue
    }
    let value = inline
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    attrs[key] = value
  }
  return { attrs, body: text.slice(match[0].length) }
}

/** 常驻注入的形态：剥掉 frontmatter、正文为全文。 */
export function shapeBody(text) {
  return parseFrontmatter(String(text || '')).body
}

// ---------------------------------------------------------------------------
// 注入形态：花括号中和 + 截断（三元事实与 cache-control 同口径）
// ---------------------------------------------------------------------------

/**
 * renderPrompt 对成对变量引用是**抛错**策略（unknown variable ⇒ 该 agent 每次组装失败）。
 * 规则由用户自行编辑，绝不能因为写了 `{{...}}` 就把整个会话弄挂 ⇒ 注入前换全角字形。
 */
export function sanitizeShapeText(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim()
  let guard = 0
  while ((/\{\{|\}\}/.test(text)) && guard++ < 32) {
    text = text.replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝')
  }
  return text
}

/**
 * 截断后返回 `{ text, originalBytes, keptBytes, truncated }`。
 *
 * 调用方一律读 `truncated` 判断"有没有被砍过"，**不要**拿返回文本长度跟上限比：
 * 截断后的长度必然小于上限（`bytes >= max` 恒为 false ⇒ 被砍了却显示"未截断"），
 * 而原文恰好等于上限时又会被误判成截断。两个方向都只能用显式标记。
 */
export function truncateBytes(text, max) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) {
    return { text, originalBytes: buf.length, keptBytes: buf.length, truncated: false }
  }
  let cut = text.slice(0, max)
  while (Buffer.byteLength(cut, 'utf8') > max - 32) cut = cut.slice(0, Math.floor(cut.length * 0.9))
  cut = cut.replace(/[\uD800-\uDFFF]$/, '')
  const kept = cut + '\n\n[…输出形状规则超出字节上限，其余部分已省略]'
  return { text: kept, originalBytes: buf.length, keptBytes: Buffer.byteLength(kept, 'utf8'), truncated: true }
}

const shapeCache = { key: '', text: '', record: null }

function cacheShape(key, record) {
  shapeCache.key = key
  shapeCache.text = record.text
  shapeCache.record = record
  return shapeCache.text
}

/** assemble 热路径要同步读，所以这里用 mtime+size 记忆化，命中即零 IO。 */
export function loadShapeSync(maxBytes = SHAPE_MAX_BYTES) {
  let st = null
  try { st = statSync(SKILL_FILE) } catch { st = null }
  if (!st || !st.isFile()) {
    let builtin = ''
    try { builtin = readFileSync(SKILL_FILE, 'utf8') } catch { builtin = '' }
    return cacheShape('missing', truncateBytes(sanitizeShapeText(shapeBody(builtin)), maxBytes))
  }
  const key = SKILL_FILE + '|' + st.mtimeMs + '|' + st.size + '|' + maxBytes
  if (key !== shapeCache.key) {
    let raw = ''
    try { raw = readFileSync(SKILL_FILE, 'utf8') } catch { raw = '' }
    cacheShape(key, truncateBytes(sanitizeShapeText(shapeBody(raw)), maxBytes))
  }
  return shapeCache.text
}

export function shapeMeta(maxBytes = SHAPE_MAX_BYTES) {
  const text = loadShapeSync(maxBytes)
  const info = shapeCache.record || { originalBytes: 0, keptBytes: 0, truncated: false }
  return {
    skillFile: SKILL_FILE,
    bytes: Buffer.byteLength(text, 'utf8'),
    maxBytes,
    truncated: info.truncated,
    originalBytes: info.originalBytes,
    keptBytes: info.keptBytes,
    lines: text ? text.split('\n').length : 0,
  }
}

// ---------------------------------------------------------------------------
// 设置（$DSH_HOME/dsh-output-shape/settings.json，机器本地、不随仓库走）
// ---------------------------------------------------------------------------

export function sanitizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return { alwaysOn: src.alwaysOn === true }
}

// 与规则文本同一条思路：assemble 热路径要同步读，所以按 mtime+size 记忆化，
// 命中即零 IO。**不能用"读一次就永远记住"的写法** —— 那样手改盘上的 settings.json
// 不会生效，界面上表现为"开关点了/文件改了，形状却没变"（本插件首版就是这个 bug，
// 被 verify-shape 的 ④ 组抓出来）。
const settingsCache = { key: '', value: null }

export function readSettingsSync() {
  let st = null
  try { st = statSync(settingsFile()) } catch { st = null }
  if (!st || !st.isFile()) {
    settingsCache.key = 'missing'
    settingsCache.value = null
    return null
  }
  const key = st.mtimeMs + '|' + st.size
  if (key !== settingsCache.key) {
    try {
      settingsCache.value = sanitizeSettings(JSON.parse(readFileSync(settingsFile(), 'utf8')))
    } catch {
      // 文件在但解析不了 ⇒ null（**不是** {alwaysOn:false}）：要能区分
      // "用户明确写了 false" 与"还没表态/读不出来"，后者才轮到 config 的 alwaysOn 兜底。
      settingsCache.value = null
    }
    settingsCache.key = key
  }
  return settingsCache.value
}

export async function readSettings() {
  return readSettingsSync()
}

export async function writeSettings(next) {
  const clean = sanitizeSettings(next)
  const file = settingsFile()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(clean, null, 2) + '\n', 'utf8')
  settingsCache.key = ''          // 让下一次读盘重新 stat，而不是等 mtime 变化
  settingsCache.value = clean
  return clean
}

/**
 * 常驻段是否真的注入。
 *
 * 优先级：逃生开关(env) 压过一切 → 落盘的 settings.json 表态过就听它的 →
 * 没表过态才用 cordis config 里的 alwaysOn 兜底。
 */
export function shapeEnabled(config, settings) {
  if (process.env[DISABLE_ENV] === '1') return false
  const s = settings === undefined ? readSettingsSync() : settings
  if (s) return s.alwaysOn === true
  return config ? config.alwaysOn === true : false
}

// ---------------------------------------------------------------------------
// 技能注册
// ---------------------------------------------------------------------------

export async function loadSkills(root) {
  let entries
  try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch { return [] }
  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    const file = path.join(dir, 'SKILL.md')
    if (!existsSync(file)) continue
    let text
    try { text = await fsp.readFile(file, 'utf8') } catch { continue }
    const { attrs, body } = parseFrontmatter(text)
    const skillName = (attrs.name || entry.name).trim()
    const description = (attrs.description || '').replace(/\s+/g, ' ').trim()
    // name 或 description 缺失就跳过：目录里躺一个没有说明的技能比少一个更糟。
    if (skillName === '' || description === '') continue
    skills.push({
      name: skillName,
      description,
      whenToUse: attrs.whenToUse || attrs.when_to_use || undefined,
      contentRange: body.trim() === '' ? text : body.trim(),
      resourceBase: { kind: 'directory', path: dir },
      dir,
    })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return skills
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let overflow = false
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) { overflow = true; chunks.length = 0; return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (overflow) { reject(new Error('body too large (> ' + maxBytes + ' B)')); return }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export async function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    console.error('[dsh-output-shape] webServer 服务不存在，路由未注册')
  }

  await readSettings()
  const disposers = []
  let registered = []
  async function registerSkillPack() {
    const names = []
    const skillsService = ctx.get('skills')
    if (skillsService === undefined) return names
    let skills = []
    try {
      skills = await loadSkills(SKILLS_ROOT)
    } catch (err) {
      console.warn('[dsh-output-shape] 技能包读取失败：' + String((err && err.message) || err))
      return names
    }
    for (const skill of skills) {
      try {
        const dispose = skillsService.register({
          name: skill.name,
          description: skill.description,
          ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
          content: skill.contentRange,
          source: 'custom',
          provider: 'dsh-output-shape',
          invocation: { modelInvocable: true, userInvocable: true },
          resourceBase: skill.resourceBase,
          path: path.join(skill.dir, 'SKILL.md'),
        })
        disposers.push(dispose)
        names.push(skill.name)
      } catch (err) {
        console.warn(`[dsh-output-shape] 技能 ${skill.name} 注册失败：` + String((err && err.message) || err))
      }
    }
    return names
  }

  if (config.registerSkills) {
    registered = await registerSkillPack()
    if (registered.length === 0 && ctx.get('skills') === undefined) {
      console.warn('[dsh-output-shape] skills 服务不可用，技能未注册')
    }
  }

  // ---- 常驻注入：默认关；打开前请先删 session-gate.md 的 R4，避免重复注入 ----
  try {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      try {
        promptCtx.systemPrompt.section({
          name: SHAPE_SECTION,
          order: SHAPE_SECTION_ORDER,
          text: () => {
            try {
              if (!shapeEnabled(config, readSettingsSync())) return ''
              return loadShapeSync(config.maxBytes)
            } catch {
              return ''
            }
          },
        })
        console.log('[dsh-output-shape] 常驻段已挂载 (order ' + SHAPE_SECTION_ORDER + '，当前'
          + (shapeEnabled(config, readSettingsSync()) ? '开' : '关') + ')')
      } catch (err) {
        console.warn('[dsh-output-shape] 常驻段注册被拒：' + String((err && err.message) || err))
      }
    })
  } catch (err) {
    console.warn('[dsh-output-shape] systemPrompt 不可用，常驻段关闭：' + String((err && err.message) || err))
  }

  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/os/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const settings = readSettingsSync()
        sendJson(res, 200, {
          ok: true,
          packageRoot: PACKAGE_ROOT,
          skillFile: SKILL_FILE,
          registered,
          registerSkills: config.registerSkills,
          // null = 还没有 settings.json（还没表态过），此时由 config.alwaysOn 兜底
          alwaysOn: settings ? settings.alwaysOn : null,
          configAlwaysOn: config.alwaysOn,
          injected: shapeEnabled(config, settings),
          disabledByEnv: process.env[DISABLE_ENV] === '1',
          section: SHAPE_SECTION,
          order: SHAPE_SECTION_ORDER,
          shape: shapeMeta(config.maxBytes),
          settingsFile: settingsFile(),
        })
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/os/settings.json',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const settings = readSettingsSync()
          sendJson(res, 200, { ok: true, settings, injected: shapeEnabled(config, settings) })
          return
        }
        if (req.method !== 'PUT') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        let parsed
        try {
          parsed = JSON.parse(await readBody(req))
        } catch (err) {
          sendJson(res, 400, { ok: false, error: 'bad json: ' + String((err && err.message) || err) })
          return
        }
        try {
          const saved = await writeSettings(parsed)
          sendJson(res, 200, { ok: true, settings: saved, injected: shapeEnabled(config, saved) })
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/os/skills/reload',
      handler: async (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        if (ctx.get('skills') === undefined) { sendJson(res, 503, { ok: false, error: 'skills 服务不可用' }); return }
        const names = await registerSkillPack()
        sendJson(res, 200, { ok: true, registered: names, note: '同名技能 first-wins；改已有技能正文需重启' })
      },
    }))
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* 卸载顺序无关紧要 */ }
    }
  })

  console.log(
    '[dsh-output-shape] 宿主就绪 · 路由 /os/* · 技能 '
    + (registered.length ? registered.join(', ') : '未注册')
    + ' · 常驻注入 ' + (shapeEnabled(config, readSettingsSync()) ? '开' : '关'),
  )
}
