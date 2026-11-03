/**
 * 上衣 × 人 的贴合分：三轴（色相对比／提亮／彩度匹配）＋同色糊合闸门＋单品互相呼应分。
 * 11-03 大文件拆分轮从 services/colorMetrics.js 切出，权重、切点与两轮复量账逐字搬动。
 * 无彩色判定线 ACHROMATIC_C 本轮搬到 ./base.js（它解释的是那边的 _hueAngle）⇒ 这里改成 require 进来。
 * 对外入口仍是 services/colorMetrics.js。
 */

const { ownValue } = require('../../utils/common')
const { hexToLab, hueGap, deltaE00, ACHROMATIC_C } = require('./base')
const { COLOR_NAME_HEX, LIGHTNESS_BANDS } = require('./vocab')
const {
  _firstColorNameIn,
  _resolveDetailed,
  resolveColor,
  colorFamily,
  _bandTokenIn,
  _bandOfText,
  bandOfLab,
} = require('./resolve')
const { skinToneToLab } = require('./skin')

// ------------------------------------------------------------
// 4. 上衣 × 人 的贴合分（合成分权重＝C 档手拍值，等 F7 的标注回归出来后替换）
// ------------------------------------------------------------
const _clamp01 = (v) => Math.max(0, Math.min(1, v))
/** 从"珊瑚粉、蜜桃色针织衫"这类结论文本里认第一个出现的色名（认不出返回 null） */
const _matchedColorName = (input) => {
  const s = String(input || '')
  if (ownValue(COLOR_NAME_HEX, s)) return s
  return _firstColorNameIn(s)
}
const WEIGHTS = { hueContrast: 0.45, brighten: 0.35, chromaMatch: 0.2 } // 手拍，未回归（C 档）

/**
 * 同色糊合闸门。ΔE00 与三轴同源（都是 Lab 差），把它当第四轴加一遍＝同一信息收两遍钱；
 * 但它手里有一件三轴都看不到的事：上衣和脸**几乎同一个色**时，对比与提亮都不成立，人糊成一片。
 *
 * **10-19 第二阶段改切点（产品决定，由用户拍）：`{lo:6,hi:15}` → `{lo:15,hi:30}`。**
 * 改前它在真实推荐里**一次没触发**（判据见 `docs/依据/11` §五 的覆盖率账：矩阵穿搭里 ΔE00<15 的 0 条），
 * 等于接了根空线。门槛仍取本库实测分布，不引外部 JND 阈值（本机没有可觉差原文，不许假装有出处）：
 *   8 档肤色锚点 × 58 色名 = 464 对（10-19 复量，本轮重跑同一把尺子）：
 *   ΔE00<6 的 5 对（1.1%）／6~15 的 45 对（9.7%）／**15~30 的 259 对（55.8%）**／≥30 的 155 对（33.4%）；
 *   分位 p05=10.9、p10=14.7、**p50=26.1**。
 * ⇒ 新口径：15 以下吃满惩罚 0.85，15~30 线性回到 1.0，30 以上一律不动。
 * ⚠️ 覆盖面从 10.8% 涨到 **66.6%**（<15 的 50 对 + 15~30 的 259 对），中位那一对被扣约 5.6%——
 *   它因此不再是"只裁极端糊色"的例外条款，而是**普遍参与缩放的第三笔账**；惩罚上限仍锁 0.85（最多扣 15%），
 *   所以它只能挪名次、不能推翻对比侧。这句是本轮改动的代价，对外要说，不能只说"闸门修好了"。
 *
 * **10-20 第六阶段·第一步复量（词表 232 键，8 档肤色 × 232 色名 = 1856 对；上面 464 对那组读数保留不改）：**
 *   ΔE00<6 的 14 对（0.8%）／6~15 的 179 对（9.6%）／**15~30 的 885 对（47.7%）**／≥30 的 778 对（41.9%）；
 *   分位 p05=12.0、**p50=27.9**、p95=45.5。覆盖面（<30 的两段相加）**66.6% ⇒ 58.1%**。
 *   中位那对实际被乘的闸门值现量：新表 ΔE00 27.9 ⇒ gate 0.979（扣 2.1%）；
 *   旧表 26.1 ⇒ gate 0.961（扣 3.9%）。扩表后平均力道反而轻了，因为新增的流行色大多不在糊色区。
 *   ⇒ 结论：**切点 15/30 不动**。理由是这两组读数的 p50 都落在 15~30 段内、且 15~30 都占了将近一半，
 *     换切点等于拿新分布再调一次产品参数，而本轮的目标是"认得出更多色"，不是"重排分数"。
 *     要重切的话必须先有反馈数据（feedback_events 现在 0 行），不能凭分布好看。
 */
const FUSION_GATE = { lo: 15, hi: 30, min: 0.85 }

/**
 * 呼应侧在总分里的份额（手拍，C 档）。
 * 两个数在返回值里各自留着（contrast_score 与 harmony_score），任何一条推荐都能拆回账——
 * 这是 08 §8.2「改之前先攒标注，别连着改两处导致分数没法归因」要求的写法。
 */
const HARMONY_SHARE = 0.3

/** @param {number} dE 上衣与肤色的 ΔE00 @returns {number} 0.85~1.0 的乘数 */
function fusionGate(dE) {
  const e = Number(dE)
  if (!Number.isFinite(e)) return 1
  if (e <= FUSION_GATE.lo) return FUSION_GATE.min
  if (e >= FUSION_GATE.hi) return 1
  const t = (e - FUSION_GATE.lo) / (FUSION_GATE.hi - FUSION_GATE.lo)
  return FUSION_GATE.min + t * (1 - FUSION_GATE.min)
}

/** 呼应侧混分：对比分（或明度档分）与整身呼应分按 HARMONY_SHARE 加权，两个分量都留在返回里 */
function _blendHarmony(contrastScore, opts) {
  const harmonyRaw =
    opts && opts.harmony !== undefined && opts.harmony !== null ? Number(opts.harmony) : NaN
  const harmony = Number.isFinite(harmonyRaw) ? Math.max(0, Math.min(100, harmonyRaw)) : null
  return {
    harmony,
    score:
      harmony === null
        ? Math.round(contrastScore)
        : Math.round(contrastScore * (1 - HARMONY_SHARE) + harmony * HARMONY_SHARE),
  }
}

/**
 * L5 明度档口径：这一条文案**没有具体色**，只有"深色/浅色"这一档亮度。
 * 能给的只有方向（Zhang 2025 那条讲的是"衣装比脸暗 ⇒ 脸显白"，本来就不需要具体色相），
 * 所以 brighten 取档位提示值，色相轴与彩度轴各按"没有信息"记 0.5 —— 与无彩色那条同一写法。
 * ⛔ 不给 hex、不算 ΔE00、闸门不参与（没有两个 Lab 可差），
 *    并且 `basis='lightness-band'` 一路带到报告与后台，谁看到这条分都知道它是粗算的。
 * @returns {object} 与 colorFit 同形状，只是 deltaE00／dHue／dL／chroma／top_hex 为 null
 */
function _bandOnlyFit(skinLab, band, opts, input) {
  const hint = LIGHTNESS_BANDS[band].brightenHint
  const contrastScore =
    100 * (WEIGHTS.hueContrast * 0.5 + WEIGHTS.brighten * hint + WEIGHTS.chromaMatch * 0.5)
  const blended = _blendHarmony(contrastScore, opts)
  return {
    score: blended.score,
    top_hex: null,
    top_label: LIGHTNESS_BANDS[band].label,
    deltaE00: null,
    dHue: null,
    hueContrast: 0.5,
    hue_applies: false,
    dL: null,
    brighten: Math.round(hint * 100),
    chroma: null,
    fusion_gate: 1,
    contrast_score: Math.round(contrastScore * 10) / 10,
    harmony_score: blended.harmony === null ? null : Math.round(blended.harmony * 10) / 10,
    basis: 'lightness-band',
    synonym_via: _bandTokenIn(input),
    family: null,
    band,
    evidence:
      'L5 明度档：这条文案没有具体色名，只有"深/浅"这一档 ⇒ 只喂 brighten 轴（Zhang 2025 那条方向性结论），色相与彩度两轴按无信息记 0.5，无 ΔE00、无闸门。档位提示值 0.8/0.5/0.2 与切点 L≤35／L≥65 都是本工程 C 档手拍，不是文献值',
  }
}

/**
 * @param {object|string} skin 肤色档中文名、'#hex' 或 {L,a,b}
 * @param {string|object} topColor 上衣色：'#hex'／色名／含色名的文案／{L,a,b}；
 *                只含"深色/浅色"这类明度词时走 L5 明度档口径（basis='lightness-band'）
 * @param {{harmony?:number}|null} opts 整身呼应分（outfitHarmony 出的 0~100）；缺省＝这一维没数据，不参与打分
 * @returns {null|{score:number, deltaE00:number|null, dHue:number|null, hueContrast:number, dL:number|null, brighten:number, chroma:number|null, basis:string, family:string|null, band:string|null, evidence:string}}
 *          色与明度档都取不到 ⇒ 返回 null（不编造分数）
 */
function colorFit(skin, topColor, opts) {
  const rawSkin = skin && typeof skin === 'object' && 'L' in skin ? skin : skinToneToLab(skin)
  if (!rawSkin) return null
  // 肤色锚点表只存 L/a/b，这里补齐 C，避免 NaN 一路传到 score
  const skinLab = { ...rawSkin, C: Math.hypot(rawSkin.a, rawSkin.b) }
  // 10-13 那条实测仍然成立：colorFit({L:60}, '#FFCC00')（a/b 缺 ⇒ C 算不出）回 null，
  // 不是回 score=NaN；守的就是下面这两行有限性检查。
  if (!isFinite(skinLab.L) || !isFinite(skinLab.C)) return null

  // top 侧三条入口（10-20 第六阶段·第一步）：
  //   ① {L,a,b} 对象；② hex／色名／含色名的文案（走五步归一链）；③ 只有明度词 ⇒ L5 档口径。
  // ⚠️ ①这条是**本轮才真的通**：改前写法是 `resolveColor(topColor)`，
  //    对象进来被 String() 读成 '[object Object]' ⇒ 返回 null ⇒ 整条 colorFit 直接 null，
  //    而注释却写着"签名允许调用方直接把 {L,a,b} 递进来"。现在按对象入口单独处理，
  //    并且不改调用方传进来的对象——SKIN_TONE_ANCHORS 是模块级共享常量，往里写 C 会污染后续每一次取色。
  const topIsLab = !!(topColor && typeof topColor === 'object' && 'L' in topColor)
  const detail = topIsLab
    ? { key: null, hex: null, lab: topColor, basis: 'lab-object', via: null }
    : _resolveDetailed(topColor)
  // 认不出色、又不含明度词 ⇒ 返回 null（规范 `14` §三/§五：不编分），调用方按 `if (fit)` 处理。
  // ⚠️ 这里加 `!detail ||` 是**防御性的，不是修 bug**：10-20 第六阶段·第一步我一度以为
  //    这一行会抛 TypeError，现量证明**不是**——`_resolveDetailed` 认不出时回的是
  //    `none = {key:null,hex:null,lab:null,basis:null,via:null}` 这个**对象**（`:719`），永远不是
  //    null，所以改前改后 13 组垃圾入参（''／null／'乱写的词'/'#ZZZ123'/全角 hex/123/{}/[]/…）
  //    **都回 null、一个没抛**。当时那句 "Cannot read properties of null (reading 'basis')"
  //    是我自己的探针在 null 返回值上读 `.basis` 抛的，不是模块抛的（账在 `14` §9.7）。
  // 🔴 §二·1：`detail.craft` 为真＝这个"颜色"是从句子里扫到的**工艺词**（牛仔／水洗／迷彩），
  //    它指的是面料处理方式，不是这件衣服的颜色。取到 hex 只为审计，⛔ 不许喂 ΔE00——
  //    一条「蓝色牛仔外套」里"蓝色"是具体色、"牛仔"是工艺；反过来光秃秃一句「牛仔短裤」
  //    在色彩这一维就是**缺测**，按硬规矩 2 回 null 或走明度档，不许凭空出一个贴合分。
  //    （边界：用户在自己衣橱里手打「牛仔」是 `basis='synonym'` 那条来路，不算工艺词，照常出分。
  //     与 §二·2 的手选／自由文案口径一致；这条偏差记进 `21` §十二。）
  if (!detail || !detail.lab || detail.craft) {
    const band = _bandOfText(String(topColor || ''))
    if (!band) return null
    return _bandOnlyFit(skinLab, band, opts, String(topColor || ''))
  }
  const topLabRaw = detail.lab
  if (!topLabRaw || !isFinite(topLabRaw.L)) return null
  const topC = isFinite(topLabRaw.C) ? topLabRaw.C : Math.hypot(topLabRaw.a, topLabRaw.b)
  if (!isFinite(topC)) return null
  const topLab = { ...topLabRaw, C: topC }

  const dE = deltaE00(skinLab, topLab)
  const dHue = hueGap(skinLab, topLab)
  const dL = topLab.L - skinLab.L
  const dC = topLab.C - skinLab.C
  // 无彩色那一侧色相角是 atan2(0,0) 造出来的假数 ⇒ 这一轴按"没有信息"记 0.5（它的最小值），
  // 而不是把 45% 的权重摊给剩下两轴——摊过去等于把假色相的收益转给明度轴，黑上衣会凭空涨分。
  const hueApplies = skinLab.C >= ACHROMATIC_C && topLab.C >= ACHROMATIC_C
  const hueContrastRaw = 0.5 + _clamp01(dHue / 360) // Schloss & Palmer 第②句：图形色(衣)对背景(脸)，色相差越大越被偏好
  const hueContrast = hueApplies ? hueContrastRaw : 0.5
  // 🔴 S1（10-19 蓝图短期项，10-23 落）：分母 40⇒80 且**中心化 0.5**。只改分母过不了蓝图自己的
  // 验收（61% 的配对卡的是 0 端：衣服只要不比脸暗就恒 0，分母动它一个都不降），必须把"同明度"
  // 从 0 分挪成 0.5 中性——方向仍是 Zhang 2025"衣装越暗脸越显白"，暗 40⇒趋 1、亮 40⇒趋 0，
  // 中段由 dL 连续区分（改前白/亮黄/浅粉在这轴恒同分）。⛔ 别抄旧文档里的 "/40"。
  const brighten = _clamp01(0.5 + (skinLab.L - topLab.L) / 80)
  const chromaMatch = 1 - _clamp01(Math.abs(dC) / 60)
  const gate = fusionGate(dE)
  const contrastScore =
    100 *
    (WEIGHTS.hueContrast * hueContrast +
      WEIGHTS.brighten * brighten +
      WEIGHTS.chromaMatch * chromaMatch) *
    gate
  // 呼应侧：整身单品两两 ΔE00 的面积加权相似度（outfitHarmony 出数）。
  // 这一维与上面那三维**不同源**：三维量的是"这件衣服 vs 这张脸"，呼应量的是"衣服之间互相"，
  // 加进来不是把同一个 Lab 差收两遍钱。分数拆开存（contrast_score / harmony_score）以便归因。
  const blended = _blendHarmony(contrastScore, opts)
  return {
    score: blended.score,
    top_hex: detail.hex,
    top_label:
      detail.key ||
      _matchedColorName(topColor) ||
      // {L,a,b} 对象进来时 String() 会读成 '[object Object]'，报告/后台照印就是乱码
      (topIsLab
        ? `Lab(${Math.round(topLab.L)}, ${Math.round(topLab.a)}, ${Math.round(topLab.b)})`
        : String(topColor).slice(0, 12)),
    deltaE00: Math.round(dE * 10) / 10,
    dHue: Math.round(dHue * 10) / 10,
    // 对比轴归一后的贡献值 0.5~1.0（Δhue 0°→0.5，180°→1.0）。
    // 区间只有一半宽度是文档 §8.2 定下的写法：它保证"色相无 separation"不至于被判成 0 分。
    // ⚠️ 无彩色时这里回的是"按没有信息记账"的 0.5，判据看 hue_applies 这个布尔。
    hueContrast: Math.round(hueContrast * 1000) / 1000,
    hue_applies: hueApplies,
    dL: Math.round(dL * 10) / 10,
    brighten: Math.round(brighten * 100),
    chroma: Math.round(topLab.C * 10) / 10,
    // ΔE00 闸门与两个分量的实际值：报告与后台要把总分拆回这两笔账时，靠这三个字段就够
    fusion_gate: Math.round(gate * 1000) / 1000,
    contrast_score: Math.round(contrastScore * 10) / 10,
    harmony_score: blended.harmony === null ? null : Math.round(blended.harmony * 10) / 10,
    // 10-20 第六阶段·第一步新增的三个审计字段：这条分是"凭什么认出的色"必须可查。
    // basis：hex／table-key／strip-color／add-color／synonym／in-text／lab-object／lightness-band
    // synonym_via：走了同义词库时记下的是**哪个别名**（前台要显示"咖啡色→咖啡棕"时有据）
    // family／band：色系与明度档（L4/L5 软标签，不进这条分，只供分组与文案）
    basis: detail.basis,
    synonym_via: detail.via,
    family: colorFamily(topColor),
    band: bandOfLab(topLab),
    evidence:
      'A 色差公式(GB/T 7921 / ISO-CIE 11664) + B 色相对比与明度效应(Schloss & Palmer 2011 图形色-背景那句 + Zhang 2025, DOI 见文件头) + C 三轴权重与呼应份额(手拍，未回归)；ΔE00 只当同色糊合闸门用（切点 15/30 取本库分布，非文献 JND；词表 232 键下现量 1856 对：<15 193 对 10.4%、15~30 885 对 47.7%、≥30 778 对 41.9%，覆盖面 58.1%）',
  }
}

/**
 * 面积权重取值口径：正数照用，**0 也照用**（0 表示这件不占面积，比如只当存在不算比重的配饰），
 * 只有 NaN／负数／没填才回退成 1（等同"未知，按平均一件算"）。
 * 原来两处写成 `Number(p.area) || 1`，`||` 会把合法的 0 一起吞掉 ⇒ 明确写 0 的单品
 * 被当成和平均一件一样重，加权结果和调用方给的面积比例相反。
 * @param {*} v parts 里的 area 原值
 * @returns {number}
 */
function areaWeight(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

/**
 * 整身配色和谐度：两两 ΔE00 按面积乘积加权（60-30-10 那类比例在这里体现为面积权重）
 * @param {Array<{label:string,color:string,area:number}>} parts 面积和不必为 1，会自动归一
 * @returns {null|{score:number, pairs:Array}}
 */
function outfitHarmony(parts) {
  const list = (parts || [])
    .map((p) => ({ ...p, lab: hexToLab(resolveColor(p.color)), weight: areaWeight(p.area) }))
    .filter((p) => p.lab)
  if (list.length < 2) return null
  let total = list.reduce((s, p) => s + p.weight, 0)
  // 全 0（调用方把所有件都标成不占面积）⇒ 归一化会 0/0，退化成等权
  if (!(total > 0)) {
    list.forEach((p) => {
      p.weight = 1
    })
    total = list.length
  }
  const pairs = []
  let num = 0
  let den = 0
  let simSum = 0
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const w = (list[i].weight / total) * (list[j].weight / total)
      const sim = 100 - Math.min(deltaE00(list[i].lab, list[j].lab), 100)
      num += w * sim
      den += w
      simSum += sim
      pairs.push({
        a: list[i].label,
        b: list[j].label,
        deltaE00: Math.round(deltaE00(list[i].lab, list[j].lab) * 10) / 10,
      })
    }
  }
  // 只剩一对且它权重为 0（另一件面积是 0）时 den 也是 0 ⇒ 同样按等权均值出分，不给 NaN
  const value = den > 0 ? num / den : simSum / pairs.length
  return { score: Math.round(value * 10) / 10, pairs }
}

module.exports = {
  WEIGHTS,
  FUSION_GATE,
  HARMONY_SHARE,
  fusionGate,
  colorFit,
  outfitHarmony,
}
