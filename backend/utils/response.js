/**
 * 统一响应格式工具（与项目1一致）
 *
 * 成功: { success: true, data: T }
 * 失败: { success: false, error: { code: string, message: string } }
 */

/**
 * 发送成功响应
 * @param {import('express').Response} res
 * @param {*} data
 * @param {number|string|{status?: number, message?: string}} statusOrMessage
 *   数字=HTTP状态码；字符串=消息(状态码默认200)；
 *   对象={status, message} 两个都要时用这个（sendCreated 就靠它，见下）
 */
function sendSuccess(res, data = null, statusOrMessage = 200) {
  let status = 200
  let message = undefined
  if (typeof statusOrMessage === 'string') {
    message = statusOrMessage
  } else if (typeof statusOrMessage === 'number') {
    status = statusOrMessage
  } else if (statusOrMessage && typeof statusOrMessage === 'object') {
    status = Number.isFinite(statusOrMessage.status) ? statusOrMessage.status : 200
    message = statusOrMessage.message
  }
  const body = { success: true, data }
  if (message) body.message = message
  return res.status(status).json(body)
}

/**
 * 发送"已创建"响应：POST 建出一条新记录的那一档（REST/RFC 9110 §15.5.3）
 *
 * 为什么值得单独一档：200 只说"这事成了"，201 说"你要的新东西现在有了，在哪"。
 * 改造前全仓 0 处 201（现量：`grep -rn "statusCode, 201" backend/test` 回 0 行），
 * 所有创建口一律 200 ⇒ 客户端没法只看状态码区分"建好了"和"查了一下啥也没建"。
 *
 * 为什么不是所有 POST 都改：只有 handler 里真的 `INSERT` 的才算创建。
 * 现量 19 个 POST 带 INSERT，其中 auth 的 /guest /register（登录流）、models 的
 * /admin/scan（扫描同步）、analysis 的 /body（产出的是分析结果）、rules 的 /preview
 * 这些"动作口"保持 200；剩下 15 个记录创建口走这里。
 *
 * Location 只在"这个资源有一条现在就读得回来的 GET"时才给。RFC 9110 这里用词是 SHOULD 不是 MUST，
 * 硬造一个指不到地方的 Location 比不给更糟——客户端照它 GET 会拿到 404。本轮逐条数过（证据在
 * test/createdStatus.test.js，它是真发 HTTP 去读 Location 的，不是看代码猜的）：
 *   给（8 条里的 6 条走 HTTP 验过）：衣橱单品、配饰、化妆品 → /items/:id；规则组 → /groups/:id；
 *     顾客会话 → /session/:sessionId；微信/支付宝下单 → /order/:outTradeNo（查单口先读本地行，
 *     没配网关也回 200，只是状态还是 created；这两条要出门连网关，HTTP 级没测，理由记在这）。
 *   不给：inventory 的产品/分类、wardrobe 的搭配日记/心愿单、photos、clothing 只有列表口；
 *     creator 的作品更特殊——它**有** GET /works/:id，但新建那条 status='pending'，
 *     公开读口只放审核过的作品，实测照 Location 读回 404，所以也不给。
 *
 * @param {import('express').Response} res
 * @param {*} data 建出来的那份记录
 * @param {string|null} locationPath 新资源的绝对路径（如 '/api/wardrobe/items/12'），没有就传 null
 * @param {string|null} message 原来 sendSuccess 第三参里那句人话（如 '下单成功，请扫码支付'），没有就传 null
 */
function sendCreated(res, data = null, locationPath = null, message = null) {
  if (locationPath) {
    // 组绝对 URL：host 走 req.get('host')，Caddy 那一跳的 X-Forwarded-Host 由
    // server.js 的 `trust proxy = 1` 处理；拿不到 host 时退回相对路径，至少不是个坏 URL
    const req = res.req
    const host = typeof req?.get === 'function' ? req.get('host') : null
    const proto = req?.protocol || 'http'
    res.setHeader('Location', host ? `${proto}://${host}${locationPath}` : locationPath)
  }
  return sendSuccess(res, data, { status: 201, message })
}

/**
 * 发送错误响应
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} status
 * @param {string} code - 错误码（大写蛇形，如 NOT_FOUND / BAD_REQUEST）
 */
function sendError(res, message = '操作失败', status = 400, code = null) {
  if (!code) {
    if (status === 400) code = 'BAD_REQUEST'
    else if (status === 401) code = 'UNAUTHORIZED'
    else if (status === 403) code = 'FORBIDDEN'
    else if (status === 404) code = 'NOT_FOUND'
    else if (status === 409) code = 'CONFLICT'
    else if (status === 429) code = 'RATE_LIMITED'
    // 502/503/504 是"别人没响应"，不是"我们炸了"。原来 `status >= 500` 一把抓，
    // 天气那条线分出的 502（上游少回字段）/503（上游连不上）到了这里全被打成
    // INTERNAL_ERROR；前端 api.ts 会把 code 括在文案后面显示，顾客看到的是"服务器坏了"。
    else if (status === 502) code = 'BAD_GATEWAY'
    else if (status === 503) code = 'SERVICE_UNAVAILABLE'
    else if (status === 504) code = 'GATEWAY_TIMEOUT'
    else if (status >= 500) code = 'INTERNAL_ERROR'
    else code = 'ERROR'
  }
  return res.status(status).json({ success: false, error: { code, message } })
}

module.exports = { sendSuccess, sendCreated, sendError }
