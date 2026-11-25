import { expect, test, type Page } from '@playwright/test'

type DebugWindow = Window & {
  __portfolioE2EProblems?: string[]
  __archiveBodyReads?: string[]
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

test('首页服务入口可为游客打开深度档案', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.goto('/?start=1')

  await expect(page).toHaveTitle('AI形象顾问 — 你的私人穿搭助手')
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

test('账号 A 切到 B 后只预填 B 的档案，A 的迟到响应不能覆盖', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'style_ai_account',
      JSON.stringify({ phone: '13800138000', sessionId: 'acct_A', nickname: null }),
    )
    localStorage.setItem('style_ai_session', 'acct_A')
    const target = window as DebugWindow
    target.__archiveBodyReads = []
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init)
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        window.location.origin,
      )
      const method = (init?.method || 'GET').toUpperCase()
      if (url.pathname === '/api/analysis/archive' && method === 'GET') {
        const sessionId = new Headers(init?.headers).get('X-Session-Id') || ''
        const readJson = response.json.bind(response)
        response.json = async () => {
          const body = await readJson()
          target.__archiveBodyReads?.push(sessionId)
          return body
        }
      }
      return response
    }
  })

  let releaseAccountA!: () => void
  const accountAReady = new Promise<void>((resolve) => {
    releaseAccountA = resolve
  })
  const archiveCalls: string[] = []
  await page.route('**/api/analysis/archive', async (route) => {
    const sessionId = route.request().headers()['x-session-id'] || ''
    archiveCalls.push(sessionId)
    if (sessionId === 'acct_A') {
      await accountAReady
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            profile: { height: 160 },
            fields: [],
            tags: [{ key: 'archive-account', label: '档案归属', value: 'A档案' }],
          },
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          profile: { height: 170 },
          fields: [],
          tags: [{ key: 'archive-account', label: '档案归属', value: 'B档案' }],
        },
      }),
    })
  })
  await page.route('**/api/auth/login', async (route) => {
    expect(JSON.parse(route.request().postData() || '{}')).toEqual({
      phone: '13900139000',
      password: 'test-password',
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { phone: '13900139000', session_id: 'acct_B', nickname: null, merged: null },
      }),
    })
  })

  await page.goto('/?start=1')
  await expect(page.getByRole('button', { name: /已登录:138/ })).toBeVisible()
  await expect.poll(() => archiveCalls.filter((id) => id === 'acct_A').length).toBe(1)
  await page.getByRole('button', { name: /已登录:138/ }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()

  await page.getByRole('button', { name: '我的账号', exact: false }).click()
  await page.getByPlaceholder('手机号').fill('13900139000')
  await page.getByPlaceholder('密码', { exact: true }).fill('test-password')
  await page.getByRole('button', { name: '登录', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /已登录:139/ })).toBeVisible()
  await expect.poll(() => archiveCalls.filter((id) => id === 'acct_B').length).toBe(1)
  await page.getByRole('button', { name: /个人深度模式/ }).click()
  const height = page.getByPlaceholder('cm，如 165')
  await expect(height).toHaveValue('170')
  releaseAccountA()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const target = window as DebugWindow
        return target.__archiveBodyReads?.includes('acct_A') || false
      }),
    )
    .toBe(true)
  await expect(height).toHaveValue('170')
  await expect(height).not.toHaveValue('160')
  const identity = await page.evaluate(() => localStorage.getItem('style_ai_account'))
  expect(identity).toContain('acct_B')
  expect(identity).not.toContain('acct_A')
  await expectNoBrowserProblems(page, problems)
})

test('删除档案确认保留例外，207 部分成功仍展示失败文件与保留项', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.addInitScript(() => {
    localStorage.setItem(
      'style_ai_account',
      JSON.stringify({ phone: '13800138000', sessionId: 'acct_DELETE' }),
    )
    localStorage.setItem('style_ai_session', 'acct_DELETE')
  })
  await page.route('**/api/analysis/archive', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { fields: [], tags: [] } }),
      })
      return
    }
    expect(new URL(route.request().url()).search).toBe('')
    await route.fulfill({
      status: 207,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          body: 1,
          face: 0,
          draft: 0,
          tags: 0,
          feedback: 0,
          logs: 0,
          records: 0,
          tryon: 0,
          photos: 0,
          item_feedback: 2,
          files: 2,
          files_failed: 1,
          files_shared: 1,
          paid_reports_retained: 1,
          report_basis_retained: 3,
        },
      }),
    })
  })
  let confirmation = ''
  page.on('dialog', async (dialog) => {
    confirmation = dialog.message()
    await dialog.accept()
  })

  await page.goto('/?start=1')
  await page.getByRole('button', { name: /已登录:138/ }).click()
  await page.getByRole('button', { name: '删除我的形象档案与记录' }).click()

  expect(confirmation).toMatch(/支付凭证.*已付费报告.*其他记录仍在引用/)
  expect(confirmation).toMatch(/门店会话不会由账号入口代删/)
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已删除:' })
  await expect(toast).toContainText('身体档案 1 份')
  await expect(toast).toContainText('衣物评分 2 条')
  await expect(toast).toContainText('同时清掉 2 个文件')
  await expect(toast).toContainText('1 个文件仍被其他记录引用')
  await expect(toast).toContainText('1 份已付费报告已保留')
  await expect(toast).toContainText('3 条报告复读依据已保留')
  await expect(toast).toContainText('1 个文件没删掉')
  await expectNoBrowserProblems(page, problems)
})

test('手机隐藏面板 inert，键盘只操作当前页签', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?start=1')

  const modelPanel = page.getByTitle('3D模型展厅').locator('..')
  const serviceButton = page.getByRole('button', { name: '我的账号', exact: false })
  await expect(modelPanel).toHaveAttribute('aria-hidden', 'true')
  await expect(modelPanel).toHaveAttribute('inert', '')
  await serviceButton.focus()
  await page.keyboard.press('Tab')
  expect(
    await page.evaluate(() => {
      const modelPanel = document.querySelector('iframe[title="3D模型展厅"]')?.parentElement
      return modelPanel?.contains(document.activeElement) || false
    }),
  ).toBe(false)

  const modelTab = page.getByRole('button', { name: '✨ 3D模型' })
  modelTab.focus()
  await expect(modelTab).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(modelPanel).toHaveAttribute('aria-hidden', 'false')
  await expect(modelPanel).not.toHaveAttribute('inert', '')
  await expect(page.getByTitle('3D模型展厅')).toBeVisible()

  const serviceTab = page.getByRole('button', { name: /🎯 选择模式/ })
  serviceTab.focus()
  await expect(serviceTab).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /个人深度模式/ })).toBeVisible()
  await expect(modelPanel).toHaveAttribute('inert', '')
  await expectNoBrowserProblems(page, problems)
})

test('展厅真实 WebGL 初始化，模型卡片支持键盘选择，加载失败可重试', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  let modelRequests = 0
  await page.route('**/api/models/list', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ id: 1, name: '浏览器测试人物', file: 'test/test.pmx', source: '离线测试' }],
      }),
    })
  })
  await page.route('**/api/models/file/test/test.pmx', async (route) => {
    modelRequests += 1
    await route.abort('failed')
  })

  await page.goto('/gallery')
  const canvas = page.locator('#canvas-container canvas')
  await expect(canvas).toBeVisible()
  expect(
    await canvas.evaluate((node) => Boolean((node as HTMLCanvasElement).getContext('webgl2'))),
  ).toBe(true)
  const card = page.locator('.model-card[data-index="0"]')
  await expect(card).toHaveJSProperty('tagName', 'BUTTON')
  await expect(card).toHaveAttribute('aria-pressed', 'true')
  await card.focus()
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#model-status')).toHaveClass(/error/)
  await expect(page.getByRole('button', { name: '重试加载' })).toBeVisible()
  await expect(card).toHaveClass(/load-error/)
  const beforeRetryRequests = modelRequests
  await page.getByRole('button', { name: '重试加载' }).click()
  await expect.poll(() => modelRequests).toBeGreaterThan(beforeRetryRequests)
  await expect(page.locator('#model-status')).toHaveClass(/error/)
  expect(pageErrors).toEqual([])
})

test('没有人物模型时展厅显示空状态且不报页面错误', async ({ page }) => {
  const problems = await captureBrowserProblems(page)
  await page.goto('/gallery?debug=1')

  const overlay = page.locator('#api-error-overlay')
  await expect(overlay).toHaveClass(/show/)
  await expect(page.locator('#error-title')).toHaveText('暂无可用模型')
  await expect(page.locator('#error-desc')).toContainText('不影响信息填写与搭配报告')
  await expect(page.locator('#model-list-retry')).toBeHidden()
  await expect(page.locator('#model-scroll').locator('.model-card')).toHaveCount(0)
  await expectNoBrowserProblems(page, problems)
})
