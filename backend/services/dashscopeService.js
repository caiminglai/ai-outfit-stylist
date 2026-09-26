/**
 * DashScope API 服务
 * 从 Python app/services/dashscope_service.py 翻译
 *
 * 封装阿里云 DashScope 的人脸分析和虚拟试穿 API
 * 注意：如果 DASHSCOPE_API_KEY 为空，返回模拟数据（MVP 降级模式）
 */

/**
 * 获取 DashScope API Key
 * @returns {string}
 */
function getApiKey() {
  return process.env.DASHSCOPE_API_KEY || ''
}

/**
 * 生成模拟特征评分
 * @returns {object}
 */
function generateMockFeatures() {
  return {
    对称度: Math.floor(Math.random() * 36) + 60, // 60-95
    立体度: Math.floor(Math.random() * 41) + 50, // 50-90
    健康度: Math.floor(Math.random() * 29) + 70, // 70-98
    肌肤状态: Math.floor(Math.random() * 36) + 60, // 60-95
    气质指数: Math.floor(Math.random() * 31) + 65, // 65-95
  }
}

/**
 * 生成模拟人脸分析数据
 * @returns {object}
 */
function mockFaceAnalysis() {
  const skinTones = ['暖皮', '冷皮', '中性']
  const faceShapes = ['圆脸', '方脸', '心形脸', '长脸', '菱形脸']
  return {
    skin_tone: skinTones[Math.floor(Math.random() * skinTones.length)],
    face_shape: faceShapes[Math.floor(Math.random() * faceShapes.length)],
    features: generateMockFeatures(),
  }
}

/**
 * 调用 DashScope 人脸分析 API
 * 如果未配置 API Key，返回模拟数据
 *
 * @param {string} photoUrl - 照片URL（相对路径或绝对URL）
 * @returns {Promise<object>} 分析结果 { skin_tone, face_shape, features }
 */
async function analyzeFace(photoUrl) {
  const apiKey = getApiKey()

  // 未配置 API Key，返回模拟数据
  if (!apiKey) {
    return mockFaceAnalysis()
  }

  try {
    const url =
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-vl-max',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                { image: photoUrl },
                {
                  text:
                    '请分析这张人脸照片，返回以下信息（JSON格式）：' +
                    '1. skin_tone: 肤色类型（暖皮/冷皮/中性）' +
                    '2. face_shape: 脸型（圆脸/方脸/心形脸/长脸/菱形脸）' +
                    '3. features: 包含以下评分（0-100整数）：对称度、立体度、健康度、肌肤状态、气质指数' +
                    '请以纯JSON格式返回，不要包含其他文字。',
                },
              ],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!resp.ok) {
      throw new Error(`HTTP请求失败，状态码: ${resp.status}`)
    }

    const result = await resp.json()

    // 解析返回结果
    const content = result?.output?.choices?.[0]?.message?.content || []
    let text = ''
    if (Array.isArray(content) && content.length > 0) {
      text = content[0].text || ''
    } else {
      text = String(content)
    }

    // 尝试从文本中提取 JSON
    const jsonStart = text.indexOf('{')
    const jsonEnd = text.lastIndexOf('}') + 1
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonStr = text.substring(jsonStart, jsonEnd)
      try {
        const parsed = JSON.parse(jsonStr)
        return {
          skin_tone: parsed.skin_tone || ['暖皮', '冷皮', '中性'][Math.floor(Math.random() * 3)],
          face_shape:
            parsed.face_shape ||
            ['圆脸', '方脸', '心形脸', '长脸', '菱形脸'][Math.floor(Math.random() * 5)],
          features: parsed.features || generateMockFeatures(),
        }
      } catch {
        // JSON 解析失败，返回模拟数据
      }
    }

    // 解析失败，返回模拟数据
    return mockFaceAnalysis()
  } catch (err) {
    console.warn(`[DashScope] 人脸分析API调用失败: ${err.message}`)
    return mockFaceAnalysis()
  }
}

/**
 * 轮询虚拟试穿异步任务结果
 * @param {string} apiKey - API密钥
 * @param {string} taskId - 任务ID
 * @param {number} maxRetries - 最大重试次数
 * @param {number} interval - 轮询间隔（毫秒）
 * @returns {Promise<string>} 结果图片URL
 */
async function pollTryonResult(apiKey, taskId, maxRetries = 30, interval = 2000) {
  const url = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`

  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      })

      const result = await resp.json()
      const status = result?.output?.task_status

      if (status === 'SUCCEEDED') {
        return result?.output?.results?.[0]?.url || ''
      } else if (status === 'FAILED') {
        throw new Error(`任务失败: ${JSON.stringify(result)}`)
      }

      // 任务进行中，等待后重试
      await new Promise((resolve) => setTimeout(resolve, interval))
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }

  throw new Error('虚拟试穿任务超时')
}

/**
 * 调用 DashScope 虚拟试穿 API
 * 如果未配置 API Key 或没有服装图片，返回原图（降级模式）
 *
 * @param {string} photoUrl - 用户照片URL
 * @param {string|null} garmentUrl - 服装图片URL（可选）
 * @returns {Promise<string>} 生成的试穿图片URL
 */
async function virtualTryon(photoUrl, garmentUrl = null) {
  const apiKey = getApiKey()

  // 未配置 API Key 或没有服装图片，返回原图
  if (!apiKey || !garmentUrl) {
    console.log(
      `[DashScope] 虚拟试穿降级模式: api_key=${apiKey ? '有' : '无'}, garment_url=${garmentUrl ? '有' : '无'}`,
    )
    return photoUrl
  }

  try {
    const url = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation'

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'virtual-try-on',
        input: {
          person_image_url: photoUrl,
          garment_image_url: garmentUrl,
        },
        parameters: {},
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!resp.ok) {
      throw new Error(`HTTP请求失败，状态码: ${resp.status}`)
    }

    const result = await resp.json()

    // 异步任务需要轮询获取结果
    const taskId = result?.output?.task_id
    if (taskId) {
      return await pollTryonResult(apiKey, taskId)
    }

    // 同步返回结果
    const outputUrl = result?.output?.results?.[0]?.url
    return outputUrl || photoUrl
  } catch (err) {
    console.warn(`[DashScope] 虚拟试穿API调用失败: ${err.message}`)
    return photoUrl
  }
}

module.exports = { analyzeFace, virtualTryon, mockFaceAnalysis }
