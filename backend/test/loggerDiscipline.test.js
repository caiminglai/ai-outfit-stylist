/**
 * 日志归口纪律测试（11-03 拆分轮之后的第一道守卫）
 * ============================================================
 * 背景：11-03 之前 routes/ 里有 160 处、services/ 10 处、middleware/ 1 处裸
 * `console.error|warn`。它们只落 stdout，不进 `logs/server-*.log`（那份才是本机与
 * 容器都保证留 7 天、按北京日切的档案），于是线上报错=当场打印即销毁。
 * `payment.js:19` 那句注释写着"日志走 utils/logger"而底下 20 条全是 console.error，
 * 说明这类漂移靠人记是记不住的，必须有机器兜着。
 *
 * 本文件钉六件事（编号与下面 6 条 test 一一对应）：
 *   1. 应用代码（routes/** services/** middleware/** server.js common.js）里
 *      不许出现任何 `console.*` 调用（注释里的字样不算）。
 *   2. 谁用了 logMsg/logErr/logWarn 三个别名，谁就必须真的 require 到 utils/logger
 *      ——防止"改了调用没补引用"这种一跑就 ReferenceError 的半截迁移。
 *   3. 反向：require 了 utils/logger 却一个别名都没用，是白拿（记 warning，不判死）。
 *   4. utils/logger 的 warn 通道行为与 log/error 对齐：写文件带 [WARN]、走 console.warn、
 *      BigInt/自引用对象不再把主流程炸成 500。
 *   5. eslint 配置里 no-console 是 **error**、不许退回 warn 级，且放行名单（overrides）
 *      不包含 routes/services/middleware/server.js —— 规则被谁悄悄放宽要能被发现。
 *   6. db/init.js 特例：它挂在每次进程启动的路上，error/warn 必须归 logger
 *      （11-04 加，db/** 不在 no-console 适用面上，这条只能由测试兜，见该测试的注释）。
 *
 * 全程用替身接管 fs.appendFileSync / fs.unlinkSync / fs.readdirSync / fs.statSync 与
 * console，测试不写任何真日志文件、不删任何真日志。
 *
 * 运行: node --test test/loggerDiscipline.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const BE = path.join(__dirname, '..')
const ALIASES = ['logMsg', 'logErr', 'logWarn']

/** 应用代码范围：请求路径上的文件（命令行工具 scripts/、建库脚本 db/、测试 test/ 不在内） */
function appCodeFiles() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js')) out.push(p)
    }
  }
  for (const d of ['routes', 'services', 'middleware']) walk(path.join(BE, d))
  out.push(path.join(BE, 'server.js'))
  if (fs.existsSync(path.join(BE, 'common.js'))) out.push(path.join(BE, 'common.js'))
  return out
}

/** 去掉注释后的代码体（只用于"这行到底算不算调用"的判断，够用且保守） */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((L) => !/^\s*\/\//.test(L))
    .join('\n')
}

test('1. 应用代码里零裸 console.*（注释里的字样不算）', () => {
  const hits = []
  for (const f of appCodeFiles()) {
    const body = stripComments(fs.readFileSync(f, 'utf8'))
    const m = body.match(/console\.(log|info|warn|error|debug|trace|table)\b/g)
    if (m) hits.push(path.relative(BE, f) + ' => ' + m.length + ' 处')
  }
  assert.deepStrictEqual(hits, [], '裸 console 只落 stdout，等于报错不留档：\n' + hits.join('\n'))
})

test('2. 用了 logger 别名的文件必须真的 require 到 utils/logger', () => {
  const missing = []
  for (const f of appCodeFiles()) {
    const src = fs.readFileSync(f, 'utf8')
    const body = stripComments(src)
    const used = ALIASES.filter((a) => new RegExp('\\b' + a + '\\(').test(body))
    if (used.length === 0) continue
    if (!/require\((['"])[^'"]*utils\/logger\1\)/.test(src)) {
      missing.push(path.relative(BE, f) + ' 用了 ' + used.join(',') + ' 但没 require utils/logger')
    }
  }
  assert.deepStrictEqual(missing, [], '半截迁移一跑就 ReferenceError：\n' + missing.join('\n'))
})

test('3. 反向：require 了 logger 却没用到任何一个别名是白拿（记 warning，不判死）', () => {
  const unused = []
  for (const f of appCodeFiles()) {
    const src = fs.readFileSync(f, 'utf8')
    if (!/require\((['"])[^'"]*utils\/logger\1\)/.test(src)) continue
    const body = stripComments(src)
    if (!ALIASES.some((a) => new RegExp('\\b' + a + '\\(').test(body)))
      unused.push(path.relative(BE, f))
  }
  // 这一条现在必须为零：多解构一个别名就会多一条 no-unused-vars warning
  assert.deepStrictEqual(unused, [], 'require 了却没用到：' + unused.join(', '))
})

test('4. logger.warn：写文件带 [WARN]、走 console.warn、BigInt/自引用不炸主流程', () => {
  const real = {
    append: fs.appendFileSync,
    unlink: fs.unlinkSync,
    readdir: fs.readdirSync,
    stat: fs.statSync,
  }
  const written = []
  const warned = []
  const wouldDelete = []
  try {
    fs.appendFileSync = (p, line) => written.push(String(line))
    fs.unlinkSync = (p) => wouldDelete.push(String(p))
    fs.readdirSync = () => ['server-2020-01-01.log', 'server-2026-11-03.log']
    fs.statSync = (p) => ({
      mtime: { getTime: () => (String(p).includes('2020') ? 0 : Date.now()) },
    })
    const consoleWarn = console.warn
    console.warn = (...a) => warned.push(a)
    try {
      const logger = require('../utils/logger')
      assert.strictEqual(typeof logger.warn, 'function', 'logger 必须导出 warn 通道')
      const circ = {}
      circ.self = circ
      assert.doesNotThrow(() => logger.warn('[配额] 快用完', { n: 10n }, circ, new Error('boom')))
      assert.strictEqual(warned.length, 1, 'console.warn 该被调用一次')
      assert.strictEqual(written.length, 1, 'warn 也要落文件')
      assert.match(written[0], /^\[[^\]]+\] \[WARN\] /, '行首时间戳之后要带级别标记 [WARN]')
      assert.match(written[0], /\[配额\] 快用完/)
      assert.ok(!written[0].includes('Do not JSON.stringify'), 'BigInt 不许把日志调用炸掉')
      assert.strictEqual(wouldDelete.length, 1, '清理逻辑该认出那份 2020 的旧日志')
      // [ERROR] 与 [WARN] 是两个通道：并成一个就没法按级别过滤了
      const before = written.length
      logger.error('[下单] 炸了', new Error('x'))
      assert.strictEqual(written.length, before + 1)
      assert.match(written[before], /^\[[^\]]+\] \[ERROR\] /)
      assert.match(written[0], /^\[[^\]]+\] \[WARN\] /, '先前那条不该被改成 [ERROR]')
    } finally {
      console.warn = consoleWarn
    }
  } finally {
    Object.assign(fs, {
      appendFileSync: real.append,
      unlinkSync: real.unlink,
      readdirSync: real.readdir,
      statSync: real.stat,
    })
  }
})

test('5. eslint 配置：no-console 是 error，且放行名单不含应用代码目录', () => {
  const cfg = fs.readFileSync(path.join(BE, 'eslint.config.js'), 'utf8')
  assert.match(cfg, /'no-console':\s*'error'/, '应用代码的 console 规则必须停在 error')
  assert.ok(!/'no-console':\s*\[\s*'warn'/.test(cfg), '不许悄悄退回 warn 级')
  for (const dir of ['routes', 'services', 'middleware']) {
    const re = new RegExp(
      "files:\\s*\\[[^\\]]*'" + dir + '/\\*\\*[^\\]]*\\][\\s\\S]{0,200}no-console',
    )
    assert.ok(!re.test(cfg), dir + '/ 出现在 no-console 放行名单里')
  }
})

/**
 * 6. db/init.js 特例（11-04 加）：eslint 给 db/** 关掉了 no-console，理由是"人在终端里手工
 * 跑的建库与迁移脚本，stdout 就是交付物"。这个理由对 add-rules／export-rules／seed／三份
 * migrate 成立，对 init.js 不成立——它是 require 链的第一环，每次进程启动都走一遍。
 * 所以这里单独钉：它的 error/warn 必须归 logger（只落 stdout 就等于报错不留档），
 * console.log 那 20 条按现有口径留着不动（建库进度本来就是给人看的）。
 */
test('6. db/init.js 的 error/warn 归 logger，console.log 仍按 db/ 口径放行', () => {
  const src = fs.readFileSync(path.join(BE, 'db', 'init.js'), 'utf8')
  const body = stripComments(src)
  const leaked = body.match(/console\.(error|warn)\b/g) || []
  assert.deepStrictEqual(
    leaked,
    [],
    'init.js 挂在启动路径上，error/warn 只打 stdout 就不进日志文件',
  )
  assert.match(
    src,
    /require\((['"])[^'"]*utils\/logger\1\)/,
    'init.js 用了 logger 别名却没 require 到',
  )
})
