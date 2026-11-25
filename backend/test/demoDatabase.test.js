const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

const ROOT = path.join(__dirname, '..', '..')
const GENERATOR_PATH = path.join(ROOT, 'backend', 'scripts', 'generate-demo-db.js')
const PUBLIC_DB_PATH = path.join(ROOT, 'backend', 'db', 'styleai.db')

const EMPTY_RUNTIME_TABLES = [
  'admin_users',
  'app_settings',
  'body_metrics',
  'clothing_items',
  'creator_works',
  'customer_sessions',
  'deposits',
  'face_features',
  'face_profiles',
  'feedback_events',
  'inventory_products',
  'item_feedback',
  'payment_orders',
  'photos',
  'profile_drafts',
  'profile_tags',
  'recommendation_logs',
  'recommendations',
  'revoked_sessions',
  'shopping_wishlist',
  'stores',
  'tryon_results',
  'upload_files',
  'user_accessories',
  'user_accounts',
  'user_cosmetics',
  'user_wardrobe',
  'users',
  'wardrobe_outfits',
]

function runGenerator(outputPath, ...args) {
  return spawnSync(process.execPath, [GENERATOR_PATH, '--output', outputPath, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  })
}

function assertSanitizedDemoDatabase(dbPath) {
  assert.equal(fs.existsSync(dbPath), true)
  assert.equal(fs.existsSync(dbPath + '-wal'), false)
  assert.equal(fs.existsSync(dbPath + '-shm'), false)

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')

    for (const table of EMPTY_RUNTIME_TABLES) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
      if (!exists) continue
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        0,
        `${table} must be empty in the public demo database`,
      )
    }

    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM rule_groups').get().count > 0)
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM rule_conditions').get().count > 0)
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM rule_actions').get().count > 0)
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM inventory_categories').get().count > 0)

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_configs').get().count, 0)
  } finally {
    db.close()
  }
}

test('the generator creates a sanitized, valid demo database from project seeds', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-demo-db-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const outputPath = path.join(dir, 'styleai.db')

  const result = runGenerator(outputPath)
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
  assertSanitizedDemoDatabase(outputPath)

  const checked = runGenerator(outputPath, '--check')
  assert.equal(checked.status, 0, `stdout=${checked.stdout}\nstderr=${checked.stderr}`)
})

test('the generator refuses to overwrite an existing database', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-demo-db-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const outputPath = path.join(dir, 'styleai.db')
  const sentinel = Buffer.from('do-not-overwrite')

  fs.writeFileSync(outputPath, sentinel)
  const result = runGenerator(outputPath)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /已存在|拒绝覆盖/)
  assert.deepEqual(fs.readFileSync(outputPath), sentinel)
})

test('--replace refreshes only an existing sanitized demo database', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-demo-db-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const outputPath = path.join(dir, 'styleai.db')

  const initial = runGenerator(outputPath)
  assert.equal(initial.status, 0, `stdout=${initial.stdout}\nstderr=${initial.stderr}`)
  const replaced = runGenerator(outputPath, '--replace')
  assert.equal(replaced.status, 0, `stdout=${replaced.stdout}\nstderr=${replaced.stderr}`)
  assertSanitizedDemoDatabase(outputPath)

  fs.writeFileSync(outputPath, Buffer.from('runtime-data-must-survive'))
  const rejected = runGenerator(outputPath, '--replace')
  assert.notEqual(rejected.status, 0)
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'runtime-data-must-survive')
})

test('the committed public styleai.db contains no credentials or runtime records', () => {
  assertSanitizedDemoDatabase(PUBLIC_DB_PATH)
})
