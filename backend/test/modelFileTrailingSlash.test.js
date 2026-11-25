/**
 * 两条匿名模型下载口的「尾部分隔符」闸门。
 * 真实 HTTP + 内存库；模型夹具只放系统临时目录，不写仓库 models/。
 * 运行: npm test
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Database = require('better-sqlite3')

const MODEL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-model-slash-'))
process.env.STYLEAI_MODEL_DIR = MODEL_DIR
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

const { resetDisabledPmxCache } = require('../utils/model-utils')
const app = require('../server')
const server = app.server
let closed = false
const closeServer = async () => {
  if (!closed && server.listening) await new Promise((resolve) => server.close(resolve))
  closed = true
}
test.after(async () => {
  await closeServer()
  resetDisabledPmxCache()
  memDb.close()
  fs.rmSync(MODEL_DIR, { recursive: true, force: true })
})

const TMP_DIR = 'fixture'
const OFF_FILE = 'off.pmx'
const ON_FILE = 'on.pmx'
const PMX_BYTES = Buffer.from([0x50, 0x4d, 0x58])
const tmpPath = path.join(MODEL_DIR, TMP_DIR)
let baseUrl = null

test('准备：临时目录放一禁用/一在售两份 .pmx，并把禁用集刷进缓存', async () => {
  fs.mkdirSync(tmpPath)
  fs.writeFileSync(path.join(tmpPath, OFF_FILE), PMX_BYTES)
  fs.writeFileSync(path.join(tmpPath, ON_FILE), PMX_BYTES)

  memDb.prepare('DELETE FROM model_configs WHERE folder = ?').run(TMP_DIR)
  const ins = memDb.prepare(
    `INSERT INTO model_configs (name, folder, file, enabled)
     VALUES (?, ?, ?, ?)`,
  )
  ins.run('闸门测试·禁用', TMP_DIR, OFF_FILE, 0)
  ins.run('闸门测试·在售', TMP_DIR, ON_FILE, 1)
  resetDisabledPmxCache()

  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test('/api/models/file：禁用模型带不带尾斜杠都是 404', async () => {
  const bare = await fetch(`${baseUrl}/api/models/file/${TMP_DIR}/${OFF_FILE}`)
  assert.strictEqual(bare.status, 404)
  const slashed = await fetch(`${baseUrl}/api/models/file/${TMP_DIR}/${OFF_FILE}/`)
  assert.strictEqual(slashed.status, 404, '尾斜杠绕过了禁用判定')
  assert.match(await slashed.text(), /文件不存在/)
})

test('/api/models/file：在售模型带尾斜杠照旧能下，闸门没有顺手扩大', async () => {
  const ok = await fetch(`${baseUrl}/api/models/file/${TMP_DIR}/${ON_FILE}`)
  assert.strictEqual(ok.status, 200)
  const okSlash = await fetch(`${baseUrl}/api/models/file/${TMP_DIR}/${ON_FILE}/`)
  assert.strictEqual(okSlash.status, 200)
})

test('/models 静态口：编码尾斜杠 %2F 对禁用模型同样 404，对在售文件不误伤', async () => {
  const offEnc = await fetch(`${baseUrl}/models/${TMP_DIR}/${OFF_FILE}%2F`)
  assert.strictEqual(offEnc.status, 404)
  assert.match(await offEnc.text(), /文件不存在/)
  const offBare = await fetch(`${baseUrl}/models/${TMP_DIR}/${OFF_FILE}`)
  assert.strictEqual(offBare.status, 404)
  const onBare = await fetch(`${baseUrl}/models/${TMP_DIR}/${ON_FILE}`)
  assert.strictEqual(onBare.status, 200)
  // express.static 自身的尾斜杠语义跨平台不同；只要求它不是禁用闸门的 JSON 404。
  const onEnc = await fetch(`${baseUrl}/models/${TMP_DIR}/${ON_FILE}%2F`)
  assert.ok([200, 304, 404].includes(onEnc.status), `意外状态 ${onEnc.status}`)
  assert.ok(!(await onEnc.text()).includes('文件不存在'))
})

test('收尾：删掉临时目录与库行，关端口', async () => {
  fs.rmSync(tmpPath, { recursive: true, force: true })
  assert.strictEqual(fs.existsSync(tmpPath), false)
  memDb.prepare('DELETE FROM model_configs WHERE folder = ?').run(TMP_DIR)
  resetDisabledPmxCache()
  await closeServer()
})
