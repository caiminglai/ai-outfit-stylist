// 11-03 大文件拆分轮：这一段从 services/recommendEngine.js 逐字搬来（肤色进色彩维的唯一取值口）。
// 函数体与口径注释一处未改；⛔ 对外出口仍只走 recommendEngine.js 那份再导出。
const { skinToneToLab, skinUndertoneFromHue, synthesizeSkinLab } = require('../colorMetrics')

/**
 * 肤色进色彩维的**唯一**取值口（第十阶段·第一步，docs/依据/18-肤色采集输入输出规范-20261021.md §2.5）。
 *
 * 为什么要收成一个（现量，10-21）：改前这里有四个各自拼字符串的读数点
 * （`:1047`/`:1096`/`:1128` 三处喂 `colorFit`，`:1072` 一处喂硬编码兜底），
 * 谁再新增第五处就会多一套口径；而第九阶段那条唯一真样本正是死在这条链的第一环——
 * `face_profiles` 里 `user_id=3` 那行肤色两格逐字 NULL ⇒ `colorFit(null, …)` 回 null ⇒
 * 快照 `color:null` ⇒ 二维回归闸门到不了（`17` §9.4）。
 *
 * 🔴 三条不许改的口径：
 *  ① **深浅（L 与 C）只认档名锚点，⛔ 不吃照片的绝对明度**。合成 Lab 的 L/C 一律取自
 *     `SKIN_TONE_ANCHORS`（10-29 起升 B 档：CIE 汇编华裔 404 人分位子样实测，仍非测色仪逐人实测），照片只贡献色相角 h。
 *     理由＝Alipour 2026 实测非受控成像下固定阈值分型 22.9% ＜ 基线 51.3%（`依据/02` §2 第 4 条），
 *     现量反例：`#E8C4B8` 经 `hexToLab` 得 L=81.89，比华裔 P95＝65.87 高 16 个点（`依据/04` §1.4）。
 *     ⛔ 更不许拿人群 P50（L 58.58／C 20.61）去补一个"看起来像实测"的明度——
 *     那是 `docs/依据/README.md:64` 硬规矩 2 逐字禁止的动作。
 *  ② **深浅档没选 ⇒ 照片那一维不接管**（`source` 永远不等于 `photo_sample`）。
 *     用户只确认冷暖、深浅留空时照样出分：`冷皮/自然/暖皮` 三个词本身就在这张 8 档表里。
 *  ③ 三样都拿不到 ⇒ 返回 `lab:null`，调用方把 null 原样交给 `colorFit` ⇒ 它回 null ⇒
 *     色彩维缺席（缺测不出分），⛔ 不在这里编一个肤色。
 *
 * @param {object} enriched enrichProfile 之后的画像（含档案回填的档名）
 * @param {object} profile 本次请求体原样（`skin_hue` 只可能从这里来，客户端递不进 Lab）
 * @returns {{lab:{L:number,a:number,b:number,C:number,h:number}|null, source:string|null, hue:number|null, undertone:string|null}}
 */
function _skinForColor(enriched, profile) {
  const toneText = enriched.skin_tone_detail || enriched.skin_tone || profile.skin_tone || null
  const depth = skinToneToLab(toneText)
  // SKIN_TONE_ANCHORS 的取值只有 L/a/b（C 是 colorFit 内部现补的），这里同样先算出来再合成，
  // ⛔ 但绝不把 C 写回那张共享表——它是模块级常量，写一次污染之后每一次取色。
  const depthLab = depth ? { L: depth.L, a: depth.a, b: depth.b } : null
  const depthC = depthLab ? Math.hypot(depthLab.a, depthLab.b) : null

  const rawHue = profile.skin_hue !== undefined ? profile.skin_hue : enriched.skin_hue
  const hue = Number(rawHue)
  // 用户自选深浅（0~100）→ 0~1；没有则 undefined，synthesizeSkinLab 自动回退到锚点 L
  const rawLightness =
    profile.skin_lightness !== undefined ? profile.skin_lightness : enriched.skin_lightness
  const lightness01 =
    rawLightness !== undefined && rawLightness !== null && rawLightness !== ''
      ? Math.max(0, Math.min(1, Number(rawLightness) / 100))
      : undefined
  // 闸门全在 synthesizeSkinLab 里（非有限数／越过 h 闸／档名认不出 ⇒ null），这里不再自己拼条件。
  const synth = synthesizeSkinLab(toneText, hue, lightness01)
  if (synth)
    return { lab: synth.lab, source: 'photo_sample', hue: synth.lab.h, undertone: synth.undertone }

  return {
    lab: depthLab ? { ...depthLab, C: depthC } : null,
    source: depthLab ? 'manual' : null,
    hue: Number.isFinite(hue) && skinUndertoneFromHue(hue) !== null ? hue : null,
    undertone: Number.isFinite(hue) ? skinUndertoneFromHue(hue) : null,
  }
}

module.exports = {
  _skinForColor,
}
