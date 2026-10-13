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
 * @param {number|string} statusOrMessage - 数字=HTTP状态码，字符串=消息(状态码默认200)
 */
function sendSuccess(res, data = null, statusOrMessage = 200) {
  let status = 200
  let message = undefined
  if (typeof statusOrMessage === 'string') {
    message = statusOrMessage
  } else if (typeof statusOrMessage === 'number') {
    status = statusOrMessage
  }
  const body = { success: true, data }
  if (message) body.message = message
  return res.status(status).json(body)
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

module.exports = { sendSuccess, sendError }
