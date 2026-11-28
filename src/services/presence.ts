/**
 * 前台在线心跳：登录状态下每分钟告诉服务端「我还在」。
 * 后台用户管理的「登录状态」就是靠它和带身份的请求判断在线（窗口 3 分钟）。
 * 失败静默处理，不打扰用户；切后台时停止，回到前台再恢复。
 */

import { API_BASE } from './api';
import { authHeader, isLoggedIn } from './auth';
import { httpRequest } from './http';

const HEARTBEAT_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;

function ping(): void {
  if (sending || !isLoggedIn()) return;
  sending = true;
  void httpRequest({
    url: `${API_BASE}/api/presence/ping`,
    method: 'POST',
    header: { Accept: 'application/json', ...authHeader() },
    timeout: 8000,
  }).then(
    () => {
      sending = false;
    },
    () => {
      // 网络不好 / 服务端暂时不可用都不提示，下一轮自动重试
      sending = false;
    },
  );
}

/** 回到前台时调用；重复调用不会叠加定时器 */
export function startPresenceHeartbeat(): void {
  if (timer !== null) return;
  ping();
  timer = setInterval(ping, HEARTBEAT_MS);
}

/** 切后台或退出时调用 */
export function stopPresenceHeartbeat(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}
