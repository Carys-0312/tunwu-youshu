<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { usePersonaStore } from '@/stores/persona';
import { configureAutoSync, runAutoSync, startAutoSync } from '@/services/auto-sync';
import { scheduleLocalReminders } from '@/services/reminders';
import { checkFeedbackReplies, startFeedbackReplyWatch } from '@/services/feedback-reply';
import { bindPushMessage, registerPushClient } from '@/services/push';
import { logError, logDetail, logInfo } from '@/services/logger';
import {
  systemNotifyConsumeLaunchPayload,
  systemNotifyRefreshPermission,
} from '@/services/system-notify';

const store = useInventoryStore();

/** 从系统通知点进来时，按通知携带的路径回到库存页 */
function openFromNotification(): void {
  const payload = systemNotifyConsumeLaunchPayload();
  if (!payload || !payload.startsWith('/pages/')) return;
  uni.switchTab({
    url: payload,
    fail: () => {
      uni.navigateTo({ url: payload });
    },
  });
}

/** DCloud 本地消息（原生通知插件不可用时的回退）点击后按 payload 跳页面 */
function bindPushClick(): void {
  // #ifdef APP-PLUS
  const plus = (globalThis as any).plus;
  if (!plus?.push?.addEventListener) return;
  plus.push.addEventListener('click', (message: any) => {
    const payload = typeof message?.payload === 'string' ? message.payload : '';
    if (!payload.startsWith('/pages/')) return;
    uni.navigateTo({
      url: payload,
      fail: () => uni.switchTab({ url: payload }),
    });
  }, false);
  // #endif
}

/** App 端给未来几天排本地通知；H5 上是空操作 */
function syncReminderSchedule(): void {
  // iOS 的授权状态是异步查询的，先刷新再排期，避免首次启动误判为未授权
  void systemNotifyRefreshPermission()
    .then(() => store.init())
    .then(() => scheduleLocalReminders(store.items))
    .catch(() => {
      // 排期失败不影响主流程，进库存页时还有即时检查
    });
}

onLaunch(() => {
  try {
    const info = uni.getSystemInfoSync();
    logInfo(
      '启动',
      '打开应用',
      `${info.platform || 'unknown'}${info.appVersion ? ` · v${info.appVersion}` : ''}`,
    );
  } catch {
    logInfo('启动', '打开应用');
  }
  openFromNotification();
  bindPushClick();
  bindPushMessage();
  // 已登录时把设备 CID 登记到服务端，管理员回信就能走系统推送
  void registerPushClient();
  // 回信提醒：启动后查一次，并在前台每 5 分钟检查
  startFeedbackReplyWatch();
  // iOS 的授权状态是异步查询的，启动时先刷新一次缓存
  void systemNotifyRefreshPermission();
  store.init().catch((err) => {
    console.error('[db] 初始化失败', err);
    logError('启动', '本地数据初始化失败', logDetail(err));
    uni.showToast({ title: '本地数据初始化失败', icon: 'none' });
  });

  configureAutoSync({
    ensureReady: () => store.init(),
    onApplied: async () => {
      await store.refresh();
      await usePersonaStore().load(true);
      syncReminderSchedule();
    },
  });
  startAutoSync();
});

// 回到前台时顺带看一眼服务器有没有更新的数据；切后台前尽量把本机改动推上去
onShow(() => {
  openFromNotification();
  void registerPushClient();
  void checkFeedbackReplies();
  syncReminderSchedule();
  void runAutoSync({ checkRemote: true });
});

onHide(() => {
  // 刚改过库存就切后台时，把未来几天的提醒重新排一下
  syncReminderSchedule();
  void runAutoSync();
});
</script>

<style>
/* #ifdef H5 */
/* 底部换成自定义 TabBar（要放大动效），原生那条先藏掉，免得闪出两条 */
uni-tabbar {
  display: none !important;
}
/* #endif */

page {
  background: #fdf6e6;
  color: #3a2b16;
  font-size: 28rpx;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.page {
  min-height: 100vh;
  padding: 24rpx 24rpx 200rpx;
  box-sizing: border-box;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.muted {
  color: #826b47;
  font-size: 24rpx;
}

.section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 32rpx 4rpx 16rpx;
  font-size: 30rpx;
  font-weight: 600;
}

.section-title .muted {
  font-weight: 400;
}

.tag {
  display: inline-block;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  line-height: 1.4;
  white-space: nowrap;
}

.tag--plain {
  background: #f5ead2;
  color: #7a633f;
}

.tag--warn {
  background: #fcebd4;
  color: #a05205;
}

.tag--danger {
  background: #fbeae8;
  color: #b8433a;
}

.tag--brand {
  background: #fdf4e4;
  color: #9a6514;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}

.empty__title {
  font-size: 30rpx;
  color: #7a633f;
}

.empty__desc {
  margin-top: 12rpx;
  color: #9a8055;
  font-size: 24rpx;
}

.hint {
  padding: 60rpx 0;
  text-align: center;
  color: #9a8055;
  font-size: 24rpx;
}
</style>
