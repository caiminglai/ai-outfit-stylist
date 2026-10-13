/**
 * 每用户表 user_id 索引测试（审计第 6 条）
 *
 * 活库实测（对 styleai.db 的临时副本跑 EXPLAIN QUERY PLAN）：
 * photos / recommendation_logs / profile_drafts 早有索引（session_id 与补列迁移建的
 * ix_recommendation_logs_user_id、user_id 主键），但 user_wardrobe、wardrobe_outfits、
 * shopping_wishlist、user_cosmetics、user_accessories 上 WHERE user_id = ? 一律 SCAN——
 * "删除我的全部数据"(routes/analysis.js) 对这五张表逐条全表扫。
 * 本测试在新建的内存库上执行同一份 schema.sql，钉住索引存在且查询计划真的用上它。
 * 全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/schemaIndexes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const memDb = new Database(':memory:')
memDb.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8'))

function indexNames(table) {
  return memDb
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((i) => i.name)
}

function planDetail(sql) {
  return memDb
    .prepare('EXPLAIN QUERY PLAN ' + sql)
    .all(1)
    .map((r) => r.detail)
    .join(' | ')
}

test('schema.sql 建齐五张补漏表的 user_id 索引', () => {
  for (const t of [
    'user_wardrobe',
    'wardrobe_outfits',
    'shopping_wishlist',
    'user_cosmetics',
    'user_accessories',
  ]) {
    assert.ok(indexNames(t).includes(`ix_${t}_user_id`), `${t} 应有 ix_${t}_user_id`)
  }
  // 既有索引同批钉一遍，防止有人"整理"时把它们删了
  assert.ok(indexNames('photos').includes('ix_photos_user_id'))
})

test('EXPLAIN QUERY PLAN：热查询走索引，不再全表 SCAN', () => {
  const cases = [
    ['SELECT * FROM photos WHERE user_id = ?', 'ix_photos_user_id'],
    ['DELETE FROM user_wardrobe WHERE user_id = ?', 'ix_user_wardrobe_user_id'],
    ['DELETE FROM wardrobe_outfits WHERE user_id = ?', 'ix_wardrobe_outfits_user_id'],
    ['DELETE FROM shopping_wishlist WHERE user_id = ?', 'ix_shopping_wishlist_user_id'],
    ['DELETE FROM user_cosmetics WHERE user_id = ?', 'ix_user_cosmetics_user_id'],
    ['DELETE FROM user_accessories WHERE user_id = ?', 'ix_user_accessories_user_id'],
  ]
  for (const [sql, idx] of cases) {
    const detail = planDetail(sql)
    assert.ok(
      detail.includes(`USING COVERING INDEX ${idx}`) || detail.includes(`USING INDEX ${idx}`),
      `${sql} ⇒ ${detail}`,
    )
    assert.ok(!/(^|\| )SCAN/.test(detail), `${sql} 不应再 SCAN：${detail}`)
  }
})

test('profile_drafts 不用建索引：user_id 就是 INTEGER PRIMARY KEY（rowid 别名）', () => {
  const detail = planDetail('DELETE FROM profile_drafts WHERE user_id = ?')
  assert.ok(detail.includes('INTEGER PRIMARY KEY'), detail)
})

test('recommendation_logs(user_id) 索引按既有约定留在 db/init.js 补列之后，不在 schema.sql 抢跑', () => {
  // 老库此时还没有 user_id 列，schema.sql 里直接建索引会让每次启动报错——这是 init.js :142 注释写死的顺序
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8')
  assert.ok(!schemaSql.includes('ON recommendation_logs(user_id)'))
  const initSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.js'), 'utf-8')
  assert.ok(initSrc.includes('ix_recommendation_logs_user_id ON recommendation_logs(user_id)'))
})

test('users.last_active_at：schema.sql 有列，且 init.js 的 MISSING_COLUMNS 给老库补列', () => {
  const cols = memDb
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('users')
    .map((c) => c.name)
  assert.ok(cols.includes('last_active_at'), '新库建表要带这一列')
  const initSrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'init.js'), 'utf-8')
  assert.ok(
    initSrc.includes(`['users', 'last_active_at', 'TEXT']`),
    '老库必须走 MISSING_COLUMNS 补列迁移，否则线上库不会自动获得这一列',
  )
})
