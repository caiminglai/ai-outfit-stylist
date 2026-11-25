'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

test('重建脚本的备份包含尚未 checkpoint 的 WAL 改动', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-rebuild-backup-'))
  const dbPath = path.join(tempDir, 'demo.db')
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const writer = new Database(dbPath)
  try {
    writer.pragma('journal_mode = WAL')
    writer.pragma('foreign_keys = ON')
    writer.exec(schema)
    writer.pragma('wal_checkpoint(TRUNCATE)')
    writer.pragma('wal_autocheckpoint = 0')
    writer.exec('CREATE TABLE wal_marker (payload TEXT)')
    writer.transaction(() => {
      const insert = writer.prepare('INSERT INTO wal_marker (payload) VALUES (?)')
      for (let i = 0; i < 512; i++) insert.run(`wal-${i}-${'x'.repeat(4096)}`)
    })()
    writer
      .prepare(
        "INSERT INTO model_configs (name, folder, file, source) VALUES ('旧名', '测试+原创', 'demo.pmx', '原创')",
      )
      .run()
    assert.ok(fs.existsSync(dbPath + '-wal'), '测试必须先制造未合并的 WAL')
    const harness = path.join(tempDir, 'reject-raw-copy.cjs')
    fs.writeFileSync(
      harness,
      "const fs=require('node:fs');const raw=fs.copyFileSync;fs.copyFileSync=(src,dest,...args)=>{if(String(dest).includes('.backup-'))throw new Error('raw copy cannot snapshot WAL');return raw(src,dest,...args)}",
    )

    const script = path.join(__dirname, '..', 'scripts', 'rebuild-db.js')
    const result = spawnSync(process.execPath, [script], {
      cwd: tempDir,
      env: {
        ...process.env,
        STYLEAI_DB_PATH: dbPath,
        STYLEAI_SKIP_MODEL_SCAN: '1',
        STYLEAI_MODEL_DIR: path.join(tempDir, 'empty-models'),
        NODE_OPTIONS: `--require=${harness}`,
      },
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)

    const backups = fs.readdirSync(tempDir).filter((name) => name.startsWith('demo.db.backup-'))
    assert.equal(backups.length, 1, '必须恰好留下一个可回滚备份')
    const backup = new Database(path.join(tempDir, backups[0]), { readonly: true })
    try {
      const row = backup.prepare('SELECT name, source FROM model_configs').get()
      assert.deepEqual(row, { name: '旧名', source: '原创' }, '备份必须包含 WAL 里的旧值')
      assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM wal_marker').get().n, 512)
      assert.equal(backup.pragma('integrity_check', { simple: true }), 'ok')
    } finally {
      backup.close()
    }
  } finally {
    writer.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
