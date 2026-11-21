import type { InventoryRow, Reminder } from '@/types/models';
import { addReminder, loadReminders, readMeta, writeMeta } from '@/db/repo';
import { addDays, daysFromToday, describeDays, todayISO } from '@/utils/date';
import { recommendedLeadDays } from '@/utils/reminder-policy';
import {
  systemNotifyCancelAll,
  systemNotifyCapability,
  systemNotifyOpenExactAlarmSettings,
  systemNotifyOpenSettings,
  systemNotifyRequestPermission,
  systemNotifySchedule,
} from '@/services/system-notify';

export interface ReminderSettings {
  enabled: boolean;
  /** 是否启用免打扰 */
  quiet: boolean;
  /** 免打扰开始时间，HH:mm，默认 22:00 */
  quietStart: string;
  /** 免打扰结束时间，HH:mm，默认 08:00；可以早于开始时间，表示跨天 */
  quietEnd: string;
}

const SETTINGS_KEY = 'remind_settings';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULTS: ReminderSettings = {
  enabled: true,
  quiet: true,
  quietStart: '22:00',
  quietEnd: '08:00',
};

function makeId(): string {
  return `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const raw = await readMeta(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };

  try {
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      quiet: parsed.quiet ?? DEFAULTS.quiet,
      quietStart:
        typeof parsed.quietStart === 'string' && TIME_PATTERN.test(parsed.quietStart)
          ? parsed.quietStart
          : DEFAULTS.quietStart,
      quietEnd:
        typeof parsed.quietEnd === 'string' && TIME_PATTERN.test(parsed.quietEnd)
          ? parsed.quietEnd
          : DEFAULTS.quietEnd,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await writeMeta(SETTINGS_KEY, JSON.stringify(settings));
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

/** 免打扰区间按「左闭右开」处理，开始晚于结束表示跨天，例如 22:00–次日 08:00 */
function inQuietHours(now: Date, settings: ReminderSettings): boolean {
  if (!settings.quiet) return false;
  const start = timeToMinutes(settings.quietStart);
  const end = timeToMinutes(settings.quietEnd);
  if (start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/**
 * 预定的 9:00 如果落在免打扰时段里，就顺延到该时段的结束时间。
 * 跨天时段（如 22:00–08:00）会正确落到次日 08:00。
 */
function nextAllowedTime(at: Date, settings: ReminderSettings): Date {
  if (!inQuietHours(at, settings)) return at;

  const end = timeToMinutes(settings.quietEnd);
  const next = new Date(at.getTime());
  next.setHours(Math.floor(end / 60), end % 60, 0, 0);
  // 结束时间早于或等于当前时间，说明落在跨天时段的前半段，顺延到次日
  if (next.getTime() <= at.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/** H5 需要用户手势里申请权限；App 里 Android 13+ 要单独申请 POST_NOTIFICATIONS */
export async function requestNotificationPermission(): Promise<boolean> {
  // #ifdef APP-PLUS
  // 带原生插件的包优先走系统级调度模块；标准基座/插件缺失时退回 plus 权限申请
  if (systemNotifyCapability().supported) {
    return systemNotifyRequestPermission();
  }

  const plus = (globalThis as any).plus;
  if (plus?.os?.name === 'Android' && plus?.android?.requestPermissions) {
    return new Promise<boolean>((resolve) => {
      const settle = (event?: { granted?: string[] }): void => {
        const grantedList = event?.granted ?? [];
        resolve(grantedList.includes('android.permission.POST_NOTIFICATIONS') || notificationPermissionState() === 'granted');
      };
      try {
        plus.android.requestPermissions(
          ['android.permission.POST_NOTIFICATIONS'],
          (event: { granted?: string[] }) => settle(event),
          () => settle(),
        );
      } catch {
        settle();
      }
    });
  }
  // iOS 和低版本 Android 交给系统处理，不在 App 里拦
  return true;
  // #endif

  // #ifdef H5
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
  // #endif

  return false;
}

export function notificationPermissionState(): 'granted' | 'denied' | 'default' | 'unsupported' {
  // #ifdef H5
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
  // #endif
  // #ifdef APP-PLUS
  // 原生模块能直接给出权限与精确闹钟状态时以它为准
  const capability = systemNotifyCapability();
  if (capability.supported) return capability.permission;

  // iOS 能直接查到通知授权状态；Android 的 notificationAuthorized 会返回 config error，改用系统通知开关
  try {
    const setting = (uni as any).getAppAuthorizeSetting?.();
    const state = setting?.notificationAuthorized;
    if (state === 'authorized') return 'granted';
    if (state === 'denied') return 'denied';
    if (state === 'not determined') return 'default';
  } catch {
    // 忽略，继续用下面的 Android 判断
  }
  try {
    const plus = (globalThis as any).plus;
    if (plus?.android?.runtimeMainActivity) {
      const manager = plus.android.runtimeMainActivity().getSystemService('notification');
      if (manager) {
        plus.android.importClass(manager);
        if (typeof manager.areNotificationsEnabled === 'function') {
          return manager.areNotificationsEnabled() ? 'granted' : 'denied';
        }
      }
    }
  } catch {
    // 查询失败时按已授权处理，用户点「立即检查」还能自己发现
  }
  return 'granted';
  // #endif
  // App 端由系统管理，页面不展示申请入口
  return 'granted';
}

const PERM_ASKED_KEY = 'remind_perm_asked';

/**
 * Android 13+ 第一次进库存页时申请一次通知权限（只问一次），
 * 否则本地提醒排了也弹不出来。H5 由「我的」页的按钮负责。
 */
export async function ensureReminderPermissionOnce(): Promise<void> {
  // #ifdef APP-PLUS
  if (notificationPermissionState() === 'granted') return;

  try {
    if (uni.getStorageSync(PERM_ASKED_KEY) === '1') return;
    uni.setStorageSync(PERM_ASKED_KEY, '1');
  } catch {
    return;
  }

  const settings = await loadReminderSettings();
  if (!settings.enabled) return;
  await requestNotificationPermission();
  // #endif
}

function sendNotification(title: string, body: string): boolean {
  // 系统级调度可用时统一走原生通知渠道：Android 的独立渠道 / iOS 通知中心
  if (
    systemNotifySchedule({
      id: `now-${Date.now()}`,
      title,
      body,
      at: Date.now() + 800,
      payload: '/pages/dashboard/index',
    })
  ) {
    return true;
  }

  // #ifdef APP-PLUS
  // 标准基座或插件缺失时退回 DCloud 本地消息（只在进程存活时保证送达）
  const plus = (globalThis as any).plus;
  if (plus?.push?.createMessage) {
    plus.push.createMessage(body, 'tunwu-expiry', { title, cover: false });
    return true;
  }
  return false;
  // #endif

  // #ifdef H5
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: 'tunwu-expiry' });
      return true;
    } catch {
      return false;
    }
  }
  return false;
  // #endif

  return false;
}

/* ---------- 系统级提醒调度（L2） ----------
 * 优先调用 tunwu-notify 原生模块：Android 用 AlarmManager + 广播接收器，
 * iOS 用 UNUserNotificationCenter，计划由系统持有，App 被划掉后仍能到点展示。
 * 原生模块不可用时退回 plus.push 的进程内延迟消息（L1）；打开 App 时的
 * 即时检查（runReminderCheck）始终保留，作为最后兜底并与排期去重。
 */

const PLAN_KEY = 'remind_schedule_v1';
/** 往后排几天 */
const PLAN_HORIZON_DAYS = 7;
/** 每天上午 9 点弹 */
const PLAN_FIRE_HOUR = 9;
/** 滚动 7 天内最多 2 条，和打开 App 时的检查共用这个上限 */
const PLAN_WEEKLY_CAP = 2;

interface ScheduledDay {
  /** 计划弹出时间戳 */
  at: number;
  /** 这条通知覆盖的物品 id，用于和即时检查去重 */
  ids: string[];
  /** system = 系统级调度（进程被杀也送达）；local = 进程内延迟消息 */
  channel: 'system' | 'local';
}

type ScheduleMap = Record<string, ScheduledDay>;

function loadPlans(): ScheduleMap {
  try {
    const raw = uni.getStorageSync(PLAN_KEY);
    if (!raw) return {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ScheduleMap;
  } catch {
    return {};
  }
}

function savePlans(plans: ScheduleMap): void {
  try {
    uni.setStorageSync(PLAN_KEY, JSON.stringify(plans));
  } catch {
    // 本机存储不可用时放弃排期，打开 App 时还会检查
  }
}

function dayStartISO(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * 按食物自身的保质期推荐提前量。
 * 生产日期缺失、无法推算保质期时不给提前量，只在到期当天提醒。
 */
function leadDaysForRow(row: InventoryRow): number[] {
  const recommended = recommendedLeadDays(row.shelfLifeDays ?? null);
  return recommended === null ? [] : [recommended];
}

/** 某一天应该提醒的物品 */
function dueItemIds(rows: InventoryRow[], day: string): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.item.id || !row.expiryDate) continue;
    const left = daysFromToday(row.expiryDate, day);
    if (left < 0) continue;
    if (left === 0 || leadDaysForRow(row).includes(left)) {
      ids.add(row.item.id);
    }
  }
  return [...ids];
}

/** 以 day 结尾的滚动 7 天里已经排了几条（排期 + 已发出的周报） */
function weeklyCount(plans: ScheduleMap, reminders: Reminder[], day: string): number {
  const start = addDays(-6, dayStartISO(day));
  let count = 0;
  for (const key of Object.keys(plans)) {
    if (key >= start && key <= day) count += 1;
  }
  for (const item of reminders) {
    if (item.type === 'weekly' && item.status === 'sent' && item.fire_at >= start && item.fire_at <= day) {
      count += 1;
    }
  }
  return count;
}

function createScheduledMessage(day: string, at: Date): 'system' | 'local' | null {
  const title = '囤物有数 · 临期提醒';
  const body = '有物品快到保质期了，打开囤物有数看看';
  const atMs = at.getTime();

  // 首选系统级调度：Android 走 AlarmManager + 广播接收器，iOS 走 UNUserNotificationCenter
  if (
    systemNotifySchedule({
      id: `expiry-${day}`,
      title,
      body,
      at: atMs,
      payload: '/pages/dashboard/index',
    })
  ) {
    return 'system';
  }

  // #ifdef APP-PLUS
  // 原生模块不可用时退回 DCloud 进程内延迟消息（L1，划掉 App 后可能收不到）
  const plus = (globalThis as any).plus;
  if (!plus?.push?.createMessage) return null;
  const delaySeconds = Math.max(1, Math.round((atMs - Date.now()) / 1000));
  try {
    plus.push.createMessage(body, 'tunwu-expiry', {
      title,
      delay: delaySeconds,
      cover: false,
    });
    return 'local';
  } catch (err) {
    console.warn('[reminder] 定时通知创建失败', err);
    return null;
  }
  // #endif
  return null;
}

export interface ReminderScheduleResult {
  /** 本次新排上的日期 */
  scheduled: string[];
  reason: 'ok' | 'off' | 'unsupported' | 'no-permission';
}

let scheduling: Promise<ReminderScheduleResult> | null = null;

/**
 * 给未来几天排好 App 本地通知：每天 9:00，只排有物品到提醒天数的那天，
 * 滚动 7 天最多 2 条。H5 上直接返回 unsupported。
 * 同一时刻只跑一次，避免 App 启动和回到前台同时调用排重。
 */
export function scheduleLocalReminders(
  rows: InventoryRow[],
  now = new Date(),
  force = false,
): Promise<ReminderScheduleResult> {
  if (!scheduling) {
    scheduling = runSchedule(rows, now, force).finally(() => {
      scheduling = null;
    });
  }
  return scheduling;
}

async function runSchedule(
  rows: InventoryRow[],
  now: Date,
  force: boolean,
): Promise<ReminderScheduleResult> {
  // #ifndef APP-PLUS
  return { scheduled: [], reason: 'unsupported' };
  // #endif

  const plus = (globalThis as any).plus;
  const hasNativeScheduler = systemNotifyCapability().supported;
  if (!hasNativeScheduler && !plus?.push?.createMessage) {
    return { scheduled: [], reason: 'unsupported' };
  }

  let plans = loadPlans();
  // 设置变化时强制重排：先取消已登记的系统通知，再按新设置重建
  if (force) {
    systemNotifyCancelAll();
    plans = {};
  }

  // 只留最近几天，排期记录不会越攒越多
  const keepFrom = addDays(-3);
  for (const day of Object.keys(plans)) {
    if (day < keepFrom) delete plans[day];
  }

  const settings = await loadReminderSettings();
  if (!settings.enabled) {
    // 关闭提醒时取消系统计划，并清掉通知栏里已经弹出的
    systemNotifyCancelAll();
    try {
      plus?.push?.clear?.();
    } catch {
      // 清不掉也没关系
    }
    savePlans({});
    return { scheduled: [], reason: 'off' };
  }
  // 没拿到通知权限就不排，否则排了也弹不出来
  if (notificationPermissionState() !== 'granted') {
    savePlans(plans);
    return { scheduled: [], reason: 'no-permission' };
  }

  const reminders = await loadReminders();
  const scheduled: string[] = [];

  for (let offset = 1; offset <= PLAN_HORIZON_DAYS; offset += 1) {
    const day = addDays(offset);
    if (plans[day]) continue;

    const ids = dueItemIds(rows, day);
    if (!ids.length) continue;
    if (weeklyCount(plans, reminders, day) >= PLAN_WEEKLY_CAP) continue;

    const plannedAt = dayStartISO(day);
    plannedAt.setHours(PLAN_FIRE_HOUR, 0, 0, 0);
    // 9:00 落在自定义免打扰时段时顺延，避免系统通知在静默时间弹出
    const at = nextAllowedTime(plannedAt, settings);
    if (at.getTime() <= now.getTime()) continue;

    const channel = createScheduledMessage(day, at);
    if (channel === null) break;
    plans[day] = { at: at.getTime(), ids, channel: channel as 'system' | 'local' };
    scheduled.push(day);
    savePlans(plans);
  }

  savePlans(plans);
  return { scheduled, reason: 'ok' };
}

export type ReminderSkipReason =
  | ''
  | 'off'
  | 'quiet'
  | 'empty'
  | 'already'
  | 'scheduled'
  | 'weekly-cap'
  | 'no-permission';

export interface ReminderRunResult {
  /** 今天该提醒的物品 */
  due: InventoryRow[];
  sent: boolean;
  reason: ReminderSkipReason;
}

/**
 * 打开库存页时调用：只在按保质期算出的提前日或到期当天发，同一物品当天只发一次，
 * 每周最多 2 条（自定义免打扰时段内静默）。force 用于「立即检查」按钮。
 */
export async function runReminderCheck(rows: InventoryRow[], force = false): Promise<ReminderRunResult> {
  const settings = await loadReminderSettings();
  if (!settings.enabled) return { due: [], sent: false, reason: 'off' };

  const due = rows.filter((row) => {
    if (row.daysLeft === null || row.daysLeft < 0) return false;
    return row.daysLeft === 0 || leadDaysForRow(row).includes(row.daysLeft);
  });
  if (!due.length) return { due, sent: false, reason: 'empty' };
  if (!force && inQuietHours(new Date(), settings)) return { due, sent: false, reason: 'quiet' };

  const reminders = await loadReminders();
  const today = todayISO();
  // 今天已经排过系统通知的物品不再发一次，避免同一天弹两条
  const plans = loadPlans();
  const scheduledIds = new Set(plans[today]?.ids ?? []);
  const pending = due.filter((row) => !scheduledIds.has(row.item.id));
  if (!pending.length) return { due, sent: false, reason: 'scheduled' };

  const unsent = pending.filter(
    (row) =>
      !reminders.some(
        (item) =>
          item.type === 'expiry' &&
          item.target_id === row.item.id &&
          item.fire_at === today &&
          item.status === 'sent',
      ),
  );
  if (!unsent.length) return { due, sent: false, reason: 'already' };

  if (!force && weeklyCount(plans, reminders, today) >= PLAN_WEEKLY_CAP) {
    return { due: unsent, sent: false, reason: 'weekly-cap' };
  }

  // 自动检查时不主动弹授权框，只发已经拿到权限的；「立即检查」才主动申请
  const granted = force ? await requestNotificationPermission() : notificationPermissionState() === 'granted';
  if (!granted) return { due: unsent, sent: false, reason: 'no-permission' };

  const names = unsent
    .slice(0, 3)
    .map((row) => `${row.item.name}（${describeDays(row.daysLeft as number)}）`)
    .join('、');
  const body = unsent.length > 3 ? `${names} 等 ${unsent.length} 件快到期` : `${names} 快到期`;
  const sent = sendNotification('囤物有数 · 临期提醒', body);
  if (!sent) return { due: unsent, sent: false, reason: 'no-permission' };

  const channel: Reminder['channel'] = systemNotifyCapability().supported ? 'system' : 'local';
  const rowsToWrite: Reminder[] = unsent.map((row) => ({
    id: makeId(),
    type: 'expiry',
    target_id: row.item.id,
    fire_at: today,
    channel,
    status: 'sent',
  }));
  rowsToWrite.push({
    id: makeId(),
    type: 'weekly',
    target_id: 'expiry-digest',
    fire_at: today,
    channel,
    status: 'sent',
  });
  for (const row of rowsToWrite) await addReminder(row);

  return { due: unsent, sent, reason: '' };
}

export interface ReminderDiagnostics {
  level: 'L1' | 'L2';
  supported: boolean;
  permission: 'granted' | 'denied' | 'default' | 'unsupported';
  exactAlarm: boolean;
  channelReady: boolean;
}

/** 「我的」页展示用：当前设备的提醒能力与权限状态 */
export function reminderDiagnostics(): ReminderDiagnostics {
  const capability = systemNotifyCapability();
  return {
    level: capability.level,
    supported: capability.supported,
    permission: capability.permission,
    exactAlarm: capability.exactAlarm,
    channelReady: capability.channelReady,
  };
}

/**
 * 设定 seconds 秒后的一条测试通知，用于 L2 验收：
 * 在真机上把 App 从最近任务划掉，到点应仍能看到系统通知。
 */
export async function sendTestReminder(seconds = 60): Promise<boolean> {
  const granted = await requestNotificationPermission();
  if (!granted) return false;

  return systemNotifySchedule({
    id: `test-${Date.now()}`,
    title: '囤物有数 · 测试提醒',
    body: `这是 ${seconds} 秒后的系统通知，验证 App 划掉后仍能送达`,
    at: Date.now() + seconds * 1000,
    payload: '/pages/dashboard/index',
  });
}

export function openNotificationSettings(): void {
  systemNotifyOpenSettings();
}

export function openExactAlarmSettings(): void {
  systemNotifyOpenExactAlarmSettings();
}
