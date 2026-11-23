/**
 * 登录 / 注册 / 找回密码时的本机数据处理。
 *
 * 规则：
 * - 本机数据已经属于这个账号（重新登录）→ 直接保留。
 * - 本机是游客数据 → 问用户要不要带进账号，默认尊重选择，不清除就不删。
 * - 本机是另一个账号的数据 → 只提供「清除并继续」或「取消」，绝不把上一个账号的库存带过去。
 *
 * 具体的清除动作在 `applyLocalDataPlan` 里执行，调用方要在认证成功之后再调用它，
 * 避免「提示完但登录失败」时误删数据。
 */

import { clearChatHistory } from './chat-history';
import { countLocalData, clearLocalData, getLocalOwner, setLocalOwner } from './local-data-owner';

export type LocalDataPlan = 'keep' | 'clear' | 'cancel';

interface AskOptions {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
}

/** uni.showModal 的 Promise 版；用户点关闭 / 点遮罩一律按「取消」处理 */
function ask(options: AskOptions): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: options.title,
      content: options.content,
      confirmText: options.confirmText,
      cancelText: options.cancelText,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

function describe(count: { items: number; rows: number }): string {
  return count.items > 0 ? `${count.items} 件物品` : `${count.rows} 条本机数据`;
}

/** 游客数据：服务器已有数据时明确告知会被替换；否则问要不要带进账号 */
async function askGuestData(
  username: string,
  label: string,
  serverItemCount = 0,
): Promise<LocalDataPlan> {
  if (serverItemCount > 0) {
    const proceed = await ask({
      title: '服务器上已有数据',
      content: `账号「${username}」的服务器上已有 ${serverItemCount} 种物品。\n登录后会从服务器恢复，本机这 ${label} 会被替换。\n建议先取消登录，导出备份后再继续。`,
      confirmText: '继续并恢复',
      cancelText: '取消登录',
    });
    return proceed ? 'keep' : 'cancel';
  }

  const bring = await ask({
    title: '本机已有物品',
    content: `这台设备上有 ${label}。\n要带进账号「${username}」吗？如果这台设备之前登录过其他账号，建议从空库存开始。`,
    confirmText: '带入账号',
    cancelText: '从空开始',
  });
  if (bring) return 'keep';

  const sure = await ask({
    title: '从空库存开始？',
    content: '本机数据会被删除，且不会进入这个账号，删除后无法撤销。',
    confirmText: '确定删除',
    cancelText: '还是带入',
  });
  return sure ? 'clear' : 'keep';
}

/**
 * 注册前调用：新账号还没有 id，本机任何已有数据都不属于它。
 * 此时提示「另一个账号的数据」是准确的——哪怕原账号早就退出了。
 */
export async function planLocalDataForNewAccount(username: string): Promise<LocalDataPlan> {
  const owner = getLocalOwner();
  const count = await countLocalData();
  if (count.rows === 0) return 'keep';

  const label = describe(count);

  if (owner) {
    const clear = await ask({
      title: '本机是其他账号的数据',
      content: `这台设备上还留着另一个账号的 ${label}。\n新账号会从空库存开始；清除后本机数据无法恢复（原账号的服务器数据不受影响）。`,
      confirmText: '清除并注册',
      cancelText: '取消注册',
    });
    return clear ? 'clear' : 'cancel';
  }

  return askGuestData(username, label);
}

/**
 * 登录 / 找回密码成功后调用：已经知道目标账号 id，可以精确判断归属。
 */
export async function planLocalDataForExistingAccount(
  userId: string,
  username: string,
  serverItemCount = 0,
): Promise<LocalDataPlan> {
  const owner = getLocalOwner();
  if (owner === userId) return 'keep';

  const count = await countLocalData();
  if (count.rows === 0) return 'keep';

  const label = describe(count);

  if (owner) {
    const serverHint = serverItemCount > 0
      ? `再从服务器恢复「${username}」的 ${serverItemCount} 种物品`
      : `再加载「${username}」的库存`;
    const clear = await ask({
      title: '本机是其他账号的数据',
      content: `这台设备上还留着另一个账号的 ${label}。\n继续登录会清除本机数据，${serverHint}。原账号的服务器数据不受影响。`,
      confirmText: '清除并继续',
      cancelText: '取消登录',
    });
    return clear ? 'clear' : 'cancel';
  }

  return askGuestData(username, label, serverItemCount);
}

/** 认证成功后执行计划：该清就清，然后把本机数据记为这个账号的 */
export async function applyLocalDataPlan(plan: LocalDataPlan, userId: string): Promise<void> {
  if (plan === 'cancel') return;
  if (plan === 'clear') {
    // 聊天记录也是本机数据：用户确认清除时一并删掉，避免留在设备上
    const previous = getLocalOwner();
    if (previous !== undefined) clearChatHistory(previous ?? 'guest');
    await clearLocalData();
  }
  setLocalOwner(userId);
}
