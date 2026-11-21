<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import InventoryList from '@/components/InventoryList.vue';
import FeatureTour from '@/components/FeatureTour.vue';
import { useInventoryStore } from '@/stores/inventory';
import { displayCategory } from '@/constants/categories';
import {
  isKnownCategory,
  normalizeCategoryName,
  takeCategoryTarget,
} from '@/services/category-nav';

const store = useInventoryStore();
const category = ref('');

const rows = computed(() => {
  const name = normalizeCategoryName(category.value);
  if (!name) return [];
  return store.items.filter((row) => displayCategory(row.item) === name);
});

onLoad((query) => {
  // 从库存页点进来时，优先用同进程传过来的原始分类名；
  // 深链 / 刷新时没有这个值，再退回 URL 查询串。
  const fromPage = normalizeCategoryName(takeCategoryTarget());
  const fromQuery = normalizeCategoryName((query as Record<string, unknown>)?.name);
  category.value = fromPage || fromQuery;
  // 只有能确认是固定分类时才改标题；残留的编码串/控制字符不往导航栏上放
  if (isKnownCategory(category.value)) {
    uni.setNavigationBarTitle({ title: category.value });
  }
});

onShow(() => {
  store.init().catch(() => {
    // App.vue 已统一提示，这里只避免未处理的 rejection
  });
});
</script>

<template>
  <view class="page">
    <InventoryList :rows="rows" :show-category="false">
      <template #empty>
        <view class="empty">
          <view class="empty__title">这个种类还没有物品</view>
          <view class="empty__desc">去「管家」页点右下角 + 拍照入库，入库时选好存放种类</view>
        </view>
      </template>
    </InventoryList>
    <FeatureTour current="category" />
  </view>
</template>
