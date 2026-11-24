/**
 * 静态创作页／付款页的会话失效策略（11-24 最终复审 fix round 2）
 * ==============================================================
 * 这两页不是 React，不能直接 import `api/core.ts`；但它们与展厅共用同一份
 * localStorage 账号。测试从**页面真实脚本**里截取身份与 api 函数送进 VM，
 * 不复制一份实现，也不启动服务。盯住四件事：
 *   1) 账号请求 401 只清发起请求的那个账号，迟到响应不能清新账号；
 *   2) 账号 session 不写进游客 key，失效后原游客身份仍保留；
 *   3) 账号 401 不偷偷降级成游客重试，而是发事件并要求回展厅登录；
 *   4) 真正的游客 401 仍允许换一个游客身份重试一次。
 *
 * 运行: node --test test/staticSessionPolicy.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const APP = path.join(__dirname, '..', '..', 'app')
const PAGES = [
  { file: 'public/creator.html', end: '/* ── Tab 切换' },
  { file: 'public/pay.html', end: 'function showMine' },
]

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => Object.fromEntries(data),
  }
}

function harness(page, fetchImpl, initial) {
  const html = fs.readFileSync(path.join(APP, page.file), 'utf-8')
  const start = html.indexOf('var SID_KEY')
  const end = html.indexOf(page.end, start)
  assert.ok(start >= 0 && end > start, `${page.file} 的身份脚本边界变了，请更新测试截取点`)
  const source = html.slice(start, end)
  const localStorage = memoryStorage(initial)
  const events = []
  const msg = { textContent: '', className: '' }
  class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init.detail
    }
  }
  const context = {
    localStorage,
    fetch: fetchImpl,
    CustomEvent,
    window: {
      dispatchEvent(event) {
        events.push(event)
        return true
      },
    },
    document: {
      getElementById(id) {
        assert.strictEqual(id, 'msg')
        return msg
      },
    },
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context, { filename: page.file })
  return { context, localStorage, events, msg }
}

const accountA = { phone: '13800138000', sessionId: 'acct_AAAAAAAA' }
const accountB = { phone: '13900139000', sessionId: 'acct_BBBBBBBB' }
const guest = 'guest_EXISTING'
const initialAccount = {
  style_ai_account: JSON.stringify(accountA),
  style_ai_session: accountA.sessionId,
  style_ai_guest: guest,
  style_ai_guest_ts: '123',
}

function response(status, body) {
  return { status, json: async () => body }
}

for (const page of PAGES) {
  test(`${page.file}：账号请求 401 清匹配账号、保留游客且不降级重试`, async () => {
    const calls = []
    const h = harness(
      page,
      async (url, options) => {
        calls.push({ url, headers: { ...options.headers } })
        if (url === '/api/auth/guest') {
          return response(200, { success: true, data: { session_id: 'guest_NEW' } })
        }
        return response(401, { success: false, error: { message: 'unauthorized' } })
      },
      initialAccount,
    )

    await assert.rejects(() => h.context.api('/api/protected'), /登录已过期/)
    assert.strictEqual(calls.length, 1, '账号失效后不能继续用失效身份或偷偷换游客重试')
    assert.strictEqual(calls[0].headers['X-Session-Id'], accountA.sessionId)
    const stored = h.localStorage.dump()
    assert.strictEqual(stored.style_ai_account, undefined)
    assert.strictEqual(stored.style_ai_session, undefined)
    assert.strictEqual(stored.style_ai_guest, guest, '账号身份不能覆盖原有游客身份')
    assert.strictEqual(stored.style_ai_guest_ts, '123')
    assert.strictEqual(h.events.length, 1)
    assert.strictEqual(h.events[0].type, 'style-ai-account-change')
    assert.strictEqual(h.events[0].detail.account, null)
    assert.strictEqual(h.events[0].detail.reason, 'unauthorized')
    if (page.file.endsWith('pay.html')) {
      assert.match(h.msg.textContent, /返回展厅重新登录/)
      assert.match(h.msg.className, /err/)
    }
  })

  test(`${page.file}：迟到的旧账号 401 不清掉期间新登录的账号`, async () => {
    const calls = []
    const h = harness(
      page,
      async (url, options) => {
        calls.push({ url, headers: { ...options.headers } })
        h.localStorage.setItem('style_ai_account', JSON.stringify(accountB))
        h.localStorage.setItem('style_ai_session', accountB.sessionId)
        if (url === '/api/auth/guest') {
          return response(200, { success: true, data: { session_id: 'guest_NEW' } })
        }
        return response(401, { success: false, error: { message: 'unauthorized' } })
      },
      initialAccount,
    )

    await assert.rejects(() => h.context.api('/api/protected'), /账号已切换/)
    assert.strictEqual(calls.length, 1, '旧请求返回 401 后不应再发一次请求')
    assert.strictEqual(
      JSON.parse(h.localStorage.dump().style_ai_account).sessionId,
      accountB.sessionId,
    )
    assert.strictEqual(h.localStorage.dump().style_ai_session, accountB.sessionId)
    assert.strictEqual(h.localStorage.dump().style_ai_guest, guest)
    assert.strictEqual(h.events.length, 0, '不能广播一次并非由当前账号触发的失效事件')
  })

  test(`${page.file}：游客请求 401 仍换游客身份重试一次`, async () => {
    const calls = []
    const h = harness(
      page,
      async (url, options) => {
        calls.push({ url, headers: { ...options.headers } })
        if (url === '/api/auth/guest') {
          return response(200, { success: true, data: { session_id: 'guest_NEW' } })
        }
        if (calls.filter((c) => c.url === '/api/protected').length === 1) {
          return response(401, { success: false, error: { message: 'unauthorized' } })
        }
        return response(200, { success: true, data: { ok: true } })
      },
      { style_ai_guest: guest, style_ai_guest_ts: '123' },
    )

    await h.context.api('/api/protected')
    assert.strictEqual(calls.length, 3)
    assert.strictEqual(calls[0].headers['X-Session-Id'], guest)
    assert.strictEqual(calls[1].url, '/api/auth/guest')
    assert.strictEqual(calls[2].headers['X-Session-Id'], 'guest_NEW')
    assert.strictEqual(h.localStorage.dump().style_ai_guest, 'guest_NEW')
    assert.strictEqual(h.events.length, 0)
  })
}

test('pay.html：共享 SPA 游客 401 后轮换身份成为后续请求的稳定身份', async () => {
  const calls = []
  const h = harness(
    PAGES.find((page) => page.file.endsWith('pay.html')),
    async (url, options) => {
      calls.push({ url, headers: { ...options.headers } })
      if (url === '/api/auth/guest') {
        return response(200, { success: true, data: { session_id: 'guest_NEW' } })
      }
      if (options.headers['X-Session-Id'] === 'sess_OLDGUEST') {
        return response(401, { success: false, error: { message: 'unauthorized' } })
      }
      return response(200, { success: true, data: { ok: true } })
    },
    { style_ai_session: 'sess_OLDGUEST', style_ai_session_ts: '123' },
  )

  await h.context.api('/api/protected')
  await h.context.api('/api/protected')

  assert.deepStrictEqual(
    calls.map((call) => [call.url, call.headers['X-Session-Id']]),
    [
      ['/api/protected', 'sess_OLDGUEST'],
      ['/api/auth/guest', undefined],
      ['/api/protected', 'guest_NEW'],
      ['/api/protected', 'guest_NEW'],
    ],
    '轮换后的共享游客身份必须同时用于立即重试和下一次普通请求',
  )
  const stored = h.localStorage.dump()
  assert.strictEqual(stored.style_ai_session, 'guest_NEW')
  assert.notStrictEqual(stored.style_ai_session_ts, '123')
  assert.strictEqual(stored.style_ai_guest, 'guest_NEW')
  assert.strictEqual(h.events.length, 0)
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('pay.html：重叠的共享游客 401 只注册一次并共用轮换后的身份', async () => {
  const calls = []
  const started = deferred()
  const release = deferred()
  let registrations = 0
  const h = harness(
    PAGES.find((page) => page.file.endsWith('pay.html')),
    async (url, options) => {
      calls.push({ url, headers: { ...options.headers } })
      if (url === '/api/auth/guest') {
        registrations += 1
        started.resolve()
        await release.promise
        return response(200, { success: true, data: { session_id: 'guest_NEW' } })
      }
      if (options.headers['X-Session-Id'] === 'sess_OLDGUEST') {
        return response(401, { success: false, error: { message: 'unauthorized' } })
      }
      return response(200, { success: true, data: { ok: true } })
    },
    { style_ai_session: 'sess_OLDGUEST', style_ai_session_ts: '123' },
  )

  const one = h.context.api('/api/payment/one')
  const two = h.context.api('/api/payment/two')
  await started.promise
  release.resolve()
  await Promise.all([one, two])
  await h.context.api('/api/payment/three')

  assert.strictEqual(registrations, 1, '重叠 401 必须复用同一次游客注册')
  assert.deepStrictEqual(
    calls.map((call) => [call.url, call.headers['X-Session-Id']]),
    [
      ['/api/payment/one', 'sess_OLDGUEST'],
      ['/api/payment/two', 'sess_OLDGUEST'],
      ['/api/auth/guest', undefined],
      ['/api/payment/one', 'guest_NEW'],
      ['/api/payment/two', 'guest_NEW'],
      ['/api/payment/three', 'guest_NEW'],
    ],
    '两个重试和下一次普通请求都必须使用同一个轮换身份',
  )
  const stored = h.localStorage.dump()
  assert.strictEqual(stored.style_ai_session, 'guest_NEW')
  assert.strictEqual(stored.style_ai_guest, 'guest_NEW')
  assert.strictEqual(h.events.length, 0)
})

test('pay.html：注册期间别的标签页换了共享游客时，重试跟随较新的共享身份', async () => {
  const calls = []
  const started = deferred()
  const release = deferred()
  const h = harness(
    PAGES.find((page) => page.file.endsWith('pay.html')),
    async (url, options) => {
      calls.push({ url, headers: { ...options.headers } })
      if (url === '/api/auth/guest') {
        started.resolve()
        await release.promise
        return response(200, { success: true, data: { session_id: 'guest_STALE' } })
      }
      if (options.headers['X-Session-Id'] === 'sess_OLDGUEST') {
        return response(401, { success: false, error: { message: 'unauthorized' } })
      }
      return response(200, { success: true, data: { ok: true } })
    },
    { style_ai_session: 'sess_OLDGUEST', style_ai_session_ts: '123' },
  )

  const request = h.context.api('/api/protected')
  await started.promise
  h.localStorage.setItem('style_ai_session', 'sess_OTHER_TAB')
  h.localStorage.setItem('style_ai_session_ts', '456')
  release.resolve()
  await request
  await h.context.api('/api/protected')

  assert.deepStrictEqual(
    calls.map((call) => [call.url, call.headers['X-Session-Id']]),
    [
      ['/api/protected', 'sess_OLDGUEST'],
      ['/api/auth/guest', undefined],
      ['/api/protected', 'sess_OTHER_TAB'],
      ['/api/protected', 'sess_OTHER_TAB'],
    ],
    '较新的共享身份是权威值，不能被本页较晚返回的注册结果覆盖',
  )
  const stored = h.localStorage.dump()
  assert.strictEqual(stored.style_ai_session, 'sess_OTHER_TAB')
  assert.strictEqual(stored.style_ai_session_ts, '456')
  assert.strictEqual(stored.style_ai_guest, 'sess_OTHER_TAB')
})

test('pay.html：游客注册期间登录账号时拒绝重试且不污染新账号', async () => {
  const calls = []
  const h = harness(
    PAGES.find((page) => page.file.endsWith('pay.html')),
    async (url, options) => {
      calls.push({ url, headers: { ...options.headers } })
      if (url === '/api/auth/guest') {
        h.localStorage.setItem('style_ai_account', JSON.stringify(accountB))
        h.localStorage.setItem('style_ai_session', accountB.sessionId)
        return response(200, { success: true, data: { session_id: 'guest_UNUSED' } })
      }
      return response(401, { success: false, error: { message: 'unauthorized' } })
    },
    { style_ai_session: 'sess_OLDGUEST', style_ai_session_ts: '123' },
  )

  await assert.rejects(() => h.context.api('/api/protected'), /账号已切换/)
  assert.deepStrictEqual(
    calls.map((call) => [call.url, call.headers['X-Session-Id']]),
    [
      ['/api/protected', 'sess_OLDGUEST'],
      ['/api/auth/guest', undefined],
    ],
    '注册期间切换账号后不能继续发游客重试',
  )
  const stored = h.localStorage.dump()
  assert.strictEqual(JSON.parse(stored.style_ai_account).sessionId, accountB.sessionId)
  assert.strictEqual(stored.style_ai_session, accountB.sessionId)
  assert.strictEqual(stored.style_ai_guest, undefined)
  assert.strictEqual(h.events.length, 0)
})

test('pay.html：游客注册失败后不会卡住共享注册Promise', async () => {
  const calls = []
  let registrations = 0
  const h = harness(
    PAGES.find((page) => page.file.endsWith('pay.html')),
    async (url, options) => {
      calls.push({ url, headers: { ...options.headers } })
      if (url === '/api/auth/guest') {
        registrations += 1
        return response(
          registrations === 1 ? 500 : 200,
          registrations === 1
            ? { success: false, error: { message: 'temporary' } }
            : { success: true, data: { session_id: 'guest_RECOVERED' } },
        )
      }
      if (options.headers['X-Session-Id'] === 'sess_OLDGUEST') {
        return response(401, { success: false, error: { message: 'unauthorized' } })
      }
      return response(200, { success: true, data: { ok: true } })
    },
    { style_ai_session: 'sess_OLDGUEST', style_ai_session_ts: '123' },
  )

  await assert.rejects(() => h.context.api('/api/protected'), /游客身份注册失败/)
  await h.context.api('/api/protected')

  assert.strictEqual(registrations, 2, '失败 Promise 清理后，下一次请求必须能重新注册')
  assert.strictEqual(
    calls.filter((call) => call.url === '/api/protected').at(-1).headers['X-Session-Id'],
    'guest_RECOVERED',
  )
  assert.strictEqual(h.localStorage.dump().style_ai_session, 'guest_RECOVERED')
  assert.strictEqual(h.localStorage.dump().style_ai_guest, 'guest_RECOVERED')
})
