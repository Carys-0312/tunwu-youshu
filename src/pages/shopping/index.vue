<script setup lang="ts">
/**
 * 待购页：进货、采购、对账三件事放一页。
 * - 进货：低库存自动进来 + 手动添加 / 编辑 / 删除，同名不重复
 * - 采购：按品类分组，显示家里还有多少，勾选即买好
 * - 对账：买好时可选「回库 +N」，数量加回库存；已买里可撤销（回库过的会扣回去）
 */
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { loadRestockedShoppingIds } from '@/db/repo';
import type { InventoryRow, ShoppingItem } from '@/types/models';
import { CATEGORIES, DISPLAY_CATEGORIES } from '@/constants/categories';

const store = useInventoryStore();
const tab = ref<'pending' | 'done'>('pending');
const busyId = ref('');
/** 回库过的待购 id，用于「已买」里的标记和撤销提示 */
const restockedIds = ref<Set<string>>(new Set());

const pending = computed(() => store.shopping.filter((item) => item.status === 'pending'));
const done = computed(() => store.shopping.filter((item) => item.status === 'done'));

const stockByItem = computed(() => {
  const map = new Map<string, InventoryRow>();
  for (const row of store.items) map.set(row.item.id, row);
  return map;
});

interface ShoppingGroup {
  section: string;
  items: ShoppingItem[];
}

/** 按品类分组，顺序跟库存页一致，方便按货架顺序买 */
const groups = computed<ShoppingGroup[]>(() => {
  const map = new Map<string, ShoppingItem[]>();
  for (const item of pending.value) {
    const key = item.section || '其他';
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  const rank = (name: string) => {
    const index = (DISPLAY_CATEGORIES as readonly string[]).indexOf(name);
    return index < 0 ? DISPLAY_CATEGORIES.length : index;
  };
  return [...map.entries()]
    .map(([section, items]) => ({ section, items }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.section.localeCompare(b.section, 'zh-Hans-CN'));
});

function stockHint(item: ShoppingItem): string {
  if (!item.item_id) return '';
  const row = stockByItem.value.get(item.item_id);
  if (!row) return '';
  return `家里还有 ${row.item.quantity} ${row.item.unit}`;
}

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

function confirm(
  title: string,
  content: string,
  confirmText: string,
  cancelText = '取消',
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText,
      cancelText,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

async function refreshRestocked(): Promise<void> {
  try {
    restockedIds.value = await loadRestockedShoppingIds();
  } catch (err) {
    console.warn('[shopping] 读取回库记录失败', err);
  }
}

onShow(() => {
  store.init().catch(() => {});
  void refreshRestocked();
});

/** 采购时勾选：来自库存的条目问一句要不要回库，手动条目直接标记 */
async function buy(item: ShoppingItem): Promise<void> {
  if (busyId.value) return;
  let restock = false;
  const stock = item.item_id ? stockByItem.value.get(item.item_id) : undefined;
  if (stock) {
    restock = await confirm(
      '买好了？',
      `回库 +${item.qty} 件？家里现有 ${stock.item.quantity} ${stock.item.unit}`,
      '回库',
      '只标记',
    );
  }

  busyId.value = item.id;
  try {
    const result = await store.buyShopping(item.id, restock);
    if (result.restocked) {
      await refreshRestocked();
      toast(`已回库 +${result.qty}${result.unit ?? ''}`);
    } else {
      toast('已标记买好');
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '操作失败');
  } finally {
    busyId.value = '';
  }
}

/** 已买放回待购：回库过的会同时把库存扣回去 */
async function restore(item: ShoppingItem): Promise<void> {
  if (busyId.value) return;
  const reversed = restockedIds.value.has(item.id);
  const ok = await confirm(
    '放回待购？',
    reversed ? `会把它回库的 ${item.qty} 件从库存扣回去` : '之后可以再勾一次买好',
    '放回',
  );
  if (!ok) return;

  busyId.value = item.id;
  try {
    const result = await store.restoreShopping(item.id);
    await refreshRestocked();
    toast(result.reversed ? '已扣回库存，放回待购' : '已放回待购');
  } catch (err) {
    toast(err instanceof Error ? err.message : '操作失败');
  } finally {
    busyId.value = '';
  }
}

/* ---- 添加 / 编辑弹层 ---- */
const sheetOpen = ref(false);
const editingId = ref('');
const form = reactive({ name: '', qty: '1', sectionIndex: 0 });

function openAdd(): void {
  editingId.value = '';
  form.name = '';
  form.qty = '1';
  form.sectionIndex = CATEGORIES.indexOf('其他');
  sheetOpen.value = true;
}

function openEdit(item: ShoppingItem): void {
  editingId.value = item.id;
  form.name = item.name;
  form.qty = String(item.qty);
  const index = (CATEGORIES as readonly string[]).indexOf(item.section);
  form.sectionIndex = index >= 0 ? index : CATEGORIES.indexOf('其他');
  sheetOpen.value = true;
}

function closeSheet(): void {
  sheetOpen.value = false;
}

function onSectionChange(event: any): void {
  form.sectionIndex = Number(event.detail.value);
}

async function saveForm(): Promise<void> {
  const name = form.name.trim();
  if (!name) {
    toast('先写个名字');
    return;
  }
  const qty = Math.max(1, Math.trunc(Number(form.qty) || 1));
  const section = CATEGORIES[form.sectionIndex] ?? '其他';

  try {
    if (editingId.value) {
      await store.updateShopping(editingId.value, { name, qty, section });
      sheetOpen.value = false;
      toast('已保存');
    } else {
      const added = await store.addManualShopping({ name, qty, section });
      if (!added) {
        toast('待购里已经有它了');
        return;
      }
      await refreshRestocked();
      sheetOpen.value = false;
      toast('已加入待购');
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '保存失败');
  }
}

async function removeEditing(): Promise<void> {
  if (!editingId.value) return;
  const ok = await confirm('删除这条待购？', '只从清单里去掉，不改库存', '删除');
  if (!ok) return;
  try {
    await store.removeShopping(editingId.value);
    sheetOpen.value = false;
    toast('已删除');
  } catch (err) {
    toast(err instanceof Error ? err.message : '删除失败');
  }
}
</script>

<template>
  <view class="page">
    <view class="tabs">
      <view :class="['tab', tab === 'pending' ? 'tab--active' : '']" @click="tab = 'pending'">
        待购 <text class="tab__count">{{ pending.length }}</text>
      </view>
      <view :class="['tab', tab === 'done' ? 'tab--active' : '']" @click="tab = 'done'">
        已买 <text class="tab__count">{{ done.length }}</text>
      </view>
    </view>

    <template v-if="tab === 'pending'">
      <view v-if="pending.length" class="groups">
        <view v-for="group in groups" :key="group.section" class="group">
          <view class="group__title">
            <text>{{ group.section }}</text>
            <text class="muted">{{ group.items.length }}</text>
          </view>
          <view class="card list">
            <view
              v-for="item in group.items"
              :key="item.id"
              :class="['row', busyId === item.id ? 'row--busy' : '']"
            >
              <view class="check" @click.stop="buy(item)"></view>
              <view class="row__main" @click="openEdit(item)">
                <view class="row__name">{{ item.name }}</view>
                <view class="row__sub">
                  买 {{ item.qty }} 件
                  <text v-if="stockHint(item)" class="row__stock"> · {{ stockHint(item) }}</text>
                </view>
              </view>
              <text class="row__edit" @click.stop="openEdit(item)">编辑</text>
            </view>
          </view>
        </view>
      </view>

      <view v-else class="empty">
        <view class="empty__title">待购清单是空的</view>
        <view class="empty__desc">低库存会自动进来，也可以手动添加</view>
      </view>
    </template>

    <template v-else>
      <view v-if="done.length" class="card list">
        <view
          v-for="item in done"
          :key="item.id"
          :class="['row', busyId === item.id ? 'row--busy' : '']"
          @click="restore(item)"
        >
          <view class="check check--on"><text class="check__mark">✓</text></view>
          <view class="row__main">
            <view class="row__name row__name--done">{{ item.name }}</view>
            <view class="row__sub">
              {{ item.section || '未分类' }} · 买 {{ item.qty }} 件
            </view>
          </view>
          <view v-if="restockedIds.has(item.id)" class="tag tag--brand">已回库</view>
          <view v-else class="tag tag--plain">未回库</view>
        </view>
      </view>

      <view v-else class="empty">
        <view class="empty__title">还没有买好的东西</view>
        <view class="empty__desc">勾选「买好」后会出现在这里，点一下可以放回待购</view>
      </view>
    </template>

    <view v-if="tab === 'pending'" class="footer">
      <view class="footer__btn" @click="openAdd">＋ 添加待购</view>
    </view>

    <!-- 添加 / 编辑弹层 -->
    <view v-if="sheetOpen" class="sheet-mask" @click="closeSheet">
      <view class="sheet" @click.stop>
        <view class="sheet__title">{{ editingId ? '编辑待购' : '添加待购' }}</view>

        <view class="field">
          <text class="field__label">名称</text>
          <input v-model="form.name" class="field__input" placeholder="例如 抽纸" maxlength="20" />
        </view>

        <view class="field">
          <text class="field__label">数量</text>
          <input v-model="form.qty" class="field__input" type="number" placeholder="1" />
        </view>

        <view class="field">
          <text class="field__label">种类</text>
          <picker
            mode="selector"
            :range="CATEGORIES"
            :value="form.sectionIndex"
            @change="onSectionChange"
          >
            <view class="field__value">{{ CATEGORIES[form.sectionIndex] }}</view>
          </picker>
        </view>

        <view class="sheet__actions">
          <view v-if="editingId" class="sheet__btn sheet__btn--danger" @click="removeEditing">
            删除
          </view>
          <view class="sheet__btn sheet__btn--primary" @click="saveForm">
            {{ editingId ? '保存' : '添加' }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style>
.tabs {
  display: flex;
  background: #ffffff;
  border-radius: 20rpx;
  padding: 8rpx;
  margin-bottom: 24rpx;
}

.tab {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  font-size: 26rpx;
  color: #7a633f;
  border-radius: 14rpx;
}

.tab--active {
  background: #3a2b16;
  color: #ffffff;
}

.tab__count {
  margin-left: 6rpx;
  opacity: 0.7;
}

.group {
  margin-bottom: 8rpx;
}

.group__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 22rpx 8rpx 12rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: #3a2b16;
}

.group__title .muted {
  font-weight: 400;
}

.list {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}

.row {
  display: flex;
  align-items: center;
  padding: 26rpx 4rpx;
  border-bottom: 1rpx solid #f0e4ca;
}

.row:last-child {
  border-bottom: none;
}

.row--busy {
  opacity: 0.45;
}

.check {
  width: 44rpx;
  height: 44rpx;
  border: 2rpx solid #d9c9a5;
  border-radius: 50%;
  margin-right: 22rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.check--on {
  background: #9a6514;
  border-color: #9a6514;
}

.check__mark {
  color: #ffffff;
  font-size: 24rpx;
  line-height: 1;
}

.row__main {
  flex: 1;
  min-width: 0;
}

.row__name {
  font-size: 28rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__name--done {
  color: #9a8055;
  text-decoration: line-through;
}

.row__sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #826b47;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__stock {
  color: #9a6514;
}

.row__edit {
  margin-left: 16rpx;
  padding: 8rpx 4rpx 8rpx 16rpx;
  font-size: 23rpx;
  color: #9a8055;
  flex-shrink: 0;
}

/* 待购已从 Tab 降为二级页，底部不再需要给 TabBar 留位 */
.footer {
  position: fixed;
  left: 24rpx;
  right: 24rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
}

.footer__btn {
  background: #3a2b16;
  color: #ffffff;
  text-align: center;
  padding: 26rpx 0;
  border-radius: 999rpx;
  font-size: 28rpx;
  box-shadow: 0 12rpx 28rpx rgba(58, 43, 22, 0.18);
}

/* 添加 / 编辑弹层 */
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(30, 22, 10, 0.4);
  z-index: 50;
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  box-sizing: border-box;
  background: #fdf6e6;
  border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
}

.sheet__title {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 24rpx;
}

.field {
  display: flex;
  align-items: center;
  min-height: 92rpx;
  padding: 0 24rpx;
  margin-bottom: 16rpx;
  background: #ffffff;
  border-radius: 20rpx;
}

.field__label {
  width: 120rpx;
  font-size: 26rpx;
  color: #826b47;
  flex-shrink: 0;
}

.field__input {
  flex: 1;
  height: 92rpx;
  font-size: 28rpx;
}

.field__value {
  flex: 1;
  font-size: 28rpx;
  line-height: 92rpx;
  color: #3a2b16;
}

.sheet__actions {
  display: flex;
  margin-top: 28rpx;
}

.sheet__btn {
  flex: 1;
  text-align: center;
  padding: 26rpx 0;
  border-radius: 999rpx;
  font-size: 28rpx;
}

.sheet__btn--primary {
  background: #3a2b16;
  color: #ffffff;
}

.sheet__btn--danger {
  margin-right: 16rpx;
  background: #fbeae8;
  color: #b8433a;
}
</style>
