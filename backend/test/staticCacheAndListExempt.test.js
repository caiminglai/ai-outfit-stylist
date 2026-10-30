/**
 * 首页开局的两个"看不见的坑"（2026-10-22 第五十九轮·第十四阶段第一步追加）
 * ======================================================================
 * ① `/api/models/list` 以前在限流总闸**里面**。展厅待机态一开屏就 fetch 它
 *   （app/public/model-gallery.html:1452，🔴 10-30 窄屏补正在它之前插了 30 行 CSS，原号 1422），这笔额度不是用户主动点出来的，是"打开首页就送一次"。
 *   国内移动网络与门店 WiFi 普遍共用出口 IP ⇒ 100 次/15 分钟是十几个人共享的桶；撞空之后 429
 *   被前端的 showApiError 变成整屏"无法加载人物模型"。它虽然已经有 ETag＋`Cache-Control: no-cache`
 *   （backend/routes/models.js:145-146），但限流闸挂在路由前面 ⇒ 304 也照样吃额度，
 *   条件请求省的是字节省不到这一格。现量（10-22 本机起实例）：把桶打空后 `/api/models/list` 回 429。
 * ② `/assets/**` 以前回 `Cache-Control: public, max-age=0`。这里的文件都是 vite 内容哈希名
 *   （如 `CabinetManager-CEKUQ9l7.js`），文件名即版本 ⇒ 回访时那一次 304 往返本来可以整次省掉。
 *   首页入口实测 5 个 `/assets` 资源（`curl -s / | grep -oE '(src|href)="/assets/[^"]+"' | wc -l`）。
 *   ⚠️ 口径要说准：改前也不是每次重下整包——弱 ETag 让回访走 304（现量 304/0 B，冷启动 200/222,777 B），
 *   这一条钉一年省的是**往返**，不是字节。
 *   `/three/**` 不是哈希名（vite 把 app/public/three 原样拷过来），只给 1 小时，
 *   ⛔ 不许跟着钉 immutable：升级 three 时旧字节会被浏览器钉一年，等于把新版本藏起来。
 *
 * 运行: node --test test/staticCacheAndListExempt.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

process.env.PORT = '0'

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))
const initPath = require.resolve('../db/init')
require.cache[initPath] = {
  id: initPath,
  filename: initPath,
  loaded: true,
  exports: memDb,
  paths: [],
}

const app = require('../server')
const server = app.server

const BASE = 100 // apiLimiter 的 max，闸值漂了这里要一起改
let baseUrl = null

/** 一条不存在的 /api 路径：吃额度、无副作用，用来把桶打空 */
const BURNER = '/api/__static_cache_probe__'

/** 取 dist 里真实存在的一个哈希资产名；CI 若没先 build 就整组跳过（⛔ 不许假装通过） */
function firstAsset(kind) {
  const dir = path.join(__dirname, '..', '..', 'app', 'dist', 'assets', kind)
  if (!fs.existsSync(dir)) return null
  const file = fs
    .readdirSync(dir)
    .filter((n) => (kind === 'js' ? n.endsWith('.js') : n.endsWith('.css')))[0]
  return file ? `/assets/${kind}/${file}` : null
}

test('准备：起临时实例并确认总闸额度是 100', async () => {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const first = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(first.status, 404, '兜底 404 才说明这条路径只吃额度、不碰业务')
  assert.strictEqual(Number(first.headers.get('ratelimit-limit')), BASE, '闸值漂了要一起改本文件')
})

test('把桶打空后展厅的模型列表仍然 200（改前这里是 429 白屏）', async () => {
  for (let i = 0; i < BASE - 1; i++) {
    const r = await fetch(`${baseUrl}${BURNER}`)
    assert.strictEqual(r.status, 404, `第 ${i + 2} 条还在额度内`)
  }
  const spent = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(spent.status, 429, '闸门本身得先成立，否则下面的"豁免"是空话')

  const list = await fetch(`${baseUrl}/api/models/list`)
  assert.strictEqual(list.status, 200, '修复前这里是 429：首页落地就把展厅打死')
  const j = await list.json()
  assert.strictEqual(j.success, true)
  assert.ok(Array.isArray(j.data), '展厅按 data.data.length 判空，形状不能变')

  // 带查询串也要豁免（判据切过 '?' 再比）
  const withQuery = await fetch(`${baseUrl}/api/models/list?v=1`)
  assert.strictEqual(withQuery.status, 200)
  await withQuery.json()

  // 豁免只给这两条读口：紧接着的普通接口照旧 429，闸没被顺手整体放宽
  const still = await fetch(`${baseUrl}${BURNER}`)
  assert.strictEqual(still.status, 429, '/api/models/list 不该把整条 /api 的额度一起放掉')
})

test('内容哈希资产钉一年 immutable，/three 与 HTML 不跟着钉', async (t) => {
  const js = firstAsset('js')
  if (!js) {
    t.skip('app/dist/assets/js 不存在：这份代码树还没 build，静态缓存口径无法现量')
    return
  }
  const r = await fetch(`${baseUrl}${js}`)
  assert.strictEqual(r.status, 200)
  const cc = r.headers.get('cache-control') || ''
  assert.ok(/max-age=31536000/.test(cc), `一年额度没生效，实际回的是 ${cc}`)
  assert.ok(/immutable/.test(cc), `缺 immutable，实际回的是 ${cc}`)

  // 走到这里说明 dist 在场，那 three 也必须在场（展厅 importmap 靠它）；缺了就是构建回归，⛔ 不许静默跳过
  const threeDir = path.join(__dirname, '..', '..', 'app', 'dist', 'three', 'build')
  assert.ok(fs.existsSync(threeDir), 'dist/three/build 失踪：展厅 importmap 会整条断掉')
  const one = fs.readdirSync(threeDir).find((n) => n.endsWith('.js'))
  assert.ok(one, 'dist/three/build 里没有 js 文件')
  const r2 = await fetch(`${baseUrl}/three/build/${one}`)
  const cc2 = r2.headers.get('cache-control') || ''
  assert.ok(/max-age=3600/.test(cc2), `/three 该给 1 小时，实际回的是 ${cc2}`)
  assert.ok(!/immutable/.test(cc2), '/three 是固定文件名，钉 immutable 会把升级后的新字节藏一年')

  const html = await fetch(`${baseUrl}/`)
  const cc3 = html.headers.get('cache-control') || ''
  assert.ok(!/immutable/.test(cc3), `首页 HTML 不能被钉一年，实际回的是 ${cc3}`)
})

test('收尾：关端口', async () => {
  await new Promise((resolve) => server.close(resolve))
})
