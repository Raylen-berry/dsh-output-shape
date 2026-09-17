// 套件总入口：跑 tools/ 下所有 verify-*.mjs，汇总结果。
//
// 规矩：tools/ 下每个 verify-*.mjs **必须**登记在 SUITES 或 EXCLUDED 里，
// 否则直接判失败 —— 新增测试而忘了纳入，等于测试没写（这条来自 dsh-cache-control）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLS = HERE

const SUITES = ['verify-manifest.mjs', 'verify-shape.mjs', 'verify-client.mjs']
// 完整性闸只扫 verify-*.mjs；诊断脚本另放，这里留一行说明它是什么。
const EXCLUDED = {}

const files = fs.readdirSync(TOOLS).filter((f) => /^verify-.*\.mjs$/.test(f)).sort()
const known = new Set([...SUITES, ...Object.keys(EXCLUDED)])
const missing = files.filter((f) => !known.has(f))
const stale = [...known].filter((f) => !files.includes(f))

if (process.argv.includes('--list')) {
  console.log('跑这些：\n  ' + SUITES.join('\n  '))
  const ex = Object.entries(EXCLUDED)
  console.log('\n排除：' + (ex.length ? '' : '（无）'))
  for (const [f, why] of ex) console.log('  ' + f + ' —— ' + why)
  process.exit(0)
}

console.log('='.repeat(72))
console.log('dsh-output-shape 测试套件')
console.log('='.repeat(72))

let bad = 0
const results = []
for (const suite of SUITES) {
  const started = Date.now()
  const r = spawnSync(process.execPath, [path.join(TOOLS, suite)], { encoding: 'utf8', env: process.env })
  const ms = Date.now() - started
  const out = (r.stdout || '') + (r.stderr || '')
  const tail = out.trim().split('\n').filter((l) => l.includes('结果：')).pop() || ''
  if (r.status !== 0) bad += 1
  results.push({ suite, code: r.status, ms, tail, out })
  if (r.status !== 0) console.log('\n---- ' + suite + ' 失败输出 ----\n' + out)
}

console.log('\n' + '='.repeat(72))
console.log('汇总')
console.log('='.repeat(72))
for (const r of results) {
  console.log(' ' + (r.code === 0 ? '✅' : '❌') + ' tools/' + r.suite.padEnd(32) + (r.ms / 1000).toFixed(1) + 's  ' + r.tail)
}

if (missing.length) {
  console.log('\n❌ 有测试没登记进 tools/run-all.mjs：' + missing.join(', '))
  bad += 1
}
if (stale.length) {
  console.log('\n❌ SUITES/EXCLUDED 里登记了不存在的文件：' + stale.join(', '))
  bad += 1
}

console.log('\n' + (bad === 0 ? '✓ 全部通过' : '✗ ' + bad + ' 个套件失败'))
process.exitCode = bad === 0 ? 0 : 1
