/**
 * 两条匿名模型下载口的「尾部分隔符」闸门（2026-10-13 深夜轮）
 * ============================================================
 * 后台点「禁用」靠的是判据 `isDisabledPmxPath`，它只看路径是否以 .pmx（或 .pmx.gz）结尾。
 * 而 `path.normalize` 在 POSIX 下**保留尾斜杠**：`GET /api/models/file/<目录>/<文件>.pmx/`
 * 会原样带着斜杠进判据 ⇒ endsWith('.pmx') 不成立 ⇒ 禁用判定整个跳过，
 * 下面的 path.join 又把斜杠抹掉、照样命中真实文件，下架的模型继续匿名整文件外发。
 * server.js 的 `/models` 静态口同一个判据，`%2F` 编码尾斜杠是它的同一条缝。
 *
 * 这条必须真发 HTTP 才看得出来（判据与 join 的配合发生在请求里），所以本文件起临时实例：
 * PORT=0 + db/init 内存替身，测完删临时目录、关端口。
 * 运行: node --test test/modelFileTrailingSlash.test.js
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

const { resetDisabledPmxCache } = require('../utils/model-utils')
const app = require('../server')
const server = app.server

// 判据目录的真身：routes/models.js 与 server.js 都拼到仓库根的 models/（不是 backend/models）
const MODELS_DIR = path.join(__dirname, '..', '..', 'models')
const TMP_DIR = `闸门尾斜杠测试-${Date.now()}`
const OFF_FILE = 'off.pmx'
const ON_FILE = 'on.pmx'
const PMX_BYTES = Buffer.from([
  0x50, 0x4d, 0x58, 0x56, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x32, 0x31,
])
let baseUrl = null
const tmpPath = path.join(MODELS_DIR, TMP_DIR)

// 环境闸门：部署容器里 /models 是只读 bind mount（compose 的 `:ro`），CI 那侧也可能没这棵树。
// 这两种环境下本文件的探针目录建不出来 —— 那是"环境不给写"，不是被测代码坏了，
// 所以真试写一次、写不进就整组 skip 并把 err.code 打进原因，让它不再冒充 9 条失败。
// 判法只用一条：mkdir 一个临时目录再删掉，成功＝可写。
let canWrite = true
let skipWhy = ''
try {
  const probe = path.join(MODELS_DIR, `写权限探测-${Date.now()}`)
  fs.mkdirSync(probe)
  fs.rmdirSync(probe)
} catch (err) {
  canWrite = false
  skipWhy = `${err.code || err.message}（models=${MODELS_DIR}）`
}
const OPT = canWrite ? {} : { skip: `models/ 写不进去：${skipWhy}` }

test('准备：临时目录放一禁用/一在售两份 .pmx，并把禁用集刷进缓存', OPT, async () => {
  assert.ok(fs.existsSync(MODELS_DIR), 'models/ 必须在场（判据目录本身）')
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
  // db/init 已被内存替身顶掉，initAll() 的 models/ 扫描不会跑，禁用集完全靠这里插进去的行
  resetDisabledPmxCache()

  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve))
  }
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test(
  '/api/models/file：禁用模型带不带尾斜杠都是 404（修复前带斜杠回 200 发整份文件）',
  OPT,
  async () => {
    const bare = await fetch(
      `${baseUrl}/api/models/file/${encodeURIComponent(TMP_DIR)}/${OFF_FILE}`,
    )
    assert.strictEqual(bare.status, 404, '裸路径本来就被拦着')
    const slashed = await fetch(
      `${baseUrl}/api/models/file/${encodeURIComponent(TMP_DIR)}/${OFF_FILE}/`,
    )
    assert.strictEqual(slashed.status, 404, '加一个尾斜杠就绕过禁用判定，等于「下架」没下架')
    assert.match(await slashed.text(), /文件不存在/)
  },
)

test('/api/models/file：在售模型带尾斜杠照旧能下，闸门没有顺手扩大', OPT, async () => {
  const ok = await fetch(`${baseUrl}/api/models/file/${encodeURIComponent(TMP_DIR)}/${ON_FILE}`)
  assert.strictEqual(ok.status, 200)
  const okSlash = await fetch(
    `${baseUrl}/api/models/file/${encodeURIComponent(TMP_DIR)}/${ON_FILE}/`,
  )
  assert.strictEqual(okSlash.status, 200, '非禁用文件不该被这道改动挡掉')
})

test('/models 静态口：编码尾斜杠 %2F 对禁用模型同样 404，对在售文件仍是 200', OPT, async () => {
  const offEnc = await fetch(`${baseUrl}/models/${encodeURIComponent(TMP_DIR)}/${OFF_FILE}%2F`)
  assert.strictEqual(
    offEnc.status,
    404,
    'express.static 把 %2F 解回 / 后 join 会收掉斜杠 ⇒ 只能在这里砍',
  )
  const offBare = await fetch(`${baseUrl}/models/${encodeURIComponent(TMP_DIR)}/${OFF_FILE}`)
  assert.strictEqual(offBare.status, 404)
  const onEnc = await fetch(`${baseUrl}/models/${encodeURIComponent(TMP_DIR)}/${ON_FILE}%2F`)
  assert.ok([200, 304].includes(onEnc.status), `在售文件不该误伤，实测 ${onEnc.status}`)
})

test('收尾：删掉临时目录与库行，关端口', async () => {
  // 这一条不许 skip：前面三条无论是跑过还是被环境闸门跳过，端口都已经开了，不关就是僵尸进程
  fs.rmSync(tmpPath, { recursive: true, force: true })
  assert.strictEqual(fs.existsSync(tmpPath), false, '临时目录必须删干净，否则会进下一轮扫描')
  memDb.prepare('DELETE FROM model_configs WHERE folder = ?').run(TMP_DIR)
  resetDisabledPmxCache()
  await new Promise((resolve) => server.close(resolve))
})
