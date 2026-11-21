/**
 * 囤物管家问答。库存只存在本地，所以每次提问都把一份精简快照带给服务端，
 * 服务端用 LangChain4j 的工具链查这份快照，不保存任何物品数据。
 */
import { API_BASE } from './api';
import type { InventoryRow } from '@/types/models';
import type { PetPersona } from '@/types/pet';
import { displayCategory } from '@/constants/categories';
import { daysBetween, todayISO } from '@/utils/date';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface InventoryPayload {
  today: string;
  items: Array<{
    name: string;
    category: string;
    quantity: number;
    unit: string;
    expiry: string | null;
    daysLeft: number | null;
    threshold: number;
    low: boolean;
    shared: boolean;
    storage: string | null;
    /** 入库到今天过了几天（今天入库为 0），用来回答「最近存了什么」 */
    addedDaysAgo: number;
  }>;
  weeklyConsumed: number;
  weeklyAdded: number;
}

function buildSnapshot(
  rows: InventoryRow[],
  weekly: { consumed: number; added: number },
): InventoryPayload {
  const today = todayISO();
  return {
    today,
    // 服务端也会截断，这里先截一次，避免把大库存整包发出去
    items: rows.slice(0, 300).map((row) => ({
      name: row.item.name,
      category: displayCategory(row.item),
      quantity: row.item.quantity,
      unit: row.item.unit,
      expiry: row.expiryDate,
      daysLeft: row.daysLeft,
      threshold: row.item.threshold,
      low: row.isLowStock,
      shared: row.item.is_shared === 1,
      storage: row.item.storage_text,
      // 入库日期在 created_at 里（YYYY-MM-DD HH:mm:ss），换算成「几天前」随快照带上
      addedDaysAgo: Math.max(0, daysBetween(row.item.created_at.slice(0, 10), today)),
    })),
    weeklyConsumed: weekly.consumed,
    weeklyAdded: weekly.added,
  };
}

interface RawResponse {
  status: number;
  body: string;
}

/** H5 和 App 都用 uni.request，省得两套实现 */
function post(url: string, data: unknown, who: string): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    uni.request({
      url,
      method: 'POST',
      data: data as any,
      header: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 45000,
      success: (res) => {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
        resolve({ status: res.statusCode ?? 0, body });
      },
      fail: () => reject(new Error(`连不上${who}，检查手机网络后再试`)),
    });
  });
}

/** 问一句，返回管家的话；失败抛中文错误给页面直接展示 */
export async function askAssistant(
  question: string,
  history: ChatTurn[],
  rows: InventoryRow[],
  weekly: { consumed: number; added: number },
  persona: PetPersona,
): Promise<string> {
  const who = persona?.name?.trim() || '管家';
  const res = await post(`${API_BASE}/api/assistant/chat`, {
    question,
    history: history.slice(-16),
    inventory: buildSnapshot(rows, weekly),
    persona: {
      name: persona?.name ?? '',
      personality: persona?.personality ?? 'gentle',
      custom: persona?.custom ?? '',
    },
  }, who);

  let parsed: { answer?: string; error?: string } | null = null;
  try {
    parsed = JSON.parse(res.body) as { answer?: string; error?: string };
  } catch {
    // 网关错误页之类的非 JSON，按状态码兜底
  }

  if (res.status >= 200 && res.status < 300) {
    const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : '';
    if (!answer) throw new Error(`${who}没返回内容，换个问法试试`);
    return answer;
  }

  if (parsed?.error) throw new Error(parsed.error);
  if (res.status === 503) throw new Error('服务端还没配置模型 Key');
  if (res.status === 400) throw new Error('问题格式不对，换个问法试试');
  throw new Error(`${who}出错了（${res.status}）`);
}
