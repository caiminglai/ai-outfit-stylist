# vendor/makehuman — 从开源人体建模软件 MakeHuman 引进的测量字段词表

引进日期：2026-10-23（第十五阶段·第一步）。**本目录三个文件都是上游原件逐字节拷贝，⛔ 不许格式化、不许改一个字节**
（`.prettierignore` 早已写明"第三方源码原样保留（格式化它就没法和上游对账）"，本目录按同一条规矩办）。

## 从哪儿来

- 上游：MakeHuman（makehumancommunity.org，GitHub `makehumancommunity/makehuman`）
- 本机来源副本：`E:/website/files/clone-others-projects/08-虚拟角色与3D/makehuman`
- 上游 commit：`a8bc2d54ff0ac92e78ff71431b1023eda42bf482`（branch master，引进当日现量 `git rev-parse HEAD`）
- 上游作者声明的版权年份：2001-2020 MakeHuman Team

## 拷了哪三件（2026-10-23 落盘后逐字节复量，与上游源件 `Buffer.compare` 全等）

| 文件 | 字节 | md5 | 里面是什么 |
|---|---|---|---|
| `measurement_sliders.json` | 2154 | `46fa91331e886f4ba44178c1949e442d` | 20 个人体测量点、9 个部位分组（Neck／Upper arm／Lower arm／Torso／Hips／Upper leg／Knee／Lower leg／Ankle） |
| `bodyshapes_sliders.json` | 2763 | `2e751d8e5a5657739dd5b35732583aa1` | 女 8 型＋男 6 型体型名，另各挂 4 条激素型 |
| `LICENSE.md` | 3693 | `1611c926b64a72d4433d8cba7bc18e3d` | 上游的双轨授权声明，随件带一份，免得日后查授权要回盘外找 |

两个 JSON 的行尾是 **CRLF**（上游原样），别按"本站 md 一律纯 LF"去"顺手统一"——改了就对不上上面那两个 md5。
🔴 这件事**不是靠人记得住**的：仓库根 `.gitattributes` 有一条 `backend/vendor/**  -text`（10-24 本轮加），把整个目录的换行符归一化关掉。
没有这条规则时，上面那句 `* text=auto eol=lf` 会在 `git add` 时把 CRLF 折成 LF ⇒ 检出后磁盘字节与上游不再相同、本文件登记的 md5 变假、
`backend/test/bodyMeasureVocab.test.js` 第 1 块当场红。判据（不写库、不改文件）＝`git hash-object --no-filters <f>` 与 `git hash-object --path <f> <f>` 必须相同。

## 授权：源码与资产是两件事，本目录只取资产那一轨

`LICENSE.md` 第 49~61 行逐字（标题「C. The license for the bundled assets」）：

> The assets are defined as any data contributing to the graphical output of MakeHuman. This includes:
> \* The base mesh and proxies
> \* **Targets and modifiers**
> \* Textures
> \* Clothes (any MHCLO-based asset)
> \* Poses and expressions
>
> These assets have been released under **CC0 1.0 Universal**.

`measurement_sliders.json` 与 `bodyshapes_sliders.json` 都在 `data/modifiers/` 下，属上面第二条「Targets and modifiers」
⇒ 走 CC0。CC0 原文（同目录上游 `LICENSE.ASSETS.md`）授权范围含 "build upon, modify, incorporate in other works,
reuse and redistribute as freely as possible in any form whatsoever and **for any purposes, including without
limitation commercial purposes**" ⇒ 站3 是商业站，引进合法，⛔ 无需署名（但这条登记本身就是署名）。

同一份 `LICENSE.md` 第 15~24 行把**源码**（python／bat／shell／glsl，含 UI 图片）单独定为 **AGPL**。
⇒ 🔴 **站3 没有引进任何 MakeHuman 的 Python 代码**：`apps/human.py`、`plugins/0_modeling_a_measurement.py`
这些只读过、只在本机盘外副本里，⛔ 不许把它们的逻辑逐行译进 `backend/`（AGPL 传染性按"同一程序"判，
本站不冒这个边界）。本目录带 `LICENSE.md` 是为了日后有人翻到 AGPL 那句时能当场看清我们没取源码。

## ⛔ 故意没取的东西（不是漏，是判断）

- `data/targets/**` 共 1280 个 `.target`（含 `measure/` 那 40 个）＝网格顶点偏移量，本站没有 3D 渲染管线，用不上，且是 142 MB 死重。
- `modeling_sliders.json` 里 Face 那 146 条脸部滑杆、Gender 那 11 条（乳房与生殖器形状）＝与穿衣无关，⛔ 不进顾客表单。
- `macrodetails/` 的 8 个 `asian-*.target`（`asian-{female,male}-{baby,child,young,old}`）＝**这是欧美扫描数据出来的泛亚洲混合形变，
  一个 0~1 旋钮，不分中国、不分南北方**。⛔ 谁拿它当"中国人体型"谁就在编造。本站要的中国数值仍只认 GB/T 10000-2023（见 `13` 与 `10` §2d）。
- 上游把围度换算成滑杆的那套二分反解（`plugins/0_modeling_a_measurement.py` 的 `displayToData`）＝AGPL 源码，只记下"目标值→在 [-1,1] 内二分、最多 10 次、容差 0.01"这个**思路**，⛔ 不搬代码。

## 这一层在站3 干什么用

唯一消费者是 `backend/services/bodyMeasureVocab.js`（词表与站内现状对照）。
本目录两份 JSON 是**词表的上游真身**：`bodyMeasureVocab.js` 里每个测量点的 `mhMod` 都必须在
`measurement_sliders.json` 里逐字查得到，单测 `backend/test/bodyMeasureVocab.test.js` 守着这条漂移。
🔴 它**不提供任何数值阈值**，不参与打分、不参与规则匹配（口径逐条见 `docs/依据/23-人体测量字段词表输入输出规范-20261023.md`）。
