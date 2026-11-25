/**
 * DashScope 虚拟试穿提交与任务轮询（services/dashscopeService.js）
 * ============================================================
 * 10-12 第二十七轮修的这一条：FAILED 分支原先在 try 里 throw，而同一个 try 的 catch
 * 只做"睡一会儿再轮"⇒ 服务端明确说了这单挂了，客户端还是白等满 30×2s，
 * 最后报"虚拟试穿任务超时"。用户看到的是超时，实际早就失败了；重试也救不回来。
 *
 * 外部 provider 只接收受信任公网 origin 下的限时签名 URL；配置异常必须拒绝提交。
 * 全程不联网：fetch 由测试换成桩；重定向取图只访问本机回环临时 HTTP 服务。
 */
const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { pollTryonResult, virtualTryon } = require('../services/dashscopeService')
const { verifyUploadToken } = require('../utils/uploads')

const realFetch = globalThis.fetch
const TRYON_ENV_KEYS = ['DASHSCOPE_API_KEY', 'PUBLIC_BASE_URL', 'NODE_ENV', 'SECRET_KEY']

async function withIsolatedTryonEnv(values, run) {
  const saved = Object.fromEntries(TRYON_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of TRYON_ENV_KEYS) delete process.env[key]
  Object.assign(process.env, {
    DASHSCOPE_API_KEY: 'sk-offline-test',
    NODE_ENV: 'production',
    SECRET_KEY: 'offline-test-secret-at-least-32-characters',
    ...values,
  })
  try {
    return await run()
  } finally {
    globalThis.fetch = realFetch
    for (const key of TRYON_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

function successfulSubmission(capture) {
  return async (_url, options) => {
    capture.push(JSON.parse(options.body).input)
    return {
      ok: true,
      status: 200,
      json: async () => ({ output: { results: [{ url: 'https://provider.test/result.png' }] } }),
    }
  }
}

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

test('真实试穿提交使用服务端 www origin 的绝对限时签名 URL', async () => {
  await withIsolatedTryonEnv({ PUBLIC_BASE_URL: 'https://www.public.test/' }, async () => {
    const submissions = []
    globalThis.fetch = successfulSubmission(submissions)
    const result = await virtualTryon('/uploads/person.png', '/uploads/garment.png')
    assert.strictEqual(result, 'https://provider.test/result.png')
    assert.strictEqual(submissions.length, 1)
    const input = submissions[0]
    for (const [field, filename] of [
      ['person_image_url', 'person.png'],
      ['garment_image_url', 'garment.png'],
    ]) {
      const url = new URL(input[field])
      assert.strictEqual(url.origin, 'https://www.public.test')
      assert.strictEqual(url.pathname, `/uploads/${filename}`)
      assert.ok(
        verifyUploadToken(
          filename,
          `${url.searchParams.get('expires')}.${url.searchParams.get('signature')}`,
        ),
      )
    }
  })
})

test('公网配置缺失、非法或生产非 HTTPS 时零提交并明确拒绝', async () => {
  const invalidConfigs = [
    ['', /PUBLIC_BASE_URL/],
    ['not a url', /PUBLIC_BASE_URL/],
    ['http://public.test', /HTTPS/],
    ['ftp://public.test', /HTTP/],
    ['https://user:password@public.test', /PUBLIC_BASE_URL/],
    ['https://public.test/api/', /PUBLIC_BASE_URL/],
    ['https://public.test/?target=evil.test', /PUBLIC_BASE_URL/],
    ['https://public.test/#evil', /PUBLIC_BASE_URL/],
  ]
  for (const [publicBaseUrl, message] of invalidConfigs) {
    await withIsolatedTryonEnv({ PUBLIC_BASE_URL: publicBaseUrl }, async () => {
      let calls = 0
      globalThis.fetch = async () => {
        calls += 1
        throw new Error('配置无效时绝不允许联网')
      }
      await assert.rejects(
        () => virtualTryon('/uploads/person.png', '/uploads/garment.png'),
        (err) => {
          assert.strictEqual(err.status, 503)
          assert.strictEqual(err.code, 'TRYON_PUBLIC_URL_UNAVAILABLE')
          assert.match(err.message, message)
          return true
        },
      )
      assert.strictEqual(calls, 0)
    })
  }
})

test('URL join 边界拒绝协议相对、穿越和外链，绝不替换受信任 origin', async () => {
  await withIsolatedTryonEnv({ PUBLIC_BASE_URL: 'https://www.public.test' }, async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      throw new Error('非法图片路径绝不允许联网')
    }
    for (const badUrl of [
      '//attacker.test/person.png',
      '/uploads/../person.png',
      '/uploads/nested/person.png',
      'https://attacker.test/person.png',
    ]) {
      await assert.rejects(() => virtualTryon(badUrl, '/uploads/garment.png'), /\/uploads\//)
    }
    assert.strictEqual(calls, 0)
  })
})

test('未配置 API Key 仍保留离线降级，不要求公网地址也不联网', async () => {
  await withIsolatedTryonEnv({ DASHSCOPE_API_KEY: '', PUBLIC_BASE_URL: '' }, async () => {
    globalThis.fetch = async () => {
      throw new Error('离线降级不应联网')
    }
    assert.strictEqual(
      await virtualTryon('/uploads/person.png', '/uploads/garment.png'),
      '/uploads/person.png',
    )
  })
})

test('provider 可跟随 www 重定向读取签名图片，重定向后签名不丢失', async () => {
  const received = []
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/uploads/')) {
      res.writeHead(302, { Location: `/canonical${req.url}` }).end()
      return
    }
    if (req.url.startsWith('/canonical/uploads/')) {
      received.push(req.url)
      res.writeHead(200, { 'Content-Type': 'image/png' }).end('offline-image')
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await withIsolatedTryonEnv(
      { NODE_ENV: 'development', PUBLIC_BASE_URL: `http://www.public.test:${port}` },
      async () => {
        globalThis.fetch = async (url, options) => {
          const input = JSON.parse(options.body).input
          for (const field of ['person_image_url', 'garment_image_url']) {
            const external = new URL(input[field])
            assert.strictEqual(external.origin, `http://www.public.test:${port}`)
            const local = `http://127.0.0.1:${port}${external.pathname}${external.search}`
            const image = await realFetch(local, {
              headers: { host: external.host },
              redirect: 'follow',
            })
            assert.strictEqual(image.status, 200)
            assert.strictEqual(await image.text(), 'offline-image')
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              output: { results: [{ url: 'https://provider.test/result.png' }] },
            }),
          }
        }
        assert.strictEqual(
          await virtualTryon('/uploads/person.png', '/uploads/garment.png'),
          'https://provider.test/result.png',
        )
        assert.strictEqual(received.length, 2)
        for (const redirectedUrl of received) {
          const url = new URL(redirectedUrl, 'http://www.public.test')
          const filename = url.pathname.slice('/canonical/uploads/'.length)
          assert.ok(
            verifyUploadToken(
              filename,
              `${url.searchParams.get('expires')}.${url.searchParams.get('signature')}`,
            ),
          )
        }
      },
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
