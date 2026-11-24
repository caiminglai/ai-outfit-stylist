// 已禁用模型的下载闸门：形状匹配（脱离数据库的那一半）
// 背景：展厅按 enabled=1 过滤，文件口不看 enabled ⇒ 后台"下架"的模型 URL 照旧匿名可下；
//       而删库行也挡不住，启动扫描按 (folder,file) 判重，文件还在盘上下一次重启就复活。
const { test } = require('node:test')
const assert = require('node:assert')
const {
  pmxRowKey,
  isDisabledPmxPath,
  setDisabledPmxRefresher,
  resetDisabledPmxCache,
} = require('../utils/model-utils')

const DISABLED = new Set([
  pmxRowKey('神里绫华+原神', '神里绫华.pmx'),
  pmxRowKey('苍鹭·托特+深空之眼[扉页之吻]', '苍鹭·托特_黑衣.pmx'),
  pmxRowKey('今汐+鸣潮/toon', 'toon_phys.pmx'),
])

test('命中的 .pmx 判为禁用，顶层与子层目录都一样', () => {
  assert.equal(isDisabledPmxPath('神里绫华+原神/神里绫华.pmx', DISABLED), true)
  assert.equal(isDisabledPmxPath('苍鹭·托特+深空之眼[扉页之吻]/苍鹭·托特_黑衣.pmx', DISABLED), true)
  assert.equal(isDisabledPmxPath('今汐+鸣潮/toon/toon_phys.pmx', DISABLED), true)
})

test('.pmx 的预压缩兄弟 .pmx.gz 同样拦：它是同一份内容的另一种传输形态', () => {
  assert.equal(isDisabledPmxPath('神里绫华+原神/神里绫华.pmx.gz', DISABLED), true)
})

test('反斜杠、大小写、结尾斜杠都归一：Linux 分大小写而 PMX 里写法常差一个字母', () => {
  assert.equal(isDisabledPmxPath('神里绫华+原神\\神里绫华.PMX', DISABLED), true)
  assert.equal(isDisabledPmxPath('神里绫华+原神/神里绫华.PMX.GZ', DISABLED), true)
})

test('纹理、物理、贴图这些库里没有行的文件必须放行，误伤就是整张脸 404', () => {
  assert.equal(isDisabledPmxPath('神里绫华+原神/裙子.png', DISABLED), false)
  assert.equal(isDisabledPmxPath('神里绫华+原神/裙子.png.gz', DISABLED), false)
  assert.equal(isDisabledPmxPath('今汐+鸣潮/toon/toon.vpd', DISABLED), false)
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.sph', DISABLED), false)
})

test('带首斜杠的形状同样拦得住：server.js 静态口传的是 req.path，天然带 "/"', () => {
  assert.equal(isDisabledPmxPath('/神里绫华+原神/神里绫华.pmx', DISABLED), true)
  assert.equal(isDisabledPmxPath('/神里绫华+原神/神里绫华.pmx.gz', DISABLED), true)
  assert.equal(isDisabledPmxPath('/今汐+鸣潮/今汐.pmx', DISABLED), false)
})

test('未禁用的模型与只差一个文件名的邻近变体都不受影响', () => {
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx', DISABLED), false)
  assert.equal(isDisabledPmxPath('神里绫华+原神[精细版]/神里绫华.pmx', DISABLED), false)
  assert.equal(
    isDisabledPmxPath('苍鹭·托特+深空之眼[扉页之吻]/苍鹭·托特_白衣.pmx', DISABLED),
    false,
  )
})

test('空集合、空路径、非字符串都不炸', () => {
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx', new Set()), false)
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx', null), false)
  assert.equal(isDisabledPmxPath('', DISABLED), false)
  assert.equal(isDisabledPmxPath(undefined, DISABLED), false)
  assert.equal(isDisabledPmxPath(123, DISABLED), false)
})

test('pmxRowKey：分隔符与尾斜杠归一，null 字段退化成 "||" 前缀', () => {
  assert.equal(pmxRowKey('a/b/', 'x.pmx'), pmxRowKey('a\\b', 'x.pmx'))
  assert.equal(pmxRowKey(null, null), '||')
  assert.notEqual(pmxRowKey('a', 'b.pmx'), pmxRowKey('a', 'c.pmx'))
})

// ── 进程内缓存：两条匿名下载口（/api/models/file/* 与 server.js 的 /models 静态）共用它 ──

test('省略第二个参数时走进程内缓存，注入的取行数函数被调到', () => {
  let calls = 0
  setDisabledPmxRefresher(() => {
    calls++
    return [{ folder: '优菈+原神', file: '优菈.pmx' }]
  })
  assert.equal(isDisabledPmxPath('优菈+原神/优菈.pmx'), true)
  assert.equal(isDisabledPmxPath('优菈+原神/优菈.pmx'), true)
  assert.equal(calls, 1, '60 秒内应只查库一次')
  setDisabledPmxRefresher(null)
  resetDisabledPmxCache()
})

test('后台改了 enabled 后 reset 当场生效，不用等 TTL', () => {
  const rows = [{ folder: '今汐+鸣潮', file: '今汐.pmx' }]
  setDisabledPmxRefresher(() => rows.slice())
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx'), true)
  // 底层数据变了但不丢缓存：60 秒内仍按旧集判，这正是缓存的本职
  rows.length = 0
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx'), true, '不 reset 时旧集还在')
  resetDisabledPmxCache()
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx'), false, 'reset 之后当场放行')
  setDisabledPmxRefresher(null)
  resetDisabledPmxCache()
})

test('取行数函数抛错时放行：读库失败不能把在售模型的主体和贴图一起拦死', () => {
  setDisabledPmxRefresher(() => {
    throw new Error('SQLITE_BUSY')
  })
  assert.equal(isDisabledPmxPath('今汐+鸣潮/今汐.pmx'), false)
  setDisabledPmxRefresher(null)
  resetDisabledPmxCache()
})
