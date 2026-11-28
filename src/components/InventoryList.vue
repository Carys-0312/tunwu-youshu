<script setup lang="ts">
/**
 * 物品列表：库存页的搜索结果和种类详情页共用。
 *
 * 用掉、撤销、用完问补货、点行看详情都在这里，页面只负责给数据。
 * rows 为空时由父级通过 empty 插槽决定显示什么（种类目录或空状态），
 * 组件本身不卸载，撤销条才不会因为列表变空而消失。
 */
import { ref } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useConsumeUndo } from '@/composables/useConsumeUndo';
import type { ConsumeResult } from '@/db/repo';
import type { InventoryRow } from '@/types/models';
import { displayCategory } from '@/constants/categories';
import { describeDays } from '@/utils/date';
import { itemEmoji } from '@/utils/item-visual';

withDefaults(
  defineProps<{
    rows: InventoryRow[];
    /** 种类详情页里已经知道种类了，副标题不用再重复 */
    showCategory?: boolean;
    /** tab 页要避开底部 tabBar */
    tabbarOffset?: boolean;
  }>(),
  { showCategory: true, tabbarOffset: false },
);

const store = useInventoryStore();
const busyId = ref('');
/** 图片地址失效（H5 刷新后旧的 blob: 地址会作废）时退回 emoji */
const brokenImages = ref<Record<string, true>>({});
const { undoState, startUndo, undo } = useConsumeUndo();

/* ---------------- 左滑删除 ---------------- */
/** 滑开后露出的删除按钮宽度（px） */
const ACTION_PX = uni.upx2px(120);
/** 当前滑开的行 */
const openId = ref('');
/** 正在拖动的手指属于哪一行，以及当前位移 */
const dragId = ref('');
const dragX = ref(0);
let startX = 0;
let startY = 0;
let startOffset = 0;
let horizontalDrag = false;
/** 滑完手指抬起后浏览器还会补一个 click，先压住，别顺手进了详情 */
let suppressClickUntil = 0;

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

function onTouchStart(row: InventoryRow, event: TouchEvent): void {
  const touch = event.touches[0];
  if (!touch) return;
  dragId.value = row.item.id;
  startX = touch.clientX;
  startY = touch.clientY;
  startOffset = openId.value === row.item.id ? -ACTION_PX : 0;
  dragX.value = startOffset;
  horizontalDrag = false;
}

function onTouchMove(row: InventoryRow, event: TouchEvent): void {
  if (dragId.value !== row.item.id) return;
  const touch = event.touches[0];
  if (!touch) return;
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (!horizontalDrag) {
    if (Math.abs(dx) < 6) return;
    // 竖直方向为主：交还给页面滚动，不当成滑动删除
    if (Math.abs(dx) <= Math.abs(dy)) {
      dragId.value = '';
      return;
    }
    horizontalDrag = true;
    if (openId.value && openId.value !== row.item.id) openId.value = '';
  }
  dragX.value = Math.min(0, Math.max(-ACTION_PX, startOffset + dx));
}

function onTouchEnd(row: InventoryRow): void {
  if (dragId.value !== row.item.id) return;
  openId.value = dragX.value < -ACTION_PX / 2 ? row.item.id : '';
  if (horizontalDrag) suppressClickUntil = Date.now() + 300;
  dragId.value = '';
  dragX.value = 0;
}

/** 行的位移：拖着的行跟手，松手后滑到位，其余行为 0 */
function rowStyle(row: InventoryRow): Record<string, string> {
  const dragging = dragId.value === row.item.id;
  const offset = dragging ? dragX.value : openId.value === row.item.id ? -ACTION_PX : 0;
  if (!offset) return {};
  return {
    transform: `translateX(${offset}px)`,
    transition: dragging ? 'none' : 'transform 0.2s ease',
  };
}

function onRowClick(row: InventoryRow): void {
  if (Date.now() < suppressClickUntil) return;
  // 已经滑开时，点这一行先收回去，不进详情
  if (openId.value === row.item.id) {
    openId.value = '';
    return;
  }
  openDetail(row);
}

async function askDelete(row: InventoryRow): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '删除这件物品？',
      content: `「${row.item.name}」的批次、消耗记录和相关提醒会一起删除，无法恢复。`,
      confirmText: '删除',
      confirmColor: '#b23a2f',
      cancelText: '取消',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
  if (!confirmed) return;
  try {
    await store.deleteItem(row.item.id);
    openId.value = '';
    toast('已删除');
  } catch (err) {
    toast(err instanceof Error ? err.message : '删除失败');
  }
}

function expiryClass(row: InventoryRow): string {
  if (row.item.quantity <= 0) return 'tag--plain';
  if (row.daysLeft === null) return 'tag--plain';
  if (row.daysLeft < 0) return 'tag--danger';
  if (row.daysLeft <= 7) return 'tag--warn';
  return 'tag--plain';
}

function expiryText(row: InventoryRow): string {
  if (row.item.quantity <= 0) return '已用完';
  if (row.daysLeft === null) return '无保质期';
  return describeDays(row.daysLeft);
}

function askRestock(result: ConsumeResult, row: InventoryRow): Promise<void> {
  return new Promise<void>((resolve) => {
    uni.showModal({
      title: '用完了',
      content: `「${result.name}」数量已归零，要加入待购吗？`,
      confirmText: '加入待购',
      cancelText: '不用了',
      success: (res) => {
        if (!res.confirm) {
          resolve();
          return;
        }
        store
          .addToShopping(row)
          .then(() => toast('已加入待购'))
          .catch(() => toast('加入待购失败'))
          .finally(() => resolve());
      },
      fail: () => resolve(),
    });
  });
}

async function consumeOne(row: InventoryRow): Promise<void> {
  if (busyId.value) return;
  busyId.value = row.item.id;
  try {
    const result = await store.consume(row.item.id, 1);
    startUndo(result);

    if (result.remaining === 0) {
      if (result.restockPending) toast('已用完，已在待购清单');
      else await askRestock(result, row);
    } else if (result.restockId) {
      toast(`还剩 ${result.remaining}${result.unit} · 已加入待购`);
    } else {
      toast(`还剩 ${result.remaining}${result.unit}`);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '用掉失败');
  } finally {
    busyId.value = '';
  }
}

function openDetail(row: InventoryRow): void {
  uni.navigateTo({ url: `/pages/item-detail/index?id=${encodeURIComponent(row.item.id)}` });
}
</script>

<template>
  <view v-if="rows.length" class="list">
    <view v-for="row in rows" :key="row.item.id" class="swipe">
      <!-- 向左滑动后露在右侧的删除按钮 -->
      <view class="swipe__action" @click.stop="askDelete(row)">删除</view>
      <view
        class="row"
        :style="rowStyle(row)"
        @click="onRowClick(row)"
        @touchstart="onTouchStart(row, $event)"
        @touchmove="onTouchMove(row, $event)"
        @touchend="onTouchEnd(row)"
      >
        <view class="row__thumb">
          <image
            v-if="row.item.image && !brokenImages[row.item.id]"
            class="row__img"
            :src="row.item.image"
            mode="aspectFill"
            @error="brokenImages[row.item.id] = true"
          />
          <view v-else class="row__img row__img--empty">
            {{ itemEmoji(row.item.name, displayCategory(row.item)) }}
          </view>
        </view>
        <view class="row__main">
          <view class="row__name">{{ row.item.name }}</view>
          <view class="row__sub">
            <text v-if="showCategory">{{ displayCategory(row.item) }} · </text>{{ row.item.quantity }}
            {{ row.item.unit }}
            <text v-if="row.item.is_shared"> · 公用</text>
            <text v-if="row.item.storage_text"> · {{ row.item.storage_text }}</text>
          </view>
        </view>
        <view class="row__side">
          <view class="row__tags">
            <view :class="['tag', expiryClass(row)]">{{ expiryText(row) }}</view>
            <view v-if="row.isLowStock" class="tag tag--danger row__badge">库存低</view>
          </view>
          <view
            v-if="row.item.quantity > 0"
            :class="['consume', busyId === row.item.id ? 'consume--busy' : '']"
            @click.stop="consumeOne(row)"
          >
            用掉 1
          </view>
        </view>
      </view>
    </view>
  </view>

  <template v-else>
    <slot name="empty"></slot>
  </template>

  <view v-if="undoState" :class="['undo-bar', tabbarOffset ? 'undo-bar--tab' : '']">
    <text class="undo-bar__text">
      已用掉 {{ undoState.amount }}{{ undoState.unit }} · {{ undoState.name }}
    </text>
    <text class="undo-bar__btn" @click="undo">撤销</text>
  </view>
</template>

<style scoped>
.list {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 0 28rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

/* 左滑删除：底色压在下面，行内容向左让开 */
.swipe {
  position: relative;
  overflow: hidden;
}

/* 行高统一后，红色删除块铺满整行，每一条都一样高 */
.swipe__action {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120rpx;
  background: #b23a2f;
  color: #ffffff;
  font-size: 26rpx;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  /* 固定行高：不管有没有「库存低」「用掉 1」，滑出来的删除块都同样大 */
  min-height: 164rpx;
  padding: 28rpx 0;
  border-bottom: 1rpx solid #f0e4ca;
  background: #ffffff;
  /* H5：横向手势留给删除，纵向交给页面滚动 */
  touch-action: pan-y;
}

.swipe:last-child .row {
  border-bottom: none;
}

.row__thumb {
  flex-shrink: 0;
  margin-right: 20rpx;
}

.row__img {
  width: 88rpx;
  height: 88rpx;
  border-radius: 18rpx;
  display: block;
}

/* 没实拍图时用 emoji 占位，和实拍图同一尺寸，列表对齐 */
.row__img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 46rpx;
  line-height: 1;
  background: #f6ecd5;
}

.row__main {
  flex: 1;
  min-width: 0;
  padding-right: 20rpx;
}

.row__name {
  font-size: 30rpx;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #826b47;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

/* 到期和「库存低」并排，侧栏不再多占一行，行高才能统一 */
.row__tags {
  display: flex;
  align-items: center;
}

.row__badge {
  margin-left: 8rpx;
}

.consume {
  margin-top: 12rpx;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: #f6ecd5;
  color: #9a6514;
  font-size: 24rpx;
  line-height: 1.4;
}

.consume--busy {
  opacity: 0.4;
}

.undo-bar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  bottom: calc(40rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #3a2b16;
  border-radius: 20rpx;
  padding: 22rpx 28rpx;
  box-shadow: 0 12rpx 28rpx rgba(58, 43, 22, 0.22);
  z-index: 20;
}

.undo-bar--tab {
  bottom: 140rpx;
}

.undo-bar__text {
  flex: 1;
  min-width: 0;
  color: rgba(255, 255, 255, 0.85);
  font-size: 25rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.undo-bar__btn {
  margin-left: 20rpx;
  color: #f2c96a;
  font-size: 26rpx;
  font-weight: 600;
  flex-shrink: 0;
}
</style>
