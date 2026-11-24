/**
 * 肤色档 → 代表 CIELAB：表单那 8 个中文档的锚点、冷暖判定、按 L 区间合成肤色。
 * 11-03 大文件拆分轮从 services/colorMetrics.js 切出，锚点与逐档出处（B 档人群实测）随块注释一起搬来。
 * 对外入口仍是 services/colorMetrics.js。
 */

const { ownValue } = require('../../utils/common')
const { hexToLab } = require('./base')
const { resolveColor } = require('./resolve')

// ------------------------------------------------------------
// 3. 肤色档 → 代表 CIELAB（表单只有 8 个中文档，没有逐人实测色值）
//    🟢 10-29 重锚定（S1 样本扩容）：从"内部标定手拍值"升级为【B 档·人群实测分位】——
//    出处＝docs/依据/papers/人体肤色数据库（2025年版，CIE 2562025）.xlsx，族群＝CN 子集
//    3,555 行／404 人，按人聚合（同一受试者多部位取均值，h 由 atan2(meanB,meanA) 重算）；
//    分位口径与落位核对见 docs/依据/04 §1.4，提取工装与全部统计留痕在
//    盘外 E:\website\站3产生临时文件\skin-exp\extract.mjs → cn-person-anchors.json。
//    逐档子样出处（n＝该子样人数）：
//      白皙  ＝中性 h 人群 L 前 10% 中位（n=11）     旧值 L68 在 P95=65.87 之上＝外推，已纠正
//      自然白＝中性 h 人群 L 前 20~30% 中位（n=11）
//      冷皮  ＝冷色相子样（h<P25=52.86，n=24）中位
//      自然  ＝全体 P50（n=404）
//      暖皮  ＝暖色相子样（h>P75=64.02，n=12）中位
//      偏黄  ＝暖子样中 b 最高四分位中位（n=3；黄＝b 高，旧值 b25 高于人群 P95=21.56，已纠正）
//      小麦色＝全体 P10
//      古铜色＝最深 5 人中位（L 47.77~50.79 那一撮；旧值 L38 在 P1 之下＝外推，已纠正）
//    ⚠️ 两条实测事实，不许再退回"越深越暖"的手拍格局：
//      ① 最深人群（≈P1~P2）的 h 全部落在中性区（54.9~59.9），不暖 ⇒ 小麦色/古铜色 h 归"自然"档
//         是数据原样，不是 bug（docs/依据/04 §1.4 落实记录）；
//      ② 冷子样偏暗（L55.26）、暖子样偏亮（L61.53）⇒ 冷暖轴与深浅轴在人群里本来就拧着，
//         冷暖档的 L 不排队、不强迫单调。
//    仍不许对外称"测色仪实测"：这是文献汇编的人群分位，不是给这个顾客测出来的值。
// ------------------------------------------------------------
const SKIN_TONE_ANCHORS = {
  白皙: { L: 65.42, a: 10.31, b: 16.9 },
  自然白: { L: 63.33, a: 10.56, b: 17.9 },
  冷皮: { L: 55.26, a: 13.29, b: 16.9 },
  自然: { L: 58.53, a: 10.27, b: 16.77 },
  暖皮: { L: 61.53, a: 8.23, b: 17.41 },
  偏黄: { L: 60.57, a: 8.91, b: 19.48 },
  小麦色: { L: 54.1, a: 13.05, b: 18.57 },
  古铜色: { L: 49.51, a: 12.85, b: 20.46 },
}

/** 肤色档 → Lab；拿不到返回 null */
function skinToneToLab(skinTone) {
  if (!skinTone) return null
  const s = String(skinTone).trim()
  const direct = ownValue(SKIN_TONE_ANCHORS, s)
  if (direct) return direct
  const hit = Object.keys(SKIN_TONE_ANCHORS).find((k) => s.includes(k))
  if (hit) return SKIN_TONE_ANCHORS[hit]
  const lab = hexToLab(resolveColor(s))
  return lab || null
}

// ------------------------------------------------------------
// 3b. 肤色色相角（冷暖轴）判据 —— 第十阶段·第一步（docs/依据/18 §2.2）
//     切点＝华裔人群 h° 的 P25＝52.86 与 P75＝64.02（【B 档·人群参照】，
//     尺子与行数见 docs/依据/04 §1.4：族群列＝CN 的 3,555 行／404 人）。
//     🔴 **拿分位点当判据切点这件事本身是 C 档·本站自拟**：人群分布只说明
//     "这个人站在哪儿"，不规定"站那儿就该穿什么"；对外不许说"按实测分档"。
//     ⛔ 只吃色相角、⛔ 不吃绝对明度：Alipour 2026（DOI 10.1111/srt.70374，
//     档位【二手】）实测非受控成像下固定阈值 ITA 分型准确率 22.9% ＜ 基线 51.3%
//     （`docs/依据/02` §2 第 4 条），⇒ 照片来的 L* 不是肤色。
//     现量反例（盘外工装 phase10-20261021/cut-selfcheck.cjs）：一块典型"亮皮肤"
//     sRGB #E8C4B8 经 hexToLab 得 **L=81.89**，比华裔 P95＝65.87 还高 16 个点。
//     深浅那一轴（白皙/自然白/偏黄/小麦色/古铜色）因此**只能用户照镜子自己选**，
//     本函数从不返回它。
// ------------------------------------------------------------
const SKIN_HUE = {
  /** 华裔 h° P25 ⇒ 到此为止算冷皮（B 档人群分位＋C 档切法） */
  cold: 52.86,
  /** 华裔 h° P75 起算暖皮 */
  warm: 64.02,
  /** 闸下沿＝华裔 P5(44.36) − 8；外扩 8 是 C 档手拍 */
  min: 36.36,
  /** 闸上沿＝华裔 P95(70.05) ＋ 8；外扩 8 是 C 档手拍（10-29 前注释拿"偏黄锚点 h=74.36 在 P95 之外"当理由，
      重锚定后锚点 h 全部 ≤65.42，那条理由作废——闸界包的是**照片取色角度**的人群余量，不是锚点） */
  max: 78.05,
}

/**
 * 色相角 → 冷暖档名（站内唯一口径；配饰/妆容那两条 `includes()` 消费路只认这三个词）。
 * @param {number|string} hue 色相角（度）
 * @returns {'冷皮'|'自然'|'暖皮'|null} 非有限数或过不了 h 闸 ⇒ **null**，⛔ 不退回"自然"
 */
function skinUndertoneFromHue(hue) {
  const h = Number(hue)
  if (!Number.isFinite(h)) return null
  if (h < SKIN_HUE.min || h > SKIN_HUE.max) return null
  if (h <= SKIN_HUE.cold) return '冷皮'
  if (h >= SKIN_HUE.warm) return '暖皮'
  return '自然'
}

/** 华裔人群 L* 实测范围（docs/依据/04 §1.4：族群列＝CN 的 P5/P95），用于把用户深浅滑块映射到连续 L* */
const SKIN_L_RANGE = { p5: 51, p95: 66 }

/**
 * 深浅档名 + 取色角度 + 用户自选深浅 → 进 `colorFit` 的那个 Lab（18 §2.5 那条合成的**唯一实现处**）。
 *
 * 🔴 为什么放在 `colorMetrics.js` 而不是引擎里：规范 §2.5 原写"收成 `recommendEngine.js` 的一个
 * helper"，但 10-21 写码时现量到**第五处取值点**在 `services/topFromBody.js:379`（上衣处方第 2 层
 * 颜色，就是顾客在报告里看到的那串"更分离/更分不开"）。它不吃引擎，只吃 `topSpec(enriched)` 传进来的
 * 画像。⇒ 合成逻辑收不进引擎那一个 helper，只能收到这个**两边都 require 得到的模块**里，
 * 否则照片角度改了名次却不改建议色，正是本轮目标（"根据肤色推荐更合适的颜色"）要修的那件事。
 * 这条订正连同现量数字记进 18 §九。
 *
 * @param {string|null} toneText 深浅/冷暖档名（按 enriched.skin_tone_detail || skin_tone 的既有优先级传进来）
 * @param {number|string|null|undefined} hue 照片取色的色相角（度）；⛔ 客户端递不进 Lab
 * @param {number|string|null|undefined} [lightness01] 用户自选深浅 0~1（0＝最暗，1＝最亮）；
 *        来自 `skin_lightness` 滑块（0~100）。提供时 L 从华裔 P5~P95 线性映射，不再用锚点的 L。
 *        ⛔ 这仍然是用户照镜子自选，不是照片明度，不违反"深浅只认档名锚点"那条硬规矩。
 * @returns {{lab:{L:number,a:number,b:number,C:number,h:number}, undertone:'冷皮'|'自然'|'暖皮'}|null}
 *          档名认不出 或 角度过不了闸 ⇒ null（调用方回退到档名锚点，⛔ 不编值）
 */
function synthesizeSkinLab(toneText, hue, lightness01) {
  const anchor = skinToneToLab(toneText)
  if (!anchor) return null
  const undertone = skinUndertoneFromHue(hue)
  if (!undertone) return null
  const h = Number(hue)
  if (h < SKIN_HUE.min || h > SKIN_HUE.max) return null
  // ⚠️ C 一律取自锚点（C 档手拍表），照片**只贡献角度**。
  // ⛔ 不许把 C 写回 SKIN_TONE_ANCHORS：那是模块级共享常量，写一次污染之后每一次取色。
  const C = Math.hypot(anchor.a, anchor.b)
  // L：用户自选深浅优先（连续值），否则用锚点 L（离散档）
  const ln = Number(lightness01)
  let L = anchor.L
  if (Number.isFinite(ln) && ln >= 0 && ln <= 1) {
    L = SKIN_L_RANGE.p5 + ln * (SKIN_L_RANGE.p95 - SKIN_L_RANGE.p5)
  }
  const rad = (h * Math.PI) / 180
  return {
    lab: { L, a: C * Math.cos(rad), b: C * Math.sin(rad), C, h },
    undertone,
  }
}

module.exports = {
  SKIN_TONE_ANCHORS,
  skinToneToLab,
  SKIN_HUE,
  skinUndertoneFromHue,
  synthesizeSkinLab,
}
