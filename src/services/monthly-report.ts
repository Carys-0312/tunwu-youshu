import type { Batch, Consumption, Item } from '@/types/models';
import { displayCategory } from '@/constants/categories';
import { addMonths } from '@/utils/date';

/**
 * 囤物月报的取数与判断。
 *
 * 口径（与 PRD 第 7 节一致）：
 * - 月报展示按「自然月」，月度数字截止到今天；
 * - 购买建议按「使用频率」，频率取最近 30 天有消耗记录的天数，不按点击次数；
 * - 数量只作为换算的分子，不单独作为「该不该买」的判据。
 */

const DAY_MS = 86_400_000;
const FREQ_WINDOW_DAYS = 30;
const IDLE_DAYS = 60;
const EXPIRING_DAYS = 7;

export interface ReportSource {
  items: Item[];
  batches: Batch[];
  consumptions: Consumption[];
}

/**
 * 月报按品类筛选：物品 → 批次 → 消耗流水一起收窄。
 * 「全部」或空字符串原样返回，避免无谓复制。
 */
export function filterReportSource(source: ReportSource, category: string): ReportSource {
  if (!category || category === '全部') return source;
  const items = source.items.filter((item) => displayCategory(item) === category);
  const itemIds = new Set(items.map((item) => item.id));
  const batches = source.batches.filter((batch) => itemIds.has(batch.item_id));
  const batchIds = new Set(batches.map((batch) => batch.id));
  const consumptions = source.consumptions.filter((row) => batchIds.has(row.batch_id));
  return { items, batches, consumptions };
}

export interface ReportItem {
  item: Item;
  /** 本月有消耗记录的天数 */
  useDays: number;
  /** 本月消耗次数 */
  uses: number;
  /** 本月用掉件数 */
  consumed: number;
  /** 本月买进件数 */
  bought: number;
  /** 近 30 天使用频率：有使用的天数 / 30 * 7，单位「天/周」 */
  freqPerWeek: number;
  /** 按当前频率估算的可用天数，数据不足为 null */
  daysLeft: number | null;
  /** 上次使用距今天数，从未用过为 null */
  lastUseDaysAgo: number | null;
  /** 平均补货间隔（天），买进记录不足 2 次为 null */
  buyCycleDays: number | null;
}

export interface WeekBucket {
  label: string;
  units: number;
  days: number;
  /** 0–100，用于 CSS 柱高 */
  height: number;
  current: boolean;
  /** 本月还没走到的周，画一个空的占位柱 */
  future: boolean;
}

export interface CategoryShare {
  name: string;
  days: number;
  share: number;
}

/** 单件物品在本月的使用占比：天数为主，件数为辅 */
export interface ItemShare {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  useDays: number;
  consumed: number;
  /** 占全部物品使用天数（同一物品同一天算一次）的百分比 */
  dayShare: number;
  /** 占全部用掉件数的百分比；跨单位比较仅作参考 */
  unitShare: number;
}

export type AdviceKind = 'act' | 'buy' | 'hold';

export interface Advice {
  id: string;
  kind: AdviceKind;
  title: string;
  /** 建议的依据，页面上只显示短标签 */
  basis: string[];
  /** 完整解释，用于口语版初稿和逐项导出 */
  detail: string;
  action: { label: string; url: string } | null;
}

/** 下个月的建议：当前月参考库存，历史月只按当月节奏 */
export interface NextMonthPlan {
  label: string;
  /** 给用户看的口径说明 */
  note: string;
  items: Advice[];
  /** 下月前会到期的物品种数；-1 表示历史月份没有当时的库存快照 */
  expiringItems: number;
  /** 下月前会到期的总件数 */
  expiringUnits: number;
  /** 下个月需要补货的物品种数；-1 表示历史月份无法判断 */
  restockItems: number;
}

/** 某一天用掉的某件东西，日历点开时用 */
export interface DayUsage {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  /** 物品照片；没有照片时用 emoji 兜底 */
  image: string | null;
  units: number;
}

/** 某一天开封的某件东西；同一天同一物品开了多批时合并成一条 */
export interface DayOpen {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  /** 物品照片；没有照片时用 emoji 兜底 */
  image: string | null;
  /** 这天这件物品开了几批 */
  batchCount: number;
  /** 开封后保质期（天），与月二选一 */
  paoDays: number | null;
  /** 开封后保质期（月） */
  paoMonths: number | null;
  /** 包装上的到期日 */
  expiryDate: string | null;
}

/** 某一天存进来的某件东西；同一天同一物品的新入库和补货合并成一条 */
export interface DayAdd {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  /** 物品照片；没有照片时用 emoji 兜底 */
  image: string | null;
  /** 这天存进来的件数 */
  units: number;
  /** 是不是这天新建的物品（否则是给已有物品补货） */
  newItem: boolean;
}

export interface DayCell {
  /** 几号 */
  day: number;
  units: number;
  /** 本月还没走到的那几天 */
  future: boolean;
  /** 是不是今天 */
  today: boolean;
  /** 这天用掉的东西，按件数从多到少 */
  rows: DayUsage[];
  /** 这天开封的东西，按物品去重 */
  opens: DayOpen[];
  /** 这天存入的东西（新建物品或补货），按件数从多到少 */
  adds: DayAdd[];
}

export interface MonthReport {
  month: string;
  label: string;
  /** 「11 月 1 日 – 11 月 9 日 · 截至今天」 */
  rangeLabel: string;
  /** 自然月总天数 */
  monthDays: number;
  observedDays: number;
  /** 是不是当前月 */
  isCurrent: boolean;
  activeDays: number;
  consumedUnits: number;
  boughtUnits: number;
  /** 当前没有可用的丢弃流水，显示「—」 */
  discardedUnits: number | null;
  /** 本月开封的批次数、涉及物品种数、有开封记录的天数 */
  openedBatches: number;
  openedItems: number;
  openedDays: number;
  newItems: number;
  activeItemCount: number;
  /** 整月的每日使用量，页面上画成日历热力图 */
  daily: DayCell[];
  /** 1 号是周几，周一算 0 */
  firstWeekday: number;
  todayDay: number | null;
  weeks: WeekBucket[];
  top: ReportItem[];
  categories: CategoryShare[];
  itemShares: ItemShare[];
  idle: ReportItem[];
  advices: Advice[];
  nextMonth: NextMonthPlan;
  /** 本月记录天数太少，建议会标注「还不太准」 */
  insufficient: boolean;
  previous: { activeDays: number; consumedUnits: number } | null;
}

/* ---------------- 日期工具：全部按本地中午计算，避免跨天 ---------------- */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function dayOf(stamp: string): string {
  return stamp.slice(0, 10);
}

function addDaysISO(iso: string, amount: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + amount);
  return isoOf(date);
}

function diffDays(from: string, to: string): number {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS);
}

export function currentMonth(): string {
  return isoOf(new Date()).slice(0, 7);
}

export function shiftMonth(month: string, amount: number): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value - 1 + amount, 1, 12);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${year} 年 ${value} 月`;
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function monthLastDay(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return isoOf(new Date(year, value, 0, 12));
}

function inRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month} 月 ${day} 日`;
}

/* ---------------- 取数 ---------------- */

interface RawIndex {
  itemByBatch: Map<string, string>;
  itemById: Map<string, Item>;
}

function buildIndex(source: ReportSource): RawIndex {
  const itemById = new Map(source.items.map((item) => [item.id, item]));
  const itemByBatch = new Map<string, string>();
  for (const batch of source.batches) {
    itemByBatch.set(batch.id, batch.item_id);
  }
  return { itemByBatch, itemById };
}

/** 丢弃流水：schema 类型里还没加，先用字符串判断，等动作上线再补类型 */
function isDiscard(row: Consumption): boolean {
  return (row.source as string) === 'discard';
}

/** 正 delta 是消耗，负 delta 是买进 */
function useRecords(source: ReportSource, index: RawIndex) {
  return source.consumptions
    .filter((row) => row.delta > 0 && !isDiscard(row))
    .map((row) => {
      const itemId = index.itemByBatch.get(row.batch_id);
      return itemId ? { row, itemId, day: dayOf(row.created_at) } : null;
    })
    .filter((entry): entry is { row: Consumption; itemId: string; day: string } => entry !== null);
}

function buyRecords(source: ReportSource, index: RawIndex) {
  return source.consumptions
    // 扔掉也是负 delta，但它不是买进，不能算进采购量
    .filter((row) => row.delta < 0 && !isDiscard(row))
    .map((row) => {
      const itemId = index.itemByBatch.get(row.batch_id);
      return itemId ? { row, itemId, day: dayOf(row.created_at) } : null;
    })
    .filter((entry): entry is { row: Consumption; itemId: string; day: string } => entry !== null);
}

/* ---------------- 单品指标 ---------------- */

function buildItemStats(
  source: ReportSource,
  index: RawIndex,
  monthStartISO: string,
  monthEndISO: string,
  today: string,
): ReportItem[] {
  const uses = useRecords(source, index);
  const buys = buyRecords(source, index);
  const freqStart = addDaysISO(today, -(FREQ_WINDOW_DAYS - 1));

  const monthUseDays = new Map<string, Set<string>>();
  const monthUses = new Map<string, number>();
  const monthConsumed = new Map<string, number>();
  const monthBought = new Map<string, number>();
  const rollingUseDays = new Map<string, Set<string>>();
  const rollingConsumed = new Map<string, number>();
  const lastUse = new Map<string, string>();
  const buyDates = new Map<string, string[]>();

  for (const { row, itemId, day } of uses) {
    if (inRange(day, monthStartISO, monthEndISO)) {
      if (!monthUseDays.has(itemId)) monthUseDays.set(itemId, new Set());
      monthUseDays.get(itemId)?.add(day);
      monthUses.set(itemId, (monthUses.get(itemId) ?? 0) + 1);
      monthConsumed.set(itemId, (monthConsumed.get(itemId) ?? 0) + row.delta);
    }
    if (inRange(day, freqStart, today)) {
      if (!rollingUseDays.has(itemId)) rollingUseDays.set(itemId, new Set());
      rollingUseDays.get(itemId)?.add(day);
      rollingConsumed.set(itemId, (rollingConsumed.get(itemId) ?? 0) + row.delta);
    }
    if (!lastUse.has(itemId) || day > (lastUse.get(itemId) ?? '')) {
      lastUse.set(itemId, day);
    }
  }

  for (const { row, itemId, day } of buys) {
    if (inRange(day, monthStartISO, monthEndISO)) {
      monthBought.set(itemId, (monthBought.get(itemId) ?? 0) + Math.abs(row.delta));
    }
    const dates = buyDates.get(itemId) ?? [];
    dates.push(day);
    buyDates.set(itemId, dates);
  }

  return source.items.map((item) => {
    const rollingDays = rollingUseDays.get(item.id)?.size ?? 0;
    const rollingUnits = rollingConsumed.get(item.id) ?? 0;
    const freqPerWeek = (rollingDays / FREQ_WINDOW_DAYS) * 7;
    const speed = rollingUnits / FREQ_WINDOW_DAYS;
    const lastUseDay = lastUse.get(item.id) ?? null;

    const dates = (buyDates.get(item.id) ?? []).slice().sort();
    let buyCycleDays: number | null = null;
    if (dates.length >= 2) {
      const recent = dates.slice(-4);
      const gaps: number[] = [];
      for (let i = 1; i < recent.length; i += 1) {
        gaps.push(diffDays(recent[i - 1], recent[i]));
      }
      const total = gaps.reduce((sum, gap) => sum + gap, 0);
      buyCycleDays = Math.round(total / gaps.length);
    }

    return {
      item,
      useDays: monthUseDays.get(item.id)?.size ?? 0,
      uses: monthUses.get(item.id) ?? 0,
      consumed: monthConsumed.get(item.id) ?? 0,
      bought: monthBought.get(item.id) ?? 0,
      freqPerWeek,
      daysLeft: speed > 0 ? Math.floor(item.quantity / speed) : null,
      lastUseDaysAgo: lastUseDay ? diffDays(lastUseDay, today) : null,
      buyCycleDays,
    };
  });
}

/* ---------------- 周柱状 ---------------- */

function buildWeeks(
  source: ReportSource,
  index: RawIndex,
  start: string,
  end: string,
  monthLast: string,
  today: string,
): WeekBucket[] {
  const uses = useRecords(source, index);
  const totalDays = diffDays(start, monthLast) + 1;
  const count = Math.max(1, Math.ceil(totalDays / 7));
  const buckets: WeekBucket[] = [];

  for (let i = 0; i < count; i += 1) {
    const bucketStart = addDaysISO(start, i * 7);
    const bucketEnd = [addDaysISO(bucketStart, 6), monthLast].sort()[0];
    const future = bucketStart > end;
    const rows = future
      ? []
      : uses.filter(({ day }) => day >= bucketStart && day <= [bucketEnd, end].sort()[0]);
    const days = new Set(rows.map(({ day }) => day)).size;
    buckets.push({
      label: `${dateOf(bucketStart).getDate()}–${dateOf(bucketEnd).getDate()}`,
      units: rows.reduce((sum, { row }) => sum + row.delta, 0),
      days,
      height: 0,
      current: inRange(today, bucketStart, bucketEnd) && !future,
      future,
    });
  }

  const max = Math.max(...buckets.map((bucket) => bucket.units), 1);
  for (const bucket of buckets) {
    bucket.height = bucket.units === 0 ? 3 : Math.max(8, Math.round((bucket.units / max) * 100));
  }
  return buckets;
}

/* ---------------- 品类占比：按记录天数，一天只归一个主要品类 ---------------- */

function buildCategories(daily: DayCell[]): CategoryShare[] {
  const byCategory = new Map<string, number>();

  for (const cell of daily) {
    if (!cell.rows.length) continue;
    // 一天只记一次：按当天用掉件数最多的品类归属。
    // 同一天用了几样东西不会把一天重复算进多个品类，圆环中心才能和有记录的天数对上。
    const unitsByCategory = new Map<string, number>();
    for (const row of cell.rows) {
      unitsByCategory.set(row.category, (unitsByCategory.get(row.category) ?? 0) + row.units);
    }
    let primary = '';
    let primaryUnits = -1;
    for (const [name, units] of unitsByCategory) {
      if (units > primaryUnits) {
        primary = name;
        primaryUnits = units;
      }
    }
    if (!primary) continue;
    byCategory.set(primary, (byCategory.get(primary) ?? 0) + 1);
  }

  const total = [...byCategory.values()].reduce((sum, days) => sum + days, 0);
  if (!total) return [];

  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, 4).map(([name, days]) => ({
    name,
    days,
    share: Math.round((days / total) * 100),
  }));

  const rest = sorted.slice(4);
  if (rest.length) {
    const days = rest.reduce((sum, [, value]) => sum + value, 0);
    head.push({ name: '其他', days, share: Math.round((days / total) * 100) });
  }
  return head;
}

/* ---------------- 物品使用占比：天数为主，件数为辅 ---------------- */

function sharePct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function buildItemShares(stats: ReportItem[], consumedUnits: number): ItemShare[] {
  const totalDays = stats.reduce((sum, stat) => sum + stat.useDays, 0);
  return stats
    .filter((stat) => stat.useDays > 0)
    .map((stat) => ({
      itemId: stat.item.id,
      name: stat.item.name,
      unit: stat.item.unit,
      category: displayCategory(stat.item),
      useDays: stat.useDays,
      consumed: stat.consumed,
      dayShare: sharePct(stat.useDays, totalDays),
      unitShare: sharePct(stat.consumed, consumedUnits),
    }))
    .sort(
      (a, b) => b.useDays - a.useDays || b.consumed - a.consumed || a.name.localeCompare(b.name),
    );
}

/* ---------------- 下个月的建议 ---------------- */

function batchExpiry(batch: Batch): string | null {
  if (batch.expiry_date) return batch.expiry_date;
  if (!batch.opened_at) return null;
  if (batch.pao_days && batch.pao_days > 0) {
    return addDaysISO(batch.opened_at.slice(0, 10), batch.pao_days);
  }
  if (batch.pao_months && batch.pao_months > 0) {
    return addMonths(batch.opened_at.slice(0, 10), batch.pao_months);
  }
  return null;
}

function buildNextMonthPlan(
  source: ReportSource,
  stats: ReportItem[],
  month: string,
  isCurrent: boolean,
  today: string,
  summary: {
    activeDays: number;
    consumedUnits: number;
    boughtUnits: number;
    top: ReportItem[];
    categories: CategoryShare[];
  },
): NextMonthPlan {
  const label = monthLabel(shiftMonth(month, 1));
  const items: Advice[] = [];
  const seenIds = new Set<string>();
  const seenItemIds = new Set<string>();
  const add = (advice: Advice, itemId?: string): void => {
    if (items.length >= 3 || seenIds.has(advice.id)) return;
    if (itemId && seenItemIds.has(itemId)) return;
    seenIds.add(advice.id);
    if (itemId) seenItemIds.add(itemId);
    items.push(advice);
  };

  if (!isCurrent) {
    // 历史月没有当时的库存，只能按这个月的节奏说，不能假装知道现在还剩多少
    if (summary.boughtUnits > summary.consumedUnits * 1.5 && summary.boughtUnits > 0) {
      add({
        id: 'next-history-overbought',
        kind: 'hold',
        title: '下个月补货前先清点库存',
        basis: [`买进 ${summary.boughtUnits} 件`, `用掉 ${summary.consumedUnits} 件`],
        detail: `这个月买进 ${summary.boughtUnits} 件、用掉 ${summary.consumedUnits} 件，买得比用得快；下个月补货前先看看家里还有多少。`,
        action: null,
      });
    }

    const top = summary.top[0];
    if (top && top.useDays >= 2) {
      add({
        id: `next-history-top-${top.item.id}`,
        kind: 'buy',
        title: `按${top.item.name}的节奏准备下个月`,
        basis: [`本月 ${top.useDays} 天用到`, `用掉 ${top.consumed} ${top.item.unit}`],
        detail: `这个月有 ${top.useDays} 天用到${top.item.name}，用掉 ${top.consumed} ${top.item.unit}；下个月可以按这个量准备，别一次囤太多。`,
        action: { label: '去看看', url: `/pages/item-detail/index?id=${top.item.id}` },
      }, top.item.id);
    }

    if (summary.activeDays < 3) {
      add({
        id: 'next-history-record',
        kind: 'hold',
        title: '下个月先把记录坚持下来',
        basis: [`本月有记录 ${summary.activeDays} 天`],
        detail:
          '有记录的天数还少，先不急着调整囤货量；下个月用掉东西时顺手点一下，报告会更准。',
        action: null,
      });
    }

    const category = summary.categories[0];
    if (category && category.share >= 60) {
      add({
        id: `next-history-category-${category.name}`,
        kind: 'hold',
        title: `${category.name}占得比较多`,
        basis: [`占使用天数 ${category.share}%`],
        detail: `${category.name}占了这个月使用天数的 ${category.share}%；下个月可以留意其他品类，别让一类东西囤得太集中。`,
        action: null,
      });
    }

    if (!items.length) {
      add({
        id: 'next-history-steady',
        kind: 'hold',
        title: '下个月按这个月的用量安排',
        basis: ['历史月份没有库存快照'],
        detail:
          '这个月没有明显的买多用少或品类集中；下个月先按这个月的消耗节奏准备，补货前再核对现有库存。',
        action: null,
      });
    }

    return {
      label,
      note: '历史月份看不到当时的库存，这里只按当月使用节奏给建议。',
      items,
      expiringItems: -1,
      expiringUnits: 0,
      restockItems: -1,
    };
  }

  // 当前月：先看快到期的，再看库存和频率
  const statById = new Map(stats.map((stat) => [stat.item.id, stat]));
  const expiring = source.batches
    .filter((batch) => batch.quantity > 0)
    .map((batch) => ({ batch, expiry: batchExpiry(batch) }))
    .filter((entry): entry is { batch: Batch; expiry: string } => entry.expiry !== null)
    .map((entry) => ({ ...entry, days: diffDays(today, entry.expiry) }))
    .filter((entry) => entry.days <= 30)
    .sort((a, b) => a.days - b.days);

  for (const { batch, expiry, days } of expiring) {
    const stat = statById.get(batch.item_id);
    if (!stat) continue;
    const when = days < 0 ? `已经过期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天后到期`;
    add({
      id: `next-expiry-${stat.item.id}`,
      kind: 'act',
      title: `下个月前先处理${stat.item.name}`,
      basis: [when, `库存 ${stat.item.quantity} ${stat.item.unit}`],
      detail: `${stat.item.name} · ${when}（到期日 ${expiry}），下个月前优先用掉，别补同类。`,
      action: { label: '去看看', url: `/pages/item-detail/index?id=${stat.item.id}` },
    }, stat.item.id);
  }

  const lowStock = stats
    .filter((stat) => stat.item.status === 'active')
    .filter((stat) => stat.item.quantity <= Math.max(stat.item.threshold, 1))
    .filter((stat) => stat.freqPerWeek >= 1 || stat.useDays >= 3)
    .sort((a, b) => b.freqPerWeek - a.freqPerWeek || b.useDays - a.useDays);

  for (const stat of lowStock) {
    const left = stat.daysLeft === null ? '' : `，按现在速度约 ${stat.daysLeft} 天用完`;
    add({
      id: `next-buy-${stat.item.id}`,
      kind: 'buy',
      title: `下个月先补${stat.item.name}`,
      basis: [`剩 ${stat.item.quantity} ${stat.item.unit}`, `每周用 ${stat.freqPerWeek.toFixed(1)} 天`],
      detail: `剩 ${stat.item.quantity} ${stat.item.unit}${left}；下个月初就可以补，别等到用完才想起来。`,
      action: { label: '去待购', url: '/pages/shopping/index' },
    }, stat.item.id);
  }

  const idle = stats
    .filter((stat) => stat.item.quantity > 0 && stat.item.status === 'active')
    .filter((stat) => {
      const age = stat.lastUseDaysAgo ?? diffDays(dayOf(stat.item.created_at), today);
      return age >= IDLE_DAYS;
    })
    .sort((a, b) => (b.lastUseDaysAgo ?? 999) - (a.lastUseDaysAgo ?? 999));

  for (const stat of idle) {
    const age = stat.lastUseDaysAgo ?? diffDays(dayOf(stat.item.created_at), today);
    add({
      id: `next-idle-${stat.item.id}`,
      kind: 'hold',
      title: `下个月别急着买${stat.item.name}`,
      basis: [`${age} 天没动`, `库存 ${stat.item.quantity} ${stat.item.unit}`],
      detail: `已经 ${age} 天没动过，下个月先把现有的用掉，别买同款。`,
      action: { label: '去看看', url: `/pages/item-detail/index?id=${stat.item.id}` },
    }, stat.item.id);
  }

  const overbought = stats
    .filter((stat) => stat.bought >= 3 && stat.consumed > 0 && stat.bought >= stat.consumed * 2)
    .sort((a, b) => b.bought / Math.max(b.consumed, 1) - a.bought / Math.max(a.consumed, 1));
  for (const stat of overbought) {
    add({
      id: `next-over-${stat.item.id}`,
      kind: 'hold',
      title: `下个月少买${stat.item.name}`,
      basis: [`买进 ${stat.bought} ${stat.item.unit}`, `用掉 ${stat.consumed} ${stat.item.unit}`],
      detail: `这个月买进 ${stat.bought}${stat.item.unit}、用掉 ${stat.consumed}${stat.item.unit}；下个月补货前先数一遍库存。`,
      action: null,
    }, stat.item.id);
  }

  if (!items.length) {
    add({
      id: 'next-steady',
      kind: 'hold',
      title: '下个月按现在的节奏补货',
      basis: ['本月没有临期或明显缺口'],
      detail: '这个月没有临期、低库存或闲置提醒；下个月保持记录，补货前看一眼库存就好。',
      action: null,
    });
  }

  // 海报上的「下月临期」按自然月算：从今天到下个月最后一天之间到期的都算，
  // 已经过期的也保留，避免海报显示 0 而建议里全是过期品。
  const nextMonthEnd = `${shiftMonth(month, 2)}-01`;
  const nextExpiring = source.batches.filter((batch) => {
    if (batch.quantity <= 0) return false;
    const expiry = batchExpiry(batch);
    return expiry !== null && expiry < nextMonthEnd;
  });
  const expiringItemIds = new Set(nextExpiring.map((batch) => batch.item_id));
  const expiringUnits = nextExpiring.reduce((sum, batch) => sum + batch.quantity, 0);

  return {
    label,
    note: '参考当前库存与保质期；补货前再看一眼实际库存。',
    items,
    expiringItems: expiringItemIds.size,
    expiringUnits,
    restockItems: lowStock.length,
  };
}

/* ---------------- 建议：频率为主，临期优先 ---------------- */

function buildAdvices(
  source: ReportSource,
  stats: ReportItem[],
  today: string,
): Advice[] {
  const statById = new Map(stats.map((stat) => [stat.item.id, stat]));
  const seen = new Set<string>();
  const advices: Advice[] = [];

  const push = (stat: ReportItem, advice: Advice): boolean => {
    if (seen.has(stat.item.id)) return false;
    seen.add(stat.item.id);
    advices.push(advice);
    return advices.length >= 3;
  };

  // 1. 临期 / 过期：任何频率都先处理
  const expiring = source.batches
    .filter((batch) => batch.quantity > 0 && batch.expiry_date)
    .map((batch) => ({ batch, days: diffDays(today, batch.expiry_date as string) }))
    .filter(({ days }) => days <= EXPIRING_DAYS)
    .sort((a, b) => a.days - b.days);

  for (const { batch, days } of expiring) {
    const stat = statById.get(batch.item_id);
    if (!stat) continue;
    const when = days < 0 ? `已经过期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天后到期`;
    if (
      push(stat, {
        id: `expiry-${batch.id}`,
        kind: 'act',
        title: `${stat.item.name} · ${when}`,
        basis: [days < 0 ? `已过期 ${-days} 天` : `还有 ${days} 天到期`],
        detail:
          days < 0
            ? '先处理掉，别买同类；如果经常放坏，下次买小包装。'
            : '先把它用掉，这几天别补同类。',
        action: { label: '去看看', url: `/pages/item-detail/index?id=${stat.item.id}` },
      })
    ) {
      return advices;
    }
  }

  // 2. 高频 + 库存少 = 该买；低频 + 库存少 = 不急着买
  const lowStock = stats
    .filter((stat) => stat.item.status === 'active')
    .filter((stat) => stat.item.quantity <= Math.max(stat.item.threshold, 1))
    .sort((a, b) => b.freqPerWeek - a.freqPerWeek);

  for (const stat of lowStock) {
    const { item } = stat;
    if (stat.freqPerWeek >= 1) {
      const left = stat.daysLeft === null ? '' : `，按现在速度约 ${stat.daysLeft} 天用完`;
      if (
        push(stat, {
          id: `buy-${item.id}`,
          kind: 'buy',
          title: `该补点${item.name}了`,
          basis: [
            `剩 ${item.quantity} ${item.unit}`,
            `每周用 ${stat.freqPerWeek.toFixed(1)} 天`,
            ...(stat.daysLeft === null ? [] : [`约 ${stat.daysLeft} 天用完`]),
          ],
          detail: `剩 ${item.quantity} ${item.unit}${left}；近 30 天每周大约用 ${stat.freqPerWeek.toFixed(1)} 天。`,
          action: { label: '去待购', url: '/pages/shopping/index' },
        })
      ) {
        return advices;
      }
    } else if (stat.useDays > 0) {
      if (
        push(stat, {
          id: `hold-${item.id}`,
          kind: 'hold',
          title: `${item.name} · 不用急着买`,
          basis: [`剩 ${item.quantity} ${item.unit}`, `本月用 ${stat.useDays} 天`],
          detail: `剩 ${item.quantity} ${item.unit}，这个月只用了 ${stat.useDays} 天；低频的东西，用完再补也不迟。`,
          action: null,
        })
      ) {
        return advices;
      }
    }
  }

  // 3. 60 天没动过：最直接的「别买同款」证据
  const idle = stats
    .filter((stat) => stat.item.quantity > 0 && stat.item.status === 'active')
    .filter((stat) => {
      const age = stat.lastUseDaysAgo ?? diffDays(dayOf(stat.item.created_at), today);
      return age >= IDLE_DAYS;
    })
    .sort((a, b) => (b.lastUseDaysAgo ?? 999) - (a.lastUseDaysAgo ?? 999));

  for (const stat of idle) {
    const idleAge = stat.lastUseDaysAgo ?? diffDays(dayOf(stat.item.created_at), today);
    if (
      push(stat, {
        id: `idle-${stat.item.id}`,
        kind: 'hold',
        title: `${stat.item.name} ${IDLE_DAYS} 天没动过`,
        basis: [`${idleAge} 天没动`, `库存 ${stat.item.quantity} ${stat.item.unit}`],
        detail:
          stat.lastUseDaysAgo === null
            ? '入库后一直没用过，下次别急着买同款。'
            : `上次用是 ${stat.lastUseDaysAgo} 天前，下次别急着买同款。`,
        action: { label: '去看看', url: `/pages/item-detail/index?id=${stat.item.id}` },
      })
    ) {
      return advices;
    }
  }

  // 4. 买用比：买得远比用得多
  const overbought = stats
    .filter((stat) => stat.bought >= 3 && stat.consumed > 0 && stat.bought >= stat.consumed * 2)
    .sort((a, b) => b.bought / Math.max(b.consumed, 1) - a.bought / Math.max(a.consumed, 1));

  for (const stat of overbought) {
    if (
      push(stat, {
        id: `over-${stat.item.id}`,
        kind: 'hold',
        title: `${stat.item.name}这个月买多了`,
        basis: [
          `买进 ${stat.bought} ${stat.item.unit}`,
          `用掉 ${stat.consumed} ${stat.item.unit}`,
        ],
        detail: `买进 ${stat.bought}${stat.item.unit}，用掉 ${stat.consumed}${stat.item.unit}；下次少买一点。`,
        action: null,
      })
    ) {
      return advices;
    }
  }

  return advices;
}

/* ---------------- 汇总 ---------------- */

export function buildMonthReport(source: ReportSource, month: string): MonthReport {
  const today = isoOf(new Date());
  const start = monthStart(month);
  const lastDay = monthLastDay(month);
  const isCurrent = month === today.slice(0, 7);
  const end = isCurrent ? today : [lastDay, today].sort()[0];
  const monthDays = diffDays(start, lastDay) + 1;
  const observedDays = Math.max(1, diffDays(start, end) + 1);
  const index = buildIndex(source);

  const uses = useRecords(source, index).filter(({ day }) => inRange(day, start, end));
  const buys = buyRecords(source, index).filter(({ day }) => inRange(day, start, end));
  const activeDays = new Set(uses.map(({ day }) => day)).size;
  const consumedUnits = uses.reduce((sum, { row }) => sum + row.delta, 0);
  const boughtUnits = buys.reduce((sum, { row }) => sum + Math.abs(row.delta), 0);
  const hasDiscard = source.consumptions.some((row) => isDiscard(row));
  const discardedUnits = hasDiscard
    ? source.consumptions
        .filter((row) => isDiscard(row) && inRange(dayOf(row.created_at), start, end))
        .reduce((sum, row) => sum + Math.abs(row.delta), 0)
    : null;

  const stats = buildItemStats(source, index, start, end, today);
  const unitsByDay = new Map<string, number>();
  const rowsByDay = new Map<string, Map<string, DayUsage>>();
  for (const { row, itemId, day } of uses) {
    unitsByDay.set(day, (unitsByDay.get(day) ?? 0) + row.delta);
    const item = index.itemById.get(itemId);
    if (!item) continue;
    let rows = rowsByDay.get(day);
    if (!rows) {
      rows = new Map();
      rowsByDay.set(day, rows);
    }
    const prev = rows.get(itemId);
    if (prev) {
      prev.units += row.delta;
    } else {
      rows.set(itemId, {
        itemId,
        name: item.name,
        unit: item.unit,
        category: displayCategory(item),
        image: item.image,
        units: row.delta,
      });
    }
  }
  const daily: DayCell[] = [];
  // 开封记录来自批次上的 opened_at，和消耗流水分开统计：
  // 开封只说明「开始用了」，不等于用掉，所以不进 activeDays / top / 品类占比。
  const opensByDay = new Map<string, Map<string, DayOpen>>();
  const openedItemIds = new Set<string>();
  let openedBatches = 0;
  for (const batch of source.batches) {
    if (!batch.opened_at) continue;
    const day = dayOf(batch.opened_at);
    if (!inRange(day, start, end)) continue;
    const item = index.itemById.get(batch.item_id);
    if (!item) continue;

    openedBatches += 1;
    openedItemIds.add(item.id);
    let rows = opensByDay.get(day);
    if (!rows) {
      rows = new Map();
      opensByDay.set(day, rows);
    }
    const prev = rows.get(item.id);
    if (prev) {
      prev.batchCount += 1;
      if (prev.paoDays === null) prev.paoDays = batch.pao_days;
      if (prev.paoMonths === null) prev.paoMonths = batch.pao_months;
      if (prev.expiryDate === null) prev.expiryDate = batch.expiry_date;
    } else {
      rows.set(item.id, {
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        category: displayCategory(item),
        image: item.image,
        batchCount: 1,
        paoDays: batch.pao_days,
        paoMonths: batch.pao_months,
        expiryDate: batch.expiry_date,
      });
    }
  }

  // 存入记录：新建物品看 item.created_at，给已有物品补货看负数消耗流水；
  // 两者都算「这天存进来的东西」，点开后再分新入库 / 补货。
  const addsByDay = new Map<string, Map<string, DayAdd>>();
  const recordAdd = (day: string, item: Item, units: number, isNew: boolean): void => {
    if (units <= 0) return;
    let rows = addsByDay.get(day);
    if (!rows) {
      rows = new Map();
      addsByDay.set(day, rows);
    }
    const prev = rows.get(item.id);
    if (prev) {
      prev.units += units;
      prev.newItem = prev.newItem || isNew;
      return;
    }
    rows.set(item.id, {
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      category: displayCategory(item),
      image: item.image,
      units,
      newItem: isNew,
    });
  };
  for (const item of source.items) {
    const day = dayOf(item.created_at);
    if (inRange(day, start, end)) recordAdd(day, item, Math.max(0, item.quantity), true);
  }
  for (const { row, itemId, day } of buys) {
    const item = index.itemById.get(itemId);
    if (item) recordAdd(day, item, Math.abs(row.delta), false);
  }

  for (let dayNumber = 1; dayNumber <= diffDays(start, lastDay) + 1; dayNumber += 1) {
    const iso = `${month}-${pad(dayNumber)}`;
    daily.push({
      day: dayNumber,
      units: unitsByDay.get(iso) ?? 0,
      future: iso > end,
      today: iso === today,
      rows: [...(rowsByDay.get(iso)?.values() ?? [])].sort((a, b) => b.units - a.units),
      opens: [...(opensByDay.get(iso)?.values() ?? [])].sort(
        (a, b) => b.batchCount - a.batchCount || a.name.localeCompare(b.name),
      ),
      adds: [...(addsByDay.get(iso)?.values() ?? [])].sort(
        (a, b) => b.units - a.units || a.name.localeCompare(b.name),
      ),
    });
  }
  const top = stats
    .filter((stat) => stat.useDays > 0)
    .sort((a, b) => b.useDays - a.useDays || b.consumed - a.consumed)
    .slice(0, 5);
  const idle = stats
    .filter((stat) => stat.item.quantity > 0 && stat.item.status === 'active')
    .filter((stat) => {
      const age = stat.lastUseDaysAgo ?? diffDays(dayOf(stat.item.created_at), today);
      return age >= IDLE_DAYS;
    })
    .sort((a, b) => (b.lastUseDaysAgo ?? 999) - (a.lastUseDaysAgo ?? 999))
    .slice(0, 3);
  const categories = buildCategories(daily);
  const itemShares = buildItemShares(stats, consumedUnits);
  const nextMonth = buildNextMonthPlan(source, stats, month, isCurrent, today, {
    activeDays,
    consumedUnits,
    boughtUnits,
    top,
    categories,
  });

  // 上月同期：同样长度的窗口，避免拿半个月比整月
  const previousStart = monthStart(shiftMonth(month, -1));
  const previousEnd = [addDaysISO(previousStart, observedDays - 1), monthLastDay(shiftMonth(month, -1))]
    .sort()[0];
  const previousUses = useRecords(source, index).filter(({ day }) =>
    inRange(day, previousStart, previousEnd),
  );
  const previous =
    previousUses.length > 0
      ? {
          activeDays: new Set(previousUses.map(({ day }) => day)).size,
          consumedUnits: previousUses.reduce((sum, { row }) => sum + row.delta, 0),
        }
      : null;

  const rangeLabel = isCurrent
    ? `${shortDate(start)} – ${shortDate(end)} · 截至今天`
    : `${shortDate(start)} – ${shortDate(end)}`;

  return {
    month,
    label: monthLabel(month),
    rangeLabel,
    monthDays,
    observedDays,
    isCurrent,
    activeDays,
    consumedUnits,
    boughtUnits,
    discardedUnits,
    openedBatches,
    openedItems: openedItemIds.size,
    openedDays: opensByDay.size,
    newItems: source.items.filter((item) => inRange(dayOf(item.created_at), start, end)).length,
    activeItemCount: source.items.filter((item) => item.status === 'active').length,
    daily,
    firstWeekday: (dateOf(start).getDay() + 6) % 7,
    todayDay: isCurrent ? Number(today.slice(8, 10)) : null,
    weeks: buildWeeks(source, index, start, end, lastDay, today),
    top,
    categories,
    itemShares,
    // 「60 天没动过」和购买建议都是看当前状态，历史月份不展示，避免拿今天的状态解释上个月
    idle: isCurrent ? idle : [],
    advices: isCurrent ? buildAdvices(source, stats, today) : [],
    nextMonth,
    insufficient: activeDays < 3,
    previous,
  };
}

