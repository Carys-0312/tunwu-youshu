<script setup lang="ts">
/**
 * 运行日志：把账号、同步、识别这些关键动作记在本机，方便排查手机上的问题。
 * 纯只读展示 + 复制 / 清空，不提供上传。
 */
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { clearLogs, readLogs, type LogLevel, type RunLogEntry } from '@/services/logger';

type LevelFilter = 'all' | LogLevel;

const filters: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
];

const logs = ref<RunLogEntry[]>([]);
const level = ref<LevelFilter>('all');

onShow(() => {
  logs.value = readLogs();
});

const shown = computed(() =>
  level.value === 'all' ? logs.value : logs.value.filter((entry) => entry.level === level.value),
);

const counts = computed(() => {
  const out = { info: 0, warn: 0, error: 0 };
  for (const entry of logs.value) out[entry.level] += 1;
  return out;
});

function pick(next: LevelFilter): void {
  level.value = next;
}

function format(entry: RunLogEntry): string {
  return `${entry.at} [${entry.scope}] ${entry.message}${entry.detail ? ` — ${entry.detail}` : ''}`;
}

function copyAll(): void {
  if (!logs.value.length) {
    uni.showToast({ title: '还没有日志', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data: logs.value.map(format).join('\n'),
    success: () => uni.showToast({ title: '日志已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，可以截图反馈', icon: 'none' }),
  });
}

function clearAll(): void {
  if (!logs.value.length) return;
  uni.showModal({
    title: '清空运行日志？',
    content: '只清掉这台设备上的记录，不影响账号和物品数据。',
    confirmText: '清空',
    confirmColor: '#b4482f',
    success: (res) => {
      if (!res.confirm) return;
      clearLogs();
      logs.value = [];
      uni.showToast({ title: '已清空', icon: 'none' });
    },
  });
}
</script>

<template>
  <view class="page logs-page">
    <view class="intro">
      <view class="intro__title">记录账号、同步和识别</view>
      <view class="intro__sub">
        只存在这台设备上，不会同步、不进备份；密码、找回码和照片内容都不会记进来。
      </view>
      <view class="intro__stats">
        <text>共 {{ logs.length }} 条</text>
        <text v-if="counts.warn" class="intro__stat intro__stat--warn">警告 {{ counts.warn }}</text>
        <text v-if="counts.error" class="intro__stat intro__stat--error">错误 {{ counts.error }}</text>
      </view>
    </view>

    <view class="toolbar">
      <view class="chips">
        <view
          v-for="item in filters"
          :key="item.value"
          :class="['chip', level === item.value ? 'chip--on' : '']"
          hover-class="chip--press"
          :hover-stay-time="60"
          @click="pick(item.value)"
        >
          <text>{{ item.label }}</text>
        </view>
      </view>
      <view class="tools">
        <text class="tool" @click="copyAll">复制</text>
        <text class="tool tool--danger" @click="clearAll">清空</text>
      </view>
    </view>

    <view v-if="!logs.length" class="empty">
      <view class="empty__title">还没有日志</view>
      <view class="empty__desc">登录、同步、识别之后，这里会出现记录</view>
    </view>
    <view v-else-if="!shown.length" class="empty">
      <view class="empty__title">这一级别还没有记录</view>
      <view class="empty__desc">切回「全部」看看</view>
    </view>

    <view v-else class="list">
      <view
        v-for="entry in shown"
        :key="entry.id"
        :class="['row', `row--${entry.level}`]"
      >
        <view class="row__head">
          <text class="row__scope">{{ entry.scope }}</text>
          <text class="row__time">{{ entry.at.slice(5) }}</text>
        </view>
        <view class="row__msg">{{ entry.message }}</view>
        <view v-if="entry.detail" class="row__detail">{{ entry.detail }}</view>
      </view>
    </view>
  </view>
</template>

<style>
page {
  background: #fdf6e6;
}

.logs-page {
  min-height: calc(100vh - var(--window-top, 0px));
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 48rpx);
  box-sizing: border-box;
  background:
    radial-gradient(120% 32% at 88% 0%, rgba(255, 226, 160, 0.5), rgba(255, 226, 160, 0) 68%),
    linear-gradient(180deg, #fdf6e6 0%, #faf0d8 100%);
}

.intro {
  padding: 26rpx 26rpx 22rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.1);
  border-radius: 26rpx;
  background: rgba(255, 253, 246, 0.78);
  box-shadow: 0 12rpx 28rpx rgba(143, 92, 15, 0.05);
}

.intro__title {
  color: #3a2b16;
  font-size: 30rpx;
  font-weight: 600;
}

.intro__sub {
  margin-top: 10rpx;
  color: #8b7550;
  font-size: 23rpx;
  line-height: 1.6;
}

.intro__stats {
  display: flex;
  align-items: center;
  margin-top: 14rpx;
  color: #a08a5f;
  font-size: 22rpx;
}

.intro__stat {
  margin-left: 16rpx;
}

.intro__stat--warn {
  color: #b26a1a;
}

.intro__stat--error {
  color: #b4482f;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22rpx 4rpx 16rpx;
}

.chips {
  display: flex;
  align-items: center;
}

.chip {
  margin-right: 12rpx;
  padding: 10rpx 22rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.14);
  border-radius: 999rpx;
  background: rgba(255, 253, 246, 0.7);
  color: #826b47;
  font-size: 23rpx;
  transition: background 0.14s ease, color 0.14s ease;
}

.chip--on {
  border-color: #3a2b16;
  background: #3a2b16;
  color: #fffdf8;
}

.chip--press {
  opacity: 0.72;
}

.tools {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.tool {
  margin-left: 20rpx;
  color: #9a6514;
  font-size: 23rpx;
}

.tool--danger {
  color: #b4482f;
}

.empty {
  padding: 120rpx 40rpx;
  text-align: center;
}

.empty__title {
  color: #5c4726;
  font-size: 28rpx;
  font-weight: 600;
}

.empty__desc {
  margin-top: 12rpx;
  color: #a08a5f;
  font-size: 23rpx;
}

.list {
  display: flex;
  flex-direction: column;
}

.row {
  margin-bottom: 14rpx;
  padding: 20rpx 24rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.09);
  border-left: 6rpx solid rgba(154, 101, 20, 0.32);
  border-radius: 20rpx;
  background: rgba(255, 253, 246, 0.82);
}

.row--warn {
  border-left-color: #c98a2a;
}

.row--error {
  border-left-color: #b4482f;
}

.row__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.row__scope {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background: #f3e4c6;
  color: #7a5110;
  font-size: 20rpx;
}

.row__time {
  color: #b0a084;
  font-size: 21rpx;
}

.row__msg {
  margin-top: 10rpx;
  color: #3a2b16;
  font-size: 25rpx;
  line-height: 1.5;
}

.row__detail {
  margin-top: 8rpx;
  color: #8b7550;
  font-size: 22rpx;
  line-height: 1.5;
  word-break: break-all;
}
</style>
