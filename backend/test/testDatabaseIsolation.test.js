/**
 * 测试运行器必须能从 schema/种子重建临时库，不能把 backend/db/styleai.db 当夹具。
 *
 * 这里不 mock 文件系统：把后端复制到系统临时目录，故意不带运行库、.env 和 node_modules，
 * 再运行真实的 scripts/run-tests.js。node_modules 通过 NODE_PATH 复用，避免复制原生绑定。
 * 探针测试只在子进程里打开 STYLEAI_DB_PATH，并把实际路径回传给本测试核对清理结果。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BACKEND = path.join(__dirname, '..')
const TEST_ADMIN_PASSWORD = 'test-only-admin-password'
const TEST_SECRET_KEY = 'test-only-secret-key-at-least-16-chars'

function makeSandbox(t, probeSource, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-isolation-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const backend = path.join(root, 'backend')
  fs.cpSync(BACKEND, backend, {
    recursive: true,
    filter(source) {
      const name = path.basename(source)
      if (['node_modules', 'logs', 'uploads', 'test'].includes(name)) return false
      if (name === '.env' || name.startsWith('.env.')) return false
      if (name === 'styleai.db' || name.startsWith('styleai.db-')) return false
      return true
    },
  })

  const testDir = path.join(backend, 'test')
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(path.join(testDir, 'isolation-probe.test.js'), probeSource)

  // 本机模型资产不应改变测试库内容；放一个假 PMX 让扫描分支无所遁形。
  const modelDir = path.join(root, 'models', 'demo')
  fs.mkdirSync(modelDir, { recursive: true })
  fs.writeFileSync(path.join(modelDir, 'demo.pmx'), 'test fixture')

  const observedPath = path.join(root, 'observed-db-path.txt')
  const env = { ...process.env }
  delete env.STYLEAI_DB_PATH
  delete env.ADMIN_PASSWORD
  delete env.SECRET_KEY
  delete env.NODE_ENV
  delete env.STYLEAI_SKIP_MODEL_SCAN
  delete env.STYLEAI_TEST_INIT
  // 本测试自身由 node --test 启动；去掉其内部标记，模拟用户在终端直接运行 npm test。
  delete env.NODE_TEST_CONTEXT
  env.NODE_PATH = [path.join(BACKEND, 'node_modules'), env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter)
  env.TEST_DB_OBSERVED_PATH = observedPath

  const runnerTemp = path.join(root, 'runner-temp')
  fs.mkdirSync(runnerTemp)
  // 固定运行器的 os.tmpdir()，初始化失败时也能核对它有没有清空自己创建的目录。
  env.TEMP = runnerTemp
  env.TMP = runnerTemp
  env.TMPDIR = runnerTemp

  if (options.preloadSource) {
    const preloadPath = path.join(root, 'runner-preload.cjs')
    fs.writeFileSync(preloadPath, options.preloadSource)
    env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require="${preloadPath.replaceAll(path.sep, '/')}"`]
      .filter(Boolean)
      .join(' ')
  }

  if (options.inheritedEnv) Object.assign(env, options.inheritedEnv)
  if (options.beforeRun) options.beforeRun(backend)

  const run = spawnSync(process.execPath, ['scripts/run-tests.js'], {
    cwd: backend,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  return {
    backend,
    observedPath,
    runnerTemp,
    run,
    output: `${run.stdout || ''}\n${run.stderr || ''}`,
  }
}

function readObservedPath(observedPath) {
  assert.ok(fs.existsSync(observedPath), '探针测试应实际打开子进程的 STYLEAI_DB_PATH')
  return fs.readFileSync(observedPath, 'utf8')
}

function assertTemporaryDatabaseRemoved(dbPath) {
  const relativeToTemp = path.relative(os.tmpdir(), dbPath)
  assert.ok(relativeToTemp, '测试库必须位于系统临时目录')
  assert.ok(!relativeToTemp.startsWith('..') && !path.isAbsolute(relativeToTemp))
  assert.equal(path.basename(dbPath), 'styleai.db')
  for (const suffix of ['', '-wal', '-shm']) {
    assert.equal(fs.existsSync(dbPath + suffix), false, `临时库残留：${dbPath + suffix}`)
  }
  assert.equal(fs.existsSync(path.dirname(dbPath)), false, '临时目录也应删除')
}

function assertSeedInitializationFailure(t, modulePath, failureMessage) {
  const { observedPath, runnerTemp, run, output } = makeSandbox(
    t,
    `require('node:test')('初始化失败时不应运行的探针', () => {})`,
    {
      beforeRun(backend) {
        fs.writeFileSync(
          path.join(backend, modulePath),
          `throw new Error(${JSON.stringify(failureMessage)})`,
        )
      },
    },
  )

  assert.notEqual(run.status, 0, output)
  assert.match(output, new RegExp(failureMessage))
  assert.doesNotMatch(output, /临时库及 -wal\/-shm 已删除/)
  assert.deepEqual(fs.readdirSync(runnerTemp), [], '初始化失败后必须删除运行器的临时目录')
  assert.equal(fs.existsSync(observedPath), false, '初始化失败后不应运行测试探针')
}

/** 直接加载生产初始化入口；不经过会强开 STYLEAI_TEST_INIT 的测试运行器。 */
function runProductionInit(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'styleai-production-init-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const backend = path.join(root, 'backend')
  fs.cpSync(BACKEND, backend, {
    recursive: true,
    filter(source) {
      const name = path.basename(source)
      if (['node_modules', 'logs', 'uploads', 'test'].includes(name)) return false
      if (name === '.env' || name.startsWith('.env.')) return false
      if (name === 'styleai.db' || name.startsWith('styleai.db-')) return false
      return true
    },
  })
  const runtimeTemp = path.join(root, 'runtime-temp')
  fs.mkdirSync(runtimeTemp)
  const env = { ...process.env }
  delete env.STYLEAI_TEST_INIT
  delete env.STYLEAI_DB_PATH
  delete env.STYLEAI_LOG_DIR
  env.NODE_ENV = 'production'
  env.STYLEAI_DB_PATH = path.join(root, 'startup.db')
  env.STYLEAI_LOG_DIR = path.join(root, 'logs')
  env.STYLEAI_SKIP_MODEL_SCAN = '1'
  env.DOTENV_CONFIG_PATH = path.join(root, 'disabled.env')
  env.TEMP = runtimeTemp
  env.TMP = runtimeTemp
  env.TMPDIR = runtimeTemp
  env.NODE_PATH = [path.join(BACKEND, 'node_modules'), env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter)
  if (options.beforeRun) options.beforeRun(backend)
  const run = spawnSync(process.execPath, ['-e', "require('./db/init')"], {
    cwd: backend,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  return { run, output: `${run.stdout || ''}\n${run.stderr || ''}` }
}

function assertProductionInitFails(t, options, expectedMessage) {
  const { run, output } = runProductionInit(t, options)
  assert.notEqual(run.status, 0, output)
  assert.match(output, expectedMessage)
  assert.doesNotMatch(output, /WAL 定时 checkpoint 已启动/, '种子失败后不能继续后续启动步骤')
}

test('无运行库时可重建确定性测试库，并注入专用凭据', (t) => {
  const { backend, observedPath, run, output } = makeSandbox(
    t,
    `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcryptjs')
const dbPath = process.env.STYLEAI_DB_PATH
assert.ok(dbPath, '运行器必须设置 STYLEAI_DB_PATH')
assert.equal(fs.existsSync(path.join(__dirname, '..', 'db', 'styleai.db')), false)
assert.equal(fs.existsSync(dbPath), true, '运行器应已从空路径建好测试库')
assert.equal(process.env.ADMIN_PASSWORD, ${JSON.stringify(TEST_ADMIN_PASSWORD)})
assert.equal(process.env.SECRET_KEY, ${JSON.stringify(TEST_SECRET_KEY)})
assert.equal(process.env.STYLEAI_SKIP_MODEL_SCAN, '1', '嵌套运行器必须重新注入模型扫描开关')
assert.equal(process.env.STYLEAI_TEST_INIT, '1', '嵌套运行器必须启用严格测试初始化')
const db = require('../db/init')
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  for (const table of ['rule_groups', 'users', 'admin_users']) {
    assert.ok(tables.includes(table), table + ' 应存在')
  }
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM rule_groups').get().count > 0)
  const admin = db.prepare("SELECT password_hash FROM admin_users WHERE username = 'admin'").get()
  assert.ok(admin)
  assert.ok(bcrypt.compareSync(process.env.ADMIN_PASSWORD, admin.password_hash))
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_configs').get().count, 0)
  fs.writeFileSync(process.env.TEST_DB_OBSERVED_PATH, dbPath)
} finally {
  db.stopWalCheckpointTimer()
  db.close()
}
`,
  )

  assert.equal(run.status, 0, output)
  const dbPath = readObservedPath(observedPath)
  assert.notEqual(path.resolve(dbPath), path.join(backend, 'db', 'styleai.db'))
  assert.equal(fs.existsSync(path.join(backend, 'db', 'styleai.db')), false)
  assertTemporaryDatabaseRemoved(dbPath)
})

test('测试子进程不继承本机 .env 与真实 AI/支付凭据', (t) => {
  const sentinels = {
    DASHSCOPE_API_KEY: 'inherited-dashscope-sentinel',
    LLM_API_BASE: 'https://inherited-llm.invalid',
    LLM_API_KEY: 'inherited-llm-sentinel',
    LLM_MODEL: 'inherited-model',
    WXPAY_MCHID: 'inherited-wechat-sentinel',
    WXPAY_APIV3_KEY: 'inherited-wechat-key-sentinel',
    ALIPAY_APP_ID: 'inherited-alipay-sentinel',
    ALIPAY_PRIVATE_KEY_PATH: 'inherited-alipay-private-key',
  }
  const { run, output } = makeSandbox(
    t,
    `const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const expected = ${JSON.stringify(sentinels)}
for (const [key, value] of Object.entries(expected)) {
  assert.equal(process.env[key], '', key + ' 不应继承本机凭据')
}
require('dotenv').config()
for (const [key, value] of Object.entries(expected)) {
  assert.equal(process.env[key], '', key + ' 不应从 backend/.env 读回')
}
assert.equal(fs.existsSync(process.env.DOTENV_CONFIG_PATH), false, 'dotenv 必须指向不存在的隔离路径')
`,
    {
      inheritedEnv: sentinels,
      beforeRun(backend) {
        fs.writeFileSync(
          path.join(backend, '.env'),
          Object.entries(sentinels)
            .map(([key, value]) => key + '=' + value)
            .join('\n'),
        )
      },
    },
  )

  assert.equal(run.status, 0, output)
})

test('子测试失败时运行器仍清理临时库及 WAL/SHM', (t) => {
  const { observedPath, run, output } = makeSandbox(
    t,
    `const fs = require('node:fs')
const db = require('../db/init')
fs.writeFileSync(process.env.TEST_DB_OBSERVED_PATH, process.env.STYLEAI_DB_PATH)
throw new Error('intentional isolation probe failure')
`,
  )

  assert.notEqual(run.status, 0, output)
  assert.match(output, /intentional isolation probe failure/)
  assertTemporaryDatabaseRemoved(readObservedPath(observedPath))
})

test('清理失败时运行器返回非零且不打印清理成功', (t) => {
  const { observedPath, run, output } = makeSandbox(
    t,
    `const fs = require('node:fs')
fs.writeFileSync(process.env.TEST_DB_OBSERVED_PATH, process.env.STYLEAI_DB_PATH)
`,
    {
      preloadSource: `const fs = require('node:fs')
const path = require('node:path')
const originalRmSync = fs.rmSync
fs.rmSync = function (target, ...args) {
  if (path.basename(String(target)).startsWith('styleai-test-db-')) {
    const error = new Error('intentional cleanup failure')
    error.code = 'EPERM'
    throw error
  }
  return originalRmSync.call(this, target, ...args)
}
`,
    },
  )

  assert.ok(fs.existsSync(observedPath), output)
  const dbPath = readObservedPath(observedPath)
  try {
    assert.notEqual(run.status, 0, output)
    assert.match(output, /删临时目录失败.*intentional cleanup failure/)
    assert.doesNotMatch(output, /临时库及 -wal\/-shm 已删除/)
    assert.equal(fs.existsSync(dbPath), true, '故障夹具应保留数据库供本测试核对')
  } finally {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true })
  }
})

test('严格测试初始化下基础种子失败会使运行器失败并清理临时目录', (t) => {
  assertSeedInitializationFailure(t, 'db/seed.js', 'intentional base seed failure')
})

test('严格测试初始化下增量种子失败会使运行器失败并清理临时目录', (t) => {
  assertSeedInitializationFailure(t, 'db/applyRuleSeeds.js', 'intentional incremental seed failure')
})

test('生产环境基础种子失败时拒绝继续启动', (t) => {
  assertProductionInitFails(
    t,
    {
      beforeRun(backend) {
        fs.writeFileSync(
          path.join(backend, 'db', 'seed.js'),
          "throw new Error('intentional production base seed failure')",
        )
      },
    },
    /intentional production base seed failure/,
  )
})

test('生产环境增量种子失败时拒绝继续启动', (t) => {
  assertProductionInitFails(
    t,
    {
      beforeRun(backend) {
        fs.writeFileSync(
          path.join(backend, 'db', 'applyRuleSeeds.js'),
          "throw new Error('intentional production incremental seed failure')",
        )
      },
    },
    /intentional production incremental seed failure/,
  )
})

test('生产环境增量种子校验失败时拒绝继续启动', (t) => {
  assertProductionInitFails(
    t,
    {
      beforeRun(backend) {
        fs.writeFileSync(
          path.join(backend, 'db', 'applyRuleSeeds.js'),
          `exports.applyRuleSeeds = () => ({
  checked: 1,
  inserted: 0,
  existing: 0,
  rejected: ['rules-broken.json: JSON 解析失败 fixture'],
})`,
        )
      },
    },
    /增量种子校验失败.*rules-broken\.json/,
  )
})

test('生产环境空库缺少基础种子文件时拒绝继续启动', (t) => {
  assertProductionInitFails(
    t,
    { beforeRun: (backend) => fs.rmSync(path.join(backend, 'db', 'seed.js')) },
    /seed\.js 不存在/,
  )
})
