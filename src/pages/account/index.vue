<script setup lang="ts">
/**
 * 个人信息：换头像、改昵称、改密码、生成找回码。
 * 资料存在服务端账号里，登录同一账号的其他设备也能看到。
 */
import { computed, onUnmounted, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import {
  bindEmail,
  changePassword,
  fetchMe,
  generateRecoveryCode,
  getSession,
  requestEmailBindCode,
  updateProfile,
  type AuthSession,
} from '@/services/auth';
import { pickAvatar } from '@/services/avatar';

const session = ref<AuthSession | null>(getSession());
const nickname = ref('');
const avatar = ref('');
const avatarChanged = ref(false);
const boundEmail = ref('');

// 绑定邮箱：发验证码 → 60 秒倒计时 → 确认
const emailOpen = ref(false);
const emailInput = ref('');
const emailCode = ref('');
const emailSending = ref(false);
const emailBinding = ref(false);
const emailError = ref('');
const emailCountdown = ref(0);
let emailTimer: ReturnType<typeof setInterval> | null = null;

const savingProfile = ref(false);
const savingPassword = ref(false);
const profileError = ref('');
const passwordError = ref('');
const passwordForm = reactive({ current: '', next: '', confirm: '' });

// 找回码：用当前密码生成，明文只展示一次
const recoveryCurrent = ref('');
const recoveryCode = ref('');
const issuingRecovery = ref(false);
const recoveryError = ref('');
const recoveryOpen = ref(false);

// 输入时才出现的字数 / 规则提示
const nicknameFocused = ref(false);
const passwordFocused = ref(false);
const nicknameCount = computed(() => nickname.value.length);
const showNicknameHint = computed(() => nicknameFocused.value || nicknameCount.value > 0);
const nextPasswordLength = computed(() => passwordForm.next.length);
const showPasswordHint = computed(() => passwordFocused.value || nextPasswordLength.value > 0);
const confirmMismatch = computed(
  () => passwordForm.confirm.length > 0 && passwordForm.confirm !== passwordForm.next,
);

onShow(async () => {
  if (!getSession()) {
    uni.redirectTo({ url: '/pages/login/index' });
    return;
  }
  session.value = getSession();
  nickname.value = session.value?.user.displayName || '';
  avatar.value = session.value?.user.avatar || '';
  boundEmail.value = session.value?.user.email || '';

  try {
    const user = await fetchMe();
    session.value = getSession();
    nickname.value = user.displayName || '';
    avatar.value = user.avatar || '';
    boundEmail.value = user.email || '';
    avatarChanged.value = false;
  } catch (err) {
    // 拉不到最新资料就先按本机缓存的显示，不影响改名和改密码
    console.error(err);
  }
});

async function chooseAvatar(): Promise<void> {
  try {
    const dataUrl = await pickAvatar();
    avatar.value = dataUrl;
    avatarChanged.value = true;
    profileError.value = '';
  } catch (err) {
    if (err instanceof Error && err.message.includes('取消')) return;
    uni.showToast({
      title: err instanceof Error ? err.message : '换头像失败',
      icon: 'none',
    });
  }
}

async function saveProfile(): Promise<void> {
  if (savingProfile.value) return;
  profileError.value = '';

  const name = nickname.value.trim();
  if (!name) {
    profileError.value = '昵称不能为空';
    return;
  }
  if (name.length > 24) {
    profileError.value = '昵称最多 24 个字符';
    return;
  }

  savingProfile.value = true;
  try {
    const user = await updateProfile({
      displayName: name,
      // 没换过头像就不重复传整张图
      avatar: avatarChanged.value ? avatar.value : null,
    });
    session.value = getSession();
    nickname.value = user.displayName;
    avatar.value = user.avatar || '';
    avatarChanged.value = false;
    uni.showToast({ title: '已保存', icon: 'success' });
  } catch (err) {
    profileError.value = err instanceof Error ? err.message : '保存失败';
  } finally {
    savingProfile.value = false;
  }
}

async function savePassword(): Promise<void> {
  if (savingPassword.value) return;
  passwordError.value = '';

  if (!passwordForm.current) {
    passwordError.value = '请输入当前密码';
    return;
  }
  if (passwordForm.next.length < 8) {
    passwordError.value = '新密码至少 8 位';
    return;
  }
  if (passwordForm.next !== passwordForm.confirm) {
    passwordError.value = '两次输入的新密码不一致';
    return;
  }
  if (passwordForm.next === passwordForm.current) {
    passwordError.value = '新密码不能和当前密码一样';
    return;
  }

  savingPassword.value = true;
  try {
    await changePassword(passwordForm.current, passwordForm.next);
    passwordForm.current = '';
    passwordForm.next = '';
    passwordForm.confirm = '';
    uni.showToast({ title: '密码已修改', icon: 'success' });
  } catch (err) {
    passwordError.value = err instanceof Error ? err.message : '修改失败';
  } finally {
    savingPassword.value = false;
  }
}

async function issueRecoveryCode(): Promise<void> {
  if (issuingRecovery.value) return;
  recoveryError.value = '';

  if (!recoveryCurrent.value) {
    recoveryError.value = '请输入当前密码';
    return;
  }

  issuingRecovery.value = true;
  try {
    recoveryCode.value = await generateRecoveryCode(recoveryCurrent.value);
    recoveryCurrent.value = '';
    recoveryOpen.value = true;
  } catch (err) {
    recoveryError.value = err instanceof Error ? err.message : '生成失败，请重试';
  } finally {
    issuingRecovery.value = false;
  }
}

function copyRecoveryCode(): void {
  uni.setClipboardData({
    data: recoveryCode.value,
    success: () => uni.showToast({ title: '找回码已复制', icon: 'none' }),
  });
}

function stopEmailTimer(): void {
  if (emailTimer) {
    clearInterval(emailTimer);
    emailTimer = null;
  }
}

function openEmailBind(): void {
  emailOpen.value = true;
  emailInput.value = boundEmail.value || '';
  emailCode.value = '';
  emailError.value = '';
  emailCountdown.value = 0;
  stopEmailTimer();
}

function closeEmailBind(): void {
  if (emailSending.value || emailBinding.value) return;
  emailOpen.value = false;
  stopEmailTimer();
}

function startEmailCountdown(seconds = 60): void {
  stopEmailTimer();
  emailCountdown.value = seconds;
  emailTimer = setInterval(() => {
    emailCountdown.value -= 1;
    if (emailCountdown.value <= 0) stopEmailTimer();
  }, 1000);
}

async function sendEmailCode(): Promise<void> {
  if (emailSending.value || emailCountdown.value > 0) return;
  emailError.value = '';

  const email = emailInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailError.value = '邮箱格式不太对';
    return;
  }

  emailSending.value = true;
  try {
    await requestEmailBindCode(email);
    startEmailCountdown(60);
    uni.showToast({ title: '验证码已发送，检查邮箱', icon: 'none' });
  } catch (err) {
    emailError.value = err instanceof Error ? err.message : '发送失败，请重试';
  } finally {
    emailSending.value = false;
  }
}

async function confirmEmailBind(): Promise<void> {
  if (emailBinding.value) return;
  emailError.value = '';

  const email = emailInput.value.trim();
  const code = emailCode.value.replace(/\D/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailError.value = '邮箱格式不太对';
    return;
  }
  if (code.length !== 6) {
    emailError.value = '验证码是 6 位数字';
    return;
  }

  emailBinding.value = true;
  try {
    const user = await bindEmail(email, code);
    boundEmail.value = user.email || email;
    session.value = getSession();
    emailOpen.value = false;
    stopEmailTimer();
    uni.showToast({ title: '邮箱已绑定', icon: 'success' });
  } catch (err) {
    emailError.value = err instanceof Error ? err.message : '绑定失败，请重试';
  } finally {
    emailBinding.value = false;
  }
}

onUnmounted(stopEmailTimer);
</script>

<template>
  <view class="page account-page">
    <view class="section-title">
      <text>头像</text>
    </view>
    <view class="card avatar-card">
      <view class="avatar-wrap" @click="chooseAvatar">
        <image v-if="avatar" class="avatar" :src="avatar" mode="aspectFill" />
        <view v-if="!avatar" class="avatar avatar--empty">
          <text class="avatar__upload">上传头像</text>
        </view>
        <view v-if="avatar" class="avatar__overlay">上传头像</view>
      </view>
      <view class="avatar-card__text">
        <view class="avatar-card__title">
          {{ session?.user.displayName || session?.user.username || '—' }}
        </view>
        <view class="avatar-card__sub">@{{ session?.user.username }}</view>
      </view>
    </view>

    <view class="section-title">
      <text>基本信息</text>
    </view>
    <view class="card">
      <view class="field">
        <view class="field__head">
          <text class="field__label">昵称</text>
          <text v-if="showNicknameHint" class="field__hint">{{ nicknameCount }}/24 字</text>
        </view>
        <input
          v-model="nickname"
          class="field__input"
          placeholder="给自己起个名字"
          :maxlength="24"
          @focus="nicknameFocused = true"
          @blur="nicknameFocused = false"
        />
      </view>
      <view class="field">
        <text class="field__label">用户名</text>
        <view class="field__value">@{{ session?.user.username }}</view>
      </view>

      <view v-if="profileError" class="error">{{ profileError }}</view>
      <view :class="['btn', savingProfile ? 'btn--busy' : '']" @click="saveProfile">
        {{ savingProfile ? '保存中…' : '保存' }}
      </view>
    </view>

    <view class="section-title">
      <text>邮箱</text>
      <text class="muted">{{ boundEmail ? '已绑定' : '未绑定' }}</text>
    </view>
    <view class="card">
      <view class="field">
        <text class="field__label">绑定邮箱</text>
        <view class="field__value">{{ boundEmail || '还没有绑定' }}</view>
      </view>
      <view class="recovery-note">
        绑定后，忘记密码可以直接用邮箱验证码重置，不用再依赖找回码。邮箱只用于登录验证，不会收到其他消息。
      </view>
      <view class="btn" @click="openEmailBind">
        {{ boundEmail ? '更换邮箱' : '绑定邮箱' }}
      </view>
    </view>

    <view class="section-title">
      <text>修改密码</text>
    </view>
    <view class="card">
      <view class="field">
        <text class="field__label">当前密码</text>
        <input
          v-model="passwordForm.current"
          class="field__input"
          password
          placeholder="输入现在的密码"
          :maxlength="72"
          autocomplete="current-password"
        />
      </view>
      <view class="field">
        <view class="field__head">
          <text class="field__label">新密码</text>
          <text
            v-if="showPasswordHint"
            :class="['field__hint', nextPasswordLength >= 8 ? 'field__hint--ok' : '']"
          >
            已输入 {{ nextPasswordLength }} 位 · 至少 8 位
          </text>
        </view>
        <input
          v-model="passwordForm.next"
          class="field__input"
          password
          placeholder="至少 8 位"
          :maxlength="72"
          autocomplete="new-password"
          @focus="passwordFocused = true"
          @blur="passwordFocused = false"
        />
      </view>
      <view class="field">
        <view class="field__head">
          <text class="field__label">确认新密码</text>
          <text v-if="confirmMismatch" class="field__hint field__hint--warn">两次输入不一致</text>
        </view>
        <input
          v-model="passwordForm.confirm"
          class="field__input"
          password
          placeholder="再输一次新密码"
          :maxlength="72"
          autocomplete="new-password"
        />
      </view>

      <view v-if="passwordError" class="error">{{ passwordError }}</view>
      <view :class="['btn', savingPassword ? 'btn--busy' : '']" @click="savePassword">
        {{ savingPassword ? '提交中…' : '修改密码' }}
      </view>
    </view>

    <view class="section-title">
      <text>找回密码</text>
    </view>
    <view class="card">
      <view class="recovery-note">
        忘了密码时，优先用上面绑定的邮箱验证码重置；没绑邮箱就用这串找回码。找回码只显示一次，生成新的以后旧码立即失效。
      </view>
      <view class="field">
        <text class="field__label">当前密码</text>
        <input
          v-model="recoveryCurrent"
          class="field__input"
          password
          placeholder="验证身份后生成"
          :maxlength="72"
          autocomplete="current-password"
          @confirm="issueRecoveryCode"
        />
      </view>

      <view v-if="recoveryError" class="error">{{ recoveryError }}</view>
      <view :class="['btn', issuingRecovery ? 'btn--busy' : '']" @click="issueRecoveryCode">
        {{ issuingRecovery ? '生成中…' : '生成新的找回码' }}
      </view>
    </view>

    <view v-if="recoveryOpen" class="code-modal" @click="recoveryOpen = false">
      <view class="code-sheet" @click.stop>
        <view class="code-sheet__title">新的找回码</view>
        <view class="code-sheet__desc">只显示这一次，旧找回码已经失效。</view>

        <view class="code-box" @click="copyRecoveryCode">
          <text class="code-box__text">{{ recoveryCode }}</text>
          <view class="code-box__copy">复制</view>
        </view>

        <view class="code-sheet__warn">
          建议截图保存。忘记密码时，用「用户名 + 这串码 + 新密码」重设。
        </view>
        <view class="btn" @click="recoveryOpen = false">我已保存</view>
      </view>
    </view>

    <!-- 绑定邮箱：邮箱 + 验证码 -->
    <view v-if="emailOpen" class="code-modal" @click="closeEmailBind">
      <view class="code-sheet" @click.stop>
        <view class="code-sheet__title">{{ boundEmail ? '更换邮箱' : '绑定邮箱' }}</view>
        <view class="code-sheet__desc">验证码会发到这个邮箱，10 分钟内有效。</view>

        <view class="field">
          <text class="field__label">邮箱</text>
          <input
            v-model="emailInput"
            class="field__input"
            type="text"
            placeholder="name@example.com"
            :maxlength="120"
            :disabled="emailBinding"
          />
        </view>

        <view class="field">
          <text class="field__label">验证码</text>
          <view class="email-code-row">
            <input
              v-model="emailCode"
              class="field__input email-code-row__input"
              type="number"
              placeholder="6 位数字"
              :maxlength="6"
              :disabled="emailBinding"
            />
            <view
              :class="['email-code-row__btn', emailCountdown > 0 || emailSending ? 'email-code-row__btn--off' : '']"
              @click="sendEmailCode"
            >
              {{ emailSending ? '发送中…' : emailCountdown > 0 ? `${emailCountdown}s` : '发送验证码' }}
            </view>
          </view>
        </view>

        <view v-if="emailError" class="error">{{ emailError }}</view>
        <view :class="['btn', emailBinding ? 'btn--busy' : '']" @click="confirmEmailBind">
          {{ emailBinding ? '绑定中…' : '确认绑定' }}
        </view>
        <view class="code-sheet__close" @click="closeEmailBind">稍后再说</view>
      </view>
    </view>
  </view>
</template>

<style>
.account-page {
  padding-bottom: 80rpx;
}

.avatar-card {
  display: flex;
  align-items: center;
}

.avatar-wrap {
  position: relative;
  flex: none;
  width: 128rpx;
  height: 128rpx;
  margin-right: 24rpx;
  border-radius: 50%;
  overflow: hidden;
  background: #e8d5ae;
}

.avatar {
  display: block;
  width: 100%;
  height: 100%;
}

.avatar--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8d5ae;
}

.avatar__upload {
  font-size: 21rpx;
  line-height: 1.3;
  color: #9a6514;
  letter-spacing: 1rpx;
}

.avatar__overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6rpx 0;
  background: rgba(58, 43, 22, 0.55);
  color: #fff8e6;
  font-size: 19rpx;
  line-height: 1.4;
  text-align: center;
}

.avatar-card__text {
  flex: 1;
  min-width: 0;
}

.avatar-card__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #3a2b16;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avatar-card__sub {
  margin-top: 8rpx;
  font-size: 23rpx;
  color: #9a8055;
}

.field {
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f0e4ca;
}

.field:last-of-type {
  border-bottom: none;
}

.field__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field__label {
  font-size: 24rpx;
  color: #826b47;
}

.field__hint {
  font-size: 22rpx;
  color: #a08a5f;
}

.field__hint--ok {
  color: #9a6514;
}

.field__hint--warn {
  color: #b8433a;
}

.field__input {
  margin-top: 10rpx;
  font-size: 30rpx;
  height: 44rpx;
  line-height: 44rpx;
}

.field__value {
  margin-top: 10rpx;
  font-size: 30rpx;
  color: #9a8055;
}

.recovery-note {
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: #faf4e8;
  color: #8b7550;
  font-size: 23rpx;
  line-height: 1.65;
}

.code-modal {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 20px 16px;
  background: rgba(46, 34, 18, 0.38);
  backdrop-filter: blur(3px);
}

.code-sheet {
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  padding: 24px 22px 20px;
  border-radius: 20px;
  background: #fffdf8;
  box-shadow: 0 24px 60px rgba(46, 34, 18, 0.28);
  animation: code-sheet-in 0.22s ease-out;
}

@keyframes code-sheet-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.code-sheet__title {
  color: #3a2b16;
  font-size: 18px;
  font-weight: 600;
}

.code-sheet__desc {
  margin-top: 5px;
  color: #8b7550;
  font-size: 12px;
  line-height: 1.5;
}

.code-box {
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

.code-box__text {
  flex: 1;
  min-width: 0;
  color: #3a2b16;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.8px;
  line-height: 1.45;
  word-break: normal;
}

@media (min-width: 380px) {
  .code-box__text {
    font-size: 16px;
    letter-spacing: 1px;
  }
}

@media (max-width: 340px) {
  .code-box__text {
    font-size: 13px;
    letter-spacing: 0.3px;
  }
}

.code-box__copy {
  flex: none;
  padding: 6px 10px;
  border-radius: 999px;
  background: #3a2b16;
  color: #fffdf8;
  font-size: 11px;
}

.code-sheet__warn {
  margin-top: 10px;
  color: #b07a2a;
  font-size: 10.5px;
  line-height: 1.65;
}

.error {
  margin: 20rpx 0 0;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  background: #fbe9e4;
  color: #b8433a;
  font-size: 23rpx;
  line-height: 1.5;
}

.btn {
  margin-top: 28rpx;
  padding: 24rpx 0;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #ffffff;
  text-align: center;
  font-size: 29rpx;
}

.btn--busy {
  opacity: 0.6;
}

.email-code-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 10rpx;
}

.email-code-row__input {
  flex: 1;
  min-width: 0;
  margin-top: 0;
  height: 76rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  background: #faf4e8;
}

.email-code-row__btn {
  flex: none;
  padding: 18rpx 22rpx;
  border-radius: 999rpx;
  background: #f3e3c4;
  color: #8a621e;
  font-size: 24rpx;
  line-height: 1.2;
}

.email-code-row__btn--off {
  opacity: 0.5;
}

.code-sheet__close {
  margin-top: 22rpx;
  color: #a08a5f;
  font-size: 13px;
  text-align: center;
}
</style>
