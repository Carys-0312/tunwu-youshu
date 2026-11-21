<script setup lang="ts">
/**
 * 自定义底部 tabBar：原生 tabBar 没法做放大动效，这里自己画一条。
 * 四个 tab 页都会挂一份，页面 onShow 里用 uni.hideTabBar() 把原生的藏掉。
 *
 * 选中的 tab 会整体放大一点、图标再大一点，并亮一盏暖色小灯。
 */
import { computed, ref } from 'vue';

type TabKey = 'items' | 'dashboard' | 'report' | 'profile';

interface TabItem {
  key: TabKey;
  text: string;
  path: string;
  icon: string;
  activeIcon: string;
}

const props = defineProps<{ current: TabKey }>();

const TABS: TabItem[] = [
  {
    key: 'items',
    text: '管家',
    path: '/pages/items/index',
    icon: '/static/tabbar/tab-butler-lg.png',
    activeIcon: '/static/tabbar/tab-butler-lg-active.png',
  },
  {
    key: 'dashboard',
    text: '库存',
    path: '/pages/dashboard/index',
    icon: '/static/tabbar/tab-inventory-lg.png',
    activeIcon: '/static/tabbar/tab-inventory-lg-active.png',
  },
  {
    key: 'report',
    text: '月报',
    path: '/pages/report/index',
    icon: '/static/tabbar/tab-report.png',
    activeIcon: '/static/tabbar/tab-report-active.png',
  },
  {
    key: 'profile',
    text: '我的',
    path: '/pages/profile/index',
    icon: '/static/tabbar/tab-profile-lg.png',
    activeIcon: '/static/tabbar/tab-profile-lg-active.png',
  },
];

/** 点下去先在本页亮起来，再切页；新页面里的选中项会接着弹一下 */
const pressed = ref<TabKey | ''>('');
const activeKey = computed<TabKey>(() => pressed.value || props.current);

function go(tab: TabItem): void {
  if (tab.key === props.current) return;
  pressed.value = tab.key;
  setTimeout(() => {
    uni.switchTab({ url: tab.path });
    pressed.value = '';
  }, 120);
}
</script>

<template>
  <view class="tabbar">
    <view
      v-for="tab in TABS"
      :key="tab.key"
      :class="['tab', activeKey === tab.key ? 'tab--on' : '']"
      hover-class="tab--tap"
      @click="go(tab)"
    >
      <view class="tab__inner">
        <view class="tab__halo"></view>
        <image
          class="tab__icon"
          :src="activeKey === tab.key ? tab.activeIcon : tab.icon"
          mode="aspectFit"
        />
        <text class="tab__label">{{ tab.text }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  height: 64px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: content-box;
  background: rgba(255, 253, 248, 0.97);
  border-top: 1rpx solid rgba(240, 227, 200, 0.9);
  box-shadow: 0 -6rpx 24rpx rgba(96, 72, 30, 0.06);
  backdrop-filter: blur(10px);
}

.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 64px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tab__inner {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  transform: scale(1);
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tab--on .tab__inner {
  transform: translateY(-1px) scale(1.12);
  animation: tab-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tab--tap .tab__inner {
  transform: scale(0.94);
}

/* 选中时图标背后亮起的一团暖光 */
.tab__halo {
  position: absolute;
  top: 1px;
  left: 50%;
  width: 46px;
  height: 46px;
  margin-left: -23px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(242, 201, 106, 0.6) 0%, rgba(242, 201, 106, 0) 70%);
  opacity: 0;
  transform: scale(0.5);
  transition:
    opacity 0.22s ease,
    transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
}

.tab--on .tab__halo {
  opacity: 1;
  transform: scale(1);
}

.tab__icon {
  position: relative;
  width: 32px;
  height: 32px;
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tab--on .tab__icon {
  transform: scale(1.08);
}

.tab__label {
  position: relative;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.2;
  color: #a08a5f;
  transition: color 0.18s ease;
}

.tab--on .tab__label {
  color: #9a6514;
  font-weight: 700;
}

@keyframes tab-pop {
  0% {
    transform: translateY(0) scale(0.84);
  }
  55% {
    transform: translateY(-2px) scale(1.2);
  }
  100% {
    transform: translateY(-1px) scale(1.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tab__inner,
  .tab__icon,
  .tab__halo {
    transition: none;
  }

  .tab--on .tab__inner {
    animation: none;
  }
}
</style>
