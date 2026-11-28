/**
 * 用户城市统计（仅 App、仅登录账号）。
 *
 * 规则：
 * - 首次进主界面弹一次说明，同意后才取定位；拒绝不再打扰；
 * - 只把坐标发给服务端做逆地理，城市由服务端保存，客户端只缓存最近城市用于展示；
 * - 前台每天最多上报一次；不做后台定位、不记录轨迹；
 * - 可在「个人信息 → 位置统计」随时关闭，关闭会清掉服务端已存城市。
 *
 * 浏览器（H5）需要 HTTPS 才能定位，生产目前还是 HTTP，所以 H5 先不启用。
 */

import { API_BASE } from './api';
import { authHeader, getSession, isLoggedIn } from './auth';
import { httpRequest } from './http';
import { logError } from './logger';

export type LocationConsent = 'unknown' | 'granted' | 'denied';

export interface LocationState {
  status: LocationConsent;
  /** 最近一次成功识别的城市，仅用于界面展示 */
  city?: string;
  /** 本地记录的上报时间，用于 24 小时节流 */
  lastReportAt?: number;
}

interface ServerLocation {
  consent?: string;
  city?: string;
  district?: string;
  locatedAt?: string;
}

export interface LocationReport {
  status: 'updated' | 'unchanged' | 'denied' | 'unconfigured' | 'error';
  city?: string;
  district?: string;
  message?: string;
}

const KEY_PREFIX = 'location_consent_v1:';
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 每个账号每次启动只检查一次同意状态，避免切 tab 时重复请求 */
let checkedOwner = '';

/** H5 需要 HTTPS，暂不启用；App 端 manifest 已带 Geolocation 模块 */
export function locationSupported(): boolean {
  let supported = false;
  // #ifdef APP-PLUS
  supported = true;
  // #endif
  return supported;
}

function owner(): string {
  return getSession()?.user?.id ?? '';
}

function storageKey(): string {
  const uid = owner();
  return uid ? `${KEY_PREFIX}${uid}` : '';
}

export function readLocationState(): LocationState {
  const key = storageKey();
  if (!key) return { status: 'unknown' };
  try {
    const raw = uni.getStorageSync(key);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && (parsed.status === 'granted' || parsed.status === 'denied')) {
      return {
        status: parsed.status,
        city: typeof parsed.city === 'string' ? parsed.city : undefined,
        lastReportAt: typeof parsed.lastReportAt === 'number' ? parsed.lastReportAt : undefined,
      };
    }
  } catch {
    // 存储坏了就当作没同意过
  }
  return { status: 'unknown' };
}

function writeLocationState(patch: Partial<LocationState>): LocationState {
  const key = storageKey();
  if (!key) return { status: 'unknown' };
  const next: LocationState = { ...readLocationState(), ...patch };
  try {
    uni.setStorageSync(key, JSON.stringify(next));
  } catch {
    // 存不了只影响下次提示，不影响本次
  }
  return next;
}

async function request<T>(path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE', data?: unknown): Promise<T> {
  const header: Record<string, string> = { Accept: 'application/json', ...authHeader() };
  if (data !== undefined) header['Content-Type'] = 'application/json';
  const res = await httpRequest({
    url: `${API_BASE}${path}`,
    method,
    header,
    data,
    timeout: 15000,
  });
  let parsed: Record<string, any> | null = null;
  if (res.body) {
    try {
      parsed = JSON.parse(res.body);
    } catch {
      // ignore
    }
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(parsed?.error || `请求失败（${res.status}）`);
  }
  return (parsed ?? {}) as T;
}

export function fetchServerLocation(): Promise<ServerLocation> {
  return request<ServerLocation>('/api/location/me', 'GET');
}

function getLocationOnce(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    // 系统定位拿 WGS84 最稳；gcj02 在很多没配地图 SDK 的包里会直接失败。
    // 坐标交给服务端转 GCJ-02，城市场景精度足够。
    uni.getLocation({
      type: 'wgs84',
      isHighAccuracy: false,
      timeout: 15000,
      success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
      fail: (err) => {
        const message = String(err?.errMsg || '');
        logError('定位', '获取位置失败', message);
        if (/deny|denied|auth/i.test(message)) {
          reject(new Error('系统没有给定位权限，可以在手机设置里打开'));
        } else if (/timeout|超时/i.test(message)) {
          reject(new Error('定位超时，试试到窗边或户外再试'));
        } else {
          reject(new Error('暂时定位失败，请确认手机定位已打开后重试'));
        }
      },
    });
  });
}

/** 刚授权完系统弹窗时第一次调用可能失败，非权限问题就稍等重试一次。 */
async function getLocationWithRetry(): Promise<{ latitude: number; longitude: number }> {
  try {
    return await getLocationOnce();
  } catch (error) {
    if (error instanceof Error && error.message.includes('权限')) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return getLocationOnce();
  }
}

async function collectAndReport(): Promise<LocationReport> {
  const point = await getLocationWithRetry();
  const result = await request<LocationReport>('/api/location/report', 'POST', {
    latitude: point.latitude,
    longitude: point.longitude,
    source: 'unknown',
    coord: 'wgs84',
  });
  if (result.status === 'updated' && result.city) {
    writeLocationState({ city: result.city, lastReportAt: Date.now() });
  } else if (result.status === 'unchanged') {
    writeLocationState({ lastReportAt: Date.now() });
  }
  return result;
}

/** 打开位置统计：先记录同意，再取一次定位 */
export async function enableLocationReporting(): Promise<LocationReport> {
  if (!isLoggedIn()) throw new Error('登录后才能开启');
  await request('/api/location/consent', 'PUT', { granted: true });
  writeLocationState({ status: 'granted' });
  return collectAndReport();
}

/** 关闭位置统计：服务端清城市，本地不再上报 */
export async function disableLocationReporting(): Promise<void> {
  writeLocationState({ status: 'denied', city: undefined, lastReportAt: undefined });
  try {
    await request('/api/location', 'DELETE');
  } catch {
    // 服务端暂时不可达时本地先停，下次开启会重新写同意状态
  }
}

/** 回到前台时静默补报：只在已同意且距上次成功上报超过 24 小时时执行 */
export async function reportLocationIfDue(): Promise<void> {
  if (!locationSupported() || !isLoggedIn()) return;
  const state = readLocationState();
  if (state.status !== 'granted') return;
  if (state.lastReportAt && Date.now() - state.lastReportAt < REPORT_INTERVAL_MS) return;
  try {
    await collectAndReport();
  } catch {
    // 定位失败 / 没权限都不打扰用户，下次前台再试
  }
}

/**
 * 首次进主界面时调用：本地没同意记录就弹一次说明。
 * 换设备或重装后先从服务端读一次，避免重复打扰已经选过的人。
 */
export async function maybeAskLocationConsent(): Promise<void> {
  if (!locationSupported()) return;
  const uid = owner();
  if (!uid || checkedOwner === uid) return;
  checkedOwner = uid;

  let state = readLocationState();
  if (state.status !== 'unknown') {
    if (state.status === 'granted') void reportLocationIfDue();
    return;
  }

  try {
    const server = await fetchServerLocation();
    if (server.consent === 'granted') {
      writeLocationState({ status: 'granted', city: server.city });
      void reportLocationIfDue();
      return;
    }
    if (server.consent === 'denied') {
      writeLocationState({ status: 'denied' });
      return;
    }
  } catch {
    // 服务端不可用就照常询问，用户选择后再写
  }

  const answer = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '记录你的城市？',
      content: '只记录所在城市，用来看看大家都分布在哪。不记录行踪，也不会在后台定位。以后可以在「我的 → 个人信息」里随时关闭。',
      confirmText: '允许',
      cancelText: '暂不',
      confirmColor: '#9a6514',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });

  if (!answer) {
    void disableLocationReporting();
    return;
  }

  try {
    const result = await enableLocationReporting();
    if (result.status === 'updated' && result.city) {
      uni.showToast({ title: `已记录：${result.city}`, icon: 'none' });
    } else if (result.message) {
      uni.showToast({ title: result.message, icon: 'none' });
    }
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '定位失败，稍后再试', icon: 'none' });
  }
}
