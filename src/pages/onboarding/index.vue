<script setup lang="ts">
/**
 * 初见管家：新注册账号的第一次引导。
 *
 * 只做一件事——给管家起名字、挑性格，保存进本机的 pet_persona。
 * 注册成功的新账号先进来；本机还没走完（完成或跳过）时，重启 App 也会先回到这里。
 * 已有账号登录直接回主页，之后可在「我的 → 我的管家」改。
 * 不再展示 3D 形象；这里只保存名字和性格，视觉沿用「囤」字印章。
 */
import { computed, reactive, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { usePersonaStore } from '@/stores/persona';
import { getSession, type AuthSession } from '@/services/auth';
import { clearOnboardingPending } from '@/services/onboarding';
import { PERSONALITY_PRESETS } from '@/constants/personality';
import {
  DEFAULT_PERSONA,
  PERSONA_CUSTOM_MAX,
  PERSONA_NAME_MAX,
  type PersonalityId,
} from '@/types/pet';

const persona = usePersonaStore();

const session = ref<AuthSession | null>(null);
const busy = ref(false);
const error = ref('');
let prefilled = false;

const draft = reactive({
  name: DEFAULT_PERSONA.name,
  personality: DEFAULT_PERSONA.personality as PersonalityId,
  custom: '',
});

const nameSuggestions = ['小囤', '栗子', '松松', '豆豆'];
const personaIcons: Record<Exclude<PersonalityId, 'custom'>, string> = {
  gentle: '🌿',
  sharp: '🌶️',
  genki: '✨',
  calm: '🧊',
};
// 引导页卡片窄，用短句；完整说明留在「我的管家」设置页
const personaHints: Record<Exclude<PersonalityId, 'custom'>, string> = {
  gentle: '先问人，再谈库存',
  sharp: '嘴上嫌弃，建议实在',
  genki: '每天都给你打气',
  calm: '只说重点，不寒暄',
};

const greeting = computed(
  () => session.value?.user.displayName || session.value?.user.username || '',
);
const canSave = computed(() => {
  if (!draft.name.trim()) return false;
  if (draft.personality === 'custom' && !draft.custom.trim()) return false;
  return true;
});

onLoad(() => {
  session.value = getSession();
  if (!session.value) {
    uni.redirectTo({ url: '/pages/login/index' });
  }
});

onShow(async () => {
  try {
    await persona.load(true);
  } catch (err) {
    console.error(err);
  }
  if (prefilled) return;
  prefilled = true;
  draft.name = persona.name || DEFAULT_PERSONA.name;
  draft.personality = persona.personality;
  draft.custom = persona.custom;
});

function pick(id: PersonalityId): void {
  draft.personality = id;
  error.value = '';
}

function useName(name: string): void {
  draft.name = name;
  error.value = '';
}

async function finish(): Promise<void> {
  if (busy.value) return;
  error.value = '';

  const name = draft.name.trim();
  if (!name) {
    error.value = '先给它起个名字吧';
    return;
  }
  if (draft.personality === 'custom' && !draft.custom.trim()) {
    error.value = '写两句它的脾气，或者换一个预设';
    return;
  }

  busy.value = true;
  try {
    const saved = await persona.save({
      name,
      personality: draft.personality,
      custom: draft.custom,
    });
    if (session.value) clearOnboardingPending(session.value.user.id);
    uni.showToast({ title: `${saved.name}记住你啦`, icon: 'none' });
    setTimeout(() => {
      uni.switchTab({ url: '/pages/items/index' });
    }, 650);
  } catch (err) {
    console.error(err);
    error.value = '保存失败，再试一次';
  } finally {
    busy.value = false;
  }
}

function skip(): void {
  // 明确跳过也算走完，不再每次打开都拦一次
  if (session.value) clearOnboardingPending(session.value.user.id);
  uni.switchTab({ url: '/pages/items/index' });
}
</script>

<template>
  <view class="onboarding">
    <view class="welcome">
      <view class="welcome__eyebrow">
        <view class="welcome__dot"></view>
        <text>{{ greeting ? `欢迎，${greeting}` : '账号已就绪' }}</text>
      </view>
      <view class="welcome__title">
        先认识一下
        <text class="welcome__title-strong">你的囤物管家</text>
      </view>
      <view class="welcome__sub">
        帮你记库存、盯临期，乱囤时还会念叨两句。
      </view>
    </view>

    <view class="card name-card">
      <view class="field-head">
        <text class="field-label">它叫什么？</text>
        <text class="field-count">{{ draft.name.length }}/{{ PERSONA_NAME_MAX }}</text>
      </view>
      <input
        v-model="draft.name"
        class="name-input"
        :maxlength="PERSONA_NAME_MAX"
        placeholder="给管家起个名字"
        placeholder-class="name-input__ph"
      />
      <view class="suggestions">
        <view
          v-for="name in nameSuggestions"
          :key="name"
          :class="['suggestion', draft.name === name ? 'suggestion--on' : '']"
          @click="useName(name)"
        >
          {{ name }}
        </view>
      </view>
    </view>

    <view class="field-head persona-head">
      <text class="field-label">它是什么脾气？</text>
      <text class="field-hint">以后能改</text>
    </view>

    <view class="persona-grid">
      <view
        v-for="preset in PERSONALITY_PRESETS"
        :key="preset.id"
        :class="['persona-card', draft.personality === preset.id ? 'persona-card--on' : '']"
        @click="pick(preset.id)"
      >
        <text class="persona-card__icon">{{ personaIcons[preset.id] }}</text>
        <view class="persona-card__label">{{ preset.label }}</view>
        <view class="persona-card__hint">{{ personaHints[preset.id] }}</view>
        <view class="persona-card__check">✓</view>
      </view>
    </view>

    <view
      :class="['custom-card', draft.personality === 'custom' ? 'custom-card--on' : '']"
      @click="pick('custom')"
    >
      <text class="custom-card__icon">✎</text>
      <view class="custom-card__main">
        <view class="custom-card__label">自定义性格</view>
        <view class="custom-card__hint">自己写它说话的样子</view>
      </view>
      <view class="custom-card__check">✓</view>
    </view>

    <view v-if="draft.personality === 'custom'" class="custom-editor">
      <textarea
        v-model="draft.custom"
        class="custom-editor__input"
        :maxlength="PERSONA_CUSTOM_MAX"
        placeholder="比如：说话像东北室友，爱用歇后语，催我补货的时候别客气"
        placeholder-class="name-input__ph"
      />
      <view class="custom-editor__count">{{ draft.custom.length }}/{{ PERSONA_CUSTOM_MAX }}</view>
    </view>

    <view v-if="error" class="form-error">{{ error }}</view>

    <view class="footnote">名字和性格会跟着备份、同步一起走，之后在「我的 → 我的管家」里也能改。</view>

    <view class="dock">
      <view
        :class="['cta', busy || !canSave ? 'cta--off' : '']"
        @click="finish"
      >
        {{ busy ? '正在记住…' : `就叫它「${draft.name.trim() || '管家'}」` }}
      </view>
      <view class="later" @click="skip">稍后再说，先用默认设定</view>
    </view>
  </view>
</template>

<style>
.onboarding {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 20rpx 24rpx 280rpx;
  background:
    radial-gradient(80% 30% at 50% 0%, rgba(242, 201, 106, 0.18) 0%, rgba(242, 201, 106, 0) 72%),
    #fdf6e6;
}

.welcome {
  padding: 12rpx 8rpx 18rpx;
}

.welcome__eyebrow {
  display: flex;
  align-items: center;
  width: fit-content;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #f3e4c6;
  color: #7a5110;
  font-size: 22rpx;
  line-height: 1.4;
}

.welcome__dot {
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #9a6514;
}

.welcome__title {
  margin-top: 22rpx;
  color: #3a2b16;
  font-size: 46rpx;
  font-weight: 700;
  line-height: 1.36;
}

.welcome__title-strong {
  display: block;
  color: #9a6514;
}

.welcome__sub {
  margin-top: 14rpx;
  max-width: 590rpx;
  color: #826b47;
  font-size: 24rpx;
  line-height: 1.65;
}

.card.name-card {
  margin-bottom: 0;
  padding: 24rpx 26rpx 20rpx;
  border-radius: 26rpx;
}

.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.field-label {
  color: #3a2b16;
  font-size: 28rpx;
  font-weight: 600;
}

.field-count,
.field-hint {
  color: #9a8055;
  font-size: 21rpx;
}

.name-input {
  height: 78rpx;
  margin-top: 6rpx;
  color: #3a2b16;
  font-size: 34rpx;
  font-weight: 600;
}

.name-input__ph {
  color: #b7a37a;
  font-weight: 400;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  margin-top: 4rpx;
}

.suggestion {
  margin: 10rpx 12rpx 0 0;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: #fdf6e6;
  color: #7a633f;
  font-size: 22rpx;
  line-height: 1.4;
}

.suggestion--on {
  background: #f3e4c6;
  color: #7a5110;
}

.persona-head {
  margin: 30rpx 6rpx 14rpx;
}

.persona-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.persona-card {
  position: relative;
  width: calc(50% - 8rpx);
  box-sizing: border-box;
  margin-bottom: 16rpx;
  padding: 20rpx 20rpx 22rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
  transition: border-color 0.18s ease, background 0.18s ease;
}

.persona-card--on {
  border-color: #9a6514;
  background: #fffaf0;
}

.persona-card__icon {
  font-size: 34rpx;
  line-height: 1.2;
}

.persona-card__label {
  margin-top: 10rpx;
  color: #3a2b16;
  font-size: 27rpx;
  font-weight: 600;
}

.persona-card__hint {
  margin-top: 6rpx;
  min-height: 30rpx;
  color: #9a8055;
  font-size: 21rpx;
  line-height: 1.45;
}

.persona-card__check,
.custom-card__check {
  position: absolute;
  top: 16rpx;
  right: 16rpx;
  width: 32rpx;
  height: 32rpx;
  box-sizing: border-box;
  border: 2rpx solid #e8dcc1;
  border-radius: 50%;
  color: transparent;
  font-size: 19rpx;
  line-height: 28rpx;
  text-align: center;
}

.persona-card--on .persona-card__check,
.custom-card--on .custom-card__check {
  border-color: #9a6514;
  background: #9a6514;
  color: #ffffff;
}

.custom-card {
  position: relative;
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.custom-card--on {
  border-color: #9a6514;
  background: #fffaf0;
}

.custom-card__icon {
  width: 54rpx;
  color: #9a6514;
  font-size: 32rpx;
}

.custom-card__main {
  flex: 1;
}

.custom-card__label {
  color: #3a2b16;
  font-size: 27rpx;
  font-weight: 600;
}

.custom-card__hint {
  margin-top: 4rpx;
  color: #9a8055;
  font-size: 21rpx;
}

.custom-card__check {
  position: static;
  margin-left: 16rpx;
  flex-shrink: 0;
}

.custom-editor {
  position: relative;
  margin-top: 14rpx;
  padding: 22rpx 22rpx 38rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.custom-editor__input {
  width: 100%;
  height: 150rpx;
  color: #3a2b16;
  font-size: 25rpx;
  line-height: 1.6;
}

.custom-editor__count {
  position: absolute;
  right: 22rpx;
  bottom: 14rpx;
  color: #b7a37a;
  font-size: 20rpx;
}

.form-error {
  margin: 16rpx 6rpx 0;
  color: #b8433a;
  font-size: 22rpx;
  line-height: 1.5;
}

.footnote {
  margin: 28rpx 10rpx 0;
  color: #a08a5f;
  font-size: 21rpx;
  line-height: 1.65;
}

.dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 50rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(253, 246, 230, 0) 0%, #fdf6e6 34%);
}

.cta {
  height: 94rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  box-shadow: 0 12rpx 28rpx rgba(58, 43, 22, 0.18);
  color: #ffffff;
  font-size: 30rpx;
  line-height: 94rpx;
  text-align: center;
  transition: opacity 0.18s ease;
}

.cta--off {
  opacity: 0.42;
}

.later {
  margin-top: 16rpx;
  color: #7a633f;
  font-size: 23rpx;
  text-align: center;
  text-decoration: underline;
}
</style>
