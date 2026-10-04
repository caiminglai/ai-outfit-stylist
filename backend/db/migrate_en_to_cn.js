/**
 * 去掉规则文案里出现的英文：学术引用括注直接删，可译外来词换中文，品牌与色号保留。
 * 用法：node migrate_en_to_cn.js            只预览
 *       node migrate_en_to_cn.js --apply    写库
 *       node migrate_en_to_cn.js --apply --files   同时改 seed/rules*.json 与 add-rules.js
 */
const fs = require('fs')
const path = require('path')
const { DB_PATH } = require('./paths')

const APPLY = process.argv.includes('--apply')
const FILES = process.argv.includes('--files')

/** 整段删除：纯英文的出处括注（前面的中文已经写明依据） */
const DROP_BASE = [
  'Carole Jackson 1987', 'Facial Proportion Theory', 'Proportion Theory', 'Menswear Color Theory',
  'Adult Development Theory', 'Environmental Psychology', 'Contact Dermatitis Journal',
  'Textile Research Journal', 'Journal of Cosmetic Dermatology', 'American Academy of Dermatology',
  'International Journal of Cosmetic Science', 'Fashion Design Theory', 'Menswear Design Theory',
  'Wardrobe Economics', 'Luxury Fashion Theory', 'Minimalist Menswear', 'Youth Fashion Psychology',
  'Youth Consumer Behavior', 'Dress Code Etiquette', 'Black Tie Dress Code',
  'Color Theory, Johannes Itten', 'Color Theory', 'Workplace Psychology, Heilman 2018',
  'Workplace Psychology', 'Impression Management Theory, Goffman 1959', 'Impression Management',
  'Smart Casual', 'dress code', 'Dress Code',
]
const DROP = DROP_BASE.flatMap(t => [`（${t}）`, `(${t})`])

/** 逐条替换：长词在前，避免被短词截断 */
const MAP = [
  ['（亚洲BMI标准 WHO WPR 2000）', '（亚洲体型标准）'],
  ['（ACSM 运动服装指南）', '（运动服装指南）'],
  ['（ASCI 低温着装研究）', '（低温着装研究）'],
  ['（base+mid+shell）', '（内层+中层+外层）'],
  ['（lob头）', '（中短发）'],
  ['empire线', '高腰线'],
  ['crop top', '短款上衣'],
  ['Legging', '打底裤'],
  ['legging', '打底裤'],
  ['choker', '颈链'],
  ['BlingBling', '闪钻'],
  ['undercut', '底层削薄'],
  ['wavy', '微卷'],
  ['matte', '哑光'],
  ['Trench', '风衣'],
  ['Statement 大件', '大件'],
  ['Statement', '夸张造型'],
  ['大面积logo', '大面积标识'],
  ['logo', '标识'],
  ['无paraben', '无羟苯酯类防腐剂'],
  ['paraben', '羟苯酯类防腐剂'],
  ['core区域', '核心区域'],
  ['光泽感up', '光泽感提升'],
  [' cropped ', ' 短款 '],
  ['cropped', '短款'],
  ['lob头', '中短发'],
  ['lob', '中短发'],
  ['bob', '波波头'],
  ['empire', '高腰'],
]

/** 替换之后残留的空格收尾（只列实测到的形态；"风衣 / 薄外套"这类原有分隔符不能动） */
const POST = [
  ['不对称 波波头', '不对称波波头'],
  ['长度 波波头', '长度波波头'],
  ['齐肩 微卷', '齐肩微卷'],
  ['厚 哑光', '厚哑光'],
  ['、 短款 针织', '、短款针织'],
  ['厚底 宽松廓形', '厚底宽松廓形'],
  ['、 宽松托特', '、宽松托特'],
  ['宽松廓形 T恤', '宽松T恤'],
]

const counts = new Map()
function bump(k, n) { if (n) counts.set(k, (counts.get(k) || 0) + n) }

function fix(src) {
  let t = src
  for (const d of DROP) {
    const n = t.split(d).length - 1
    if (n) { t = t.split(d).join(''); bump('删:' + d, n) }
  }
  for (const [a, b] of MAP) {
    const n = t.split(a).length - 1
    if (n) { t = t.split(a).join(b); bump('换:' + a, n) }
  }
  const os = t.match(/([Oo]versiz(?:ed|e)?)(?![A-Za-z])/g)
  if (os) {
    bump('换:oversize族', os.length)
    t = t.replace(/([Oo]versiz(?:ed|e)?)(?![A-Za-z])/g, (m, p, off, str) => {
      let i = off + m.length
      while (str[i] === ' ') i++
      return /[一-鿿]/.test(str[i] || '') ? '宽松' : '宽松廓形'
    })
    t = t.replace(/宽松 ([一-鿿])/g, '宽松$1')
  }
  for (const [a, b] of POST) {
    const n = t.split(a).length - 1
    if (n) { t = t.split(a).join(b); bump('收尾:' + a, n) }
  }
  return t
}

// ---- 1) 数据表
const Database = require('better-sqlite3')
const db = new Database(DB_PATH)
const TARGETS = [
  ['rule_actions', 'content'],
  ['rule_groups', 'name'],
  ['rule_groups', 'description'],
  ['recommendation_logs', 'result'],
]
console.log(`库：${DB_PATH}  模式：${APPLY ? '写入' : '预览'}`)
let rowsChanged = 0
for (const [table, col] of TARGETS) {
  let changed = 0
  const rows = db.prepare(`select rowid as rid, "${col}" as v from "${table}" where "${col}" is not null and "${col}" <> ''`).all()
  const upd = APPLY && db.prepare(`update "${table}" set "${col}" = ? where rowid = ?`)
  for (const r of rows) {
    const v = fix(r.v)
    if (v === r.v) continue
    changed++
    if (APPLY) upd.run(v, r.rid)
  }
  console.log(`  ${table}.${col}: ${changed} / ${rows.length} 行`)
  rowsChanged += changed
}

// ---- 2) 早期端到端测试留下的英文数据行（按值匹配，不认 id，两端 id 不同）
const RENAMES = [
  ['user_cosmetics', 'e2e2-lip', { name: '测试-口红', category: '口红' }],
  ['user_wardrobe', 'e2e2-coat', { name: '测试-外套', category: '外套' }],
  ['user_accessories', 'e2e2-watch', { name: '测试-手表', category: '手表' }],
]
for (const [table, name, vals] of RENAMES) {
  const hit = db.prepare(`select count(*) n from "${table}" where name = ?`).get(name).n
  if (!hit) continue
  if (APPLY) {
    db.prepare(`update "${table}" set name = @name, category = @cat where name = @old`)
      .run({ name: vals.name, cat: vals.category, old: name })
  }
  console.log(`  ${table}「${name}」→「${vals.name}」/「${vals.category}」: ${hit} 行`)
}

// ---- 2b) 测试账号昵称中文化 + 早期探针写坏的乱码值（一律按值匹配，两端 id 不同；幂等）
const NICK_FIXES = [
  ['zzz', '测试账号1'],
  ['e2e', '测试账号2'],
  ['e2e2', '测试账号3'],
  ['e2e3', '测试账号4'],
]
for (const [from, to] of NICK_FIXES) {
  const hit = db.prepare('select count(*) n from users where nickname = ?').get(from).n
  if (!hit) continue
  if (APPLY) db.prepare('update users set nickname = ? where nickname = ?').run(to, from)
  console.log(`  users.nickname「${from}」→「${to}」: ${hit} 行`)
}

// 'Ů'(U+016E) 与含 U+FFFD 的店名都是 09-24 那轮本机探针经 GBK argv 写进去的，原值不可还原。
// 按码点/替换符匹配，不把乱码字节照抄进源码。
{
  const hit = db.prepare('select count(*) n from users where gender = ?').get(String.fromCharCode(0x016e)).n
  if (hit && APPLY) db.prepare('update users set gender = ? where gender = ?').run('女', String.fromCharCode(0x016e))
  console.log(`  users.gender 乱码→「女」: ${hit} 行`)
}
{
  const hit = db.prepare("select count(*) n from stores where name like '%' || char(65533) || '%'").get().n
  if (hit && APPLY) db.prepare("update stores set name = '测试店-甲' where name like '%' || char(65533) || '%'").run()
  console.log(`  stores.name 乱码→「测试店-甲」: ${hit} 行`)
}

// ---- 3) 残留检查
const ALLOW = new Set(['POLO', 'BB', 'BMI', 'AI', 'UI', 'CM', 'MM', 'A4', 'DW', 'OL', 'HM', 'MAC', 'NARS',
  'DIOR', 'BOBBI', 'BROWN', 'SKIN', 'LONGWEAR', 'ORGASM', 'GLOSS', 'DIVA', 'WHIRL', 'ULTRA', 'CARE',
  'LIQUID', 'CELINE', 'LUGGAGE', 'LADY', 'MINI', 'T', 'V', 'U', 'C02', '05', '626', '1C1', '1W2', 'ID'])
const resid = new Map()
for (const [table, col] of TARGETS) {
  const rows = db.prepare(`select "${col}" v from "${table}" where "${col}" is not null`).all()
  for (const r of rows) {
    for (const m of (r.v || '').matchAll(/[一-鿿]([A-Za-z][A-Za-z0-9'-]{1,})|([A-Za-z][A-Za-z0-9'-]{1,})[一-鿿]/g)) {
      const t = (m[1] || m[2]).replace(/[^A-Za-z0-9'-]/g, '')
      if (!t || ALLOW.has(t.toUpperCase())) continue
      resid.set(t, (resid.get(t) || 0) + 1)
    }
  }
}
db.close()
console.log(`\n改到的行数：${rowsChanged}`)
console.log('残留英文（不在保留表里的）：' + (resid.size ? [...resid].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join('  ') : '无'))

// ---- 4) 种子文件
if (FILES) {
  for (const rel of ['seed/rules.json', 'seed/rules-aesthetic.json', 'add-rules.js']) {
    const p = path.join(__dirname, rel)
    if (!fs.existsSync(p)) continue
    const before = fs.readFileSync(p, 'utf8')
    const after = fix(before)
    console.log(`  ${rel}: ${before === after ? '无需改动' : (APPLY ? '已改写' : '待改写')}  差异字节 ${after.length - before.length}`)
    if (APPLY && before !== after) {
      fs.writeFileSync(p, after, 'utf8')
      const again = fix(fs.readFileSync(p, 'utf8'))
      if (again !== after) throw new Error(`${rel} 不幂等，停`)
    }
  }
}
if (!APPLY) console.log('\n（预览，未写入。加 --apply 才写）')
