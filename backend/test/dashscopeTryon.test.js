/**
 * 虚拟试穿任务轮询（services/dashscopeService.js）
 * ============================================================
 * 10-12 第二十七轮修的这一条：FAILED 分支原先在 try 里 throw，而同一个 try 的 catch
 * 只做"睡一会儿再轮"⇒ 服务端明确说了这单挂了，客户端还是白等满 30×2s，
 * 最后报"虚拟试穿任务超时"。用户看到的是超时，实际早就失败了；重试也救不回来。
 *
 * 全程不联网：fetch 由测试换成桩。运行: node --test test/dashscopeTryon.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const { pollTryonResult } = require('../services/dashscopeService')

const realFetch = globalThis.fetch

/** 按次序回若干份任务状态 */
function stubSequence(statuses) {
  let i = 0
  globalThis.fetch = async () => {
    const item = statuses[Math.min(i, statuses.length - 1)]
    i += 1
    return { ok: true, status: 200, json: async () => item }
  }
  return () => i
}

test('任务 FAILED ⇒ 当场抛出，不等满轮询、不报成超时', async () => {
  const count = stubSequence([
    {
      output: {
        task_status: 'FAILED',
        code: 'InvalidParameter',
        message: '图片尺寸不符合要求',
      },
    },
  ])
  try {
    const err = await pollTryonResult('sk-test', 'task-1', 30, 1).then(
      () => null,
      (e) => e,
    )
    assert.ok(err, '必须抛错')
    assert.match(err.message, /任务失败/)
    assert.match(err.message, /InvalidParameter/)
    assert.match(err.message, /图片尺寸不符合要求/)
    assert.ok(!/超时/.test(err.message), '不许把失败洗成超时')
    assert.strictEqual(count(), 1, '只查了一次就该停，不该接着轮')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('任务 SUCCEEDED ⇒ 返回结果图 URL', async () => {
  stubSequence([{ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://x/out.png' }] } }])
  try {
    const url = await pollTryonResult('sk-test', 'task-2', 5, 1)
    assert.strictEqual(url, 'https://x/out.png')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('还在 RUNNING ⇒ 才按间隔重试，跑满次数才报超时', async () => {
  const count = stubSequence([{ output: { task_status: 'RUNNING' } }])
  try {
    const err = await pollTryonResult('sk-test', 'task-3', 3, 1).then(
      () => null,
      (e) => e,
    )
    assert.match(err.message, /超时/)
    assert.strictEqual(count(), 3, 'RUNNING 才该把三轮用完')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('单跳网络异常不算失败：继续轮，下一跳读到 SUCCEEDED 就成', async () => {
  let i = 0
  globalThis.fetch = async () => {
    i += 1
    if (i === 1) throw new Error('stub: 抖动一下')
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: { task_status: 'SUCCEEDED', results: [{ url: 'u' }] } }),
    }
  }
  try {
    const url = await pollTryonResult('sk-test', 'task-4', 5, 1)
    assert.strictEqual(url, 'u')
    assert.strictEqual(i, 2)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('CANCELED/UNKNOWN 定性状态同样立刻停（重试不会改变结果）', async () => {
  for (const status of ['CANCELED', 'UNKNOWN']) {
    const count = stubSequence([{ output: { task_status: status } }])
    try {
      const err = await pollTryonResult('sk-test', `task-${status}`, 30, 1).then(
        () => null,
        (e) => e,
      )
      assert.match(err.message, /任务失败/)
      assert.strictEqual(count(), 1, `${status} 不该继续轮`)
    } finally {
      globalThis.fetch = realFetch
    }
  }
})
