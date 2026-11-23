/**
 * 管家聊天记录的纯函数部分：只做结构校验和截断，方便单元测试。
 *
 * 聊天记录只存在本机（uni storage），不上传服务器、不参与备份同步；
 * 结构校验失败时宁可直接丢掉，也不要把半截数据渲染到对话里。
 */

export type StoredChatRole = 'user' | 'assistant';

export interface StoredChatMessage {
  id: string;
  role: StoredChatRole;
  text: string;
  /** 仅 assistant：这条回答对应的提问，恢复后重试时用 */
  question?: string;
  /** 写入时间，恢复时保持原顺序 */
  at: number;
}

/** 最多保留 40 条（约 20 轮问答） */
export const CHAT_HISTORY_LIMIT = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把 storage 里读出来的任意值整理成可渲染的消息列表：
 * - 非数组、缺字段、角色不对、正文为空的一律丢掉；
 * - 同 id 只保留最后一条（避免坏数据造成重复 key）；
 * - 只保留最近 limit 条。
 */
export function normalizeChatHistory(raw: unknown, limit = CHAT_HISTORY_LIMIT): StoredChatMessage[] {
  if (!Array.isArray(raw) || limit <= 0) return [];

  const byId = new Map<string, StoredChatMessage>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = asText(item.id);
    const role = item.role;
    const text = typeof item.text === 'string' ? item.text : '';
    if (!id || (role !== 'user' && role !== 'assistant') || !text.trim()) continue;

    const message: StoredChatMessage = {
      id,
      role,
      text,
      at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : 0,
    };
    const question = asText(item.question);
    if (role === 'assistant' && question) message.question = question;

    // 后出现的同 id 覆盖前面的，Map 保留第一次插入的位置
    byId.set(id, message);
  }

  return Array.from(byId.values()).slice(-limit);
}
