'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DEFAULT_DB_PATH } = require('../db/paths')

function runGuard(configuredPath) {
  const env = { ...process.env }
  delete env.STYLEAI_DB_PATH
  if (configuredPath) env.STYLEAI_DB_PATH = configuredPath
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const { assertRuntimeDbPath } = require(${JSON.stringify(require.resolve('../db/paths'))});
       assertRuntimeDbPath(); console.log('allowed')`,
    ],
    { env, encoding: 'utf8', timeout: 10000 },
  )
}

test('未显式指定运行库时，拒绝把公开演示快照当可写数据库打开', () => {
  // 测试运行器会注入自己的 STYLEAI_DB_PATH；必须在干净子进程里验证真实默认路径。
  const result = runGuard()
  assert.notStrictEqual(result.status, 0)
  assert.match(result.stderr, /公开演示快照.*STYLEAI_DB_PATH/)
  assert.doesNotMatch(result.stdout, /allowed/)
})

test('显式指定独立运行库时允许启动', () => {
  const runtimePath = path.join(path.dirname(DEFAULT_DB_PATH), '..', 'runtime-db', 'styleai.db')
  const result = runGuard(runtimePath)
  assert.strictEqual(result.status, 0, result.stderr)
  assert.match(result.stdout, /allowed/)
})
