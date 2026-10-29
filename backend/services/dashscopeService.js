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
 * 肤色词表（冷暖轴），全站口径的唯一一份。
 * 表单收的是 暖皮/冷皮/自然（app/src/components/CustomerForm.tsx:19、PersonalProfileForm.tsx:33-37），
 * 规则条件里能命中的也只有这三个值。这里原来写的是「中性」⇒ 模型照提示词回一个"中性"，
 * 它进库之后任何按 skin_tone 分档的规则都命中不了，而下游看不出这是一条死值（2026-10-12 改）。
 * 别名归一成「自然」；归一不出来的（含"白皙"这类深浅轴的值）当缺字段处理＝补随机值并打 mock 标记。
 */
const SKIN_TONES = ['暖皮', '冷皮', '自然']
const SKIN_TONE_ALIASES = {
  中性: '自然',
  中性皮: '自然',
  中性肤色: '自然',
  自然色: '自然',
  neutral: '自然',
}

/** @returns {string|null} 认得出来返回全站口径的值，认不出返回 null */
function normalizeSkinTone(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (SKIN_TONES.includes(s)) return s
  const lower = s.toLowerCase()
  for (const [alias, canon] of Object.entries(SKIN_TONE_ALIASES)) {
    if (alias === s || alias.toLowerCase() === lower) return canon
  }
  return null
}

/**
 * 生成模拟人脸分析数据
 * @returns {object}
 */
function mockFaceAnalysis() {
  const skinTones = SKIN_TONES
  const faceShapes = ['圆脸', '方脸', '心形脸', '长脸', '菱形脸']
  // mock 标记必须带上：这三项是随机数，不标记就等于把掷出来的肤色/脸型当成真分析结果
  // 一路写进 face_features 并驱动后续推荐，用户和排查的人都分不出来（2026-10-12 补）
  return {
    skin_tone: skinTones[Math.floor(Math.random() * skinTones.length)],
    face_shape: faceShapes[Math.floor(Math.random() * faceShapes.length)],
    features: generateMockFeatures(),
    mock: true,
    mocked_fields: ['skin_tone', 'face_shape', 'features'],
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
                    '1. skin_tone: 肤色类型（暖皮/冷皮/自然，只能回这三个值之一；"自然"就是中性肤色）' +
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
        // 少回哪个字段就当场补哪个，但补的是随机值 ⇒ 必须逐字段标出来，
        // 否则"模型其实没说"和"模型说中性皮"在下游长得一模一样
        const mockedFields = []
        // 归一：认得出全站口径才当分析结果用；"中性"这类同义词并进来，
        // 深浅轴的值（白皙/偏黄…）回不到冷暖轴上，按缺字段补随机值并打标记
        let skinTone = normalizeSkinTone(parsed.skin_tone)
        if (!skinTone) {
          skinTone = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)]
          mockedFields.push('skin_tone')
        }
        let faceShape = parsed.face_shape
        if (!faceShape) {
          faceShape = ['圆脸', '方脸', '心形脸', '长脸', '菱形脸'][Math.floor(Math.random() * 5)]
          mockedFields.push('face_shape')
        }
        let features = parsed.features
        if (!features) {
          features = generateMockFeatures()
          mockedFields.push('features')
        }
        return {
          skin_tone: skinTone,
          face_shape: faceShape,
          features,
          mock: mockedFields.length > 0,
          mocked_fields: mockedFields,
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
    // 状态判断放在 try 外面：原来 FAILED 分支在 try 里 throw，
    // 同一个 try 的 catch 只做"睡一会儿再轮"，于是明确的失败信号被当成网络抖动，
    // 白等满 30×2s 后报"虚拟试穿任务超时"——客户看到的是超时，实际服务端早就说这单挂了。
    // 同一个坑的第二种走法：不查 resp.ok。401（密钥失效）/404（任务 id 不存在）/400
    // 这些确定性拒绝的响应体里没有 output.task_status，落到"进行中"分支同样白等满
    // 60 秒再报"超时"。10-13 直连该端点实测（无效密钥）：HTTP 401 +
    // {"code":"InvalidApiKey","message":"Invalid API-key provided."}——401/400/404 同形状，
    // 后两档没实测到（密钥就进不去）。
    let result = null
    let rejected = null // 确定性 4xx（429 除外）：{ status, code }
    let transient = false // 这一跳没读到状态：网络异常 / 429 / 5xx，才许下次再试
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      })

      if (resp.ok) {
        result = await resp.json()
      } else if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
        const bodyText = await resp.text().catch(() => '')
        let code = ''
        try {
          code = String(JSON.parse(bodyText)?.code ?? '')
        } catch {
          /* 非 JSON（网关的 HTML 错误页）就没 code，状态码本身够定位了 */
        }
        rejected = { status: resp.status, code }
      } else {
        transient = true
      }
    } catch {
      transient = true
    }

    if (rejected) {
      throw new Error(
        `虚拟试穿任务查询被拒(HTTP ${rejected.status}${rejected.code ? ` ${rejected.code}` : ''})`,
      )
    }
    if (transient || result === null) {
      await new Promise((resolve) => setTimeout(resolve, interval))
      continue
    }

    const status = result?.output?.task_status

    if (status === 'SUCCEEDED') {
      return result?.output?.results?.[0]?.url || ''
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      // 任务已经定了性，重试不会改变结果，直接把服务端的原话带出去
      const code = result?.output?.code || result?.code || ''
      const msg = result?.output?.message || result?.message || ''
      throw new Error(`虚拟试穿任务失败${code ? `(${code})` : ''}${msg ? `：${msg}` : ''}`)
    }

    // 任务进行中（PENDING/RUNNING），等待后重试
    await new Promise((resolve) => setTimeout(resolve, interval))
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

module.exports = {
  analyzeFace,
  virtualTryon,
  mockFaceAnalysis,
  // 给离线断言用的（业务代码不要直接调）：轮询这一段的"失败要立刻失败"必须有测试盯着
  pollTryonResult,
}
