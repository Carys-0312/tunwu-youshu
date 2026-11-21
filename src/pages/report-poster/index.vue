<script setup lang="ts">
/**
 * 报告图片：把月报/年报里的关键数字填进固定模板，导出成一张图。
 *
 * 月报版：标题、月份、统计范围、导出时间、下月临期、下月补货、下月建议。
 * 年报版：全年总览、逐月节奏、最常用、品类分布。
 * 全部在本机用 canvas 画，不上传；App 直接存相册；H5 先下载，
 * 手机浏览器再弹出大图，长按即可存进相册（网页没有写入系统相册的权限）。
 *
 * 画布按 750 宽的稿子画，月报 750 × 1000，年报 750 × 1500；
 * 导出时 destWidth/destHeight 放大一倍（约 3MP / 4.5MP，JPEG）。
 */
import { computed, getCurrentInstance, nextTick, ref } from 'vue';
import { onLoad, onReady } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { loadReportData } from '@/db/repo';
import {
  buildMonthReport,
  currentMonth,
  type AdviceKind,
  type MonthReport,
} from '@/services/monthly-report';
import { buildYearReport, type YearReport } from '@/services/yearly-report';

type PosterKind = 'month' | 'year';

type TemplateId = 'journal' | 'fridge' | 'polaroid';

type PaperKind = 'lined' | 'fridge' | 'cork';

interface PosterTheme {
  id: TemplateId;
  name: string;
  desc: string;
  swatch: string;
  bg1: string;
  bg2: string;
  card: string;
  text: string;
  sub: string;
  accent: string;
  line: string;
  chipBg: string;
  chipText: string;
  bar: string;
  /** 纸张质感：横线手账 / 冰箱门 / 软木照片墙 */
  paper: PaperKind;
  /** 和纸胶带颜色 */
  tape: string;
  /** 两张便签纸的颜色 */
  noteA: string;
  noteB: string;
  /** 冰箱贴 / 圆点装饰色 */
  magnet: string;
  magnet2: string;
  shadow: string;
}

interface PosterAdvice {
  kind: AdviceKind;
  title: string;
}

interface PosterData {
  title: string;
  monthLabel: string;
  range: string;
  exportedAt: string;
  expiringItems: number;
  expiringUnits: number;
  restockItems: number;
  advices: PosterAdvice[];
  historical: boolean;
  /** 本月记了几天、用掉多少件、最常翻牌的东西，写在图里更像自己的日记 */
  activeDays: number;
  consumedUnits: number;
  topName: string;
}

interface YearPosterData {
  title: string;
  yearLabel: string;
  range: string;
  exportedAt: string;
  consumedUnits: number;
  boughtUnits: number;
  activeDays: number;
  observedDays: number;
  newItems: number;
  busiestMonth: number | null;
  busiestUnits: number;
  previousText: string;
  months: { month: number; units: number }[];
  top: { name: string; useDays: number; consumed: number; unit: string }[];
  categories: { name: string; share: number; days: number }[];
}

const DESIGN_WIDTH = 750;
const MONTH_HEIGHT = 1000;
const YEAR_HEIGHT = 1500;
const EXPORT_WIDTH = 1500;

/** 品类条的颜色：三套模板下都能看清 */
const CATEGORY_COLORS = ['#d9a334', '#a9b38b', '#c98f5a', '#7f9a94', '#b8a582'];

const THEMES: Record<TemplateId, PosterTheme> = {
  journal: {
    id: 'journal',
    name: '手账',
    desc: '横线纸 · 随手记',
    swatch: 'linear-gradient(135deg, #fffaf0 0%, #f6e3ba 55%, #d98a5f 100%)',
    bg1: '#fffaf0',
    bg2: '#f8edda',
    card: '#fffdf6',
    text: '#463322',
    sub: '#8a7454',
    accent: '#b3641f',
    line: '#e7d8bc',
    chipBg: '#fbeec7',
    chipText: '#a05a1c',
    bar: '#e6c07a',
    paper: 'lined',
    tape: 'rgba(242, 201, 106, 0.62)',
    noteA: '#fdf0b8',
    noteB: '#f9dcc8',
    magnet: '#d96c5f',
    magnet2: '#7fa9a0',
    shadow: 'rgba(120, 88, 40, 0.12)',
  },
  fridge: {
    id: 'fridge',
    name: '冰箱贴',
    desc: '白瓷 · 小纸条',
    swatch: 'linear-gradient(135deg, #f7faf8 0%, #cfe0d9 55%, #ffd9cf 100%)',
    bg1: '#f9fcfa',
    bg2: '#e7efeb',
    card: '#ffffff',
    text: '#2f3b36',
    sub: '#6d7f77',
    accent: '#4f7a6a',
    line: '#d8e4df',
    chipBg: '#e9f2ee',
    chipText: '#3f6a5a',
    bar: '#a9c8bb',
    paper: 'fridge',
    tape: 'rgba(255, 255, 255, 0.72)',
    noteA: '#fff3b0',
    noteB: '#ffd9cf',
    magnet: '#d96c5f',
    magnet2: '#5f8fc7',
    shadow: 'rgba(60, 80, 70, 0.12)',
  },
  polaroid: {
    id: 'polaroid',
    name: '拍立得',
    desc: '相纸 · 随手拍',
    swatch: 'linear-gradient(135deg, #f6efe3 0%, #e7d3b8 55%, #b8c9c2 100%)',
    bg1: '#f7f0e4',
    bg2: '#eaddc7',
    card: '#fffdf8',
    text: '#4a3a2c',
    sub: '#8b7862',
    accent: '#a35a4a',
    line: '#ddd0bb',
    chipBg: '#f4e7d8',
    chipText: '#a35a4a',
    bar: '#c9a98b',
    paper: 'cork',
    tape: 'rgba(255, 253, 247, 0.82)',
    noteA: '#fdf6e4',
    noteB: '#f7e3d8',
    magnet: '#c9785f',
    magnet2: '#93a99b',
    shadow: 'rgba(120, 96, 60, 0.14)',
  },
};

const TEMPLATES: PosterTheme[] = [THEMES.journal, THEMES.fridge, THEMES.polaroid];

const KIND_LABEL: Record<AdviceKind, string> = {
  act: '临期',
  buy: '补货',
  hold: '缓买',
};

const store = useInventoryStore();
const instance = getCurrentInstance();
const kind = ref<PosterKind>('month');
const month = ref(currentMonth());
const year = ref(Number(currentMonth().slice(0, 4)));
const monthReport = ref<MonthReport | null>(null);
const yearReport = ref<YearReport | null>(null);
const loading = ref(true);
const error = ref('');
const templateId = ref<TemplateId>('journal');
const previewWidth = ref(343);
/** 画布生成出来的图片：预览和保存都用这一份，所见即所得 */
const previewUrl = ref('');
/** 当前预览图是哪个模板画出来的：点保存时可以判断要不要先重画 */
let previewTemplate: TemplateId | null = null;
const saving = ref(false);
/** H5：保存后弹出的大图（手机浏览器里长按它存相册） */
const h5PreviewUrl = ref('');
/** 导出时间在进页面时定住，切换模板重画不会变 */
const exportedAt = ref(formatExportTime(new Date()));
/** 画布按顺序重画，快速切模板时不会把上一张的指令混进来 */
let drawQueue: Promise<void> = Promise.resolve();

const designHeight = computed(() => (kind.value === 'year' ? YEAR_HEIGHT : MONTH_HEIGHT));

const monthPosterData = computed<PosterData | null>(() => {
  const current = monthReport.value;
  if (!current) return null;
  const source = current.nextMonth.items.length ? current.nextMonth.items : current.advices;
  return {
    title: '囤物月报',
    monthLabel: current.label,
    range: current.rangeLabel,
    exportedAt: exportedAt.value,
    expiringItems: current.nextMonth.expiringItems,
    expiringUnits: current.nextMonth.expiringUnits,
    restockItems: current.nextMonth.restockItems,
    advices: source.slice(0, 3).map((advice) => ({ kind: advice.kind, title: advice.title })),
    historical: !current.isCurrent,
    activeDays: current.activeDays,
    consumedUnits: current.consumedUnits,
    topName: current.top[0]?.item.name ?? '',
  };
});

const yearPosterData = computed<YearPosterData | null>(() => {
  const current = yearReport.value;
  if (!current) return null;
  const diff = current.previous ? current.consumedUnits - current.previous.consumedUnits : 0;
  return {
    title: '囤物年报',
    yearLabel: current.label,
    range: current.rangeLabel,
    exportedAt: exportedAt.value,
    consumedUnits: current.consumedUnits,
    boughtUnits: current.boughtUnits,
    activeDays: current.activeDays,
    observedDays: current.observedDays,
    newItems: current.newItems,
    busiestMonth: current.busiestMonth?.month ?? null,
    busiestUnits: current.busiestMonth?.units ?? 0,
    previousText: current.previous
      ? diff === 0
        ? '和去年持平'
        : diff > 0
          ? `比去年多 ${diff} 件`
          : `比去年少 ${-diff} 件`
      : '去年还没有记录',
    months: Array.from({ length: 12 }, (_, index) => {
      const row = current.months.find((monthRow) => monthRow.month === index + 1);
      return { month: index + 1, units: row?.units ?? 0 };
    }),
    top: current.top.slice(0, 3).map((row) => ({
      name: row.item.name,
      useDays: row.useDays,
      consumed: row.consumed,
      unit: row.item.unit,
    })),
    categories: current.categories.map((row) => ({
      name: row.name,
      share: row.share,
      days: row.days,
    })),
  };
});

const posterLabel = computed(() => {
  if (kind.value === 'year') return `${year.value} 年`;
  return monthReport.value?.label ?? month.value;
});

const previewStyle = computed(
  () =>
    `width: ${previewWidth.value}px; height: ${(previewWidth.value * designHeight.value) / DESIGN_WIDTH}px;`,
);

const canvasStyle = computed(
  () => `width: ${DESIGN_WIDTH}px; height: ${designHeight.value}px;`,
);

onLoad((query) => {
  kind.value = query?.kind === 'year' ? 'year' : 'month';
  const monthValue = typeof query?.month === 'string' ? query.month : '';
  if (/^\d{4}-\d{2}$/.test(monthValue)) month.value = monthValue;
  const yearValue = typeof query?.year === 'string' ? query.year : '';
  if (/^\d{4}$/.test(yearValue)) year.value = Number(yearValue);
});

onReady(() => {
  void load();
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    await store.init();
    const data = await loadReportData();
    if (kind.value === 'year') {
      yearReport.value = buildYearReport(data, year.value);
    } else {
      monthReport.value = buildMonthReport(data, month.value);
    }
    previewWidth.value = Math.min(uni.getSystemInfoSync().windowWidth - 32, 375);
    // 先让 canvas 进 DOM，再画
    loading.value = false;
    await nextTick();
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    await scheduleDraw();
  } catch (err) {
    console.error('[report-poster] 生成图片失败', err);
    error.value = kind.value === 'year' ? '年报图片没生成出来，返回再试一次' : '月报图片没生成出来，返回再试一次';
    loading.value = false;
  }
}

function scheduleDraw(): Promise<void> {
  const run = drawQueue.then(() => drawPoster());
  drawQueue = run.catch(() => undefined);
  return run;
}

async function drawPoster(): Promise<void> {
  const themeId = templateId.value;
  const theme = THEMES[themeId];
  const height = designHeight.value;
  if (kind.value === 'year') {
    const data = yearPosterData.value;
    if (!data) return;
    await nextTick();
    const ctx = uni.createCanvasContext('poster', instance?.proxy as never);
    ctx.clearRect(0, 0, DESIGN_WIDTH, height);
    drawYearTemplate(ctx as never, data, theme);
    await commitDraw(ctx);
    previewUrl.value = await capture(EXPORT_WIDTH, height * 2);
    previewTemplate = themeId;
    return;
  }

  const data = monthPosterData.value;
  if (!data) return;
  await nextTick();
  const ctx = uni.createCanvasContext('poster', instance?.proxy as never);
  ctx.clearRect(0, 0, DESIGN_WIDTH, height);
  drawTemplate(ctx as never, data, theme);
  await commitDraw(ctx);
  previewUrl.value = await capture(EXPORT_WIDTH, height * 2);
  previewTemplate = themeId;
}

/** 等 canvas 画完：个别端 draw 回调不触发，兜底放行 */
async function commitDraw(ctx: UniNamespace.CanvasContext): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    ctx.draw(false, finish);
    // 个别端 draw 回调不触发，兜底放行
    setTimeout(finish, 600);
  });

  // 画完立刻导出一份给预览：普通 <image> 缩放，不依赖 canvas 的 CSS transform，
  // App 端原生 canvas 不支持 transform 时也不会只看到左上角。
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
}

function capture(destWidth: number, destHeight: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    uni.canvasToTempFilePath(
      {
        canvasId: 'poster',
        x: 0,
        y: 0,
        width: DESIGN_WIDTH,
        height: designHeight.value,
        destWidth,
        destHeight,
        fileType: 'jpg',
        quality: 0.92,
        success: (res) => resolve(res.tempFilePath),
        fail: reject,
      },
      instance?.proxy as never,
    );
  });
}

function selectTemplate(id: TemplateId): void {
  if (templateId.value === id) return;
  templateId.value = id;
  void scheduleDraw();
}

function savePoster(): void {
  if (saving.value) return;
  // 当前模板的图已经画好了就直接在这一下点击里保存：
  // 手机浏览器会拦截不在用户手势里触发的下载，再 await 一次可能什么都存不下来。
  if (previewUrl.value && previewTemplate === templateId.value) {
    void finishSave(previewUrl.value).catch(handleSaveError);
    return;
  }
  saving.value = true;
  uni.showLoading({ title: '生成中…', mask: true });
  void (async () => {
    try {
      // 队列跑完时 previewUrl 已经是最新模板导出的图
      await scheduleDraw();
      const filePath =
        previewUrl.value || (await capture(EXPORT_WIDTH, designHeight.value * 2));

      uni.hideLoading();
      await finishSave(filePath);
    } catch (err) {
      handleSaveError(err);
    } finally {
      saving.value = false;
    }
  })();
}

function handleSaveError(err: unknown): void {
  console.error('[report-poster] 导出失败', err);
  uni.hideLoading();
  uni.showToast({ title: '图片生成失败，再试一次', icon: 'none' });
}

async function finishSave(filePath: string): Promise<void> {
  // #ifdef H5
  saveOnH5(filePath);
  // #endif
  // #ifndef H5
  await saveOnApp(filePath);
  // #endif
}

// #ifdef H5
function saveOnH5(url: string): void {
  const fileName =
    kind.value === 'year' ? `囤物年报-${year.value}.jpg` : `囤物月报-${month.value}.jpg`;
  // uni 在 H5 返回的是 data URL；转成 Blob 再下载，手机浏览器更不容易静默拦掉
  const objectUrl = dataUrlToObjectUrl(url);
  const link = document.createElement('a');
  link.href = objectUrl || url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, 3000);

  // 网页没有写系统相册的权限：手机上加弹一张大图，长按就能存进相册
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  if (touch) h5PreviewUrl.value = url;
  uni.showToast({ title: '图片已生成', icon: 'success' });
}

function dataUrlToObjectUrl(dataUrl: string): string {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return '';
    const mime = /data:([^;]+)/.exec(dataUrl.slice(0, comma))?.[1] || 'image/jpeg';
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return '';
  }
}
// #endif

// #ifndef H5
function saveOnApp(filePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        uni.showToast({ title: '已保存到相册', icon: 'success' });
        resolve();
      },
      fail: () => {
        // 相册权限被拒时，退回到预览：长按图片也能存
        uni.previewImage({
          urls: [filePath],
          success: () => resolve(),
          fail: (err) => reject(err),
        });
      },
    });
  });
}
// #endif

/* ---------------- 画布：所有坐标按 750 × 1000 设计稿 ---------------- */

function drawTemplate(ctx: UniNamespace.CanvasContext, data: PosterData, theme: PosterTheme): void {
  drawPaper(ctx, theme, MONTH_HEIGHT);
  if (theme.id === 'journal') drawJournalMonth(ctx, data, theme);
  else if (theme.id === 'fridge') drawFridgeMonth(ctx, data, theme);
  else drawPolaroidMonth(ctx, data, theme);
}

function drawYearTemplate(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawPaper(ctx, theme, YEAR_HEIGHT);
  drawYearHeader(ctx, data, theme);
  drawYearStats(ctx, data, theme);
  drawYearMonths(ctx, data, theme);
  drawYearTop(ctx, data, theme);
  drawYearCategories(ctx, data, theme);
  drawThemedFooter(ctx, theme, YEAR_HEIGHT, true);
}

/* ---------------- 纸张：横线手账 / 冰箱门 / 软木照片墙 ---------------- */

function drawPaper(ctx: UniNamespace.CanvasContext, theme: PosterTheme, height: number): void {
  try {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, theme.bg1);
    gradient.addColorStop(1, theme.bg2);
    ctx.setFillStyle(gradient);
  } catch {
    ctx.setFillStyle(theme.bg1);
  }
  ctx.fillRect(0, 0, DESIGN_WIDTH, height);

  if (theme.paper === 'lined') drawRuledPaper(ctx, theme, height);
  else if (theme.paper === 'fridge') drawFridgeDoor(ctx, theme, height);
  else drawCorkBoard(ctx, theme, height);
}

function drawRuledPaper(ctx: UniNamespace.CanvasContext, theme: PosterTheme, height: number): void {
  ctx.setStrokeStyle('rgba(154, 101, 20, 0.10)');
  ctx.setLineWidth(1);
  for (let y = 140; y < height; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(DESIGN_WIDTH, y);
    ctx.stroke();
  }

  // 左侧红边和装订孔
  ctx.setStrokeStyle('rgba(185, 86, 63, 0.16)');
  ctx.beginPath();
  ctx.moveTo(96, 0);
  ctx.lineTo(96, height);
  ctx.stroke();

  [170, 500, 830].forEach((y) => {
    if (y > height - 40) return;
    ctx.setFillStyle('#ffffff');
    ctx.beginPath();
    ctx.arc(38, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.setStrokeStyle('rgba(120, 95, 60, 0.16)');
    ctx.setLineWidth(1);
    ctx.beginPath();
    ctx.arc(38, y, 14, 0, Math.PI * 2);
    ctx.stroke();
  });

  drawTape(ctx, 612, 44, 200, 48, -0.16, theme.tape);
}

function drawFridgeDoor(ctx: UniNamespace.CanvasContext, theme: PosterTheme, height: number): void {
  // 瓷面反光
  ctx.setFillStyle('rgba(255, 255, 255, 0.42)');
  for (let x = -40; x < DESIGN_WIDTH; x += 166) {
    ctx.fillRect(x, 0, 46, height);
  }

  // 门边
  strokeRoundRect(ctx, 16.5, 16.5, DESIGN_WIDTH - 33, height - 33, 44, 'rgba(47, 59, 54, 0.10)');

  // 几点反光
  const dots: number[][] = [
    [92, 250],
    [648, 320],
    [150, 760],
    [590, 980],
    [360, 1120],
  ];
  ctx.setFillStyle('rgba(255, 255, 255, 0.7)');
  dots.forEach(([x, y]) => {
    if (y > height - 30) return;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  drawMagnet(ctx, 622, 92, 26, theme.magnet);
  drawMagnet(ctx, 682, 124, 17, theme.magnet2);
}

function drawCorkBoard(ctx: UniNamespace.CanvasContext, theme: PosterTheme, height: number): void {
  // 软木颗粒：固定步长铺，每次导出都一样
  for (let i = 0; i < 320; i += 1) {
    const x = (i * 137.508) % DESIGN_WIDTH;
    const y = (i * 89.13) % height;
    const r = 0.8 + (i % 3) * 0.7;
    ctx.setFillStyle(i % 6 === 0 ? 'rgba(120, 90, 50, 0.055)' : 'rgba(255, 255, 255, 0.28)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTape(ctx, 98, 34, 150, 36, -0.22, theme.tape);
  drawTape(ctx, 650, 54, 160, 38, 0.18, theme.tape);
}

/* ---------------- 月报：手账 ---------------- */

function drawJournalMonth(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  drawJournalHeader(ctx, data, theme);
  drawMonthLife(ctx, data, theme, 112, 268);

  drawNote(ctx, 52, 368, 312, 196, -0.032, theme.noteA, theme.tape, null, () => {
    paintStatNote(
      ctx,
      theme,
      '下个月要到期',
      data.expiringItems,
      '种',
      data.historical ? '历史月份没有当月快照' : `一共 ${data.expiringUnits} 件`,
    );
  });
  drawNote(ctx, 392, 390, 306, 196, 0.028, theme.noteB, theme.tape, null, () => {
    paintStatNote(
      ctx,
      theme,
      '该补货的',
      data.restockItems,
      '样',
      data.historical ? '历史月份没有当月快照' : '按用掉的速度估的',
    );
  });

  drawChecklistTitle(ctx, '下个月想做这几件事', 64, 636, theme);
  drawAdviceRows(ctx, data, theme, 690, 68, 64, 620);

  drawSun(ctx, 642, 148, 24, 'rgba(179, 100, 31, 0.50)');
  drawStar(ctx, 604, 320, 9, 'rgba(179, 100, 31, 0.32)');
  drawStar(ctx, 108, 236, 7, 'rgba(179, 100, 31, 0.28)');
  drawCoffeeRing(ctx, 664, 604, 28);
  drawThemedFooter(ctx, theme, MONTH_HEIGHT, false);
}

function drawJournalHeader(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  drawBrand(ctx, theme, 118, 34);

  const num = monthNumber(data.monthLabel);
  setFont(ctx, 80, true);
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  ctx.setFillStyle(theme.text);
  ctx.fillText(num, 112, 66);
  const numWidth = measure(ctx, num, 80);
  setFont(ctx, 32, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText('月', 112 + numWidth + 10, 104);

  setFont(ctx, 34, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText('囤物小记', 112, 166);
  drawWavyUnderline(ctx, 112, 210, measure(ctx, '囤物小记', 34) + 28, theme.accent);

  const time = data.exportedAt.split(' ')[1] ?? '';
  ctx.save();
  ctx.translate(586, 92);
  ctx.rotate(-0.06);
  setFont(ctx, 16);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(`${time} 整理`, 0, 0);
  ctx.restore();
}

/* ---------------- 月报：冰箱贴 ---------------- */

function drawFridgeMonth(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  drawFridgeHeader(ctx, data, theme);

  drawNote(ctx, 48, 340, 310, 204, -0.03, theme.noteA, theme.tape, theme.magnet, () => {
    paintStatNote(
      ctx,
      theme,
      '先吃这些',
      data.expiringItems,
      '种',
      data.historical ? '历史月份没有当月快照' : `下个月到期 · 共 ${data.expiringUnits} 件`,
    );
  });
  drawNote(ctx, 392, 358, 310, 204, 0.025, theme.noteB, theme.tape, theme.magnet2, () => {
    paintStatNote(
      ctx,
      theme,
      '该补了',
      data.restockItems,
      '样',
      data.historical ? '历史月份没有当月快照' : '按用掉的速度估的',
    );
  });

  drawFridgeAdvices(ctx, data, theme);

  drawMilk(ctx, 648, 264, 0.9, '#e6a86a');
  drawStar(ctx, 706, 300, 8, 'rgba(217, 108, 95, 0.40)');
  drawThemedFooter(ctx, theme, MONTH_HEIGHT, false);
}

function drawFridgeHeader(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  ctx.save();
  ctx.translate(395, 122);
  ctx.rotate(-0.018);
  ctx.translate(-355, -88);

  fillRoundRect(ctx, 8, 10, 710, 176, 18, theme.shadow);
  fillRoundRect(ctx, 0, 0, 710, 176, 18, '#ffffff');
  drawMagnet(ctx, 40, 40, 17, theme.magnet);

  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText('冰箱门口 · 小囤', 70, 28);
  setFont(ctx, 44, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(`${monthNumber(data.monthLabel)} 月的冰箱`, 34, 56);
  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(data.range, 34, 116);
  setFont(ctx, 20, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(`记了 ${data.activeDays} 天 · 用掉 ${data.consumedUnits} 件`, 34, 144);
  ctx.restore();
}

function drawFridgeAdvices(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  ctx.save();
  ctx.translate(375, 730);
  ctx.rotate(-0.012);
  ctx.translate(-331, -160);

  fillRoundRect(ctx, 8, 10, 662, 320, 16, theme.shadow);
  fillRoundRect(ctx, 0, 0, 662, 320, 16, '#ffffff');

  ctx.setStrokeStyle('rgba(79, 122, 106, 0.14)');
  ctx.setLineWidth(1);
  for (let y = 78; y < 320; y += 52) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(638, y);
    ctx.stroke();
  }

  drawMagnet(ctx, 331, 0, 17, theme.magnet2);
  drawChecklistTitle(ctx, '下次逛超市记得', 30, 26, theme);
  drawAdviceRows(ctx, data, theme, 108, 62, 30, 570);
  ctx.restore();
}

/* ---------------- 月报：拍立得 ---------------- */

function drawPolaroidMonth(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  drawPolaroidHeader(ctx, data, theme);

  drawPolaroidFrame(
    ctx,
    46,
    200,
    320,
    400,
    -0.055,
    theme,
    (px, py, w, h) => {
      drawPolaroidShelf(ctx, px, py, w, h);
    },
    () => {
      paintPolaroidCaption(
        ctx,
        theme,
        400,
        String(data.expiringItems),
        '种东西',
        data.historical ? '历史月份没有快照' : `下个月到期 · 共 ${data.expiringUnits} 件`,
      );
    },
  );

  drawPolaroidFrame(
    ctx,
    410,
    238,
    300,
    380,
    0.045,
    theme,
    (px, py, w, h) => {
      drawPolaroidBag(ctx, px, py, w, h);
    },
    () => {
      paintPolaroidCaption(
        ctx,
        theme,
        380,
        String(data.restockItems),
        '样该补货',
        data.historical ? '历史月份没有快照' : '按用掉的速度估的',
      );
    },
  );

  drawPolaroidAdvices(ctx, data, theme);
  drawStar(ctx, 604, 330, 10, 'rgba(163, 90, 74, 0.35)');
  drawHeart(ctx, 88, 640, 10, 'rgba(163, 90, 74, 0.28)');
  drawThemedFooter(ctx, theme, MONTH_HEIGHT, false);
}

function drawPolaroidHeader(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  drawBrand(ctx, theme, 56, 34);
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 44, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(`${monthNumber(data.monthLabel)} 月的拍立得`, 56, 66);
  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(data.range, 56, 126);
  setFont(ctx, 20, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(`记了 ${data.activeDays} 天 · 用掉 ${data.consumedUnits} 件`, 56, 156);
  drawCamera(ctx, 596, 44, 0.04);
}

function drawPolaroidFrame(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  theme: PosterTheme,
  paintPhoto: (px: number, py: number, pw: number, ph: number) => void,
  paintCaption: () => void,
): void {
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(angle);
  ctx.translate(-width / 2, -height / 2);

  fillRoundRect(ctx, 9, 12, width, height, 6, theme.shadow);
  fillRoundRect(ctx, 0, 0, width, height, 6, '#fffdf8');
  drawTape(ctx, width / 2, 2, 108, 27, -0.02, theme.tape);

  paintPhoto(18, 18, width - 36, height - 112);
  paintCaption();
  ctx.restore();
}

function paintPolaroidCaption(
  ctx: UniNamespace.CanvasContext,
  theme: PosterTheme,
  height: number,
  value: string,
  unit: string,
  sub: string,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 62, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(value, 26, height - 90);
  const valueWidth = measure(ctx, value, 62);
  setFont(ctx, 22, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(unit, 26 + valueWidth + 12, height - 66);
  setFont(ctx, 17);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(sub, 26, height - 32);
}

function drawPolaroidShelf(
  ctx: UniNamespace.CanvasContext,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  fillRoundRect(ctx, px, py, pw, ph, 2, '#f7e8c9');
  ctx.setFillStyle('#eed9b0');
  ctx.fillRect(px, py + ph - 40, pw, 40);
  drawSun(ctx, px + pw - 44, py + 44, 17, 'rgba(179, 100, 31, 0.45)');

  ctx.setFillStyle('#d9b780');
  ctx.fillRect(px + 20, py + ph - 54, pw - 40, 7);
  drawJar(ctx, px + 38, py + ph - 118, 36, 64, '#e6a86a');
  drawJar(ctx, px + 100, py + ph - 102, 42, 48, '#a9c8bb');
  drawJar(ctx, px + 168, py + ph - 128, 30, 74, '#d98a5f');
}

function drawPolaroidBag(
  ctx: UniNamespace.CanvasContext,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  fillRoundRect(ctx, px, py, pw, ph, 2, '#f4e3d3');
  ctx.setFillStyle('rgba(255, 255, 255, 0.5)');
  ctx.fillRect(px, py + ph - 52, pw, 52);

  ctx.setFillStyle('#e6b98a');
  ctx.fillRect(px + 34, py + ph - 84, 54, 32);
  ctx.fillRect(px + 96, py + ph - 104, 46, 52);
  ctx.setFillStyle('#c98f5a');
  ctx.fillRect(px + 150, py + ph - 70, 40, 18);

  // 购物袋
  ctx.setStrokeStyle('rgba(163, 90, 74, 0.75)');
  ctx.setLineWidth(3);
  ctx.beginPath();
  ctx.arc(px + pw - 58, py + 72, 18, Math.PI, Math.PI * 2);
  ctx.stroke();
  fillRoundRect(ctx, px + pw - 92, py + 70, 68, 54, 5, '#f4d9c9');
  ctx.setFillStyle('rgba(163, 90, 74, 0.55)');
  ctx.fillRect(px + pw - 84, py + 84, 52, 6);
}

function drawPolaroidAdvices(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
): void {
  ctx.save();
  ctx.translate(375, 767);
  ctx.rotate(-0.008);
  ctx.translate(-325, -125);

  fillRoundRect(ctx, 8, 10, 650, 250, 10, theme.shadow);
  fillRoundRect(ctx, 0, 0, 650, 250, 10, '#fffdf8');
  drawTape(ctx, 325, 2, 118, 27, 0.02, theme.tape);
  drawChecklistTitle(ctx, '下个月记得', 28, 26, theme);
  drawAdviceRows(ctx, data, theme, 86, 54, 28, 560);
  ctx.restore();
}

/* ---------------- 年报头图 ---------------- */

function drawYearHeader(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawBrand(ctx, theme, 56, 34);
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');

  const title =
    theme.id === 'journal'
      ? `${data.yearLabel}的囤物手账`
      : theme.id === 'fridge'
        ? `${data.yearLabel}的冰箱`
        : `${data.yearLabel}的拍立得`;
  setFont(ctx, 44, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(title, 56, 66);
  drawWavyUnderline(ctx, 56, 126, measure(ctx, title, 44) + 30, theme.accent);

  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(data.range, 56, 146);
  setFont(ctx, 20, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(`记了 ${data.activeDays} 天 · 用掉 ${data.consumedUnits} 件`, 56, 176);

  if (theme.id === 'journal') drawTape(ctx, 616, 48, 190, 46, -0.14, theme.tape);
  else if (theme.id === 'fridge') {
    drawMagnet(ctx, 612, 96, 24, theme.magnet);
    drawMagnet(ctx, 664, 126, 15, theme.magnet2);
  } else drawCamera(ctx, 588, 48, 0.03);

  drawDashedLine(ctx, 56, 246, 694, 246, theme.line);
  drawStar(ctx, 528, 210, 8, 'rgba(179, 100, 31, 0.28)');
  drawHeart(ctx, 566, 206, 9, 'rgba(163, 90, 74, 0.25)');
}

/* ---------------- 共用小件 ---------------- */

function drawBrand(ctx: UniNamespace.CanvasContext, theme: PosterTheme, x: number, y: number): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  ctx.setFillStyle(theme.accent);
  ctx.beginPath();
  ctx.arc(x - 14, y + 12, 5, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText('囤物有数 · 小囤', x, y);
}

function drawMonthLife(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
  x: number,
  y: number,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(data.range, x, y);
  setFont(ctx, 22, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(`这个月记了 ${data.activeDays} 天 · 用掉 ${data.consumedUnits} 件`, x, y + 30);
  setFont(ctx, 18);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(data.topName ? `最常翻牌：${data.topName}` : '还没有消耗记录，下个月记几笔吧', x, y + 62);
}

function drawNote(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  color: string,
  tapeColor: string,
  magnetColor: string | null,
  paint: () => void,
): void {
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(angle);
  ctx.translate(-width / 2, -height / 2);

  fillRoundRect(ctx, 7, 9, width, height, 14, 'rgba(120, 88, 40, 0.10)');
  fillRoundRect(ctx, 0, 0, width, height, 14, color);

  // 右下角翘起来的折角
  ctx.setFillStyle('rgba(255, 255, 255, 0.34)');
  ctx.beginPath();
  ctx.moveTo(width - 44, height);
  ctx.lineTo(width, height - 44);
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  if (magnetColor) drawMagnet(ctx, width / 2, 2, 15, magnetColor);
  else drawTape(ctx, width / 2, 2, 108, 28, 0.03, tapeColor);

  paint();
  ctx.restore();
}

function paintStatNote(
  ctx: UniNamespace.CanvasContext,
  theme: PosterTheme,
  label: string,
  value: number,
  unit: string,
  sub: string,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 21, true);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(label, 26, 34);

  setFont(ctx, 70, true);
  ctx.setFillStyle(theme.accent);
  ctx.fillText(String(value), 26, 72);
  const valueWidth = measure(ctx, String(value), 70);
  setFont(ctx, 22, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(unit, 26 + valueWidth + 10, 112);

  setFont(ctx, 17);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(sub, 26, 158);
}

function drawChecklistTitle(
  ctx: UniNamespace.CanvasContext,
  title: string,
  x: number,
  y: number,
  theme: PosterTheme,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 28, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(title, x, y);
  drawWavyUnderline(ctx, x, y + 40, measure(ctx, title, 28) + 24, theme.accent);
}

function drawAdviceRows(
  ctx: UniNamespace.CanvasContext,
  data: PosterData,
  theme: PosterTheme,
  startY: number,
  rowHeight: number,
  x: number,
  maxWidth: number,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');

  if (!data.advices.length) {
    setFont(ctx, 20);
    ctx.setFillStyle(theme.sub);
    ctx.fillText('这个月没什么要操心的，保持记录就好。', x, startY + 6);
    return;
  }

  data.advices.forEach((advice, index) => {
    const y = startY + index * rowHeight;
    drawCheckbox(ctx, x, y, 28, theme.accent);

    const dotColor =
      advice.kind === 'act' ? theme.magnet : advice.kind === 'buy' ? theme.magnet2 : theme.sub;
    ctx.setFillStyle(dotColor);
    ctx.beginPath();
    ctx.arc(x + 46, y + 14, 4, 0, Math.PI * 2);
    ctx.fill();

    setFont(ctx, 21);
    ctx.setFillStyle(theme.text);
    drawWrappedText(ctx, advice.title, x + 62, y - 1, maxWidth - 62, 27, 2, 21);
  });
}

function drawCheckbox(ctx: UniNamespace.CanvasContext, x: number, y: number, size: number, color: string): void {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(2);
  roundRectPath(ctx, x, y, size, size, 7);
  ctx.stroke();
}

function drawThemedFooter(
  ctx: UniNamespace.CanvasContext,
  theme: PosterTheme,
  height: number,
  yearly: boolean,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  drawDashedLine(ctx, 56, height - 96, 694, height - 96, theme.line);

  setFont(ctx, 18);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(yearly ? '—— 小囤陪你又囤了一年' : '—— 小囤陪你记', 56, height - 78);

  setFont(ctx, 15);
  ctx.fillText('数据只存在你手机里', 56, height - 50);

  drawHeart(ctx, 674, height - 60, 9, 'rgba(179, 100, 31, 0.32)');
}

/* ---------------- 手绘小装饰 ---------------- */

function drawTape(
  ctx: UniNamespace.CanvasContext,
  cx: number,
  cy: number,
  width: number,
  height: number,
  angle: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.setFillStyle(color);
  ctx.fillRect(-width / 2, -height / 2, width, height);

  ctx.setStrokeStyle('rgba(255, 255, 255, 0.36)');
  ctx.setLineWidth(2);
  for (let x = -width / 2 - height; x < width / 2; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, -height / 2);
    ctx.lineTo(x + height * 0.7, height / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMagnet(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.setFillStyle(color);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.setFillStyle('rgba(255, 255, 255, 0.45)');
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.3, r * 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.setStrokeStyle('rgba(0, 0, 0, 0.10)');
  ctx.setLineWidth(1);
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSun(ctx: UniNamespace.CanvasContext, cx: number, cy: number, r: number, color: string): void {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(3);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (r + 7), cy + Math.sin(angle) * (r + 7));
    ctx.lineTo(cx + Math.cos(angle) * (r + 17), cy + Math.sin(angle) * (r + 17));
    ctx.stroke();
  }
}

function drawStar(ctx: UniNamespace.CanvasContext, cx: number, cy: number, r: number, color: string): void {
  ctx.setFillStyle(color);
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.44;
    const angle = -Math.PI / 2 + (Math.PI * i) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHeart(ctx: UniNamespace.CanvasContext, cx: number, cy: number, size: number, color: string): void {
  ctx.setFillStyle(color);
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.78);
  ctx.bezierCurveTo(cx - size, cy + size * 0.18, cx - size * 0.78, cy - size * 0.68, cx, cy - size * 0.12);
  ctx.bezierCurveTo(cx + size * 0.78, cy - size * 0.68, cx + size, cy + size * 0.18, cx, cy + size * 0.78);
  ctx.closePath();
  ctx.fill();
}

function drawCoffeeRing(ctx: UniNamespace.CanvasContext, cx: number, cy: number, r: number): void {
  ctx.setStrokeStyle('rgba(154, 101, 20, 0.09)');
  ctx.setLineWidth(6);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.3, Math.PI * 1.92);
  ctx.stroke();

  ctx.setLineWidth(3);
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9, 0.6, Math.PI * 1.7);
  ctx.stroke();
}

function drawWavyUnderline(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(2.5);
  ctx.beginPath();
  for (let offset = 0; offset <= width; offset += 12) {
    const px = x + offset;
    const py = y + Math.sin(offset / 16) * 3;
    if (offset === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawDashedLine(
  ctx: UniNamespace.CanvasContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
): void {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const dash = 6;
  const gap = 8;
  for (let pos = 0; pos < length; pos += dash + gap) {
    const t1 = pos / length;
    const t2 = Math.min((pos + dash) / length, 1);
    ctx.beginPath();
    ctx.moveTo(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1);
    ctx.lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
    ctx.stroke();
  }
}

function drawJar(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  fillRoundRect(ctx, x, y + 8, width, height - 8, 8, color);
  ctx.setFillStyle('rgba(255, 255, 255, 0.42)');
  ctx.fillRect(x + 4, y, width - 8, 10);
  ctx.setFillStyle('rgba(255, 255, 255, 0.75)');
  ctx.fillRect(x + width * 0.2, y + height * 0.42, width * 0.6, height * 0.2);
}

function drawMilk(ctx: UniNamespace.CanvasContext, x: number, y: number, scale: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.setFillStyle(color);
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(20, 0);
  ctx.lineTo(52, 0);
  ctx.lineTo(72, 18);
  ctx.lineTo(72, 92);
  ctx.lineTo(0, 92);
  ctx.closePath();
  ctx.fill();
  ctx.setFillStyle('rgba(255, 255, 255, 0.55)');
  ctx.fillRect(6, 34, 60, 30);
  ctx.restore();
}

function drawCamera(ctx: UniNamespace.CanvasContext, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.setStrokeStyle('rgba(74, 58, 44, 0.55)');
  ctx.setLineWidth(3);
  roundRectPath(ctx, 0, 10, 96, 66, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48, 43, 20, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48, 43, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(14, 10);
  ctx.lineTo(28, 10);
  ctx.lineTo(32, 0);
  ctx.lineTo(60, 0);
  ctx.lineTo(64, 10);
  ctx.stroke();
  ctx.restore();
}

function monthNumber(label: string): string {
  const match = label.match(/(\d{1,2})\s*月/);
  return match ? match[1] : label;
}

function drawSectionTitle(
  ctx: UniNamespace.CanvasContext,
  title: string,
  y: number,
  theme: PosterTheme,
): void {
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  ctx.setFillStyle(theme.accent);
  ctx.beginPath();
  ctx.arc(46, y + 15, 5, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 28, true);
  ctx.setFillStyle(theme.text);
  ctx.fillText(title, 64, y);
  drawWavyUnderline(ctx, 64, y + 38, measure(ctx, title, 28) + 22, theme.accent);
}

/* ---------------- 年报：全年总览 ---------------- */

function drawYearStats(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawSectionTitle(ctx, '全年总览', 328, theme);

  drawCompactStatCard(ctx, 56, 372, '用掉', data.consumedUnits, '件', data.previousText, theme);
  drawCompactStatCard(
    ctx,
    394,
    372,
    '买进',
    data.boughtUnits,
    '件',
    `新增 ${data.newItems} 种物品`,
    theme,
  );
  drawCompactStatCard(
    ctx,
    56,
    536,
    '在用天数',
    data.activeDays,
    '天',
    `统计 ${data.observedDays} 天`,
    theme,
  );
  drawCompactStatCard(
    ctx,
    394,
    536,
    '最忙月份',
    data.busiestMonth ?? -1,
    '月',
    data.busiestMonth ? `${data.busiestUnits} 件` : '这一年还没有记录',
    theme,
    data.busiestMonth !== null,
  );
}

function drawCompactStatCard(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  label: string,
  value: number,
  unit: string,
  sub: string,
  theme: PosterTheme,
  known = true,
): void {
  fillRoundRect(ctx, x + 6, y + 8, 300, 148, 22, theme.shadow);
  fillRoundRect(ctx, x, y, 300, 148, 22, theme.card);
  if (theme.id === 'fridge') {
    drawMagnet(ctx, x + 150, y, 13, theme.magnet);
  } else {
    drawTape(ctx, x + 150, y, 96, 24, 0.02, theme.tape);
  }

  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  setFont(ctx, 19);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(label, x + 28, y + 34);

  const valueText = known ? String(value) : '暂无';
  setFont(ctx, known ? 54 : 36, true);
  ctx.setFillStyle(known ? theme.accent : theme.sub);
  ctx.fillText(valueText, x + 28, y + 62);
  if (known) {
    const valueWidth = measure(ctx, valueText, 54);
    setFont(ctx, 19);
    ctx.setFillStyle(theme.sub);
    ctx.fillText(unit, x + 28 + valueWidth + 7, y + 94);
  }

  setFont(ctx, 17);
  ctx.setFillStyle(theme.sub);
  ctx.fillText(sub, x + 28, y + 112);
}

/* ---------------- 年报：逐月节奏 ---------------- */

function drawYearMonths(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawSectionTitle(ctx, '逐月节奏', 724, theme);

  const plotLeft = 56;
  const plotWidth = 638;
  const baseline = 884;
  const plotHeight = 118;
  const max = Math.max(...data.months.map((row) => row.units), 1);
  const slot = plotWidth / 12;

  ctx.setStrokeStyle(theme.line);
  ctx.setLineWidth(1);
  ctx.beginPath();
  ctx.moveTo(plotLeft, baseline);
  ctx.lineTo(plotLeft + plotWidth, baseline);
  ctx.stroke();

  data.months.forEach((row, index) => {
    const center = plotLeft + slot * index + slot / 2;
    const barWidth = Math.min(28, slot * 0.52);
    const barHeight = row.units > 0 ? Math.max(4, (row.units / max) * plotHeight) : 0;
    if (barHeight > 0) {
      const isBusiest = row.month === data.busiestMonth;
      fillRoundRect(
        ctx,
        center - barWidth / 2,
        baseline - barHeight,
        barWidth,
        barHeight,
        Math.min(7, barHeight / 2),
        isBusiest ? theme.accent : theme.bar,
      );
      if (isBusiest) {
        setFont(ctx, 16);
        ctx.setTextAlign('center');
        ctx.setTextBaseline('bottom');
        ctx.setFillStyle(theme.accent);
        ctx.fillText(String(row.units), center, baseline - barHeight - 6);
      }
    }

    setFont(ctx, 18);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('top');
    ctx.setFillStyle(theme.sub);
    ctx.fillText(`${row.month}`, center, baseline + 12);
  });

  setFont(ctx, 18);
  ctx.setTextAlign('left');
  ctx.setTextBaseline('top');
  ctx.setFillStyle(theme.sub);
  ctx.fillText(
    data.busiestMonth
      ? `最忙是 ${data.busiestMonth} 月 · ${data.busiestUnits} 件`
      : '这一年还没有逐月数据',
    plotLeft,
    926,
  );

  ctx.setStrokeStyle(theme.line);
  ctx.setLineWidth(1);
  ctx.beginPath();
  ctx.moveTo(56, 962);
  ctx.lineTo(694, 962);
  ctx.stroke();
}

/* ---------------- 年报：最常用 ---------------- */

function drawYearTop(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawSectionTitle(ctx, '最常用', 990, theme);

  if (!data.top.length) {
    setFont(ctx, 20);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('top');
    ctx.setFillStyle(theme.sub);
    ctx.fillText('这一年还没有消耗记录，记几笔就能看到排行。', 56, 1042);
    return;
  }

  const startY = 1032;
  const rowHeight = 66;
  data.top.forEach((row, index) => {
    const y = startY + index * rowHeight;
    fillRoundRect(ctx, 56, y + 2, 34, 34, 10, theme.chipBg);
    setFont(ctx, 17, true);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('top');
    ctx.setFillStyle(theme.chipText);
    ctx.fillText(String(index + 1), 73, y + 10);

    setFont(ctx, 24);
    ctx.setTextAlign('left');
    ctx.setFillStyle(theme.text);
    ctx.fillText(row.name, 108, y + 6);

    setFont(ctx, 18);
    ctx.setTextAlign('right');
    ctx.setFillStyle(theme.sub);
    ctx.fillText(`${row.useDays} 天 · ${row.consumed} ${row.unit}`, 694, y + 9);

    if (index < data.top.length - 1) {
      ctx.setStrokeStyle(theme.line);
      ctx.setLineWidth(1);
      ctx.beginPath();
      ctx.moveTo(56, y + 50);
      ctx.lineTo(694, y + 50);
      ctx.stroke();
    }
  });
}

/* ---------------- 年报：品类分布 ---------------- */

function drawYearCategories(
  ctx: UniNamespace.CanvasContext,
  data: YearPosterData,
  theme: PosterTheme,
): void {
  drawSectionTitle(ctx, '品类分布', 1228, theme);

  const rows = data.categories.slice(0, 5);
  if (!rows.length) {
    setFont(ctx, 20);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('top');
    ctx.setFillStyle(theme.sub);
    ctx.fillText('还没有可以统计的使用记录。', 56, 1300);
    return;
  }

  const barX = 56;
  const barY = 1282;
  const barWidth = 638;
  const barHeight = 32;
  let cursor = barX;
  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    const width = isLast
      ? barX + barWidth - cursor
      : Math.max(0, (row.share / 100) * barWidth - 3);
    if (width > 0) {
      fillRoundRect(
        ctx,
        cursor,
        barY,
        width,
        barHeight,
        index === 0 || isLast ? 10 : 0,
        CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      );
    }
    cursor += width + 3;
  });

  rows.forEach((row, index) => {
    const column = index % 2;
    const line = Math.floor(index / 2);
    const left = 56 + column * 338;
    const top = 1326 + line * 32;
    fillRoundRect(
      ctx,
      56 + column * 338,
      top + 3,
      14,
      14,
      4,
      CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    );

    setFont(ctx, 18);
    ctx.setTextAlign('left');
    ctx.setTextBaseline('top');
    ctx.setFillStyle(theme.text);
    ctx.fillText(row.name, left + 22, top);

    ctx.setTextAlign('right');
    ctx.setFillStyle(theme.accent);
    ctx.fillText(`${row.share}%`, left + 300, top);
  });
}

/* ---------------- 小工具 ---------------- */

function setFont(ctx: UniNamespace.CanvasContext, size: number, bold = false): void {
  ctx.setFontSize(size);
  try {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
  } catch {
    // App 端个别基座不支持 font 时，保留 setFontSize 的结果
  }
}

function measure(ctx: UniNamespace.CanvasContext, text: string, size: number): number {
  try {
    if (typeof ctx.measureText === 'function') {
      const metrics = ctx.measureText(text);
      if (metrics && typeof metrics.width === 'number') return metrics.width;
    }
  } catch {
    // 没有 measureText 时用下面的估算
  }
  let width = 0;
  for (const char of Array.from(text)) {
    width += /[一-龥，。！？、；：“”‘’（）《》·—]/.test(char) ? size : size * 0.56;
  }
  return width;
}

function drawWrappedText(
  ctx: UniNamespace.CanvasContext,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  size: number,
): void {
  const lines: string[] = [];
  let line = '';
  for (const char of Array.from(text)) {
    const next = line + char;
    if (line && measure(ctx, next, size) > maxWidth) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  // 还有没排完的字，最后一行补省略号
  if (lines.length >= maxLines && line) {
    let last = lines[maxLines - 1];
    while (last && measure(ctx, `${last}…`, size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }

  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}

function fillRoundRect(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.setFillStyle(color);
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
}

function strokeRoundRect(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string,
): void {
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(1);
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
}

function roundRectPath(
  ctx: UniNamespace.CanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function formatExportTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
</script>

<template>
  <view class="page">
    <view v-if="loading" class="state">正在整理数据…</view>

    <view v-else-if="error" class="state">
      <view>{{ error }}</view>
      <view class="retry" @click="load">重试</view>
    </view>

    <template v-else>
      <view class="head">
        <view class="head__title">选个模板</view>
        <view class="head__sub">
          {{ kind === 'year' ? '年报' : '月报' }} · {{ posterLabel }} · 数据只在本机生成，不会上传
        </view>
      </view>

      <view class="templates">
        <view
          v-for="theme in TEMPLATES"
          :key="theme.id"
          :class="['template', templateId === theme.id ? 'template--on' : '']"
          @click="selectTemplate(theme.id)"
        >
          <view class="template__swatch" :style="{ background: theme.swatch }"></view>
          <view class="template__name">{{ theme.name }}</view>
          <view class="template__desc">{{ theme.desc }}</view>
        </view>
      </view>

      <view class="preview" :style="previewStyle">
        <!-- canvas 留在预览框下面负责画；用户看到的是它导出的图，缩放不依赖 transform -->
        <view class="poster-box" :style="canvasStyle">
          <canvas canvas-id="poster" id="poster" class="poster" :style="canvasStyle"></canvas>
        </view>
        <image v-if="previewUrl" class="preview__img" :src="previewUrl" mode="scaleToFill"></image>
        <view v-else class="preview__loading">正在生成…</view>
      </view>

      <view class="actions">
        <view class="save" :class="{ 'save--busy': saving }" @click="savePoster">
          {{ saving ? '正在生成…' : '保存图片' }}
        </view>
        <!-- #ifdef H5 -->
        <view class="tip">手机会弹出大图，长按图片即可存进相册</view>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <view class="tip">保存失败时会打开预览，长按图片也能存</view>
        <!-- #endif -->
      </view>
    </template>

    <!-- #ifdef H5 -->
    <!-- 浏览器存不进相册，弹大图让用户长按保存 -->
    <view v-if="h5PreviewUrl" class="image-sheet" @click="h5PreviewUrl = ''">
      <image class="image-sheet__img" :src="h5PreviewUrl" mode="widthFix" @click.stop />
      <view class="image-sheet__tip">长按图片 →「保存图片 / 存储到照片」</view>
      <view class="image-sheet__done" @click.stop="h5PreviewUrl = ''">完成</view>
    </view>
    <!-- #endif -->
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 28rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
  background: #fdf6e6;
}

.state {
  padding: 120rpx 24rpx;
  text-align: center;
  font-size: 26rpx;
  line-height: 1.7;
  color: #a08a5f;
}

.retry {
  display: inline-block;
  margin-top: 20rpx;
  padding: 14rpx 40rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #ffffff;
  font-size: 26rpx;
}

.head {
  padding: 0 4rpx 18rpx;
}

.head__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #3a2b16;
}

.head__sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #a08a5f;
}

.templates {
  display: flex;
  gap: 14rpx;
}

.template {
  flex: 1;
  min-width: 0;
  padding: 14rpx;
  box-sizing: border-box;
  background: #fffdf8;
  border: 2rpx solid #f0e3c8;
  border-radius: 20rpx;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.template--on {
  border-color: #9a6514;
  background: #fffaf0;
  box-shadow: 0 6rpx 18rpx rgba(154, 101, 20, 0.12);
}

.template__swatch {
  height: 56rpx;
  border-radius: 12rpx;
}

.template__name {
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #3a2b16;
}

.template__desc {
  margin-top: 2rpx;
  font-size: 19rpx;
  color: #a08a5f;
}

.preview {
  position: relative;
  margin: 24rpx auto;
  overflow: hidden;
  border-radius: 24rpx;
  background: #fffdf8;
  box-shadow: 0 12rpx 40rpx rgba(96, 72, 30, 0.16);
}

.poster-box {
  position: absolute;
  top: 0;
  left: 0;
  width: 750px;
  height: 1000px;
}

.poster {
  display: block;
  width: 750px;
  height: 1000px;
}

.preview__img {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.preview__loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fffdf8;
  font-size: 24rpx;
  color: #a08a5f;
}

.actions {
  padding: 8rpx 4rpx 0;
}

.save {
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #ffffff;
  text-align: center;
  font-size: 30rpx;
  box-shadow: 0 12rpx 28rpx rgba(58, 43, 22, 0.2);
}

.save--busy {
  background: #8c7a5e;
}

.tip {
  margin-top: 16rpx;
  text-align: center;
  font-size: 21rpx;
  line-height: 1.6;
  color: #a08a5f;
}

/* H5 保存后的大图：长按存相册 */
.image-sheet {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 48rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  background: rgba(20, 14, 6, 0.88);
}

.image-sheet__img {
  width: 100%;
  border-radius: 12rpx;
}

.image-sheet__tip {
  margin-top: 28rpx;
  text-align: center;
  font-size: 24rpx;
  line-height: 1.6;
  color: #f5e6c4;
}

.image-sheet__done {
  margin-top: 24rpx;
  padding: 16rpx 64rpx;
  border-radius: 999rpx;
  background: #f2c96a;
  color: #3a2b16;
  font-size: 27rpx;
  font-weight: 600;
}
</style>
