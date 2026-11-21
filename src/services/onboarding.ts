/**
 * 「初见管家」待完成标记。
 *
 * 注册成功时按账号打上，完成或主动跳过引导后清掉。
 * 放在本地存储而不是 schema_meta：它只描述“这台设备上的这次初见有没有走完”，
 * 不该跟着备份、同步走去影响别的设备。
 */
const PENDING_PREFIX = 'onboarding_pending_';

function keyOf(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

export function markOnboardingPending(userId: string): void {
  try {
    uni.setStorageSync(keyOf(userId), '1');
  } catch {
    // 存储不可用就退化成只走注册后那一次跳转，不阻断注册
  }
}

export function isOnboardingPending(userId: string): boolean {
  try {
    return uni.getStorageSync(keyOf(userId)) === '1';
  } catch {
    return false;
  }
}

export function clearOnboardingPending(userId: string): void {
  try {
    uni.removeStorageSync(keyOf(userId));
  } catch {
    // ignore
  }
}
