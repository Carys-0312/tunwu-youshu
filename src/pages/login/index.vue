<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import {
  clearSession,
  getSession,
  isLoggedIn,
  login,
  register,
  requestPasswordResetCode,
  resetPassword,
  resetPasswordByEmail,
  type AuthSession,
} from '@/services/auth';
import { runAutoSync, setAutoSyncSuspended } from '@/services/auto-sync';
import {
  applyLocalDataPlan,
  planLocalDataForExistingAccount,
  planLocalDataForNewAccount,
  type LocalDataPlan,
} from '@/services/account-data';
import { isOnboardingPending, markOnboardingPending } from '@/services/onboarding';
import { markFeatureTourPending } from '@/services/feature-tour';
import { removeDemoRows } from '@/db/repo';
import { logInfo, logWarn } from '@/services/logger';
import { fetchSyncStatus } from '@/services/sync';

type Mode = 'login' | 'register';

const mode = ref<Mode>('login');
const username = ref('');
const password = ref('');
const confirm = ref('');
const displayName = ref('');
const busy = ref(false);
const error = ref('');
const showPassword = ref(false);
const showConfirm = ref(false);
const activeField = ref('');
const canGoBack = ref(false);
/** 已经决定离开登录页（进主页 / 进引导 / 已登录自动跳过），别再触发 onShow 的自动跳转 */
let leaving = false;

/** 注册成功后只展示一次的找回码 */
const createdOpen = ref(false);
const createdCode = ref('');

/** 忘记密码弹层 */
const recoveryOpen = ref(false);
const recoveryUsername = ref('');
const recoveryCode = ref('');
const recoveryPassword = ref('');
const recoveryConfirm = ref('');
const recoveryError = ref('');
const recoveryBusy = ref(false);
const showRecoveryCode = ref(false);
const showRecoveryPassword = ref(false);
const showRecoveryConfirm = ref(false);
const recoveryField = ref('');
/** 邮箱验证码 / 找回码 两种找回方式 */
const recoveryMethod = ref<'email' | 'code'>('email');
const recoveryEmailCode = ref('');
const recoverySending = ref(false);
const recoveryCountdown = ref(0);
let recoveryTimer: ReturnType<typeof setInterval> | null = null;

onLoad((query) => {
  canGoBack.value = getCurrentPages().length > 1;
  if (query?.mode === 'register') mode.value = 'register';
});

onShow(() => {
  const pages = getCurrentPages();
  canGoBack.value = pages.length > 1;
  // 登录页是启动页：已经登录过的用户直接进管家，不用每次开机都看登录框；
  // 刚注册还没走完「初见管家」的账号，先补上引导页（App 中途被杀掉也会回到这里）
  if (!leaving && pages.length <= 1 && isLoggedIn() && !createdOpen.value && !recoveryOpen.value) {
    leaving = true;
    const session = getSession();
    if (session && isOnboardingPending(session.user.id)) {
      uni.redirectTo({ url: '/pages/onboarding/index' });
    } else {
      uni.switchTab({ url: '/pages/items/index' });
    }
  }
});

function switchMode(next: Mode): void {
  if (busy.value || mode.value === next) return;
  mode.value = next;
  error.value = '';
  confirm.value = '';
  showPassword.value = false;
  showConfirm.value = false;
  activeField.value = '';
}

function focusField(name: string): void {
  activeField.value = name;
  if (error.value) error.value = '';
}

function blurField(): void {
  activeField.value = '';
}

function clearError(): void {
  if (error.value) error.value = '';
}

function goBack(): void {
  leaving = true;
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/items/index' });
}

function onPasswordConfirm(): void {
  if (mode.value === 'login') void submit();
}

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';

  const name = username.value.trim();
  if (!name) {
    error.value = '请填写用户名';
    return;
  }
  if (!password.value) {
    error.value = '请填写密码';
    return;
  }
  if (mode.value === 'register') {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) {
      error.value = '用户名用 3-24 位字母、数字或下划线';
      return;
    }
    if (password.value.length < 8) {
      error.value = '密码至少 8 位';
      return;
    }
    if (password.value !== confirm.value) {
      error.value = '两次输入的密码不一致';
      return;
    }
  }

  busy.value = true;
  // 认证成功到本机数据归属处理完之前，先暂停后台同步，避免旧账号的数据被推出去
  setAutoSyncSuspended(true);
  try {
    let plan: LocalDataPlan = 'keep';
    if (mode.value === 'register') {
      // 新账号还不存在，本机任何已有数据都不属于它；先问清楚再注册，避免注册完又取消
      plan = await planLocalDataForNewAccount(name);
      if (plan === 'cancel') {
        error.value = '已取消注册';
        return;
      }
    }

    const session = mode.value === 'register'
      ? await register(name, password.value, displayName.value.trim())
      : await login(name, password.value);

    if (mode.value === 'login') {
      // 服务器已有数据时，登录后会整份拉回并替换本机数据，先让用户知道
      const serverItemCount = await fetchServerItemCount();
      plan = await planLocalDataForExistingAccount(session.user.id, name, serverItemCount);
      if (plan === 'cancel') {
        clearSession();
        error.value = '已取消登录';
        return;
      }
    }

    await applyLocalDataPlan(plan, session.user.id);
    setAutoSyncSuspended(false);

    // 接下来会弹出找回码，别再叠一个 toast 挡住它
    const showingRecoveryCode = mode.value === 'register' && Boolean(session.recoveryCode);
    if (!showingRecoveryCode) {
      uni.showToast({
        title: mode.value === 'register' ? '注册成功' : '登录成功',
        icon: 'success',
      });
    }

    // 登录 / 注册后不再展示演示数据：只删种子 id 的演示行，游客自己加过的真实数据保留
    try {
      const removed = await removeDemoRows();
      if (removed) logInfo('账号', `登录后清掉了 ${removed} 处本机演示数据`);
    } catch (err) {
      console.warn('[login] 清理演示数据失败', err);
    }

    // 登录后后台对一次同步：新设备会把服务器数据拉回来，本机有改动则推上去
    void runAutoSync({ checkRemote: true });

    // 只有刚注册的新账号先进「初见管家」；老用户登录直接回主页
    if (mode.value === 'register') {
      // 记下“这次初见还没走完”：即使用户关掉 App，下次打开也会先回引导页
      markOnboardingPending(session.user.id);
      // 只有刚注册的账号才自动看功能引导；老账号登录不再弹
      markFeatureTourPending(session.user.id);
      if (session.recoveryCode) {
        // 找回码只返回这一次，先让用户保存，再去引导页
        createdCode.value = session.recoveryCode;
        createdOpen.value = true;
        return;
      }
      leaving = true;
      setTimeout(() => {
        uni.redirectTo({ url: '/pages/onboarding/index' });
      }, 500);
      return;
    }
    // 本机还有没走完的「初见管家」时，登录后先补引导
    if (isOnboardingPending(session.user.id)) {
      leaving = true;
      setTimeout(() => {
        uni.redirectTo({ url: '/pages/onboarding/index' });
      }, 500);
      return;
    }
    setTimeout(goBack, 500);
  } catch (err) {
    const message = err instanceof Error ? err.message : '操作失败，请重试';
    logWarn('账号', `${mode.value === 'register' ? '注册' : '登录'}失败`, message);
    error.value = message;
  } finally {
    setAutoSyncSuspended(false);
    busy.value = false;
  }
}

function finishRegister(): void {
  createdOpen.value = false;
  leaving = true;
  uni.redirectTo({ url: '/pages/onboarding/index' });
}

function copyText(text: string, title: string): void {
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title, icon: 'none' }),
  });
}

function openRecovery(): void {
  if (busy.value) return;
  recoveryUsername.value = username.value.trim();
  recoveryCode.value = '';
  recoveryEmailCode.value = '';
  recoveryPassword.value = '';
  recoveryConfirm.value = '';
  recoveryError.value = '';
  recoveryBusy.value = false;
  showRecoveryCode.value = false;
  showRecoveryPassword.value = false;
  showRecoveryConfirm.value = false;
  recoveryField.value = '';
  recoveryMethod.value = 'email';
  stopRecoveryTimer();
  recoveryCountdown.value = 0;
  recoveryOpen.value = true;
}

function closeRecovery(): void {
  if (recoveryBusy.value || recoverySending.value) return;
  recoveryOpen.value = false;
  stopRecoveryTimer();
}

function stopRecoveryTimer(): void {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
  }
}

function switchRecoveryMethod(method: 'email' | 'code'): void {
  if (recoveryBusy.value) return;
  recoveryMethod.value = method;
  recoveryError.value = '';
}

function startRecoveryCountdown(seconds = 60): void {
  stopRecoveryTimer();
  recoveryCountdown.value = seconds;
  recoveryTimer = setInterval(() => {
    recoveryCountdown.value -= 1;
    if (recoveryCountdown.value <= 0) stopRecoveryTimer();
  }, 1000);
}

async function sendRecoveryEmailCode(): Promise<void> {
  if (recoverySending.value || recoveryCountdown.value > 0) return;
  recoveryError.value = '';

  const name = recoveryUsername.value.trim();
  if (!name) {
    recoveryError.value = '请填写用户名';
    return;
  }

  recoverySending.value = true;
  try {
    await requestPasswordResetCode(name);
    startRecoveryCountdown(60);
    uni.showToast({ title: '如果绑定了邮箱，验证码已发送', icon: 'none' });
  } catch (err) {
    recoveryError.value = err instanceof Error ? err.message : '发送失败，请重试';
  } finally {
    recoverySending.value = false;
  }
}

onUnmounted(stopRecoveryTimer);

function focusRecoveryField(name: string): void {
  recoveryField.value = name;
  if (recoveryError.value) recoveryError.value = '';
}

function blurRecoveryField(): void {
  recoveryField.value = '';
}

function clearRecoveryError(): void {
  if (recoveryError.value) recoveryError.value = '';
}

/** 找回码允许用户带着空格 / 短横线粘贴，提交前统一成 16 位大写字母数字 */
function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

async function submitRecovery(): Promise<void> {
  if (recoveryBusy.value) return;
  recoveryError.value = '';

  const name = recoveryUsername.value.trim();
  if (!name) {
    recoveryError.value = '请填写用户名';
    return;
  }

  if (recoveryMethod.value === 'email') {
    const code = recoveryEmailCode.value.replace(/\D/g, '');
    if (code.length !== 6) {
      recoveryError.value = '验证码是 6 位数字';
      return;
    }
    if (!recoveryPassword.value) {
      recoveryError.value = '请填写新密码';
      return;
    }
    if (recoveryPassword.value.length < 8) {
      recoveryError.value = '新密码至少 8 位';
      return;
    }
    if (recoveryPassword.value !== recoveryConfirm.value) {
      recoveryError.value = '两次输入的新密码不一致';
      return;
    }

    recoveryBusy.value = true;
    setAutoSyncSuspended(true);
    try {
      const session = await resetPasswordByEmail(name, code, recoveryPassword.value);
      if (!(await settleRecoverySession(session, name))) return;
      setAutoSyncSuspended(false);
      finishRecovery();
    } catch (err) {
      recoveryError.value = err instanceof Error ? err.message : '重设失败，请重试';
    } finally {
      setAutoSyncSuspended(false);
      recoveryBusy.value = false;
    }
    return;
  }

  const code = normalizeRecoveryCode(recoveryCode.value);
  if (code.length !== 16) {
    recoveryError.value = '找回码是 16 位字母和数字';
    return;
  }
  if (!recoveryPassword.value) {
    recoveryError.value = '请填写新密码';
    return;
  }
  if (recoveryPassword.value.length < 8) {
    recoveryError.value = '新密码至少 8 位';
    return;
  }
  if (recoveryPassword.value !== recoveryConfirm.value) {
    recoveryError.value = '两次输入的新密码不一致';
    return;
  }

  recoveryBusy.value = true;
  setAutoSyncSuspended(true);
  try {
    const session = await resetPassword(name, code, recoveryPassword.value);
    if (!(await settleRecoverySession(session, name))) return;
    setAutoSyncSuspended(false);
    finishRecovery();
  } catch (err) {
    recoveryError.value = err instanceof Error ? err.message : '重设失败，请重试';
  } finally {
    setAutoSyncSuspended(false);
    recoveryBusy.value = false;
  }
}

/** 登录前先看服务器有没有数据；离线或接口失败时按 0 处理，走原有流程 */
async function fetchServerItemCount(): Promise<number> {
  try {
    const status = await fetchSyncStatus();
    return Number(status.counts?.item ?? 0);
  } catch {
    return 0;
  }
}

/**
 * 找回密码后会直接拿到登录态，跟登录一样先处理本机数据归属。
 * 返回 false 表示用户取消了这次登录（会话已清掉）。
 */
async function settleRecoverySession(session: AuthSession, name: string): Promise<boolean> {
  const serverItemCount = await fetchServerItemCount();
  const plan = await planLocalDataForExistingAccount(session.user.id, name, serverItemCount);
  if (plan === 'cancel') {
    clearSession();
    recoveryError.value = '已取消登录';
    return false;
  }

  await applyLocalDataPlan(plan, session.user.id);

  try {
    const removed = await removeDemoRows();
    if (removed) logInfo('账号', `找回密码后清掉了 ${removed} 处本机演示数据`);
  } catch (err) {
    console.warn('[login] 清理演示数据失败', err);
  }
  return true;
}

function finishRecovery(): void {
  recoveryOpen.value = false;
  stopRecoveryTimer();
  leaving = true;
  uni.showToast({ title: '密码已重设', icon: 'success' });
  void runAutoSync({ checkRemote: true });
  setTimeout(goBack, 500);
}
</script>

<template>
  <view class="auth">
    <!-- 上半屏：品牌封面 + 囤货箱。App 里没有固定的角色形象，这里不放，免得用户对不上 -->
    <view :class="['scene', mode === 'register' ? 'scene--short' : '']">
      <view class="scene-hero">
        <view class="scene-halo"></view>
        <view class="scene-seal">
          <text class="scene-seal__char">囤</text>
        </view>
        <text class="scene-name">囤物有数</text>
        <text class="scene-tag">家里的囤货，都算得清</text>
      </view>

      <image class="scene-pile" src="/static/login-pile.svg" mode="widthFix" />

      <view v-if="canGoBack" class="auth-close" hover-class="auth-close--press" :hover-stay-time="60" @click="goBack">
        <text>×</text>
      </view>
    </view>

    <!-- 下半屏：表单直接铺在页面上 -->
    <view class="form">
        <view class="auth-head">
          <text class="auth-head__title">{{ mode === 'login' ? '欢迎回来' : '创建你的账号' }}</text>
          <text class="auth-head__sub">
            {{ mode === 'login' ? '登录后换手机也能接上' : '只用用户名和密码，不用邮箱手机号' }}
          </text>
        </view>
        <view class="auth-tabs">
          <view
            :class="['auth-tab', mode === 'login' ? 'auth-tab--on' : '']"
            @click="switchMode('login')"
          >
            <text>登录</text>
          </view>
          <view
            :class="['auth-tab', mode === 'register' ? 'auth-tab--on' : '']"
            @click="switchMode('register')"
          >
            <text>注册</text>
          </view>
        </view>

        <view class="auth-field">
          <view class="auth-field__head">
            <text class="auth-field__label">用户名</text>
          </view>
          <view :class="['auth-field__box', activeField === 'username' ? 'auth-field__box--focus' : '']">
            <input
              v-model="username"
              class="auth-input"
              :placeholder="mode === 'login' ? '输入用户名' : '3-24 位字母、数字或下划线'"
              placeholder-class="auth-input__ph"
              :maxlength="24"
              autocomplete="username"
              @focus="focusField('username')"
              @blur="blurField"
              @input="clearError"
            />
          </view>
        </view>

        <view v-if="mode === 'register'" class="auth-field">
          <view class="auth-field__head">
            <text class="auth-field__label">昵称</text>
            <text class="auth-field__hint">选填</text>
          </view>
          <view :class="['auth-field__box', activeField === 'displayName' ? 'auth-field__box--focus' : '']">
            <input
              v-model="displayName"
              class="auth-input"
              placeholder="不填就用用户名"
              placeholder-class="auth-input__ph"
              :maxlength="24"
              @focus="focusField('displayName')"
              @blur="blurField"
              @input="clearError"
            />
          </view>
        </view>

        <view class="auth-field">
          <view class="auth-field__head">
            <text class="auth-field__label">密码</text>
            <text v-if="mode === 'login'" class="auth-field__link" @click="openRecovery">忘记密码？</text>
          </view>
          <view :class="['auth-field__box', activeField === 'password' ? 'auth-field__box--focus' : '']">
            <input
              v-model="password"
              class="auth-input"
              :password="!showPassword"
              :placeholder="mode === 'login' ? '输入密码' : '至少 8 位'"
              placeholder-class="auth-input__ph"
              :maxlength="72"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              @focus="focusField('password')"
              @blur="blurField"
              @input="clearError"
              @confirm="onPasswordConfirm"
            />
            <view
              class="auth-field__toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              hover-class="auth-field__toggle--press"
              :hover-stay-time="60"
              @click.stop="showPassword = !showPassword"
            >
              <image
                class="auth-field__toggle-icon"
                :src="showPassword ? '/static/icons/eye-off.svg' : '/static/icons/eye.svg'"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>

        <view v-if="mode === 'register'" class="auth-field">
          <view class="auth-field__head">
            <text class="auth-field__label">确认密码</text>
          </view>
          <view :class="['auth-field__box', activeField === 'confirm' ? 'auth-field__box--focus' : '']">
            <input
              v-model="confirm"
              class="auth-input"
              :password="!showConfirm"
              placeholder="再输一次"
              placeholder-class="auth-input__ph"
              :maxlength="72"
              autocomplete="new-password"
              @focus="focusField('confirm')"
              @blur="blurField"
              @input="clearError"
              @confirm="submit"
            />
            <view
              class="auth-field__toggle"
              :aria-label="showConfirm ? '隐藏密码' : '显示密码'"
              hover-class="auth-field__toggle--press"
              :hover-stay-time="60"
              @click.stop="showConfirm = !showConfirm"
            >
              <image
                class="auth-field__toggle-icon"
                :src="showConfirm ? '/static/icons/eye-off.svg' : '/static/icons/eye.svg'"
                mode="aspectFit"
              />
            </view>
          </view>
        </view>

        <view v-if="error" class="auth-error">
          <view class="auth-error__mark">!</view>
          <text class="auth-error__text">{{ error }}</text>
        </view>

        <view
          :class="['auth-submit', busy ? 'auth-submit--busy' : '']"
          hover-class="auth-submit--press"
          :hover-stay-time="60"
          @click="submit"
        >
          <text>{{ busy ? (mode === 'login' ? '登录中…' : '创建中…') : mode === 'login' ? '登录' : '创建账号' }}</text>
        </view>
        <view class="auth-guest" @click="goBack">
          <text>{{ canGoBack ? '返回上一页' : '先逛逛，不登录' }}</text>
          <text class="auth-guest__arrow">→</text>
        </view>
        <view class="auth-foot">账号只用于同步 · 密码加密保存</view>
    </view>

    <!-- 注册成功：找回码只显示这一次 -->
    <view v-if="createdOpen" class="auth-modal">
      <view class="auth-sheet auth-sheet--created">
        <view class="auth-sheet__badge">✓</view>
        <text class="auth-sheet__title">账号创建成功</text>
        <text class="auth-sheet__desc">
          这串找回码只显示这一次。忘记密码时，用它和新密码就能找回账号。
        </text>

        <view class="auth-code" @click="copyText(createdCode, '找回码已复制')">
          <text class="auth-code__text">{{ createdCode }}</text>
          <view class="auth-code__copy">
            <text>复制</text>
          </view>
        </view>

        <text class="auth-sheet__warn">建议截图或记在只有你能看到的地方。关闭后不会再次显示。</text>

        <view
          class="auth-sheet__primary"
          hover-class="auth-sheet__primary--press"
          :hover-stay-time="60"
          @click="finishRegister"
        >
          <text>我已保存，继续</text>
        </view>
      </view>
    </view>

    <!-- 忘记密码：用户名 + 找回码 + 新密码 -->
    <view v-if="recoveryOpen" class="auth-modal" @click="closeRecovery">
      <view class="auth-sheet" @click.stop>
        <view class="auth-sheet__head">
          <view class="auth-sheet__heading">
            <text class="auth-sheet__title">找回密码</text>
            <text class="auth-sheet__sub">
              {{ recoveryMethod === 'email' ? '验证码会发到账号绑定的邮箱' : '用注册时保存的找回码重设' }}
            </text>
          </view>
          <view class="auth-sheet__close" @click="closeRecovery">
            <text>×</text>
          </view>
        </view>

        <view class="auth-sheet__body">
          <view class="recovery-tabs">
            <view
              :class="['recovery-tab', recoveryMethod === 'email' ? 'recovery-tab--on' : '']"
              @click="switchRecoveryMethod('email')"
            >
              邮箱验证码
            </view>
            <view
              :class="['recovery-tab', recoveryMethod === 'code' ? 'recovery-tab--on' : '']"
              @click="switchRecoveryMethod('code')"
            >
              找回码
            </view>
          </view>

          <view class="auth-field">
            <view class="auth-field__head">
              <text class="auth-field__label">用户名</text>
            </view>
            <view :class="['auth-field__box', recoveryField === 'username' ? 'auth-field__box--focus' : '']">
              <input
                v-model="recoveryUsername"
                class="auth-input"
                placeholder="注册时的用户名"
                placeholder-class="auth-input__ph"
                :maxlength="24"
                autocomplete="username"
                @focus="focusRecoveryField('username')"
                @blur="blurRecoveryField"
                @input="clearRecoveryError"
              />
            </view>
          </view>

          <view v-if="recoveryMethod === 'code'" class="auth-field">
            <view class="auth-field__head">
              <text class="auth-field__label">找回码</text>
              <text class="auth-field__hint">16 位，短横线可以不带</text>
            </view>
            <view :class="['auth-field__box', recoveryField === 'code' ? 'auth-field__box--focus' : '']">
              <input
                v-model="recoveryCode"
                class="auth-input"
                :password="!showRecoveryCode"
                placeholder="例如 A3K9-2MXP-7QRT-8WYZ"
                placeholder-class="auth-input__ph"
                :maxlength="24"
                autocomplete="one-time-code"
                @focus="focusRecoveryField('code')"
                @blur="blurRecoveryField"
                @input="clearRecoveryError"
              />
              <view
                class="auth-field__toggle"
                :aria-label="showRecoveryCode ? '隐藏找回码' : '显示找回码'"
                hover-class="auth-field__toggle--press"
                :hover-stay-time="60"
                @click.stop="showRecoveryCode = !showRecoveryCode"
              >
                <image
                  class="auth-field__toggle-icon"
                  :src="showRecoveryCode ? '/static/icons/eye-off.svg' : '/static/icons/eye.svg'"
                  mode="aspectFit"
                />
              </view>
            </view>
          </view>

          <view v-else class="auth-field">
            <view class="auth-field__head">
              <text class="auth-field__label">邮箱验证码</text>
              <text class="auth-field__hint">6 位数字，10 分钟内有效</text>
            </view>
            <view :class="['auth-field__box', recoveryField === 'email-code' ? 'auth-field__box--focus' : '']">
              <input
                v-model="recoveryEmailCode"
                class="auth-input"
                type="number"
                placeholder="6 位数字"
                placeholder-class="auth-input__ph"
                :maxlength="6"
                autocomplete="one-time-code"
                @focus="focusRecoveryField('email-code')"
                @blur="blurRecoveryField"
                @input="clearRecoveryError"
              />
              <view
                :class="['auth-code-send', recoveryCountdown > 0 || recoverySending ? 'auth-code-send--off' : '']"
                @click.stop="sendRecoveryEmailCode"
              >
                {{ recoverySending ? '发送中…' : recoveryCountdown > 0 ? `${recoveryCountdown}s` : '发送验证码' }}
              </view>
            </view>
          </view>

          <view class="auth-field">
            <view class="auth-field__head">
              <text class="auth-field__label">新密码</text>
              <text class="auth-field__hint">至少 8 位</text>
            </view>
            <view :class="['auth-field__box', recoveryField === 'password' ? 'auth-field__box--focus' : '']">
              <input
                v-model="recoveryPassword"
                class="auth-input"
                :password="!showRecoveryPassword"
                placeholder="设置一个新密码"
                placeholder-class="auth-input__ph"
                :maxlength="72"
                autocomplete="new-password"
                @focus="focusRecoveryField('password')"
                @blur="blurRecoveryField"
                @input="clearRecoveryError"
              />
              <view
                class="auth-field__toggle"
                :aria-label="showRecoveryPassword ? '隐藏密码' : '显示密码'"
                hover-class="auth-field__toggle--press"
                :hover-stay-time="60"
                @click.stop="showRecoveryPassword = !showRecoveryPassword"
              >
                <image
                  class="auth-field__toggle-icon"
                  :src="showRecoveryPassword ? '/static/icons/eye-off.svg' : '/static/icons/eye.svg'"
                  mode="aspectFit"
                />
              </view>
            </view>
          </view>

          <view class="auth-field">
            <view class="auth-field__head">
              <text class="auth-field__label">确认新密码</text>
            </view>
            <view :class="['auth-field__box', recoveryField === 'confirm' ? 'auth-field__box--focus' : '']">
              <input
                v-model="recoveryConfirm"
                class="auth-input"
                :password="!showRecoveryConfirm"
                placeholder="再输一次"
                placeholder-class="auth-input__ph"
                :maxlength="72"
                autocomplete="new-password"
                @focus="focusRecoveryField('confirm')"
                @blur="blurRecoveryField"
                @input="clearRecoveryError"
                @confirm="submitRecovery"
              />
              <view
                class="auth-field__toggle"
                :aria-label="showRecoveryConfirm ? '隐藏密码' : '显示密码'"
                hover-class="auth-field__toggle--press"
                :hover-stay-time="60"
                @click.stop="showRecoveryConfirm = !showRecoveryConfirm"
              >
                <image
                  class="auth-field__toggle-icon"
                  :src="showRecoveryConfirm ? '/static/icons/eye-off.svg' : '/static/icons/eye.svg'"
                  mode="aspectFit"
                />
              </view>
            </view>
          </view>

          <view v-if="recoveryError" class="auth-error">
            <view class="auth-error__mark">!</view>
            <text class="auth-error__text">{{ recoveryError }}</text>
          </view>

          <view
            :class="['auth-sheet__primary', recoveryBusy ? 'auth-submit--busy' : '']"
            hover-class="auth-sheet__primary--press"
            :hover-stay-time="60"
            @click="submitRecovery"
          >
            <text>{{ recoveryBusy ? '请稍候…' : '重设密码并登录' }}</text>
          </view>

          <text class="auth-sheet__note">
            {{ recoveryMethod === 'email'
              ? '验证码发到账号绑定的邮箱。没绑定邮箱的话，切到「找回码」；两样都没有，联系小囤帮你重置。'
              : '找回码在注册时生成，登录后也可以在「我的 → 个人信息」里重新生成。旧码用过一次就失效。' }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style>
/* 字标用字：站酷快乐体（SIL OFL 1.1），只取了「囤物有数」四个字形（1.1KB），内嵌成 data URL，
   免去 App 端读本地字体路径的麻烦。源文件与授权文本在 src/static/fonts/。 */
@font-face {
  font-family: 'TunwuWordmark';
  src: url(data:font/woff2;base64,d09GMgABAAAAAAQQAAwAAAAABvAAAAPCAAIAQgAAAAAAAAAAAAAAAAAAAAAAAAAAHCAGYABMEQgKhTiEYwE2AiQDDgsMAAQgBYNeByAbvAUIjsK2tXPMmCQpR/CAZuLhv/3S++bPBoBVTjQAa8ASKYkoXIUDdq0joWv0Dv/e/k/DtTgoLGn1TH/JzKoreYHucEHu00M9kZ3L21naOtqnPC/Q+xsFND9gwEMBimjEAgaxbYYErw6FDpdJSETbv0CgRp8wovW6Fgw4yFC2AXIxPaYpke4mCgB747i4ALIiGwyvym9yclxbDY4RT3voYIttHMUTrxGQpM8YIkJCgTawQBvENKBGlSQdPFVZNI49dDYb6JN3/QtmzPs9eSEIlApRtmlkS1S9LfX4AcRVAEAGFLIkVyGhId5eiEugWwCC4GWSaqFV3EJIjGKWjMZDSBzDSILEK7AQZ1C3SmJtBImTJCadKmf/tXq+CgZhfYwgUd8KEwXBCgW06hS4UjhRRdbdycYDcFyWgXdLSRIvkYaxoNmbZGQRSHjNY3KcVzwoV7TSJZiBxDP4Si5F62yCy1gcE75Zi9Vh9UpTUk4SGK8omf9/6WLeoXt+bw12DXvrniYNHt8ZgLDxT57FmCWOOcsC3cT7Q733TXD1HS52C9mx5rxP8Xdp0hf7lqEu+b4rxC7uvVSOnjvORgDrHRqFt5xD8MbayMR5TEDkgB0o143yE5pz+fHQqHMIGiif3JrDT6xHULG8im/NqVGu5Mfkr3zVkjtiP3EajzaBYe9bcyXj6Iu3g9JrFEe6k4vMdmFO3KefrLMLt9qnr7WiqqKMcBKHdnbB4m64gYrY9MQxtCMa5N5w/af57XlHxtJQJGz1QSSw/477DcVDFg1EAlKsEW780NBM2kkkkTvFFKLgwpKdw7gLdg4jd0WQuE3k+fngjZgSj31hs+PBgg7xOyJKHxA2PSqid++q9A4+L/S2XUgkcX082cb4R46oQB2uSGDHG6fsxLOQoYN8mS5vh1scbH/0YYQvsy4OXbJvHyKcui21MP5SC5xl3cn4WXcBEEhWp+M8v0ndS745wPBLgH+jgmgA+L/8wU7bL5s2+8HTUSGB4FeovJ1iu2l72nwtJQqYi3kmhGkRTISSZ5rFQQUji2YqnYCh7Aj4CAehy4EgafA3KMx7GGQjERKU9ETN8xWGQwKqCSz660FHQ6uXCFkyZCogYAFTtRjV2h1aULJZbzxdnkBHgRbokVR0VKbQaxtCjJ7YT6AlhgXqIunOauiSrd7k0ratwBQ+Egg0jFTUBGZCz24HUHDPKJXhAmY8LPE2dHlo8CkjXg9Z0mS81V+MQatVDSo0/e1IrVjw+Vl5S1A9LXX3b0ScXsW5AmayyouMAgA=) format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

.auth {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: env(safe-area-inset-bottom);
  overflow-x: hidden;
  background: linear-gradient(180deg, #fdf3dd 0%, #f8e9c9 44%, #f6e5c2 100%);
}

/* ---------- 上半屏：品牌封面 + 囤货箱 ---------- */
.scene {
  --hero-bottom: 96px;
  --seal: 54px;
  --seal-font: 31px;
  --seal-radius: 15px;
  --name-size: 29px;
  --name-ls: 3px;

  position: relative;
  flex: none;
  height: clamp(228px, 40vh, 344px);
  overflow: hidden;
  transition: height 0.24s ease;
}

/* 注册态多两个输入框，收一收上半屏，让按钮不用滚也能看到 */
.scene--short {
  --hero-bottom: 88px;
  --seal: 46px;
  --seal-font: 26px;
  --seal-radius: 12px;
  --name-size: 22px;
  --name-ls: 2px;

  height: clamp(172px, 27vh, 236px);
}

.scene-hero {
  position: absolute;
  top: calc(var(--status-bar-height, env(safe-area-inset-top, 0px)) + 8px);
  right: 0;
  bottom: var(--hero-bottom);
  left: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 光晕要压在最底下：它是定位元素，不显式降层会盖住后面未定位的招牌和文字 */
.scene-halo {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: -1;
  width: 230px;
  height: 230px;
  margin: -115px 0 0 -115px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 226, 160, 0.95), rgba(255, 226, 160, 0) 70%);
}

/* 章：奶油纸底 + 双线铜边，字用宋体，像盖在纸上的戳，不再是一块沉甸甸的色块 */
.scene-seal {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: var(--seal);
  height: var(--seal);
  border: 1.5px solid #b0894f;
  border-radius: var(--seal-radius);
  background: #fffaf0;
  box-shadow: 0 4px 10px rgba(143, 92, 15, 0.1);
  transform: rotate(-3deg);
  transition: width 0.24s ease, height 0.24s ease, border-radius 0.24s ease;
}

.scene-seal__char {
  color: #8a5a0e;
  font-family: 'TunwuWordmark', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: var(--seal-font);
  font-weight: 400;
  line-height: 1;
}

.scene-name {
  margin-top: 18px;
  color: #3a2b16;
  font-family: 'TunwuWordmark', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: var(--name-size);
  font-weight: 400;
  letter-spacing: var(--name-ls);
  text-indent: var(--name-ls);
}

.scene-tag {
  margin-top: 9px;
  color: #9a8763;
  font-size: 12.5px;
  letter-spacing: 0.5px;
}

.scene--short .scene-name {
  margin-top: 12px;
}

.scene--short .scene-tag {
  display: none;
}

/* 注册态上半屏矮，货箱跟着往下压一点，别顶到字上 */
.scene--short .scene-pile {
  transform: translate(-50%, 14px);
}

.scene-pile {
  position: absolute;
  left: 50%;
  bottom: 0;
  z-index: 3;
  width: 100%;
  max-width: 560px;
  transform: translateX(-50%);
  pointer-events: none;
}

/* 纸箱底部融进表单底色，避免一条生硬的横切线 */
.scene::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 5;
  height: 28px;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(248, 233, 201, 0), rgba(248, 233, 201, 0.9));
}

/* ---------- 下半屏：表单 ---------- */
.form {
  position: relative;
  z-index: 4;
  flex: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  padding: 14px 26px 18px;
}

.auth-close {
  position: absolute;
  top: calc(var(--status-bar-height, env(safe-area-inset-top, 0px)) + 10px);
  right: 16px;
  z-index: 4;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 253, 248, 0.72);
  color: #a08a5f;
  font-size: 17px;
  line-height: 27px;
  text-align: center;
}

.auth-close--press {
  background: #eddfc6;
}

/* 上下两处 auto：屏幕富余时把空档均分到标题上方和脚注下方，矮屏溢出时自动归零 */
.auth-head {
  margin-top: auto;
  padding-top: 2px;
}

.auth-head__title {
  display: block;
  color: #3a2b16;
  font-size: 25px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.4px;
}

.auth-head__sub {
  display: block;
  margin-top: 5px;
  color: #9a8763;
  font-size: 12px;
  line-height: 1.5;
}

.auth-tabs {
  display: flex;
  gap: 26px;
  margin-top: 20px;
  border-bottom: 1px solid rgba(154, 101, 20, 0.14);
}

.auth-tab {
  position: relative;
  padding: 0 2px 9px;
  color: #a08a5f;
  font-size: 14px;
  text-align: center;
  transition: color 0.18s;
}

.auth-tab--on {
  color: #3a2b16;
  font-weight: 600;
}

.auth-tab--on::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: #9a6514;
}

.auth-field {
  margin-top: 11px;
}

.auth-field__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}

.auth-field__label {
  color: #8a7350;
  font-size: 11.5px;
}

.auth-field__hint {
  color: #b09a72;
  font-size: 9.5px;
}

/* 行内小按钮，字号跟正文差一档就够；padding 撑出约 26px 高的可点区域，
   负 margin 把多出来的空间收回去，不改变字段行间距 */
.auth-field__link {
  color: #9a6514;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  padding: 6px 2px;
  margin: -6px -2px -6px 0;
}

.auth-field__box {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 42px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: #f8f2e5;
  transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
}

.auth-field__box--focus {
  border-color: #d7b06a;
  background: #fffdf8;
  box-shadow: 0 0 0 3px rgba(201, 154, 63, 0.1);
}

/* 主表单里改成下划线输入，不再是一个个方盒子 */
.form .auth-field {
  margin-top: 20px;
}

.form .auth-field__box {
  height: 44px;
  padding: 0;
  border: none;
  border-bottom: 1.5px solid rgba(154, 101, 20, 0.22);
  border-radius: 0;
  background: transparent;
}

.form .auth-field__box--focus {
  border-bottom-color: #9a6514;
  background: transparent;
  box-shadow: none;
}

.form .auth-input {
  font-size: 15px;
}

.form .auth-input__ph {
  font-size: 15px;
}

.auth-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  color: #3a2b16;
  font-size: 13.5px;
}

.auth-input__ph {
  color: #b7a37a;
  font-size: 13.5px;
}

/* 睁眼 = 点一下显示，带斜线 = 点一下隐藏，和原来的「显示 / 隐藏」文案同一个顺序 */
.auth-field__toggle {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  margin-left: 4px;
}

.auth-field__toggle-icon {
  width: 20px;
  height: 20px;
  opacity: 0.9;
}

.auth-field__toggle--press {
  opacity: 0.5;
}

/* 错误行：不套色块，跟着下划线表单走，只用暖红字 + 圈 ! */
.auth-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 12px;
  color: #a8452a;
}

.auth-error__mark {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border: 1.4px solid currentColor;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  line-height: 11px;
  text-align: center;
}

.auth-error__text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.5;
}

.auth-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  margin-top: 26px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ab7522, #8f5c0f);
  color: #fffdf8;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
  box-shadow: 0 8px 18px rgba(143, 92, 15, 0.28);
  transition: transform 0.15s, opacity 0.15s;
}

.auth-submit--press {
  transform: scale(0.995);
  opacity: 0.94;
}

.auth-submit--busy {
  opacity: 0.62;
  pointer-events: none;
}

.auth-guest {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  margin-top: 16px;
  padding: 4px;
  color: #8b7550;
  font-size: 12.5px;
}

.auth-guest__arrow {
  color: #9a6514;
}

.auth-foot {
  margin-top: auto;
  padding-top: 14px;
  color: #b3a181;
  font-size: 10px;
  letter-spacing: 0.2px;
  text-align: center;
}

/* 矮屏（375×667 一类）整体收一档，保证按钮和「先逛逛」不用滚就能看到 */
@media (max-height: 700px) {
  .scene {
    height: 34vh;
  }

  .scene {
    --hero-bottom: 104px;
    --seal: 56px;
    --seal-font: 29px;
    --seal-radius: 18px;
    --name-size: 20px;
    --name-ls: 1.5px;
  }

  .scene--short {
    --hero-bottom: 96px;
    --seal: 44px;
    --seal-font: 24px;
    --seal-radius: 14px;
    --name-size: 19px;
    --name-ls: 1px;

    height: 30vh;
  }

  .scene-tag {
    display: none;
  }

  .scene-name {
    margin-top: 10px;
  }

  .form {
    padding: 10px 24px 12px;
  }

  .auth-head__title {
    font-size: 22px;
  }

  .auth-tabs {
    margin-top: 14px;
  }

  .form .auth-field {
    margin-top: 12px;
  }

  .form .auth-field__box {
    height: 40px;
  }

  .auth-submit {
    height: 46px;
    margin-top: 16px;
  }
}

/* 注册成功 / 忘记密码共用的弹层 */
.auth-modal {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px 14px calc(16px + env(safe-area-inset-bottom));
  overflow-y: auto;
  background: rgba(46, 34, 18, 0.38);
  backdrop-filter: blur(3px);
}

.auth-sheet {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 332px;
  margin: auto;
  max-height: calc(100dvh - 32px - env(safe-area-inset-bottom));
  overflow-y: auto;
  padding: 20px 18px 16px;
  border-radius: 20px;
  background: #fffdf8;
  box-shadow: 0 18px 44px rgba(60, 42, 18, 0.24);
  animation: auth-card-in 0.2s ease-out;
}

.auth-sheet--created {
  padding: 24px 20px 20px;
  text-align: center;
}

.auth-sheet__badge {
  width: 44px;
  height: 44px;
  margin: 0 auto;
  border-radius: 50%;
  background: linear-gradient(150deg, #5c7d4f, #406035);
  color: #fffdf8;
  font-size: 20px;
  font-weight: 600;
  line-height: 44px;
  box-shadow: 0 6px 14px rgba(64, 96, 53, 0.22);
}

.auth-sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.auth-sheet__heading {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.auth-sheet__title {
  display: block;
  color: #3a2b16;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
}

.auth-sheet--created .auth-sheet__title {
  margin-top: 10px;
  font-size: 19px;
}

.auth-sheet__sub {
  color: #9a8763;
  font-size: 11px;
  line-height: 1.5;
}

.auth-sheet__close {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: #f6eeda;
  color: #a08a5f;
  font-size: 16px;
  line-height: 25px;
  text-align: center;
}

.auth-sheet__body {
  margin-top: 2px;
}

.auth-sheet__desc {
  display: block;
  margin-top: 8px;
  color: #826b47;
  font-size: 12px;
  line-height: 1.7;
}

.auth-code {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  padding: 14px 12px 14px 16px;
  border: 1px dashed #d7b06a;
  border-radius: 12px;
  background: #faf4e8;
}

.auth-code__text {
  flex: 1;
  min-width: 0;
  color: #3a2b16;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.6px;
  line-height: 1.45;
}

.auth-code__copy {
  flex: none;
  padding: 6px 10px;
  border-radius: 999px;
  background: #3a2b16;
  color: #fffdf8;
  font-size: 11px;
}

.auth-sheet__warn {
  display: block;
  margin-top: 10px;
  color: #b07a2a;
  font-size: 10.5px;
  line-height: 1.65;
  text-align: left;
}

.auth-sheet__primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  margin-top: 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ab7522, #8f5c0f);
  color: #fffdf8;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.5px;
  box-shadow: 0 7px 14px rgba(143, 92, 15, 0.26);
  transition: transform 0.15s, opacity 0.15s;
}

.auth-sheet__primary--press {
  transform: scale(0.995);
  opacity: 0.94;
}

.auth-sheet__note {
  display: block;
  margin-top: 10px;
  color: #a08a5f;
  font-size: 9.5px;
  line-height: 1.6;
  text-align: center;
}

@media (min-width: 900px) {
  .auth-modal {
    align-items: center;
    padding: 24px;
  }

  .auth-sheet {
    max-width: 332px;
    padding: 20px 18px 16px;
    border-radius: 20px;
  }

  .auth-sheet--created {
    max-width: 320px;
    padding: 26px 20px 20px;
  }
}

@media (max-width: 360px) {
  .auth {
    padding-left: 12px;
    padding-right: 12px;
  }

  .auth-head__title {
    font-size: 19px;
  }

  .auth-card {
    padding-left: 12px;
    padding-right: 12px;
  }
}

.recovery-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  padding: 4px;
  border-radius: 999px;
  background: #f3e9d6;
}

.recovery-tab {
  flex: 1;
  padding: 7px 0;
  border-radius: 999px;
  color: #8b7550;
  font-size: 12.5px;
  text-align: center;
}

.recovery-tab--on {
  background: #fffdf8;
  color: #3a2b16;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(58, 43, 22, 0.12);
}

.auth-code-send {
  flex: none;
  margin-right: 10px;
  padding: 5px 10px;
  border-radius: 999px;
  background: #f3e3c4;
  color: #8a621e;
  font-size: 11.5px;
  line-height: 1.3;
  white-space: nowrap;
}

.auth-code-send--off {
  opacity: 0.5;
}
</style>
