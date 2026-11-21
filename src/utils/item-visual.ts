/**
 * 没照片时的占位图：按名称关键词挑一个 emoji，挑不到就按种类兜底。
 * 演示数据和手填的物品没有实拍图，这样每种物品仍有各自的样子。
 */
const KEYWORD_ICONS: Array<{ keys: string[]; icon: string }> = [
  { keys: ['维生素', '维c'], icon: '🍊' },
  { keys: ['奶', '乳'], icon: '🥛' },
  { keys: ['洗面奶', '面膜', '护肤', '面霜', '乳液', '防晒', '精华', '身体乳'], icon: '🧴' },
  { keys: ['咖啡'], icon: '☕' },
  { keys: ['奶茶'], icon: '🧋' },
  { keys: ['茶'], icon: '🍵' },
  { keys: ['可乐', '汽水', '果汁', '饮料'], icon: '🥤' },
  { keys: ['水果', '苹果', '香蕉', '橙'], icon: '🍎' },
  { keys: ['矿泉水', '纯净水', '饮用水', '苏打水', '气泡水', '山泉'], icon: '💧' },
  { keys: ['薯片', '薯条', '饼干', '锅巴', '零食'], icon: '🍪' },
  { keys: ['泡面', '方便面', '面'], icon: '🍜' },
  { keys: ['水饺', '饺子', '馄饨', '汤圆', '速冻'], icon: '🥟' },
  { keys: ['虾', '鱼', '肉'], icon: '🍤' },
  { keys: ['冰淇', '雪糕', '冰棍'], icon: '🍦' },
  { keys: ['米', '饭'], icon: '🍚' },
  { keys: ['面包'], icon: '🍞' },
  { keys: ['巧克力'], icon: '🍫' },
  { keys: ['糖'], icon: '🍬' },
  { keys: ['药', '胶囊', '颗粒', '冲剂', '感冒', '片'], icon: '💊' },
  { keys: ['纸', '湿巾', '抽纸', '面巾', '卷纸'], icon: '🧻' },
  { keys: ['洗衣', '洗洁精', '清洁'], icon: '🧴' },
  { keys: ['口罩'], icon: '😷' },
  { keys: ['牙'], icon: '🪥' },
  { keys: ['洗发', '沐浴', '洗手', '香皂', '洗面皂', '皂'], icon: '🧼' },
  { keys: ['油', '酱油', '醋', '盐', '酱', '调味', '苹果醋'], icon: '🧂' },
  { keys: ['电池'], icon: '🔋' },
  { keys: ['充电', '数据线', '插头'], icon: '🔌' },
  { keys: ['灯'], icon: '💡' },
];

const CATEGORY_ICONS: Record<string, string> = {
  饮品: '🥤',
  水果: '🍎',
  食品: '🍱',
  冷冻: '🧊',
  药品: '💊',
  日用品: '🧴',
  调味: '🧂',
  数码: '🔌',
  其他: '📦',
};

/** 种类卡片用的图标，比如库存页上的分类入口 */
export function categoryEmoji(category: string): string {
  return CATEGORY_ICONS[category] || '📦';
}

/**
 * 分类卡片上的物资线稿：和登录页那排货箱同一套画风，
 * 比 emoji 更能撑住整页的暖色基调。
 */
const CATEGORY_ART: Record<string, string> = {
  饮品: '/static/art/cat-drink.svg',
  水果: '/static/art/cat-fruit.svg',
  食品: '/static/art/cat-food.svg',
  冷冻: '/static/art/cat-frozen.svg',
  药品: '/static/art/cat-medicine.svg',
  日用品: '/static/art/cat-daily.svg',
  调味: '/static/art/cat-seasoning.svg',
  数码: '/static/art/cat-digital.svg',
  其他: '/static/art/cat-other.svg',
};

export function categoryArt(category: string): string {
  return CATEGORY_ART[category] || CATEGORY_ART['其他'];
}

/**
 * 取最长的命中关键词，避免「面包」被「面」抢成面条、「奶茶」被「奶」抢成牛奶。
 * 长度相同才按关键词表的先后顺序取第一个。
 */
export function itemEmoji(name: string, category: string): string {
  const text = (name || '').toLowerCase();
  let icon = '';
  let bestLength = 0;
  for (const entry of KEYWORD_ICONS) {
    for (const key of entry.keys) {
      if (key.length > bestLength && text.includes(key)) {
        icon = entry.icon;
        bestLength = key.length;
      }
    }
  }
  return icon || CATEGORY_ICONS[category] || '📦';
}
