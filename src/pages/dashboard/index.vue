<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import InventoryList from '@/components/InventoryList.vue';
import TabBar from '@/components/TabBar.vue';
import FeatureTour from '@/components/FeatureTour.vue';
import { useInventoryStore } from '@/stores/inventory';
import { DISPLAY_CATEGORIES, displayCategory } from '@/constants/categories';
import { ensureReminderPermissionOnce, runReminderCheck, scheduleLocalReminders } from '@/services/reminders';
import { describeDays } from '@/utils/date';
import { rememberCategoryTarget } from '@/services/category-nav';
import { categoryArt } from '@/utils/item-visual';

const store = useInventoryStore();

const lowStockItems = computed(() => store.items.filter((row) => row.isLowStock));
const pendingShoppingCount = computed(
  () => store.shopping.filter((item) => item.status === 'pending').length,
);

/** 库存浏览就在这一页：搜索时直接出物品，平时只出种类目录 */
const keyword = ref('');
const searching = computed(() => !!keyword.value.trim());

/**
 * 新入库的物资会「落」进对应分类卡：每次回到本页，对比上一次各类的件数，
 * 有增长的类就短暂挂上 --fresh，让图标弹一下。第一次进页只记基线，不放动画。
 */
const freshCategories = ref<string[]>([]);
let lastCategoryCounts: Map<string, number> | null = null;
let freshTimer: ReturnType<typeof setTimeout> | null = null;

function markFreshCategories(): void {
  const counts = new Map<string, number>();
  for (const row of store.items) {
    const key = displayCategory(row.item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (lastCategoryCounts) {
    const grown = [...counts.entries()]
      .filter(([name, count]) => count > (lastCategoryCounts?.get(name) ?? 0))
      .map(([name]) => name);
    if (grown.length) {
      freshCategories.value = grown;
      if (freshTimer) clearTimeout(freshTimer);
      freshTimer = setTimeout(() => {
        freshCategories.value = [];
        freshTimer = null;
      }, 1900);
    }
  }
  lastCategoryCounts = counts;
}

const shownItems = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return [];
  return store.items.filter((row) => {
    const haystack = `${row.item.name} ${row.item.category} ${displayCategory(row.item)} ${row.item.storage_text ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
});

interface CategoryGroup {
  name: string;
  /** 这个种类下有几件（几种）物品 */
  types: number;
  /** 总件数，按各自单位粗略相加 */
  units: number;
  /** 最近的一个到期天数，没有日期的为 null */
  nearest: number | null;
  lowCount: number;
}

const categoryGroups = computed<CategoryGroup[]>(() => {
  const map = new Map<string, typeof store.items>();
  for (const row of store.items) {
    const key = displayCategory(row.item);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }

  const rank = (name: string) => {
    const index = (DISPLAY_CATEGORIES as readonly string[]).indexOf(name);
    return index < 0 ? DISPLAY_CATEGORIES.length : index;
  };

  return [...map.entries()]
    .map(([name, rows]) => {
      const days = rows
        .map((row) => row.daysLeft)
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      return {
        name,
        types: rows.length,
        units: rows.reduce((sum, row) => sum + row.item.quantity, 0),
        nearest: days.length ? days[0] : null,
        lowCount: rows.filter((row) => row.isLowStock).length,
      };
    })
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
});

function nearestClass(days: number): string {
  if (days < 0) return 'tag--danger';
  if (days <= 7) return 'tag--warn';
  return 'tag--plain';
}

function openCategory(name: string): void {
  // 原始分类名走同进程变量，避免中文在 App 查询串里被编码后对不上
  rememberCategoryTarget(name);
  uni.navigateTo({ url: `/pages/category/index?name=${encodeURIComponent(name)}` });
}

/** 库存偏低的物品单独一页，点进去还能继续点物品看详情 */
function openLowStock(): void {
  uni.navigateTo({ url: '/pages/low-stock/index' });
}

/** 待购从一级 Tab 降为二级页，入口固定在库存页顶部 */
function openShopping(): void {
  uni.navigateTo({ url: '/pages/shopping/index' });
}

onShow(async () => {
  uni.hideTabBar({ animation: false });
  try {
    await store.init();
    markFreshCategories();
    // App 端第一次进来时申请一次通知权限，没有权限排了也弹不出来
    await ensureReminderPermissionOnce();
    // 不在提醒当天、夜间、每周额度用完时，内部会自行跳过
    void runReminderCheck(store.items);
    // 库存有增减时，未来几天的本地通知跟着重排
    void scheduleLocalReminders(store.items);
  } catch (err) {
    console.error(err);
  }
});
</script>

<template>
  <view class="page">
    <view class="content">
      <view class="section-title">
        <text>分类</text>
        <text class="muted">{{ categoryGroups.length }} 类 · {{ store.items.length }} 种</text>
      </view>

      <view class="toolbar">
        <view class="search">
          <input
            v-model="keyword"
            class="search__input"
            placeholder="搜名称、种类或储存方式"
            confirm-type="search"
          />
          <text v-if="keyword" class="search__clear" @click="keyword = ''">清空</text>
        </view>
        <view class="shopping-entry" @click="openShopping">
          <text class="shopping-entry__icon">🧺</text>
          <text class="shopping-entry__text">待购</text>
          <text v-if="pendingShoppingCount" class="shopping-entry__count">
            {{ pendingShoppingCount }}
          </text>
        </view>
      </view>

      <!-- 搜索时直接出物品，平时只出分类入口 -->
      <InventoryList v-if="searching" :rows="shownItems" tabbar-offset>
        <template #empty>
          <view class="empty">
            <view class="empty__title">没有搜到「{{ keyword.trim() }}」</view>
            <view class="empty__desc">换个关键词，或者清空搜索看全部分类</view>
          </view>
        </template>
      </InventoryList>

      <template v-else>
        <view v-if="!store.ready && store.loading" class="hint">正在读取本地数据…</view>
        <view v-else-if="!categoryGroups.length" class="empty">
          <view class="empty__title">这里还没有东西</view>
          <view class="empty__desc">
            去「管家」页点右下角 + 拍照入库，或者手动填写
          </view>
        </view>

        <view v-else class="cat-grid">
          <!-- 库存偏低单独一张，点进去是清单，再点物品看详情 -->
          <view class="cat-card cat-card--low" @click="openLowStock">
            <view class="cat-card__top">
              <image class="cat-card__icon" src="/static/art/cat-low.svg" mode="aspectFit" />
              <view v-if="lowStockItems.length" class="cat-card__flag cat-card__flag--live">
                <text>{{ lowStockItems.length }} 种该补</text>
              </view>
            </view>
            <view class="cat-card__name">库存偏低</view>
            <view v-if="!lowStockItems.length" class="cat-card__sub">都还够用</view>
            <view class="cat-card__foot">查看列表 ›</view>
          </view>

          <view
            v-for="group in categoryGroups"
            :key="group.name"
            :class="[
              'cat-card',
              freshCategories.includes(group.name) ? 'cat-card--fresh' : '',
            ]"
            @click="openCategory(group.name)"
          >
            <view class="cat-card__top">
              <image class="cat-card__icon" :src="categoryArt(group.name)" mode="aspectFit" />
              <view
                v-if="group.lowCount"
                class="cat-card__flag cat-card__flag--warn cat-card__flag--live"
              >
                <text>{{ group.lowCount }} 种该补</text>
              </view>
            </view>
            <view class="cat-card__name">{{ group.name }}</view>
            <view class="cat-card__sub">{{ group.types }} 种 · {{ group.units }} 件</view>
            <view class="cat-card__foot">
              <text v-if="group.nearest !== null" :class="['tag', nearestClass(group.nearest)]">
                {{ describeDays(group.nearest) }}
              </text>
              <text v-else class="cat-card__none">无保质期</text>
            </view>
          </view>
        </view>
      </template>
    </view>

    <TabBar current="dashboard" />
    <FeatureTour current="dashboard" />
  </view>
</template>

<style>
/* 分类区 */
.content {
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.search {
  flex: 1;
  display: flex;
  align-items: center;
  background: #ffffff;
  border-radius: 999rpx;
  padding: 0 28rpx;
}

/* 待购入口：库存页顶部按钮 */
.shopping-entry {
  display: flex;
  align-items: center;
  height: 76rpx;
  margin-left: 16rpx;
  padding: 0 24rpx;
  background: #3a2b16;
  border-radius: 999rpx;
  box-shadow: 0 6rpx 16rpx rgba(58, 43, 22, 0.16);
}

.shopping-entry__icon {
  font-size: 28rpx;
  line-height: 1;
  margin-right: 8rpx;
}

.shopping-entry__text {
  font-size: 26rpx;
  color: #ffffff;
}

.shopping-entry__count {
  min-width: 32rpx;
  height: 32rpx;
  margin-left: 10rpx;
  padding: 0 8rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  line-height: 1;
  color: #3a2b16;
  background: #f0c96a;
  border-radius: 999rpx;
}

.search__input {
  flex: 1;
  height: 76rpx;
  font-size: 26rpx;
}

.search__clear {
  margin-left: 16rpx;
  font-size: 24rpx;
  color: #826b47;
}

/* 分类卡片：两列，第一张是库存偏低 */
.cat-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.cat-card {
  width: calc(50% - 10rpx);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 220rpx;
  padding: 26rpx 26rpx 22rpx;
  margin-bottom: 20rpx;
  background: #ffffff;
  border-radius: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.cat-card--low {
  background: linear-gradient(160deg, #fdf0d0 0%, #f9e3b4 100%);
  box-shadow: inset 0 0 0 1rpx rgba(193, 135, 30, 0.3);
  animation: low-breathe 3.4s ease-in-out infinite;
}

@keyframes low-breathe {
  0%,
  100% {
    box-shadow: inset 0 0 0 1rpx rgba(193, 135, 30, 0.3), 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
  }
  50% {
    box-shadow: inset 0 0 0 2rpx rgba(193, 135, 30, 0.58), 0 14rpx 34rpx rgba(193, 135, 30, 0.3);
  }
}

.cat-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 48rpx;
}

/* 物资线稿：静静摆在卡片上，不参与跳动 */
.cat-card__icon {
  width: 72rpx;
  height: 72rpx;
}

/* 刚入库的类：卡片描一圈暖光，2.2s 后恢复 */
.cat-card--fresh {
  animation: card-glow 2.2s ease-out both;
}

@keyframes card-glow {
  0% {
    box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05), 0 0 0 2rpx rgba(240, 201, 106, 0);
  }
  28% {
    box-shadow: 0 14rpx 34rpx rgba(193, 135, 30, 0.3), 0 0 0 4rpx rgba(240, 201, 106, 0.75);
  }
  100% {
    box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05), 0 0 0 2rpx rgba(240, 201, 106, 0);
  }
}

.cat-card__flag {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  padding: 8rpx 18rpx;
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.2;
  color: #c25a50;
  background: rgba(194, 90, 80, 0.12);
  border-radius: 999rpx;
}

.cat-card__flag--warn {
  color: #8f5a08;
  background: rgba(193, 135, 30, 0.16);
}

/* 「N 种该补」便签：加大一档，用更醒目的橘红字 */
.cat-card__flag--live {
  color: #c2410c;
  background: rgba(234, 88, 12, 0.15);
  transform-origin: 50% 100%;
  animation: flag-hop 2.6s ease-in-out infinite;
}

/* 错开相位，几张卡片不会一起弹 */
.cat-card:nth-child(2n) .cat-card__flag--live {
  animation-delay: -0.7s;
}

.cat-card:nth-child(3n) .cat-card__flag--live {
  animation-delay: -1.3s;
}

@keyframes flag-hop {
  0%,
  64%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  8% {
    transform: translateY(-8rpx) rotate(-2deg);
  }
  18% {
    transform: translateY(1rpx) rotate(1.5deg);
  }
  26% {
    transform: translateY(-3rpx) rotate(0deg);
  }
}

/* 一道高光缓缓扫过标签，不做跳动，也不改变布局 */
.cat-card__flag--live::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 60%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.75), transparent);
  transform: translateX(-160%) skewX(-18deg);
  animation: flag-shine 2.8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes flag-shine {
  0%,
  55% {
    transform: translateX(-160%) skewX(-18deg);
  }
  100% {
    transform: translateX(260%) skewX(-18deg);
  }
}

.cat-card__name {
  margin-top: 16rpx;
  font-size: 32rpx;
  font-weight: 600;
  color: #3a2b16;
}

.cat-card__sub {
  margin-top: 8rpx;
  font-size: 23rpx;
  color: #826b47;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-card__foot {
  display: flex;
  align-items: center;
  margin-top: auto;
  padding-top: 18rpx;
  font-size: 22rpx;
  color: #9a8055;
}

.cat-card__none {
  font-size: 22rpx;
  color: #c2ae85;
}

/* 系统开了「减弱动态效果」就全停，页面信息不依赖动画 */
@media (prefers-reduced-motion: reduce) {
  .cat-card--low,
  .cat-card--fresh,
  .cat-card__flag--live,
  .cat-card__flag--live::after {
    animation: none !important;
  }
}

</style>
