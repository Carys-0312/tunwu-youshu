<script setup lang="ts">
/**
 * 「管家」tab：整页就是问答。
 * 库存列表在「库存」tab，这一页只留对话、输入框和右下角的拍照加号。
 */
import { onShow } from '@dcloudio/uni-app';
import AssistantCompanion from '@/components/AssistantCompanion.vue';
import TabBar from '@/components/TabBar.vue';
import FeatureTour from '@/components/FeatureTour.vue';
import { featureTour, maybeStartFeatureTour } from '@/services/feature-tour';
import { maybeAskLocationConsent } from '@/services/location';

// 自定义 tabBar 负责显示，原生那条要藏掉，不然会叠在一起
onShow(() => {
  uni.hideTabBar({ animation: false });
  // 等 tabBar 渲染完再起新手引导；用户已经切走就不弹了
  setTimeout(() => {
    const pages = getCurrentPages();
    const route = pages[pages.length - 1]?.route;
    if (route === 'pages/items/index') maybeStartFeatureTour();
  }, 350);
  // 位置统计同意卡：晚于引导出现，避免两个浮层叠在一起
  setTimeout(() => {
    const pages = getCurrentPages();
    const route = pages[pages.length - 1]?.route;
    if (route === 'pages/items/index' && !featureTour.visible) void maybeAskLocationConsent();
  }, 1600);
});
</script>

<template>
  <view class="items">
    <AssistantCompanion tabbar />
    <TabBar current="items" />
    <FeatureTour current="items" />
  </view>
</template>
