<script setup lang="ts">
/**
 * 管家设置：名字 + 性格。
 *
 * 存在本机的 schema_meta 里，会跟着导出备份和服务器同步走；
 * 问答时这份设定会一起发给服务端，由服务端拼进系统提示词。
 * 3D 形象暂时不展示，组件和素材仍保留。
 */
import { computed, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { usePersonaStore } from '@/stores/persona';
import { PERSONALITY_PRESETS } from '@/constants/personality';
import {
  DEFAULT_PERSONA,
  PERSONA_CUSTOM_MAX,
  PERSONA_NAME_MAX,
  type PersonalityId,
} from '@/types/pet';

const persona = usePersonaStore();

const draft = reactive({
  name: '',
  personality: 'gentle' as PersonalityId,
  custom: '',
});

onShow(async () => {
  try {
    await persona.load();
  } catch (err) {
    console.error(err);
  }
  draft.name = persona.name;
  draft.personality = persona.personality;
  draft.custom = persona.custom;
});

const canSave = computed(() => {
  if (!draft.name.trim()) return false;
  if (draft.personality === 'custom' && !draft.custom.trim()) return false;
  return true;
});

function pick(id: PersonalityId): void {
  draft.personality = id;
}

function resetDefault(): void {
  draft.name = DEFAULT_PERSONA.name;
  draft.personality = DEFAULT_PERSONA.personality;
  draft.custom = '';
}

async function save(): Promise<void> {
  if (!canSave.value) {
    uni.showToast({ title: '名字不能空，自定义性格也要写两句', icon: 'none' });
    return;
  }
  try {
    await persona.save({
      name: draft.name,
      personality: draft.personality,
      custom: draft.custom,
    });
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 350);
  } catch (err) {
    console.error(err);
    uni.showToast({ title: '保存失败，再试一次', icon: 'none' });
  }
}
</script>

<template>
  <view class="page">
    <view class="section-title">
      <text>名字</text>
      <text class="muted">{{ draft.name.length }}/{{ PERSONA_NAME_MAX }}</text>
    </view>
    <view class="card">
      <input
        v-model="draft.name"
        class="name-input"
        :maxlength="PERSONA_NAME_MAX"
        placeholder="给管家起个名字"
        placeholder-class="name-input__ph"
      />
    </view>

    <view class="section-title">
      <text>性格</text>
      <text class="muted">会影响它说话的方式</text>
    </view>
    <view class="card">
      <view
        v-for="preset in PERSONALITY_PRESETS"
        :key="preset.id"
        :class="['persona', draft.personality === preset.id ? 'persona--on' : '']"
        @click="pick(preset.id)"
      >
        <view class="persona__main">
          <view class="persona__label">{{ preset.label }}</view>
          <view class="persona__hint">{{ preset.hint }}</view>
        </view>
        <view class="persona__check">{{ draft.personality === preset.id ? '✓' : '' }}</view>
      </view>

      <view
        :class="['persona', draft.personality === 'custom' ? 'persona--on' : '']"
        @click="pick('custom')"
      >
        <view class="persona__main">
          <view class="persona__label">自定义</view>
          <view class="persona__hint">自己写它是什么脾气</view>
        </view>
        <view class="persona__check">{{ draft.personality === 'custom' ? '✓' : '' }}</view>
      </view>

      <textarea
        v-if="draft.personality === 'custom'"
        v-model="draft.custom"
        class="custom"
        :maxlength="PERSONA_CUSTOM_MAX"
        placeholder="比如：说话像东北室友，爱用歇后语，催我补货的时候别客气"
        placeholder-class="name-input__ph"
      />
      <view v-if="draft.personality === 'custom'" class="custom-meta">
        <text>最多 {{ PERSONA_CUSTOM_MAX }} 个字符</text>
        <text
          :class="[
            'custom-meta__count',
            draft.custom.length >= PERSONA_CUSTOM_MAX ? 'custom-meta__count--full' : '',
          ]"
        >
          {{ draft.custom.length }}/{{ PERSONA_CUSTOM_MAX }}
        </text>
      </view>
    </view>

    <view class="reset" @click="resetDefault">恢复默认（小囤 · 温柔体贴）</view>

    <view class="save-bar">
      <view class="save" :class="{ 'save--off': !canSave }" @click="save">保存</view>
    </view>
  </view>
</template>

<style>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  /* 给底部悬浮的保存按钮留出空间 */
  padding: 24rpx 24rpx calc(180rpx + env(safe-area-inset-bottom));
  background: #fdf6e6;
}

.name-input {
  height: 88rpx;
  font-size: 32rpx;
  color: #3a2b16;
}

.name-input__ph {
  color: #b7a37a;
}

.persona {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #f0e4ca;
}

.persona:last-child {
  border-bottom: none;
}

.persona__label {
  font-size: 28rpx;
  color: #3a2b16;
}

.persona__hint {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #9a8055;
}

.persona__check {
  width: 44rpx;
  height: 44rpx;
  margin-left: 16rpx;
  border-radius: 50%;
  border: 2rpx solid #e8dcc1;
  text-align: center;
  line-height: 44rpx;
  font-size: 24rpx;
  color: transparent;
}

.persona--on .persona__check {
  border-color: #9a6514;
  background: #9a6514;
  color: #ffffff;
}

.custom {
  width: 100%;
  height: 180rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border-radius: 16rpx;
  background: #fdf9ef;
  font-size: 26rpx;
  line-height: 1.6;
  color: #3a2b16;
}

.custom-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding: 0 4rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #a08a5f;
}

.custom-meta__count {
  font-variant-numeric: tabular-nums;
}

.custom-meta__count--full {
  color: #b4552d;
}

.save-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  z-index: 30;
  display: flex;
  justify-content: center;
  padding: 0 24rpx;
  pointer-events: none;
}

.save {
  width: 100%;
  max-width: 640px;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #ffffff;
  text-align: center;
  font-size: 30rpx;
  box-shadow: 0 14rpx 34rpx rgba(58, 43, 22, 0.24);
  pointer-events: auto;
}

.save--off {
  /* 用实色而不是整体降透明度，避免悬浮时透出下面的文字 */
  background: #c9bca7;
  box-shadow: 0 10rpx 24rpx rgba(58, 43, 22, 0.12);
}

.reset {
  margin-top: 28rpx;
  text-align: center;
  font-size: 24rpx;
  color: #a08a5f;
}
</style>
