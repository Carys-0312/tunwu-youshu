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

function buildPayload(
  question: string,
  history: ChatTurn[],
  rows: InventoryRow[],
  weekly: { consumed: number; added: number },
  persona: PetPersona,
): Record<string, unknown> {
  return {
    question,
    history: history.slice(-16),
    inventory: buildSnapshot(rows, weekly),
    persona: {
      name: persona?.name ?? '',
      personality: persona?.personality ?? 'gentle',
      custom: persona?.custom ?? '',
    },
  };
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
  const res = await post(`${API_BASE}/api/assistant/chat`,
    buildPayload(question, history, rows, weekly, persona), who);

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

/**
 * 流式问答：H5 用 fetch + SSE 逐字渲染；App 端暂不支持 SSE，
 * 回退到普通接口，一次性把完整回答交给 onDelta。
 */
export async function askAssistantStream(
  question: string,
  history: ChatTurn[],
  rows: InventoryRow[],
  weekly: { consumed: number; added: number },
  persona: PetPersona,
  onDelta: (text: string) => void,
): Promise<string> {
  const who = persona?.name?.trim() || '管家';
  const payload = buildPayload(question, history, rows, weekly, persona);

  // #ifdef H5
  let received = false;
  try {
    return await streamH5(payload, who, (delta) => {
      received = true;
      onDelta(delta);
    });
  } catch (err) {
    // 流式接口失败且一个字都没收到时，回退普通接口，避免用户看到空回答
    if (received) throw err;
    const answer = await askAssistant(question, history, rows, weekly, persona);
    onDelta(answer);
    return answer;
  }
  // #endif

  // #ifndef H5
  const answer = await askAssistant(question, history, rows, weekly, persona);
  onDelta(answer);
  return answer;
  // #endif
}

async function streamH5(
  payload: Record<string, unknown>,
  who: string,
  onDelta: (text: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/assistant/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`连不上${who}，检查网络后再试`);
  }

  if (!response.ok) {
    let message = '';
    try {
      const parsed = (await response.json()) as { error?: string };
      message = parsed?.error ?? '';
    } catch {
      // 非 JSON 错误页按状态码兜底
    }
    if (response.status === 429) throw new Error(message || '问得太快了，稍后再试');
    if (response.status === 503) throw new Error('服务端还没配置模型 Key');
    if (response.status === 400) throw new Error(message || '问题格式不对，换个问法试试');
    throw new Error(message || `${who}出错了（${response.status}）`);
  }
  if (!response.body) {
    throw new Error(`${who}没有返回流式内容，换个问法试试`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const data = dataLines.join('\n');
      if (!data) continue;

      if (event === 'delta') {
        try {
          const parsed = JSON.parse(data) as { text?: string };
          if (typeof parsed?.text === 'string' && parsed.text) {
            answer += parsed.text;
            onDelta(parsed.text);
          }
        } catch {
          // 单个坏 chunk 跳过，不中断整段回答
        }
      } else if (event === 'error') {
        let message = '';
        try {
          const parsed = JSON.parse(data) as { error?: string };
          message = parsed?.error ?? '';
        } catch {
          // ignore
        }
        throw new Error(message || `${who}暂时连不上模型，稍后再问`);
      }
    }
  }

  if (!answer.trim()) {
    throw new Error(`${who}没返回内容，换个问法试试`);
  }
  return answer;
}
