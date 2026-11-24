/**
 * 衣橱「拍照只存图」链路测试（2026-10-20 第五阶段·第一步）
 *
 * 背景：10-20 核对数据采集时现量到的缺口——前端点「📷 拍照上传」后，后端把图落到
 * `clothing_items` 并回一个 `/uploads/xxx.jpg` 地址，但 `WardrobeTab` 的表单打包里
 * **从来没有 image_url 这一项** ⇒ 地址被丢掉、`user_wardrobe.image_url` 恒 NULL、
 * 而 toast 却写着"照片已保存"。本轮按他拍的口径（拍照＝只存图，不做识别）把这一格接通。
 *
 * 钉四件事：
 *  ① 库里这一格本来就存在（本轮**没有**为它补列，别误加一条 MISSING_COLUMNS）。
 *  ② 两条写口的文本口径：非文本（{} / []）归 NULL，空串归 NULL——
 *     原来 POST 是 `data.image_url || null`，一个 `{}` 会一路绑进 SQLite 抛 RangeError ⇒ 整条 500。
 *  ③ PUT 的 allowed 表带着 image_url：顾客点「不挂这张」发 null 才真清得掉。
 *  ④ 前端那一条链（跨目录源码钉）：表单默认值 / openEdit 回填 / buildPayload 发值 /
 *     handlePhotoUpload 写值 / 渲染前只认同源相对地址。
 *     ⚠️ 这是"源码级"钉子，**行为**证据在真浏览器上点出来的（本轮记录在
 *     docs/依据/10 第四十六轮台账与《第五阶段进展报告》）。
 *
 * 本测试在新建的内存库上执行同一份 schema.sql，全程不打开、不修改 backend/db/styleai.db。
 * 运行: node --test test/wardrobePhotoField.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { asText } = require('../utils/common')

const REPO = path.join(__dirname, '..')
const db = new Database(':memory:')
db.exec(fs.readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf-8'))

const routeSrc = fs.readFileSync(path.join(REPO, 'routes', 'wardrobe.js'), 'utf-8')
const initSrc = fs.readFileSync(path.join(REPO, 'db', 'init.js'), 'utf-8')
const imageSrcPath = path.join(REPO, '..', 'app', 'src', 'components', 'wardrobe', 'imageSrc.tsx')
const tabSrc = fs.readFileSync(
  path.join(REPO, '..', 'app', 'src', 'components', 'WardrobeTab.tsx'),
  'utf-8',
)
// 11-03 大文件拆分轮：sameOriginImage 这一段从 WardrobeTab.tsx 逐字搬进上面那个模块，
// 钉子不放松——定义体与父文件的 import 两头都要在场，缺一头渲染就回到认外站地址的老洞。
const imageSrcSrc = fs.readFileSync(imageSrcPath, 'utf-8')

function addWardrobe(session, name, imageUrl) {
  return db
    .prepare(
      `INSERT INTO user_wardrobe (session_id, name, category, image_url)
       VALUES (?, ?, 'top', ?)`,
    )
    .run(session, name, imageUrl).lastInsertRowid
}

test('① image_url 这一格 schema 里本来就有（本轮不该补列）', () => {
  const cols = db
    .prepare("SELECT name FROM pragma_table_info('user_wardrobe')")
    .all()
    .map((r) => r.name)
  assert.equal(cols.includes('image_url'), true, 'user_wardrobe 应该有 image_url 列')
  assert.equal(
    initSrc.includes("['user_wardrobe', 'image_url'"),
    false,
    '⛔ 老库这列早就有了，别再往 MISSING_COLUMNS 里加一条重复补列',
  )
})

test('② 真值 / NULL / 空串三种写法落库结果', () => {
  const a = addWardrobe('s1', '拍了照的', '/uploads/uuid-1.jpg')
  const b = addWardrobe('s1', '没拍照的', null)
  const c = addWardrobe('s1', '空串的', '')
  assert.equal(
    db.prepare('SELECT image_url FROM user_wardrobe WHERE id = ?').get(a).image_url,
    '/uploads/uuid-1.jpg',
  )
  assert.equal(
    db.prepare('SELECT image_url FROM user_wardrobe WHERE id = ?').get(b).image_url,
    null,
  )
  // 空串只有在前端/路由归过 NULL 之后才会进库；这里证明列本身不拦，所以拦截必须发生在写口
  assert.equal(db.prepare('SELECT image_url FROM user_wardrobe WHERE id = ?').get(c).image_url, '')
})

test('② asText 把非文本与空白收成空串（路由靠它把 {} 归 NULL 而不是 500）', () => {
  assert.equal(asText({}), '')
  assert.equal(asText(['a']), '')
  assert.equal(asText('   '), '')
  assert.equal(asText('/uploads/x.jpg'), '/uploads/x.jpg')
  assert.equal(asText({}) || null, null, 'POST 那一行 asText(data.image_url) || null 的落点')
})

test('③ 源码级：两条写口的 image_url 都走文本口径', () => {
  assert.equal(
    routeSrc.includes('asText(data.image_url) || null'),
    true,
    'POST：原来 `data.image_url || null` 会把 {} 原样绑进 SQLite ⇒ RangeError ⇒ 500',
  )
  assert.equal(/image_url: 'image_url',/.test(routeSrc), true, 'PUT 的 allowed 表要带这一格')
  assert.equal(
    routeSrc.includes("} else if (key === 'image_url') {"),
    true,
    "PUT：要有自己的分支，否则 '' 会原样进库、清不掉",
  )
  assert.match(
    routeSrc,
    /price, image_url, sku\)/,
    'POST 列清单带着 image_url（源码里 condition 那一列带反引号转义，正则不碰它）',
  )
})

test('④ 源码级：前端那条链五处都在（缺一个地址就丢）', () => {
  assert.equal(
    tabSrc.includes('image_url: form.image_url.trim() || null'),
    true,
    'buildPayload 要发这一格——10-20 现量的洞就是它没发',
  )
  assert.equal(tabSrc.includes('image_url: item.image_url ??'), true, 'openEdit 要回填')
  assert.equal(
    tabSrc.includes('image_url: result.image_url'),
    true,
    'handlePhotoUpload 要把后端返回的地址接进表单',
  )
  assert.equal(
    tabSrc.includes('const sameOriginImage'),
    false,
    '11-03 拆分后这段不该在父文件里留一份重复定义',
  )
  assert.equal(
    imageSrcSrc.includes('const sameOriginImage'),
    true,
    '渲染前只认同源相对地址（定义在 wardrobe/imageSrc.tsx）',
  )
  assert.equal(
    /import\s*\{[^}]*\bsameOriginImage\b[^}]*\}\s*from\s*'\.\/wardrobe\/imageSrc'/.test(tabSrc),
    true,
    '父文件要 import 这份同源校验，否则渲染那一格又没人把关',
  )
  assert.equal(
    /image_url: p\.image_url \?\? ''/.test(tabSrc),
    true,
    '扫码命中库存时把后台那张商品图一起带出来（只带地址，不重传）',
  )
})

test('④ 源码级： toast 不许再说"识别"做了没做的事', () => {
  // 这条钉的是文案与能力对齐：后端 semantics 是写死的占位（routes/clothing.js:68-75），
  // 文案再写"AI 识别"就是虚假宣称（C 档手拍口径对外不得称科学/量化同一族规矩）。
  assert.equal(/照片已存到这一件（识别暂未接入）/.test(tabSrc), true)
  assert.equal(/识别结果不完整/.test(tabSrc), false, '识别没做就不该有这句报错')
})
