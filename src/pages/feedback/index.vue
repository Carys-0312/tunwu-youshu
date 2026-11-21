<script setup lang="ts">
/**
 * 意见反馈：选类型、写内容、可选留联系方式。
 * 提交只发送这段文字和版本信息，不会带库存、账号密码或照片。
 */
import { computed, onMounted, ref } from 'vue';
import { fetchMyFeedback, submitFeedback, type FeedbackCategory, type MyFeedbackItem } from '@/services/feedback';
import { isLoggedIn } from '@/services/auth';
import { markFeedbackRepliesSeen } from '@/services/feedback-reply';

const CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: 'feature', label: '功能建议' },
  { id: 'problem', label: '使用问题' },
  { id: 'recognition', label: '识别不准' },
  { id: 'other', label: '其他' },
];

const MAX_CONTENT = 2000;
const MAX_CONTACT = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const category = ref<FeedbackCategory>('feature');
const content = ref('');
const contact = ref('');
const submitting = ref(false);
const appVersion = __APP_VERSION__;

const loggedIn = isLoggedIn();
const myFeedback = ref<MyFeedbackItem[]>([]);

const STATUS_LABELS: Record<string, string> = {
  new: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

function categoryLabel(value: FeedbackCategory): string {
  return CATEGORIES.find((item) => item.id === value)?.label || '反馈';
}

function statusLabel(value: string): string {
  return STATUS_LABELS[value] || '待处理';
}

async function loadMine(): Promise<void> {
  if (!loggedIn) return;
  try {
    myFeedback.value = await fetchMyFeedback();
    markFeedbackRepliesSeen(myFeedback.value);
  } catch {
    // 回信加载失败不影响提交反馈
  }
}

onMounted(loadMine);

const platform = (() => {
  try {
    const info = uni.getSystemInfoSync();
    const name = info.uniPlatform === 'web' ? 'H5' : info.uniPlatform || info.platform || 'App';
    return `${name} ${info.system ?? ''}`.trim();
  } catch {
    return '';
  }
})();

const canSubmit = computed(() => content.value.trim().length > 0 && !submitting.value);

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (!content.value.trim()) {
    uni.showToast({ title: '先写两句再提交', icon: 'none' });
    return;
  }
  const email = contact.value.trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    uni.showToast({ title: '邮箱格式不太对，检查一下', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    await submitFeedback({
      category: category.value,
      content: content.value.trim(),
      contact: email || undefined,
      appVersion,
      platform,
    });
    uni.showToast({ title: '收到，谢谢你', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 600);
  } catch (err) {
    uni.showModal({
      title: '提交失败',
      content: err instanceof Error ? err.message : '稍后再试一次',
      showCancel: false,
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__title">哪里不好用，直接说</view>
      <view class="hero__desc">不用客气。反馈匿名提交，不会带上你的库存数据。</view>
    </view>

    <view class="section-title">
      <text>反馈类型</text>
    </view>
    <view class="card">
      <view class="chips">
        <view
          v-for="item in CATEGORIES"
          :key="item.id"
          :class="['chip', category === item.id ? 'chip--on' : '']"
          @click="category = item.id"
        >
          {{ item.label }}
        </view>
      </view>
    </view>

    <view class="section-title">
      <text>具体说说</text>
      <text class="muted">{{ content.length }}/{{ MAX_CONTENT }}</text>
    </view>
    <view class="card">
      <textarea
        v-model="content"
        class="content"
        :maxlength="MAX_CONTENT"
        placeholder="比如：扫描日期时经常识别成生产日期；希望月报能按品类筛选……"
        placeholder-class="ph"
      />
    </view>

    <view class="section-title">
      <text>邮箱</text>
      <text class="muted">选填</text>
    </view>
    <view class="card">
      <input
        v-model="contact"
        class="contact"
        :maxlength="MAX_CONTACT"
        placeholder="name@example.com"
        placeholder-class="ph"
      />
      <view class="contact__hint">不填也能提交；填了邮箱的话，小囤的回信会同时发到邮箱。</view>
    </view>

    <template v-if="myFeedback.length">
      <view class="section-title">
        <text>我的反馈与回信</text>
        <text class="muted">{{ myFeedback.length }} 条</text>
      </view>
      <view class="card mine">
        <view v-for="item in myFeedback" :key="item.id" class="mine__item">
          <view class="mine__head">
            <text class="mine__cat">{{ categoryLabel(item.category) }}</text>
            <text :class="['mine__status', `mine__status--${item.status}`]">{{ statusLabel(item.status) }}</text>
            <text class="mine__time">{{ item.createdAt }}</text>
          </view>
          <view class="mine__content">{{ item.content }}</view>
          <view v-if="item.reply" class="mine__reply">
            <view class="mine__reply-title">小囤的回复</view>
            <view class="mine__reply-text">{{ item.reply }}</view>
          </view>
        </view>
      </view>
    </template>
    <view v-else-if="!loggedIn" class="mine__guest">
      登录后提交的反馈，可以在这里收到回信。
    </view>

    <view class="save-bar">
      <view class="save" :class="{ 'save--off': !canSubmit }" @click="submit">
        {{ submitting ? '提交中…' : '提交反馈' }}
      </view>
    </view>
  </view>
</template>

<style>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 24rpx 24rpx calc(180rpx + env(safe-area-inset-bottom));
  background: #fdf6e6;
}

.hero {
  padding: 8rpx 8rpx 12rpx;
}

.hero__title {
  font-size: 40rpx;
  font-weight: 600;
  color: #3a2b16;
}

.hero__desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #826b47;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  margin: -7rpx;
}

.chip {
  margin: 7rpx;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #faf3e3;
  color: #826b47;
  font-size: 24rpx;
  line-height: 1.3;
}

.chip--on {
  background: #3a2b16;
  color: #ffffff;
}

.content {
  width: 100%;
  height: 240rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  line-height: 1.7;
  color: #3a2b16;
}

.ph {
  color: #b7a37a;
}

.contact {
  height: 80rpx;
  font-size: 28rpx;
  color: #3a2b16;
}

.contact__hint {
  margin-top: 10rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: #9a8055;
}

.mine {
  padding: 0 24rpx;
}

.mine__item {
  padding: 26rpx 0;
  border-bottom: 1rpx solid #f0e4cc;
}

.mine__item:last-child {
  border-bottom: 0;
}

.mine__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.mine__cat {
  font-size: 24rpx;
  color: #9a6514;
  font-weight: 600;
}

.mine__status {
  padding: 2rpx 14rpx;
  border-radius: 999rpx;
  background: #f6ecd8;
  color: #826b47;
  font-size: 20rpx;
}

.mine__status--processing {
  background: #fdf0d2;
  color: #9a6514;
}

.mine__status--resolved {
  background: #e8f2e6;
  color: #2f6f4f;
}

.mine__status--closed {
  background: #efe9df;
  color: #7a6a52;
}

.mine__time {
  margin-left: auto;
  font-size: 20rpx;
  color: #a08a5f;
}

.mine__content {
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #3a2b16;
}

.mine__reply {
  margin-top: 16rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: #fdf3dc;
  border-left: 6rpx solid #f2c96a;
}

.mine__reply-title {
  font-size: 21rpx;
  color: #9a6514;
  font-weight: 600;
}

.mine__reply-text {
  margin-top: 8rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #5b4526;
  white-space: pre-wrap;
}

.mine__guest {
  margin: 28rpx 8rpx 0;
  font-size: 22rpx;
  line-height: 1.6;
  color: #a08a5f;
  text-align: center;
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
  background: #c9bca7;
  box-shadow: 0 10rpx 24rpx rgba(58, 43, 22, 0.12);
}
</style>
