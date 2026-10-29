/**
 * 门店扫码录入测试（2026-10-20 第五阶段·第一步）
 *
 * 钉三件事：
 *  ① `user_wardrobe.sku` 这一格**不设 DEFAULT、不建唯一索引**——同一人可以有两件同款、
 *     游客还共用会话，唯一索引会把第二件直接顶掉（口径写在 schema.sql 与 init.js 的注释里）。
 *  ② 查重那两条 SQL 的读法：衣柜侧按 session_id + sku 隔离（别人的码不串到我这），
 *     库存侧只认上架（enabled=1）的行、并带出分类 code。
 *  ③ 路由源码里确实挂着这一格：POST/PUT 的字段表、GET /sku 的两条 WHERE。
 *     ⚠️ 这里只做"源码级"钉桩，**行为**证据在宿主机真实例上跑（本轮记录在
 *     docs/依据/10 §1m 第四十五轮台账与《第五阶段进展报告》；全程只读库副本，不碰活库）。
 *
 * 本测试在新建的内存库上执行同一份 schema.sql，全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/wardrobeSkuScan.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const REPO = path.join(__dirname, '..')
const db = new Database(':memory:')
db.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))

const routeSrc = fs.readFileSync(path.join(REPO, 'routes', 'wardrobe.js'), 'utf-8')
const initSrc = fs.readFileSync(path.join(REPO, 'db', 'init.js'), 'utf-8')

/** 抄一条与路由同形的 SQL：衣柜侧查重 */
const mineSql =
  'SELECT * FROM user_wardrobe WHERE session_id = ? AND sku = ? ORDER BY created_at DESC'
/** 抄一条与路由同形的 SQL：门店库存侧（只认上架，带出分类 code） */
const storeSql = `SELECT p.id, p.name, p.sku, c.code AS category_code
   FROM inventory_products p
   LEFT JOIN inventory_categories c ON p.category_id = c.id
  WHERE p.sku = ? AND p.enabled = 1
  ORDER BY p.created_at DESC
  LIMIT 20`

function addWardrobe(session, name, sku) {
  return db
    .prepare(
      `INSERT INTO user_wardrobe (session_id, name, category, sku)
       VALUES (?, ?, 'top', ?)`,
    )
    .run(session, name, sku).lastInsertRowid
}

function addCategory(code, name) {
  return db
    .prepare('INSERT INTO inventory_categories (name, code, sort_order) VALUES (?, ?, 1)')
    .run(name, code).lastInsertRowid
}

function addProduct(catId, name, sku, enabled) {
  return db
    .prepare(
      `INSERT INTO inventory_products (category_id, name, sku, style_tags, color_tags,
        season_tags, fit_skin_tones, stock, price, image_url, enabled)
       VALUES (?, ?, ?, '[]', '["黑"]', '[]', '[]', 3, 199, '/uploads/x.jpg', ?)`,
    )
    .run(catId, name, sku, enabled).lastInsertRowid
}

const CAT_TOP = addCategory('top', '上装')
const SKU_A = '6901234567890'
const SKU_B = 'STORE-B-001'

test('① sku 格没 DEFAULT：不填就是 NULL（＝这件不是扫来的）', () => {
  const id = addWardrobe('sess-1', '白衬衫', null)
  assert.equal(db.prepare('SELECT sku FROM user_wardrobe WHERE id = ?').get(id).sku, null)
})

test('① sku 没有唯一索引：同会话两件同款都能进去', () => {
  const first = addWardrobe('sess-1', '同款第一件', SKU_A)
  const second = addWardrobe('sess-1', '同款第二件', SKU_A)
  assert.notEqual(first, second)
  const rows = db.prepare(mineSql).all('sess-1', SKU_A)
  assert.equal(rows.length, 2, '两件同款都该被查到（这就是不建唯一索引要保住的行为）')
  // 索引由 init.js 在补列之后建（schema.sql 里那条会踩空列），而且**不是** UNIQUE
  assert.equal(
    initSrc.includes('CREATE INDEX IF NOT EXISTS ix_user_wardrobe_sku ON user_wardrobe(sku)'),
    true,
  )
  assert.equal(
    initSrc.includes('CREATE UNIQUE INDEX IF NOT EXISTS ix_user_wardrobe_sku'),
    false,
    '⛔ 不许建唯一索引',
  )
  // schema.sql 里不能出现这条索引（老库跑到那行时列还没补上会直接报错）
  const schemaSrc = fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8')
  assert.equal(/CREATE INDEX IF NOT EXISTS ix_user_wardrobe_sku/.test(schemaSrc), false)
})

test('② 衣柜侧查重按会话隔离：别人的条码不串进我的结果', () => {
  addWardrobe('sess-2', '别人的衬衫', SKU_A)
  const mine = db.prepare(mineSql).all('sess-1', SKU_A)
  assert.equal(
    mine.every((r) => r.session_id === 'sess-1'),
    true,
  )
  assert.equal(mine.length, 2, '只数自己会话里的两件')
  assert.deepEqual(
    db.prepare(mineSql).all('sess-nobody', SKU_A),
    [],
    '没录过的会话应该回空数组（前端据此走"当新品录"那一支）',
  )
})

test('② 库存侧只认上架的行，并带出分类 code', () => {
  const on = addProduct(CAT_TOP, '门店款卫衣', SKU_A, 1)
  addProduct(CAT_TOP, '下架的旧款', SKU_B, 0)
  const hits = db.prepare(storeSql).all(SKU_A)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, on)
  assert.equal(hits[0].category_code, 'top', '前端要靠这个 code 预填衣柜分类')
  assert.deepEqual(db.prepare(storeSql).all(SKU_B), [], 'enabled=0 的不该被带出来')
  assert.deepEqual(db.prepare(storeSql).all('不存在的那个码'), [])
})

test('③ 源码级：两条写口与查重口都挂着这一格', () => {
  assert.equal(
    routeSrc.includes("'sku',"),
    true,
    'WARDROBE_SCALARS 里要有 sku（数组型 body 走 400 而不是 500）',
  )
  assert.equal(/image_url, sku\)/.test(routeSrc), true, 'POST 的列清单要带 sku')
  assert.equal(
    routeSrc.includes('asText(data.sku) || null'),
    true,
    "POST 空串落 NULL，不拿 '' 冒充有值",
  )
  assert.equal(
    /sku: 'sku',/.test(routeSrc),
    true,
    'PUT 的 allowed 表要带 sku（否则改不了也清不掉）',
  )
  assert.equal(routeSrc.includes('val = asText(raw) || null'), true, 'PUT 的 sku 走同一个文本口径')
  assert.match(routeSrc, /router\.get\('\/sku'/, '查重口存在')
  assert.equal(routeSrc.includes(mineSql), true, '衣柜侧 WHERE 与本测试同形')
  assert.equal(routeSrc.includes('in_wardrobe: mine.length > 0'), true)
  assert.equal(routeSrc.includes('in_inventory: store.length > 0'), true)
})

test('③ 源码级：init.js 补了 sku 这一列', () => {
  assert.match(initSrc, /\['user_wardrobe', 'sku', 'TEXT'\]/)
})
