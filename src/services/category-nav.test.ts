import { afterEach, describe, expect, it } from 'vitest';
import {
  isKnownCategory,
  normalizeCategoryName,
  rememberCategoryTarget,
  takeCategoryTarget,
} from './category-nav';

describe('normalizeCategoryName', () => {
  it('普通中文和空白', () => {
    expect(normalizeCategoryName('饮品')).toBe('饮品');
    expect(normalizeCategoryName('  饮品  ')).toBe('饮品');
    expect(normalizeCategoryName(null)).toBe('');
    expect(normalizeCategoryName(undefined)).toBe('');
  });

  it('单层和双层 percent 编码都能还原', () => {
    expect(normalizeCategoryName('%E9%A5%AE%E5%93%81')).toBe('饮品');
    expect(normalizeCategoryName(encodeURIComponent(encodeURIComponent('饮品')))).toBe('饮品');
  });

  it('UTF-8 被当成 Latin-1 的乱码也能还原', () => {
    const mojibake = String.fromCharCode(0xe9, 0xa5, 0xae, 0xe5, 0x93, 0x81);
    expect(normalizeCategoryName(mojibake)).toBe('饮品');
  });

  it('非法编码保持原样', () => {
    expect(normalizeCategoryName('%E9%A5')).toBe('%E9%A5');
    expect(normalizeCategoryName('测试')).toBe('测试');
  });
});

describe('isKnownCategory', () => {
  it('只认固定分类', () => {
    expect(isKnownCategory('饮品')).toBe(true);
    expect(isKnownCategory('冷冻')).toBe(true);
    expect(isKnownCategory('测试')).toBe(false);
  });
});

describe('rememberCategoryTarget / takeCategoryTarget', () => {
  afterEach(() => {
    takeCategoryTarget();
  });

  it('同一进程内带一次分类名', () => {
    rememberCategoryTarget('饮品');
    expect(takeCategoryTarget()).toBe('饮品');
    expect(takeCategoryTarget()).toBe('');
  });
});
