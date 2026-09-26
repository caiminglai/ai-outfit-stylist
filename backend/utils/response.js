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
    else if (status >= 500) code = 'INTERNAL_ERROR'
    else code = 'ERROR'
  }
  return res.status(status).json({ success: false, error: { code, message } })
}

module.exports = { sendSuccess, sendError }
