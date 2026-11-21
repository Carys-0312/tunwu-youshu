import type { Consumption, Item } from '@/types/models';
import { displayCategory } from '@/constants/categories';
import type { CategoryShare, ReportSource } from '@/services/monthly-report';

/**
 * 囤物年报的取数与文字版。
 *
 * 口径和月报保持一致：
 * - 正 delta 且不是丢弃 = 用掉；负 delta 且不是丢弃 = 买进；
 * - 「用了几天」按有消耗记录的自然日算，不按流水条数；
 * - 品类占比按使用天数，跨单位可比；
 * - 当前年份只统计到今天，往年统计整年。
 */

const DAY_MS = 86_400_000;

export interface YearMonthRow {
  month: number;
  units: number;
  bought: number;
  /** 当前没有可用的丢弃流水时为 null，显示「—」 */
  discarded: number | null;
  activeDays: number;
  observedDays: number;
  /** 这个月还没过完，文字版标注「截至今天」 */
  current: boolean;
}

export interface YearTopItem {
  item: Item;
  /** 全年有消耗记录的天数 */
  useDays: number;
  /** 全年用掉件数 */
  consumed: number;
}

export interface YearReport {
  year: number;
  label: string;
  rangeLabel: string;
  observedDays: number;
  activeDays: number;
  consumedUnits: number;
  boughtUnits: number;
  discardedUnits: number | null;
  newItems: number;
  activeItemCount: number;
  months: YearMonthRow[];
  top: YearTopItem[];
  categories: CategoryShare[];
  busiestMonth: YearMonthRow | null;
  /** 上一年同期，没记录时为 null */
  previous: { activeDays: number; consumedUnits: number } | null;
}

/* ---------------- 日期工具：和月报一样按本地中午计算 ---------------- */

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

function diffDays(from: string, to: string): number {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS);
}

function inRange(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

function monthLastDay(year: number, month: number): string {
  return isoOf(new Date(year, month, 0, 12));
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month} 月 ${day} 日`;
}

/** 丢弃流水：schema 类型里还没加，和月报用同一种判断 */
function isDiscard(row: Consumption): boolean {
  return (row.source as string) === 'discard';
}

/* ---------------- 汇总 ---------------- */

interface MonthAcc {
  units: number;
  bought: number;
  discarded: number;
  days: Set<string>;
}

interface ItemAcc {
  useDays: Set<string>;
  consumed: number;
}

export function buildYearReport(source: ReportSource, year: number): YearReport {
  const today = isoOf(new Date());
  const currentYear = Number(today.slice(0, 4));
  const start = `${year}-01-01`;
  const isCurrent = year === currentYear;
  const end = isCurrent ? today : `${year}-12-31`;
  const observedDays = Math.max(1, diffDays(start, end) + 1);

  const itemByBatch = new Map(source.batches.map((batch) => [batch.id, batch.item_id]));
  const itemById = new Map(source.items.map((item) => [item.id, item]));
  const hasDiscard = source.consumptions.some((row) => isDiscard(row));

  const monthAcc: MonthAcc[] = Array.from({ length: 12 }, () => ({
    units: 0,
    bought: 0,
    discarded: 0,
    days: new Set<string>(),
  }));
  const itemAcc = new Map<string, ItemAcc>();
  const activeDays = new Set<string>();
  let consumedUnits = 0;
  let boughtUnits = 0;
  let discardedUnits = 0;

  for (const row of source.consumptions) {
    const day = dayOf(row.created_at);
    if (!inRange(day, start, end)) continue;
    const monthIndex = Number(day.slice(5, 7)) - 1;
    const bucket = monthAcc[monthIndex];
    if (!bucket) continue;

    if (isDiscard(row)) {
      discardedUnits += Math.abs(row.delta);
      bucket.discarded += Math.abs(row.delta);
      continue;
    }

    const itemId = itemByBatch.get(row.batch_id);
    if (!itemId || !itemById.has(itemId)) continue;

    if (row.delta > 0) {
      consumedUnits += row.delta;
      bucket.units += row.delta;
      bucket.days.add(day);
      activeDays.add(day);

      const acc = itemAcc.get(itemId) ?? { useDays: new Set<string>(), consumed: 0 };
      acc.useDays.add(day);
      acc.consumed += row.delta;
      itemAcc.set(itemId, acc);
    } else if (row.delta < 0) {
      const units = Math.abs(row.delta);
      boughtUnits += units;
      bucket.bought += units;
    }
  }

  // 只列已经走过的月份；往年就是 12 个整月
  const endMonth = Number(end.slice(5, 7));
  const todayMonth = Number(today.slice(5, 7));
  const months: YearMonthRow[] = [];
  for (let value = 1; value <= endMonth; value += 1) {
    const monthStart = `${year}-${pad(value)}-01`;
    const monthEnd = monthLastDay(year, value);
    const observedEnd = [monthEnd, end].sort()[0];
    const acc = monthAcc[value - 1];
    months.push({
      month: value,
      units: acc.units,
      bought: acc.bought,
      discarded: hasDiscard ? acc.discarded : null,
      activeDays: acc.days.size,
      observedDays: Math.max(1, diffDays(monthStart, observedEnd) + 1),
      current: isCurrent && value === todayMonth,
    });
  }

  const top = [...itemAcc.entries()]
    .map(([itemId, acc]) => {
      const item = itemById.get(itemId);
      return item ? { item, useDays: acc.useDays.size, consumed: acc.consumed } : null;
    })
    .filter((entry): entry is YearTopItem => entry !== null)
    .filter((entry) => entry.useDays > 0)
    .sort((a, b) => b.useDays - a.useDays || b.consumed - a.consumed)
    .slice(0, 5);

  const daysByCategory = new Map<string, number>();
  for (const [itemId, acc] of itemAcc) {
    const item = itemById.get(itemId);
    if (!item || !acc.useDays.size) continue;
    const name = displayCategory(item);
    daysByCategory.set(name, (daysByCategory.get(name) ?? 0) + acc.useDays.size);
  }
  const categoryTotal = [...daysByCategory.values()].reduce((sum, days) => sum + days, 0);
  const categories: CategoryShare[] = [];
  if (categoryTotal > 0) {
    const sorted = [...daysByCategory.entries()].sort((a, b) => b[1] - a[1]);
    sorted.slice(0, 4).forEach(([name, days]) => {
      categories.push({ name, days, share: Math.round((days / categoryTotal) * 100) });
    });
    const rest = sorted.slice(4);
    if (rest.length) {
      const days = rest.reduce((sum, [, value]) => sum + value, 0);
      categories.push({ name: '其他', days, share: Math.round((days / categoryTotal) * 100) });
    }
  }

  const busiestMonth = months
    .filter((row) => row.units > 0)
    .reduce<YearMonthRow | null>(
      (best, row) => (!best || row.units > best.units ? row : best),
      null,
    );

  // 上一年同期：当前年份比到同一天，往年比整年
  const previousYear = year - 1;
  const previousStart = `${previousYear}-01-01`;
  const previousEnd = isCurrent ? `${previousYear}-${today.slice(5)}` : `${previousYear}-12-31`;
  let previousUnits = 0;
  const previousDays = new Set<string>();
  for (const row of source.consumptions) {
    if (row.delta <= 0 || isDiscard(row)) continue;
    if (!itemByBatch.has(row.batch_id)) continue;
    const day = dayOf(row.created_at);
    if (!inRange(day, previousStart, previousEnd)) continue;
    previousUnits += row.delta;
    previousDays.add(day);
  }
  const previous = previousDays.size
    ? { activeDays: previousDays.size, consumedUnits: previousUnits }
    : null;

  return {
    year,
    label: `${year} 年`,
    rangeLabel: isCurrent
      ? `1 月 1 日 – ${shortDate(end)} · 截至今天`
      : `1 月 1 日 – 12 月 31 日`,
    observedDays,
    activeDays: activeDays.size,
    consumedUnits,
    boughtUnits,
    discardedUnits: hasDiscard ? discardedUnits : null,
    newItems: source.items.filter((item) => inRange(dayOf(item.created_at), start, end)).length,
    activeItemCount: source.items.filter((item) => item.status === 'active').length,
    months,
    top,
    categories,
    busiestMonth,
    previous,
  };
}

/* ---------------- 导出用的文字版 ---------------- */

/** 整份年报：小囤说在前，明细在后；story 为空时只导出明细 */
export function buildYearReportText(report: YearReport, story = ''): string {
  const now = new Date();
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);

  push(`囤物年报 · ${report.label}`);
  push(`统计范围：${report.rangeLabel}`);
  push(`导出时间：${isoOf(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`);
  push();

  const foreword = story.trim();
  if (foreword) {
    push('小囤说');
    push(foreword);
    push();
    push('数据明细');
    push();
  }

  push('一、全年总览');
  push(`- 在用天数：${report.activeDays} / ${report.observedDays} 天`);
  push(`- 用掉：${report.consumedUnits} 件`);
  push(`- 买进：${report.boughtUnits} 件`);
  push(
    `- 扔掉：${
      report.discardedUnits === null ? '—（丢弃记录还没开启）' : `${report.discardedUnits} 件`
    }`,
  );
  push(`- 新增物品：${report.newItems} 种；当前在用：${report.activeItemCount} 种`);
  if (report.previous) {
    const diff = report.consumedUnits - report.previous.consumedUnits;
    const compare = diff === 0 ? '持平' : diff > 0 ? `多了 ${diff} 件` : `少了 ${-diff} 件`;
    push(`- 和去年比：用掉${compare}`);
  } else {
    push('- 和去年比：去年还没有记录');
  }
  push();

  push('二、逐月节奏');
  for (const row of report.months) {
    push(
      `- ${row.month} 月：用掉 ${row.units} 件，买进 ${row.bought} 件，有记录 ${
        row.activeDays
      } 天${row.current ? '（截至今天）' : ''}`,
    );
  }
  if (report.busiestMonth) {
    push(`用得最多的月份：${report.busiestMonth.month} 月，${report.busiestMonth.units} 件`);
  }
  push();

  push('三、全年最常用（按使用天数）');
  if (report.top.length) {
    const weeks = Math.max(report.observedDays / 7, 1);
    report.top.forEach((row, index) => {
      push(
        `${index + 1}. ${row.item.name}：${row.useDays} 天用过，用掉 ${row.consumed} ${
          row.item.unit
        }，平均每周约 ${(row.useDays / weeks).toFixed(1)} 天`,
      );
    });
  } else {
    push('这一年还没有消耗记录。');
  }
  push();

  push('四、品类分布（按使用天数）');
  if (report.categories.length) {
    for (const category of report.categories) {
      push(`- ${category.name}：${category.days} 天，占 ${category.share}%`);
    }
  } else {
    push('- 还没有可以统计的使用记录');
  }
  push();

  push('五、怎么算的');
  push('- 口径和月报一致：有消耗记录的天数算「在用」，流水正数算用掉、负数算买进');
  push('- 月份按自然月切分；当前年份只算到今天，往年算完整一年');
  push('- 品类占比按使用天数，跨单位可比');
  push('- 年报只做回顾，不含补货建议；要不要补货看当前库存更准');
  push('- 明细在本机计算；只有小囤说会发给模型润色，不上传原始记录');
  push();
  push('—— 囤物有数 · 小囤');

  return lines.join('\n');
}
