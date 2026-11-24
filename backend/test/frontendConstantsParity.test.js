/**
 * 前端"明知故开的第二份常量" ↔ 后端唯一实现处 的对账门（11-03 建档）
 * ============================================================
 * 为什么要有这道门：`app/src/lib/skinSample.ts` 的文件头写明"前端不能 require 后端，所以这份
 * 是明知故开的第二份"（规范 `docs/依据/18` §五a），`imagePick.ts` 照抄 multer 的限制、
 * `evidenceMeta.ts` 照抄档位字母表与 A/B 两档的出处说明。三处以前只靠注释提醒 ⇒ 后端改了
 * 前端不会响，落地就是"前端放行的图后端拒收""把 C 档行业体系说成科学依据"。
 *
 * 为什么放后端而不是 vitest 里：这份对账要同时读两侧源码，前端 `tsconfig.app.json` 的
 * `types` 只有 `vite/client`（不含 node 类型），测试文件里 import `node:fs` 会让 `tsc -b` 报
 * TS2307（11-03 实测三条）。后端这侧还能直接 `require` 真值，不必正则抠后端自己的字符串。
 * 前端那条通道只测行为（app/src 下的 .test.ts 与 .test.tsx 文件）。
 *
 * 运行: node --test test/frontendConstantsParity.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('node:path')

const BACKEND = path.join(__dirname, '..')
const APP_SRC = path.resolve(BACKEND, '..', 'app', 'src')

/** 读前端源码；文件不在场直接 fail（⛔ 不许"读不到就跳过"变成假绿） */
function readFrontend(...rel) {
  const abs = path.join(APP_SRC, ...rel)
  assert.ok(fs.existsSync(abs), `前端文件不在场：app/src/${rel.join('/')}`)
  const src = fs.readFileSync(abs, 'utf8')
  assert.ok(src.length > 500, `app/src/${rel.join('/')} 只读到 ${src.length} 字节＝渠道没读通`)
  return src
}

/** 从一段源码里抠 `key: 数值` 或 `key = 数值`；取不到就 fail 并打印周围文本 */
function pickNumber(src, key, where) {
  const m = src.match(new RegExp(`\\b${key}\\b\\s*[:=]\\s*([0-9][0-9.]*)`))
  assert.ok(m, `${where}：没抠到 ${key}（常量改名或写法变了，这条对账要跟着改）`)
  return Number(m[1])
}

test('肤色冷暖切点：skinSample.ts 的 SKIN_CUT == colorMetrics.js 的 SKIN_HUE', () => {
  const { SKIN_HUE } = require('../services/colorMetrics')
  const fe = readFrontend('lib', 'skinSample.ts')
  const block = fe.match(/export const SKIN_CUT\s*=\s*\{([\s\S]*?)\n\}/)
  assert.ok(block, '前端 SKIN_CUT 块没取到')
  const cut = block[1]
  assert.strictEqual(pickNumber(cut, 'cold', 'skinSample.ts'), SKIN_HUE.cold)
  assert.strictEqual(pickNumber(cut, 'warm', 'skinSample.ts'), SKIN_HUE.warm)
  assert.strictEqual(pickNumber(cut, 'hueMin', 'skinSample.ts'), SKIN_HUE.min)
  assert.strictEqual(pickNumber(cut, 'hueMax', 'skinSample.ts'), SKIN_HUE.max)
})

test('选图预检：imagePick.ts 的体积上限与格式词表 == middleware/upload.js', () => {
  const { UPLOAD_LIMITS, ALLOWED_EXTENSIONS } = require('../middleware/upload')
  const fe = readFrontend('lib', 'imagePick.ts')

  // 体积：multer 的 limits.fileSize 是 10 * 1024 * 1024 这种乘式写法，前端同式；算成字节比
  const sizeDecl = fe.match(/UPLOAD_MAX_BYTES\s*=\s*([0-9]+\s*\*\s*[0-9]+(?:\s*\*\s*[0-9]+)?)/)
  assert.ok(sizeDecl, '前端 UPLOAD_MAX_BYTES 不是「数字×数字」写法，取数逻辑要跟着改')
  const bytes = sizeDecl[1]
    .split('*')
    .map((s) => Number(s.trim()))
    .reduce((a, b) => a * b, 1)
  assert.strictEqual(bytes, UPLOAD_LIMITS.fileSize, '前端放行上限与 multer 不一致')

  // 格式：后端是扩展名 Set，前端是 accept 串 + 无 MIME 时的兜底正则，两条都要覆盖同一组
  const accept = fe.match(/UPLOAD_ACCEPT\s*=\s*'([^']*)'/)
  const fallback = fe.match(/OK_EXT_RE\s*=\s*\/\\.\(([^)]*)\)\$\/i/)
  assert.ok(accept, '前端 UPLOAD_ACCEPT 没取到')
  assert.ok(fallback, '前端 OK_EXT_RE 兜底正则没取到')
  const exts = fallback[1].replace('jpe?g', 'jpg|jpeg').split('|')
  const mimes = accept[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const beExts = [...ALLOWED_EXTENSIONS].sort()
  assert.deepStrictEqual([...exts].sort(), beExts, '前端兜底扩展名表与后端数量/内容不同')
  for (const m of mimes) assert.ok(m.startsWith('image/'), `accept 串混进非 image/* 项：${m}`)
  assert.strictEqual(mimes.length, 3, 'accept 串应为 jpeg/png/webp 三项')
})

test('依据档位：evidenceMeta.ts 的字母表与 A/B 两档出处 == services/evidenceLevels.js', () => {
  const { EVIDENCE_LEVELS, VALUES } = require('../services/evidenceLevels')
  const fe = readFrontend('components', 'recommend', 'evidenceMeta.ts')
  const metaBlock = fe.match(/export const META[^=]*=\s*\{([\s\S]*)\n\}/)
  assert.ok(metaBlock, '前端 META 表没取到')
  const body = metaBlock[1]

  for (const level of VALUES) {
    assert.ok(
      new RegExp(`\\n\\s{2}${level}:\\s*\\{`).test(body),
      `后端有 ${level} 档而前端 META 没有 ⇒ 顾客端会显示"没标依据等级"`,
    )
  }
  // A／B 两档的 note 是对外的出处承诺（GB/T 号、文献名），必须逐字相同
  for (const level of ['A', 'B']) {
    const be = EVIDENCE_LEVELS.find((l) => l.value === level)
    const m = body.match(new RegExp(`\\n\\s{2}${level}:\\s*\\{[\\s\\S]*?note:\\s*'([^']*)'`))
    assert.ok(m, `前端 ${level} 档的 note 没取到`)
    assert.strictEqual(m[1], be.note, `前端 ${level} 档出处说明与后端不一致`)
  }
  // C／D 的短标签不许越措辞红线
  for (const level of ['C', 'D']) {
    const m = body.match(new RegExp(`\\n\\s{2}${level}:\\s*\\{[\\s\\S]*?short:\\s*'([^']*)'`))
    assert.ok(m, `前端 ${level} 档的 short 没取到`)
    assert.doesNotMatch(m[1], /科学|量化|客观规律/, `${level} 档短标签越了措辞红线`)
  }
})

test('后端这三份权威源码确实读到了（防"require 到半成品 ⇒ 逐条 undefined == undefined 假绿"）', () => {
  const cm = require('../services/colorMetrics')
  const up = require('../middleware/upload')
  const ev = require('../services/evidenceLevels')
  assert.strictEqual(typeof cm.SKIN_HUE.cold, 'number')
  assert.strictEqual(typeof cm.SKIN_HUE.max, 'number')
  assert.strictEqual(typeof up.UPLOAD_LIMITS.fileSize, 'number')
  assert.ok(up.ALLOWED_EXTENSIONS.size >= 3, 'ALLOWED_EXTENSIONS 是空集')
  assert.deepStrictEqual([...ev.VALUES].sort(), ['A', 'B', 'C', 'D'])
  assert.strictEqual(ev.EVIDENCE_LEVELS.length, 4)
})
