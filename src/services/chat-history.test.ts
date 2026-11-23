import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  session: { userId: null as string | null },
  owner: { value: null as string | null | undefined },
}));

vi.mock('./auth', () => ({
  getSession: () => (mocks.session.userId ? { user: { id: mocks.session.userId } } : null),
}));

vi.mock('./local-data-owner', () => ({
  getLocalOwner: () => mocks.owner.value,
}));

(globalThis as unknown as { uni: unknown }).uni = {
  getStorageSync: (key: string) => mocks.storage.get(key) ?? '',
  setStorageSync: (key: string, value: string) => {
    mocks.storage.set(key, value);
  },
  removeStorageSync: (key: string) => {
    mocks.storage.delete(key);
  },
};

import { chatOwner, clearChatHistory, loadChatHistory, saveChatHistory } from './chat-history';

function message(id: string, text = '内容') {
  return { id, role: 'user' as const, text, at: 1 };
}

describe('chat-history storage', () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.session.userId = null;
    mocks.owner.value = undefined;
  });

  it('未登录且没有归属时使用 guest', () => {
    expect(chatOwner()).toBe('guest');
  });

  it('优先使用当前登录账号，退出后回落到本机归属', () => {
    mocks.session.userId = 'u1';
    expect(chatOwner()).toBe('u1');

    mocks.session.userId = null;
    mocks.owner.value = 'u2';
    expect(chatOwner()).toBe('u2');
  });

  it('不同账号的聊天记录互相不可见', () => {
    mocks.session.userId = 'u1';
    saveChatHistory([message('m1', 'u1 的对话')]);

    mocks.session.userId = 'u2';
    expect(loadChatHistory()).toEqual([]);

    saveChatHistory([message('m2', 'u2 的对话')]);
    mocks.session.userId = 'u1';
    expect(loadChatHistory()).toEqual([
      { id: 'm1', role: 'user', text: 'u1 的对话', at: 1 },
    ]);
  });

  it('保存时校验并截断，恢复时按原顺序', () => {
    mocks.session.userId = 'u1';
    const raw = Array.from({ length: 45 }, (_, index) => message(`m${index + 1}`, `第 ${index + 1} 条`));
    saveChatHistory([{ id: 'bad', role: 'system' as never, text: '坏数据', at: 1 }, ...raw]);

    const loaded = loadChatHistory();
    expect(loaded).toHaveLength(40);
    expect(loaded[0].text).toBe('第 6 条');
    expect(loaded[39].text).toBe('第 45 条');
  });

  it('清空只影响当前账号', () => {
    mocks.session.userId = 'u1';
    saveChatHistory([message('m1', 'u1')]);
    mocks.session.userId = 'u2';
    saveChatHistory([message('m2', 'u2')]);

    clearChatHistory();
    expect(loadChatHistory()).toEqual([]);

    mocks.session.userId = 'u1';
    expect(loadChatHistory()).toHaveLength(1);
  });

  it('存储为空时返回空列表', () => {
    mocks.session.userId = 'u1';
    expect(loadChatHistory()).toEqual([]);
  });
});
