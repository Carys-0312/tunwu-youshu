<script setup lang="ts">
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import InventoryList from '@/components/InventoryList.vue';
import { useInventoryStore } from '@/stores/inventory';

const store = useInventoryStore();

const rows = computed(() => store.items.filter((row) => row.isLowStock));
const units = computed(() => rows.value.reduce((sum, row) => sum + row.item.quantity, 0));

onShow(() => {
  store.init().catch(() => {
    // App.vue 已统一提示，这里只避免未处理的 rejection
  });
});
</script>

<template>
  <view class="page">
    <view class="head">
      <view class="head__name">库存偏低</view>
      <view class="head__meta">
        {{ rows.length ? `${rows.length} 种 · 共 ${units} 件，低于各自阈值` : '都还够用' }}
      </view>
    </view>

    <InventoryList :rows="rows">
      <template #empty>
        <view class="empty">
          <view class="empty__title">库存都还够用</view>
          <view class="empty__desc">
            数量掉到阈值的物品会出现在这里，方便一次补齐
          </view>
        </view>
      </template>
    </InventoryList>
  </view>
</template>

<style>
.head {
  padding: 8rpx 8rpx 24rpx;
}

.head__name {
  font-size: 44rpx;
  font-weight: 600;
  line-height: 1.3;
}

.head__meta {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #826b47;
}
</style>
