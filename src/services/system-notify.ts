import type { NotifyCapability } from '@/uni_modules/tunwu-notify';

// #ifdef APP-PLUS
import {
  cancelAll as nativeCancelAll,
  consumeLaunchPayload as nativeConsumeLaunchPayload,
  getCapability as nativeGetCapability,
  openExactAlarmSettings as nativeOpenExactAlarmSettings,
  openSettings as nativeOpenSettings,
  requestPermission as nativeRequestPermission,
  schedule as nativeSchedule,
} from '@/uni_modules/tunwu-notify';
// #endif

// #ifdef APP-IOS
import { refreshPermission as nativeRefreshPermission } from '@/uni_modules/tunwu-notify';
// #endif

const UNSUPPORTED: NotifyCapability = {
  supported: false,
  permission: 'unsupported',
  exactAlarm: false,
  channelReady: false,
  level: 'L1',
};

/** 当前设备是否具备系统级调度能力。H5 与标准基座会返回 unsupported。 */
export function systemNotifyCapability(): NotifyCapability {
  // #ifdef APP-PLUS
  try {
    const capability = nativeGetCapability();
    if (capability?.supported) return capability;
  } catch (err) {
    console.warn('[notify] 原生通知模块不可用', err);
  }
  // #endif
  return { ...UNSUPPORTED };
}

/**
 * iOS 的通知授权状态是异步查询的，模块内做了缓存；
 * App 启动/回到前台时刷新一次，避免刚打开时显示成「未授权」。
 */
export async function systemNotifyRefreshPermission(): Promise<void> {
  // #ifdef APP-IOS
  try {
    await nativeRefreshPermission();
  } catch (err) {
    console.warn('[notify] 刷新通知权限失败', err);
  }
  // #endif
}

/** 登记一条系统级通知；失败时由调用方回退到本地即时通知。 */
export function systemNotifySchedule(options: {
  id: string;
  title: string;
  body: string;
  at: number;
  payload?: string;
}): boolean {
  // #ifdef APP-PLUS
  // 标准基座没有合并插件清单，接收器不存在时不要登记，避免误以为已经生效
  if (!systemNotifyCapability().supported) return false;
  try {
    return nativeSchedule(options);
  } catch (err) {
    console.warn('[notify] 登记系统通知失败', err);
    return false;
  }
  // #endif
  return false;
}

export function systemNotifyCancelAll(): void {
  // #ifdef APP-PLUS
  try {
    nativeCancelAll();
  } catch (err) {
    console.warn('[notify] 取消系统通知失败', err);
  }
  // #endif
}

export async function systemNotifyRequestPermission(): Promise<boolean> {
  // #ifdef APP-PLUS
  try {
    return await nativeRequestPermission();
  } catch (err) {
    console.warn('[notify] 申请通知权限失败', err);
    return false;
  }
  // #endif
  return false;
}

export function systemNotifyOpenSettings(): void {
  // #ifdef APP-PLUS
  try {
    nativeOpenSettings();
  } catch (err) {
    console.warn('[notify] 打开通知设置失败', err);
  }
  // #endif
}

export function systemNotifyOpenExactAlarmSettings(): void {
  // #ifdef APP-PLUS
  try {
    nativeOpenExactAlarmSettings();
  } catch (err) {
    console.warn('[notify] 打开精确闹钟设置失败', err);
  }
  // #endif
}

/** 冷启动时读取通知携带的页面路径；没有则返回空串。 */
export function systemNotifyConsumeLaunchPayload(): string {
  // #ifdef APP-PLUS
  try {
    return nativeConsumeLaunchPayload();
  } catch (err) {
    console.warn('[notify] 读取通知启动参数失败', err);
  }
  // #endif
  return '';
}
