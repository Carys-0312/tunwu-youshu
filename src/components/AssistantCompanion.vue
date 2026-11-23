<script setup lang="ts">
/**
 * 管家问答主体：对话 + 输入框。
 * 3D 形象暂时从界面撤掉（组件和素材仍保留，后续想好怎么用再接回来）。
 *
 * 「管家」tab 和 /pages/assistant 深链页共用这一份，页面只负责传预置问题。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { usePersonaStore } from '@/stores/persona';
import { loadWeeklyStats, type WeeklyStats } from '@/db/repo';
import { askAssistantStream, type ChatTurn } from '@/services/assistant';
import {
  clearChatHistory,
  loadChatHistory,
  saveChatHistory,
} from '@/services/chat-history';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  state?: 'pending' | 'error';
  /** 这条回答对应的提问，重试时用 */
  question?: string;
  /** 写入本机的时间，恢复后保持原顺序 */
  at?: number;
}

const props = withDefaults(
  defineProps<{
    /** 深链带过来的问题，初始化完自动问 */
    preset?: string;
    /** 挂在 tab 页里时给底部自定义 tabBar 让出高度 */
    tabbar?: boolean;
  }>(),
  { preset: '', tabbar: false },
);

const SUGGESTIONS = ['还剩多少牛奶？', '什么快过期了？', '这周先吃什么？', '有什么该补货了？'];

const store = useInventoryStore();
const persona = usePersonaStore();
const weekly = ref<WeeklyStats>({ consumed: 0, added: 0 });
const input = ref('');
const sending = ref(false);
const bubbles = ref<Bubble[]>([]);
const scrollInto = ref('');
let seq = 0;

/**
 * 对话时页面停在用户正在看的那一行：只有本来就贴在底部时才跟着新消息走，
 * 用户往回翻看历史时不把他拽回底部。
 */
const stickBottom = ref(true);
let chatHeight = 0;

/**
 * 键盘一律不改变页面布局：不缩容器、不挪对话区、不动 tabBar，
 * 只把底部输入区整块平移到键盘上方。
 * App 端关掉系统的 adjust-position（它会把整页往上顶），
 * H5 的 viewport 用 overlays-content，网页本身不会跟着变矮。
 */
let MANUAL_KEYBOARD = false;
// #ifdef APP-PLUS
MANUAL_KEYBOARD = true;
// #endif
const keyboardHeight = ref(0);

/** 自定义 tabBar 占掉的高度（tab 页的输入区本来就在它上面） */
function tabbarOffsetPx(): number {
  if (!props.tabbar) return 0;
  const bottom = uni.getSystemInfoSync().safeAreaInsets?.bottom ?? 0;
  return 64 + bottom;
}

const dockStyle = computed(() => {
  if (keyboardHeight.value <= 0) return {};
  // 输入区本来就在 tabBar 上方，键盘高度要先减掉这一段
  const lift = Math.max(0, keyboardHeight.value - tabbarOffsetPx());
  return lift > 0 ? { transform: `translateY(-${lift}px)` } : {};
});

onMounted(async () => {
  restoreHistory();
  try {
    await store.init();
    await persona.load();
    weekly.value = await loadWeeklyStats();
  } catch (err) {
    console.error(err);
  }
  syncTitle();
  if (props.preset) send(props.preset);
});

/** 键盘高度变化：只抬起底部输入区，对话区和页面其余部分保持原样 */
function onKeyboardHeightChange(res: { height: number }): void {
  keyboardHeight.value = Math.max(0, Number(res.height) || 0);
}

/**
 * H5 的键盘不会通知高度（iOS 尤其），用 visualViewport 反推被键盘盖住的这一截。
 * viewport 用的是 interactive-widget=overlays-content，网页布局本身不变矮，
 * 所以这里算出来的就是键盘真正盖住的高度。地址栏刚收起时的几十像素不算键盘，用 140px 挡掉。
 */
function onVisualViewportResize(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  // 键盘从底边盖住的高度 = 布局视口高度 - 可视视口高度 - 可视视口被顶上去的偏移
  const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
  keyboardHeight.value = covered > 140 ? Math.min(covered, Math.round(vv.height)) : 0;
}

onMounted(() => {
  // #ifdef APP-PLUS
  uni.onKeyboardHeightChange(onKeyboardHeightChange);
  // #endif
  // #ifdef H5
  window.visualViewport?.addEventListener('resize', onVisualViewportResize);
  // #endif
  void nextTick(measureChatHeight);
});

/** 对话区可视高度：键盘只抬输入区、不改布局，量一次就够用 */
function measureChatHeight(): void {
  uni
    .createSelectorQuery()
    .select('.chat')
    .boundingClientRect((rect) => {
      const height = (rect as { height?: number } | null)?.height;
      if (typeof height === 'number' && height > 0) chatHeight = height;
    })
    .exec();
}

function onChatScroll(e: { detail?: { scrollTop?: number; scrollHeight?: number } }): void {
  const scrollTop = e.detail?.scrollTop ?? 0;
  const scrollHeight = e.detail?.scrollHeight ?? 0;
  if (!chatHeight) measureChatHeight();
  if (!chatHeight) return;
  // 相差 24px 以内都算「还贴着底部」
  stickBottom.value = scrollHeight - scrollTop - chatHeight <= 24;
}

onUnmounted(() => {
  // #ifdef APP-PLUS
  uni.offKeyboardHeightChange(onKeyboardHeightChange);
  // #endif
  // #ifdef H5
  window.visualViewport?.removeEventListener('resize', onVisualViewportResize);
  // #endif
});

// 设置页改完名字回来，标题跟着换
watch(
  () => persona.name,
  () => syncTitle(),
);

function syncTitle(): void {
  uni.setNavigationBarTitle({ title: persona.name });
}

/**
 * 贴底时才跟着新消息走；用户正在往回翻历史，就把页面留在那一行。
 * 先清空再设，保证同一条消息变高（回答替换「正在翻库存…」）也能重新滚一次。
 */
function scrollToBottom(): void {
  if (!stickBottom.value) return;
  void nextTick(() => {
    const last = bubbles.value[bubbles.value.length - 1]?.id ?? '';
    if (scrollInto.value === last) {
      scrollInto.value = '';
      void nextTick(() => {
        scrollInto.value = last;
      });
    } else {
      scrollInto.value = last;
    }
    stickBottom.value = true;
  });
}

/** 发给模型的上下文：只取这次提问之前的成功对话，刚问的这句由 question 单独传 */
function historyBefore(replyId: string, question: string): ChatTurn[] {
  const index = bubbles.value.findIndex((bubble) => bubble.id === replyId);
  const turns = bubbles.value
    .slice(0, index < 0 ? bubbles.value.length : index)
    .filter((bubble) => bubble.state === undefined)
    .map<ChatTurn>((bubble) => ({ role: bubble.role, text: bubble.text }));
  // 当前问题已经作为 prompt 发出去了，历史里再带一遍会重复
  const last = turns[turns.length - 1];
  if (last && last.role === 'user' && last.text === question) turns.pop();
  return turns.slice(-16);
}

async function askInto(question: string, replyId: string): Promise<void> {
  sending.value = true;
  let streamed = '';
  try {
    // 管家页常驻，别处（刚拍照入库、同步拉回）可能已经改过库存：
    // 每次提问前重新读一遍，否则「最近存了什么」会拿着旧快照回答没存。
    try {
      await store.refresh();
      weekly.value = await loadWeeklyStats();
    } catch (err) {
      console.error('[assistant] 刷新库存失败，用当前快照提问', err);
    }
    const answer = await askAssistantStream(
      question,
      historyBefore(replyId, question),
      store.items,
      weekly.value,
      persona.toPersona(),
      (delta) => {
        streamed += delta;
        patch(replyId, { text: streamed, state: undefined });
        scrollToBottom();
      },
    );
    patch(replyId, { text: answer, state: undefined });
    persistHistory();
  } catch (err) {
    const message = err instanceof Error ? err.message : `${persona.name}出错了，稍后再问`;
    patch(replyId, {
      text: streamed ? `${streamed}\n\n（${message}）` : message,
      state: 'error',
    });
  } finally {
    sending.value = false;
    scrollToBottom();
  }
}

/** 必须通过 bubbles.value 里的代理改，直接改 push 进去的原始对象不会触发渲染 */
function patch(id: string, next: { text: string; state?: 'pending' | 'error' }): void {
  const index = bubbles.value.findIndex((bubble) => bubble.id === id);
  if (index < 0) return;
  bubbles.value[index].text = next.text;
  bubbles.value[index].state = next.state;
}

/** 只把已完成的对话写进本机；pending / error 不落盘 */
function persistHistory(): void {
  saveChatHistory(
    bubbles.value
      .filter((bubble) => bubble.state === undefined)
      .map((bubble) => ({
        id: bubble.id,
        role: bubble.role,
        text: bubble.text,
        question: bubble.question,
        at: bubble.at ?? Date.now(),
      })),
  );
}

function seqFromId(id: string): number {
  const match = /^m(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/** 进页面时恢复最近对话；seq 接着已有的最大编号，避免新消息 id 撞车 */
function restoreHistory(): void {
  const restored = loadChatHistory();
  if (restored.length === 0) return;
  bubbles.value = restored.map((message) => ({ ...message }));
  seq = restored.reduce((max, message) => Math.max(max, seqFromId(message.id)), 0);
  void nextTick(() => scrollToBottom());
}

function clearHistory(): void {
  uni.showModal({
    title: '清空聊天记录？',
    content: '只删除这台设备上的对话，库存和其他数据不受影响。',
    confirmText: '清空',
    confirmColor: '#b8433a',
    success: (res) => {
      if (!res.confirm) return;
      clearChatHistory();
      bubbles.value = [];
      seq = 0;
      scrollInto.value = '';
      uni.showToast({ title: '已清空', icon: 'none' });
    },
  });
}

function send(preset?: string): void {
  const question = (preset ?? input.value).trim();
  if (!question || sending.value) return;
  input.value = '';
  const at = Date.now();
  const user: Bubble = { id: `m${++seq}`, role: 'user', text: question, at };
  const reply: Bubble = {
    id: `m${++seq}`,
    role: 'assistant',
    text: '正在翻库存…',
    state: 'pending',
    question,
    at,
  };
  bubbles.value.push(user, reply);
  // 用户这句先落盘：回答过程中被杀进程，至少问题还在
  persistHistory();
  scrollToBottom();
  void askInto(question, reply.id);
}

function retry(reply: Bubble): void {
  if (sending.value || !reply.question) return;
  patch(reply.id, { text: '正在翻库存…', state: 'pending' });
  scrollToBottom();
  void askInto(reply.question, reply.id);
}

/** 输入框左边的加号：拍包装入库 */
function openCapture(): void {
  uni.navigateTo({ url: '/pages/capture/index' });
}
</script>

<template>
  <view :class="['companion', props.tabbar ? 'companion--tabbar' : '']">
    <view class="ambient">
      <view class="ambient__sun"></view>
      <view class="ambient__haze"></view>
      <view class="ambient__ring ambient__ring--1"></view>
      <view class="ambient__ring ambient__ring--2"></view>
      <view class="ambient__floor"></view>
      <image class="ambient__pile" src="/static/login-pile.svg" mode="widthFix"></image>
      <view v-for="n in 7" :key="n" :class="['mote', `mote--${n}`]"></view>
    </view>

    <view class="chat-wrap">
      <scroll-view
        class="chat"
        scroll-y
        :scroll-into-view="scrollInto"
        :scroll-with-animation="true"
        @scroll="onChatScroll"
      >
        <view class="chat__inner">
          <!-- 引导区一直留在原位：发消息后对话接在它下面，页面不会整块换掉 -->
          <view class="intro">
            <view class="intro__title">问{{ persona.name }}点什么</view>
            <view class="intro__desc">库存都在你手机上，我只负责查和答。</view>
            <view class="intro__chips">
              <view v-for="item in SUGGESTIONS" :key="item" class="chip" @click="send(item)">
                {{ item }}
              </view>
            </view>
            <view v-if="bubbles.length" class="intro__clear" @click="clearHistory">
              清空聊天记录
            </view>
          </view>

          <view
            v-for="bubble in bubbles"
            :id="bubble.id"
            :key="bubble.id"
            :class="['row', bubble.role === 'user' ? 'row--user' : 'row--bot']"
          >
            <view
              :class="[
                'bubble',
                bubble.role === 'user' ? 'bubble--user' : 'bubble--bot',
                bubble.state === 'error' ? 'bubble--error' : '',
              ]"
            >
              <view v-if="bubble.state === 'pending'" class="typing">
                <view class="typing__dot"></view>
                <text>正在翻库存…</text>
              </view>
              <template v-else>
                <text class="bubble__text">{{ bubble.text }}</text>
                <text v-if="bubble.state === 'error'" class="bubble__retry" @click="retry(bubble)">
                  重试
                </text>
              </template>
            </view>
          </view>

          <view class="chat__pad"></view>
        </view>
      </scroll-view>
    </view>

    <!-- 底部操作区：跟着页面高度排，不再用固定偏移，换机型也不会悬在半空或压住 tabBar -->
    <view class="dock" :style="dockStyle">
      <!-- 拍照识图：沿用库存页原来的右下角悬浮加号 -->
      <view class="fab" @click="openCapture">+</view>

      <view class="composer">
        <input
          v-model="input"
          class="composer__input"
          :placeholder="`问问${persona.name}库存…`"
          confirm-type="send"
          :adjust-position="!MANUAL_KEYBOARD"
          @confirm="send()"
        />
        <view
          :class="['composer__send', !input.trim() || sending ? 'composer__send--off' : '']"
          @mousedown.prevent
          @click="send()"
        >
          发送
        </view>
      </view>
    </view>
  </view>
</template>

<style>
.companion {
  position: relative;
  display: flex;
  flex-direction: column;
  /* H5 的 100vh 含导航栏和 tabBar，减掉才是真正可用的高度，否则输入框会被裁掉 */
  height: calc(100vh - var(--window-top, 0px) - var(--window-bottom, 0px));
  /* 手机浏览器地址栏没收起时，100vh 是「地址栏收起后」的大高度，fixed 的 tabBar
     却贴在真实可视区底边，两者差出一截，输入框就会被 tabBar 盖住。
     dvh 跟着当前可视高度走，和 tabBar 对得上；不支持的浏览器用上面那行 */
  height: calc(100dvh - var(--window-top, 0px) - var(--window-bottom, 0px));
  box-sizing: border-box;
  overflow: hidden;
  background:
    radial-gradient(90% 44% at 18% 2%, rgba(255, 252, 242, 0.95) 0%, rgba(255, 252, 242, 0) 72%),
    radial-gradient(110% 62% at 86% -6%, rgba(255, 226, 158, 0.72) 0%, rgba(255, 226, 158, 0) 62%),
    linear-gradient(180deg, #fbf1d9 0%, #fdf6e6 48%, #f8ecd2 100%);
}

/* 原生 tabBar 被藏掉后 window-bottom 会变 0，自己减掉自定义 tabBar 的高度 */
.companion--tabbar {
  /* 和 TabBar.vue 里的高度保持一致（64px + 安全区） */
  --tabbar-h: calc(64px + env(safe-area-inset-bottom, 0px));
  height: calc(100vh - var(--window-top, 0px) - var(--window-bottom, 0px) - var(--tabbar-h));
  height: calc(100dvh - var(--window-top, 0px) - var(--window-bottom, 0px) - var(--tabbar-h));
}

/* 背景氛围层：不接收点击，只做光影和漂浮的暖色小点 */
.ambient {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

/* 右上角一团暖光，像从窗户照进来 */
.ambient__sun {
  position: absolute;
  top: -300rpx;
  right: -220rpx;
  width: 720rpx;
  height: 720rpx;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(255, 230, 166, 0.95) 0%,
    rgba(255, 228, 160, 0.38) 38%,
    rgba(255, 228, 160, 0) 68%
  );
  animation: ambient-breathe 11s ease-in-out infinite;
}

/* 左侧一团柔白，避免整页一边亮一边闷 */
.ambient__haze {
  position: absolute;
  top: 30%;
  left: -240rpx;
  width: 620rpx;
  height: 620rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0) 66%);
  animation: ambient-breathe 16s ease-in-out infinite reverse;
}

/* 两圈很淡的年轮线，给平面加一点纵深 */
.ambient__ring {
  position: absolute;
  border: 2rpx solid rgba(154, 101, 20, 0.09);
  border-radius: 50%;
}

.ambient__ring--1 {
  top: -40rpx;
  right: -300rpx;
  width: 760rpx;
  height: 760rpx;
}

.ambient__ring--2 {
  top: -140rpx;
  right: -440rpx;
  width: 1040rpx;
  height: 1040rpx;
  border-color: rgba(154, 101, 20, 0.05);
}

/* 底部暖色光，把悬浮输入框托住 */
.ambient__floor {
  position: absolute;
  left: -20%;
  right: -20%;
  bottom: -200rpx;
  height: 480rpx;
  background: radial-gradient(
    60% 100% at 50% 100%,
    rgba(240, 203, 128, 0.55) 0%,
    rgba(240, 203, 128, 0) 72%
  );
}

/* 底部露出一截货架剪影，和登录页同一套画面语言 */
.ambient__pile {
  position: absolute;
  left: 0;
  bottom: 24rpx;
  width: 100%;
  opacity: 0.18;
}

.mote {
  position: absolute;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: rgba(255, 214, 130, 0.95);
  box-shadow: 0 0 16rpx rgba(255, 198, 92, 0.55);
  opacity: 0;
  animation: ambient-drift 15s linear infinite;
}

.mote--1 {
  top: 82%;
  left: 10%;
  animation-delay: 0s;
  animation-duration: 15s;
}

.mote--2 {
  top: 74%;
  left: 24%;
  width: 7rpx;
  height: 7rpx;
  animation-delay: 2.6s;
  animation-duration: 18s;
}

.mote--3 {
  top: 88%;
  left: 38%;
  animation-delay: 5.4s;
  animation-duration: 13s;
}

.mote--4 {
  top: 78%;
  left: 55%;
  width: 8rpx;
  height: 8rpx;
  animation-delay: 1.2s;
  animation-duration: 19s;
}

.mote--5 {
  top: 86%;
  left: 70%;
  animation-delay: 7.2s;
  animation-duration: 16s;
}

.mote--6 {
  top: 72%;
  left: 84%;
  width: 6rpx;
  height: 6rpx;
  animation-delay: 3.8s;
  animation-duration: 20s;
}

.mote--7 {
  top: 64%;
  left: 46%;
  width: 6rpx;
  height: 6rpx;
  animation-delay: 9.5s;
  animation-duration: 17s;
}

@keyframes ambient-drift {
  0% {
    transform: translate3d(0, 60rpx, 0) scale(0.6);
    opacity: 0;
  }
  12% {
    opacity: 0.75;
  }
  70% {
    opacity: 0.3;
  }
  100% {
    transform: translate3d(36rpx, -620rpx, 0) scale(1.05);
    opacity: 0;
  }
}

@keyframes ambient-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ambient__sun,
  .ambient__haze,
  .mote {
    animation: none;
  }

  .mote {
    opacity: 0.35;
  }
}

.chat-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  z-index: 2;
  background: transparent;
}

.chat {
  height: 100%;
}

.chat__inner {
  padding: 40rpx 24rpx 0;
}

.chat__pad {
  /* 给右下角悬浮加号留位置，最后一条消息不会被挡住 */
  height: 150rpx;
}

.intro {
  padding: 0 8rpx 12rpx;
}

.intro__title {
  font-size: 34rpx;
  font-weight: 600;
  color: #3a2b16;
}

.intro__desc {
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: #7a633f;
}

.intro__chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 26rpx;
}

.chip {
  margin: 0 16rpx 16rpx 0;
  padding: 14rpx 24rpx;
  border-radius: 999rpx;
  background: #ffffff;
  color: #9a6514;
  font-size: 24rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.05);
}

.intro__clear {
  margin-top: 4rpx;
  padding: 12rpx 0;
  font-size: 24rpx;
  color: rgba(122, 90, 58, 0.55);
  text-decoration: underline;
}

.row {
  display: flex;
  margin-bottom: 20rpx;
}

.row--user {
  justify-content: flex-end;
}

.row--bot {
  justify-content: flex-start;
}

.bubble {
  max-width: 78%;
  padding: 20rpx 26rpx;
  border-radius: 24rpx;
  font-size: 27rpx;
  line-height: 1.6;
}

.bubble--user {
  background: #9a6514;
  color: #ffffff;
  border-bottom-right-radius: 8rpx;
}

.bubble--bot {
  background: #ffffff;
  color: #3a2b16;
  border-bottom-left-radius: 8rpx;
  box-shadow: 0 2rpx 12rpx rgba(96, 72, 30, 0.06);
}

.bubble--error {
  background: #fbeae8;
  color: #b8433a;
}

.bubble__text {
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble__retry {
  display: inline-block;
  margin-top: 12rpx;
  color: #b8433a;
  font-size: 24rpx;
  text-decoration: underline;
}

.typing {
  display: flex;
  align-items: center;
  color: #826b47;
  font-size: 26rpx;
}

.typing__dot {
  width: 14rpx;
  height: 14rpx;
  margin-right: 14rpx;
  border-radius: 50%;
  background: #9a6514;
  animation: pulse 1s infinite ease-in-out;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

/* 底部操作区：在 flex 列里占自己的高度，输入框始终贴着可视区底部，
   不再依赖写死的 bottom，换机型 / 换键盘都不会跑位 */
.dock {
  position: relative;
  z-index: 3;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 24rpx calc(20rpx + env(safe-area-inset-bottom, 0px));
}

/* tab 页的 companion 高度已经扣过自定义 tabBar（含安全区），这里不再重复加；
   底部多留一段，让整条输入框离开 tabBar 一点，不被压住 */
.companion--tabbar .dock {
  padding-bottom: 40rpx;
}

.composer {
  display: flex;
  align-items: center;
  padding-top: 20rpx;
  /* 底部淡出，避免消息从输入框下面直接透出来 */
  background: linear-gradient(180deg, rgba(253, 246, 230, 0) 0%, rgba(253, 246, 230, 0.94) 38%);
}

/* 拍照入库：右下角悬浮加号，跟着输入框一起排，和原来库存页的位置一致 */
.fab {
  position: absolute;
  right: 40rpx;
  /* 贴在输入框正上方，不管底部安全区多高都不会偏 */
  bottom: calc(100% + 10rpx);
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
  background: #3a2b16;
  color: #ffffff;
  font-size: 56rpx;
  font-weight: 300;
  line-height: 100rpx;
  text-align: center;
  box-shadow: 0 12rpx 28rpx rgba(58, 43, 22, 0.22);
  z-index: 10;
}

.composer__input {
  /* uni-app H5 的 input 自带 width:100%，压一下免得长占位文案挤掉发送按钮 */
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  height: 84rpx;
  padding: 0 28rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: #ffffff;
  font-size: 28rpx;
  box-shadow: 0 8rpx 24rpx rgba(96, 72, 30, 0.1);
}

.composer__send {
  margin-left: 16rpx;
  padding: 0 34rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 999rpx;
  background: #3a2b16;
  color: #ffffff;
  font-size: 28rpx;
  box-shadow: 0 8rpx 24rpx rgba(58, 43, 22, 0.16);
}

.composer__send--off {
  opacity: 0.35;
}
</style>
