import { describe, expect, it } from 'vitest';
import { CHAT_HISTORY_LIMIT, normalizeChatHistory } from './chat-history';

function message(id: string, text = '内容', role: 'user' | 'assistant' = 'user') {
  return { id, role, text, at: 1 };
}

describe('normalizeChatHistory', () => {
  it('非数组或空数组返回空列表', () => {
    expect(normalizeChatHistory(null)).toEqual([]);
    expect(normalizeChatHistory('oops')).toEqual([]);
    expect(normalizeChatHistory({ id: 'm1' })).toEqual([]);
    expect(normalizeChatHistory([])).toEqual([]);
  });

  it('丢掉缺字段、角色不对和正文为空的条目', () => {
    const result = normalizeChatHistory([
      null,
      'bad',
      { text: '没有 id' },
      { id: 'm1', role: 'system', text: '角色不对' },
      { id: 'm2', role: 'user', text: '   ' },
      { id: 'm3', role: 'assistant', text: '有效回答' },
    ]);
    expect(result).toEqual([{ id: 'm3', role: 'assistant', text: '有效回答', at: 0 }]);
  });

  it('保留 assistant 的 question，user 的 question 丢弃', () => {
    const result = normalizeChatHistory([
      { id: 'm1', role: 'user', text: '牛奶还剩多少', question: '不该保留', at: 5 },
      { id: 'm2', role: 'assistant', text: '还剩 3 盒', question: '牛奶还剩多少', at: 6 },
    ]);
    expect(result[0]).not.toHaveProperty('question');
    expect(result[1].question).toBe('牛奶还剩多少');
  });

  it('同 id 只保留最后一条，并保持首次出现的位置', () => {
    const result = normalizeChatHistory([
      message('m1', '旧内容'),
      message('m2', '第二条'),
      message('m1', '新内容'),
    ]);
    expect(result.map((item) => item.text)).toEqual(['新内容', '第二条']);
  });

  it('只保留最近 limit 条', () => {
    const raw = Array.from({ length: 12 }, (_, index) => message(`m${index + 1}`, `第 ${index + 1} 条`));
    const result = normalizeChatHistory(raw, 5);
    expect(result).toHaveLength(5);
    expect(result[0].text).toBe('第 8 条');
    expect(result[4].text).toBe('第 12 条');
  });

  it('默认上限是 40 条', () => {
    const raw = Array.from({ length: CHAT_HISTORY_LIMIT + 5 }, (_, index) =>
      message(`m${index + 1}`),
    );
    expect(normalizeChatHistory(raw)).toHaveLength(CHAT_HISTORY_LIMIT);
  });

  it('at 不是有限数字时兜底为 0', () => {
    const result = normalizeChatHistory([
      { id: 'm1', role: 'user', text: '内容', at: 'x' },
      { id: 'm2', role: 'user', text: '内容', at: Number.NaN },
      { id: 'm3', role: 'user', text: '内容', at: 123 },
    ]);
    expect(result.map((item) => item.at)).toEqual([0, 0, 123]);
  });
});
