'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')

test('启动扫描与缺失模型清理都使用 STYLEAI_MODEL_DIR，不碰默认 models/', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-custom-models-'))
  const dbPath = path.join(tempDir, 'runtime.db')
  const modelDir = path.join(tempDir, 'models')
  const modelFile = path.join(modelDir, 'fixture', 'demo.pmx')
  fs.mkdirSync(path.dirname(modelFile), { recursive: true })
  fs.writeFileSync(modelFile, 'test fixture')
  const initPath = require.resolve('../db/init')
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    STYLEAI_DB_PATH: dbPath,
    STYLEAI_MODEL_DIR: modelDir,
    STYLEAI_UPLOAD_DIR: path.join(tempDir, 'uploads'),
    STYLEAI_LOG_DIR: path.join(tempDir, 'logs'),
    DOTENV_CONFIG_PATH: path.join(tempDir, 'disabled.env'),
    STYLEAI_SKIP_MODEL_SCAN: '0',
    STYLEAI_TEST_INIT: '1',
    ADMIN_PASSWORD: 'custom-model-test-password',
    SECRET_KEY: 'custom-model-test-secret',
    DASHSCOPE_API_KEY: '',
    ALIPAY_APP_ID: '',
    ALIPAY_PRIVATE_KEY_PATH: '',
    ALIPAY_PUBLIC_KEY_PATH: '',
  }
  const runInit = () =>
    spawnSync(
      process.execPath,
      [
        '-e',
        `const db=require(${JSON.stringify(initPath)});db.stopWalCheckpointTimer();db.close()`,
      ],
      { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 30000 },
    )
  const countModels = () => {
    const db = new Database(dbPath, { readonly: true })
    try {
      return db.prepare('SELECT COUNT(*) AS n FROM model_configs').get().n
    } finally {
      db.close()
    }
  }
  try {
    const first = runInit()
    assert.strictEqual(first.status, 0, first.stderr || first.stdout)
    assert.strictEqual(countModels(), 1)

    fs.unlinkSync(modelFile)
    const second = runInit()
    assert.strictEqual(second.status, 0, second.stderr || second.stdout)
    assert.strictEqual(countModels(), 0, '自定义目录中的文件删除后，对应模型记录也应清理')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
