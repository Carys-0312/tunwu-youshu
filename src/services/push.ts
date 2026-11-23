/**
 * UniPush 2.0：把设备 CID 登记到服务端，并在用户点开推送时跳转页面。
 *
 * 只负责「服务端主动发来的通知」（目前是管理员回信）。临期提醒仍走
 * services/reminders.ts 的本地系统通知，不依赖网络。
 *
 * H5 / 标准基座没有 UniPush 能力，这里全部是空操作。
 */
import { API_BASE } from './api';
import { authHeader, getSession, isLoggedIn } from './auth';
import { httpRequest } from './http';

const REGISTER_KEY = 'push_client_v1_';
/** 同一个 CID 10 分钟内不重复登记，避免每次回到前台都打一次接口 */
const REGISTER_COOLDOWN = 10 * 60 * 1000;

interface RegisterState {
  cid: string;
  at: number;
  /** 服务端是否已经配好 UniPush；配好时回信由服务端推送，客户端不再弹本地通知 */
  configured?: boolean;
}

function readState(key: string): RegisterState | null {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) return null;
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<RegisterState>;
    if (typeof parsed?.cid === 'string' && typeof parsed?.at === 'number') {
      return {
        cid: parsed.cid,
        at: parsed.at,
        configured: parsed.configured === true,
      };
    }
  } catch {
    // 存坏了就当没登记过
  }
  return null;
}

function writeState(key: string, state: RegisterState): void {
  try {
    uni.setStorageSync(key, JSON.stringify(state));
  } catch {
    // 存不了就下次重新登记
  }
}

function clearState(key: string): void {
  try {
    uni.removeStorageSync(key);
  } catch {
    // ignore
  }
}

function platformName(): string {
  try {
    const platform = String(uni.getSystemInfoSync().platform || '').toLowerCase();
    if (platform === 'android' || platform === 'ios') return platform;
  } catch {
    // 取不到就按未知处理
  }
  return 'unknown';
}

/** 读取 UniPush 客户端标识；未开通/标准基座/H5 时返回空串。 */
export function getPushCid(): Promise<string> {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    const api = (uni as any).getPushClientId;
    if (typeof api === 'function') {
      try {
        api({
          success: (res: any) => resolve(typeof res?.cid === 'string' ? res.cid : ''),
          fail: () => resolve(''),
        });
        return;
      } catch {
        // 落到下面返回空串
      }
    }
    // #endif
    resolve('');
  });
}

/**
 * 登录后登记当前设备。force=true 用于刚登录/刚注册时立即登记。
 * 网络失败静默忽略，下次回到前台会再试。
 */
export async function registerPushClient(force = false): Promise<void> {
  if (!isLoggedIn()) return;
  const user = getSession()?.user;
  if (!user?.id) return;

  const cid = await getPushCid();
  if (!cid) return;

  const key = `${REGISTER_KEY}${user.id}`;
  const cached = readState(key);
  if (!force && cached?.cid === cid && Date.now() - cached.at < REGISTER_COOLDOWN) {
    return;
  }

  try {
    const res = await httpRequest({
      url: `${API_BASE}/api/push/clients`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader(),
      },
      data: { cid, platform: platformName() },
      timeout: 15000,
    });
    if (res.status >= 200 && res.status < 300) {
      let configured = false;
      try {
        const parsed = JSON.parse(res.body) as { pushConfigured?: boolean };
        configured = parsed?.pushConfigured === true;
      } catch {
        // 响应不是 JSON 时当作未配置，仍保留本地轮询兜底
      }
      writeState(key, { cid, at: Date.now(), configured });
    }
  } catch {
    // 网络不可用；不打扰用户
  }
}

/** 服务端已配好 UniPush 且本机 CID 登记成功时，回信走系统推送。 */
export function isPushReady(): boolean {
  const user = getSession()?.user;
  if (!user?.id) return false;
  return readState(`${REGISTER_KEY}${user.id}`)?.configured === true;
}

/** 退出登录时解绑，避免这台设备继续收到上一个账号的回信通知。 */
export async function unregisterPushClient(): Promise<void> {
  const user = getSession()?.user;
  // 调用方可能紧接着清 session，先把 token 抓下来
  const header = authHeader();
  const cid = await getPushCid();
  if (!cid) return;

  try {
    await httpRequest({
      url: `${API_BASE}/api/push/clients?cid=${encodeURIComponent(cid)}`,
      method: 'DELETE',
      header: { Accept: 'application/json', ...header },
      timeout: 10000,
    });
  } catch {
    // 解绑失败时，下次换账号登录会由服务端改绑这个 CID
  }
  if (user?.id) clearState(`${REGISTER_KEY}${user.id}`);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 推送 payload 可能是对象，也可能是一段 JSON 字符串 */
function pathFromPayload(data: unknown, raw: unknown): string {
  const candidates: unknown[] = [data, raw];
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === 'string') {
      value = safeParse(value) ?? value;
    }
    if (value && typeof value === 'object' && typeof (value as any).path === 'string') {
      const path = (value as { path: string }).path;
      if (path.startsWith('/pages/')) return path;
    }
    if (typeof value === 'string' && value.startsWith('/pages/')) {
      return value;
    }
  }
  return '';
}

/**
 * 监听 UniPush 消息。只处理「点开通知」，收到消息时不弹 App 内提示
 * （系统通知栏已经有内容，再弹一次会重复）。
 */
export function bindPushMessage(): void {
  // #ifdef APP-PLUS
  const on = (uni as any).onPushMessage;
  if (typeof on !== 'function') return;
  try {
    on((res: any) => {
      if (res?.type !== 'click') return;
      const path = pathFromPayload(res?.data, res?.payload);
      if (!path) return;
      setTimeout(() => {
        uni.navigateTo({ url: path, fail: () => uni.switchTab({ url: path }) });
      }, 300);
    });
  } catch (err) {
    console.warn('[push] 监听 UniPush 失败', err);
  }
  // #endif
}
