<script setup lang="ts">
/**
 * 囤物月报：先给用户看懂，再给用户能带走的解释。
 *
 * - 页面以图表为主：使用日历、周节奏、品类占比、最常用条形；
 * - 建议在页面只留结论 + 依据标签，完整解释放进导出的图片；
 * - 导出只有图片：月报和年报都进模板页，选一套样式生成海报；
 * - 判断口径：频率优先，件数只做换算（PRD 第 7 节）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { onPageScroll, onShow } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { loadReportData } from '@/db/repo';
import {
  buildMonthReport,
  currentMonth,
  shiftMonth,
  type DayAdd,
  type DayCell,
  type DayOpen,
  type DayUsage,
  type MonthReport,
  type ReportItem,
} from '@/services/monthly-report';
import { displayCategory } from '@/constants/categories';
import { itemEmoji } from '@/utils/item-visual';
import TabBar from '@/components/TabBar.vue';
import FeatureTour from '@/components/FeatureTour.vue';

const store = useInventoryStore();
const month = ref(currentMonth());
const report = ref<MonthReport | null>(null);
const loading = ref(true);
/** 数据到位后再打开动画，避免首帧直接定死 */
const chartReady = ref(false);
/** 日历里点开的一天：这天用掉和存进来的东西 */
const activeDay = ref<{ day: number; rows: DayUsage[]; adds: DayAdd[] } | null>(null);
/** 日历里点开「开封」标记：这一天开了哪些东西 */
const activeOpens = ref<{ day: number; rows: DayOpen[] } | null>(null);
/** 年月选择面板 */
const panelOpen = ref(false);
const panelYear = ref(Number(currentMonth().slice(0, 4)));
/** 有数据的最早年份，年份切换不早于它 */
const dataStartYear = ref(Number(currentMonth().slice(0, 4)));
/** 圆环中心的计数器：从 0 一个个跳到「有记录的天数」 */
const donutCount = ref(0);
let donutTimer: ReturnType<typeof setInterval> | null = null;
let chartTimer: ReturnType<typeof setTimeout> | null = null;

function stopChartTimer(): void {
  if (chartTimer) {
    clearTimeout(chartTimer);
    chartTimer = null;
  }
}

function stopDonutCount(): void {
  if (donutTimer) {
    clearInterval(donutTimer);
    donutTimer = null;
  }
}

function playDonutCount(target: number): void {
  stopDonutCount();
  donutCount.value = 0;
  if (target <= 0) return;
  // 最多跳 31 天，按目标值把总时长压在 1 秒左右
  const step = Math.max(18, Math.min(70, Math.round(900 / target)));
  donutTimer = setInterval(() => {
    if (donutCount.value >= target) {
      donutCount.value = target;
      stopDonutCount();
      return;
    }
    donutCount.value += 1;
  }, step);
}

/**
 * 小节卡片的悬停放大：手指往下滑时，每张卡片经过屏幕上方的焦点线，
 * 越靠近焦点线放得越大，滑过去再收回来。
 * 位置只在数据渲染完后量一次（换月份、数据变了会重量）。
 */
const HOVER_KEYS = ['pace', 'cats', 'tops', 'advice', 'export'] as const;
type HoverKey = (typeof HOVER_KEYS)[number];

/** 焦点线：屏幕高度 34% 处；离它 30% 屏高以内开始变化，放大的过程拉长一点更明显 */
const HOVER_FOCUS = 0.34;
const HOVER_BAND = 0.3;
/**
 * 最大放大倍数。卡片左右各留 12px 边距，放 6% 仍在屏宽以内
 * （365px 的卡片每边多出约 11px），不会把页面撑出横向滚动。
 */
const HOVER_GROW = 0.06;

const scrollTop = ref(0);
/** 每张卡片的文档中线，以及它放大到最大时所在的视口高度 */
const labelGeometry = ref<Partial<Record<HoverKey, { center: number; focus: number }>>>({});
let measureTimer: ReturnType<typeof setTimeout> | null = null;
let screenHeight = 0;

function measureHoverLabels(): void {
  if (measureTimer) clearTimeout(measureTimer);
  measureTimer = setTimeout(() => {
    measureTimer = null;
    screenHeight = uni.getSystemInfoSync().windowHeight || 800;
    const query = uni.createSelectorQuery();
    // 一次拿全部卡片，用 id 认人（02/03/04 是条件渲染，不能用下标）
    query.selectAll('.hover-card').boundingClientRect();
    query.select('.page').boundingClientRect();
    (query.selectViewport() as unknown as { scrollOffset: () => void }).scrollOffset();
    query.exec((res) => {
      const rects = (res[0] as Array<{ id?: string; top: number; height: number } | null> | null) ?? [];
      const pageRect = res[1] as { height?: number } | null;
      const viewport = res[2] as { scrollTop?: number; scrollHeight?: number } | null;
      const scroll = Number(viewport?.scrollTop ?? 0);
      // 滚到底最多还能往下走多少：够不到焦点线的卡片（比如最末尾的导出报告）把焦点线挪低
      const contentHeight = Number(viewport?.scrollHeight ?? 0) || Number(pageRect?.height ?? 0);
      const maxScroll = Math.max(0, contentHeight - screenHeight);
      const geometry: Partial<Record<HoverKey, { center: number; focus: number }>> = {};
      rects.forEach((rect) => {
        if (!rect) return;
        const key = (rect.id || '').replace('hover-', '');
        if (!(HOVER_KEYS as readonly string[]).includes(key)) return;
        const center = Math.round(rect.top + rect.height / 2 + scroll);
        geometry[key as HoverKey] = {
          center,
          focus: Math.max(screenHeight * HOVER_FOCUS, center - maxScroll),
        };
      });
      labelGeometry.value = geometry;
    });
  }, 150);
}

/** 每张卡片当前的放大进度（0 不动，1 最大） */
const hoverEase = computed<Partial<Record<HoverKey, number>>>(() => {
  const screen = screenHeight || 800;
  const band = screen * HOVER_BAND;
  const eased: Partial<Record<HoverKey, number>> = {};
  HOVER_KEYS.forEach((key) => {
    const geo = labelGeometry.value[key];
    if (!geo) return;
    const distance = Math.abs(geo.center - scrollTop.value - geo.focus);
    if (distance >= band) return;
    const t = 1 - distance / band;
    eased[key] = t * t * (3 - 2 * t);
  });
  return eased;
});

/** 卡片中线离焦点线越近，scale 越大；出了这条带就回到 1 */
function hoverStyle(key: HoverKey): Record<string, string> {
  const ease = hoverEase.value[key] ?? 0;
  if (ease <= 0) return {};
  return { transform: `scale(${(1 + HOVER_GROW * ease).toFixed(4)})` };
}

/** 放大到一定程度才让边缘的标签条跑出来 */
function hoverActive(key: HoverKey): boolean {
  return (hoverEase.value[key] ?? 0) > 0.2;
}

function syncScroll(top: number): void {
  const next = Math.round(top);
  if (next !== scrollTop.value) scrollTop.value = next;
}

// App 端走页面的 onPageScroll
onPageScroll((event) => {
  syncScroll(event.scrollTop);
});

// #ifdef H5
// H5 端页面滚的是 window，uni 的 onPageScroll 在浏览器里不一定抛事件，
// 这里直接听 window 的 scroll，位置实时跟手
function onWindowScroll(): void {
  syncScroll(window.scrollY || document.documentElement.scrollTop || 0);
}

onMounted(() => {
  window.addEventListener('scroll', onWindowScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', onWindowScroll);
});
// #endif

/** 转屏、地址栏收起、键盘弹出都会改视口高度，标题位置要重新量 */
function onViewportResize(): void {
  measureHoverLabels();
}

onMounted(() => {
  uni.onWindowResize(onViewportResize);
});

onUnmounted(() => {
  uni.offWindowResize(onViewportResize);
});

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const CATEGORY_COLORS = ['#d9a334', '#a9b38b', '#c98f5a', '#7f9a94', '#d8c9aa'];
const TODAY_MONTH = currentMonth();
const TODAY_YEAR = Number(TODAY_MONTH.slice(0, 4));

const isCurrentMonth = computed(() => month.value === TODAY_MONTH);

async function load(): Promise<void> {
  loading.value = true;
  chartReady.value = false;
  stopDonutCount();
  stopChartTimer();
  donutCount.value = 0;
  activeDay.value = null;
  activeOpens.value = null;
  // 底部是自己画的 TabBar，原生 tabBar 从头到尾都要藏着（这里以前会重新 show 出来）
  uni.hideTabBar({ animation: false });
  try {
    await store.init();
    const data = await loadReportData();
    const next = buildMonthReport(data, month.value);
    report.value = next;
    // 有数据的最早年份，年份切换不早于它
    const years = [...data.items.map((item) => item.created_at), ...data.consumptions.map((row) => row.created_at)]
      .filter((stamp) => typeof stamp === 'string' && stamp.length >= 4)
      .map((stamp) => Number(stamp.slice(0, 4)))
      .filter((year) => Number.isFinite(year) && year > 2000);
    // 至少留 5 年可翻；有更早的数据就跟着数据走
    dataStartYear.value = Math.min(...years, TODAY_YEAR - 5);
    chartTimer = setTimeout(() => {
      chartTimer = null;
      chartReady.value = true;
      const totalDays = next.categories.reduce((sum, category) => sum + category.days, 0);
      playDonutCount(totalDays);
      measureHoverLabels();
    }, 80);
  } catch (err) {
    console.error('[report] 生成月报失败', err);
    uni.showToast({ title: '月报算不出来，稍后再试', icon: 'none' });
  } finally {
    loading.value = false;
    // 卡片渲染完再量标题位置（02/03/04 是条件渲染，顺序不固定，只能按类名找）
    nextTick(measureHoverLabels);
  }
}

onUnmounted(() => {
  stopDonutCount();
  stopChartTimer();
});

/* ---------------- 年月选择面板 ---------------- */

function togglePanel(): void {
  panelOpen.value = !panelOpen.value;
  if (panelOpen.value) panelYear.value = Number(month.value.slice(0, 4));
}

function shiftPanelYear(amount: number): void {
  const next = panelYear.value + amount;
  if (next < dataStartYear.value || next > TODAY_YEAR) return;
  panelYear.value = next;
}

function pickMonth(monthNumber: number): void {
  const value = `${panelYear.value}-${String(monthNumber).padStart(2, '0')}`;
  if (value > TODAY_MONTH) return;
  panelOpen.value = false;
  month.value = value;
  void load();
}

function monthCellState(monthNumber: number): Record<string, boolean> {
  const value = `${panelYear.value}-${String(monthNumber).padStart(2, '0')}`;
  return {
    'month-panel__cell--selected': value === month.value,
    'month-panel__cell--current': value === TODAY_MONTH,
    'month-panel__cell--future': value > TODAY_MONTH,
  };
}

function goToday(): void {
  panelOpen.value = false;
  month.value = TODAY_MONTH;
  void load();
}

function goPrev(): void {
  panelOpen.value = false;
  month.value = shiftMonth(month.value, -1);
  void load();
}

function goNext(): void {
  if (isCurrentMonth.value) return;
  panelOpen.value = false;
  month.value = shiftMonth(month.value, 1);
  void load();
}

/* ---------------- 品类占比 ---------------- */

const categorySlices = computed(() => {
  const categories = report.value?.categories ?? [];
  const total = categories.reduce((sum, category) => sum + category.days, 0);
  if (!total) return [];
  // 百分比按最大余数法凑满 100，避免图例加起来是 99%
  const raw = categories.map((category) => (category.days / total) * 100);
  const shares = raw.map((value) => Math.floor(value));
  const rest = 100 - shares.reduce((sum, value) => sum + value, 0);
  raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, rest)
    .forEach(({ index }) => {
      shares[index] += 1;
    });
  let cursor = 0;
  return categories.map((category, index) => {
    const start = cursor;
    cursor += raw[index];
    return {
      ...category,
      share: shares[index],
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      start,
      end: cursor,
    };
  });
});

/** 品类圆环中间的总天数：每个有记录的日子只记一次，和圆环各段相加一致 */
const categoryTotalDays = computed(() =>
  (report.value?.categories ?? []).reduce((sum, category) => sum + category.days, 0),
);

/** 圆环旁边的主力图例：占比最高的那一类 */
const topCategory = computed(
  () =>
    categorySlices.value[0] ?? {
      name: '—',
      days: 0,
      share: 0,
      color: '#d8c9aa',
      start: 0,
      end: 0,
    },
);

/** 用精确百分比拼 conic-gradient，保证圆环和柱状占比一致 */
const donutGradient = computed(() => {
  const slices = categorySlices.value;
  if (!slices.length) return 'conic-gradient(#efe2c7 0 100%)';
  const stops = slices.map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`);
  return `conic-gradient(from -90deg, ${stops.join(', ')})`;
});

/* ---------------- 日历 / 列表 ---------------- */

function heatLevel(cell: DayCell): string {
  if (cell.future) return 'future';
  if (cell.units <= 0) return 'zero';
  if (cell.units === 1) return 'low';
  if (cell.units <= 3) return 'mid';
  return 'high';
}

interface CalendarIcon {
  itemId: string;
  name: string;
  category: string;
  kind: 'add' | 'use';
}

/**
 * 一格最多摆 3 个图标；超过时留 2 个再加 +N。
 * 存入优先占位：用户刚存进来的东西一定要在日历上看到，
 * 剩余位置再用当天的消耗补齐，底色也用来区分两者。
 */
function dayIcons(cell: DayCell): CalendarIcon[] {
  const total = cell.adds.length + cell.rows.length;
  const limit = total > 3 ? 2 : 3;
  const adds = cell.adds.slice(0, limit).map<CalendarIcon>((row) => ({ ...row, kind: 'add' }));
  const uses = cell.rows
    .slice(0, Math.max(0, limit - adds.length))
    .map<CalendarIcon>((row) => ({ ...row, kind: 'use' }));
  return [...adds, ...uses];
}

function dayIconsHidden(cell: DayCell): number {
  return Math.max(0, cell.rows.length + cell.adds.length - dayIcons(cell).length);
}

function openDay(day: number): void {
  const cell = report.value?.daily.find((row) => row.day === day);
  if (!cell || (!cell.rows.length && !cell.adds.length)) return;
  activeOpens.value = null;
  activeDay.value = { day, rows: cell.rows, adds: cell.adds };
}

function closeDay(): void {
  activeDay.value = null;
}

function openDayItem(itemId: string): void {
  closeDay();
  openItem(itemId);
}

function openOpens(day: number): void {
  const cell = report.value?.daily.find((row) => row.day === day);
  if (!cell?.opens.length) return;
  activeDay.value = null;
  activeOpens.value = { day, rows: cell.opens };
}

function closeOpens(): void {
  activeOpens.value = null;
}

const dayDateLabel = computed(() => {
  const current = report.value;
  if (!current || !activeDay.value) return '';
  const day = activeDay.value.day;
  const weekday = WEEKDAYS[(current.firstWeekday + day - 1) % 7];
  const count = activeDay.value.rows.length + activeDay.value.adds.length;
  return `${Number(current.month.slice(5))} 月 ${day} 日 · 周${weekday}${count > 1 ? ` · ${count} 种` : ''}`;
});

const openedDateLabel = computed(() => {
  const current = report.value;
  if (!current || !activeOpens.value) return '';
  const day = activeOpens.value.day;
  const weekday = WEEKDAYS[(current.firstWeekday + day - 1) % 7];
  return `${Number(current.month.slice(5))} 月 ${day} 日 · 周${weekday}`;
});

function openShelfText(row: DayOpen): string {
  const parts: string[] = [];
  if (row.paoMonths) parts.push(`开封后 ${row.paoMonths} 个月`);
  if (row.expiryDate) parts.push(`包装到期 ${row.expiryDate}`);
  return parts.length ? parts.join(' · ') : '未设置开封后保质期';
}

function openFromSheet(itemId: string): void {
  closeOpens();
  openItem(itemId);
}

function dayEmoji(row: { name: string; category: string }): string {
  return itemEmoji(row.name, row.category);
}

/** 弹层里的物品照片；加载失败或没有照片时退回 emoji */
const brokenSheetPhotos = ref<Record<string, boolean>>({});

function sheetPhoto(row: { itemId: string; image: string | null }): string {
  return !brokenSheetPhotos.value[row.itemId] && row.image ? row.image : '';
}

function markSheetPhotoBroken(itemId: string): void {
  brokenSheetPhotos.value = { ...brokenSheetPhotos.value, [itemId]: true };
}

/* ---------------- 消耗节奏：按周柱状 ---------------- */

const weeks = computed(() => report.value?.weeks ?? []);

/** 参考线只看已经走完的整周；月初只有半周时退回所有已过的周 */
const weekAvg = computed(() => {
  const done = weeks.value.filter((week) => !week.future && !week.current);
  const source = done.length ? done : weeks.value.filter((week) => !week.future);
  if (!source.length) return 0;
  return source.reduce((sum, week) => sum + week.units, 0) / source.length;
});

const weekAvgPct = computed(() => {
  const max = Math.max(...weeks.value.map((week) => week.units), 1);
  return Math.min(96, (weekAvg.value / max) * 100);
});

/** 日均按已经过去的天数算（含今天），和导出的口径保持一致 */
const dayAvg = computed(() => {
  const current = report.value;
  if (!current) return 0;
  return current.consumedUnits / Math.max(current.observedDays, 1);
});

const peakWeek = computed(() => {
  const past = weeks.value
    .map((week, index) => ({ index: index + 1, units: week.units, future: week.future }))
    .filter((week) => !week.future);
  if (!past.length) return null;
  return past.reduce((best, week) => (week.units > best.units ? week : best));
});

/** 只取前三名，做成一张能看出差距的榜单 */
const topItems = computed(() => report.value?.top.slice(0, 3) ?? []);

/** 冠军的使用天数做满格，其余按比例画条，差多少一眼能看出来 */
function barWidth(row: ReportItem): string {
  const best = topItems.value[0]?.useDays ?? 0;
  const ratio = best > 0 ? (row.useDays / best) * 100 : 0;
  return `${Math.max(8, Math.min(100, Math.round(ratio)))}%`;
}

function emojiOf(row: ReportItem): string {
  return itemEmoji(row.item.name, displayCategory(row.item));
}

const comparison = computed(() => {
  const current = report.value;
  if (!current) return '';
  if (!current.previous) return '上月同期没有记录';
  const diff = current.consumedUnits - current.previous.consumedUnits;
  if (diff === 0) return '和上月同期持平';
  return diff > 0 ? `比上月同期多 ${diff} 件` : `比上月同期少 ${-diff} 件`;
});

const adviceIcon: Record<string, string> = {
  act: '⏰',
  buy: '🛒',
  hold: '💤',
};

function openItem(id: string): void {
  uni.navigateTo({ url: `/pages/item-detail/index?id=${id}` });
}

function openAdvice(url: string | undefined): void {
  if (!url) return;
  uni.navigateTo({
    url,
    fail: () => uni.showToast({ title: '这一页还没做好', icon: 'none' }),
  });
}

/* ---------------- 导出：打开模板页，生成图片 ---------------- */

/** 月报/年报都走同一个模板页，只是数据源和版式不同 */
function openPoster(kind: 'month' | 'year'): void {
  const current = report.value;
  if (!current) return;
  const query =
    kind === 'month'
      ? `kind=month&month=${current.month}`
      : `kind=year&year=${current.month.slice(0, 4)}`;
  uni.navigateTo({
    url: `/pages/report-poster/index?${query}`,
    fail: () => uni.showToast({ title: '这一页还没做好', icon: 'none' }),
  });
}

onShow(() => {
  uni.hideTabBar({ animation: false });
  void load();
});
</script>

<template>
  <view class="page">
    <view v-if="loading && !report" class="hint">正在算这个月的账…</view>

    <template v-else-if="report">
      <!-- 月份切换：点中间展开年月面板，切到哪个月就看哪个月 -->
      <view class="month">
        <text class="month__arrow" @click="goPrev">‹</text>
        <view class="month__center" @click="togglePanel">
          <view class="month__title">
            {{ report.label }}
            <text class="month__caret" :class="{ 'month__caret--open': panelOpen }">▾</text>
          </view>
          <view class="month__sub">{{ report.rangeLabel }}</view>
        </view>
        <text
          class="month__arrow"
          :class="{ 'month__arrow--disabled': isCurrentMonth }"
          @click="goNext"
        >
          ›
        </text>
      </view>
      <view v-if="!isCurrentMonth" class="month__today" @click="goToday">
        <text class="month__today-text">回到今天</text>
      </view>

      <!-- 年月选择面板 -->
      <view v-if="panelOpen" class="month-panel__mask" @click="panelOpen = false" />
      <view v-if="panelOpen" class="month-panel">
        <view class="month-panel__head">
          <text
            class="month-panel__arrow"
            :class="{ 'month-panel__arrow--disabled': panelYear <= dataStartYear }"
            @click="shiftPanelYear(-1)"
          >
            ‹
          </text>
          <text class="month-panel__year">{{ panelYear }} 年</text>
          <text
            class="month-panel__arrow"
            :class="{ 'month-panel__arrow--disabled': panelYear >= TODAY_YEAR }"
            @click="shiftPanelYear(1)"
          >
            ›
          </text>
        </view>
        <view class="month-panel__grid">
          <view
            v-for="m in 12"
            :key="m"
            class="month-panel__cell"
            :class="monthCellState(m)"
            @click="pickMonth(m)"
          >
            {{ m }} 月
          </view>
        </view>
      </view>

      <!-- 日历：有消耗的日子直接摆出当天用掉的物品 -->
      <view class="section-title sec">
        <view class="sec__lead">
          <view class="sec__tick" />
          <text class="sec__title">日历</text>
        </view>
      </view>
      <view class="calendar-pad">
        <view class="card calendar">
          <view class="calendar__perf" />
          <view class="calendar__head">
            <text v-for="weekday in WEEKDAYS" :key="weekday" class="calendar__weekday">
              {{ weekday }}
            </text>
          </view>
          <view class="calendar__grid">
            <view
              v-for="blank in report.firstWeekday"
              :key="'blank-' + blank"
              class="calendar__cell calendar__cell--blank"
            />
            <view
              v-for="cell in report.daily"
              :key="cell.day"
              class="calendar__cell"
              :class="[
                'heat--' + heatLevel(cell),
                {
                  'calendar__cell--today': cell.today,
                  'calendar__cell--future': cell.future,
                },
              ]"
            >
              <text class="calendar__day">{{ cell.day }}</text>
              <!-- 这天开封过东西：右下角一个小标记，和「用掉」分开显示 -->
              <view
                v-if="cell.opens.length"
                class="calendar__opens"
                @click.stop="openOpens(cell.day)"
              >
                <text class="calendar__open-icon">开</text>
                <text v-if="cell.opens.length > 1" class="calendar__open-count">
                  {{ cell.opens.length }}
                </text>
              </view>
              <!-- 日期下面摆当天用掉和存进来的物品图标，同一尺寸；点一下看当天明细 -->
              <view
                v-if="cell.rows.length || cell.adds.length"
                class="calendar__items"
                @click.stop="openDay(cell.day)"
              >
                <text
                  v-for="(row, index) in dayIcons(cell)"
                  :key="row.kind + '-' + row.itemId + '-' + index"
                  :class="['calendar__item', row.kind === 'add' ? 'calendar__item--add' : '']"
                >{{ dayEmoji(row) }}</text>
                <text v-if="dayIconsHidden(cell)" class="calendar__more">+{{ dayIconsHidden(cell) }}</text>
              </view>
              <view
                v-else-if="heatLevel(cell) === 'zero' && !cell.opens.length"
                class="calendar__dot"
              />
            </view>
          </view>

          <view class="calendar__legend">
            <view class="calendar__legend-group">
              <view class="calendar__legend-cell calendar__legend-cell--dot">
                <view class="calendar__legend-dot" />
              </view>
              <text class="calendar__legend-label">无记录</text>
            </view>
            <view class="calendar__legend-group">
              <text class="calendar__legend-open">开</text>
              <text class="calendar__legend-label">开封</text>
            </view>
            <view class="calendar__legend-group">
              <view class="calendar__legend-chip" />
              <text class="calendar__legend-label">存入</text>
            </view>
            <view class="calendar__legend-group">
              <text class="calendar__legend-label">少</text>
              <view class="calendar__legend-cell heat--low" />
              <view class="calendar__legend-cell heat--mid" />
              <view class="calendar__legend-cell heat--high" />
              <text class="calendar__legend-label">多</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 点日历里的物品图标：列出这天用掉和存进来的东西 -->
      <view v-if="activeDay" class="day-sheet__mask" @click="closeDay" />
      <view v-if="activeDay" class="day-sheet usage-sheet">
        <view class="day-sheet__head">
          <view class="day-sheet__title">
            <view class="day-sheet__date">这天</view>
            <view class="day-sheet__sum">{{ dayDateLabel }}</view>
          </view>
          <text class="day-sheet__close" @click="closeDay">✕</text>
        </view>
        <view class="sheet-list">
          <view v-if="activeDay.rows.length" class="sheet-group">用掉</view>
          <view
            v-for="row in activeDay.rows"
            :key="row.itemId"
            class="sheet-row"
            @click="openDayItem(row.itemId)"
          >
            <image
              v-if="sheetPhoto(row)"
              class="usage__photo"
              :src="sheetPhoto(row)"
              mode="aspectFill"
              @error="markSheetPhotoBroken(row.itemId)"
            />
            <text v-else class="usage__icon">{{ dayEmoji(row) }}</text>
            <view class="sheet-row__main">
              <view class="sheet-row__name">{{ row.name }}</view>
              <view class="sheet-row__meta">{{ row.category }} · {{ row.units }} {{ row.unit }}</view>
            </view>
            <text class="sheet-row__arrow">›</text>
          </view>

          <view v-if="activeDay.adds.length" class="sheet-group">存入</view>
          <view
            v-for="row in activeDay.adds"
            :key="row.itemId"
            class="sheet-row"
            @click="openDayItem(row.itemId)"
          >
            <image
              v-if="sheetPhoto(row)"
              class="usage__photo"
              :src="sheetPhoto(row)"
              mode="aspectFill"
              @error="markSheetPhotoBroken(row.itemId)"
            />
            <text v-else class="usage__icon">{{ dayEmoji(row) }}</text>
            <view class="sheet-row__main">
              <view class="sheet-row__name">{{ row.name }}</view>
              <view class="sheet-row__meta">
                {{ row.category }} · +{{ row.units }} {{ row.unit }} ·
                {{ row.newItem ? '新入库' : '补货' }}
              </view>
            </view>
            <text class="sheet-row__arrow">›</text>
          </view>
        </view>
        <view class="usage__btn" @click="closeDay">知道了</view>
      </view>

      <!-- 点日历里的「开」：列出这天开封的所有东西 -->
      <view v-if="activeOpens" class="day-sheet__mask" @click="closeOpens" />
      <view v-if="activeOpens" class="day-sheet opens-sheet">
        <view class="day-sheet__head">
          <view class="day-sheet__title">
            <view class="day-sheet__date">这天开封</view>
            <view class="day-sheet__sum">{{ openedDateLabel }}</view>
          </view>
          <text class="day-sheet__close" @click="closeOpens">✕</text>
        </view>
        <view class="sheet-list">
          <view
            v-for="row in activeOpens.rows"
            :key="row.itemId"
            class="sheet-row"
            @click="openFromSheet(row.itemId)"
          >
            <image
              v-if="sheetPhoto(row)"
              class="usage__photo"
              :src="sheetPhoto(row)"
              mode="aspectFill"
              @error="markSheetPhotoBroken(row.itemId)"
            />
            <text v-else class="usage__icon">{{ dayEmoji(row) }}</text>
            <view class="sheet-row__main">
              <view class="sheet-row__name">
                {{ row.name }}<text v-if="row.batchCount > 1"> ×{{ row.batchCount }}</text>
              </view>
              <view class="sheet-row__meta">{{ row.category }} · {{ openShelfText(row) }}</view>
            </view>
            <text class="sheet-row__arrow">›</text>
          </view>
        </view>
        <view class="usage__btn" @click="closeOpens">知道了</view>
      </view>

      <!-- 月度小结：四张独立卡片，一块内容一张卡 -->
      <view class="journal">
        <!-- 01 消耗节奏 -->
                <view id="hover-pace" class="hover-card" :class="{ 'hover-card--on': hoverActive('pace') }" :style="hoverStyle('pace')">
          <view class="jsec jsec--pace">
          <view class="jsec__head">
            <text class="jsec__no">01</text>
            <text class="jsec__title">消耗节奏</text>
            <text class="jsec__note">{{ comparison }}</text>
          </view>
          <template v-if="report.consumedUnits > 0">
            <view class="weeks__summary">
              <text class="weeks__summary-label">这个月用掉</text>
              <text class="weeks__summary-num">{{ report.consumedUnits }}</text>
              <text class="weeks__summary-unit">件</text>
              <text class="weeks__summary-text">日均 {{ dayAvg.toFixed(1) }} 件</text>
            </view>
            <view class="weeks__plot">
              <view class="weeks__bars">
                <view v-if="weekAvg > 0" class="weeks__avg" :style="{ bottom: weekAvgPct + '%' }">
                  <text class="weeks__avg-label">周均 {{ weekAvg.toFixed(1) }}</text>
                </view>
                <view v-for="(week, index) in weeks" :key="week.label" class="weeks__col">
                  <view
                    class="weeks__bar"
                    :class="{
                      'weeks__bar--current': week.current,
                      'weeks__bar--future': week.future,
                      'weeks__bar--ready': chartReady,
                    }"
                    :style="{
                      height: (week.future ? 2 : week.height) + '%',
                      transitionDelay: chartReady ? index * 60 + 'ms' : '0ms',
                    }"
                  >
                    <text v-if="!week.future && week.units > 0" class="weeks__value">
                      {{ week.units }}
                    </text>
                  </view>
                </view>
              </view>
              <view class="weeks__labels">
                <text
                  v-for="week in weeks"
                  :key="week.label"
                  class="weeks__label"
                  :class="{ 'weeks__label--current': week.current }"
                >
                  {{ week.label }}
                </text>
              </view>
            </view>
            <view class="weeks__foot">
              <text>有记录 {{ report.activeDays }} 天</text>
              <text v-if="peakWeek">峰值 第 {{ peakWeek.index }} 周 · {{ peakWeek.units }} 件</text>
            </view>
          </template>
          <view v-else class="jsec__empty">这个月还没有消耗记录，记几笔就能看到节奏。</view>
        </view>
        </view>

        <!-- 02 品类分布 -->
                <view id="hover-cats" v-if="categorySlices.length" class="hover-card" :class="{ 'hover-card--on': hoverActive('cats') }" :style="hoverStyle('cats')">
          <view class="jsec jsec--cats">
          <view class="jsec__head">
            <text class="jsec__no">02</text>
            <text class="jsec__title">品类分布</text>
            <text class="jsec__note">按记录天数</text>
          </view>
          <view class="cats__body">
            <view class="cats__donut-wrap">
              <view class="cats__donut" :style="{ background: donutGradient }">
                <view class="cats__hole">
                  <text class="cats__total">{{ donutCount }}</text>
                  <text class="cats__total-label">记录天数</text>
                </view>
              </view>
            </view>
            <view class="cats__legend">
              <view v-for="segment in categorySlices" :key="segment.name" class="cats__item">
                <view class="cats__dot" :style="{ background: segment.color }" />
                <text class="cats__name">{{ segment.name }}</text>
                <text class="cats__share">{{ segment.share }}%</text>
              </view>
            </view>
          </view>
          <view class="cats__foot">
            <text class="cats__foot-label">本月主力</text>
            <text class="cats__foot-text">
              {{ topCategory.name }} · 占 {{ topCategory.share }}% 的记录天数
            </text>
          </view>
        </view>
        </view>

        <!-- 03 最常用；60 天没动的补充也放在这一节末尾 -->
                <view id="hover-tops" class="hover-card" :class="{ 'hover-card--on': hoverActive('tops') }" :style="hoverStyle('tops')">
          <view class="jsec jsec--tops">
          <view class="jsec__head">
            <text class="jsec__no">03</text>
            <text class="jsec__title">最常用</text>
            <text class="jsec__note">按使用天数</text>
          </view>
          <view v-if="topItems.length" class="board">
            <view
              v-if="topItems[0]"
              class="board__hero"
              @click="openItem(topItems[0].item.id)"
            >
              <view class="board__hero-top">
                <text class="board__rank board__rank--1">1</text>
                <view class="board__hero-avatar">
                  <text class="board__hero-icon">{{ emojiOf(topItems[0]) }}</text>
                </view>
                <view class="board__hero-main">
                  <view class="board__hero-label">本月用得最多</view>
                  <view class="board__hero-name">{{ topItems[0].item.name }}</view>
                  <view class="board__hero-meta">
                    用掉 {{ topItems[0].consumed }} {{ topItems[0].item.unit }}
                  </view>
                </view>
                <view class="board__hero-side">
                  <view class="board__hero-days">
                    <text class="board__days-num">{{ topItems[0].useDays }}</text>
                    <text class="board__days-unit">天</text>
                  </view>
                </view>
              </view>
              <view class="board__bar board__bar--hero">
                <view class="board__bar-fill board__bar-fill--1" :style="{ width: '100%' }"></view>
              </view>
            </view>

            <view class="board__rest">
              <view
                v-for="(row, index) in topItems.slice(1)"
                :key="row.item.id"
                class="board__row"
                :class="'board__row--' + (index + 2)"
                @click="openItem(row.item.id)"
              >
                <view class="board__row-top">
                  <text class="board__rank">{{ index + 2 }}</text>
                  <view class="board__avatar">
                    <text class="board__icon">{{ emojiOf(row) }}</text>
                  </view>
                  <view class="board__row-main">
                    <view class="board__row-name">{{ row.item.name }}</view>
                    <view class="board__row-meta">
                      用掉 {{ row.consumed }} {{ row.item.unit }}
                    </view>
                  </view>
                  <view class="board__row-days">
                    <text class="board__days-num board__days-num--row">{{ row.useDays }}</text>
                    <text class="board__days-unit">天</text>
                  </view>
                </view>
                <view class="board__bar">
                  <view
                    class="board__bar-fill"
                    :class="'board__bar-fill--' + (index + 2)"
                    :style="{ width: barWidth(row) }"
                  ></view>
                </view>
              </view>
            </view>
          </view>
          <view v-else class="jsec__empty">
            这个月还没有消耗记录，点一下「用掉一个」就会出现在这里。
          </view>

          <view v-if="report.idle.length" class="idle">
            <view class="idle__head">
              <text class="idle__label">60 天没动</text>
              <text class="idle__hint">这几样先别急着买同款</text>
            </view>
            <view
              v-for="row in report.idle"
              :key="row.item.id"
              class="idle__row"
              @click="openItem(row.item.id)"
            >
              <text class="idle__icon">💤</text>
              <view class="idle__main">
                <view class="idle__name">{{ row.item.name }}</view>
                <view class="idle__sub">
                  {{
                    row.lastUseDaysAgo === null
                      ? '入库后一直没用过'
                      : `上次用是 ${row.lastUseDaysAgo} 天前`
                  }}
                </view>
              </view>
              <text class="idle__stock">{{ row.item.quantity }} {{ row.item.unit }}</text>
            </view>
          </view>
        </view>
        </view>

        <!-- 04 小囤说：只留结论和依据标签 -->
                <view id="hover-advice" v-if="report.advices.length" class="hover-card" :class="{ 'hover-card--on': hoverActive('advice') }" :style="hoverStyle('advice')">
          <view class="jsec jsec--advice">
          <view class="jsec__head">
            <text class="jsec__no">04</text>
            <text class="jsec__title">小囤说</text>
            <text class="jsec__note">{{ report.advices.length }} 条建议</text>
          </view>
          <view class="advices">
            <view
              v-for="advice in report.advices"
              :key="advice.id"
              class="advice"
              :class="'advice--' + advice.kind"
            >
              <view class="advice__icon">{{ adviceIcon[advice.kind] }}</view>
              <view class="advice__main">
                <view class="advice__title">{{ advice.title }}</view>
                <view class="advice__chips">
                  <text v-for="chip in advice.basis" :key="chip" class="advice__chip">{{ chip }}</text>
                </view>
              </view>
              <view
                v-if="advice.action"
                class="advice__btn"
                @click="openAdvice(advice.action.url)"
              >
                {{ advice.action.label }}
                <text class="advice__arrow">›</text>
              </view>
            </view>
          </view>
        </view>
        </view>

      </view>

      <!-- 导出：月报和年报都生成图片，进去选模板 -->
      <view class="section-title sec">
        <view class="sec__lead">
          <view class="sec__tick" />
          <text class="sec__title">导出报告</text>
        </view>
        <text class="muted sec__note">选模板存图片</text>
      </view>
              <view id="hover-export" class="hover-card" :class="{ 'hover-card--on': hoverActive('export') }" :style="hoverStyle('export')">
          <view class="export">
        <view
          class="export__btn export__btn--month"
          hover-class="export__btn--tap"
          @click="openPoster('month')"
        >
          <view class="export__body">
            <view class="export__eyebrow">
              <view class="export__dot"></view>
              本期月报
            </view>
            <view class="export__title">生成月报图片</view>
            <view class="export__sub">手账 / 冰箱贴 / 拍立得</view>
            <view class="export__cta">
              去挑一套
              <text class="export__cta-arrow">›</text>
            </view>
          </view>

          <!-- 三套模板的小样：手账 / 冰箱贴 / 拍立得 -->
          <view class="export__fan">
            <view class="export__card export__card--a">
              <view class="export__card-tape"></view>
              <view class="export__card-line"></view>
              <view class="export__card-line export__card-line--short"></view>
              <view class="export__card-line"></view>
            </view>
            <view class="export__card export__card--b">
              <view class="export__card-magnet"></view>
              <view class="export__card-note">
                <view class="export__card-line"></view>
                <view class="export__card-line export__card-line--short"></view>
              </view>
            </view>
            <view class="export__card export__card--c">
              <view class="export__card-photo"></view>
              <view class="export__card-line export__card-line--small"></view>
            </view>
          </view>
        </view>

        <view
          class="export__btn export__btn--year"
          hover-class="export__btn--tap"
          @click="openPoster('year')"
        >
          <view class="export__stamp">年</view>
          <view class="export__body export__body--row">
            <view class="export__title export__title--sm">年度报告图片</view>
            <view class="export__sub">总览 / 逐月 / 最常用</view>
          </view>
          <view class="export__bars">
            <view class="export__bar export__bar--1"></view>
            <view class="export__bar export__bar--2"></view>
            <view class="export__bar export__bar--3"></view>
          </view>
          <text class="export__chevron">›</text>
        </view>
      </view>
        </view>
    </template>

    <view v-else class="empty">
      <view class="empty__title">这个月还没有可统计的数据</view>
      <view class="empty__desc">先在库存里记几件东西，用几天再回来看</view>
    </view>

    <TabBar current="report" />
    <FeatureTour current="report" />
  </view>
</template>

<style scoped>
/* 手账式小标题：一小截斜贴的纸胶带 + 标题，右侧留小字注释 */
.sec {
  align-items: center;
  margin: 40rpx 4rpx 16rpx;
}

.sec__lead {
  display: flex;
  align-items: center;
  min-width: 0;
}

.sec__tick {
  width: 10rpx;
  height: 30rpx;
  margin-right: 14rpx;
  border-radius: 5rpx;
  background: linear-gradient(180deg, #e8b95a, #c98d1d);
  transform: rotate(-6deg);
  box-shadow: 2rpx 2rpx 0 rgba(154, 101, 20, 0.12);
}

.sec__title {
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: #3a2b16;
}

/* 滑到焦点线的卡片：只动 transform，不改变布局 */
.hover-card {
  position: relative;
  z-index: 1;
  transform-origin: center center;
  will-change: transform;
  transition: transform 0.18s cubic-bezier(0.22, 0.8, 0.36, 1);
}

/* 放大中的卡片压在相邻卡片上面，再给一层暖色投影和描边，让放大更看得出来 */
.hover-card--on {
  z-index: 2;
}

.hover-card--on .jsec {
  border-color: #e6cf9f;
  box-shadow: 0 14rpx 34rpx rgba(96, 72, 30, 0.16);
}

.hover-card--on .export__btn {
  box-shadow: 0 14rpx 34rpx rgba(96, 72, 30, 0.16);
}

@media (prefers-reduced-motion: reduce) {
  .hover-card {
    transition: none;
    transform: none !important;
  }

  .hover-card--on .jsec,
  .hover-card--on .export__btn {
    box-shadow: none;
  }
}

.sec__note {
  margin-left: 16rpx;
  font-size: 21rpx;
  color: #a58a5f;
  text-align: right;
}

/* 月度小结：四张独立卡片，白底细边，和日历/导出保持同一套卡片语言 */
.journal {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 10rpx;
}

.jsec {
  position: relative;
  z-index: 0;
  overflow: hidden;
  /* 上下多留一点，让悬停时跑出来的物品标签条有自己的位置 */
  padding: 26rpx 26rpx 20rpx;
  background-color: #fffdf9;
  border: 1rpx solid #f3e8d4;
  border-radius: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}

/* 背景只做柔光和水印，压在后层，不挡正文 */
.jsec::before,
.jsec::after {
  content: '';
  position: absolute;
  z-index: -1;
  pointer-events: none;
}

/* 01 消耗节奏：晨光金，右下暖、左上淡 */
.jsec--pace {
  background:
    linear-gradient(90deg, rgba(217, 163, 52, 0.45), rgba(217, 163, 52, 0) 64%) top left / 100%
      4rpx no-repeat,
    linear-gradient(138deg, #fff6df 0%, #fffdf9 48%, #fffaf0 100%);
}

.jsec--pace::before {
  top: -70rpx;
  right: -60rpx;
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 185, 90, 0.2), transparent 68%);
}

.jsec--pace::after {
  left: -60rpx;
  bottom: -80rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(201, 143, 90, 0.1), transparent 70%);
}

/* 02 品类分布：纸色打底，右上一点草绿柔光 */
.jsec--cats {
  background:
    linear-gradient(
        90deg,
        rgba(217, 163, 52, 0.45),
        rgba(169, 179, 139, 0.35) 50%,
        rgba(169, 179, 139, 0) 78%
      )
      top left / 100% 4rpx no-repeat,
    linear-gradient(140deg, #fff8e8 0%, #fbfcf6 53%, #fffdf9 100%);
}

.jsec--cats::before {
  top: -70rpx;
  right: -60rpx;
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(169, 179, 139, 0.2), transparent 68%);
}

.jsec--cats::after {
  left: -50rpx;
  bottom: -70rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(217, 163, 52, 0.13), transparent 70%);
}

/* 03 最常用：淡草绿，右下角三条淡淡的排行线 */
.jsec--tops {
  background:
    linear-gradient(90deg, rgba(201, 143, 90, 0.4), rgba(169, 179, 139, 0) 68%) top left / 100%
      4rpx no-repeat,
    linear-gradient(135deg, #f7fbf2 0%, #fffdf9 50%, #fdf7eb 100%);
}

.jsec--tops::before {
  top: -70rpx;
  left: -60rpx;
  width: 280rpx;
  height: 280rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(169, 179, 139, 0.18), transparent 68%);
}

/* 04 小囤说：淡玫瑰，右上一个大引号水印 */
.jsec--advice {
  background:
    linear-gradient(
        90deg,
        rgba(194, 90, 80, 0.35),
        rgba(217, 163, 52, 0.28) 50%,
        rgba(217, 163, 52, 0) 80%
      )
      top left / 100% 4rpx no-repeat,
    linear-gradient(140deg, #fdf6ef 0%, #fffdf9 55%, #fafaf1 100%);
}

.jsec--advice::before {
  top: -24rpx;
  right: 26rpx;
  content: '“';
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 170rpx;
  line-height: 1;
  color: rgba(201, 143, 90, 0.14);
}

.jsec--advice::after {
  left: -50rpx;
  bottom: -70rpx;
  width: 240rpx;
  height: 240rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(194, 90, 80, 0.1), transparent 70%);
}

.jsec__head {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
  padding-bottom: 16rpx;
  border-bottom: 1rpx solid #f3e9d7;
}

.jsec__no {
  flex: none;
  width: 42rpx;
  height: 30rpx;
  margin-right: 14rpx;
  border-radius: 8rpx;
  background: #fbf0d9;
  font-size: 18rpx;
  font-weight: 600;
  line-height: 30rpx;
  text-align: center;
  color: #b07a24;
}

.jsec__title {
  font-size: 30rpx;
  font-weight: 700;
  letter-spacing: 0.5rpx;
  color: #3a2b16;
}

.jsec__note {
  margin-left: auto;
  padding-left: 16rpx;
  font-size: 20rpx;
  color: #a58a5f;
  text-align: right;
}

.jsec__empty {
  padding: 6rpx 0 22rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: #a58a5f;
}

/* 月份切换 */
.month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 8rpx 24rpx;
}

.month__center {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.month__title {
  font-size: 38rpx;
  font-weight: 600;
  color: #3a2b16;
}

.month__caret {
  display: inline-block;
  margin-left: 8rpx;
  font-size: 22rpx;
  color: #b8a582;
  transition: transform 0.2s ease;
}

.month__caret--open {
  transform: rotate(180deg);
}

.month__today {
  position: relative;
  z-index: 3;
  margin: -14rpx 0 18rpx;
  text-align: center;
}

.month__today-text {
  display: inline-block;
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: #9a6514;
  background: rgba(154, 101, 20, 0.1);
}

/* 年月选择面板 */
.month-panel__mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: rgba(58, 43, 22, 0.06);
}

.month-panel {
  position: relative;
  z-index: 2;
  margin: -6rpx 6rpx 18rpx;
  padding: 18rpx 22rpx 22rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 18rpx 50rpx rgba(122, 86, 20, 0.14);
  animation: panel-in 0.18s ease-out;
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-10rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.month-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2rpx 4rpx 14rpx;
}

.month-panel__year {
  font-size: 30rpx;
  font-weight: 600;
  color: #3a2b16;
}

.month-panel__arrow {
  width: 64rpx;
  height: 64rpx;
  line-height: 60rpx;
  text-align: center;
  font-size: 38rpx;
  color: #9a6514;
  border-radius: 50%;
  background: rgba(154, 101, 20, 0.08);
}

.month-panel__arrow--disabled {
  color: #d8c9aa;
  background: transparent;
}

.month-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10rpx;
}

.month-panel__cell {
  height: 72rpx;
  line-height: 72rpx;
  text-align: center;
  font-size: 24rpx;
  color: #826b47;
  background: #faf4e6;
  border-radius: 14rpx;
  transition: background 0.15s ease, color 0.15s ease;
}

.month-panel__cell--current:not(.month-panel__cell--selected) {
  box-shadow: inset 0 0 0 3rpx #9a6514;
}

.month-panel__cell--selected {
  background: #d9a334;
  color: #ffffff;
  font-weight: 600;
}

.month-panel__cell--future {
  color: #d8c9aa;
  background: transparent;
  pointer-events: none;
}

.month__sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #9a8055;
}

.month__arrow {
  width: 72rpx;
  height: 72rpx;
  line-height: 68rpx;
  text-align: center;
  font-size: 44rpx;
  color: #9a6514;
  border-radius: 50%;
  background: rgba(154, 101, 20, 0.08);
}

.month__arrow--disabled {
  color: #d8c9aa;
  background: transparent;
}

/* 撕页日历：底下垫着两张用过的旧页，顶边是一排撕口 */
.calendar-pad {
  position: relative;
  padding: 4rpx 6rpx 8rpx;
}

.calendar-pad::before,
.calendar-pad::after {
  content: '';
  position: absolute;
  left: 16rpx;
  right: 16rpx;
  top: 12rpx;
  bottom: 4rpx;
  border-radius: 22rpx;
  box-shadow: 0 2rpx 8rpx rgba(96, 72, 30, 0.07);
}

.calendar-pad::before {
  top: 16rpx;
  bottom: -8rpx;
  background: #f2e4c9;
  transform: rotate(-1.6deg);
}

.calendar-pad::after {
  top: 10rpx;
  bottom: -3rpx;
  background: #f8eed9;
  transform: rotate(1.1deg);
}

.calendar {
  position: relative;
  z-index: 2;
  padding: 28rpx 20rpx 18rpx;
  background-color: #fffdf8;
  background-image: linear-gradient(180deg, #fffefa, #fff8ec);
  border-radius: 22rpx;
  overflow: hidden;
  box-shadow: 0 6rpx 20rpx rgba(96, 72, 30, 0.1),
    inset 0 0 0 1rpx rgba(154, 101, 20, 0.05);
}

/* 顶边撕口：一排半圆缺口，露出底下那页的纸色 */
.calendar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -1rpx;
  height: 14rpx;
  background: radial-gradient(circle 7rpx at 50% 0, #f2e4c9 0 6.6rpx, transparent 7rpx) 0 0 /
    30rpx 14rpx repeat-x;
  pointer-events: none;
}

/* 虚线撕痕 */
.calendar__perf {
  margin: 0 6rpx 14rpx;
  border-top: 2rpx dashed rgba(154, 101, 20, 0.26);
}

.calendar__head {
  display: flex;
  margin-bottom: 8rpx;
}

.calendar__weekday {
  flex: 1;
  text-align: center;
  font-size: 20rpx;
  color: #b8a582;
}

/* 老日历的规矩：周日那一列是红的 */
.calendar__weekday:last-child {
  color: #b4533a;
}

.calendar__grid
  > .calendar__cell:nth-child(7n):not(.heat--low):not(.heat--mid):not(.heat--high):not(
    .heat--future
  )
  .calendar__day {
  color: #b4533a;
}

.calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8rpx;
}

.calendar__cell {
  height: 88rpx;
  border-radius: 14rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 8rpx;
  position: relative;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.calendar__cell--blank {
  background: transparent;
}

.calendar__cell--future {
  pointer-events: none;
}

.calendar__day {
  font-size: 22rpx;
  line-height: 1;
  color: rgba(58, 43, 22, 0.62);
}

.calendar__cell--today {
  box-shadow: inset 0 0 0 3rpx rgba(154, 101, 20, 0.45);
}

/* 日期下面当天用掉的东西，直接摆图标；太多了只摆前两个 */
.calendar__items {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  margin-top: 6rpx;
}

.calendar__item {
  flex-shrink: 0;
  font-size: 20rpx;
  line-height: 1;
  padding: 3rpx 0;
}

/* 存入的图标带一层淡绿底，和当天的消耗区分开 */
.calendar__item--add {
  padding: 1rpx 2rpx;
  border-radius: 4rpx;
  background: rgba(95, 112, 71, 0.18);
}

.calendar__more {
  margin-left: 1rpx;
  font-size: 15rpx;
  line-height: 1;
  color: rgba(58, 43, 22, 0.5);
}

/* 开封标记：放在日期格右下角，和当天的消耗图标分开 */
.calendar__opens {
  position: absolute;
  right: 4rpx;
  bottom: 4rpx;
  display: flex;
  align-items: center;
  padding: 2rpx 4rpx;
  border-radius: 7rpx;
  background: #eef3e6;
}

.calendar__open-icon {
  font-size: 15rpx;
  line-height: 1;
  color: #5f7047;
}

.calendar__open-count {
  margin-left: 2rpx;
  font-size: 14rpx;
  line-height: 1;
  color: #5f7047;
}

/* 无记录：不铺底色，只在日期下方点一个小点 */
.calendar__dot {
  position: absolute;
  left: 50%;
  bottom: 9rpx;
  width: 6rpx;
  height: 6rpx;
  margin-left: -3rpx;
  border-radius: 50%;
  background: #dccbab;
}

.heat--zero {
  background: transparent;
}

.heat--low {
  background: #f7dfa8;
}

.heat--mid {
  background: #ecc264;
}

.heat--high {
  background: #d9a334;
}

.heat--high .calendar__day {
  color: #ffffff;
}

.heat--future {
  background: transparent;
}

.heat--future .calendar__day {
  color: #d8c9aa;
}

.calendar__legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14rpx;
  padding: 0 2rpx;
}

.calendar__legend-group {
  display: flex;
  align-items: center;
}

.calendar__legend-label {
  margin: 0 8rpx;
  font-size: 20rpx;
  color: #b8a582;
}

.calendar__legend-open {
  padding: 2rpx 5rpx;
  border-radius: 6rpx;
  background: #eef3e6;
  font-size: 16rpx;
  line-height: 1;
  color: #5f7047;
}

.calendar__legend-chip {
  width: 18rpx;
  height: 18rpx;
  border-radius: 4rpx;
  background: rgba(95, 112, 71, 0.18);
}

.calendar__legend-cell {
  width: 22rpx;
  height: 22rpx;
  margin: 0 3rpx;
  border-radius: 6rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.calendar__legend-cell--dot {
  background: transparent;
}

.calendar__legend-dot {
  width: 6rpx;
  height: 6rpx;
  border-radius: 50%;
  background: #dccbab;
}

/* 当天消耗弹窗 */
.day-sheet__mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  background: rgba(58, 43, 22, 0.32);
  animation: sheet-fade 0.16s ease-out;
}

.day-sheet {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 21;
  width: 82%;
  max-width: 420px;
  max-height: 72vh;
  box-sizing: border-box;
  padding: 26rpx 30rpx 24rpx;
  background: #ffffff;
  border-radius: 28rpx;
  box-shadow: 0 24rpx 70rpx rgba(58, 43, 22, 0.22);
  transform: translate(-50%, -50%);
  animation: modal-pop 0.18s ease-out;
}

.day-sheet__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.day-sheet__date {
  font-size: 30rpx;
  font-weight: 600;
  color: #3a2b16;
}

.day-sheet__sum {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #9a6514;
}

.day-sheet__close {
  padding: 4rpx 0 4rpx 24rpx;
  font-size: 30rpx;
  line-height: 1;
  color: #b8a582;
}

.usage__icon {
  width: 76rpx;
  height: 76rpx;
  border-radius: 18rpx;
  background: #fdf6e6;
  font-size: 40rpx;
  line-height: 76rpx;
  text-align: center;
  flex-shrink: 0;
}

/* 弹层里优先展示实物照片，尺寸和 emoji 兜底一致 */
.usage__photo {
  width: 76rpx;
  height: 76rpx;
  border-radius: 18rpx;
  background: #fdf6e6;
  flex-shrink: 0;
  overflow: hidden;
}

.usage__btn {
  margin-top: 18rpx;
  padding: 18rpx 0;
  border-radius: 16rpx;
  background: #fdf1d6;
  color: #9a6514;
  font-size: 25rpx;
  text-align: center;
}

/* 日历弹窗：一天可能用掉/开封好几样，用列表展示 */
.sheet-list {
  margin-top: 14rpx;
  max-height: 52vh;
  overflow-y: auto;
}

/* 「用掉」「存入」分组标题 */
.sheet-group {
  margin: 18rpx 0 2rpx;
  font-size: 21rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #a08a5f;
}

.sheet-row {
  display: flex;
  align-items: center;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f3ead8;
}

.sheet-row:last-child {
  border-bottom: none;
}

.sheet-row .usage__icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: 16rpx;
  font-size: 34rpx;
  line-height: 64rpx;
}

.sheet-row__main {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}

.sheet-row__name {
  font-size: 25rpx;
  font-weight: 600;
  color: #3a2b16;
}

.sheet-row__meta {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: #9a8055;
}

.sheet-row__arrow {
  padding-left: 12rpx;
  font-size: 30rpx;
  color: #c8b693;
}


@keyframes modal-pop {
  from {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes sheet-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 消耗节奏：干净的数字 + 素色柱状，不加纹理 */
.weeks__summary {
  display: flex;
  align-items: baseline;
  margin-bottom: 12rpx;
}

.weeks__summary-label {
  font-size: 21rpx;
  color: #826b47;
}

.weeks__summary-num {
  margin-left: 10rpx;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 54rpx;
  font-weight: 600;
  line-height: 1;
  color: #9a6514;
}

.weeks__summary-unit {
  margin-left: 5rpx;
  font-size: 21rpx;
  color: #9a6514;
}

.weeks__summary-text {
  margin-left: auto;
  font-size: 20rpx;
  color: #a58a5f;
}

.weeks__plot {
  /* 给柱顶数字留出空间：最高柱到 100% 时，数字要完整落在标题/汇总行下方 */
  padding-top: 40rpx;
}

.weeks__bars {
  position: relative;
  display: flex;
  align-items: flex-end;
  height: 210rpx;
  padding: 0 4rpx;
  border-bottom: 2rpx solid #eaddc6;
}

.weeks__col {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.weeks__bar {
  position: relative;
  width: 46%;
  border-radius: 8rpx 8rpx 2rpx 2rpx;
  background: linear-gradient(180deg, #f2d390, #e2b45c);
  transform: scaleY(0);
  transform-origin: bottom;
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1.1);
}

.weeks__bar--ready {
  transform: scaleY(1);
}

.weeks__bar--current {
  background: linear-gradient(180deg, #d9a334, #c58c20);
}

/* 还没到的周：只在基线上留一小截虚线，不假装有数据 */
.weeks__bar--future {
  width: 0;
  height: 16rpx !important;
  background: transparent;
  box-shadow: none;
  border: none;
  border-left: 2rpx dashed #e2d3b4;
  border-radius: 0;
  transform: scaleY(1);
}

.weeks__value {
  position: absolute;
  bottom: 100%;
  left: 50%;
  margin: 0 0 6rpx -60rpx;
  width: 120rpx;
  text-align: center;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 19rpx;
  font-weight: 600;
  line-height: 1;
  color: #8a6c3f;
}

.weeks__avg {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 2;
  border-top: 2rpx dashed #d6b77c;
}

.weeks__avg-label {
  position: absolute;
  right: 0;
  top: -26rpx;
  padding: 2rpx 8rpx;
  font-size: 16rpx;
  line-height: 1;
  color: #a58a5f;
  background: #fffdf8;
}

.weeks__labels {
  display: flex;
  margin-top: 10rpx;
  padding: 0 4rpx;
}

.weeks__label {
  flex: 1;
  text-align: center;
  font-size: 18rpx;
  color: #b8a582;
}

.weeks__label--current {
  color: #9a6514;
  font-weight: 700;
}

.weeks__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding: 0 4rpx;
  font-size: 19rpx;
  color: #b8a582;
}

/* 品类占比：细圆环 + 单列图例，安静地占住这一节 */
.cats__body {
  display: flex;
  align-items: center;
  padding-top: 2rpx;
}

.cats__donut-wrap {
  position: relative;
  flex: none;
  width: 188rpx;
  height: 188rpx;
}

.cats__donut {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  /* 老 WebView 不支持 conic-gradient 时至少是一圈纸色，不会整块消失 */
  background: #ead6ad;
  animation: donut-in 0.45s ease-out;
}

/* 中间留白挖出圆环；用纸色而不是白色，和页面底一致 */
.cats__hole {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 62%;
  height: 62%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #fffdf8;
}

.cats__total {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 40rpx;
  font-weight: 600;
  line-height: 1;
  color: #3a2b16;
  font-variant-numeric: tabular-nums;
}

.cats__total-label {
  margin-top: 5rpx;
  font-size: 17rpx;
  letter-spacing: 1rpx;
  color: #a58a5f;
}

@keyframes donut-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.cats__legend {
  flex: 1;
  min-width: 0;
  margin-left: 28rpx;
  display: flex;
  flex-direction: column;
}

.cats__item {
  display: flex;
  align-items: center;
  padding: 5rpx 0;
  min-width: 0;
}

.cats__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  margin-right: 10rpx;
  flex-shrink: 0;
}

.cats__name {
  flex: 1;
  font-size: 21rpx;
  color: #3a2b16;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cats__share {
  flex-shrink: 0;
  margin-left: 8rpx;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 20rpx;
  color: #9a6514;
}

.cats__foot {
  display: flex;
  align-items: baseline;
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #f3e9d7;
}

.cats__foot-label {
  flex: none;
  margin-right: 12rpx;
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: #b8a582;
}

.cats__foot-text {
  font-size: 21rpx;
  color: #826b47;
}

/* 最常用：冠军单独一张大卡，亚季军排在下面，像一张小榜单 */
.board {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding-top: 2rpx;
}

.board__hero {
  position: relative;
  z-index: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  overflow: hidden;
  padding: 16rpx 16rpx 14rpx;
  border: 1rpx solid #f0d9a8;
  border-radius: 20rpx;
  background: linear-gradient(110deg, #fff3d6 0%, #fffaf0 58%, #fffdf9 100%);
}

.board__hero-top {
  display: flex;
  align-items: center;
}

.board__hero::before {
  content: '';
  position: absolute;
  z-index: -1;
  right: -30rpx;
  top: -50rpx;
  width: 180rpx;
  height: 180rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 185, 90, 0.18), transparent 68%);
  pointer-events: none;
}

.board__hero-avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 84rpx;
  height: 84rpx;
  margin-left: 12rpx;
  border-radius: 50%;
  background: #fbf0d9;
  box-shadow:
    0 0 0 3rpx #d9a334,
    0 6rpx 14rpx rgba(154, 101, 20, 0.16);
}

.board__hero-icon {
  font-size: 42rpx;
  line-height: 1;
}

.board__hero-main {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}

.board__hero-label {
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: #b07a24;
}

.board__hero-name {
  margin-top: 4rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #5e3c10;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board__hero-meta {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #9a7a4a;
}

.board__hero-side {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-left: 12rpx;
}

.board__hero-days,
.board__row-days {
  display: flex;
  align-items: baseline;
}

.board__days-num {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;
  color: #b07a24;
}

.board__days-num--row {
  font-size: 28rpx;
  color: #7a5a2a;
}

.board__days-unit {
  margin-left: 3rpx;
  font-size: 18rpx;
  line-height: 1;
  color: #a58a5f;
}

.board__bar {
  height: 8rpx;
  margin-top: 8rpx;
  border-radius: 999rpx;
  background: rgba(176, 122, 36, 0.1);
  overflow: hidden;
}

.board__bar--hero {
  margin-top: 12rpx;
}

.board__bar-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #e8c47a, #d9a334);
  transition: width 0.45s ease;
}

.board__bar-fill--2 {
  background: linear-gradient(90deg, #d8d2c6, #b8b2a6);
}

.board__bar-fill--3 {
  background: linear-gradient(90deg, #d8a77e, #c98f5a);
}

.board__rest {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.board__row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 12rpx 16rpx;
  border-radius: 16rpx;
  background: rgba(255, 253, 249, 0.56);
}

.board__row-top {
  display: flex;
  align-items: center;
}

.board__rank {
  flex: none;
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 34rpx;
  text-align: center;
  color: #fffaf0;
}

.board__row--2 .board__rank {
  background: linear-gradient(135deg, #d8d2c6, #b8b2a6);
}

.board__row--3 .board__rank {
  background: linear-gradient(135deg, #d8a77e, #c98f5a);
}

.board__rank--1 {
  width: 38rpx;
  height: 38rpx;
  font-size: 20rpx;
  line-height: 38rpx;
  background: linear-gradient(135deg, #e8bf6c, #d9a334);
  box-shadow: 0 3rpx 8rpx rgba(154, 101, 20, 0.22);
}

.board__avatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  margin-left: 12rpx;
  border-radius: 50%;
  background: #f7eeda;
}

.board__icon {
  font-size: 28rpx;
  line-height: 1;
}

.board__row-main {
  flex: 1;
  min-width: 0;
  margin-left: 12rpx;
}

.board__row-name {
  font-size: 24rpx;
  font-weight: 600;
  color: #3a2b16;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board__row-meta {
  margin-top: 3rpx;
  font-size: 19rpx;
  color: #a58a5f;
}

.board__row-days {
  flex: none;
  margin-left: 10rpx;
}

/* 闲置：挂在「最常用」末尾的一小段补充，用一块更轻的底托住 */
.idle {
  margin-top: 18rpx;
  padding: 16rpx 16rpx 4rpx;
  border-radius: 18rpx;
  background: rgba(255, 253, 249, 0.5);
}

.idle__head {
  display: flex;
  align-items: baseline;
  margin-bottom: 4rpx;
}

.idle__label {
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: #826b47;
}

.idle__hint {
  margin-left: auto;
  font-size: 18rpx;
  color: #b8a582;
}

.idle__row {
  display: flex;
  align-items: center;
  padding: 12rpx 0;
}

.idle__row + .idle__row {
  margin-top: 4rpx;
}

.idle__icon {
  width: 44rpx;
  font-size: 26rpx;
  text-align: center;
}

.idle__main {
  flex: 1;
  min-width: 0;
  margin-left: 8rpx;
}

.idle__name {
  font-size: 24rpx;
  color: #3a2b16;
}

.idle__sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #a58a5f;
}

.idle__stock {
  font-size: 21rpx;
  color: #9a6514;
}

/* 小囤说：连续的建议行，用很轻的图标底色区分类型 */
.advices {
  padding-top: 2rpx;
}

.advice {
  display: flex;
  align-items: center;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f3e9d7;
}

.advice:last-child {
  border-bottom: none;
}

.advice__icon {
  width: 44rpx;
  height: 44rpx;
  line-height: 44rpx;
  text-align: center;
  border-radius: 50%;
  background: #f8f1e2;
  font-size: 26rpx;
  flex-shrink: 0;
}

.advice--act .advice__icon {
  background: rgba(194, 90, 80, 0.12);
}

.advice--buy .advice__icon {
  background: rgba(217, 163, 52, 0.14);
}

.advice--hold .advice__icon {
  background: rgba(169, 179, 139, 0.16);
}

.advice__main {
  flex: 1;
  min-width: 0;
  margin-left: 12rpx;
}

.advice__title {
  font-size: 25rpx;
  font-weight: 600;
  line-height: 1.4;
  color: #3a2b16;
}

.advice__chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8rpx;
}

.advice__chip {
  margin: 0 8rpx 4rpx 0;
  padding: 3rpx 12rpx;
  font-size: 18rpx;
  color: #826b47;
  background: #f8f1e2;
  border-radius: 999rpx;
}

.advice__btn {
  flex-shrink: 0;
  margin-left: 14rpx;
  font-size: 21rpx;
  color: #9a6514;
  white-space: nowrap;
}

.advice__arrow {
  margin-left: 2rpx;
  font-size: 24rpx;
}

/* 导出：像从报告里撕下来的一页纸 */
.export {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-top: 4rpx;
  /* 给上下两条物品标签留出位置，别压到卡片里的字 */
  padding: 0;
}

.export__btn {
  position: relative;
  box-sizing: border-box;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.export__btn--month {
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: hidden;
  padding: 30rpx 18rpx 30rpx 32rpx;
  border: 1rpx solid #ecd3a2;
  border-radius: 28rpx;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 42%),
    repeating-linear-gradient(
      180deg,
      rgba(154, 101, 20, 0.07) 0,
      rgba(154, 101, 20, 0.07) 1rpx,
      transparent 1rpx,
      transparent 36rpx
    ),
    linear-gradient(150deg, #fff7e6 0%, #f9e8c8 55%, #f1d7a8 100%);
  box-shadow: 0 10rpx 30rpx rgba(154, 101, 20, 0.13);
}

/* 左上角一小截和纸胶带 */
.export__btn--month::before {
  content: '';
  position: absolute;
  top: -12rpx;
  left: 30rpx;
  width: 96rpx;
  height: 32rpx;
  background: rgba(242, 201, 106, 0.58);
  transform: rotate(-5deg);
}

.export__btn--tap {
  transform: scale(0.985);
  box-shadow: 0 4rpx 14rpx rgba(154, 101, 20, 0.1);
}

.export__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-width: 0;
}

.export__eyebrow {
  display: flex;
  align-items: center;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: #a06a24;
}

.export__dot {
  width: 10rpx;
  height: 10rpx;
  margin-right: 10rpx;
  border-radius: 50%;
  background: #b3641f;
}

.export__title {
  margin-top: 12rpx;
  font-size: 34rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: #3a2b16;
}

.export__title--sm {
  margin-top: 0;
  font-size: 27rpx;
  letter-spacing: 0;
}

.export__sub {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.5;
  color: #8a6c3f;
}

.export__cta {
  display: inline-flex;
  align-items: center;
  margin-top: 20rpx;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #fff8e8;
  font-size: 22rpx;
  box-shadow: 0 6rpx 14rpx rgba(58, 43, 22, 0.18);
}

.export__cta-arrow {
  margin-left: 8rpx;
  font-size: 26rpx;
  line-height: 1;
}

/* 三张小样微微散开，像摊在桌上的模板 */
.export__fan {
  position: relative;
  flex: none;
  width: 200rpx;
  height: 196rpx;
  margin-left: 10rpx;
}

.export__card {
  position: absolute;
  width: 100rpx;
  height: 130rpx;
  padding: 12rpx 10rpx;
  box-sizing: border-box;
  border-radius: 8rpx;
  box-shadow: 0 8rpx 18rpx rgba(120, 88, 40, 0.16);
}

.export__card--a {
  top: 36rpx;
  left: 0;
  transform: rotate(-11deg);
  background: repeating-linear-gradient(
    180deg,
    #fffdf6 0,
    #fffdf6 18rpx,
    #f3e5c8 18rpx,
    #f3e5c8 20rpx
  );
}

.export__card--b {
  top: 20rpx;
  left: 50rpx;
  transform: rotate(1deg);
  background: #f9fcfa;
}

.export__card--c {
  top: 38rpx;
  left: 100rpx;
  transform: rotate(12deg);
  background: #f7f0e4;
}

.export__card-tape {
  width: 40rpx;
  height: 12rpx;
  margin: -2rpx auto 12rpx;
  background: rgba(226, 172, 92, 0.6);
  transform: rotate(-4deg);
}

.export__card-line {
  height: 4rpx;
  margin-top: 9rpx;
  border-radius: 2rpx;
  background: rgba(120, 95, 60, 0.32);
}

.export__card-line--short {
  width: 62%;
}

.export__card-line--small {
  width: 70%;
  margin: 10rpx auto 0;
}

.export__card-magnet {
  width: 16rpx;
  height: 16rpx;
  margin: 0 auto 8rpx;
  border-radius: 50%;
  background: #d96c5f;
  box-shadow: inset 2rpx 2rpx 3rpx rgba(255, 255, 255, 0.5);
}

.export__card-note {
  padding: 8rpx 8rpx 10rpx;
  border-radius: 4rpx;
  background: #fff3b0;
}

.export__card-note .export__card-line {
  background: rgba(120, 95, 60, 0.28);
}

.export__card-note .export__card-line:first-child {
  margin-top: 0;
}

.export__card-photo {
  height: 66rpx;
  border-radius: 3rpx;
  background:
    radial-gradient(60% 50% at 74% 26%, rgba(255, 246, 214, 0.95) 0%, rgba(255, 246, 214, 0) 70%),
    linear-gradient(160deg, #e9cfa4 0%, #d9b784 60%, #c8a06c 100%);
}

/* 年报：一张压了邮戳的小条 */
.export__btn--year {
  display: flex;
  align-items: center;
  padding: 24rpx;
  border: 1rpx solid #efe2c6;
  border-radius: 24rpx;
  background: #fffdf8;
  box-shadow: 0 4rpx 16rpx rgba(96, 72, 30, 0.05);
}

.export__stamp {
  flex: none;
  width: 60rpx;
  height: 60rpx;
  margin-right: 20rpx;
  border: 2rpx dashed #c9a878;
  border-radius: 50%;
  font-size: 24rpx;
  line-height: 56rpx;
  text-align: center;
  color: #9a6514;
  transform: rotate(-8deg);
}

.export__body--row {
  flex: 1;
  min-width: 0;
}

.export__body--row .export__sub {
  margin-top: 4rpx;
}

.export__bars {
  display: flex;
  align-items: flex-end;
  gap: 5rpx;
  height: 34rpx;
  margin: 0 16rpx 0 8rpx;
}

.export__bar {
  width: 8rpx;
  border-radius: 3rpx 3rpx 0 0;
  background: #e0c48d;
}

.export__bar--1 {
  height: 16rpx;
}

.export__bar--2 {
  height: 34rpx;
}

.export__bar--3 {
  height: 24rpx;
}

.export__chevron {
  color: #b8a582;
  font-size: 32rpx;
  line-height: 1;
}
</style>
