/**
 * 补充妆容/发型/配饰/姿势规则,均衡类别分布
 *
 * 补充方向:
 *   - 妆容:补肤色维度(冷皮/自然皮各场景)
 *   - 发型:补脸型×场景(各脸型通勤/约会)
 *   - 配饰:补脸型(耳饰修饰)+肤色(金属色)
 *   - 姿势:补场景(聚会/面试)
 */
const db = require('../db/init');

const cv = (field, val) => JSON.stringify({ [field]: val });

function stdConds(gender, categoryEn, scenario, extra = []) {
  const conds = [
    { field: 'gender', operator: 'eq', value: cv('gender', gender), weight: 3 },
    { field: 'category', operator: 'eq', value: cv('category', categoryEn), weight: 3 },
  ];
  if (scenario) {
    conds.push({ field: 'scenario', operator: 'eq', value: cv('scenario', scenario), weight: 3 });
  }
  return conds.concat(extra);
}

// ============ 妆容补充(肤色维度) ============
const makeupRules = [
  {
    name: '女-通勤-妆容-冷皮', gender: '女', category: '妆容', scenario: '通勤',
    desc: '冷皮通勤妆容:冷调显白,干净专业',
    conds: stdConds('女', 'makeup', '通勤', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '冷皮'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '冷调清透通勤妆', sort_order: 1 },
      { action_type: 'foundation', content: '冷调偏白粉底(贴合冷皮)', sort_order: 2 },
      { action_type: 'eye_shadow', content: '灰棕/冷咖色系(深邃消肿)', sort_order: 3 },
      { action_type: 'lip_color', content: '莓果色/干枯玫瑰(冷调显白)', sort_order: 4 },
      { action_type: 'reason', content: '冷皮宜冷调配色,灰棕眼影深邃,莓果唇色显白提气色,通勤干净专业', sort_order: 5 },
    ],
  },
  {
    name: '女-通勤-妆容-自然', gender: '女', category: '妆容', scenario: '通勤',
    desc: '自然皮通勤妆容:中性百搭,清透得体',
    conds: stdConds('女', 'makeup', '通勤', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '自然'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '中性清透通勤妆', sort_order: 1 },
      { action_type: 'foundation', content: '自然色号粉底(贴合肤色)', sort_order: 2 },
      { action_type: 'eye_shadow', content: '大地色/焦糖色(百搭深邃)', sort_order: 3 },
      { action_type: 'lip_color', content: '豆沙色/奶茶色(中性知性)', sort_order: 4 },
      { action_type: 'reason', content: '自然皮百搭,大地色眼影深邃,豆沙唇色知性得体,通勤清透不出错', sort_order: 5 },
    ],
  },
  {
    name: '女-约会-妆容-暖皮', gender: '女', category: '妆容', scenario: '约会',
    desc: '暖皮约会妆容:蜜桃柔美,温暖浪漫',
    conds: stdConds('女', 'makeup', '约会', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '暖皮'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '蜜桃暖调约会妆', sort_order: 1 },
      { action_type: 'foundation', content: '暖调光泽粉底(通透温暖)', sort_order: 2 },
      { action_type: 'eye_shadow', content: '蜜桃棕/金棕色系(温暖放大)', sort_order: 3 },
      { action_type: 'lip_color', content: '珊瑚粉/西柚色(暖调甜美)', sort_order: 4 },
      { action_type: 'reason', content: '暖皮宜暖调配色,蜜桃眼影温暖,珊瑚唇甜美,约会浪漫有气色', sort_order: 5 },
    ],
  },
  {
    name: '女-约会-妆容-自然', gender: '女', category: '妆容', scenario: '约会',
    desc: '自然皮约会妆容:玫瑰柔美,温柔浪漫',
    conds: stdConds('女', 'makeup', '约会', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '自然'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '玫瑰柔美约会妆', sort_order: 1 },
      { action_type: 'foundation', content: '水光自然粉底', sort_order: 2 },
      { action_type: 'eye_shadow', content: '玫瑰棕/粉棕色系(温柔放大)', sort_order: 3 },
      { action_type: 'lip_color', content: '樱花粉/玫瑰豆沙(温柔浪漫)', sort_order: 4 },
      { action_type: 'reason', content: '自然皮百搭,玫瑰色系温柔,樱花唇浪漫,约会柔美有氛围', sort_order: 5 },
    ],
  },
  {
    name: '女-面试-妆容-暖皮', gender: '女', category: '妆容', scenario: '面试',
    desc: '暖皮面试妆容:哑光干净,专业稳重',
    conds: stdConds('女', 'makeup', '面试', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '暖皮'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '暖调专业面试妆', sort_order: 1 },
      { action_type: 'foundation', content: '哑光暖调粉底(服帖干净)', sort_order: 2 },
      { action_type: 'eye_shadow', content: '棕色系(低调深邃)', sort_order: 3 },
      { action_type: 'lip_color', content: '豆沙色/裸棕色(稳重不抢眼)', sort_order: 4 },
      { action_type: 'reason', content: '暖皮面试宜哑光干净,棕色眼影低调,豆沙唇稳重,给人专业信赖感', sort_order: 5 },
    ],
  },
  {
    name: '女-面试-妆容-冷皮', gender: '女', category: '妆容', scenario: '面试',
    desc: '冷皮面试妆容:哑光清冷,专业干练',
    conds: stdConds('女', 'makeup', '面试', [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '冷皮'), weight: 3 },
    ]),
    acts: [
      { action_type: '妆容风格', content: '冷调干练面试妆', sort_order: 1 },
      { action_type: 'foundation', content: '哑光冷调粉底(清冷服帖)', sort_order: 2 },
      { action_type: 'eye_shadow', content: '灰棕色系(干练深邃)', sort_order: 3 },
      { action_type: 'lip_color', content: '裸粉色/干枯玫瑰(干练不抢眼)', sort_order: 4 },
      { action_type: 'reason', content: '冷皮面试宜哑光清冷,灰棕眼影干练,裸粉唇专业,给人干练信赖感', sort_order: 5 },
    ],
  },
];

// ============ 发型补充(脸型×场景) ============
const hairRules = [
  {
    name: '女-通勤-发型-圆脸', gender: '女', category: '发型', scenario: '通勤',
    desc: '圆脸通勤发型:侧分拉长,干练利落',
    conds: stdConds('女', 'hairstyle', '通勤', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '圆脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '侧分微卷中长发/侧分低马尾', sort_order: 1 },
      { action_type: 'hair_length', content: '中长发(过肩)', sort_order: 2 },
      { action_type: 'bang_type', content: '侧分长刘海(拉长脸型)', sort_order: 3 },
      { action_type: 'avoid', content: '齐刘海(显脸更圆)', sort_order: 4 },
      { action_type: 'reason', content: '圆脸通勤需拉长脸型,侧分长卷垂直线条延伸,低马尾干练,避免齐刘海压缩比例', sort_order: 5 },
    ],
  },
  {
    name: '女-通勤-发型-方脸', gender: '女', category: '发型', scenario: '通勤',
    desc: '方脸通勤发型:柔和波浪,软化棱角',
    conds: stdConds('女', 'hairstyle', '通勤', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '方脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '柔和波浪锁骨发/微卷低马尾', sort_order: 1 },
      { action_type: 'hair_length', content: '中长发(锁骨至胸部)', sort_order: 2 },
      { action_type: 'bang_type', content: '空气刘海/法式碎刘海', sort_order: 3 },
      { action_type: 'avoid', content: '一刀齐短发(突出棱角)', sort_order: 4 },
      { action_type: 'reason', content: '方脸通勤需柔和棱角,波浪卷曲线软化下颌角,空气刘海柔化额头,干练又柔和', sort_order: 5 },
    ],
  },
  {
    name: '女-通勤-发型-长脸', gender: '女', category: '发型', scenario: '通勤',
    desc: '长脸通勤发型:刘海缩短,利落干练',
    conds: stdConds('女', 'hairstyle', '通勤', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '长脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '齐刘海波波头/蓬松中短发', sort_order: 1 },
      { action_type: 'hair_length', content: '中短发(下巴至锁骨)', sort_order: 2 },
      { action_type: 'bang_type', content: '齐刘海/空气刘海(缩短脸长)', sort_order: 3 },
      { action_type: 'avoid', content: '中分贴骨直发(显脸更长)', sort_order: 4 },
      { action_type: 'reason', content: '长脸通勤需缩短脸型,齐刘海遮挡额头,横向蓬松增加脸宽,波波头利落干练', sort_order: 5 },
    ],
  },
  {
    name: '女-约会-发型-圆脸', gender: '女', category: '发型', scenario: '约会',
    desc: '圆脸约会发型:浪漫长卷,拉长脸型',
    conds: stdConds('女', 'hairstyle', '约会', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '圆脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '侧分大波浪长卷/半扎发', sort_order: 1 },
      { action_type: 'hair_length', content: '长发(胸部以上)', sort_order: 2 },
      { action_type: 'bang_type', content: '侧分长刘海(拉长脸型)', sort_order: 3 },
      { action_type: 'reason', content: '圆脸约会宜浪漫长卷拉长脸型,侧分大波浪温柔,半扎发增添约会氛围', sort_order: 4 },
    ],
  },
  {
    name: '女-约会-发型-方脸', gender: '女', category: '发型', scenario: '约会',
    desc: '方脸约会发型:柔和卷发,浪漫柔美',
    conds: stdConds('女', 'hairstyle', '约会', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '方脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '柔和波浪长发/法式微卷', sort_order: 1 },
      { action_type: 'hair_length', content: '中长至长发', sort_order: 2 },
      { action_type: 'bang_type', content: '法式碎刘海/空气刘海', sort_order: 3 },
      { action_type: 'reason', content: '方脸约会宜柔和卷发软化棱角,法式微卷浪漫,碎刘海柔化,约会温柔有氛围', sort_order: 4 },
    ],
  },
  {
    name: '女-约会-发型-长脸', gender: '女', category: '发型', scenario: '约会',
    desc: '长脸约会发型:刘海卷发,浪漫缩短',
    conds: stdConds('女', 'hairstyle', '约会', [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '长脸'), weight: 3 },
    ]),
    acts: [
      { action_type: '发型', content: '空气刘海中长卷/蓬松卷发', sort_order: 1 },
      { action_type: 'hair_length', content: '中长发(锁骨至胸部)', sort_order: 2 },
      { action_type: 'bang_type', content: '空气刘海(缩短脸长)', sort_order: 3 },
      { action_type: 'reason', content: '长脸约会宜刘海缩短脸型,空气刘海浪漫,蓬松卷发增加脸宽,约会柔美', sort_order: 4 },
    ],
  },
  {
    name: '男-休闲-发型', gender: '男', category: '发型', scenario: '休闲',
    desc: '男士休闲发型:自然清爽',
    conds: stdConds('男', 'hairstyle', '休闲'),
    acts: [
      { action_type: '发型', content: '自然短发/碎盖头/中分微卷', sort_order: 1 },
      { action_type: 'hair_length', content: '短至中短(头顶自然)', sort_order: 2 },
      { action_type: 'technique', content: '自然蓬松,避免僵硬定型,清爽随性', sort_order: 3 },
      { action_type: 'reason', content: '男士休闲发型以自然清爽为主,碎盖头少年感,中分微卷时尚,无需复杂造型', sort_order: 4 },
    ],
  },
  {
    name: '男-面试-发型', gender: '男', category: '发型', scenario: '面试',
    desc: '男士面试发型:利落正式,精神稳重',
    conds: stdConds('男', 'hairstyle', '面试'),
    acts: [
      { action_type: '发型', content: '利落短发/侧分背头/寸头', sort_order: 1 },
      { action_type: 'hair_length', content: '短发(两侧铲短)', sort_order: 2 },
      { action_type: 'technique', content: '两侧铲短清爽,头顶定型整齐,避免凌乱', sort_order: 3 },
      { action_type: 'reason', content: '男士面试发型以利落正式为主,铲短两侧精神,背头稳重,传递专业干练形象', sort_order: 4 },
    ],
  },
];

// ============ 配饰补充(脸型/肤色维度) ============
const accessoryRules = [
  {
    name: '女-配饰-圆脸', gender: '女', category: '配饰', scenario: null,
    desc: '圆脸配饰:长耳坠拉长脸型',
    conds: stdConds('女', 'accessory', null, [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '圆脸'), weight: 3 },
    ]),
    acts: [
      { action_type: 'earring_type', content: '长款耳坠/流苏耳环(拉长脸型)', sort_order: 1 },
      { action_type: 'necklace_type', content: 'V型吊坠项链(纵向延伸)', sort_order: 2 },
      { action_type: 'avoid', content: '大圆耳钉/短粗耳饰(显脸更圆)', sort_order: 3 },
      { action_type: 'reason', content: '圆脸宜长款耳坠拉长脸型,V型项链纵向延伸,避免圆形耳饰加重圆润感', sort_order: 4 },
    ],
  },
  {
    name: '女-配饰-方脸', gender: '女', category: '配饰', scenario: null,
    desc: '方脸配饰:圆润耳饰柔化棱角',
    conds: stdConds('女', 'accessory', null, [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '方脸'), weight: 3 },
    ]),
    acts: [
      { action_type: 'earring_type', content: '圆润耳环/水滴耳坠(柔化棱角)', sort_order: 1 },
      { action_type: 'necklace_type', content: '圆润吊坠项链(柔和曲线)', sort_order: 2 },
      { action_type: 'avoid', content: '方形/棱角分明耳饰(加重棱角)', sort_order: 3 },
      { action_type: 'reason', content: '方脸宜圆润耳饰柔化棱角,水滴耳坠柔和曲线,避免方形耳饰加重硬朗感', sort_order: 4 },
    ],
  },
  {
    name: '女-配饰-长脸', gender: '女', category: '配饰', scenario: null,
    desc: '长脸配饰:宽耳饰增加脸宽视觉',
    conds: stdConds('女', 'accessory', null, [
      { field: 'face_shape', operator: 'eq', value: cv('face_shape', '长脸'), weight: 3 },
    ]),
    acts: [
      { action_type: 'earring_type', content: '宽款耳钉/纽扣耳饰(增加脸宽)', sort_order: 1 },
      { action_type: 'necklace_type', content: '短项链/choker(横向截断拉长)', sort_order: 2 },
      { action_type: 'avoid', content: '超长耳坠(拉长脸型)', sort_order: 3 },
      { action_type: 'reason', content: '长脸宜宽款耳饰增加脸宽视觉,短项链横向截断缩短脸长,避免长耳坠', sort_order: 4 },
    ],
  },
  {
    name: '女-配饰-暖皮', gender: '女', category: '配饰', scenario: null,
    desc: '暖皮配饰:金色金属,温暖显白',
    conds: stdConds('女', 'accessory', null, [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '暖皮'), weight: 3 },
    ]),
    acts: [
      { action_type: 'metal_color', content: '金色/玫瑰金(温暖显白)', sort_order: 1 },
      { action_type: 'earring_type', content: '金色金属耳饰/珍珠耳钉', sort_order: 2 },
      { action_type: 'necklace_type', content: '金色细链/玫瑰金吊坠', sort_order: 3 },
      { action_type: 'avoid', content: '冷白银色(显暗沉)', sort_order: 4 },
      { action_type: 'reason', content: '暖皮宜金色玫瑰金暖调金属,温暖显白提气色,银色冷调会显暗沉', sort_order: 5 },
    ],
  },
  {
    name: '女-配饰-冷皮', gender: '女', category: '配饰', scenario: null,
    desc: '冷皮配饰:银色金属,清冷显白',
    conds: stdConds('女', 'accessory', null, [
      { field: 'skin_tone', operator: 'eq', value: cv('skin_tone', '冷皮'), weight: 3 },
    ]),
    acts: [
      { action_type: 'metal_color', content: '银色/白金(清冷显白)', sort_order: 1 },
      { action_type: 'earring_type', content: '银色金属耳饰/珍珠耳钉', sort_order: 2 },
      { action_type: 'necklace_type', content: '银色细链/白金吊坠', sort_order: 3 },
      { action_type: 'avoid', content: '金色(显黄暗沉)', sort_order: 4 },
      { action_type: 'reason', content: '冷皮宜银色白金冷调金属,清冷显白提气色,金色暖调会显黄暗沉', sort_order: 5 },
    ],
  },
  {
    name: '男-休闲-配饰', gender: '男', category: '配饰', scenario: '休闲',
    desc: '男士休闲配饰:轻松有型',
    conds: stdConds('男', 'accessory', '休闲'),
    acts: [
      { action_type: 'watch', content: '运动表/帆布表带手表', sort_order: 1 },
      { action_type: 'bag_style', content: '帆布托特包/双肩包', sort_order: 2 },
      { action_type: 'belt', content: '帆布腰带/休闲皮带', sort_order: 3 },
      { action_type: 'metal_color', content: '银色/军色钢', sort_order: 4 },
      { action_type: 'reason', content: '男士休闲配饰以轻松有型为主,运动表帆布包休闲随性,舒适实用', sort_order: 5 },
    ],
  },
  {
    name: '男-面试-配饰', gender: '男', category: '配饰', scenario: '面试',
    desc: '男士面试配饰:简约稳重,专业得体',
    conds: stdConds('男', 'accessory', '面试'),
    acts: [
      { action_type: 'watch', content: '简约皮带手表/经典腕表', sort_order: 1 },
      { action_type: 'bag_style', content: '真皮公文包/简约电脑包', sort_order: 2 },
      { action_type: 'belt', content: '真皮黑色皮带(与鞋同色)', sort_order: 3 },
      { action_type: 'metal_color', content: '银色/低调钢色', sort_order: 4 },
      { action_type: 'reason', content: '男士面试配饰以简约稳重为主,皮带腕表专业,真皮公文包得体,传递信赖感', sort_order: 5 },
    ],
  },
];

// ============ 姿势补充(场景维度) ============
const postureRules = [
  {
    name: '女-聚会-姿势', gender: '女', category: '姿势', scenario: '聚会',
    desc: '女士聚会姿势:自信S曲线,吸睛有气场',
    conds: stdConds('女', 'posture', '聚会'),
    acts: [
      { action_type: 'pose_key', content: '自信S曲线+叉腰', sort_order: 1 },
      { action_type: 'upper_body', content: '一手叉腰凸显曲线,肩膀一高一低', sort_order: 2 },
      { action_type: 'lower_body', content: '交叉腿站,重心在后腿,前腿微弯', sort_order: 3 },
      { action_type: 'head_pose', content: '下巴微抬,眼神自信', sort_order: 4 },
      { action_type: 'expression', content: '自信微笑/慵懒表情', sort_order: 5 },
      { action_type: 'camera_hint', content: '略低角度仰拍,气场全开', sort_order: 6 },
      { action_type: 'reason', content: '聚会场合宜自信有气场,S曲线+叉腰凸显身材,微抬下巴显自信,仰拍气场全开', sort_order: 7 },
    ],
  },
  {
    name: '女-面试-姿势', gender: '女', category: '姿势', scenario: '面试',
    desc: '女士面试姿势:端庄挺拔,专业得体',
    conds: stdConds('女', 'posture', '面试'),
    acts: [
      { action_type: 'pose_key', content: '端庄挺拔+双手交叠', sort_order: 1 },
      { action_type: 'upper_body', content: '挺背收腹,双手交叠身前或轻放腿上', sort_order: 2 },
      { action_type: 'lower_body', content: '双腿并拢或斜并,膝盖贴近', sort_order: 3 },
      { action_type: 'head_pose', content: '头部正对,目光平视', sort_order: 4 },
      { action_type: 'expression', content: '自然微笑,眼神真诚', sort_order: 5 },
      { action_type: 'camera_hint', content: '平视正面拍摄,体现端庄专业', sort_order: 6 },
      { action_type: 'reason', content: '面试场合宜端庄得体,挺背双手交叠显专业,双腿并拢端庄,平视真诚传递信赖', sort_order: 7 },
    ],
  },
  {
    name: '男-聚会-姿势', gender: '男', category: '姿势', scenario: '聚会',
    desc: '男士聚会姿势:随性有型,自信从容',
    conds: stdConds('男', 'posture', '聚会'),
    acts: [
      { action_type: 'pose_key', content: '随性开立+单手插兜', sort_order: 1 },
      { action_type: 'upper_body', content: '挺胸开肩,单手插兜或持杯', sort_order: 2 },
      { action_type: 'lower_body', content: '双脚开立比肩宽,重心稳', sort_order: 3 },
      { action_type: 'head_pose', content: '微侧,下巴微抬显从容', sort_order: 4 },
      { action_type: 'expression', content: '自然微笑/从容表情', sort_order: 5 },
      { action_type: 'camera_hint', content: '平视或微仰,体现从容自信', sort_order: 6 },
      { action_type: 'reason', content: '男士聚会宜随性有型,开立插兜显从容,挺胸开肩自信,微仰显气场', sort_order: 7 },
    ],
  },
  {
    name: '男-面试-姿势', gender: '男', category: '姿势', scenario: '面试',
    desc: '男士面试姿势:端正稳重,专业可信',
    conds: stdConds('男', 'posture', '面试'),
    acts: [
      { action_type: 'pose_key', content: '端正坐姿+双手放桌', sort_order: 1 },
      { action_type: 'upper_body', content: '挺背收腹,双手轻握放桌面或扶手', sort_order: 2 },
      { action_type: 'lower_body', content: '双脚平放与肩同宽', sort_order: 3 },
      { action_type: 'head_pose', content: '头部正对,目光平视坚定', sort_order: 4 },
      { action_type: 'expression', content: '自然或微笑,眼神坚定', sort_order: 5 },
      { action_type: 'camera_hint', content: '平视正面,体现稳重可信', sort_order: 6 },
      { action_type: 'reason', content: '男士面试宜端正稳重,挺背双手放桌显专注,平视坚定传递专业可信形象', sort_order: 7 },
    ],
  },
];

// ============================================================
// 汇总插入
// ============================================================
const allRules = [...makeupRules, ...hairRules, ...accessoryRules, ...postureRules];
console.log(`[补充] 准备插入 ${allRules.length} 条规则`);

const insertGroup = db.prepare(`INSERT INTO rule_groups (name, mode, gender, category, scenario, description, priority, enabled, created_at) VALUES (?, 'store', ?, ?, ?, ?, ?, 1, datetime('now'))`);
const insertCond = db.prepare(`INSERT INTO rule_conditions (group_id, field, operator, value, weight) VALUES (?, ?, ?, ?, ?)`);
const insertAction = db.prepare(`INSERT INTO rule_actions (group_id, action_type, content, sort_order) VALUES (?, ?, ?, ?)`);

const tx = db.transaction((rules) => {
  for (const r of rules) {
    const res = insertGroup.run(r.name, r.gender, r.category, r.scenario, r.desc, 5);
    const gid = res.lastInsertRowid;
    for (const c of r.conds) insertCond.run(gid, c.field, c.operator, c.value, c.weight);
    for (const a of r.acts) insertAction.run(gid, a.action_type, a.content, a.sort_order);
  }
  return rules.length;
});

const n = tx(allRules);
console.log(`[完成] 插入 ${n} 条规则\n`);

// 验证类别分布
const cats = db.prepare("SELECT category, COUNT(*) c FROM rule_groups GROUP BY category ORDER BY c DESC").all();
console.log('=== 类别分布 ===');
cats.forEach(c => console.log(`  ${c.category}: ${c.c}条`));
const total = db.prepare('SELECT COUNT(*) c FROM rule_groups').get().c;
console.log(`  总计: ${total}条`);

process.exit(0);
