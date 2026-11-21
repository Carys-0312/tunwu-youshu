<script setup lang="ts">
/**
 * 新用户功能引导：遮罩挖洞，高亮具体控件，便签卡在目标的反方向浮起。
 * 每个 tab 页都挂一份，状态在 services/feature-tour.ts 里共享。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, watch } from 'vue';
import {
  featureTour,
  nextFeatureTour,
  skipFeatureTour,
  type FeatureTourStep,
  type FeatureTourTab,
} from '@/services/feature-tour';

const props = defineProps<{ current: FeatureTourTab }>();

const TABBAR_HEIGHT = 64;
const CARD_GAP = 20;
const CARD_ESTIMATED_HEIGHT = 310;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const activeStep = computed<FeatureTourStep | null>(() => {
  if (!featureTour.visible) return null;
  const step = featureTour.steps[featureTour.step];
  return step && step.tab === props.current ? step : null;
});

const isLast = computed(
  () => featureTour.steps.length > 0 && featureTour.step >= featureTour.steps.length - 1,
);
const progress = computed(() =>
  featureTour.steps.length ? ((featureTour.step + 1) / featureTour.steps.length) * 100 : 0,
);
const stepMark = computed(() => String(featureTour.step + 1).padStart(2, '0'));
const compact = computed(() => viewport.height < 720);

const viewport = reactive({
  width: 375,
  height: 667,
  topOffset: 0,
  safeBottom: 0,
  tabbarTop: 603,
});

const layout = reactive({
  spotLeft: 0,
  spotTop: 0,
  spotWidth: 0,
  spotHeight: 0,
  cardLeft: 16,
  cardWidth: 343,
  cardTop: 58,
  cardBottom: 92,
  placement: 'bottom' as 'top' | 'bottom',
  caretX: 170,
});

const spotStyle = computed(() => ({
  left: `${layout.spotLeft}px`,
  top: `${layout.spotTop}px`,
  width: `${layout.spotWidth}px`,
  height: `${layout.spotHeight}px`,
}));

const cardStyle = computed(() => {
  const style: Record<string, string> = {
    left: `${layout.cardLeft}px`,
    width: `${layout.cardWidth}px`,
  };
  if (layout.placement === 'top') style.top = `${layout.cardTop}px`;
  else style.bottom = `${layout.cardBottom}px`;
  return style;
});

function readViewport(): void {
  const info = uni.getSystemInfoSync();
  viewport.width = info.windowWidth || 375;
  viewport.safeBottom = info.safeAreaInsets?.bottom ?? 0;

  let topOffset = 0;
  let height = info.windowHeight || 667;
  // H5 的 windowHeight 不含顶部导航栏，而 fixed 定位相对整个浏览器视口
  // #ifdef H5
  topOffset = info.windowTop || 0;
  height += topOffset + (info.windowBottom || 0);
  // #endif

  viewport.topOffset = topOffset;
  viewport.height = height;
  viewport.tabbarTop = height - viewport.safeBottom - TABBAR_HEIGHT;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryRect(selector: string): Promise<Rect | null> {
  return new Promise((resolve) => {
    uni
      .createSelectorQuery()
      .select(selector)
      .boundingClientRect((data) => {
        const rect = (Array.isArray(data) ? data[0] : data) as Rect | null;
        resolve(rect && rect.width > 0 && rect.height > 0 ? rect : null);
      })
      .exec();
  });
}

function scrollTo(selector: string): Promise<void> {
  return new Promise((resolve) => {
    uni.pageScrollTo({
      selector,
      duration: 280,
      success: () => setTimeout(resolve, 340),
      fail: () => setTimeout(resolve, 80),
    });
  });
}

async function locate(step: FeatureTourStep): Promise<Rect | null> {
  let scrolled = false;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    for (const selector of step.selectors) {
      const rect = await queryRect(selector);
      if (!rect) continue;
      const top = rect.top + viewport.topOffset;
      const bottom = top + rect.height;
      const offscreen = top < viewport.topOffset || bottom > viewport.height - viewport.safeBottom;

      if (step.scroll && !scrolled && offscreen) {
        await scrollTo(selector);
        scrolled = true;
        break;
      }
      return { left: rect.left, top, width: rect.width, height: rect.height };
    }
    await delay(160);
  }
  return null;
}

function fallbackRect(): Rect {
  const index = ['items', 'dashboard', 'report', 'profile'].indexOf(props.current);
  if (index < 0) {
    // 详情页 / 分类页没有 tabBar：给页面中部一个安全的高亮区域
    return {
      left: 16,
      top: viewport.topOffset + 90,
      width: Math.max(120, viewport.width - 32),
      height: 120,
    };
  }
  const column = viewport.width / 4;
  return {
    left: index * column,
    top: viewport.tabbarTop,
    width: column,
    height: TABBAR_HEIGHT,
  };
}

function applyTarget(target: Rect): void {
  const pad = 8;
  const left = Math.max(6, target.left - pad);
  const top = Math.max(viewport.topOffset + 4, target.top - pad);
  const right = Math.min(viewport.width - 6, target.left + target.width + pad);
  const bottom = Math.min(viewport.height - viewport.safeBottom - 4, target.top + target.height + pad);

  layout.spotLeft = left;
  layout.spotTop = top;
  layout.spotWidth = Math.max(44, right - left);
  layout.spotHeight = Math.max(44, bottom - top);

  layout.cardWidth = Math.min(viewport.width - 32, 460);
  layout.cardLeft = (viewport.width - layout.cardWidth) / 2;
  layout.cardTop = viewport.topOffset + CARD_GAP;
  layout.cardBottom = TABBAR_HEIGHT + viewport.safeBottom + CARD_GAP;

  const spotBottom = layout.spotTop + layout.spotHeight;
  const spaceBelow = viewport.tabbarTop - spotBottom - CARD_GAP;
  const spaceAbove = layout.spotTop - viewport.topOffset - CARD_GAP;
  const estimated = viewport.height < 720 ? 290 : CARD_ESTIMATED_HEIGHT;

  if (spaceBelow >= estimated) layout.placement = 'bottom';
  else if (spaceAbove >= estimated) layout.placement = 'top';
  else layout.placement = spaceAbove > spaceBelow ? 'top' : 'bottom';

  const center = layout.spotLeft + layout.spotWidth / 2;
  layout.caretX = Math.max(22, Math.min(layout.cardWidth - 22, center - layout.cardLeft));
}

let runId = 0;

async function refresh(): Promise<void> {
  const step = activeStep.value;
  if (!step) return;
  const currentRun = ++runId;

  readViewport();
  await nextTick();
  const target = await locate(step);
  if (currentRun !== runId || activeStep.value !== step) return;

  applyTarget(target ?? fallbackRect());
}

watch(activeStep, (step) => {
  if (step) void refresh();
});

function onResize(): void {
  void refresh();
}

onMounted(() => {
  void refresh();
  uni.onWindowResize(onResize);
});

onUnmounted(() => {
  uni.offWindowResize(onResize);
});
</script>

<template>
  <view v-if="activeStep" class="tour" @touchmove.stop.prevent>
    <view class="tour__blocker" @click.stop @touchmove.stop.prevent></view>
    <view class="tour__spot" :style="spotStyle"></view>

    <view
      :key="featureTour.step"
      :class="[
        'tour__card',
        layout.placement === 'top' ? 'tour__card--top' : 'tour__card--bottom',
        compact ? 'tour__card--compact' : '',
      ]"
      :style="cardStyle"
    >
      <view
        :class="['tour__caret', layout.placement === 'top' ? 'tour__caret--down' : 'tour__caret--up']"
        :style="{ left: `${layout.caretX}px` }"
      ></view>

      <text class="tour__step-mark">{{ stepMark }}</text>
      <image class="tour__sticker" src="/static/icons/icon-96.png" mode="aspectFill" />

      <view class="tour__head">
        <view class="tour__meta">
          <text class="tour__eyebrow">小囤 · 功能引导</text>
          <text class="tour__count">第 {{ featureTour.step + 1 }} 步 / {{ featureTour.steps.length }}</text>
        </view>
      </view>

      <view class="tour__progress">
        <view class="tour__progress-track"></view>
        <view class="tour__progress-fill" :style="{ width: `${progress}%` }"></view>
        <view class="tour__progress-bead" :style="{ left: `${progress}%` }"></view>
      </view>

      <text class="tour__title">{{ activeStep.title }}</text>
      <view class="tour__title-mark"></view>
      <text class="tour__desc">{{ activeStep.desc }}</text>

      <view v-if="activeStep.hint" class="tour__hint">
        <text class="tour__hint-label">小贴士</text>
        <text class="tour__hint-text">{{ activeStep.hint }}</text>
      </view>

      <view class="tour__actions">
        <text class="tour__skip" @click.stop="skipFeatureTour">跳过引导</text>
        <view class="tour__next" hover-class="tour__next--tap" @click.stop="nextFeatureTour">
          <text>{{ isLast ? '开始使用' : '下一步' }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.tour {
  position: fixed;
  inset: 0;
  z-index: 3000;
  pointer-events: none;
}

.tour__blocker {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: auto;
  background: transparent;
}

.tour__spot {
  position: absolute;
  z-index: 2;
  border-radius: 20px;
  border: 2px dashed rgba(242, 201, 106, 0.95);
  pointer-events: none;
  box-shadow:
    0 0 0 120vmax rgba(48, 35, 18, 0.64),
    0 0 0 6px rgba(242, 201, 106, 0.1),
    0 0 30px 10px rgba(242, 201, 106, 0.38);
  transition:
    left 0.28s cubic-bezier(0.34, 1.2, 0.64, 1),
    top 0.28s cubic-bezier(0.34, 1.2, 0.64, 1),
    width 0.28s ease,
    height 0.28s ease;
  animation: spot-breathe 2.4s ease-in-out infinite;
}

.tour__card {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  padding: 20px 18px 16px;
  border-radius: 22px;
  border: 1px solid rgba(154, 101, 20, 0.16);
  background:
    radial-gradient(circle at 18% 10%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 38%),
    radial-gradient(120% 80% at 100% 0%, rgba(242, 201, 106, 0.2), rgba(242, 201, 106, 0) 62%),
    linear-gradient(180deg, #fffdf8 0%, #fff7e6 100%);
  box-shadow:
    0 22px 55px rgba(58, 43, 22, 0.26),
    0 2px 0 rgba(255, 255, 255, 0.8) inset;
  pointer-events: auto;
}

/* 底下垫着的一张旧纸，让便签有叠放的手感 */
.tour__card::before {
  content: '';
  position: absolute;
  left: 9px;
  right: -7px;
  top: 7px;
  bottom: -8px;
  z-index: -1;
  border-radius: 22px;
  background: #f2dfb8;
  opacity: 0.72;
  transform: rotate(0.9deg);
  box-shadow: 0 12px 28px rgba(58, 43, 22, 0.16);
}

.tour__card--top {
  animation: card-in-top 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.tour__card--bottom {
  animation: card-in-bottom 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 矮屏收一档，别让便签盖住被高亮的控件 */
.tour__card--compact {
  padding: 16px 15px 13px;
}

.tour__card--compact .tour__sticker {
  top: -13px;
  left: 16px;
  width: 48px;
  height: 48px;
  border-width: 2px;
}

.tour__card--compact .tour__head {
  min-height: 36px;
  padding-left: 54px;
}

.tour__card--compact .tour__eyebrow {
  font-size: 12px;
}

.tour__card--compact .tour__count {
  font-size: 10px;
}

.tour__card--compact .tour__progress {
  margin-top: 8px;
}

.tour__card--compact .tour__title {
  margin-top: 9px;
  font-size: 19px;
}

.tour__card--compact .tour__desc {
  margin-top: 7px;
  font-size: 13.5px;
  line-height: 1.55;
}

.tour__card--compact .tour__hint {
  margin-top: 9px;
  padding: 5px 2px;
}

.tour__card--compact .tour__hint-text {
  font-size: 12px;
  line-height: 1.55;
}

.tour__card--compact .tour__actions {
  margin-top: 10px;
}

.tour__card--compact .tour__next {
  min-width: 104px;
  padding: 9px 18px;
  font-size: 14px;
}

.tour__card--compact .tour__step-mark {
  top: 2px;
  font-size: 40px;
}

/* 指向目标的小三角：卡片在下方时朝上，卡片在上方时朝下 */
.tour__caret {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  background: #fff7e6;
  transform: translateX(-50%) rotate(45deg);
}

.tour__caret--up {
  top: -7px;
  border-left: 1px solid rgba(154, 101, 20, 0.16);
  border-top: 1px solid rgba(154, 101, 20, 0.16);
}

.tour__caret--down {
  bottom: -7px;
  border-right: 1px solid rgba(154, 101, 20, 0.16);
  border-bottom: 1px solid rgba(154, 101, 20, 0.16);
}

/* 右上角的步骤数字水印 */
.tour__step-mark {
  position: absolute;
  top: 4px;
  right: 16px;
  font-size: 48px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: rgba(154, 101, 20, 0.09);
  pointer-events: none;
}

/* 小囤从便签左上角探出头 */
.tour__sticker {
  position: absolute;
  top: -16px;
  left: 18px;
  width: 56px;
  height: 56px;
  border-radius: 18px;
  border: 3px solid #fffdf8;
  background: #fff3d6;
  box-shadow: 0 7px 16px rgba(58, 43, 22, 0.2);
  transform: rotate(-6deg);
}

.tour__head {
  display: flex;
  align-items: center;
  min-height: 42px;
  padding-left: 62px;
}

.tour__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.tour__eyebrow {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #9a6514;
}

.tour__count {
  font-size: 11px;
  color: #a08a5f;
}

/* 缝线进度：虚线轨道 + 一颗会跟着走的蜜色小珠 */
.tour__progress {
  position: relative;
  height: 10px;
  margin-top: 10px;
}

.tour__progress-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 3px;
  bottom: 3px;
  border-radius: 999px;
  background: repeating-linear-gradient(
    90deg,
    rgba(154, 101, 20, 0.22) 0 5px,
    transparent 5px 9px
  );
}

.tour__progress-fill {
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, #e7bd68, #9a6514);
  transition: width 0.28s ease;
}

.tour__progress-bead {
  position: absolute;
  top: 0;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #b47a1d;
  border: 2px solid #fff7e6;
  box-shadow: 0 2px 6px rgba(154, 101, 20, 0.35);
  transition: left 0.28s ease;
}

.tour__title {
  display: block;
  margin-top: 12px;
  font-size: 22px;
  line-height: 1.28;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #3a2b16;
}

/* 标题下的一笔手绘强调线 */
.tour__title-mark {
  width: 46px;
  height: 5px;
  margin: 3px 0 0 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, #f2c96a, #d99b32);
  opacity: 0.55;
  transform: rotate(-1.2deg);
}

.tour__desc {
  display: block;
  margin-top: 9px;
  font-size: 14.5px;
  line-height: 1.65;
  color: #5c472a;
}

/* 小贴士做成荧光笔划过的一条，不再是普通灰框 */
.tour__hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 7px 2px;
  background: linear-gradient(
    180deg,
    transparent 12%,
    rgba(242, 201, 106, 0.26) 12%,
    rgba(242, 201, 106, 0.26) 92%,
    transparent 92%
  );
}

.tour__hint-label {
  flex: none;
  margin-top: 1px;
  padding: 2px 6px 3px;
  border-radius: 6px;
  background: #9a6514;
  color: #fff7e6;
  font-size: 10px;
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.tour__hint-text {
  font-size: 12.5px;
  line-height: 1.65;
  color: #6b5432;
}

.tour__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.tour__skip {
  padding: 8px 2px 6px;
  border-bottom: 1px dashed rgba(160, 138, 95, 0.5);
  font-size: 13px;
  color: #a08a5f;
}

.tour__next {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 112px;
  padding: 11px 22px;
  border-radius: 999px;
  background: linear-gradient(135deg, #b47a1d 0%, #9a6514 100%);
  box-shadow:
    0 8px 18px rgba(154, 101, 20, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.28) inset;
  color: #fffaf0;
  font-size: 15px;
  font-weight: 600;
  transition: transform 0.16s ease;
}

.tour__next--tap {
  transform: scale(0.96);
}

@keyframes card-in-top {
  from {
    opacity: 0;
    transform: translateY(-10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes card-in-bottom {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes spot-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 120vmax rgba(48, 35, 18, 0.64),
      0 0 0 6px rgba(242, 201, 106, 0.1),
      0 0 30px 10px rgba(242, 201, 106, 0.38);
  }
  50% {
    box-shadow:
      0 0 0 120vmax rgba(48, 35, 18, 0.64),
      0 0 0 6px rgba(242, 201, 106, 0.16),
      0 0 36px 14px rgba(242, 201, 106, 0.52);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tour__spot,
  .tour__card {
    animation: none;
    transition: none;
  }
}
</style>
