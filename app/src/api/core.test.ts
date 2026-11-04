/**
 * 请求核心（`src/api/core.ts` ＋它带着的那串领域模块）的第一份前端测试（2026-11-04 规范轮新建）。
 *
 * 为什么现在补：11-03 拆分轮把过去那份上千行的 `src/api.ts` 切成 `src/api/core.ts` 等 12 份，
 * `src/api.ts` 从此只剩一张转发出口名单；而 `grep -rln "api/core|unwrap|fetchWithTimeout" src --include=*.test.ts`
 * 现量 **0 份**——也就是说"URL 怎么拼、错误怎么折成给人看的那句话、游客身份什么时候换"这三件事
 * 全在前端测试面之外。后端那侧 `routes/*.js` 已经有 HTTP 级测试钉住"回什么"，
 * 但**顾客实际看到的那句话是这里折出来的**：后端把 429 的 `Retry-After` 发对了，
 * 这里折算错一档，用户看到的还是"稍后再试"，排查方向整个跑偏。
 *
 * ⚠️ 全程不发真请求：`fetch` 用 `vi.stubGlobal` 顶掉（⛔ 打后端、⛔ 打外网），
 *    `Response` 直接手搓给 `unwrap`；`localStorage` 用这个测试环境自带的那一份（现量可用，
 *    跨 it 会残留，所以每条之前 `clear()`）。真浏览器里的 Vite 代理、CORS、真实 429 头那一套
 *    仍然没被这份证明——那一次记在真浏览器点验里。
 *
 * ⚠️ 文案分 dev／prod 两档（`_isDev` 在模块求值那一刻读死 `import.meta.env.DEV`），
 *    而 vitest 里 `import.meta.env.DEV` 现量是 **true** ⇒ 静态 import 进来的那份只能测 dev 档。
 *    要看 prod 档必须 `vi.resetModules()` ＋ `vi.stubEnv('DEV', false)` 重新 import 一个实例
 *    （'prod 档六句文案'那条就是这么做的，⛔ 拿 dev 档的期望值去断言 prod 分支）。
 *
 * 钉二十六条：
 *  出口对齐 1 条：`src/api.ts` 真的只是转发——同一个函数身份，⛔ 存在第二份实现；
 *  URL 拼装 6 条：`BASE='/api'`／天气那条用 `URLSearchParams`（空格→`+`，且原样能解回来）／
 *    扫码那条手写 `encodeURIComponent`（空格→`%20`，与上面不同一把尺，钉住免得有人"顺手统一"）／
 *    三柜 POST·PUT·DELETE 的动词与 `items/:id` 路径／`brand: null` 必须原样出门／
 *    每个请求自带身份头／`listWardrobeItems` 在 `data` 缺 `items` 时回空数组；
 *  unwrap 错误分支 10 条：后端原话优先（400 的校验提示逐字送到眼前）／429 按 `Retry-After`
 *    折成"分钟／秒"／429 的 60 与 59 两个边界各归一档／`Retry-After` 缺失或 0 时说"稍后"／
 *    401·404·5xx 三句兜底各有其话／
 *    非 JSON 的失败体走状态码兜底那句／2xx 但 `success:false` 时把 `error.code` 念出来／
 *    2xx 但返回的不是 JSON／抛出的同一句话也喂给全局错误处理器／prod 档六句逐字；
 *  超时与断网 2 条：`AbortError` 折成超时那句／fetch 直接 reject 折成连不上那句；
 *  会话与账号 4 条：`getSessionId` 生成长度 37 的 `sess_` id 并落盘、第二次拿到同一个／
 *    已登录时身份跟着账号走／`clearExpiredSession` 只补时间戳不换 sid（10-12 取消轮换那句）／
 *    账号那格坏掉（非 JSON／缺 sessionId）当作没登录；
 *  注册与登录 3 条：请求头带的是**游客** sid（过户的钥匙）且 `nickname` 没给就不进 body、
 *    回来的账号写进本地／撞限流时后端那句原话送到眼前／登出只抹账号、游客 sid 留着。
 *
 * 运行: npx vitest run src/api/core.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as barrel from '../api'
import * as core from './core'
import {
  addWardrobeItem,
  deleteWardrobeItem,
  listWardrobeItems,
  lookupWardrobeSku,
  updateWardrobeItem,
} from './wardrobe'
import { getWeatherProfile } from './extras'
import type { WardrobeItem } from '../types/wardrobe'
import type { PutPayload } from './core'

const SESSION_KEY = 'style_ai_session'
const TS_KEY = 'style_ai_session_ts'
const ACCOUNT_KEY = 'style_ai_account'

/** 一次 fetch 的留痕（Headers 已被 undici 统一成小写键） */
interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

let calls: Seen[] = []

/**
 * 顶掉 fetch。`reply` 想模拟超时或断网，就在里面等 `init.signal` 或直接抛。
 * ⛔ 这里不调真网络。
 */
function stubFetch(reply: (seen: Seen, init: RequestInit) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const h = new Headers((init.headers as HeadersInit | undefined) ?? {})
    const seen: Seen = {
      url: String(input),
      method: String(init.method ?? 'GET'),
      headers: Object.fromEntries(h.entries()),
      body: init.body == null ? undefined : String(init.body),
    }
    calls.push(seen)
    return reply(seen, init)
  })
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const ok = (data: unknown) => json({ success: true, data })

/** 拿"被抛出来的那句话"，用来逐字比对（⛔ toThrow 的子串匹配，那会放过多余的半句） */
async function messageOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => {
      throw new Error('本该抛错，却没抛')
    },
    (e: unknown) => (e as Error).message,
  )
}

const unwrapMsg = (res: Response) => messageOf(core.unwrap(res))

const SAMPLE: PutPayload<WardrobeItem> = { name: '白衬衫', category: '上衣', brand: null }

beforeEach(() => {
  localStorage.clear()
  calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  core.setGlobalErrorHandler(null)
})

describe('出口对齐', () => {
  it('src/api.ts 只是转发：八个身份函数是同一个引用，内部件没漏进公共出口', () => {
    // 拆分轮 promised "函数体一处未改"：这条把那句话变成断言——barrel 与 core 必须是同一个引用。
    // 一旦有人把某个函数在 barrel 里重写一份（或忘了改 import），这里当场红。
    for (const name of [
      'setGlobalErrorHandler',
      'getSessionId',
      'clearExpiredSession',
      'getAccount',
      'setAccount',
      'registerAccount',
      'loginAccount',
      'logoutAccount',
    ] as const) {
      expect(barrel[name]).toBe(core[name])
    }
    // 反方向也要钉：`BASE`／`unwrap`／`headers`／`fetchWithTimeout` 在拆分前的 api.ts 里就没带 export，
    // 出口名单的口径是"逐字相同"⇒ 它们不该出现在公共出口上（消费方一律从 './core' 之内互相调用）。
    for (const internal of ['BASE', 'unwrap', 'headers', 'fetchWithTimeout']) {
      expect(internal in barrel).toBe(false)
    }
    expect(core.BASE).toBe('/api')
  })
})

describe('URL 拼装', () => {
  it('BASE 是 /api：前端全靠它走 Vite／compose 那层代理', async () => {
    stubFetch(() => ok({}))
    await getWeatherProfile('北京')
    expect(core.BASE).toBe('/api')
    expect(calls[0].url.startsWith('/api/')).toBe(true)
  })

  it('天气 profile：查询串走 URLSearchParams，空格编成 + 而且原样解得回来', async () => {
    stubFetch(() => ok({}))
    await getWeatherProfile('北京 下雨')
    const url = calls[0].url
    expect(url.startsWith('/api/weather/profile?location=')).toBe(true)
    expect(url).toContain('+')
    expect(url).not.toContain('%20')
    // 这半句才是这条的重点：编码换了形状，后端解出来还得是那两个汉字加一个空格
    expect(new URL(url, 'http://127.0.0.1').searchParams.get('location')).toBe('北京 下雨')
    expect(calls[0].method).toBe('GET')
  })

  it('扫码查重：手写的 encodeURIComponent，空格编成 %20（与上一条不同一把尺）', async () => {
    stubFetch(() => ok({ mine: null, store: null }))
    await lookupWardrobeSku('a b&c')
    expect(calls[0].url).toBe('/api/wardrobe/sku?sku=a%20b%26c')
    // 两条并排看才有意义：同一个客户端里两种编码并存。谁要"统一"，先想后端怎么解、`&` 会不会被吃掉。
  })

  it('三柜的动词与路径：POST 建、PUT 改带 id、DELETE 删带 id', async () => {
    stubFetch(() => ok({ id: 7 }))
    await addWardrobeItem(SAMPLE)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('/api/wardrobe/items')
    expect(JSON.parse(calls[0].body as string)).toEqual({
      name: '白衬衫',
      category: '上衣',
      brand: null,
    })

    await updateWardrobeItem(7, SAMPLE)
    expect(calls[1].method).toBe('PUT')
    expect(calls[1].url).toBe('/api/wardrobe/items/7')

    await deleteWardrobeItem(7)
    expect(calls[2].method).toBe('DELETE')
    expect(calls[2].url).toBe('/api/wardrobe/items/7')
    // `brand: null` 必须原样出门：三柜 PUT 的口径是"传 null＝把这列清空"。
    // 哪天它被 `.filter` 掉了，编辑框里删掉品牌点保存＝老值原封不动回来，界面看着像"改了没生效"。
    expect(JSON.parse(calls[1].body as string).brand).toBeNull()
  })

  it('每个请求自带 Content-Type 与当前身份头', async () => {
    stubFetch(() => ok({ items: [] }))
    localStorage.setItem(SESSION_KEY, 'sess_test-fixed')
    await listWardrobeItems()
    expect(calls[0].headers['content-type']).toBe('application/json')
    expect(calls[0].headers['x-session-id']).toBe('sess_test-fixed')
  })

  it('listWardrobeItems：data 里没有 items 时回空数组，⛔ undefined', async () => {
    stubFetch(() => ok({}))
    await expect(listWardrobeItems()).resolves.toEqual([])
  })
})

describe('unwrap 把后端的各种坏消息折成给人看的那句话', () => {
  it('后端原话优先：400 的校验提示逐字送到眼前，dev 档再缀上状态码', async () => {
    const msg = await unwrapMsg(
      json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: '缺少 location 参数，请提供城市名称' },
        },
        400,
      ),
    )
    expect(msg).toBe('缺少 location 参数，请提供城市名称 (HTTP 400)')
  })

  it('429：后端只发了 HTML 时按 Retry-After 折算成分钟／秒', async () => {
    expect(
      await unwrapMsg(
        new Response('<h1>Too Many Requests</h1>', {
          status: 429,
          headers: { 'Retry-After': '75' },
        }),
      ),
    ).toBe('请求过于频繁,请 2 分钟后再试')
    expect(
      await unwrapMsg(new Response('nope', { status: 429, headers: { 'Retry-After': '30' } })),
    ).toBe('请求过于频繁,请 30 秒后再试')
  })

  it('429：整 60 秒走分钟档，59 秒走秒档（`retryAfter >= 60` 那个边界，⛔ 写成 `> 60`）', async () => {
    // 变异探针 11-04：把 `>= 60` 改成 `> 60`，上一那条测试（75／30）照样全绿——
    // 因为 75 和 30 都离边界够远。边界只有 60 这一行能钉住，所以单独一条。
    // 60 秒对用户说「1 分钟后」比「60 秒后」更像人话，这就是那半角的差别所在。
    expect(
      await unwrapMsg(new Response('nope', { status: 429, headers: { 'Retry-After': '60' } })),
    ).toBe('请求过于频繁,请 1 分钟后再试')
    expect(
      await unwrapMsg(new Response('nope', { status: 429, headers: { 'Retry-After': '59' } })),
    ).toBe('请求过于频繁,请 59 秒后再试')
  })

  it('429：Retry-After 缺失或为 0 时说"请稍后再试"，⛔ 编出 0 秒／NaN 分钟／重复的"后"字', async () => {
    // 这一档 11-04 首测时抓到的是「请 稍后后再试」（多一个空格＋重复一个"后"），已改 core.ts。
    expect(await unwrapMsg(new Response('nope', { status: 429 }))).toBe('请求过于频繁,请稍后再试')
    expect(
      await unwrapMsg(new Response('nope', { status: 429, headers: { 'Retry-After': '0' } })),
    ).toBe('请求过于频繁,请稍后再试')
  })

  it('401／404／5xx 三档各有其话，⛔ 糊成一句"请求失败"', async () => {
    for (const [status, want] of [
      [401, '登录已过期,请刷新页面'],
      [404, '请求的资源不存在,请检查 API 路径是否正确'],
      [500, '后端服务内部错误 (HTTP 500),请查看终端日志'],
      [502, '后端服务内部错误 (HTTP 502),请查看终端日志'],
    ] as const) {
      expect(await unwrapMsg(new Response('boom', { status }))).toBe(want)
    }
  })

  it('其它非 2xx（400 又不是 JSON）走状态码兜底那句', async () => {
    expect(await unwrapMsg(new Response('<h1>Bad Request</h1>', { status: 400 }))).toBe(
      '请求异常 (HTTP 400),请查看终端日志',
    )
  })

  it('2xx 但 success=false：没给 message 时把 error.code 念出来，给了就用原话', async () => {
    expect(
      await unwrapMsg(json({ success: false, error: { code: 'NO_PROFILE', message: '' } })),
    ).toBe('操作失败(NO_PROFILE),请查看终端日志')
    expect(
      await unwrapMsg(
        json({ success: false, error: { code: 'X', message: '  后端自己的一句话  ' } }),
      ),
    ).toBe('后端自己的一句话')
  })

  it('2xx 但返回的不是 JSON ⇒ 那句"服务崩溃或 HTML 错误页"', async () => {
    expect(await unwrapMsg(new Response('<html>crash</html>', { status: 200 }))).toBe(
      '后端返回非 JSON 数据,可能是服务崩溃或返回了 HTML 错误页,请查看终端日志',
    )
  })

  it('抛出的同一句话也会喂给全局错误处理器', async () => {
    const heard: string[] = []
    core.setGlobalErrorHandler((m) => heard.push(m))
    const thrown = await unwrapMsg(
      new Response('nope', { status: 429, headers: { 'Retry-After': '12' } }),
    )
    expect(heard).toEqual([thrown])
  })

  it('prod 档六句文案逐字（顾客看到的其实是这一档）', async () => {
    // `_isDev` 在模块求值时读死，所以必须换一份 DEV=false 的实例才走到 prod 那些分支。
    vi.resetModules()
    vi.stubEnv('DEV', false)
    const prod = (await import('./core')) as typeof core
    const p = (res: Response) => messageOf(prod.unwrap(res))

    expect(await p(new Response('nope', { status: 500 }))).toBe('服务异常,请稍后重试')
    expect(await p(json({ success: false, error: { code: 'NO_PROFILE', message: '' } }))).toBe(
      '请求失败(NO_PROFILE),请稍后重试',
    )
    expect(await p(new Response('<html/>', { status: 200 }))).toBe('响应数据格式异常')
    expect(
      await p(json({ success: false, error: { code: 'X', message: '后端的一句话' } }, 400)),
    ).toBe('后端的一句话')
    // 401／404 两档不分 dev／prod：线上文案必须与 dev 档逐字相同，⛔ 跟着环境漂
    expect(await p(new Response('nope', { status: 401 }))).toBe('登录已过期,请刷新页面')
    expect(await p(new Response('nope', { status: 404 }))).toBe(
      '请求的资源不存在,请检查 API 路径是否正确',
    )
  })
})

describe('超时与断网', () => {
  it('到点 abort ⇒ 折成那句超时提示', async () => {
    stubFetch(
      (_seen, init) =>
        new Promise<Response>((_resolve, reject) => {
          // 替身必须真听 signal：否则"超时"这档永远触发不了，测试会挂住而不是通过。
          ;(init.signal as AbortSignal).addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )
    expect(await messageOf(core.fetchWithTimeout('/api/whatever', {}, 1))).toBe(
      '请求超时 — 后端服务可能卡住或未响应,请查看终端日志',
    )
  })

  it('fetch 直接 reject（后端没起／端口错／CORS）⇒ 那句连不上提示', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    expect(await messageOf(core.fetchWithTimeout('/api/whatever'))).toBe(
      '无法连接后端服务 — 请确认后端是否已启动,查看终端是否有报错',
    )
  })
})

describe('会话与账号', () => {
  it('getSessionId 生成 sess_ 前缀的 id 并落盘，第二次拿到同一个', () => {
    const sid = core.getSessionId()
    expect(sid.startsWith('sess_')).toBe(true)
    expect(sid).toHaveLength(37) // 'sess_' + 16 字节 × 每字节两位 base36
    expect(localStorage.getItem(SESSION_KEY)).toBe(sid)
    expect(core.getSessionId()).toBe(sid)
    expect(localStorage.getItem(TS_KEY)).toBeTruthy()
  })

  it('已登录时身份跟着账号走，⛔ 再返回游客那一格', () => {
    localStorage.setItem(SESSION_KEY, 'sess_guest')
    core.setAccount({ phone: '13800138000', sessionId: 'sess_account', nickname: '小张' })
    expect(core.getSessionId()).toBe('sess_account')
    expect(core.headers()['X-Session-Id']).toBe('sess_account')
  })

  it('clearExpiredSession 只补时间戳，不换 sid（10-12 取消轮换那句）', () => {
    localStorage.setItem(SESSION_KEY, 'sess_keep')
    localStorage.removeItem(TS_KEY)
    core.clearExpiredSession()
    expect(localStorage.getItem(SESSION_KEY)).toBe('sess_keep')
    expect(Number.isFinite(Number(localStorage.getItem(TS_KEY)))).toBe(true)
  })

  it('账号那格坏掉（非 JSON／缺 sessionId）当作没登录', () => {
    localStorage.setItem(ACCOUNT_KEY, '{不是 JSON')
    expect(core.getAccount()).toBeNull()
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ phone: '13800138000' }))
    expect(core.getAccount()).toBeNull()
    localStorage.setItem(SESSION_KEY, 'sess_guest')
    expect(core.getSessionId()).toBe('sess_guest')
  })
})

describe('注册与登录', () => {
  it('请求头带的是游客 sid（过户的钥匙），nickname 没给就不进 body，回来就写成账号', async () => {
    localStorage.setItem(SESSION_KEY, 'sess_old_guest')
    stubFetch(() =>
      ok({
        phone: '13800138000',
        session_id: 'sess_new',
        nickname: '小张',
        merged: { moved: { user_wardrobe: 3 }, dropped: 1 },
      }),
    )
    const out = await core.registerAccount('13800138000', 'abcdef')
    expect(calls[0].url).toBe('/api/auth/register')
    expect(calls[0].headers['x-session-id']).toBe('sess_old_guest')
    expect(JSON.parse(calls[0].body as string)).toEqual({
      phone: '13800138000',
      password: 'abcdef',
    })
    expect(out.merged).toEqual({ moved: { user_wardrobe: 3 }, dropped: 1 })
    expect(core.getAccount()).toEqual({
      phone: '13800138000',
      sessionId: 'sess_new',
      nickname: '小张',
    })

    await core.loginAccount('13800138000', 'abcdef')
    expect(calls[1].url).toBe('/api/auth/login')
    expect(JSON.parse(calls[1].body as string)).toEqual({
      phone: '13800138000',
      password: 'abcdef',
    })
  })

  it('撞限流时把后端那句原话送到眼前，⛔ 糊成"请求失败"', async () => {
    stubFetch(() =>
      json(
        {
          success: false,
          error: { code: 'RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' },
        },
        429,
        { 'Retry-After': '40' },
      ),
    )
    expect(await messageOf(core.loginAccount('13800138000', 'abcdef'))).toBe(
      '登录尝试过于频繁，请稍后再试 (HTTP 429)',
    )
  })

  it('登出只抹账号，游客 sid 留着（下次登回来还能过户）', () => {
    localStorage.setItem(SESSION_KEY, 'sess_guest')
    core.setAccount({ phone: '13800138000', sessionId: 'sess_account' })
    core.logoutAccount()
    expect(core.getAccount()).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).toBe('sess_guest')
    expect(core.getSessionId()).toBe('sess_guest')
  })
})
