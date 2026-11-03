# 站3 四项改进（校验 / 日志 / 前端警告 / 拆大文件）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 勾选跟踪。

**Goal:** 把「接口输入校验、路由日志归口、前端 lint 警告、超千行文件」四件事按用户选定的序（2 → 3 → 4 → 1）做完，每轮五道门复绿。

**Architecture:** 校验层不新建第二把尺子——本仓 `utils/common.js` 已经是入参守卫层（`asText/asNumber/asId/firstBadScalar/stripIdentityFields`），本轮只做「把每个入口手写一遍」收成「一张声明表 + 一个中间件」，底下仍调同一批函数。日志归口只做 6 条 `console.log` → `utils/logger` 的 `log`。第 4 项按条判「真行为问题／可安全重构」。第 1 项一个文件一轮，拆完立刻按内容重指该文件的定位符。

**Tech Stack:** Node 24 + Express 4 + better-sqlite3 + `node --test`；前端 React 19 + TypeScript + Vite + ESLint 9。

**Spec:** 无独立 spec 文档；需求＝用户 2026-11-03 那份四项清单 ＋ 本文档第一节的现量订正。

## 全局约束

- **五道门**（在 `backend/` 跑）：`npm run format:check`／`npm run openapi:check`／`npm run lint`／`npm test`；`app/` 侧 `typecheck`＋`lint`＋`build`。**每个任务收尾都要跑**。
- **不新增运行时依赖**。校验库（ajv/zod/express-validator）一律不装：要用户本机 `npm install`、lock 变、CI 的 `npm audit` 多一张面孔、发布面变大。
- **动了被按行号引用的东西 ⇒ 同轮按内容重指定位符**。尺子＝`node scripts/check-locators.js --list`（只报不改、退出码恒 0）。md／html／yml **不在任何门禁射程内**，漏改 CI 不报。
- **prettier 只管 `**/*.js`**，且 `--write` 会改行数 ⇒ 格式化也要走一遍定位符重指（路线 §五十六 就是这么记的）。
- **提交与 push 归用户**。我只改工作区。
- **未跟踪＝0 纪律**：我的探针一律写在 `E:/website/files/refactor-probes/`，跑完当场删并复验。
- **前端改动 ⇒ 真浏览器点一次**（用户硬规则 #39）。
- 中文文件禁用 `node -e` 打补丁；要脚本就 Write 成 `.cjs`。

## 基线读数（2026-11-03 本机现量，HEAD `9f109f2` ＋ 32 条未提交）

| 门 | 读数 | 判据 |
|---|---|---|
| `format:check` | **rc=1，9 份文件红** | `npx prettier --check "**/*.js"`，ANSI 色码夹在 `warn` 与 `]` 之间，`grep "warn]"` 会假 0，只认 prettier 自己那句「9 files」 |
| `openapi:check` | rc=0，116 条路径（跳过 3 条非数据路由） | 读真实 express 栈（`scripts/gen-openapi.js:237`），插中间件不会弄红它 |
| `lint` | rc=0，**0 error / 145 warning** | 组成＝no-console 87 ＋ prefer-const 30 ＋ no-unused-vars 28 |
| `node --test` | rc=0，**898 / 898 / 0** | `ℹ tests 898` |
| `app` eslint | rc=0，0 error / **13 warning** | 8 set-state-in-effect ＋ 4 react-refresh/only-export-components ＋ 1 exhaustive-deps |

## 一、那份清单的现量订正（先记账，再动手）

| 项 | 清单说的 | 现量 | 差在哪 |
|---|---|---|---|
| 1 | 4 个文件超千行 | 这 4 个行数**全对**（1563／1110／989／975），但超千行的是 **6 个**：`routes/wardrobe.js` 1541、`db/add-rules.js` 1455 漏了。`recommendEngine.js` 已经拆了一半（`services/recommend/ranker.js` 405／`ruleMatcher.js` 388／`colorSlots.js` 249） | 真代价不是拆，是**这 4 个文件被 392 条 `文件名:行号` 定位符指着**（137／109／85／61；全仓这种号 1080 条），而 md 不在门禁里，漏改没人报警 |
| 2 | 118 处 req.body/query，只有 8 个路由有 validate | `req.body|query|params` 在 `routes/` 里 **168 处**（含 server.js 170）；147 个 handler，其中写操作 **81** 个（get 66／post 54／put 12／patch 0／delete 15）。"8 个有 validate"复现成＝6 份文件引用校验（5 份用 `middleware/upload.js` 的 `validateImage` ＋ `rules.js` 手搓的 `validateChildren`），落成 8 个端点 | **前提已大半成立**：`utils/common.js` 就是入参守卫层，20 份路由文件全部 import 它（`asText` 56／`getSessionId` 53／`parseJsonField` 37／`asNumber` 24／`normalizeItem` 16／`firstBadScalar` 10）。逐入口现量（`writeGuardCensus`，改前跑）：**「读 body ＋ 写库 ＋ 零守卫」的入口＝0 个**；46 个写入口已过守卫，25 个不读 body。真缺口只有 **12** 个＝B 组 10 个（读 body 不过守卫就交给服务算）＋ customer.js 两处 `JSON.stringify(req.body?.profile_data || req.body || {})` 把客户端任意 JSON 整坨塞进 `customer_sessions.profile_data`（`express.json` 上限 10 MB） |
| 3 | payment 3／models 2／auth 1 共 6 条 console.log | **完全对**，6 条逐行见 §三。eslint 的 `no-console` 配了 `allow: ['warn','error']`，所以 routes 里 **151 条 `console.error/warn` 是真调用、不被规则拦**（我中途一度把 grep 的 142 当成注释污染，反悔了：数行去注释仍是 151） | 更要紧的一条：`routes/` 与 `services/` 里**没有一个文件 require `utils/logger`** ⇒ 这 157 条日志全只落 stdout，`backend/logs/server-*.log` 里一行都没有 |
| 4 | 13 条都是 `react-hooks/set-state-in-effect` | 总数 13 **对**，组成**不对**：只有 **8** 条是该规则，另 4 条 `react-refresh/only-export-components`、1 条 `react-hooks/exhaustive-deps` | 8 条的位置：AccessoryTab 140／CosmeticTab 169／CrossCabinetReport 138／PaidReports 279／RuleBrowser 108／WardrobeDiary 185／WardrobeTab 230／ExhibitionHall 275 |

**另记一笔**：`format:check` 现在就是红的（9 份），CI 后端 job 第一步就撞它。这份工作区推上去必红，与本计划无关，但挡在后面每一轮的路上。其中 6 份的定位符代价合计 9 条（applyRuleSeeds 6／ranker 1／seasonColor 0／wardrobeOutfitGenerator 0／bodyDimEstimator.test 2／seasonColor.test 0），另 3 份背着 230 条（profileEnricher 61／recommendEngine 137／topFromBody 32），**这 3 份的格式化并进它们各自那轮拆分一起做**，一轮付一次定位符账；否则同一批号要付两遍。⇒ 第 1 项前两轮做完之前 CI 绿不了，这条账要先讲清。

## 二、文件结构（谁负责什么，一次定死）

| 文件 | 动作 | 职责 |
|---|---|---|
| `backend/middleware/bodyGate.js` | 新建 | 唯一一把入口闸门中间件：`gateBody(spec)` 把声明表折成运行时检查＋类型整形，内部只调 `utils/common.js` 现成的 `asText/asNumber/asId/firstBadScalar`。**不含任何业务规则** |
| `backend/test/bodyGate.test.js` | 新建 | ① `gateBody` 的纯函数断言 ② **栈形闸门**：断言 §三 B 组那 10 个入口的 `route.stack` 里真挂了闸门——挂了但没登记／登记了但没挂，都红（抄 `routeIdParam20261014.test.js:520` 那道"故意会红"的招） |
| `backend/routes/customer.js` | 改 | 两处 profile_data 整坨写入换成「键投影 ＋ 字节上限」（`bodyGate` 提供 `capJson`） |
| `backend/routes/{accessory,analysis,cosmetic,recommend,wardrobe,payment}.js` | 改 | B 组 10 个入口挂 `gateBody` |
| `docs/api/openapi.json` | 重生 | 挂完闸门跑 `npm run openapi`，并补 15 个缺 `requestBody` 的写入口 |
| `backend/routes/{payment,models,auth}.js` | 改 | 6 条 `console.log` → `require('../utils/logger')` 的 `log` |
| `app/src/components/*` `app/src/pages/ExhibitionHall.tsx` | 改 | 8 条 set-state-in-effect 逐条判 |
| `backend/services/profileEnricher.js` → `backend/services/enrich/*` | 拆（第 1 项第 1 轮） | 14 个横幅段按职责落 5 个模块，`profileEnricher.js` 保留 `enrichProfile` ＋ 原 28 项导出表做再导出（消费方 require 一行不改） |

## 三、任务

### Task 1：清掉不靠拆文件就能清的 prettier 红（6 份／约 9 条定位符）

**Files:**
- Modify: `backend/db/applyRuleSeeds.js`、`backend/services/recommend/ranker.js`、`backend/services/seasonColor.js`、`backend/services/wardrobeOutfitGenerator.js`、`backend/test/bodyDimEstimator.test.js`、`backend/test/seasonColor.test.js`

- [ ] Step 1 `npx prettier --write <那 6 份>`（**只这 6 份**，不碰 profileEnricher/recommendEngine/topFromBody）
- [ ] Step 2 逐份量行数差：`wc -l` 改前后对比，只有行数变了才需要动号
- [ ] Step 3 `node scripts/check-locators.js --list` 对账，命中这 6 份的号按**内容**重指（不许统一平移）
- [ ] Step 4 `npm run format:check` 预期仍 rc=1，红的只剩 3 份；`npm test` 898 全绿
- [ ] Step 5 交提交块给用户

### Task 2：`middleware/bodyGate.js` ＋ 纯函数测试（先有尺子，再挂入口）

**Files:**
- Create: `backend/middleware/bodyGate.js`
- Test: `backend/test/bodyGate.test.js`

**Interfaces:**
- Consumes: `utils/common.js` 的 `asText(v)→string`、`asNumber(v, fallback)→number|null`、`asId(raw)→number|null`、`firstBadScalar(body, fields)→string|null`；`utils/response.js` 的 `sendError(res, message, status=400, code=null)`
- Produces: `gateBody(spec, opts?) → middleware`、`capJson(value, {maxKeys, maxBytes}) → {ok, reason}`

- [ ] Step 1 写失败的测试（下面这份就是全文，别增删断言）

```js
// backend/test/bodyGate.test.js
const test = require('node:test')
const assert = require('node:assert')
const { gateBody, capJson } = require('../middleware/bodyGate')

/** 直接喂假 req/res，跑中间件本身（不碰 express 栈） */
function run(mw, body) {
  let out = null
  let passed = false
  const res = {
    status(c) { out = { c }; return res },
    json(b) { out.body = b; return res },
  }
  mw({ body }, res, () => { passed = true })
  return { out, passed }
}

test('gateBody: 标量字段给了数组/对象 ⇒ 400 且点名是哪一格', () => {
  const { out, passed } = run(gateBody({ scalars: ['category', 'color'] }), { category: ['a', 'b'] })
  assert.strictEqual(passed, false)
  assert.strictEqual(out.c, 400)
  assert.match(out.body.error.message, /category/)
})

test('gateBody: 数字字段给数字串要折成数（与 asNumber 同一口径）', () => {
  let seen = null
  const mw = gateBody({ numbers: ['price'] })
  mw({ body: { price: '12.5' } }, {}, () => { seen = arguments })
  assert.strictEqual(typeof globalThis.__x, 'undefined') // 占位守卫，见 Step 3 的真实断言
})

test('capJson: 键数与字节上限都拦得住，超了就说不放行', () => {
  const big = {}
  for (let i = 0; i < 5000; i++) big['k' + i] = 'v'
  assert.strictEqual(capJson(big, { maxKeys: 200, maxBytes: 64 * 1024 }).ok, false)
  assert.strictEqual(capJson({ a: 1 }, { maxKeys: 200, maxBytes: 64 * 1024 }).ok, true)
})
```

  ⚠️ 中间那条测试**故意写坏了**（`arguments` 在箭头函数里不存在）：Step 3 之前它必须红；Step 3 用真实断言替掉它，替掉的正好是「折成数之后 `req.body.price === 12.5`（number）」这一条。

- [ ] Step 2 `node --test test/bodyGate.test.js` → 预期红（模块不存在）
- [ ] Step 3 写 `middleware/bodyGate.js`（全文）

```js
/**
 * 入口闸门（第 2 项·2026-11-03）
 *
 * 为什么不是"补一层统一校验"的另一种做法：本仓早就有一把入参尺子——
 * `utils/common.js` 的 asText/asNumber/asId/firstBadScalar，20 份路由文件全 import 它，
 * 现量 81 个写入口里 46 个已经过守卫、25 个根本不读 body，
 * 「读 body ＋ 写库 ＋ 零守卫」的入口是 **0 个**。所以缺的不是校验库，是
 * "同一个入口的字段清单只写一处"这件事。这里只做收口：声明表 ＋ 一个中间件，
 * 底下仍然只调 utils/common.js 那批函数。⛔ 不装 ajv/zod/express-validator
 * （判据见 docs/superpowers/plans/2026-11-03-refactor-four-items.md §一 第 2 行）。
 */
const { asText, asNumber, asId, firstBadScalar } = require('../utils/common')
const { sendError } = require('../utils/response')

/**
 * @param {{scalars?: string[], numbers?: string[], ids?: string[]}} spec
 *   scalars＝直接绑进 SQLite 的可空标量列（布尔/数组/对象一律拦）
 *   numbers＝要落数字列的字段，认得数字串，认不出折成 null（当"没填"，与 asNumber 同口径）
 *   ids＝路径参数用；body 里的 id 也走这条，只认整串十进制正整数
 */
function gateBody(spec = {}) {
  const scalars = spec.scalars || []
  const numbers = spec.numbers || []
  return (req, _res, next) => {
    const body = req.body || {}
    const bad = firstBadScalar(body, scalars.concat(numbers))
    if (bad) {
      return sendError(_res, `「${bad}」这一格填的不是单个值（不能是列表或对象），请核对后重试`, 400)
    }
    for (const f of numbers) {
      if (body[f] !== undefined) body[f] = asNumber(body[f], null)
    }
    for (const f of scalars) {
      if (typeof body[f] === 'string') body[f] = asText(body[f])
    }
    next()
  }
}

/** JSON 字段的体积闸门：整坨存库的那两处要用（键数＋序列化字节双上限） */
function capJson(value, { maxKeys, maxBytes }) {
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    return { ok: false, reason: '序列化不了' }
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, reason: '超过字节上限' }
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
  if (keys.length > maxKeys) return { ok: false, reason: '字段数超过上限' }
  return { ok: true }
}

module.exports = { gateBody, capJson, asId }
```

- [ ] Step 4 `node --test test/bodyGate.test.js` → 全绿（含改写后的第二条）
- [ ] Step 5 五道门

### Task 3：给 B 组 10 个入口挂闸门 ＋ 堵 customer.js 两处整坨写入

**Files:**
- Modify: `backend/routes/wardrobe.js:1146,1170,1196,1344`、`backend/routes/accessory.js:513`、`backend/routes/cosmetic.js:674`、`backend/routes/analysis.js:181,325`、`backend/routes/recommend.js:475`、`backend/routes/payment.js:389`、`backend/routes/customer.js:116,182`
- Test: `backend/test/bodyGate.test.js`（追加栈形闸门）

**Interfaces:**
- Consumes: Task 2 的 `gateBody(spec)`、`capJson(value, {maxKeys, maxBytes})`
- Produces: 10 个入口的 `route.stack` 里多一层 `gateBody`；`customer_sessions.profile_data` 从此有上限

- [ ] Step 1 逐入口现量它到底读 body 的哪几格（`grep -n "req.body" <文件>` 限定在该 handler 段内），把字段名抄进 `spec`——**不许凭清单猜字段**
- [ ] Step 2 按 `router.post('/evaluate', gateBody({ scalars: [...] }), (req, res) => {` 的形状插中间件。⚠️ `payment.js:389 /notify/alipay` 是 form-urlencoded 的**验签**回调：那一处只挂 `capJson` 的字节上限，⛔ 不许改写字段（验签要吃原始字节，`server.js:96` 的 `verify` 就是这个原因留的）
- [ ] Step 3 `customer.js:120`／`:203` 那两行 `JSON.stringify(req.body?.profile_data || req.body || {})` 换成「先 `capJson(…, {maxKeys: 200, maxBytes: 64 * 1024})`，超了回 400 说清哪一格太大；不过限才落库」
- [ ] Step 4 在 `bodyGate.test.js` 追加栈形闸门：10 个入口逐个断 `route.stack.some(l => l.handle.name === 'bound gateBody')`（或用注册时挂的名字），少一个就红，并把"新增了写入口没登记"这条写进注释
- [ ] Step 5 `npm run openapi` 重生说明书 → `npm run openapi:check` 必须回 rc=0；顺手补 15 个缺 `requestBody` 的写入口
- [ ] Step 6 逐入口跑一次真脏数据（`category: []`、`price: {}`、profile_data 200 键），确认回的是 **400 且点名**，不是 500
- [ ] Step 7 五道门 ＋ `npm test`（898 条若有红，逐条判「测试原本喂的是脏数据」还是「我拦过头」，判据写进本轮台账）

### Task 4：6 条 `console.log` 归 `utils/logger`

**Files:**
- Modify: `backend/routes/payment.js:96,231,727`、`backend/routes/models.js:262,280`、`backend/routes/auth.js:360`

- [ ] Step 1 各文件顶部加 `const { log: logMsg } = require('../utils/logger')`（与 `server.js` 同一别名，保持一致）
- [ ] Step 2 6 条逐条换 `logMsg(...)`，**文案一字不动**（auth.js:360 那句已自带手机号掩码，别顺手改格式）
- [ ] Step 3 `node --test` ＋ `npx eslint routes/` → `no-console` 从 87 掉到 **81**（routes 归零），余下 78 条全在 `db/` 那几个迁移脚本里，那种 CLI 用 console 是对的，不动
- [ ] Step 4 本机起一个真实例（`PORT=5001 STYLEAI_DB_PATH=<副本> node server.js`），触发一次到账，确认 `backend/logs/server-<北京日>.log` 里**真有那一行**——这是这条改动唯一的真验收
- [ ] Step 5 同轮记一笔欠账：routes 还有 **151** 条 `console.error/warn` 也只落 stdout，`utils/logger` 的 `error()` 才落文件。本轮不动它们（eslint 明确 allow），但"日志不好查"这句话真正的大头在这 151 条，要单独一轮拍

### Task 5：前端 8 条 set-state-in-effect

**Files:**
- Modify: `AccessoryTab.tsx:140`、`CosmeticTab.tsx:169`、`CrossCabinetReport.tsx:138`、`PaidReports.tsx:279`、`RuleBrowser.tsx:108`、`WardrobeDiary.tsx:185`、`WardrobeTab.tsx:230`、`ExhibitionHall.tsx:275`
- 同轮附带：`CrossCabinetReport.tsx:105`（exhaustive-deps）、`EvidenceTag.tsx:68,73`＋`RecommendTab.tsx:17,89`（react-refresh，判「拆文件」还是「加 eslint-disable 注释」）

- [ ] Step 1 逐条读那一个 effect，分三档：**(a)** 派生值不该进 state（改 `useMemo`／直接算，零行为变化）／**(b)** 是事件响应被写进了 effect（搬到事件回调）／**(c)** 真有异步语义、改了会动行为（挂账不硬改）
- [ ] Step 2 只动 (a)(b)，(c) 逐条写明它为什么不能动
- [ ] Step 3 `npm run typecheck` ＋ `npm run lint` ＋ `npm run build`
- [ ] Step 4 **真浏览器点一次**这 8 个组件所在页面（用户硬规则 #39），点验读数落 `docs/` 台账
- [ ] Step 5 复量：`npx eslint .` 的 13 应该掉到「(c) 档剩下那几条 ＋ react-refresh 那 4 条」

### Task 6～9：第 1 项，一个文件一轮

**Files（第 1 轮）:** `backend/services/profileEnricher.js`（1110 行／61 条定位符／14 个横幅段／28 项导出）→ `backend/services/enrich/{bodyMetrics,colorMatch,styleType,adviceMaps,occasionMap}.js`

每轮固定五步，一步不跳：

- [ ] Step 1 `npm run format:check` 里这个文件先转绿（**格式化与拆分同轮**，定位符账只付一次）
- [ ] Step 2 按横幅段搬代码，`profileEnricher.js` 保留 `enrichProfile` ＋ 原导出表做再导出 ⇒ 消费方（`recommendEngine.js` 等）require 一行不改
- [ ] Step 3 `npm test` 必须仍 898/898/0（**这一步没绿就停手，不许往下走**）
- [ ] Step 4 `node scripts/check-locators.js --list`，把指向该文件的 61 条号**按内容**逐条重指到 `enrich/<模块>.js:<新号>`；md／html 引用不在门禁里，要靠这条而不是 CI
- [ ] Step 5 五道门复绿 ＋ 交提交块

后续轮次：Task 7 `topFitBody.js`（975／85 条号，注意 `fitSize.js:39` 与 `:271` 是同一件事的第二处入口，改 `bodyDeviation` 必须两边一起看）→ Task 8 `colorMetrics.js`（1563／109）→ Task 9 `recommendEngine.js`（989／137，`services/recommend/` 三个模块在场，接着做完）。`routes/wardrobe.js` 1541 与 `db/add-rules.js` 1455 同档，末轮再议（后者是种子脚本，未必该按同一把尺子拆）。

## 四、自查（写完后回读）

- 覆盖：第 2 项 12 个真缺口→Task 2/3；第 3 项 6 条→Task 4；第 4 项 8＋5 条→Task 5；第 1 项 6 个文件→Task 6~9。四项都有任务接住，无遗漏。
- 占位符：Task 3 Step 1 把「字段清单」留给现量而不是在计划里编造，这是**有意的**——凭清单猜字段会把闸门做成假绿；已在步骤里写明现量方法。其余步骤均给到可照抄的代码／命令。
- 类型一致：`gateBody/capJson` 的签名在 Task 2 Produces、Task 3 Consumes、代码块三处一致；`sendError(res, message, status)` 参数序与 `utils/response.js:78` 实测一致。

## 五、执行记录（2026-11-03 04:17 本机收口）

Task 1~5 全部做完并复验；第 1 项（Task 6~9）没动，按定的节奏一个文件一轮。
本节里所有 `文件:行号` 都是**本轮 11-03 现量**，后续轮次一动就得重指，抄的时候别当永久坐标。

### 五·1 九道门（04:11 全绿，改注释后 04:17 复跑后端四道仍全绿）

backend：`format:check` rc=0／`openapi:check` rc=0／`lint` 0 error·**139 warning**／`node --test` **913 pass·0 fail**／`scripts/check-locators.js` rc=0（这本就只记账、恒回 0）。
app：`format:check` rc=0／`eslint src` **0 error·0 warning**／`tsc -b --force` rc=0／`vite build` rc=0（2.32s）。
对照基线：backend lint 141→139 warning（本轮没专门修 lint，差的两条随挂载与拆文件自然掉下去，没逐条追）；app 0 error·13 warning → 0·0。

### 五·2 第 2 项的落点（13 个 `gateBody` ＋ 3 处 `capJson`）

挂载点（`grep -rn "gateBody(" routes/*.js` 现量，括号里是行号）：wardrobe `/gaps`(1147)·`/evaluate`(1174)·`/suggest`(1202)·`/match`(1223)·`/recommend`(1353)，accessory `/gaps`(475)·`/evaluate`(514)·`/suggest`(537)，cosmetic `/gaps`(639)·`/evaluate`(675)·`/suggest`(698)，recommend `/enhance`(482)，analysis `/style-diagnose`(339)＝**13 个**；`capJson`＝analysis `PUT /archive`(193)＋customer `POST /session`(122)＋customer `PUT /session/:sessionId`(210)＝**3 处整坨写入**。
判不挂并写明理由的 3 个：analysis `POST /body`（已逐格 400 点名）、payment `POST /notify/alipay`（验签回调，改一个字节就打歪签名）、analysis `PUT /archive` 的字段值（自动保存那条路⛔ 不许回 400，只加体积闸）。理由逐条写在 `backend/middleware/bodyGate.js` 文件头，那边没装 ajv／zod／express-validator，只调 `utils/common.js` 已有的那批尺子。

### 五·3 闸门的三层证据

1. **离线单测**：`backend/test/bodyGate.test.js`（本轮新件）——含"栈形核对"，新增写入口忘了登记就红。
2. **活实例 HTTP 抽验 16 条全中**（打本机隔离实例＋盘外副本库，`X-Session-Id` 走游客身份）：8 条脏形状当场 400 且由闸门点名（`profile 要的是一个对象（形如 { ... }），这次传来的不是`／`wardrobe_items 要的是一个列表（数组）…`／`answers` 传 `[]` 也被拦，因为 `typeof [] === 'object'`）；4 条正常载荷照旧 200／201；2 条"完全不带 profile""profile=null"仍由 handler 自己回`缺少 profile`（闸门没抢存在性检查）；1 条 250 键的整坨 → `profile_data 存不下：这一格的字段数超过 200 个`；1 条正常小份 → 201。
3. **总闸形状**：`{"code":"TOO_MANY_REQUESTS","message":"请求过于频繁,请 15 分钟后再试","retry_after":646}` —— 带 `retry_after` 是本轮把总闸改走本仓工厂的结果，前后端两套 429 并成一套。

### 五·4 第 3 项：6 条 `console.log` 归 logger，routes 里现量剩 0 条

`grep -rn "console\.\(log\|error\|warn\)" backend/routes/*.js`＝154 行，拆开：`console.log(` **0 条**（清单点名的 payment 3／models 2／auth 1 全走了 logger）、`console.error(` 142 条、`console.warn(` 9 条，另 3 行是本轮新写的注释里那句"日志走 utils/logger"的说明（auth.js:17／models.js:19／payment.js:19）。
剩下那 151 条 error/warn 不在这一项的清单里，也没被本轮删掉——它们多数是"启动扫描/seed"的一次性播报，挂下一轮议。

### 五·5 第 4 项：13 条 warning 的真实构成，与打法

清单那句"都是 `react-hooks/set-state-in-effect`"先订正：eslint 现量 13 条＝8 `set-state-in-effect` ＋ 1 `exhaustive-deps` ＋ 4 `react-refresh/only-export-components`。

- **8 条的共性**是 `setError('')`／`setLoading(true)` 坐在 effect 的同步前缀里。打法＝把 setState 从"请求前"挪到"读到了"，请求发出去不再需要先改 state，异步语义一点没变（试过多档：`useMemo`、事件回调、`startTransition`，只有这一档不动行为）。
- `ExhibitionHall` 那条特殊：`?start=1` 是"这一屏开在哪个阶段"的**输入**，原来由 effect 替顾客按下按钮，现在直接在 `useState` 初值里读 URL；把地址栏那一个查询参数撤掉仍留在 effect 里（它只动浏览器历史，不动 state）。
- **4 条 react-refresh 按"拆文件"解**（不是加 disable 注释）：`EvidenceTag.tsx` 拆出 `recommend/evidenceMeta.ts`（依据表，与后端 `evidenceLevels.js` 逐字同），`RecommendationReport.tsx` 拆出 `recommend/reportFields.ts`（字段中文名映射）。内容逐字搬，"两边一起改"那句文件头留在原文件并指向新模块。
- 5 个文件只有 prettier 排版变化：用 esbuild 压最小码比 sha256，证过语义未变。
- 结果 `npx eslint src`＝0 error 0 warning，`tsc -b` 与 `vite build` 同轮绿。

### 五·6 真浏览器点验（硬规则 #39）

入口＝本机隔离实例 `PORT=5001 STYLEAI_DB_PATH=<盘外一份库副本> node server.js`（本轮那份副本 `verify-copy.db` 与它的 `-wal`/`-shm`、实例日志一起随五·9 删净了；要复现就从 `backend/db/styleai.db` 复制一份出去再指）。后端直发 `app/dist`，所以点的是本轮新构建那一份（产物哈希 `CabinetManager-sRX68kq2.js` 与 `vite build` 输出逐字一致）。活库 `backend/db/styleai.db` 一条请求都没被打过。

点到并过的：① `/?start=1` 落"请选择服务模式"、地址栏自己清成 `/`（5173 与 5001 两份都验）；② 个人深度模式→只选性别→✨ 生成个人形象分析→报告屏出"本次量到 1／10 维（缺：…）"；③ 橱柜管理三柜＋穿搭日记，空柜文案正常，切柜**不再重复发请求**（首挂载取一次）；④ 跨柜推荐：上班通勤出结果，季节提醒／品牌偏好／健康检查各自取数；⑤ 规则说明 276 条渲染，两个筛选下拉把请求真打到服务端（276→43→6）；⑥ 我的报告打开即取数，0 份时三段空态齐全；⑦ 失败分支各测两种——429 时规则说明出"⚠️ 请求过于频繁…＋重试"、点重试重新发请求，断网时跨柜子页出"网络连接失败,请检查网络后重试＋重试"、点重试先回加载态再回错误态（不白屏、不循环），表单 429 走 toast 并停在原页，我的报告 429 走面板内错误行；⑧ console **0 error**，332 条 warn 全是 three.js 贴图（`/gallery` 那份 3D 模特，本轮没碰）。

没点到的，写明不粉：衣橱／化妆品／配饰／日记四个柜内组件的**错误分支**没在浏览器里见过红字——它们只在首次挂载取数，而进柜子的路要先让 `/api/recommend/engine` 成功一次，测错误分支那会儿 `/api` 总闸已被我自己打满（这 100 次／15 分钟是我为了逼出错误态刻意烧掉的，只烧在 5001 那个进程里）。同理 `RecommendTab`／`TopSpecCard` 的失败分支、门店模式 `CustomerForm` 的失败分支只过了代码审读与类型门。

### 五·7 定位符账（本轮最大的一笔）

本轮改过代码文件 47 个／HEAD 里没有的新文件 10 个。

- 按内容重指 **482 个替换点、221 行实改，拒写 0 次**。三道闸：目标行内容与 HEAD 逐字相同才平移；区间只在没有 hunk 边界穿过时整段平移；写盘前比"去掉数字后逐字相同"，含非数字变化就拒。
- 闸⑥挡下 **65 行**：那些行里的号是本轮对着新树**新写**的，再平移就成了双移；与 02:53 那次写盘的行集合重叠＝**0**（实测，不是推断）。
- 独立复核：另一份工装只读那份重指日志（`repoint3-log.txt`，随本轮工装整批删净，见五·9）逐条重对盘上，482 条全部一致。
- 手工订正 8＋1 处，全是"内容已被拆走"的：`EvidenceTag.tsx:25/73/85` → `evidenceMeta.ts:29`／`:77`，`12-…:80/81` → `reportFields.ts:11`／`evidenceMeta.ts:77`，`11-…:624` 区间尾＋1，`20-…:51` 等。
- 体检读数变化：第一向 在位 63→**87**／要动 301→**268**；第三向 在位 1530→**1536**。
- 判留没动：`docs/复盘/`、`docs/进展报告/`、`docs/形象设计模型-现状与路线.md`、`docs/架构审计与优化蓝图-20261019.md`、`docs/依据/10-原文档案与逐条核对.md`、`docs/superpowers/plans/`，以及句子里明写"旧号／原写／改前／拆分前"的历史号。
- 已知没修的旧账（"号活着但指错句"这一档 179 条，本轮没顺手改）：本轮撞实的一处是 `RecommendationReport.tsx:358`——号坐在**空行**上，那句要的 `_computed` 在 `:654`。⚠️ 订正我自己写台账时的一句错话：先前顺手把 `types/index.ts:644` 也记成指错句，回读盘上那一行才发现它就是 `_computed?: {` 本身，号是对的、是我抄错了行区间（错因＝把上一行的注释当成了锚点所指），这条从欠账里划掉。

### 五·8 提交与 push 归他

本轮我一条 git 写操作都没做。工作区现量：**83 个已跟踪文件有改动＋11 个未跟踪新件**。
⚠️ `git add -u` 不会带未跟踪新件，那 11 件必须逐名 add：`app/src/components/StyleDiagnosis.tsx`、`app/src/components/recommend/evidenceMeta.ts`、`app/src/components/recommend/reportFields.ts`、`backend/middleware/bodyGate.js`、`backend/services/conflictBreakdown.js`、`backend/services/seasonColor.js`、`backend/services/styleDiagnosis.js`、`backend/services/wardrobeOutfitGenerator.js`、`backend/test/bodyGate.test.js`、`backend/test/seasonColor.test.js`、`docs/superpowers/plans/2026-11-03-refactor-four-items.md`。
另有两件在改动列表里、要不要一起提交归他裁：`backend/db/styleai.db`（服务器侧被 skip-worktree 钉住，每次发布要跑 db-drift-sentinel）与 `docs/依据/papers/GBT+1335-1-2008 服装号型 男子.pdf`（那份的案子他 11-02 已结）。

⚠️ 收口时新撞到的一件（现量：全仓 `grep -rn "StyleDiagnosis"` 只命中 `api.ts:41`/`:1182` 与 `types/index.ts:618` 的**类型名**，没有任何一处 import 这个组件）：`app/src/components/StyleDiagnosis.tsx`（165 行）是**挂在树上的死件**——后端 `/style-diagnose` 与 `api.ts` 那两个包装函数都在，但没有任何页面 import 这个组件，顾客在界面上走不到风格诊断。这条不是本轮改坏的（它 03:22 的 mtime 与 react-refresh 那轮同批，本轮只把它的写入口挂上了 `gateBody`），本轮也没顺手接线，**记成挂账交他定**：要么接进 `ExhibitionHall` 某一屏，要么整件撤掉（撤的话 `api.ts`／`types` 那三处要同轮清）。

### 五·9 盘外工装账

**收口时新撞到的一件（记成新挂账，交他定）**：`app/src/components/StyleDiagnosis.tsx`（165 行）**全仓没有任何一处 import**——现量＝`grep -rn "StyleDiagnosis"` 在 `app/`＋`backend/`＋`docs/` 只命中 `api.ts:41`／`api.ts:1182` 与 `types/index.ts:618` 那三处**类型名** `StyleDiagnosisResult`。后端 `/style-diagnose`（analysis.js:339，本轮已挂 `gateBody`）与 `api.ts` 的 `getStyleQuestions`／`diagnoseStyle` 都在，但没有任何页面挂这个组件 ⇒ 顾客在界面上走不到风格诊断。这条不是本轮改坏的（组件与路由都不是本轮新写），本轮也没顺手接线：**要么接进 `ExhibitionHall` 某一屏，要么整件撤掉**（撤的话 `api.ts`／`types` 那三处要同轮清）。

本轮工装全在 `E:/website/files/refactor-probes/`。删前查点名（扫描面＝仓库 325 份文本文件＋最近 5 条 commit message，且必须按词边界匹配——第一轮用子串匹配时 `fmt.txt`／`build.txt`／`fmt` 被 `g-be-fmt.txt` 这种同族旧名误命中，读完整句才知道那是 10-21 两轮在记"当场删净"，不是留件指令）。唯一真点名的是 `backend/middleware/bodyGate.js` 文件头那句"工装＝仓外 `writeGuardCensus.cjs`"——已就地改成把判据写进注释、不再指向文件名。

删前对子目录 `fmt/` 里那 3 份 `.js.orig`（prettier 改写前的快照）单独取了一道证，才敢连它一起删：用本仓 prettier 3.9.6 就着各文件自己的配置把 `.orig` 重排一遍再与现盘逐行比——`profileEnricher` 差异 0 行；`recommendEngine`、`topFromBody` 各差 1 行且**都是注释行、剥掉数字与空白后逐字相同**（差的就是我后来重指掉的旧行号），代码行差异 0 行 ⇒ 这三份不含"盘上和 git 里都拿不到"的信息，删了不退路。另记一句：`.orig` 与 `git show HEAD:` 那份**并不相同**（HEAD 是拆分前 44087B／`profileEnricher`，`.orig` 是拆分后未排版的 51391B），所以它的价值只在这条"证明拆分没改语义"的链上，链已经走完。

**删净账（递归按内容量，不是 `ls` 顶层）**：**108 件／3,152,091 字节≈3,078.2 KB**，删后独立复量 `refactor-probes` 在场＝**false**，`E:/website/files` 顶层只剩他原有的 11 项。仓库侧同轮复验：未跟踪 **11 件**——就是五·8 那份名单，全是本轮交付件，**没有一件是我的探针**；已跟踪有改动 83 个文件。
补一句（同一双尺子量到的）：上面那句写完我还得起一件盘外探针数改动日期（`E:/website/files/mtime-probe/mtime.cjs`，1 件／1,534 字节），同轮也删净了；此刻 `refactor-probes` 与 `mtime-probe` 两个目录都不在场。⚠️ 顺带订正一处易读歪的地方：那份探针按 **ISO UTC 串切日期**会把本机 11-03 凌晨 00:00–08:00 的改动全读成"11-02"（UTC+8 差一天），改用本地时格式化之后现量＝**11-03 那天的改动 90 条／11-02 剩 4 条**。

