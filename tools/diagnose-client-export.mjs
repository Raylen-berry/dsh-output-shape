// 诊断脚本：复刻宿主 client-modules 的判定（lib/index.js:681）——
// "declares dsh.client but exports no ./client bundle" 是**抛错**，会打断整个 compose。
import fs from 'node:fs'
const DIRS = {
  'dsh-output-shape': 'D:/DeepSeek/dsh-plugins/dsh-output-shape',
  'dsh-cache-control': 'D:/DeepSeek/dsh-plugins/dsh-cache-control',
  'dsh-gomoku': 'D:/DeepSeek/dsh-plugins/dsh-gomoku',
  'dsh-browser-live': 'D:/DeepSeek/dsh-plugins/dsh-browser-live',
  'dsh-note-changes': 'D:/DeepSeek/dsh-plugins/dsh-note-changes',
  'dsh-video-prompt': 'D:/DeepSeek/dsh-plugins/dsh-video-prompt',
  'dsh-bg-atelier': 'D:/DeepSeek/dsh-plugins/dsh-desktop-wallpaper',
  'dsh-term-design': 'D:/DeepSeek/dsh-plugins/dsh-term-design',
}
let bad = 0
for (const [name, dir] of Object.entries(DIRS)) {
  const j = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8'))
  const declares = !!(j.dsh && j.dsh.client)
  const exp = j.exports ? j.exports['./client'] : undefined
  const rel = typeof exp === 'string' ? exp : exp && typeof exp.default === 'string' ? exp.default : undefined
  const exists = rel ? fs.existsSync(dir + '/' + rel.replace(/^\.\//, '')) : false
  const fatal = declares && rel === undefined
  if (fatal || (rel && !exists)) bad++
  console.log(
    name.padEnd(20),
    'dsh.client=' + String(declares).padEnd(5),
    './client=' + String(rel).padEnd(14),
    'fileExists=' + String(exists).padEnd(5),
    fatal ? '<<< FATAL: declares dsh.client but exports no ./client' : (rel && !exists ? '<<< FATAL: export points at missing file' : 'ok'),
  )
}
console.log('\nfatal count:', bad)
