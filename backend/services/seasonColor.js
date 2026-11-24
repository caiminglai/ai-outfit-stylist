/**
 * 四季色彩体系（借鉴颜序四季 / 四季色彩理论）
 * ============================================================
 * 把肤色的冷暖轴（色相角）与深浅轴（明度）映射到春/夏/秋/冬四季型，
 * 并给出对应季型的推荐色卡。
 *
 * 理论基础（四季色彩理论）：
 *   · 春型＝暖色相＋高明度 → 明亮、温暖、清新
 *   · 夏型＝冷色相＋高明度 → 柔和、淡雅、清凉
 *   · 秋型＝暖色相＋低明度 → 浓郁、醇厚、大地
 *   · 冬型＝冷色相＋低明度 → 鲜明、冷峻、对比
 *
 * ⚠️ 档位诚实：
 *  - 冷暖切点（52.86／64.02）与明度切点（50）都是人群分位或中位数，
 *    不是"测出来你是秋型"的医学结论；对外 ✅ 说"按肤色冷暖与深浅归到秋型"，
 *    ⛔ 不说"你就是秋型人"。
 *  - 色卡是该季型的"典型友好色"，不是"只能穿这些"；用户实测反馈（星级）
 *    才是最终判据。
 *  - 中性冷暖（色相角落在 52.86~64.02 之间）不硬塞进四季，给"柔"前缀，
 *    说明冷暖倾向不明显，色卡取两季交集。
 */

const { COLOR_NAME_HEX } = require('./colorMetrics')

// 冷暖切点与明度切点（与 colorMetrics.SKIN_HUE、profileEnricher.depthMap 同口径）
const WARM_THRESHOLD = 64.02 // h ≥ 此值算暖
const COLD_THRESHOLD = 52.86 // h ≤ 此值算冷
const LIGHTNESS_MID = 50 // skin_lightness 0~100 的中位数

/**
 * 四季型定义：key、中文名、特征描述、推荐色卡（色名从 colorMetrics.COLOR_NAME_HEX 取）
 */
const SEASONS = {
  spring: {
    key: 'spring',
    name: '春型',
    warmth: 'warm',
    depth: 'light',
    traits: '明亮、温暖、清新——适合暖调高明度色',
    palette: ['暖橘', '蜜桃色', '鹅黄色', '嫩芽绿', '奶杏色', '珊瑚粉'],
    avoid: ['黑色', '深灰', '藏蓝'],
  },
  summer: {
    key: 'summer',
    name: '夏型',
    warmth: 'cool',
    depth: 'light',
    traits: '柔和、淡雅、清凉——适合冷调高明度色',
    palette: ['雾霾蓝', '薰衣草紫', '樱花粉', '浅蓝', '银灰', '薄荷绿'],
    avoid: ['正红', '橘色', '金色'],
  },
  autumn: {
    key: 'autumn',
    name: '秋型',
    warmth: 'warm',
    depth: 'deep',
    traits: '浓郁、醇厚、大地——适合暖调低明度色',
    palette: ['焦糖', '驼色', '橄榄绿', '砖红', '咖啡棕', '姜黄'],
    avoid: ['白色', '浅粉', '银灰'],
  },
  winter: {
    key: 'winter',
    name: '冬型',
    warmth: 'cool',
    depth: 'deep',
    traits: '鲜明、冷峻、对比——适合冷调低明度色',
    palette: ['正红', '宝蓝', '藏青', '黑色', '纯白', '玫红'],
    avoid: ['橘色', '驼色', '杏色'],
  },
}

/**
 * 柔季型（中性冷暖时使用）：在四季型基础上加"柔"前缀，色卡取相邻两季交集
 */
const SOFT_SEASONS = {
  spring: {
    key: 'soft_spring',
    name: '柔春型',
    warmth: 'neutral-warm',
    depth: 'light',
    traits: '冷暖偏暖、明度高——介于春与夏之间，色卡取暖色中偏柔和的',
    palette: ['蜜桃色', '奶杏色', '鹅黄色', '浅粉', '浅蓝', '嫩芽绿'],
    avoid: ['黑色', '正红'],
  },
  summer: {
    key: 'soft_summer',
    name: '柔夏型',
    warmth: 'neutral-cool',
    depth: 'light',
    traits: '冷暖偏冷、明度高——介于夏与春之间，色卡取冷色中偏柔和的',
    palette: ['雾霾蓝', '樱花粉', '浅蓝', '灰粉', '薄荷绿', '浅紫'],
    avoid: ['正红', '橘色', '金色'],
  },
  autumn: {
    key: 'soft_autumn',
    name: '柔秋型',
    warmth: 'neutral-warm',
    depth: 'deep',
    traits: '冷暖偏暖、明度低——介于秋与冬之间，色卡取暖色中偏柔和的',
    palette: ['驼色', '焦糖', '橄榄绿', '砖红', '咖啡棕', '深紫'],
    avoid: ['白色', '浅粉'],
  },
  winter: {
    key: 'soft_winter',
    name: '柔冬型',
    warmth: 'neutral-cool',
    depth: 'deep',
    traits: '冷暖偏冷、明度低——介于冬与秋之间，色卡取冷色中偏柔和的',
    palette: ['宝蓝', '藏青', '玫红', '墨绿', '深紫', '枪灰'],
    avoid: ['橘色', '杏色'],
  },
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 判断冷暖倾向
 * @param {number|string|null} hue 色相角（度），优先用
 * @param {string|null} tone 冷暖档名（冷皮/暖皮/自然），兜底用
 * @returns {'warm'|'cool'|'neutral'|null}
 */
function judgeWarmth(hue, tone) {
  const h = num(hue)
  if (h !== null) {
    if (h <= COLD_THRESHOLD) return 'cool'
    if (h >= WARM_THRESHOLD) return 'warm'
    return 'neutral' // 色相角落在中性区
  }
  if (tone) {
    const s = String(tone)
    if (s.includes('冷')) return 'cool'
    if (s.includes('暖')) return 'warm'
    return 'neutral'
  }
  return null
}

/**
 * 判断深浅
 * @param {number|string|null} lightness skin_lightness（0~100），优先用
 * @param {string|null} detail 深浅档名（白皙/自然白/偏黄/小麦色/古铜色），兜底用
 * @returns {'light'|'deep'|null}
 */
function judgeDepth(lightness, detail) {
  const ln = num(lightness)
  if (ln !== null) return ln >= LIGHTNESS_MID ? 'light' : 'deep'
  if (detail) {
    const s = String(detail)
    if (['白皙', '自然白'].some((w) => s.includes(w))) return 'light'
    if (['偏黄', '小麦色', '古铜色'].some((w) => s.includes(w))) return 'deep'
  }
  return null
}

/**
 * 从肤色信息推导四季型
 * @param {{skin_hue?:number|string, skin_lightness?:number|string,
 *          skin_tone?:string, skin_tone_detail?:string}} input
 * @returns {{season:string, season_name:string, warmth:string, depth:string,
 *            traits:string, palette:string[], avoid:string[],
 *            confidence:number, basis:string}|null}
 *          冷暖或深浅任一判不出 ⇒ null（不编季型）
 */
function getSeasonType(input) {
  const p = input || {}
  const warmth = judgeWarmth(p.skin_hue, p.skin_tone)
  const depth = judgeDepth(p.skin_lightness, p.skin_tone_detail)
  if (!warmth || !depth) return null

  // 中性冷暖 ⇒ 柔季型
  let season
  if (warmth === 'neutral') {
    // 中性区按 h 更接近哪边给柔春/柔夏 或 柔秋/柔冬
    const h = num(p.skin_hue)
    const lean = h !== null && h < (WARM_THRESHOLD + COLD_THRESHOLD) / 2 ? 'cool' : 'warm'
    season =
      SOFT_SEASONS[
        lean === 'cool'
          ? depth === 'light'
            ? 'summer'
            : 'winter'
          : depth === 'light'
            ? 'spring'
            : 'autumn'
      ]
  } else {
    const key =
      warmth === 'warm'
        ? depth === 'light'
          ? 'spring'
          : 'autumn'
        : depth === 'light'
          ? 'summer'
          : 'winter'
    season = SEASONS[key]
  }

  // 置信度：两个轴都来自实测（hue + lightness）= 高；一个来自档名兜底 = 中
  const hasHue = num(p.skin_hue) !== null
  const hasLightness = num(p.skin_lightness) !== null
  const confidence = hasHue && hasLightness ? 0.9 : hasHue || hasLightness ? 0.6 : 0.3

  return {
    season: season.key,
    season_name: season.name,
    warmth,
    depth,
    traits: season.traits,
    palette: season.palette.map((name) => ({ name, hex: COLOR_NAME_HEX[name] || null })),
    avoid: season.avoid.map((name) => ({ name, hex: COLOR_NAME_HEX[name] || null })),
    confidence,
    basis:
      `冷暖轴＝${hasHue ? `色相角 ${p.skin_hue}°` : `档名「${p.skin_tone || '—'}」`}；` +
      `深浅轴＝${hasLightness ? `明度 ${p.skin_lightness}` : `档名「${p.skin_tone_detail || '—'}」`}`,
  }
}

/**
 * 五维肤色框架（借鉴 HBN 蓝皮书：黑／黄／红／白／青）
 * ============================================================
 * HBN《中国人群肤色研究蓝皮书》打破"非黑即白"，把肤色拆成五个独立维度：
 *   · 黑／白：明度轴（L*）—— L 低偏黑、L 高偏白
 *   · 黄：黄-蓝轴（b*）正方向——色相角偏黄区
 *   · 红：红-绿轴（a*）正方向——色相角偏红区
 *   · 青：黄-蓝轴（b*）负方向——色相角偏蓝绿区
 *
 * 本项目只有色相角（skin_hue）与明度（skin_lightness），没有完整 Lab 的 a 星与 b 星，
 * 所以用色相角近似映射：肤色色相角一般在 35~78°，
 *   · 35~50° → 偏红
 *   · 50~65° → 自然（红黄之间）
 *   · 65~78° → 偏黄
 *   · <35° → 偏青
 *
 * ⚠️ 档位诚实：
 *  - 这是**色相角近似**，不是严格的五维色度测量（C 档）。
 *  - 对外 ✅ 说"按色相角与明度推算的五维倾向"，⛔ 不说"你的五维肤色值是多少"。
 *
 * @param {{skin_hue?:number|string, skin_lightness?:number|string,
 *          skin_tone?:string, skin_tone_detail?:string}} input
 * @returns {{black:number, white:number, yellow:number, red:number, cyan:number, primary:string}|null}
 *          五维各 0~100，primary 是得分最高的维度名
 */
function getSkinFiveDimensions(input) {
  const p = input || {}
  const h = num(p.skin_hue)
  const ln = num(p.skin_lightness)
  if (h === null && ln === null) return null

  // 黑白轴（明度）
  let black = 0
  let white = 0
  if (ln !== null) {
    // ln 0~100 映射：0 → 黑100白0；100 → 黑0白100
    black = Math.round(100 - ln)
    white = Math.round(ln)
  }

  // 黄红青轴（色相角近似）
  let yellow = 0
  let red = 0
  let cyan = 0
  if (h !== null) {
    if (h < 35) {
      // 偏青
      cyan = Math.round(60 + (35 - h) * 2)
    } else if (h <= 50) {
      // 偏红区（35~50），越靠 35 越红
      red = Math.round(60 + (50 - h) * 2.7)
    } else if (h <= 65) {
      // 中间区，红黄各半
      red = Math.round(40 - (h - 50) * 2)
      yellow = Math.round((h - 50) * 2.7)
    } else {
      // 偏黄区（65~78+）
      yellow = Math.round(60 + (h - 65) * 3)
    }
    // 钳制在 0~100
    yellow = Math.max(0, Math.min(100, yellow))
    red = Math.max(0, Math.min(100, red))
    cyan = Math.max(0, Math.min(100, cyan))
  }

  const dims = { black, white, yellow, red, cyan }
  const primary = Object.entries(dims).sort((a, b) => b[1] - a[1])[0][0]

  return { ...dims, primary }
}

module.exports = {
  getSeasonType,
  getSkinFiveDimensions,
  SEASONS,
  SOFT_SEASONS,
  WARM_THRESHOLD,
  COLD_THRESHOLD,
  LIGHTNESS_MID,
}
