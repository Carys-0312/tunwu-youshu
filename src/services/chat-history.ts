/**
 * 管家聊天记录：按账号存在本机，切换账号互不可见。
 *
 * - 只存最近 40 条成功对话（pending / error 不落盘）；
 * - 不写数据库、不参与服务器同步，卸载或清缓存即消失；
 * - 登录态优先用当前账号 id，退出登录后沿用本机数据归属，
 *   游客统一放在 guest 下，避免把上一个账号的对话带给新账号。
 */

import { getSession } from './auth';
import { getLocalOwner } from './local-data-owner';
import {
  CHAT_HISTORY_LIMIT,
  normalizeChatHistory,
  type StoredChatMessage,
} from '@/utils/chat-history';

const KEY_PREFIX = 'chat_history_v1:';
const GUEST = 'guest';

export function chatOwner(): string {
  const session = getSession();
  if (session?.user?.id) return session.user.id;
  const owner = getLocalOwner();
  return owner || GUEST;
}

function keyFor(owner: string): string {
  return `${KEY_PREFIX}${owner}`;
}

export function loadChatHistory(owner = chatOwner()): StoredChatMessage[] {
  try {
    const raw = uni.getStorageSync(keyFor(owner));
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return normalizeChatHistory(parsed, CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveChatHistory(
  messages: StoredChatMessage[],
  owner = chatOwner(),
): void {
  try {
    const clean = normalizeChatHistory(messages, CHAT_HISTORY_LIMIT);
    if (clean.length === 0) {
      uni.removeStorageSync(keyFor(owner));
      return;
    }
    uni.setStorageSync(keyFor(owner), JSON.stringify(clean));
  } catch {
    // 存储不可用（隐私模式、空间不足）时只影响下次恢复，不影响本次对话
  }
}

export function clearChatHistory(owner = chatOwner()): void {
  try {
    uni.removeStorageSync(keyFor(owner));
  } catch {
    // ignore
  }
}
