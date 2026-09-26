/**
 * 星座运势服务模块
 * 从 Python app/services/horoscope_service.py 翻译
 */

const crypto = require('crypto')

// ============================================================
// 星座中文映射
// ============================================================
const ZODIAC_NAMES = {
  aries: '白羊座',
  taurus: '金牛座',
  gemini: '双子座',
  cancer: '巨蟹座',
  leo: '狮子座',
  virgo: '处女座',
  libra: '天秤座',
  scorpio: '天蝎座',
  sagittarius: '射手座',
  capricorn: '摩羯座',
  aquarius: '水瓶座',
  pisces: '双鱼座',
}

const ZODIAC_SIGNS = Object.keys(ZODIAC_NAMES)

// ============================================================
// 内置运势数据库（每个星座 7 套文案）
// ============================================================
const HOROSCOPE_DATA = {
  aries: [
    {
      mood: '精力充沛',
      lucky_color: '红色',
      lucky_number: 7,
      summary: '今天你的行动力满格，适合推进搁置已久的计划。贵人运强劲，主动出击会有惊喜。',
      suggestion: '穿搭中点缀一抹红色，能让你的气场全开，自信感爆棚。',
    },
    {
      mood: '热情如火',
      lucky_color: '橙色',
      lucky_number: 18,
      summary: '今天的人际关系格外顺畅，你的直率会赢得他人好感。感情上有突破的机会。',
      suggestion: '橙色系配饰能激活你的桃花运，让约会氛围更温暖。',
    },
    {
      mood: '斗志昂扬',
      lucky_color: '金色',
      lucky_number: 23,
      summary: '今天适合挑战新领域，你的勇气会带来意外收获。注意控制急躁情绪。',
      suggestion: '金色单品点缀，提升整体造型的贵气感，助力事业运。',
    },
    {
      mood: '神清气爽',
      lucky_color: '蓝色',
      lucky_number: 9,
      summary: '今天的思维特别清晰，适合处理复杂决策。与朋友聚会会带来灵感。',
      suggestion: '深蓝色穿搭让你更显沉稳，增强他人对你的信任感。',
    },
    {
      mood: '活力四射',
      lucky_color: '绿色',
      lucky_number: 33,
      summary: '今天的财运不错，有意外进账的机会。健康运良好，适合运动。',
      suggestion: '薄荷绿或森林绿单品，让你今天看起来格外清新有活力。',
    },
    {
      mood: '自信满满',
      lucky_color: '紫色',
      lucky_number: 11,
      summary: '今天的你在人群中格外耀眼，领导力得到展现。适合做公开演讲或汇报。',
      suggestion: '紫色系穿搭提升你的神秘气质，让整体造型更具高级感。',
    },
    {
      mood: '果敢决断',
      lucky_color: '酒红色',
      lucky_number: 42,
      summary: '今天的决断力超强，适合做重要决定。工作上有升职加薪的信号。',
      suggestion: '酒红色外套让你气场十足，职场穿搭的利器。',
    },
  ],
  taurus: [
    {
      mood: '平静祥和',
      lucky_color: '绿色',
      lucky_number: 6,
      summary: '今天的财运稳定，适合做长期投资规划。与家人相处融洽，家庭氛围温馨。',
      suggestion: '大地绿或墨绿穿搭，让你今天格外稳重踏实。',
    },
    {
      mood: '温和从容',
      lucky_color: '米色',
      lucky_number: 24,
      summary: '今天适合享受生活中的小确幸，一顿美食、一杯咖啡都能带来满足感。',
      suggestion: '米色系穿搭温柔百搭，凸显你优雅知性的一面。',
    },
    {
      mood: '踏实稳健',
      lucky_color: '棕色',
      lucky_number: 15,
      summary: '今天的工作运稳定，适合处理细节性任务。感情上需要多表达。',
      suggestion: '棕色系穿搭让你看起来更可靠，增加他人的信赖感。',
    },
    {
      mood: '富足丰盛',
      lucky_color: '金色',
      lucky_number: 36,
      summary: '今天的财运亮眼，有加薪或意外之财的机会。注意理财规划。',
      suggestion: '金色配饰点缀棕色系穿搭，低调中彰显品味。',
    },
    {
      mood: '感官敏锐',
      lucky_color: '粉色',
      lucky_number: 8,
      summary: '今天对美的事物格外敏感，适合逛街购物或参观艺术展。感情甜蜜。',
      suggestion: '柔和粉色系穿搭让你看起来温柔可人，桃花运UP。',
    },
    {
      mood: '耐心十足',
      lucky_color: '藏青色',
      lucky_number: 27,
      summary: '今天的耐心让你在复杂事务中游刃有余。适合处理需要细心的工作。',
      suggestion: '藏青色穿搭显气质又显瘦，是今天的最佳选择。',
    },
    {
      mood: '知足常乐',
      lucky_color: '鹅黄色',
      lucky_number: 19,
      summary: '今天适合放慢脚步，享受当下。与老友相聚会带来温暖回忆。',
      suggestion: '鹅黄色单品让整体造型明亮起来，心情也跟着愉悦。',
    },
  ],
  gemini: [
    {
      mood: '创意满满',
      lucky_color: '黄色',
      lucky_number: 5,
      summary: '今天的思维敏捷，灵感源源不断。适合写作、演讲或头脑风暴。',
      suggestion: '明黄色穿搭让你今天格外亮眼，创意能量全开。',
    },
    {
      mood: '机智灵动',
      lucky_color: '银色',
      lucky_number: 14,
      summary: '今天的社交运爆棚，你的幽默感会成为焦点。注意言行分寸。',
      suggestion: '银色配饰增添未来感，让你在人群中脱颖而出。',
    },
    {
      mood: '好奇旺盛',
      lucky_color: '薄荷绿',
      lucky_number: 22,
      summary: '今天适合学习新知识，你的吸收能力超强。短途旅行会有惊喜。',
      suggestion: '薄荷绿穿搭清新活泼，凸显你的少女感/少年感。',
    },
    {
      mood: '表达顺畅',
      lucky_color: '天蓝色',
      lucky_number: 31,
      summary: '今天的沟通运极佳，适合谈判、面试或重要对话。感情表达清晰。',
      suggestion: '天蓝色穿搭让你看起来清爽又可信，沟通更顺利。',
    },
    {
      mood: '思维活跃',
      lucky_color: '橙色',
      lucky_number: 13,
      summary: '今天的多任务处理能力超强，但要注意专注度。社交活动丰富。',
      suggestion: '橙色系穿搭活力满满，匹配你今天的活跃状态。',
    },
    {
      mood: '灵活多变',
      lucky_color: '紫色',
      lucky_number: 28,
      summary: '今天的应变能力一流，突发状况难不倒你。有出差或外出的机会。',
      suggestion: '紫色系穿搭提升灵气，让你今天更具魅力。',
    },
    {
      mood: '口才出众',
      lucky_color: '珊瑚色',
      lucky_number: 17,
      summary: '今天适合公开表达，你的观点会得到认可。感情上有浪漫邂逅。',
      suggestion: '珊瑚色穿搭温柔又亮眼，让你今天格外迷人。',
    },
  ],
  cancer: [
    {
      mood: '温柔细腻',
      lucky_color: '银色',
      lucky_number: 2,
      summary: '今天的直觉敏锐，相信第一感觉。家庭事务需要你关注，温馨时光在等你。',
      suggestion: '银色配饰点缀，让你今天更显温柔细腻。',
    },
    {
      mood: '情感丰沛',
      lucky_color: '白色',
      lucky_number: 20,
      summary: '今天的感情运不错，单身者有桃花信号。与家人相处格外温馨。',
      suggestion: '白色系穿搭纯净温柔，让你今天像月光般皎洁。',
    },
    {
      mood: '顾家情怀',
      lucky_color: '浅蓝色',
      lucky_number: 11,
      summary: '今天适合处理家庭事务，或与久未联系的亲友叙旧。财运稳定。',
      suggestion: '浅蓝色穿搭让你看起来安宁柔和，家庭氛围更和谐。',
    },
    {
      mood: '安全感足',
      lucky_color: '米色',
      lucky_number: 26,
      summary: '今天适合宅家放松，整理心情。工作上会有小确幸，别急于求成。',
      suggestion: '米色系穿搭带来温暖包裹感，让你今天倍感安心。',
    },
    {
      mood: '怀旧温情',
      lucky_color: '珍珠白',
      lucky_number: 7,
      summary: '今天适合回顾过去，整理旧物或照片会有新感悟。老朋友可能联系你。',
      suggestion: '珍珠配饰点缀，让你今天散发柔和光泽。',
    },
    {
      mood: '直觉敏锐',
      lucky_color: '海蓝色',
      lucky_number: 35,
      summary: '今天的第六感超强，做决定时相信直觉。投资理财需谨慎。',
      suggestion: '海蓝色穿搭呼应你的星座属性，增强内在力量。',
    },
    {
      mood: '关怀体贴',
      lucky_color: '粉色',
      lucky_number: 16,
      summary: '今天你对他人的关怀会得到回报。感情上适合表达爱意。',
      suggestion: '粉色系穿搭让你看起来更柔软可亲，人际关系更融洽。',
    },
  ],
  leo: [
    {
      mood: '王者风范',
      lucky_color: '金色',
      lucky_number: 1,
      summary: '今天的你气场全开，适合站在聚光灯下。事业运强劲，有表现机会。',
      suggestion: '金色系穿搭或配饰，让你今天成为全场焦点。',
    },
    {
      mood: '热情奔放',
      lucky_color: '红色',
      lucky_number: 19,
      summary: '今天的魅力无法挡，桃花运旺盛。社交场合你是最亮眼的存在。',
      suggestion: '正红色穿搭大胆抢眼，匹配你今天的自信状态。',
    },
    {
      mood: '光芒四射',
      lucky_color: '橙色',
      lucky_number: 28,
      summary: '今天的创造力爆棚，适合艺术创作或策划活动。贵人运强。',
      suggestion: '橙色系穿搭让你今天格外耀眼，自带光芒。',
    },
    {
      mood: '自信闪耀',
      lucky_color: '亮黄色',
      lucky_number: 10,
      summary: '今天适合展示才华，你的努力会得到认可。感情上主动出击。',
      suggestion: '亮黄色单品点亮整体造型，让你今天闪闪发光。',
    },
    {
      mood: '慷慨大方',
      lucky_color: '紫色',
      lucky_number: 33,
      summary: '今天适合与朋友聚会，你的慷慨会赢得人心。财运上有小惊喜。',
      suggestion: '紫色系穿搭彰显王者气质，让你今天格外有气场。',
    },
    {
      mood: '英勇无畏',
      lucky_color: '酒红色',
      lucky_number: 21,
      summary: '今天适合挑战困难任务，你的勇气会带来突破。领导力得到展现。',
      suggestion: '酒红色穿搭气场十足，让你今天更具领导风范。',
    },
    {
      mood: '骄傲耀眼',
      lucky_color: '玫瑰金',
      lucky_number: 44,
      summary: '今天的你格外迷人，适合拍照留念。事业上会有升迁信号。',
      suggestion: '玫瑰金配饰让你今天散发迷人光泽，好感度满格。',
    },
  ],
  virgo: [
    {
      mood: '细致入微',
      lucky_color: '藏青色',
      lucky_number: 4,
      summary: '今天的分析能力一流，适合处理数据或细节工作。健康运良好。',
      suggestion: '藏青色穿搭让你今天更显专业沉稳，工作效率倍增。',
    },
    {
      mood: '完美主义',
      lucky_color: '白色',
      lucky_number: 23,
      summary: '今天对细节的要求会带来好评。感情上别太挑剔，多包容。',
      suggestion: '白色系穿搭简洁干净，凸显你追求完美的气质。',
    },
    {
      mood: '理性冷静',
      lucky_color: '灰色',
      lucky_number: 12,
      summary: '今天的判断力准确，适合做重要决策。理财运不错，适合规划。',
      suggestion: '灰色系穿搭高级又克制，让你今天更具智慧感。',
    },
    {
      mood: '专注高效',
      lucky_color: '深绿色',
      lucky_number: 30,
      summary: '今天的工作效率超高，能完成大量任务。注意劳逸结合。',
      suggestion: '深绿色穿搭让你今天沉稳专注，助力高效工作。',
    },
    {
      mood: '整洁有序',
      lucky_color: '米色',
      lucky_number: 8,
      summary: '今天适合整理收纳，无论是工作还是生活。感情上需要主动。',
      suggestion: '米色系穿搭简约大方，彰显你的精致品味。',
    },
    {
      mood: '谨慎细心',
      lucky_color: '棕色',
      lucky_number: 17,
      summary: '今天的细心让你避开陷阱。工作中会发现别人忽略的问题。',
      suggestion: '棕色系穿搭低调内敛，让你今天更显可靠。',
    },
    {
      mood: '谦逊有礼',
      lucky_color: '浅蓝色',
      lucky_number: 26,
      summary: '今天的谦逊会赢得贵人相助。社交场合你给人留下好印象。',
      suggestion: '浅蓝色穿搭让你今天更显温和有礼，人缘倍增。',
    },
  ],
  libra: [
    {
      mood: '优雅平衡',
      lucky_color: '粉色',
      lucky_number: 6,
      summary: '今天的审美在线，适合购物或搭配造型。人际关系和谐融洽。',
      suggestion: '粉色系穿搭温柔优雅，让你今天更具魅力。',
    },
    {
      mood: '和谐愉悦',
      lucky_color: '浅绿色',
      lucky_number: 15,
      summary: '今天的社交运不错，你的调解能力会派上用场。感情甜蜜。',
      suggestion: '浅绿色穿搭清新自然，让你今天给人舒适感觉。',
    },
    {
      mood: '魅力四射',
      lucky_color: '玫瑰色',
      lucky_number: 24,
      summary: '今天的桃花运旺盛，单身者有机会遇到心仪对象。人缘好。',
      suggestion: '玫瑰色穿搭浪漫迷人，让你今天桃花运满分。',
    },
    {
      mood: '公正客观',
      lucky_color: '蓝色',
      lucky_number: 33,
      summary: '今天适合处理纠纷或谈判，你的公正会得到认可。决策力强。',
      suggestion: '蓝色系穿搭让你今天更显理性公正，增强说服力。',
    },
    {
      mood: '艺术灵感',
      lucky_color: '薰衣草紫',
      lucky_number: 9,
      summary: '今天的艺术感强，适合参观展览或创作。审美判断准确。',
      suggestion: '薰衣草紫穿搭高级又浪漫，凸显你的艺术品味。',
    },
    {
      mood: '社交达人',
      lucky_color: '香槟色',
      lucky_number: 18,
      summary: '今天的社交活动丰富，你的魅力会结识新朋友。贵人运强。',
      suggestion: '香槟色穿搭优雅高贵，让你今天在社交场合大放异彩。',
    },
    {
      mood: '从容不迫',
      lucky_color: '象牙白',
      lucky_number: 27,
      summary: '今天的你心态平和，处理事务游刃有余。感情稳定发展。',
      suggestion: '象牙白穿搭温润如玉，让你今天散发从容气质。',
    },
  ],
  scorpio: [
    {
      mood: '神秘深邃',
      lucky_color: '黑色',
      lucky_number: 8,
      summary: '今天的洞察力超强，能看透事物本质。适合研究或调查类工作。',
      suggestion: '黑色系穿搭神秘酷感，让你今天气场十足。',
    },
    {
      mood: '热情深沉',
      lucky_color: '酒红色',
      lucky_number: 21,
      summary: '今天的感情运浓烈，适合深入交流。工作中会有突破性进展。',
      suggestion: '酒红色穿搭让你今天散发迷人魅力，神秘又性感。',
    },
    {
      mood: '意志坚定',
      lucky_color: '深紫色',
      lucky_number: 13,
      summary: '今天的意志力强，适合坚持长期目标。财运上有意外收获。',
      suggestion: '深紫色穿搭神秘高贵，让你今天更具气场。',
    },
    {
      mood: '直觉敏锐',
      lucky_color: '暗红色',
      lucky_number: 36,
      summary: '今天的第六感准得惊人，相信直觉做决定。注意保护隐私。',
      suggestion: '暗红色系穿搭低调奢华，凸显你的神秘气质。',
    },
    {
      mood: '专注投入',
      lucky_color: '墨绿色',
      lucky_number: 4,
      summary: '今天的专注力超强，适合深度工作。感情上需要多沟通。',
      suggestion: '墨绿色穿搭沉稳深邃，让你今天更显内敛有料。',
    },
    {
      mood: '魅力难挡',
      lucky_color: '深蓝色',
      lucky_number: 29,
      summary: '今天的个人魅力爆棚，异性缘佳。工作中会有贵人相助。',
      suggestion: '深蓝色穿搭既神秘又稳重，让你今天魅力难挡。',
    },
    {
      mood: '决断有力',
      lucky_color: '黑红色',
      lucky_number: 17,
      summary: '今天的决断力强，适合处理棘手问题。注意控制情绪。',
      suggestion: '黑红配色穿搭酷感十足，让你今天气场全开。',
    },
  ],
  sagittarius: [
    {
      mood: '自由奔放',
      lucky_color: '蓝色',
      lucky_number: 3,
      summary: '今天适合出行或尝试新鲜事物。乐观心态会带来好运。',
      suggestion: '蓝色系穿搭让你今天格外清爽，像天空一样自由。',
    },
    {
      mood: '乐观开朗',
      lucky_color: '橙色',
      lucky_number: 21,
      summary: '今天的正能量满满，你的乐观会感染他人。社交运佳。',
      suggestion: '橙色穿搭活力四射，匹配你今天的阳光状态。',
    },
    {
      mood: '冒险精神',
      lucky_color: '红色',
      lucky_number: 12,
      summary: '今天适合挑战自我，尝试新领域。旅行运不错。',
      suggestion: '红色系穿搭大胆热情，让你今天充满冒险勇气。',
    },
    {
      mood: '豁达开朗',
      lucky_color: '绿色',
      lucky_number: 30,
      summary: '今天的心态豁达，不计较小事会带来好运。财运稳定。',
      suggestion: '绿色系穿搭清新自然，让你今天心情舒畅。',
    },
    {
      mood: '智慧闪耀',
      lucky_color: '紫色',
      lucky_number: 9,
      summary: '今天的求知欲强，适合学习或深造。哲学思考带来启发。',
      suggestion: '紫色系穿搭提升灵性，让你今天更具智慧光芒。',
    },
    {
      mood: '热情似火',
      lucky_color: '亮黄色',
      lucky_number: 27,
      summary: '今天的热情会带动周围人，适合组织活动。桃花运旺。',
      suggestion: '亮黄色穿搭让你今天格外耀眼，活力满满。',
    },
    {
      mood: '探索未知',
      lucky_color: '青色',
      lucky_number: 18,
      summary: '今天适合探索新领域，好奇心会带来机遇。注意安全。',
      suggestion: '青色穿搭独特亮眼，匹配你今天的探索精神。',
    },
  ],
  capricorn: [
    {
      mood: '稳健踏实',
      lucky_color: '黑色',
      lucky_number: 8,
      summary: '今天的事业运强劲，适合推进重要项目。耐心会有回报。',
      suggestion: '黑色系穿搭专业干练，让你今天更具职场气场。',
    },
    {
      mood: '目标明确',
      lucky_color: '深灰色',
      lucky_number: 22,
      summary: '今天的规划能力强，适合制定长期目标。财运稳定上升。',
      suggestion: '深灰色穿搭高级内敛，凸显你的专业素养。',
    },
    {
      mood: '坚韧不拔',
      lucky_color: '棕色',
      lucky_number: 14,
      summary: '今天的毅力强，困难面前不退缩。工作上会有突破。',
      suggestion: '棕色系穿搭踏实稳重，让你今天更显可靠。',
    },
    {
      mood: '务实高效',
      lucky_color: '藏青色',
      lucky_number: 31,
      summary: '今天的效率超高，适合处理积压工作。注意身体休息。',
      suggestion: '藏青色穿搭沉稳大气，助力你今天高效工作。',
    },
    {
      mood: '雄心勃勃',
      lucky_color: '深红色',
      lucky_number: 5,
      summary: '今天的野心驱动你前进，适合争取晋升机会。贵人运佳。',
      suggestion: '深红色穿搭彰显野心与实力，让你今天气场强大。',
    },
    {
      mood: '责任在肩',
      lucky_color: '墨绿色',
      lucky_number: 19,
      summary: '今天的责任感强，团队中你不可或缺。感情需要表达。',
      suggestion: '墨绿色穿搭稳重有深度，匹配你今天的担当。',
    },
    {
      mood: '稳重如山',
      lucky_color: '深蓝色',
      lucky_number: 38,
      summary: '今天适合做重大决策，你的判断稳重可靠。财运亨通。',
      suggestion: '深蓝色穿搭让你今天更显沉稳，决策更得心应手。',
    },
  ],
  aquarius: [
    {
      mood: '创意无限',
      lucky_color: '电光蓝',
      lucky_number: 4,
      summary: '今天的创新思维活跃，适合头脑风暴。科技相关事务顺利。',
      suggestion: '电光蓝穿搭未来感十足，匹配你今天的前卫气质。',
    },
    {
      mood: '特立独行',
      lucky_color: '银色',
      lucky_number: 17,
      summary: '今天的你与众不同，独立思考会带来突破。社交运独特。',
      suggestion: '银色系穿搭酷感前卫，让你今天脱颖而出。',
    },
    {
      mood: '理想主义',
      lucky_color: '紫色',
      lucky_number: 26,
      summary: '今天适合为社会理想付诸行动。人际关系中展现包容心。',
      suggestion: '紫色系穿搭神秘独特，彰显你的理想主义气质。',
    },
    {
      mood: '理性客观',
      lucky_color: '天蓝色',
      lucky_number: 9,
      summary: '今天的逻辑思维强，适合分析复杂问题。学习运不错。',
      suggestion: '天蓝色穿搭清爽理性，让你今天思维更清晰。',
    },
    {
      mood: '前卫开放',
      lucky_color: '荧光绿',
      lucky_number: 33,
      summary: '今天接受新事物的能力强，适合尝试新科技或新理念。',
      suggestion: '荧光绿点缀穿搭大胆前卫，匹配你的创新精神。',
    },
    {
      mood: '人道关怀',
      lucky_color: '青色',
      lucky_number: 11,
      summary: '今天适合参与公益活动或团队协作。你的善举会有回响。',
      suggestion: '青色穿搭独特又温和，让你今天散发人文气息。',
    },
    {
      mood: '思维跳跃',
      lucky_color: '霓虹粉',
      lucky_number: 28,
      summary: '今天的灵感闪现多，记得记录下来。感情上有惊喜。',
      suggestion: '霓虹粉点缀穿搭个性十足，让你今天格外吸睛。',
    },
  ],
  pisces: [
    {
      mood: '温柔梦幻',
      lucky_color: '海蓝色',
      lucky_number: 7,
      summary: '今天的直觉敏锐，艺术灵感丰富。适合创作或冥想。',
      suggestion: '海蓝色穿搭梦幻浪漫，呼应你的星座气质。',
    },
    {
      mood: '感性丰富',
      lucky_color: '粉色',
      lucky_number: 16,
      summary: '今天的感情运甜蜜，单身者有浪漫邂逅。多表达爱意。',
      suggestion: '粉色系穿搭温柔浪漫，让你今天桃花运满分。',
    },
    {
      mood: '艺术灵感',
      lucky_color: '薰衣草紫',
      lucky_number: 25,
      summary: '今天的创造力强，适合艺术创作。音乐或绘画能带来平静。',
      suggestion: '薰衣草紫穿搭梦幻唯美，激发你的艺术灵感。',
    },
    {
      mood: '善解人意',
      lucky_color: '珍珠白',
      lucky_number: 3,
      summary: '今天的同理心强，朋友会向你倾诉。注意保护自己情绪。',
      suggestion: '珍珠白穿搭温柔纯净，让你今天散发柔和光芒。',
    },
    {
      mood: '浪漫多情',
      lucky_color: '玫瑰金',
      lucky_number: 29,
      summary: '今天的浪漫指数高，适合约会或表白。感情发展顺利。',
      suggestion: '玫瑰金配饰让你今天浪漫迷人，桃花朵朵开。',
    },
    {
      mood: '直觉超准',
      lucky_color: '湖绿色',
      lucky_number: 12,
      summary: '今天的第六感准，做决定相信直觉。财运上有小惊喜。',
      suggestion: '湖绿色穿搭清新梦幻，让你今天更具灵气。',
    },
    {
      mood: '想象丰富',
      lucky_color: '浅紫色',
      lucky_number: 34,
      summary: '今天想象力丰富，适合创意工作。注意区分现实与幻想。',
      suggestion: '浅紫色穿搭梦幻仙气，让你今天格外温柔。',
    },
  ],
}

// 内存缓存: {(zodiac_sign, date_str): result}
const cache = new Map()

/** 获取今日星座运势 */
function getDailyHoroscope(zodiacSign) {
  if (!zodiacSign) {
    const idx = Math.floor(Math.random() * ZODIAC_SIGNS.length)
    zodiacSign = ZODIAC_SIGNS[idx]
  }
  zodiacSign = zodiacSign.toLowerCase().trim()

  if (!ZODIAC_NAMES[zodiacSign]) {
    throw new Error(`无效的星座标识: ${zodiacSign}`)
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const cacheKey = `${zodiacSign}_${todayStr}`

  const cached = cache.get(cacheKey)
  if (cached) return cached

  const baseData = getBaseHoroscope(zodiacSign, todayStr)
  const result = {
    zodiac_sign: zodiacSign,
    zodiac_name: ZODIAC_NAMES[zodiacSign],
    mood: baseData.mood,
    lucky_color: baseData.lucky_color,
    lucky_number: baseData.lucky_number,
    summary: baseData.summary,
    suggestion: baseData.suggestion,
  }

  // 如有 LLM API Key，可调用 LLM 增强文案（简化版暂不实现）
  // const llmApiKey = process.env.LLM_API_KEY
  // if (llmApiKey) { ... }

  cache.set(cacheKey, result)
  return result
}

/** 获取所有 12 星座今日运势概要 */
function getAllHoroscopesBrief() {
  const briefList = []
  for (const sign of ZODIAC_SIGNS) {
    try {
      const full = getDailyHoroscope(sign)
      briefList.push({
        zodiac_sign: full.zodiac_sign,
        zodiac_name: full.zodiac_name,
        mood: full.mood,
        lucky_color: full.lucky_color,
      })
    } catch (e) {
      console.warn(`[星座运势] 获取 ${sign} 概要失败:`, e.message)
    }
  }
  return briefList
}

/** 根据日期 hash 从内置数据库选择运势文案 */
function getBaseHoroscope(zodiacSign, todayStr) {
  const dataList = HOROSCOPE_DATA[zodiacSign] || HOROSCOPE_DATA.aries
  const hashStr = `${zodiacSign}_${todayStr}`
  const hashVal = parseInt(crypto.createHash('md5').update(hashStr).digest('hex'), 16)
  const index = hashVal % dataList.length
  return dataList[index]
}

/** 清空缓存 */
function clearCache() {
  const count = cache.size
  cache.clear()
  return count
}

module.exports = {
  ZODIAC_NAMES,
  ZODIAC_SIGNS,
  getDailyHoroscope,
  getAllHoroscopesBrief,
  clearCache,
}
