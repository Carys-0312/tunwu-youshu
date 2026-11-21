/**
 * 账号与登录态：只存 JWT 和用户展示信息，不存密码。
 * 未登录时 App 仍然完全可用，登录只影响“服务器同步”。
 */

import { API_BASE } from './api';
import { httpRequest, parseJsonBody, type HttpMethod } from './http';
import { logInfo } from './logger';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  /** data URL；空字符串或 null 表示没设置头像 */
  avatar?: string | null;
  /** 已验证的绑定邮箱；null 表示没绑定 */
  email?: string | null;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
  /** 只在注册接口返回一次；不写入本地登录态 */
  recoveryCode?: string;
}

const SESSION_KEY = 'auth_session';
let cached: AuthSession | null | undefined;

function isExpired(session: AuthSession): boolean {
  const time = new Date(session.expiresAt).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

export function saveSession(session: AuthSession): void {
  // 找回码只给用户展示一次，不属于登录态，不能跟着 JWT 一起落盘
  const { recoveryCode: _recoveryCode, ...persisted } = session;
  cached = persisted;
  try {
    uni.setStorageSync(SESSION_KEY, JSON.stringify(persisted));
  } catch {
    // 存储不可用时至少保留内存里的登录态
  }
}

export function clearSession(): void {
  cached = null;
  try {
    uni.removeStorageSync(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getSession(): AuthSession | null {
  if (cached !== undefined) return cached;

  try {
    const raw = uni.getStorageSync(SESSION_KEY);
    if (!raw) {
      cached = null;
      return null;
    }
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.id) {
      cached = null;
      return null;
    }
    if (isExpired(parsed)) {
      clearSession();
      return null;
    }
    cached = parsed;
    return parsed;
  } catch {
    cached = null;
    return null;
  }
}

export function isLoggedIn(): boolean {
  return getSession() !== null;
}

/** 给同步等需要身份的请求用；未登录时返回空对象，由调用方决定是否提示登录 */
export function authHeader(): Record<string, string> {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res;
  try {
    res = await httpRequest({
      url: `${API_BASE}${path}`,
      method: (init.method as HttpMethod) ?? 'GET',
      header: init.headers as Record<string, string>,
      data: parseJsonBody(init.body),
      timeout: 20000,
    });
  } catch {
    throw new Error('连不上服务端，检查手机网络后再试');
  }

  let parsed: Record<string, any> | null = null;
  if (res.body) {
    try {
      parsed = JSON.parse(res.body);
    } catch {
      // 网关错误页之类
    }
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 401) clearSession();
    throw new Error(parsed?.error || `请求失败（${res.status}）`);
  }
  return (parsed ?? {}) as T;
}

function keep(session: AuthSession): AuthSession {
  if (!session.token || !session.user?.id) {
    throw new Error('服务端返回的登录信息不完整');
  }
  saveSession(session);
  return session;
}

export async function register(
  username: string,
  password: string,
  displayName: string,
): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password, displayName: displayName || null }),
  });
  logInfo('账号', `注册成功：${username}`, `用户 ${session.user?.id ?? ''}`);
  return keep(session);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  logInfo('账号', `登录成功：${username}`, `用户 ${session.user?.id ?? ''}`);
  return keep(session);
}

export function logout(): void {
  logInfo('账号', '退出登录');
  clearSession();
}

/** 忘记密码：用户名 + 一次性找回码 + 新密码；成功后直接拿到登录态 */
export async function resetPassword(
  username: string,
  recoveryCode: string,
  newPassword: string,
): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, recoveryCode, newPassword }),
  });
  logInfo('账号', `用找回码重设密码：${username}`);
  return keep(session);
}

/** 登录状态下：给邮箱发绑定验证码 */
export async function requestEmailBindCode(email: string): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/email/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({ email }),
  });
}

/** 登录状态下：用验证码确认绑定邮箱 */
export async function bindEmail(email: string, code: string): Promise<AuthUser> {
  const user = await request<AuthUser>('/api/auth/email/bind', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({ email, code }),
  });
  const session = getSession();
  if (session) saveSession({ ...session, user });
  logInfo('账号', `绑定邮箱：${email}`);
  return user;
}

/** 忘记密码第一步：给账号绑定邮箱发验证码（不暴露账号是否存在） */
export async function requestPasswordResetCode(username: string): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/password-reset-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username }),
  });
}

/** 忘记密码第二步：用户名 + 邮箱验证码 + 新密码；成功后直接拿到登录态 */
export async function resetPasswordByEmail(
  username: string,
  code: string,
  newPassword: string,
): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/password-reset-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, code, newPassword }),
  });
  logInfo('账号', `用邮箱验证码重设密码：${username}`);
  return keep(session);
}

/** 用当前密码生成新的找回码，只返回一次 */
export async function generateRecoveryCode(currentPassword: string): Promise<string> {
  const result = await request<{ recoveryCode?: string }>('/api/auth/recovery-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({ currentPassword }),
  });
  if (!result.recoveryCode) {
    throw new Error('服务端没有返回找回码');
  }
  logInfo('账号', '生成了新的找回码');
  return result.recoveryCode;
}

/** 拉一次最新的账号资料（头像、昵称可能在其他设备改过） */
export async function fetchMe(): Promise<AuthUser> {
  const user = await request<AuthUser>('/api/auth/me', {
    headers: { Accept: 'application/json', ...authHeader() },
  });
  const session = getSession();
  if (session) saveSession({ ...session, user });
  return user;
}

/** 改昵称 / 头像；传 null 的字段保持不变，avatar 传空串表示清空 */
export async function updateProfile(input: {
  displayName?: string | null;
  avatar?: string | null;
}): Promise<AuthUser> {
  const user = await request<AuthUser>('/api/auth/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify(input),
  });
  const session = getSession();
  if (session) saveSession({ ...session, user });
  return user;
}

/** 改密码，需要提供当前密码 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<{ ok: boolean }>('/api/auth/password', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
