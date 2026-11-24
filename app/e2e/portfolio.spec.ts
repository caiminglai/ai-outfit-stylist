import { expect, test, type Page } from '@playwright/test'

type GalleryDebugState = {
  modelCount: number
  currentMesh: {
    totalObjects: number
    skinnedMeshes: number
    regularMeshes: number
  } | null
  pivot: { childrenCount: number } | null
}

type DebugWindow = Window & {
  __portfolioE2EProblems?: string[]
  __debug?: { getState: () => GalleryDebugState }
}

async function captureBrowserProblems(page: Page): Promise<string[]> {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  await page.addInitScript(() => {
    const target = window as DebugWindow
    target.__portfolioE2EProblems = []
    window.addEventListener('error', (event) => {
      target.__portfolioE2EProblems?.push(`window.error: ${event.message}`)
    })
    window.addEventListener('unhandledrejection', (event) => {
      target.__portfolioE2EProblems?.push(
        `unhandledrejection: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`,
      )
    })
  })
  return problems
}

async function expectNoBrowserProblems(page: Page, problems: string[]): Promise<void> {
  for (const frame of page.frames()) {
    const frameProblems = await frame.evaluate(() => {
      return (window as DebugWindow).__portfolioE2EProblems || []
    })
    problems.push(...frameProblems.map((problem) => `${frame.url()}: ${problem}`))
  }
  expect(problems).toEqual([])
}

async function expectLoadedDemoModel(page: Page): Promise<void> {
  const gallery = page.frameLocator('iframe[title="3D模型展厅"]')
  await expect(gallery.locator('#model-status')).toHaveClass(/hidden/, { timeout: 60_000 })
  await expect(gallery.locator('#model-name')).toHaveText('PortfolioBot')
  const canvas = gallery.locator('#canvas-container canvas')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box?.width).toBeGreaterThan(0)
  expect(box?.height).toBeGreaterThan(0)
}

test('首页真实渲染后，点击 3D 人物可为游客打开深度档案', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.goto('/')

  await expect(page).toHaveTitle('AI形象顾问 — 你的私人穿搭助手')
  await expectLoadedDemoModel(page)
  await expectNoBrowserProblems(page, problems)

  const gallery = page.frameLocator('iframe[title="3D模型展厅"]')
  await gallery.locator('#canvas-container canvas').click({ position: { x: 240, y: 220 } })
  await expect(page.getByRole('heading', { name: '形象数据中心' })).toBeVisible()
  await expect(page.getByText('请选择服务模式', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /个人深度模式/ }).click()
  await expect(page.getByText('基本信息', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('昵称')).toHaveValue('')

  await expectNoBrowserProblems(page, problems)
})

for (const target of [
  { page: '/creator.html', endpoint: '**/api/creator/my', message: '#mine-list', open: true },
  { page: '/pay.html', endpoint: '**/api/payment/my', message: '#msg', open: false },
]) {
  test(`${target.page} 账号 401 后清当前账号、保留游客并提示回展厅登录`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem(
        'style_ai_account',
        JSON.stringify({ phone: '13800138000', sessionId: 'acct_AAAAAAAA' }),
      )
      localStorage.setItem('style_ai_session', 'acct_AAAAAAAA')
      localStorage.setItem('style_ai_guest', 'guest_EXISTING')
      localStorage.setItem('style_ai_guest_ts', '123')
    })
    let protectedCalls = 0
    await page.route(target.endpoint, async (route) => {
      protectedCalls += 1
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { message: 'unauthorized' } }),
      })
    })

    await page.goto(target.page)
    if (target.open) {
      await page.locator('.wrap > .tabs > .tab[data-pane="mine"]').click()
    }
    await expect(page.locator(target.message)).toContainText('登录已过期', { timeout: 15_000 })
    await expect(page.locator(target.message)).toContainText('返回展厅重新登录')
    expect(protectedCalls).toBe(1)
    const identity = await page.evaluate(() => ({
      account: localStorage.getItem('style_ai_account'),
      session: localStorage.getItem('style_ai_session'),
      guest: localStorage.getItem('style_ai_guest'),
      guestTs: localStorage.getItem('style_ai_guest_ts'),
    }))
    expect(identity).toEqual({
      account: null,
      session: null,
      guest: 'guest_EXISTING',
      guestTs: '123',
    })
    expect(pageErrors).toEqual([])
  })
}

test('付款页重叠游客 401 只注册一次，两个重试和后续请求共用新身份', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.addInitScript(() => {
    localStorage.setItem('style_ai_session', 'sess_OLDGUEST')
    localStorage.setItem('style_ai_session_ts', '123')
  })
  let release401!: () => void
  const stale401 = new Promise<void>((resolve) => {
    release401 = resolve
  })
  const calls: Array<{ path: string; sid: string | undefined }> = []
  let registrations = 0
  await page.route('**/api/payment/my', async (route) => {
    const sid = route.request().headers()['x-session-id']
    calls.push({ path: '/api/payment/my', sid })
    if (sid === 'sess_OLDGUEST') {
      await stale401
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { message: 'unauthorized' } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    })
  })
  await page.route('**/api/payment/two', async (route) => {
    const sid = route.request().headers()['x-session-id']
    calls.push({ path: '/api/payment/two', sid })
    if (sid === 'sess_OLDGUEST') {
      await stale401
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { message: 'unauthorized' } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ok: true } }),
    })
  })
  await page.route('**/api/auth/guest', async (route) => {
    registrations += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { session_id: 'guest_NEW' } }),
    })
  })
  await page.route('**/api/payment/three', async (route) => {
    calls.push({ path: '/api/payment/three', sid: route.request().headers()['x-session-id'] })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ok: true } }),
    })
  })

  await page.goto('/pay.html')
  const secondRequest = page.evaluate(async () => {
    const target = window as unknown as { api: (path: string) => Promise<unknown> }
    return target.api('/api/payment/two')
  })
  await expect.poll(() => calls.filter((call) => call.sid === 'sess_OLDGUEST').length).toBe(2)
  release401()
  await secondRequest
  await page.evaluate(async () => {
    const target = window as unknown as { api: (path: string) => Promise<unknown> }
    await target.api('/api/payment/three')
  })

  expect(registrations).toBe(1)
  expect(calls.filter((call) => call.sid === 'guest_NEW')).toHaveLength(3)
  const identity = await page.evaluate(() => ({
    session: localStorage.getItem('style_ai_session'),
    guest: localStorage.getItem('style_ai_guest'),
  }))
  expect(identity).toEqual({ session: 'guest_NEW', guest: 'guest_NEW' })
  const expected401Logs = problems.filter((problem) => problem.includes('401 (Unauthorized)'))
  expect(expected401Logs).toHaveLength(2)
  expect(problems.filter((problem) => !problem.includes('401 (Unauthorized)'))).toEqual([])
})

test('模型页等待 PortfolioBot 真实加载，canvas 有尺寸且无页面错误', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.goto('/gallery?debug=1')

  await expect(page.locator('.model-card').filter({ hasText: 'PortfolioBot' })).toBeVisible()
  await expect(page.locator('#model-status')).toHaveClass(/hidden/, { timeout: 60_000 })
  await expect(page.locator('#model-name')).toHaveText('PortfolioBot')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()

  const canvasSize = await page.locator('#canvas-container canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement
    return { width: element.width, height: element.height }
  })
  expect(canvasSize.width).toBeGreaterThan(0)
  expect(canvasSize.height).toBeGreaterThan(0)

  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = (window as DebugWindow).__debug
        return debug?.getState() || null
      }),
    )
    .toMatchObject({
      modelCount: 1,
      pivot: { childrenCount: 1 },
      currentMesh: {
        totalObjects: expect.any(Number),
        skinnedMeshes: expect.any(Number),
        regularMeshes: expect.any(Number),
      },
    })

  const state = await page.evaluate(() => (window as DebugWindow).__debug?.getState())
  expect(
    (state?.currentMesh?.skinnedMeshes || 0) + (state?.currentMesh?.regularMeshes || 0),
  ).toBeGreaterThan(0)
  await expectNoBrowserProblems(page, problems)
})
