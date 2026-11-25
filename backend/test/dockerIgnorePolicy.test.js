const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')

// 只实现本仓 .dockerignore 用到的 Docker 通配子集：* 不跨目录、** 跨目录、末尾 / 匹配目录内容。
function globRegex(pattern) {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      i++
      if (pattern[i + 1] === '/') {
        i++
        out += '(?:.*/)?'
      } else out += '.*'
    } else if (ch === '*') out += '[^/]*'
    else if (ch === '?') out += '[^/]'
    else out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp(out + (pattern.endsWith('/') ? '' : '(?:/|$)'))
}

function ignored(relativePath, rules) {
  const file = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  let result = false
  for (const raw of rules) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    const pattern = (negate ? line.slice(1) : line).replace(/^\//, '')
    if (globRegex(pattern).test(file)) result = !negate
  }
  return result
}

test('.dockerignore 排除运行库与论文表格，同时保留演示库和分发许可', () => {
  const rules = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf-8').split(/\r?\n/)
  const excluded = [
    'backend/runtime-db/styleai.db',
    'backend/runtime-db/styleai.db-wal',
    'backend/runtime-db/styleai.db-shm',
    'backend/db/prod.db',
    'backend/db/styleai.db-wal',
    'backend/db/styleai.db-shm',
    'backend/db/styleai.db.backup-20261126',
    'docs/论文/paper.pdf',
    'docs/依据/表格.xlsx',
    'paper.pdf',
    '表格.xlsx',
  ]
  const retained = [
    'backend/db/styleai.db',
    'NOTICE.md',
    'backend/vendor/makehuman/LICENSE.md',
    'backend/vendor/makehuman/PROVENANCE.md',
    'backend/vendor/lunar/LICENSE',
    'backend/vendor/lunar/NOTICE.txt',
    '.env.example',
  ]
  assert.deepStrictEqual(
    excluded.filter((p) => !ignored(p, rules)),
    [],
    '运行库/WAL/SHM、docs 或 PDF/XLSX 仍会进入 Docker 构建上下文',
  )
  assert.deepStrictEqual(
    retained.filter((p) => ignored(p, rules)),
    [],
    '公开演示库、示例配置或第三方许可被误排除',
  )
})
