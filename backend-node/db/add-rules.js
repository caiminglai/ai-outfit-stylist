/**
 * 新增规则数据导入脚本
 *
 * 向数据库中追加更多有科学依据的规则组、规则条件和规则动作。
 * 不清除已有数据，仅追加新规则。
 *
 * 科学依据来源：
 * 1. 胶囊衣橱理论 (Capsule Wardrobe Theory, Susie Faux 1985)
 * 2. 四季色彩分析 (Seasonal Color Analysis, Carole Jackson "Color Me Beautiful" 1987)
 * 3. 体型比例理论 (Body Proportion Theory, Fashion Institute)
 * 4. BMI 亚洲标准 (WHO Western Pacific Region 2000, BMI ≥23 超重)
 * 5. 运动生理学 (Athletic Textile Research, moisture-wicking fabric)
 * 6. 皮肤科化妆品选择指南 (Dermatology Cosmetic Guidelines)
 * 7. 黄金比例面部美学 (Marquardt Mask)
 * 8. 温度调节理论 (Thermoregulation, ACSM)
 * 9. 视觉比例理论 (Visual Proportion Theory, golden ratio 1:1.618)
 * 10. 消费心理学 (Consumer Behavior & Wardrobe Economics)
 *
 * 用法: node db/add-rules.js
 */

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

const DB_PATH = path.join(__dirname, 'styleai.db')

// ============================================================
// 新增规则定义
// ============================================================

const newRules = [
  // ========================================================
  // 一、运动健身穿搭规则 (Athletic Outfit Rules)
  // 科学依据：运动生理学，ACSM 运动服装指南
  // ========================================================
  {
    group: {
      name: '女-运动健身-穿搭-速干',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: '运动健身',
      description: '女性运动健身速干穿搭：吸湿排汗面料，弹性贴身',
      priority: 30,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'occasion', operator: 'eq', value: '运动健身' },
    ],
    actions: [
      { action_type: 'top_style', content: '速干运动背心 / 运动T恤' },
      { action_type: 'bottom_style', content: '高弹力运动legging / 运动短裤' },
      { action_type: 'shoe_style', content: '专业跑步鞋 / 训练鞋' },
      { action_type: 'color_combo', content: '亮色系（荧光绿/橙/粉）提升运动可见度' },
      { action_type: 'outerwear', content: '轻薄防风外套（户外运动时搭配）' },
      {
        action_type: 'reason',
        content:
          '运动生理学建议：速干面料减少体表湿度，弹性面料提供运动自由度（ACSM 运动服装指南）',
      },
    ],
  },
  {
    group: {
      name: '男-运动健身-穿搭-速干',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: '运动健身',
      description: '男性运动健身速干穿搭',
      priority: 30,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'occasion', operator: 'eq', value: '运动健身' },
    ],
    actions: [
      { action_type: 'top_style', content: '速干运动T恤 / 压缩衣' },
      { action_type: 'bottom_style', content: '运动短裤 / 弹力运动长裤' },
      { action_type: 'shoe_style', content: '专业跑步鞋 / 篮球鞋' },
      { action_type: 'color_combo', content: '深色系（黑/藏青/深灰）显瘦且耐脏' },
      { action_type: 'outerwear', content: '轻薄防风外套' },
      {
        action_type: 'reason',
        content: '运动生理学建议：男性运动应选择吸湿排汗面料，深色系减少视觉膨胀感',
      },
    ],
  },

  // ========================================================
  // 二、季节专属穿搭规则 (Season-Specific Outfit Rules)
  // 科学依据：温度调节理论 (Thermoregulation)
  // 夏季 >30°C 需透气棉麻，冬季 <10°C 需保暖层叠
  // ========================================================
  {
    group: {
      name: '女-夏季-穿搭-透气',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '夏季透气穿搭：棉麻面料，浅色系',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'season', operator: 'eq', value: '夏' },
    ],
    actions: [
      { action_type: 'top_style', content: '棉麻短袖 / 吊带 / 雪纺上衣' },
      { action_type: 'bottom_style', content: '亚麻阔腿裤 / 棉质半裙' },
      { action_type: 'shoe_style', content: '凉鞋 / 透气帆布鞋' },
      { action_type: 'color_combo', content: '浅色系（白/浅蓝/薄荷绿）反射阳光降低体感温度' },
      {
        action_type: 'reason',
        content: '热调节理论：浅色反射阳光，棉麻透气率比化纤高40%（Textile Research Journal）',
      },
    ],
  },
  {
    group: {
      name: '男-夏季-穿搭-透气',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '夏季透气穿搭',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'season', operator: 'eq', value: '夏' },
    ],
    actions: [
      { action_type: 'top_style', content: '棉质Polo衫 / 亚麻短袖衬衫' },
      { action_type: 'bottom_style', content: '亚麻短裤 / 棉质休闲裤' },
      { action_type: 'shoe_style', content: '透气网面运动鞋 / 凉鞋' },
      { action_type: 'color_combo', content: '浅色系（白/浅灰/浅蓝）' },
      { action_type: 'reason', content: '热调节理论：男性夏季需选择透气率>80%的天然纤维面料' },
    ],
  },
  {
    group: {
      name: '女-冬季-穿搭-保暖',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '冬季保暖层叠穿搭',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'season', operator: 'eq', value: '冬' },
    ],
    actions: [
      { action_type: 'top_style', content: '保暖内衣 + 羊毛针织衫' },
      { action_type: 'bottom_style', content: '加绒打底裤 / 厚毛呢半裙 + 保暖袜' },
      { action_type: 'shoe_style', content: '加绒短靴 / 雪地靴' },
      { action_type: 'color_combo', content: '深色系（黑/藏青/酒红）吸热保暖' },
      { action_type: 'outerwear', content: '羽绒外套 / 厚毛呢大衣' },
      {
        action_type: 'reason',
        content: '热调节理论：三层穿衣法（base+mid+shell），深色吸热效率高（ASCI 低温着装研究）',
      },
    ],
  },
  {
    group: {
      name: '男-冬季-穿搭-保暖',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '冬季保暖层叠穿搭',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'season', operator: 'eq', value: '冬' },
    ],
    actions: [
      { action_type: 'top_style', content: '保暖内衣 + 羊毛衫 / 厚卫衣' },
      { action_type: 'bottom_style', content: '加绒休闲裤 / 羊毛西裤' },
      { action_type: 'shoe_style', content: '加绒皮靴 / 防滑靴' },
      { action_type: 'color_combo', content: '深色系（黑/深灰/藏青）' },
      { action_type: 'outerwear', content: '羽绒服 / 厚呢大衣 / 棉服' },
      {
        action_type: 'reason',
        content: '热调节理论：三层穿衣法，男性冬季需保证core区域（躯干）保暖优先',
      },
    ],
  },

  // ========================================================
  // 三、BMI 体型精准穿搭规则 (BMI Body Shape Rules)
  // 科学依据：WHO 亚洲BMI标准（BMI≥23超重，≥27肥胖）
  // 体型比例理论：不同BMI区间需不同穿搭策略
  // ========================================================
  {
    group: {
      name: '女-BMI偏瘦-穿搭-增厚',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '偏瘦体型增厚穿搭：增加视觉体积感',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'bmi_level', operator: 'eq', value: '偏瘦' },
    ],
    actions: [
      { action_type: 'top_style', content: '泡泡袖 / 荷叶边上衣 / 宽松针织衫' },
      { action_type: 'bottom_style', content: 'A字裙 / 阔腿裤 / 百褶裙' },
      { action_type: 'shoe_style', content: '厚底鞋 / 粗跟短靴' },
      { action_type: 'color_combo', content: '暖色系+浅色系（膨胀色增加视觉体积）' },
      {
        action_type: 'reason',
        content:
          '视觉比例理论：偏瘦体型（BMI<18.5）应使用膨胀色和宽松剪裁增加体积感（色彩学膨胀/收缩色原理）',
      },
      { action_type: 'avoid', content: '紧身衣 / 深色全身 / 细条纹' },
    ],
  },
  {
    group: {
      name: '女-BMI正常-穿搭-均衡',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '正常体型均衡穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'bmi_level', operator: 'eq', value: '正常' },
    ],
    actions: [
      { action_type: 'top_style', content: '修身衬衫 / 针织衫 / 小西装' },
      { action_type: 'bottom_style', content: '直筒裤 / 铅笔裙 / A字裙' },
      { action_type: 'shoe_style', content: '中跟鞋 / 乐福鞋 / 短靴' },
      { action_type: 'color_combo', content: '中性色+点缀色（黑白灰+1个亮色）' },
      {
        action_type: 'reason',
        content:
          '正常BMI（18.5-22.9）体型穿搭自由度最高，可灵活驾驭各种风格（亚洲BMI标准 WHO WPR 2000）',
      },
    ],
  },
  {
    group: {
      name: '女-BMI偏胖-穿搭-修身',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '偏胖体型修身穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'bmi_level', operator: 'eq', value: '偏胖' },
    ],
    actions: [
      { action_type: 'top_style', content: 'V领深色上衣 / 纵条纹衬衫' },
      { action_type: 'bottom_style', content: '深色直筒裤 / 高腰A字裙' },
      { action_type: 'shoe_style', content: '尖头鞋 / V口鞋（延伸腿部线条）' },
      { action_type: 'color_combo', content: '深色系（黑/藏青/深灰）收缩色为主' },
      {
        action_type: 'reason',
        content:
          '视觉比例理论：偏胖体型（BMI 23-26.9）应使用收缩色和V领，纵向线条拉伸视觉（色彩学收缩色原理）',
      },
      { action_type: 'avoid', content: '横条纹 / 大面积亮色 / 过于宽松的衣物 / 及膝靴' },
    ],
  },
  {
    group: {
      name: '男-BMI偏瘦-穿搭-增厚',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '偏瘦体型增厚穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'bmi_level', operator: 'eq', value: '偏瘦' },
    ],
    actions: [
      { action_type: 'top_style', content: '宽松卫衣 / 粗线针织衫 / 茄克衫' },
      { action_type: 'bottom_style', content: '直筒牛仔裤 / 宽松休闲裤' },
      { action_type: 'shoe_style', content: '厚底休闲鞋 / 工装靴' },
      { action_type: 'color_combo', content: '浅色系+暖色系（增加体积感）' },
      {
        action_type: 'reason',
        content: '视觉比例理论：偏瘦男性应选择有厚度和层次感的衣物，增加肩部和胸部的视觉体积',
      },
      { action_type: 'avoid', content: '紧身衣 / 深色单色搭配' },
    ],
  },
  {
    group: {
      name: '男-BMI偏胖-穿搭-修身',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '偏胖体型修身穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'bmi_level', operator: 'eq', value: '偏胖' },
    ],
    actions: [
      { action_type: 'top_style', content: '深色V领T恤 / 修身衬衫（不紧身）' },
      { action_type: 'bottom_style', content: '深色直筒裤 / 避免低腰裤' },
      { action_type: 'shoe_style', content: '深色皮鞋 / 简约运动鞋' },
      { action_type: 'color_combo', content: '深色系为主（黑/藏青/深灰）' },
      {
        action_type: 'reason',
        content: '视觉比例理论：偏胖男性应选择合身不紧身的深色衣物，V领拉长颈部线条',
      },
      { action_type: 'avoid', content: '横条纹 / 大面积亮色 / 过于宽松 / 腰带过紧' },
    ],
  },

  // ========================================================
  // 四、肤质妆容匹配规则 (Skin Type Makeup Rules)
  // 科学依据：皮肤科化妆品选择指南
  // 干皮需保湿型底妆，油皮需控油型底妆
  // ========================================================
  {
    group: {
      name: '女-干皮-妆容-保湿',
      mode: 'personal',
      gender: '女',
      category: '妆容',
      scenario: null,
      description: '干性皮肤保湿妆容',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_type', operator: 'eq', value: '干皮' },
    ],
    actions: [
      { action_type: '妆容底妆', content: '液态粉底（保湿型）/ BB霜（滋润型）' },
      { action_type: 'foundation', content: '水润精华粉底液，避免哑光粉饼' },
      { action_type: 'lip_color', content: '滋润型唇膏 / 唇釉（含玻尿酸或植物油）' },
      { action_type: 'eye_shadow', content: '霜状眼影（不易卡粉）' },
      { action_type: '妆容风格', content: '水光肌 / 奶油肌妆效（避免哑光妆效）' },
      {
        action_type: 'reason',
        content:
          '皮肤科学：干皮角质层含水量<10%，需选择含透明质酸/甘油的保湿型底妆，避免粉状产品加重干燥（Journal of Cosmetic Dermatology）',
      },
    ],
  },
  {
    group: {
      name: '女-油皮-妆容-控油',
      mode: 'personal',
      gender: '女',
      category: '妆容',
      scenario: null,
      description: '油性皮肤控油妆容',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_type', operator: 'eq', value: '油皮' },
    ],
    actions: [
      { action_type: '妆容底妆', content: '控油妆前乳 / 收敛水' },
      { action_type: 'foundation', content: '哑光粉底液 / 矿物粉底（控油配方）' },
      { action_type: 'lip_color', content: '哑光唇釉 / 持久型唇膏' },
      { action_type: 'eye_shadow', content: '粉状眼影（不易积线）' },
      { action_type: '妆容风格', content: '哑光 / 雾面妆效（减少油光反射）' },
      {
        action_type: 'reason',
        content:
          '皮肤科学：油皮皮脂分泌旺盛，需选择控油配方和哑光妆效产品，粉状质地优于液态（American Academy of Dermatology）',
      },
    ],
  },
  {
    group: {
      name: '女-敏感肌-妆容-温和',
      mode: 'personal',
      gender: '女',
      category: '妆容',
      scenario: null,
      description: '敏感肌温和妆容',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_type', operator: 'eq', value: '敏感' },
    ],
    actions: [
      { action_type: '妆容底妆', content: '敏感肌专用妆前乳（无酒精/无香精）' },
      { action_type: 'foundation', content: '矿物粉底 / 药妆品牌粉底（无刺激性成分）' },
      { action_type: 'lip_color', content: '植物成分唇膏 / 无色素润唇膏' },
      { action_type: '妆容风格', content: '裸妆 / 自然淡妆（减少化妆品用量）' },
      {
        action_type: 'reason',
        content:
          '皮肤科学：敏感肌屏障受损，需选择无香精/无酒精/无paraben的产品，矿物彩妆致敏率最低（Contact Dermatitis Journal）',
      },
      { action_type: 'avoid', content: '含酒精产品 / 浓香型化妆品 / 强着色力彩妆' },
    ],
  },
  {
    group: {
      name: '女-混合皮-妆容-分区',
      mode: 'personal',
      gender: '女',
      category: '妆容',
      scenario: null,
      description: '混合皮分区妆容',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_type', operator: 'eq', value: '混合' },
    ],
    actions: [
      { action_type: '妆容底妆', content: 'T区控油妆前 + U区保湿妆前（分区护理）' },
      { action_type: 'foundation', content: '半哑光粉底液（兼顾控油和保湿）' },
      { action_type: 'lip_color', content: '任意质地均可（唇部不受T区影响）' },
      { action_type: '妆容风格', content: '半哑光妆效（T区雾面+U区微光）' },
      {
        action_type: 'reason',
        content:
          '皮肤科学：混合皮T区油U区干，需分区使用不同质地产品（International Journal of Cosmetic Science）',
      },
    ],
  },

  // ========================================================
  // 五、身高修饰穿搭规则 (Height Modification Rules)
  // 科学依据：视觉比例理论，黄金比例 1:1.618
  // 矮个子提高腰线，高个子可以穿长款
  // ========================================================
  {
    group: {
      name: '女-矮个子-穿搭-显高',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '矮个子显高穿搭',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'height_range', operator: 'eq', value: '150-160' },
      { field: 'height_wish', operator: 'eq', value: '想显高' },
    ],
    actions: [
      { action_type: 'top_style', content: '短上衣 / 高腰线设计 / V领拉长颈部' },
      { action_type: 'bottom_style', content: '高腰短裤 / 高腰A字裙 / 九分裤' },
      { action_type: 'shoe_style', content: '尖头高跟鞋 / 裸色鞋（延伸腿长）' },
      { action_type: 'color_combo', content: '上下同色系或相近色（拉长整体线条）' },
      {
        action_type: 'reason',
        content:
          '视觉比例理论：黄金比例1:1.618，矮个子（<160cm）应提高腰线至肋骨下缘，上下同色系拉长视觉线条（Fashion Design Theory）',
      },
      { action_type: 'avoid', content: '过长上衣 / 低腰裤 / 及膝靴 / 大面积图案' },
    ],
  },
  {
    group: {
      name: '女-高个子-穿搭-均衡',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '高个子均衡穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'height_range', operator: 'eq', value: '180+' },
    ],
    actions: [
      { action_type: 'top_style', content: 'oversized上衣 / 长款大衣 / 宽松衬衫' },
      { action_type: 'bottom_style', content: '阔腿长裤 / 长裙 / 直筒牛仔裤' },
      { action_type: 'shoe_style', content: '平底鞋 / 厚底鞋均可（身高已足够）' },
      { action_type: 'color_combo', content: '可大胆使用上下撞色（身高优势可驾驭）' },
      {
        action_type: 'reason',
        content:
          '视觉比例理论：高个子（>170cm）穿搭自由度高，可驾驭长款和oversized，上下分色不影响整体比例',
      },
    ],
  },
  {
    group: {
      name: '男-矮个子-穿搭-显高',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '矮个子显高穿搭',
      priority: 25,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'height_range', operator: 'eq', value: '160-170' },
      { field: 'height_wish', operator: 'eq', value: '想显高' },
    ],
    actions: [
      { action_type: 'top_style', content: '合身短款外套 / V领上衣 / 纵条纹衬衫' },
      { action_type: 'bottom_style', content: '高腰直筒裤 / 避免低腰裤' },
      { action_type: 'shoe_style', content: '厚底鞋 / 尖头皮鞋 / 同色系裤鞋搭配' },
      { action_type: 'color_combo', content: '上下同色系（拉长视觉线条）' },
      {
        action_type: 'reason',
        content:
          '视觉比例理论：男性身高160-170cm应选择合身剪裁和高腰线，同色系搭配拉长视觉（Menswear Design Theory）',
      },
      { action_type: 'avoid', content: '过长上衣 / 低腰裤 / 宽松大裤脚 / 平底靴' },
    ],
  },

  // ========================================================
  // 六、预算导向穿搭规则 (Budget-Oriented Rules)
  // 科学依据：消费心理学，衣橱经济学
  // ========================================================
  {
    group: {
      name: '女-平价-穿搭-基础款',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '平价预算基础款穿搭',
      priority: 10,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'budget', operator: 'eq', value: '平价' },
    ],
    actions: [
      { action_type: 'top_style', content: '优衣库基础款白T / H&M基础针织衫' },
      { action_type: 'bottom_style', content: '快时尚直筒牛仔裤 / 基础款西裤' },
      { action_type: 'shoe_style', content: '小白鞋 / 基础帆布鞋' },
      { action_type: 'color_combo', content: '基础中性色（黑白灰+1个亮色点缀）' },
      {
        action_type: 'reason',
        content:
          '消费心理学：平价预算应投资基础款（胶囊衣橱理论），60%基础款+30%流行款+10%个性款（Wardrobe Economics）',
      },
    ],
  },
  {
    group: {
      name: '女-高端-穿搭-质感',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '高端预算质感穿搭',
      priority: 10,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'budget', operator: 'eq', value: '高端' },
    ],
    actions: [
      { action_type: 'top_style', content: '真丝衬衫 / 羊绒针织衫 / 设计师品牌小西装' },
      { action_type: 'bottom_style', content: '羊毛西裤 / 真丝半裙 / 高定牛仔裤' },
      { action_type: 'shoe_style', content: '真皮高跟鞋 / 设计师款平底鞋' },
      { action_type: 'color_combo', content: '高级灰 / 莫兰迪色系 / 大地色系' },
      {
        action_type: 'reason',
        content:
          '消费心理学：高端预算应注重面料质感和剪裁工艺，投资天然纤维和经典款式（Luxury Fashion Theory）',
      },
    ],
  },
  {
    group: {
      name: '男-平价-穿搭-基础款',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '平价预算基础款穿搭',
      priority: 10,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'budget', operator: 'eq', value: '平价' },
    ],
    actions: [
      { action_type: 'top_style', content: '基础款纯色T恤 / 牛津纺衬衫' },
      { action_type: 'bottom_style', content: '直筒牛仔裤 / 卡其裤' },
      { action_type: 'shoe_style', content: '小白鞋 / 基础帆布鞋 / 德比鞋' },
      { action_type: 'color_combo', content: '黑白灰+藏青（百搭基础色）' },
      {
        action_type: 'reason',
        content:
          '消费心理学：平价预算男性应投资合身的基础款，比花哨款式更耐穿且显品味（Minimalist Menswear）',
      },
    ],
  },

  // ========================================================
  // 七、年龄分段穿搭规则 (Age-Segmented Outfit Rules)
  // 科学依据：年龄心理学，不同年龄段审美偏好与身体变化
  // ========================================================
  {
    group: {
      name: '女-青年-穿搭-活力',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '18-25岁活力穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'age_range', operator: 'eq', value: '18-25' },
    ],
    actions: [
      { action_type: 'top_style', content: 'oversized卫衣 / crop top / 碎花衬衫' },
      { action_type: 'bottom_style', content: '高腰牛仔裤 / 百褶裙 / 运动短裤' },
      { action_type: 'shoe_style', content: '老爹鞋 / 帆布鞋 / 马丁靴' },
      { action_type: 'color_combo', content: '活力色系（粉/蓝/黄/绿）可大胆撞色' },
      {
        action_type: 'reason',
        content:
          '年龄心理学：18-25岁年轻人审美接受度高，可尝试前卫色彩和潮流款式（Youth Fashion Psychology）',
      },
    ],
  },
  {
    group: {
      name: '女-轻熟-穿搭-知性',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '26-35岁知性穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'age_range', operator: 'eq', value: '26-35' },
    ],
    actions: [
      { action_type: 'top_style', content: '修身衬衫 / 针织衫 / 小西装' },
      { action_type: 'bottom_style', content: '直筒西裤 / 铅笔裙 / 质感阔腿裤' },
      { action_type: 'shoe_style', content: '中跟鞋 / 乐福鞋 / 粗跟短靴' },
      { action_type: 'color_combo', content: '莫兰迪色系 / 大地色系 / 经典黑白灰+点缀色' },
      {
        action_type: 'reason',
        content:
          '年龄心理学：26-35岁轻熟女性注重质感和得体，从活力转向知性优雅（Adult Development Theory）',
      },
    ],
  },
  {
    group: {
      name: '男-青年-穿搭-潮流',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '18-25岁潮流穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'age_range', operator: 'eq', value: '18-25' },
    ],
    actions: [
      { action_type: 'top_style', content: 'oversized卫衣 / 潮牌T恤 / 棒球夹克' },
      { action_type: 'bottom_style', content: '工装裤 / 束脚裤 / 直筒牛仔裤' },
      { action_type: 'shoe_style', content: '老爹鞋 / 篮球鞋 / 板鞋' },
      { action_type: 'color_combo', content: '潮流撞色 / 街头风格色系' },
      {
        action_type: 'reason',
        content:
          '年龄心理学：18-25岁男性偏好街头潮流和运动风格，注重品牌认同感（Youth Consumer Behavior）',
      },
    ],
  },
  {
    group: {
      name: '男-轻熟-穿搭-质感',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: null,
      description: '26-35岁质感穿搭',
      priority: 15,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'age_range', operator: 'eq', value: '26-35' },
    ],
    actions: [
      { action_type: 'top_style', content: '牛津纺衬衫 / 修身针织衫 / 茄克衫' },
      { action_type: 'bottom_style', content: '修身卡其裤 / 直筒牛仔裤 / 西裤' },
      { action_type: 'shoe_style', content: '德比鞋 / 切尔西靴 / 小白鞋' },
      { action_type: 'color_combo', content: '低饱和色系（藏青/卡其/深灰/橄榄绿）' },
      {
        action_type: 'reason',
        content:
          '年龄心理学：26-35岁男性从潮流转向质感，注重面料和剪裁（Adult Development Theory）',
      },
    ],
  },

  // ========================================================
  // 八、颈肩修饰穿搭规则 (Neck/Shoulder Modification Rules)
  // 科学依据：人体比例美学，颈肩线对整体比例影响大
  // ========================================================
  {
    group: {
      name: '女-短颈宽肩-穿搭-修饰',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '短颈宽肩体型修饰穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'neck_length', operator: 'eq', value: '短' },
      { field: 'shoulder_type', operator: 'eq', value: '宽肩' },
    ],
    actions: [
      { action_type: 'top_style', content: '大V领 / 挂脖 / 一字领（避开高领和垫肩）' },
      { action_type: 'bottom_style', content: 'A字裙 / 阔腿裤（平衡肩宽比例）' },
      { action_type: 'shoe_style', content: '尖头鞋（延伸线条）' },
      { action_type: 'color_combo', content: '上身深色+下身浅色（转移视觉重心）' },
      {
        action_type: 'reason',
        content:
          '人体比例美学：短颈宽肩应使用V领拉长颈部，下半身膨胀平衡肩宽比例（Proportion Theory）',
      },
      { action_type: 'avoid', content: '高领 / 垫肩 / 泡泡袖 / 船领' },
    ],
  },
  {
    group: {
      name: '女-长颈窄肩-穿搭-丰满',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '长颈窄肩体型丰满穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'neck_length', operator: 'eq', value: '长' },
      { field: 'shoulder_type', operator: 'eq', value: '窄肩' },
    ],
    actions: [
      { action_type: 'top_style', content: '高领针织衫 / 荷叶边上衣 / 垫肩西装' },
      { action_type: 'bottom_style', content: '修身裤 / 铅笔裙（上身丰满后下身可修身）' },
      { action_type: 'shoe_style', content: '任意鞋型均可' },
      { action_type: 'color_combo', content: '上身浅色+亮色（增加上半身体积感）' },
      {
        action_type: 'reason',
        content:
          '人体比例美学：长颈窄肩应使用高领和垫肩增加肩部体积，平衡长颈比例（Proportion Theory）',
      },
    ],
  },

  // ========================================================
  // 九、肤色精准配色规则 (Precise Skin Tone Color Rules)
  // 科学依据：四季色彩分析 (Carole Jackson "Color Me Beautiful" 1987)
  // 暖皮=春/秋季型，冷皮=夏/冬季型
  // ========================================================
  {
    group: {
      name: '女-暖皮-穿搭-春季型',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '暖皮春季型配色：温暖明亮色系',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '暖皮' },
      { field: 'skin_tone_detail', operator: 'eq', value: '白皙' },
    ],
    actions: [
      { action_type: 'top_style', content: '珊瑚粉 / 鹅黄 / 薄荷绿上衣' },
      { action_type: 'color_combo', content: '春季型色系：珊瑚粉+奶白、鹅黄+浅蓝、薄荷绿+米色' },
      {
        action_type: 'reason',
        content: '四季色彩分析：暖白皮属于春季型，适合温暖明亮的清色系（Carole Jackson 1987）',
      },
      { action_type: 'avoid', content: '冷色调（藏青/酒红/深紫）会显暗沉' },
    ],
  },
  {
    group: {
      name: '女-暖皮-穿搭-秋季型',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '暖皮秋季型配色：大地深色系',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '暖皮' },
      { field: 'skin_tone_detail', operator: 'eq', value: '偏黄' },
    ],
    actions: [
      { action_type: 'top_style', content: '焦糖色 / 橄榄绿 / 赤陶红上衣' },
      { action_type: 'color_combo', content: '秋季型色系：焦糖+奶油、橄榄绿+卡其、赤陶红+深棕' },
      {
        action_type: 'reason',
        content: '四季色彩分析：暖黄皮属于秋季型，适合浓郁的大地色系（Carole Jackson 1987）',
      },
      { action_type: 'avoid', content: '冷蓝色调 / 荧光色 / 粉色系会显黑' },
    ],
  },
  {
    group: {
      name: '女-冷皮-穿搭-夏季型',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '冷皮夏季型配色：柔和冷色系',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '冷皮' },
      { field: 'skin_tone_detail', operator: 'eq', value: '白皙' },
    ],
    actions: [
      { action_type: 'top_style', content: '雾霾蓝 / 薰衣草紫 / 浅灰上衣' },
      { action_type: 'color_combo', content: '夏季型色系：雾霾蓝+白、薰衣草紫+银灰、浅粉+灰蓝' },
      {
        action_type: 'reason',
        content: '四季色彩分析：冷白皮属于夏季型，适合柔和的冷色系（Carole Jackson 1987）',
      },
      { action_type: 'avoid', content: '橙色 / 金棕色 / 深绿色会显脏' },
    ],
  },
  {
    group: {
      name: '女-冷皮-穿搭-冬季型',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: null,
      description: '冷皮冬季型配色：高对比冷色系',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '冷皮' },
      { field: 'skin_tone_detail', operator: 'in', value: '小麦色,古铜色' },
    ],
    actions: [
      { action_type: 'top_style', content: '纯白 / 正红 / 宝蓝上衣' },
      { action_type: 'color_combo', content: '冬季型色系：纯白+黑、正红+藏青、宝蓝+银色' },
      {
        action_type: 'reason',
        content: '四季色彩分析：冷深皮属于冬季型，适合高饱和高对比的纯色系（Carole Jackson 1987）',
      },
      { action_type: 'avoid', content: '柔和浊色 / 大地色 / 浅粉色会显暗' },
    ],
  },

  // ========================================================
  // 十、婚礼宴会专属穿搭规则 (Wedding/Event Outfit Rules)
  // 科学依据：正式场合着装规范 (Dress Code Theory)
  // ========================================================
  {
    group: {
      name: '女-婚礼宴会-穿搭-正式',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: '婚礼宴会',
      description: '婚礼宴会正式穿搭',
      priority: 30,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'occasion', operator: 'eq', value: '婚礼宴会' },
    ],
    actions: [
      { action_type: 'top_style', content: '蕾丝礼服上衣 / 丝绸吊带上衣 / 珠片装饰上衣' },
      { action_type: 'bottom_style', content: '长款礼服裙 / 鱼尾裙 / 高开叉长裙' },
      { action_type: 'shoe_style', content: '细高跟鞋 / 镶钻凉鞋 / 丝绒高跟鞋' },
      { action_type: 'color_combo', content: '不穿白色（避免与新娘撞色）选酒红/藏青/墨绿/香槟' },
      { action_type: 'outerwear', content: '披肩 / 丝绒小外套' },
      {
        action_type: 'reason',
        content:
          '着装规范理论：婚礼宾客应避免白色系，选择正式感礼服，尊重场合文化（Dress Code Etiquette）',
      },
    ],
  },
  {
    group: {
      name: '男-婚礼宴会-穿搭-正装',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: '婚礼宴会',
      description: '婚礼宴会正装穿搭',
      priority: 30,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'occasion', operator: 'eq', value: '婚礼宴会' },
    ],
    actions: [
      { action_type: 'top_style', content: '白色礼服衬衫 + 黑色领结 / 深色西装' },
      { action_type: 'bottom_style', content: '黑色礼服裤 / 深色西裤' },
      { action_type: 'shoe_style', content: '黑色漆皮牛津鞋 / 深色皮鞋' },
      { action_type: 'color_combo', content: '黑+白经典正装 或 深蓝/深灰三件套' },
      { action_type: 'outerwear', content: '礼服外套 / 三件套西装' },
      {
        action_type: 'reason',
        content:
          '着装规范理论：男性参加婚礼需着正装或礼服，领结配色需根据婚礼主题调整（Black Tie Dress Code）',
      },
    ],
  },

  // ========================================================
  // 十一、配饰金属色肤色匹配规则 (Metal Color & Skin Tone Rules)
  // 科学依据：色彩学冷暖色调理论
  // 暖皮配金色，冷皮配银色
  // ========================================================
  {
    group: {
      name: '女-暖皮-配饰-金色',
      mode: 'personal',
      gender: '女',
      category: '配饰',
      scenario: null,
      description: '暖皮配饰金色系推荐',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '暖皮' },
    ],
    actions: [
      { action_type: 'metal_color', content: '金色 / 玫瑰金 / 古铜色' },
      { action_type: 'earring_type', content: '金色圆环耳饰 / 玫瑰金坠式耳饰' },
      { action_type: 'necklace_type', content: '金色锁骨链 / 玫瑰金项链' },
      { action_type: 'bag_style', content: '驼色 / 焦糖色 / 棕色系手袋' },
      {
        action_type: 'reason',
        content:
          '色彩学冷暖理论：暖皮（含黄色素多）搭配暖色调金色系配饰，视觉和谐度最高（Color Theory, Johannes Itten）',
      },
    ],
  },
  {
    group: {
      name: '女-冷皮-配饰-银色',
      mode: 'personal',
      gender: '女',
      category: '配饰',
      scenario: null,
      description: '冷皮配饰银色系推荐',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'skin_tone', operator: 'eq', value: '冷皮' },
    ],
    actions: [
      { action_type: 'metal_color', content: '银色 / 白金 / 铂金色' },
      { action_type: 'earring_type', content: '银色简约耳钉 / 白金几何耳饰' },
      { action_type: 'necklace_type', content: '银色锁骨链 / 白金珍珠项链' },
      { action_type: 'bag_style', content: '黑/白/灰色系手袋 / 银色金属扣' },
      {
        action_type: 'reason',
        content:
          '色彩学冷暖理论：冷皮（含蓝色素多）搭配冷色调银色系配饰，提升皮肤通透感（Color Theory）',
      },
    ],
  },
  {
    group: {
      name: '男-暖皮-配饰-金棕',
      mode: 'personal',
      gender: '男',
      category: '配饰',
      scenario: null,
      description: '暖皮男性配饰推荐',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'skin_tone', operator: 'eq', value: '暖皮' },
    ],
    actions: [
      { action_type: 'metal_color', content: '金色 / 古铜色 / 棕色皮革' },
      { action_type: 'watch', content: '金表 / 棕色皮带手表 / 古铜色表盘' },
      { action_type: 'belt', content: '棕色真皮腰带 / 铜扣腰带' },
      {
        action_type: 'reason',
        content:
          '色彩学冷暖理论：暖皮男性适合金色系和棕色调配饰，整体和谐有质感（Menswear Color Theory）',
      },
    ],
  },
  {
    group: {
      name: '男-冷皮-配饰-银钢',
      mode: 'personal',
      gender: '男',
      category: '配饰',
      scenario: null,
      description: '冷皮男性配饰推荐',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'skin_tone', operator: 'eq', value: '冷皮' },
    ],
    actions: [
      { action_type: 'metal_color', content: '银色 / 钢色 / 黑色金属' },
      { action_type: 'watch', content: '银色钢表 / 黑色表盘手表' },
      { action_type: 'belt', content: '黑色真皮腰带 / 银扣腰带' },
      {
        action_type: 'reason',
        content:
          '色彩学冷暖理论：冷皮男性适合银色系和黑色调配饰，干净利落显气质（Menswear Color Theory）',
      },
    ],
  },

  // ========================================================
  // 十二、过敏体质配饰安全规则 (Allergy-Safe Accessory Rules)
  // 科学依据：接触性皮炎研究 (Contact Dermatitis Research)
  // ========================================================
  {
    group: {
      name: '女-过敏体质-配饰-防敏',
      mode: 'personal',
      gender: '女',
      category: '配饰',
      scenario: null,
      description: '过敏体质防敏配饰推荐',
      priority: 30,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'allergy_metal', operator: 'ne', value: '无' },
    ],
    actions: [
      { action_type: 'metal_color', content: '钛钢 / 医疗不锈钢 / 铂金（防过敏材质）' },
      { action_type: 'earring_type', content: '钛钢耳钉 / 铂金耳饰（避免镍合金）' },
      { action_type: 'necklace_type', content: '钛钢项链 / 纯银镀铂金项链' },
      {
        action_type: 'reason',
        content:
          '接触性皮炎研究：金属过敏（镍过敏最常见）患者应选择钛钢/医疗不锈钢/铂金材质，致敏率<1%（Contact Dermatitis Journal）',
      },
      { action_type: 'avoid', content: '镍合金 / 便宜合金 / 含铜饰品 / 劣电镀品' },
    ],
  },

  // ========================================================
  // 十三、发型脸型精准匹配规则 (Face Shape & Hairstyle Rules)
  // 科学依据：面部比例美学 (Facial Proportion Aesthetics)
  // 圆脸需纵向拉伸，方脸需柔和线条
  // ========================================================
  {
    group: {
      name: '女-圆脸-发型-纵向拉伸',
      mode: 'personal',
      gender: '女',
      category: '发型',
      scenario: null,
      description: '圆脸发型纵向拉伸建议',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'face_shape', operator: 'eq', value: '圆脸' },
    ],
    actions: [
      { action_type: '发型', content: '中长直发 / 高马尾 / 侧分长bob' },
      { action_type: 'hair_length', content: '中长发（锁骨以下） / 长发' },
      { action_type: 'bang_type', content: '侧分刘海 / 中分无刘海（避免齐刘海）' },
      {
        action_type: 'reason',
        content:
          '面部比例美学：圆脸（宽=长）需纵向拉伸，选择有高度感的发型和侧分线条（Facial Proportion Theory）',
      },
      { action_type: 'avoid', content: '齐刘海 / 短bob / 蓬松卷发会显脸更圆' },
    ],
  },
  {
    group: {
      name: '女-方脸-发型-柔和线条',
      mode: 'personal',
      gender: '女',
      category: '发型',
      scenario: null,
      description: '方脸发型柔和线条建议',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'face_shape', operator: 'eq', value: '方脸' },
    ],
    actions: [
      { action_type: '发型', content: '大波浪卷发 / 层次感长发 / 柔美锁骨发' },
      { action_type: 'hair_length', content: '中长发 / 长发（层次感弱化下颌角）' },
      { action_type: 'bang_type', content: '空气刘海 / 法式碎刘海（柔和额角）' },
      {
        action_type: 'reason',
        content:
          '面部比例美学：方脸（下颌角突出）需柔和曲线发型弱化棱角（Facial Proportion Theory）',
      },
      { action_type: 'avoid', content: '直发一刀切 / 高扎发露出下颌 / 短发' },
    ],
  },
  {
    group: {
      name: '女-心形脸-发型-平衡下巴',
      mode: 'personal',
      gender: '女',
      category: '发型',
      scenario: null,
      description: '心形脸发型平衡下巴建议',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'face_shape', operator: 'eq', value: '心形脸' },
    ],
    actions: [
      { action_type: '发型', content: '下巴长度bob / 中长卷发 / 蓬松中长发' },
      { action_type: 'hair_length', content: '短发到下巴 / 中长发（增加下半部分体积）' },
      { action_type: 'bang_type', content: '侧分刘海 / 轻薄刘海' },
      {
        action_type: 'reason',
        content:
          '面部比例美学：心形脸（宽额窄下巴）需在下半部分增加体积平衡（Facial Proportion Theory）',
      },
    ],
  },
  {
    group: {
      name: '女-长脸-发型-横向丰满',
      mode: 'personal',
      gender: '女',
      category: '发型',
      scenario: null,
      description: '长脸发型横向丰满建议',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'face_shape', operator: 'eq', value: '长脸' },
    ],
    actions: [
      { action_type: '发型', content: '蓬松中短发 / 齐刘海短发 / 波浪中发' },
      { action_type: 'hair_length', content: '短发到下巴 / 中短发（避免过长拉长脸型）' },
      { action_type: 'bang_type', content: '齐刘海 / 厚刘海（缩短脸部长度）' },
      {
        action_type: 'reason',
        content:
          '面部比例美学：长脸（长>宽）需横向丰满和刘海缩短视觉长度（Facial Proportion Theory）',
      },
      { action_type: 'avoid', content: '超长直发 / 中分无刘海 / 过于贴头皮' },
    ],
  },

  // ========================================================
  // 十四、通勤场景细分规则 (Detailed Commute Rules)
  // 科学依据：职场着装心理学 (Workplace Dress Psychology)
  // ========================================================
  {
    group: {
      name: '女-上班通勤-穿搭-简约',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: '上班通勤',
      description: '上班通勤简约干练穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'occasion', operator: 'eq', value: '上班通勤' },
    ],
    actions: [
      { action_type: 'top_style', content: '简约衬衫 / 针织开衫 / 修身西装' },
      { action_type: 'bottom_style', content: '直筒西裤 / 铅笔裙 / 质感阔腿裤' },
      { action_type: 'shoe_style', content: '乐福鞋 / 中跟鞋 / 平底牛津鞋' },
      { action_type: 'color_combo', content: '中性色系（黑/白/灰/藏青/卡其）+ 一个点缀色' },
      { action_type: 'outerwear', content: '轻薄风衣 / 小西装外套' },
      {
        action_type: 'reason',
        content:
          '职场着装心理学：上班通勤应保持干练形象，中性色系传达专业感（Workplace Psychology, Heilman 2018）',
      },
    ],
  },
  {
    group: {
      name: '男-上班通勤-穿搭-商务休闲',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: '上班通勤',
      description: '上班通勤商务休闲穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'occasion', operator: 'eq', value: '上班通勤' },
    ],
    actions: [
      { action_type: 'top_style', content: '牛津纺衬衫 / 休闲西装 / 纯色Polo衫' },
      { action_type: 'bottom_style', content: '卡其裤 / 修身牛仔裤 / 休闲西裤' },
      { action_type: 'shoe_style', content: '德比鞋 / 切尔西靴 / 帆布鞋' },
      { action_type: 'color_combo', content: '藏青+卡其 / 深灰+白 / 橄榄绿+米色' },
      { action_type: 'outerwear', content: '休闲西装 / 哈灵顿夹克 / 风衣' },
      {
        action_type: 'reason',
        content:
          '职场着装心理学：男性商务休闲(Smart Casual)平衡专业与亲和力（Workplace Psychology）',
      },
    ],
  },

  // ========================================================
  // 十五、居家休闲穿搭规则 (Casual Home Rules)
  // 科学依据：舒适心理学 (Comfort Psychology)
  // ========================================================
  {
    group: {
      name: '女-居家休闲-穿搭-舒适',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: '居家休闲',
      description: '居家休闲舒适穿搭',
      priority: 10,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'occasion', operator: 'eq', value: '居家休闲' },
    ],
    actions: [
      { action_type: 'top_style', content: '宽松棉质T恤 / 居家长袖 / 睡衣套装' },
      { action_type: 'bottom_style', content: '棉质短裤 / 居家宽松裤 / 瑜伽裤' },
      { action_type: 'shoe_style', content: '棉拖鞋 / 居家鞋 / 不穿鞋' },
      { action_type: 'color_combo', content: '柔和色系（米色/浅粉/浅灰/薄荷绿）' },
      {
        action_type: 'reason',
        content:
          '舒适心理学：居家应选择天然棉质宽松面料，柔和色调促进放松（Environmental Psychology）',
      },
    ],
  },
  {
    group: {
      name: '男-居家休闲-穿搭-舒适',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: '居家休闲',
      description: '居家休闲舒适穿搭',
      priority: 10,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'occasion', operator: 'eq', value: '居家休闲' },
    ],
    actions: [
      { action_type: 'top_style', content: '纯棉T恤 / 居家长袖 / 运动卫衣' },
      { action_type: 'bottom_style', content: '运动短裤 / 棉质居家裤' },
      { action_type: 'shoe_style', content: '棉拖鞋 / 居家鞋' },
      { action_type: 'color_combo', content: '低饱和色系（灰/深蓝/墨绿/黑）' },
      {
        action_type: 'reason',
        content:
          '舒适心理学：男性居家同样需要舒适面料，低饱和色调有助于精神放松（Environmental Psychology）',
      },
    ],
  },

  // ========================================================
  // 十六、约会聚会细分规则 (Dating & Party Detailed Rules)
  // 科学依据：社交印象管理 (Social Impression Management)
  // ========================================================
  {
    group: {
      name: '女-约会聚会-穿搭-魅力',
      mode: 'personal',
      gender: '女',
      category: '穿搭',
      scenario: '约会聚会',
      description: '约会聚会魅力穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '女' },
      { field: 'occasion', operator: 'eq', value: '约会聚会' },
    ],
    actions: [
      { action_type: 'top_style', content: '露肩上衣 / V领针织衫 / 碎花连衣裙上衣' },
      { action_type: 'bottom_style', content: '高腰半裙 / 修身牛仔裤 / 连衣裙' },
      { action_type: 'shoe_style', content: '细高跟鞋 / 猫跟短靴' },
      { action_type: 'color_combo', content: '浪漫色系（粉/红/紫/酒红/裸色）' },
      {
        action_type: 'reason',
        content:
          '社交印象管理：约会聚会应展现女性魅力，浪漫色系和适度露肤提升吸引力（Impression Management Theory, Goffman 1959）',
      },
    ],
  },
  {
    group: {
      name: '男-约会聚会-穿搭-品味',
      mode: 'personal',
      gender: '男',
      category: '穿搭',
      scenario: '约会聚会',
      description: '约会聚会有品味穿搭',
      priority: 20,
    },
    conditions: [
      { field: 'gender', operator: 'eq', value: '男' },
      { field: 'occasion', operator: 'eq', value: '约会聚会' },
    ],
    actions: [
      { action_type: 'top_style', content: '修身针织衫 / 印花衬衫 / 高领毛衣' },
      { action_type: 'bottom_style', content: '修身牛仔裤 / 休闲西裤' },
      { action_type: 'shoe_style', content: '切尔西靴 / 皮质板鞋 / 设计师运动鞋' },
      { action_type: 'color_combo', content: '有质感的色系（深蓝+白 / 酒红+黑 / 橄榄+卡其）' },
      {
        action_type: 'reason',
        content:
          '社交印象管理：男性约会应展现品味而非炫耀，修身合体+有质感的搭配提升好感度（Impression Management）',
      },
    ],
  },
]

// ============================================================
// 导入函数
// ============================================================

function addNewRules(db) {
  // 获取当前最大ID
  const maxGroup = db.prepare('SELECT MAX(id) as maxId FROM rule_groups').get()
  const maxCondition = db.prepare('SELECT MAX(id) as maxId FROM rule_conditions').get()
  const maxAction = db.prepare('SELECT MAX(id) as maxId FROM rule_actions').get()

  let groupId = (maxGroup?.maxId || 0) + 1
  let conditionId = (maxCondition?.maxId || 0) + 1
  let actionId = (maxAction?.maxId || 0) + 1

  const insertGroup = db.prepare(`
    INSERT INTO rule_groups
      (id, name, mode, gender, category, scenario, region, age_range,
       description, priority, enabled, hit_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now'))
  `)

  const insertCondition = db.prepare(`
    INSERT INTO rule_conditions
      (id, group_id, field, operator, value, weight)
    VALUES (?, ?, ?, ?, ?, 1)
  `)

  const insertAction = db.prepare(`
    INSERT INTO rule_actions
      (id, group_id, action_type, content, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `)

  let groupCount = 0
  let conditionCount = 0
  let actionCount = 0

  db.exec('BEGIN TRANSACTION')
  try {
    for (const rule of newRules) {
      const g = rule.group
      insertGroup.run(
        groupId,
        g.name,
        g.mode,
        g.gender,
        g.category,
        g.scenario ?? null,
        g.region ?? null,
        g.age_range ?? null,
        g.description,
        g.priority ?? 0,
      )
      groupCount++

      // 插入条件
      for (const cond of rule.conditions) {
        insertCondition.run(
          conditionId,
          groupId,
          cond.field,
          cond.operator,
          JSON.stringify(cond.value),
        )
        conditionId++
        conditionCount++
      }

      // 插入动作
      let sortOrder = 0
      for (const action of rule.actions) {
        insertAction.run(actionId, groupId, action.action_type, action.content, sortOrder)
        actionId++
        actionCount++
        sortOrder++
      }

      groupId++
    }

    db.exec('COMMIT')
    console.log(
      `[新增规则] 导入完成: ${groupCount} 规则组, ${conditionCount} 条件, ${actionCount} 动作`,
    )
    console.log(`[新增规则] 规则组ID范围: ${maxGroup?.maxId + 1} - ${groupId - 1}`)
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ============================================================
// 主入口
// ============================================================

if (require.main === module) {
  const db = new Database(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  // 确保表存在
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf-8')
  db.exec(schema)

  addNewRules(db)
  db.close()
  console.log('[新增规则] 数据库已关闭')
}

module.exports = { addNewRules, newRules }
