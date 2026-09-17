// 套件：清单自洽性（manifest integrity）。
//
// 为什么单独一套：2026-09-17 的**安全模式事故**不是逻辑 bug，是清单少写一行。
// 宿主 client-modules 在 compose 阶段对每个声明了 dsh.client 的包做这件事
// （node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:681）：
//
//   if (clientRel === void 0)
//     throw new Error(`client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`)
//
// 这个 throw 发生在**整张图组装路径上**，于是一个插件的清单缺陷让所有插件一起不进图 ——
// 表现就是 DSH 进安全模式、技能目录从 15 个缩到 3 个、/cc/ /bl/ 等老路由全 404。
// 而它当时的测试是 70/70 全绿的：那套测试直接 import index.js / 用 Function 跑 client.js，
// **根本不经过 Node 的 exports 解析**。所以本套件断言的是"解析这一步会不会炸"，
// 而不是"代码对不对"。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + '  [' + extra + ']') }
}

console.log('\n— ① dsh.client ⇄ exports["./client"] 必须同时存在 —')
const declaresClient = !!(PKG.dsh && PKG.dsh.client)
const exp = PKG.exports && PKG.exports['./client']
const rel = typeof exp === 'string' ? exp : (exp && typeof exp.default === 'string' ? exp.default : undefined)

ok('① 声明了 dsh.client（有界面半）', declaresClient)
ok('① 且 exports 里有 "./client" 子路径 —— 缺这一行 = 宿主 compose 抛错 = 全机进安全模式',
  rel !== undefined, JSON.stringify(exp))
ok('① ./client 指向的文件真实存在', !!rel && fs.existsSync(path.join(ROOT, rel.replace(/^\.\//, ''))), String(rel))

console.log('\n— ② 与本机其它带界面的插件同形 —')
const SIBLINGS = {
  'dsh-cache-control': '../dsh-cache-control/package.json',
  'dsh-note-changes': '../dsh-note-changes/package.json',
  'dsh-gomoku': '../dsh-gomoku/package.json',
}
for (const [name, p] of Object.entries(SIBLINGS)) {
  const fp = path.resolve(ROOT, p)
  if (!fs.existsSync(fp)) { console.log(`  SKIP  ${name}（不在本机该路径）`); continue }
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const sRel = j.exports && j.exports['./client']
  if (!(j.dsh && j.dsh.client)) continue
  ok(`② 参照 ${name}：它也走 "./client" → ./client.js，本包写法一致`,
    sRel === rel, `${name}=${JSON.stringify(sRel)} 本包=${JSON.stringify(rel)}`)
}

console.log('\n— ③ 真解析一次（模拟宿主的取包动作）—')
const require_ = createRequire(path.join(ROOT, 'noop.js'))
let resolvedEntry = null
try { resolvedEntry = require_.resolve(PKG.name, { paths: [path.resolve(ROOT, '..')] }) } catch (e) { resolvedEntry = 'ERR:' + e.code }
ok('③ 裸包名可解析（宿主按 loader 名取入口）', typeof resolvedEntry === 'string' && !String(resolvedEntry).startsWith('ERR:'), String(resolvedEntry).split(path.sep).slice(-2).join('/'))
let resolvedPkgJson = null
try { resolvedPkgJson = require_.resolve(PKG.name + '/package.json', { paths: [path.resolve(ROOT, '..')] }) } catch (e) { resolvedPkgJson = 'ERR:' + e.code }
ok('③ <pkg>/package.json 可解析（client-modules 靠它定位包根）', !String(resolvedPkgJson).startsWith('ERR:'), String(resolvedPkgJson).split(path.sep).slice(-2).join('/'))

console.log('\n— ④ files 与 dsh.client 的连带项 —')
ok('④ files 里列了 client.js（否则发布产物没有界面半，装了也没 chip）', (PKG.files || []).includes('client.js'))
ok('④ dsh.client.platform = web', PKG.dsh.client.platform === 'web')
ok('④ dsh.client.inject 含 slots 提供方（本包 client.js 的 exports.inject）',
  Array.isArray(PKG.dsh.client.inject) && PKG.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
ok('④ react 在 peerDependencies（client 半 require("react")）', !!(PKG.peerDependencies && PKG.peerDependencies.react))

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exitCode = fail === 0 ? 0 : 1
