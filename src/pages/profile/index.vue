<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { usePersonaStore } from '@/stores/persona';
import { personalityLabel } from '@/constants/personality';
import { applyBackup, exportBackup, parseBackup, readBackupText, type BackupFile } from '@/services/backup';
import {
  loadReminderSettings,
  notificationPermissionState,
  openExactAlarmSettings,
  openNotificationSettings,
  reminderDiagnostics,
  requestNotificationPermission,
  saveReminderSettings,
  scheduleLocalReminders,
  sendTestReminder,
  type ReminderDiagnostics,
  type ReminderSettings,
} from '@/services/reminders';
import { systemNotifyRefreshPermission } from '@/services/system-notify';
import {
  applySnapshot,
  fetchSyncStatus,
  pullSnapshot,
  pushSnapshot,
  type SyncStatus,
} from '@/services/sync';
import { fetchMe, getSession, logout, type AuthSession } from '@/services/auth';
import { rememberSync, runAutoSync } from '@/services/auto-sync';
import TabBar from '@/components/TabBar.vue';
import FeatureTour from '@/components/FeatureTour.vue';
import { startFeatureTour } from '@/services/feature-tour';

const store = useInventoryStore();
const persona = usePersonaStore();
const engine = ref('IndexedDB');
const busy = ref('');
const settings = ref<ReminderSettings | null>(null);
const perm = ref(notificationPermissionState());
const diagnostics = ref<ReminderDiagnostics>(reminderDiagnostics());
const syncInfo = ref<SyncStatus | null>(null);
const syncBusy = ref('');
const syncError = ref('');
const session = ref<AuthSession | null>(getSession());
const loggedIn = computed(() => !!session.value);
// 构建信息由 vite.config.ts 在打包时注入，方便确认手机上装的是哪个包
const appVersion = __APP_VERSION__;

// 「数据与同步」默认不显示给用户，连点「关于」5 次才打开，方便自己调试
const syncDebug = ref(false);
const versionTaps = ref(0);
let versionTapTimer: ReturnType<typeof setTimeout> | null = null;

const syncSummary = computed(() => {
  if (!loggedIn.value) return '登录后可同步';
  if (!syncInfo.value) return syncError.value ? '连不上服务' : '—';
  const counts = syncInfo.value.counts;
  return `物品 ${counts.item ?? 0} · 批次 ${counts.batch ?? 0} · 流水 ${counts.consumption ?? 0}`;
});

/** 调试用：确认打出来的包里到底有没有本地推送能力 */
const pushDebug = computed(() => {
  // #ifdef APP-PLUS
  const plus = (globalThis as any).plus;
  if (!plus?.push?.createMessage) return '不可用（打包没带 Push 模块）';
  return perm.value === 'granted' ? '可用 · 通知已开' : '可用 · 通知未开';
  // #endif
  // #ifdef H5
  return perm.value === 'granted' ? '浏览器通知已开' : '浏览器通知未开';
  // #endif
  return '未知';
});

try {
  const info = uni.getSystemInfoSync();
  engine.value = info.uniPlatform === 'web' ? 'IndexedDB' : 'SQLite';
} catch {
  // 取不到平台信息时按 H5 处理
}

const isH5 = computed(() => engine.value === 'IndexedDB');

type NotifyState = 'h5' | 'unsupported' | 'needs-permission' | 'needs-exact' | 'ready';

const notifyState = computed<NotifyState>(() => {
  if (isH5.value) return 'h5';
  if (!diagnostics.value.supported) return 'unsupported';
  if (diagnostics.value.permission !== 'granted') return 'needs-permission';
  if (!diagnostics.value.exactAlarm) return 'needs-exact';
  return 'ready';
});

/** 通知没开全；状态行随时可以点 */
const notifyActionable = computed(
  () => notifyState.value === 'needs-permission' || notifyState.value === 'needs-exact',
);

/** 用户确实开着临期提醒时，才在页面上方弹出提醒 */
const notifyNeedsAttention = computed(
  () => notifyActionable.value && Boolean(settings.value?.enabled),
);

const notifyTitle = computed(() =>
  notifyState.value === 'needs-exact' ? '提醒可能会晚到' : '临期提醒还没打开',
);

const notifyDesc = computed(() =>
  notifyState.value === 'needs-exact'
    ? '手机还没允许精确闹钟，通知可能延后几分钟。'
    : '开启系统通知后，东西快过期时才会提醒你。',
);

const notifyActionLabel = computed(() =>
  notifyState.value === 'needs-exact' ? '去设置' : '开启通知',
);

const notifyStatusLabel = computed(() => {
  switch (notifyState.value) {
    case 'h5':
      return '浏览器仅在页面打开时提醒';
    case 'unsupported':
      return '当前安装包不支持系统通知';
    case 'needs-permission':
      return '未开启 · 点这里开启';
    case 'needs-exact':
      return '已开启 · 精确闹钟未开';
    default:
      return '已开启 · App 划掉也能收到';
  }
});

function handleNotifyAction(): void {
  if (notifyState.value === 'needs-exact') {
    openExactAlarmSetting();
    return;
  }
  if (notifyState.value === 'needs-permission') {
    void allowNotify();
  }
}

const quietLabel = computed(() => {
  if (!settings.value || !settings.value.quiet) return '免打扰已关闭';
  return `免打扰 ${settings.value.quietStart}–${settings.value.quietEnd}`;
});

/** 开始时间晚于结束时间就是跨天，比如 22:00 → 08:00 */
const quietCrossDay = computed(() => {
  const current = settings.value;
  if (!current) return false;
  const [startHour, startMinute] = current.quietStart.split(':').map(Number);
  const [endHour, endMinute] = current.quietEnd.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return false;
  return startHour * 60 + startMinute > endHour * 60 + endMinute;
});

const personaSummary = computed(
  () => `${persona.name} · ${personalityLabel(persona.personality)}`,
);

const pendingCount = computed(
  () => store.shopping.filter((s) => s.status === 'pending').length,
);

function openPersonaSettings(): void {
  uni.navigateTo({ url: '/pages/pet-settings/index' });
}

function openFeedback(): void {
  uni.navigateTo({ url: '/pages/feedback/index' });
}

function openLogs(): void {
  uni.navigateTo({ url: '/pages/logs/index' });
}

onShow(async () => {
  uni.hideTabBar({ animation: false });
  session.value = getSession();
  // 先等本地库就绪，再读提醒设置，否则冷启动时会读不到
  try {
    await store.init();
  } catch (err) {
    console.error(err);
  }
  persona.load().catch(() => {
    // 读不到就用默认设定，不影响「我的」页其他功能
  });
  try {
    settings.value = await loadReminderSettings();
  } catch (err) {
    console.error(err);
  }
  await systemNotifyRefreshPermission();
  perm.value = notificationPermissionState();
  diagnostics.value = reminderDiagnostics();
  if (syncDebug.value) void loadSyncStatus();
  void refreshSession();
  // 进「我的」顺便让后台对一次账（有冷却，不会每次都请求）
  void runAutoSync({ checkRemote: true });
});

function tapVersion(): void {
  versionTaps.value += 1;
  if (versionTapTimer) clearTimeout(versionTapTimer);
  versionTapTimer = setTimeout(() => {
    versionTaps.value = 0;
  }, 1500);
  if (versionTaps.value < 5) return;

  if (versionTapTimer) clearTimeout(versionTapTimer);
  versionTapTimer = null;
  versionTaps.value = 0;
  syncDebug.value = !syncDebug.value;
  if (syncDebug.value) void loadSyncStatus();
  uni.showToast({
    title: syncDebug.value ? '同步面板已打开' : '同步面板已关闭',
    icon: 'none',
  });
}

/** 拉一次最新账号资料，别的设备改过头像 / 昵称时这里也能跟上 */
async function refreshSession(): Promise<void> {
  if (!loggedIn.value) return;
  try {
    await fetchMe();
  } catch {
    // 离线时继续用本机缓存的账号信息
    return;
  }
  session.value = getSession();
}

async function loadSyncStatus(): Promise<void> {
  if (!loggedIn.value) {
    syncInfo.value = null;
    syncError.value = '';
    return;
  }
  try {
    syncInfo.value = await fetchSyncStatus();
    syncError.value = '';
  } catch (err) {
    syncInfo.value = null;
    session.value = getSession();
    syncError.value = err instanceof Error ? err.message : '连不上同步服务';
  }
}

function openLogin(mode: 'login' | 'register' = 'login'): void {
  uni.navigateTo({ url: `/pages/login/index?mode=${mode}` });
}

function openAccount(): void {
  if (!loggedIn.value) {
    openLogin('login');
    return;
  }
  uni.navigateTo({ url: '/pages/account/index' });
}

function doLogout(): void {
  uni.showModal({
    title: '退出登录',
    content: '退出后本机数据会保留，并继续关联这个账号；下次在这台设备登录其他账号时，会先提示清除本机数据。',
    confirmText: '退出',
    success: (res) => {
      if (!res.confirm) return;
      logout();
      session.value = null;
      syncInfo.value = null;
      syncError.value = '';
      uni.showToast({ title: '已退出登录', icon: 'none' });
    },
  });
}

function formatSyncTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function askConfirm(title: string, content: string, confirmText: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      confirmColor: '#b8433a',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

async function pushToServer(force = false): Promise<void> {
  if (!loggedIn.value) {
    openLogin('login');
    return;
  }
  if (syncBusy.value) return;
  syncBusy.value = 'push';
  try {
    await store.init();
    const result = await pushSnapshot(force);
    syncInfo.value = result;
    syncError.value = '';
    void rememberSync(result.revision);
    const total = Object.values(result.counts).reduce((sum, count) => sum + Number(count), 0);
    uni.showToast({ title: `已同步 ${total} 行`, icon: 'none' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '同步失败';
    if (!force && message.includes('force=true')) {
      syncBusy.value = '';
      const ok = await askConfirm('覆盖服务器数据？', '服务器上已经有数据，这次推送会整份替换。', '覆盖');
      if (ok) await pushToServer(true);
      return;
    }
    syncError.value = message;
    if (!getSession()) {
      session.value = null;
      syncInfo.value = null;
    }
    uni.showModal({ title: '同步失败', content: message, showCancel: false });
  } finally {
    syncBusy.value = '';
  }
}

async function restoreFromServer(): Promise<void> {
  if (!loggedIn.value) {
    openLogin('login');
    return;
  }
  if (syncBusy.value) return;
  syncBusy.value = 'pull';
  try {
    await store.init();
    const snapshot = await pullSnapshot();
    const itemCount = snapshot.data.item?.length ?? 0;
    const batchCount = snapshot.data.batch?.length ?? 0;
    const shoppingCount = snapshot.data.shopping_item?.length ?? 0;
    const ok = await askConfirm(
      '用服务器数据覆盖本机？',
      `快照时间：${snapshot.syncedAt ? formatSyncTime(snapshot.syncedAt) : '未知'}\n`
        + `物品 ${itemCount} 种 · 批次 ${batchCount} 个 · 待购 ${shoppingCount} 条\n\n`
        + '本机现有数据会被替换，建议先导出备份。',
      '覆盖',
    );
    if (!ok) return;

    await applySnapshot(snapshot);
    await store.refresh();
    // 管家设定也存在 schema_meta 里，恢复后要重新读一遍
    await persona.load(true);
    void rememberSync(snapshot.revision);
    uni.showToast({ title: '已从服务器恢复', icon: 'success' });
    await loadSyncStatus();
  } catch (err) {
    const message = err instanceof Error ? err.message : '恢复失败';
    if (!getSession()) {
      session.value = null;
      syncInfo.value = null;
    }
    uni.showModal({ title: '恢复失败', content: message, showCancel: false });
  } finally {
    syncBusy.value = '';
  }
}

async function persist(next: ReminderSettings): Promise<void> {
  settings.value = next;
  try {
    await saveReminderSettings(next);
    // 开关或免打扰时段变了，取消旧计划并按新设置重排系统通知
    void scheduleLocalReminders(store.items, new Date(), true);
  } catch (err) {
    console.error(err);
    uni.showToast({ title: '保存失败', icon: 'none' });
  }
}

function toggleEnabled(e: any): void {
  if (!settings.value) return;
  const enabled = Boolean(e.detail.value);
  void persist({ ...settings.value, enabled });
  // 用户主动打开临期提醒时，顺手把系统通知权限要下来
  if (enabled && notifyState.value === 'needs-permission') {
    void allowNotify();
  }
}

function toggleQuiet(e: any): void {
  if (!settings.value) return;
  void persist({ ...settings.value, quiet: Boolean(e.detail.value) });
}

function updateQuietTime(field: 'quietStart' | 'quietEnd', e: any): void {
  if (!settings.value) return;
  const value = String(e.detail.value ?? '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
  const other = field === 'quietStart' ? settings.value.quietEnd : settings.value.quietStart;
  if (value === other) {
    uni.showToast({ title: '开始和结束时间不能相同', icon: 'none' });
    return;
  }
  void persist(
    field === 'quietStart'
      ? { ...settings.value, quietStart: value }
      : { ...settings.value, quietEnd: value },
  );
}

function changeQuietStart(e: any): void {
  updateQuietTime('quietStart', e);
}

function changeQuietEnd(e: any): void {
  updateQuietTime('quietEnd', e);
}

async function allowNotify(): Promise<void> {
  const ok = await requestNotificationPermission();
  perm.value = notificationPermissionState();
  diagnostics.value = reminderDiagnostics();
  if (ok) {
    // 拿到权限后立刻把未来几天的提醒排上
    void scheduleLocalReminders(store.items, new Date(), true);
    uni.showToast({ title: '已允许通知', icon: 'none' });
    return;
  }
  // #ifdef APP-PLUS
  uni.showModal({
    title: '通知没有打开',
    content: '去系统设置里允许「囤物有数」发送通知，临期提醒才能弹出来。',
    confirmText: '去设置',
    success: (res) => {
      if (res.confirm && typeof (uni as any).openAppAuthorizeSetting === 'function') {
        (uni as any).openAppAuthorizeSetting();
      }
    },
  });
  // #endif
  // #ifndef APP-PLUS
  uni.showToast({ title: '没有拿到通知权限', icon: 'none' });
  // #endif
}

function openNotifySettings(): void {
  openNotificationSettings();
}

function openExactAlarmSetting(): void {
  openExactAlarmSettings();
}

async function testNotification(): Promise<void> {
  const ok = await sendTestReminder(60);
  if (!ok) {
    uni.showModal({
      title: '无法登记测试通知',
      content: '请先允许系统通知；如果刚安装，请确认使用的是带原生通知模块的自定义基座。',
      showCancel: false,
    });
    return;
  }
  uni.showModal({
    title: '测试通知已登记',
    content: '现在把 App 从最近任务划掉，约 1 分钟后查看通知栏。到点仍能收到，说明 L2 生效。',
    showCancel: false,
  });
}

function countsLine(counts: Record<string, number>): string {
  return `物品 ${counts.item ?? 0} 种 · 批次 ${counts.batch ?? 0} 个 · 待购 ${counts.shopping_item ?? 0} 条`;
}

async function exportData(): Promise<void> {
  if (busy.value) return;
  busy.value = 'export';
  try {
    await store.init();
    const result = await exportBackup();
    const summary = countsLine(result.counts);

    if (isH5.value) {
      uni.showToast({ title: `已下载 ${result.fileName}`, icon: 'none' });
      return;
    }

    uni.showModal({
      title: '已导出',
      content: `${result.fileName}\n${summary}\n\n路径：${result.path}\n\n从文件管理器把这个文件复制出去，就是一份完整备份。`,
      showCancel: false,
      confirmText: '知道了',
    });
  } catch (err) {
    console.error(err);
    uni.showModal({
      title: '导出失败',
      content: err instanceof Error ? err.message : '未知错误',
      showCancel: false,
    });
  } finally {
    busy.value = '';
  }
}

async function importData(): Promise<void> {
  if (busy.value) return;
  busy.value = 'import';

  let file: BackupFile;
  try {
    await store.init();
    file = parseBackup(await readBackupText());
  } catch (err) {
    busy.value = '';
    // 用户自己取消选择，不弹错误提示
    if (err instanceof Error && err.message.includes('已取消')) return;

    console.error(err);
    uni.showModal({
      title: '恢复失败',
      content: err instanceof Error ? err.message : '这个备份文件读不了',
      showCancel: false,
    });
    return;
  }

  const when = file.exported_at
    ? new Date(file.exported_at).toLocaleString('zh-CN', { hour12: false })
    : '未知';

  uni.showModal({
    title: '覆盖本机数据？',
    content: `备份时间：${when}\n${countsLine(file.counts)}\n\n恢复会清空并替换这台设备上的全部数据，确定继续吗？`,
    confirmText: '覆盖',
    confirmColor: '#b8433a',
    success: async (res) => {
      if (!res.confirm) {
        busy.value = '';
        return;
      }
      try {
        await applyBackup(file);
        await store.refresh();
        await persona.load(true);
        uni.showToast({ title: '已恢复', icon: 'success' });
      } catch (err) {
        console.error(err);
        uni.showModal({
          title: '恢复失败',
          content: err instanceof Error ? err.message : '写入本机数据库失败',
          showCancel: false,
        });
      } finally {
        busy.value = '';
      }
    },
    fail: () => {
      busy.value = '';
    },
  });
}
</script>

<template>
  <view class="page profile-page">
    <!-- 背景层：暖纸底、右上光晕和细纸纹；不接任何点击 -->
    <view class="me-deco"></view>

    <view class="section-title">
      <text>账号</text>
    </view>
    <view class="card account" @click="openAccount">
      <template v-if="session">
        <view class="account__row">
          <image
            v-if="session.user.avatar"
            class="account__avatar"
            :src="session.user.avatar"
            mode="aspectFill"
          />
          <view v-else class="account__avatar">
            {{ (session.user.displayName || session.user.username).slice(0, 1) }}
          </view>
          <view class="account__info">
            <view class="account__name">{{ session.user.displayName || session.user.username }}</view>
            <view class="account__sub">@{{ session.user.username }}</view>
          </view>
          <text class="account__arrow">›</text>
        </view>
      </template>
      <template v-else>
        <view class="account__row">
          <view class="account__avatar account__avatar--guest">囤</view>
          <view class="account__info">
            <view class="account__name">当前是访客模式</view>
            <view class="account__sub">本地功能全部可用，登录只用于多设备同步</view>
          </view>
        </view>
        <view class="account__actions">
          <view class="account__btn account__btn--main" @click.stop="openLogin('login')">登录</view>
          <view class="account__btn" @click.stop="openLogin('register')">注册</view>
        </view>
      </template>
    </view>

    <!-- 通知没开全时，一进「我的」就能看到入口；开了就不再打扰 -->
    <view
      v-if="notifyNeedsAttention"
      :class="['notify-alert', `notify-alert--${notifyState}`]"
      hover-class="notify-alert--tap"
      @click="handleNotifyAction"
    >
      <view class="notify-alert__badge">
        <text class="notify-alert__icon">🔔</text>
      </view>
      <view class="notify-alert__copy">
        <text class="notify-alert__title">{{ notifyTitle }}</text>
        <text class="notify-alert__desc">{{ notifyDesc }}</text>
      </view>
      <view class="notify-alert__side">
        <view class="notify-alert__cta">{{ notifyActionLabel }}</view>
        <text
          v-if="notifyState === 'needs-permission' && diagnostics.permission === 'denied'"
          class="notify-alert__link"
          @click.stop="openNotifySettings"
        >
          系统设置
        </text>
      </view>
    </view>

    <view class="section-title">
      <text>管家</text>
      <text class="muted">名字和性格都能改</text>
    </view>
    <view class="card" @click="openPersonaSettings">
      <view class="action">
        <text>我的管家</text>
        <view class="persona-entry">
          <text class="persona-entry__value">{{ personaSummary }}</text>
          <text class="persona-entry__arrow">›</text>
        </view>
      </view>
      <view class="persona-note">
        换名字、换性格后，问答的语气会跟着变；设定随备份和同步一起走。
      </view>
    </view>

    <view v-if="syncDebug" class="section-title">
      <text>数据与同步</text>
      <text class="muted">
        {{ !loggedIn ? '登录后可用' : syncInfo ? `revision ${syncInfo.revision}` : '未连接' }}
      </text>
    </view>
    <view v-if="syncDebug" class="card">
      <view class="kv">
        <text class="kv__k">本机数据</text>
        <text class="kv__v">物品 {{ store.items.length }} 种 · 待购 {{ pendingCount }} 条</text>
      </view>
      <view class="kv">
        <text class="kv__k">本地推送</text>
        <text class="kv__v">{{ pushDebug }}</text>
      </view>
      <view v-if="!loggedIn" class="sync-login">
        <text class="sync-login__text">访客模式：数据只保存在这台设备上。登录后可同步到服务器，换机时恢复。</text>
        <view class="sync-login__btn" @click="openLogin('login')">去登录</view>
      </view>
      <template v-else>
        <view class="kv">
          <text class="kv__k">最近同步</text>
          <text class="kv__v">
            {{ syncInfo && syncInfo.syncedAt ? formatSyncTime(syncInfo.syncedAt) : '还没同步过' }}
          </text>
        </view>
        <view class="kv">
          <text class="kv__k">服务器数据</text>
          <text class="kv__v">{{ syncSummary }}</text>
        </view>
        <view v-if="syncError" class="sync-error">{{ syncError }}</view>
        <view class="action" @click="pushToServer(false)">
          <text>同步到服务器</text>
          <text class="action__hint">{{ syncBusy === 'push' ? '上传中…' : '推整份快照' }}</text>
        </view>
        <view class="action" @click="restoreFromServer">
          <text>从服务器恢复</text>
          <text class="action__hint">{{ syncBusy === 'pull' ? '读取中…' : '覆盖本机数据' }}</text>
        </view>
      </template>
    </view>

    <view class="section-title tour-anchor-reminders">
      <text>提醒</text>
      <text class="muted">{{ quietLabel }}</text>
    </view>
    <view v-if="settings" class="card">
      <view class="action">
        <text>临期提醒</text>
        <switch :checked="settings.enabled" color="#9a6514" @change="toggleEnabled" />
      </view>
      <view class="action">
        <text>启用免打扰</text>
        <switch :checked="settings.quiet" color="#9a6514" @change="toggleQuiet" />
      </view>
      <view v-if="settings.quiet" class="quiet">
        <view class="quiet__head">
          <text class="quiet__title">免打扰时段</text>
          <text class="quiet__badge">{{ quietCrossDay ? '跨天' : '当天' }}</text>
        </view>
        <view class="quiet__times">
          <view class="quiet__slot">
            <picker
              mode="time"
              :value="settings.quietStart"
              style="display: block; width: 100%;"
              @change="changeQuietStart"
            >
              <view class="quiet__time">
                <text class="quiet__value">{{ settings.quietStart }}</text>
                <text class="quiet__label">开始</text>
              </view>
            </picker>
          </view>
          <text class="quiet__arrow">→</text>
          <view class="quiet__slot">
            <picker
              mode="time"
              :value="settings.quietEnd"
              style="display: block; width: 100%;"
              @change="changeQuietEnd"
            >
              <view class="quiet__time">
                <text class="quiet__value">{{ settings.quietEnd }}</text>
                <text class="quiet__label">结束</text>
              </view>
            </picker>
          </view>
        </view>
        <text class="quiet__hint">这段时间不推送提醒，遇到提醒会顺延到结束后发送</text>
      </view>
      <view class="action action--stack">
        <text>提醒提前量</text>
        <text class="action__hint">按每种食物自身的保质期自动计算；到期当天也会提醒</text>
      </view>
      <view class="action">
        <text>系统通知</text>
        <view
          :class="['notify-status', notifyActionable ? 'notify-status--action' : '']"
          @click="notifyActionable ? handleNotifyAction() : null"
        >
          <view :class="['notify-status__dot', `notify-status__dot--${notifyState}`]" />
          <text :class="['action__hint', notifyActionable ? 'notify-status__link' : '']">
            {{ notifyStatusLabel }}
          </text>
        </view>
      </view>
      <view v-if="!isH5 && diagnostics.supported" class="action" @click="testNotification">
        <text>测试系统通知</text>
        <text class="action__hint">1 分钟后触发，可划掉 App 验证</text>
      </view>
    </view>

    <view class="section-title tour-anchor-backup">
      <text>备份与恢复</text>
      <text class="muted">换机前先导出</text>
    </view>
    <view class="card actions">
      <view class="action" @click="exportData">
        <text>导出备份</text>
        <text class="action__hint">{{ busy === 'export' ? '导出中…' : 'JSON 文件' }}</text>
      </view>
      <view class="action" @click="importData">
        <text>恢复备份</text>
        <text class="action__hint">{{ busy === 'import' ? '读取中…' : isH5 ? '选择文件' : '最近一次导出' }}</text>
      </view>
    </view>

    <view class="section-title" @click="tapVersion">
      <text>关于</text>
      <text class="muted">v{{ appVersion }}</text>
    </view>
    <view class="card actions">
      <view class="action" @click="openFeedback">
        <text>意见反馈</text>
        <text class="action__hint">告诉我们哪里不好用 ›</text>
      </view>
      <view class="action" @click="openLogs">
        <text>运行日志</text>
        <text class="action__hint">只在本机 · 排查问题用 ›</text>
      </view>
      <view class="action" @click="startFeatureTour">
        <text>功能引导</text>
        <text class="action__hint">再看一遍怎么用</text>
      </view>
      <view class="action">
        <text>囤物有数</text>
        <text class="action__hint">本地优先 · 可选账号</text>
      </view>
    </view>

    <view class="footnote">
      不登录也能本地使用；登录后可在多台设备间同步。卸载或换机前，请先导出备份。
    </view>

    <view v-if="loggedIn" class="logout-btn" @click="doLogout">退出登录</view>

    <TabBar current="profile" />
    <FeatureTour current="profile" />
  </view>
</template>

<style>
/* 导航栏露出的那一条也跟着纸色走，别和页内容差一截 */
page {
  background: #fdf3dd;
}

/* ---------- 背景：暖纸渐变 + 光晕 + 纸纹，卡片做成半透明纸片 ---------- */
.profile-page {
  position: relative;
  background:
    radial-gradient(110% 24% at 12% 100%, rgba(240, 211, 160, 0.5), rgba(240, 211, 160, 0) 70%),
    linear-gradient(180deg, #fdf3dd 0%, #f8e9c9 42%, #f4e2bd 100%);
}

.me-deco {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

/* 背景层垫在下面，内容各自抬一层，卡片才压得住纸纹 */
.profile-page > .section-title,
.profile-page > .card,
.profile-page > .footnote,
.profile-page > .logout-btn {
  position: relative;
  z-index: 1;
}

/* 右上角一小片暖光，和登录页同一束光，但只落在页顶 */
.me-deco::before {
  content: '';
  position: absolute;
  top: -160rpx;
  right: -120rpx;
  width: 720rpx;
  height: 620rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 224, 154, 0.9), rgba(255, 224, 154, 0) 68%);
}

/* 纸纹：近看才有的暖色网点，远看只是纸的颗粒 */
.me-deco::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(154, 101, 20, 0.6) 1rpx, transparent 1.6rpx);
  background-size: 18rpx 18rpx;
  opacity: 0.05;
}

/* 卡片从纯白改成半透明暖白：背景的光和纸纹能透上来，不再是白块 */
.profile-page .card {
  background: rgba(255, 253, 246, 0.78);
  border: 1rpx solid rgba(154, 101, 20, 0.09);
  box-shadow: 0 12rpx 30rpx rgba(143, 92, 15, 0.06);
}

.profile-page .logout-btn {
  background: rgba(255, 253, 246, 0.82);
  border: 1rpx solid rgba(154, 101, 20, 0.09);
}

/* 卡片变半透明后，次要按钮要补一层暖底和细边，不然会陷进卡片里 */
.profile-page .account__btn {
  background: rgba(248, 238, 214, 0.9);
  border: 1rpx solid rgba(154, 101, 20, 0.14);
}

.profile-page .account__btn--main {
  background: #3a2b16;
  border-color: #3a2b16;
  color: #ffffff;
}

.profile-page .quiet {
  background: rgba(253, 249, 240, 0.72);
}

.account__row {
  display: flex;
  align-items: center;
  padding: 16rpx 0 20rpx;
}

.account__avatar {
  width: 116rpx;
  height: 116rpx;
  margin-right: 28rpx;
  border-radius: 40rpx;
  background: #9a6514;
  color: #ffffff;
  text-align: center;
  line-height: 116rpx;
  font-size: 46rpx;
  overflow: hidden;
}

.account__avatar--guest {
  background: #e8d5ae;
  color: #7a5110;
}

.account__info {
  flex: 1;
  min-width: 0;
}

.account__name {
  font-size: 38rpx;
  font-weight: 600;
  color: #3a2b16;
}

.account__sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #9a8055;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account__arrow {
  margin-left: 12rpx;
  color: #c2ae85;
  font-size: 44rpx;
  line-height: 1;
}

.logout-btn {
  margin-top: 36rpx;
  padding: 30rpx 0;
  border-radius: 24rpx;
  background: #ffffff;
  color: #b8433a;
  text-align: center;
  font-size: 30rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.account__actions {
  display: flex;
  padding-top: 14rpx;
}

.account__btn {
  flex: 1;
  padding: 24rpx 0;
  border-radius: 999rpx;
  background: #fdf6e6;
  color: #7a633f;
  text-align: center;
  font-size: 29rpx;
}

.account__btn + .account__btn {
  margin-left: 20rpx;
}

.account__btn--main {
  background: #3a2b16;
  color: #ffffff;
}

.sync-login {
  padding: 20rpx 0 8rpx;
}

.sync-login__text {
  display: block;
  color: #7a633f;
  font-size: 23rpx;
  line-height: 1.6;
}

.sync-login__btn {
  margin-top: 20rpx;
  padding: 18rpx 0;
  border-radius: 999rpx;
  background: #fdf4e4;
  color: #9a6514;
  text-align: center;
  font-size: 26rpx;
}

.kv {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  font-size: 26rpx;
  border-bottom: 1rpx solid #f0e4ca;
}

.kv:last-child {
  border-bottom: none;
}

.kv__k {
  color: #826b47;
}

.actions {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}

.persona-entry {
  display: flex;
  align-items: center;
}

.persona-entry__value {
  font-size: 26rpx;
  color: #9a6514;
}

.persona-entry__arrow {
  margin-left: 10rpx;
  font-size: 34rpx;
  line-height: 1;
  color: #c2ae85;
}

.persona-note {
  padding: 4rpx 0 24rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: #9a8055;
}

.action {
  display: flex;
  justify-content: space-between;
  padding: 28rpx 0;
  font-size: 28rpx;
  border-bottom: 1rpx solid #f0e4ca;
}

.action:last-child {
  border-bottom: none;
}

.action--danger {
  color: #b8433a;
}

.sync-error {
  margin: 8rpx 0 4rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: #fbe9e4;
  color: #b8433a;
  font-size: 22rpx;
  line-height: 1.5;
}

.action--stack {
  flex-direction: column;
  align-items: flex-start;
}

.action--stack > .action__hint {
  margin-top: 10rpx;
}

/* 通知没开全时，在「我的」页上方直接给出入口 */
.notify-alert {
  display: flex;
  align-items: center;
  margin-bottom: 24rpx;
  padding: 24rpx 24rpx 24rpx 22rpx;
  border-radius: 24rpx;
  border: 1rpx solid #efd19b;
  background:
    radial-gradient(circle at 8% 20%, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0) 45%),
    linear-gradient(135deg, #fff8e9 0%, #fdeccb 100%);
  box-shadow: 0 12rpx 30rpx rgba(154, 101, 20, 0.1);
}

.notify-alert--needs-exact {
  border-color: #ecd9a9;
  background: linear-gradient(135deg, #fffaf0 0%, #f9f1dd 100%);
}

.notify-alert--tap {
  opacity: 0.86;
}

.notify-alert__badge {
  flex: none;
  width: 68rpx;
  height: 68rpx;
  margin-right: 18rpx;
  border-radius: 50%;
  background: #f6dfae;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notify-alert--needs-exact .notify-alert__badge {
  background: #f2e7c8;
}

.notify-alert__icon {
  font-size: 34rpx;
  line-height: 1;
}

.notify-alert__copy {
  flex: 1;
  min-width: 0;
}

.notify-alert__title {
  display: block;
  font-size: 29rpx;
  font-weight: 600;
  line-height: 1.45;
  color: #8a5410;
}

.notify-alert__desc {
  display: block;
  margin-top: 4rpx;
  font-size: 23rpx;
  line-height: 1.55;
  color: #826b47;
}

.notify-alert__side {
  flex: none;
  margin-left: 18rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.notify-alert__cta {
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  background: #9a6514;
  color: #fffdf8;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.2;
  box-shadow: 0 8rpx 18rpx rgba(154, 101, 20, 0.24);
}

.notify-alert__link {
  margin-top: 10rpx;
  font-size: 21rpx;
  color: #9a6514;
  text-decoration: underline;
}

/* 提醒卡片里的系统通知状态 */
.notify-status {
  display: flex;
  align-items: center;
  max-width: 64%;
}

.notify-status--action {
  cursor: pointer;
}

.notify-status__dot {
  flex: none;
  width: 14rpx;
  height: 14rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background: #b8a98c;
}

.notify-status__dot--ready {
  background: #4f7a4a;
}

.notify-status__dot--needs-permission {
  background: #d97706;
  box-shadow: 0 0 0 6rpx rgba(217, 119, 6, 0.12);
}

.notify-status__dot--needs-exact {
  background: #d9a33b;
}

.notify-status__link {
  color: #9a6514;
  text-decoration: underline;
}

.quiet {
  margin: 18rpx 0 6rpx;
  padding: 22rpx 22rpx 20rpx;
  border-radius: 20rpx;
  background: #fdf9f0;
}

.quiet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.quiet__title {
  font-size: 24rpx;
  color: #826b47;
}

.quiet__badge {
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: #f3e6cc;
  color: #9a6514;
  font-size: 20rpx;
  line-height: 1.3;
}

.quiet__times {
  display: flex;
  align-items: center;
  margin-top: 16rpx;
}

.quiet__slot {
  flex: 1;
  min-width: 0;
}

.quiet__time {
  display: flex;
  align-items: baseline;
  justify-content: center;
  padding: 14rpx 0;
  border: 1rpx solid #f0e3c9;
  border-radius: 16rpx;
  background: #ffffff;
}

.quiet__value {
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.2;
  color: #3a2b16;
  font-variant-numeric: tabular-nums;
}

.quiet__label {
  margin-left: 10rpx;
  font-size: 20rpx;
  color: #9a8055;
}

.quiet__arrow {
  flex: none;
  margin: 0 16rpx;
  color: #c2ae85;
  font-size: 24rpx;
}

.quiet__hint {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  line-height: 1.5;
  color: #9a8055;
}

.action__hint {
  font-size: 22rpx;
  color: #9a8055;
}

.footnote {
  margin: 36rpx 12rpx 0;
  font-size: 22rpx;
  line-height: 1.7;
  color: #9a8055;
}
</style>
