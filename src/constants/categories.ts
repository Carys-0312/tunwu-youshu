import type { Item } from '@/types/models';

/** 固定分类，AI 只能从这些里选，避免库存分类碎片化 */
export const CATEGORIES = [
  '饮品',
  '水果',
  '食品',
  '冷冻',
  '药品',
  '日用品',
  '调味',
  '数码',
  '其他',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** 库存页分类卡片的顺序，和入库分类保持一致 */
export const DISPLAY_CATEGORIES = CATEGORIES;

/** 兼容早期数据：这些分类配上冷冻储存说明时，仍显示到「冷冻」 */
const LEGACY_FROZEN_SOURCES: readonly string[] = ['食品', '饮品', '水果', '调味'];

/** 包装储存说明里出现这些字样，就归到「冷冻」 */
const FROZEN_PATTERN = /冷冻|速冻|冰冻|冻结|零下|[-−]\s*18/;

/**
 * 库存页展示分类。新数据直接存 category=冷冻；
 * 早期存成食品、但储存说明写了冷冻的数据，这里兜底显示到「冷冻」。
 */
export function displayCategory(item: Pick<Item, 'category' | 'storage_text'>): string {
  const category = item.category || '其他';
  if (category === '冷冻') return '冷冻';
  if (
    LEGACY_FROZEN_SOURCES.includes(category) &&
    item.storage_text &&
    FROZEN_PATTERN.test(item.storage_text)
  ) {
    return '冷冻';
  }
  return category;
}

const COMMON_UNITS = ['件', '盒', '瓶', '包', '袋', '罐', '支', '个'];

export { COMMON_UNITS };
