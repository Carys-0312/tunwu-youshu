import { describe, expect, it } from 'vitest';
import { displayCategory } from '@/constants/categories';
import { categoryArt, categoryEmoji, itemEmoji } from './item-visual';

describe('itemEmoji', () => {
  it('最长关键词优先，避免短词误匹配', () => {
    expect(itemEmoji('全麦面包', '食品')).toBe('🍞');
    expect(itemEmoji('珍珠奶茶', '饮品')).toBe('🧋');
    expect(itemEmoji('保湿面膜', '日用品')).toBe('🧴');
    expect(itemEmoji('纯牛奶', '饮品')).toBe('🥛');
  });

  it('没有关键词时按分类兜底', () => {
    expect(itemEmoji('未知物品', '药品')).toBe('💊');
    expect(itemEmoji('未知物品', '不存在的分类')).toBe('📦');
    expect(itemEmoji('', '其他')).toBe('📦');
  });
});

describe('categoryEmoji / categoryArt', () => {
  it('已知分类返回对应图标，未知分类回退', () => {
    expect(categoryEmoji('冷冻')).toBe('🧊');
    expect(categoryEmoji('不存在')).toBe('📦');
    expect(categoryArt('饮品')).toBe('/static/art/cat-drink.svg');
    expect(categoryArt('不存在')).toBe('/static/art/cat-other.svg');
  });
});

describe('displayCategory', () => {
  it('新数据直接用分类', () => {
    expect(displayCategory({ category: '冷冻', storage_text: null })).toBe('冷冻');
    expect(displayCategory({ category: '饮品', storage_text: '常温' })).toBe('饮品');
  });

  it('旧数据的冷冻储存说明归到冷冻', () => {
    expect(displayCategory({ category: '食品', storage_text: '冷冻保存' })).toBe('冷冻');
    expect(displayCategory({ category: '水果', storage_text: '-18℃ 冰冻' })).toBe('冷冻');
  });

  it('空分类回退到其他', () => {
    expect(displayCategory({ category: '', storage_text: null })).toBe('其他');
  });
});
