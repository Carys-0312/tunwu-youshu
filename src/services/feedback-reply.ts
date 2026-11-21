/**
 * 回信提醒：App 启动 / 回到前台 / 每 5 分钟检查一次「我的反馈」，
 * 发现管理员新写了回信就发一条系统通知，点通知回到意见反馈页。
 *
 * 记录分两个：seen（用户打开反馈页看过）和 notified（已经提醒过）。
 * 这样同一条回信不会反复弹，管理员后来改回信（handled_at 变化）会重新提醒。
 */
import { getSession, isLoggedIn } from './auth';
import { fetchMyFeedback, type MyFeedbackItem } from './feedback';
import {
  systemNotifyCapability,
  systemNotifyRequestPermission,
  systemNotifySchedule,
} from './system-notify';

const SEEN_PREFIX = 'feedback_reply_seen_v1_';
const NOTIFIED_PREFIX = 'feedback_reply_notified_v1_';
const CHECK_INTERVAL = 5 * 60 * 1000;

function storageGet(key: string): string {
  try {
    const value = uni.getStorageSync(key);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function storageSet(key: string, value: string): void {
  try {
    uni.setStorageSync(key, value);
  } catch {
    // 存不了就只在本次运行里生效
  }
}

function keyFor(prefix: string): string {
  const user = getSession()?.user;
  return user?.id ? `${prefix}${user.id}` : '';
}

function latestReply(items: MyFeedbackItem[]): { signature: string; count: number } {
  const replied = items.filter((item) => item.reply && item.repliedAt);
  if (!replied.length) return { signature: '', count: 0 };
  const latest = replied.reduce((a, b) =>
    (a.repliedAt || '') >= (b.repliedAt || '') ? a : b);
  return { signature: `${latest.id}:${latest.repliedAt}`, count: replied.length };
}

/** 用户打开反馈页时调用：把当前最新回信记为已看，后续不再提醒 */
export function markFeedbackRepliesSeen(items: MyFeedbackItem[]): void {
  const key = keyFor(SEEN_PREFIX);
  if (!key) return;
  const { signature } = latestReply(items);
  if (signature) storageSet(key, signature);
}

async function notifyNewReply(count: number): Promise<void> {
  const title = '小囤回信了';
  const body = count > 1
    ? `你有 ${count} 条反馈收到了回复，点开看看`
    : '你提的反馈收到了回复，点开看看';
  const payload = '/pages/feedback/index';

  let capability = systemNotifyCapability();
  if (capability.supported && capability.permission !== 'granted') {
    try {
      await systemNotifyRequestPermission();
    } catch {
      // 用户拒绝授权时下面会回退到应用内提示
    }
    capability = systemNotifyCapability();
  }

  if (capability.supported
    && capability.permission === 'granted'
    && systemNotifySchedule({
      id: `feedback-reply-${Date.now()}`,
      title,
      body,
      at: Date.now() + 1200,
      payload,
    })) {
    return;
  }

  // #ifdef APP-PLUS
  // 标准基座或原生通知插件不可用时，退回 DCloud 本地消息
  const plus = (globalThis as any).plus;
  try {
    if (plus?.push?.createMessage) {
      plus.push.createMessage(body, payload, { title, cover: false });
      return;
    }
  } catch {
    // 继续往下走应用内提示
  }
  // #endif

  // #ifdef H5
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'tunwu-feedback-reply' });
      return;
    } catch {
      // 浏览器不支持时回退到 toast
    }
  }
  // #endif

  uni.showToast({ title, icon: 'none' });
}

let checking = false;

/** 检查是否有新回信；返回已回复条数（没有新回信也返回当前条数） */
export async function checkFeedbackReplies(): Promise<number> {
  if (checking || !isLoggedIn()) return 0;
  const seenKey = keyFor(SEEN_PREFIX);
  const notifiedKey = keyFor(NOTIFIED_PREFIX);
  if (!seenKey || !notifiedKey) return 0;

  checking = true;
  try {
    const items = await fetchMyFeedback();
    const { signature, count } = latestReply(items);
    if (!signature) return 0;
    if (signature === storageGet(seenKey)) return count;
    if (signature !== storageGet(notifiedKey)) {
      storageSet(notifiedKey, signature);
      await notifyNewReply(count);
    }
    return count;
  } catch {
    return 0;
  } finally {
    checking = false;
  }
}

let watchTimer = 0;

/** 启动后检查一次，并每 5 分钟看一次；重复调用不会叠加定时器 */
export function startFeedbackReplyWatch(): void {
  if (watchTimer) return;
  const tick = (): void => {
    void checkFeedbackReplies();
  };
  watchTimer = setInterval(tick, CHECK_INTERVAL) as unknown as number;
  setTimeout(tick, 4000);
}
