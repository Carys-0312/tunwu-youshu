/**
 * 意见反馈：匿名提交到服务端，不附带任何库存数据。
 * 登录与否都能提交；登录时带上 token，服务端会顺带记录 user_id。
 */
import { API_BASE } from './api';
import { authHeader, isLoggedIn } from './auth';

export type FeedbackCategory = 'feature' | 'problem' | 'recognition' | 'other';

export interface FeedbackInput {
  category: FeedbackCategory;
  content: string;
  contact?: string;
  appVersion?: string;
  platform?: string;
}

interface FeedbackReply {
  ok?: boolean;
  error?: string;
}

/** 本人提交过的一条反馈；reply 是管理员写的回信，未回复为 null */
export interface MyFeedbackItem {
  id: number;
  category: FeedbackCategory;
  content: string;
  status: 'new' | 'processing' | 'resolved' | 'closed';
  reply: string | null;
  createdAt: string;
  repliedAt: string | null;
}

/** 提交反馈；网络或服务端错误时抛出可展示的中文提示 */
export function submitFeedback(input: FeedbackInput): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    uni.request({
      url: `${API_BASE}/api/feedback`,
      method: 'POST',
      data: {
        ...input,
        // 蜜罐字段，正常用户不会填
        website: '',
      } as any,
      header: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader(),
      },
      timeout: 15000,
      success: (res) => {
        let parsed: FeedbackReply | null = null;
        if (typeof res.data === 'string') {
          try {
            parsed = JSON.parse(res.data) as FeedbackReply;
          } catch {
            parsed = null;
          }
        } else if (res.data && typeof res.data === 'object') {
          parsed = res.data as FeedbackReply;
        }

        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve();
          return;
        }
        reject(new Error(parsed?.error || `提交失败（${status}）`));
      },
      fail: () => reject(new Error('连不上服务端，检查网络后再试')),
    });
  });
}

/**
 * 拉取当前账号提交过的反馈和回信。
 * 访客没有账号绑定，直接返回空数组，不请求服务端。
 */
export function fetchMyFeedback(): Promise<MyFeedbackItem[]> {
  if (!isLoggedIn()) return Promise.resolve([]);
  return new Promise<MyFeedbackItem[]>((resolve, reject) => {
    uni.request({
      url: `${API_BASE}/api/feedback/mine`,
      method: 'GET',
      header: { Accept: 'application/json', ...authHeader() },
      timeout: 15000,
      success: (res) => {
        const status = res.statusCode ?? 0;
        let parsed: { items?: MyFeedbackItem[]; error?: string } | null = null;
        if (typeof res.data === 'string') {
          try {
            parsed = JSON.parse(res.data);
          } catch {
            parsed = null;
          }
        } else if (res.data && typeof res.data === 'object') {
          parsed = res.data as { items?: MyFeedbackItem[]; error?: string };
        }
        if (status >= 200 && status < 300) {
          resolve(Array.isArray(parsed?.items) ? parsed!.items : []);
          return;
        }
        reject(new Error(parsed?.error || `加载失败（${status}）`));
      },
      fail: () => reject(new Error('连不上服务端，检查网络后再试')),
    });
  });
}
