<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import { useConsumeUndo } from '@/composables/useConsumeUndo';
import FeatureTour from '@/components/FeatureTour.vue';
import {
  addItemToShopping,
  loadItemDetail,
  setItemImage,
  updateBatch,
  type BatchView,
  type ItemDetail,
} from '@/db/repo';
import { chooseAndPersistImage } from '@/services/item-image';
import { describeDays, todayISO } from '@/utils/date';
import { batchShelfLifeDays, recommendedLeadDays } from '@/utils/reminder-policy';
import { itemEmoji } from '@/utils/item-visual';
import { displayCategory } from '@/constants/categories';

const store = useInventoryStore();
const itemId = ref('');
const detail = ref<ItemDetail | null>(null);
const loading = ref(true);
const busy = ref(false);
const photoBusy = ref(false);
/** 图片地址失效（H5 刷新后旧的 blob: 地址会作废）时退回占位图 */
const imageBroken = ref(false);
const hasPhoto = computed(() => !!detail.value?.item.image && !imageBroken.value);
const { undoState, startUndo, undo } = useConsumeUndo(load);

/** 开封后保质期的预设选项，0 表示只记录开封 */
const PAO_LABELS = ['只记录开封', '1 个月', '3 个月', '6 个月', '12 个月', '24 个月'];
const PAO_MONTHS = [0, 1, 3, 6, 12, 24];

onLoad((query) => {
  itemId.value = String((query as Record<string, unknown>)?.id ?? '');
});

onShow(() => {
  load().catch(() => {
    loading.value = false;
    uni.showToast({ title: '读取失败', icon: 'none' });
  });
});

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

async function load(): Promise<void> {
  await store.init();
  if (!itemId.value) {
    loading.value = false;
    return;
  }
  detail.value = await loadItemDetail(itemId.value);
  imageBroken.value = false;
  loading.value = false;
}

function confirm(title: string, content: string, confirmText: string, cancelText = '取消'): Promise<boolean> {
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

function expiryClass(batch: BatchView): string {
  if (batch.daysLeft === null) return 'tag--plain';
  if (batch.daysLeft < 0) return 'tag--danger';
  if (batch.daysLeft <= 7) return 'tag--warn';
  return 'tag--plain';
}

/** 这一批按自身保质期能推算出的默认提醒时间 */
function batchReminderText(batch: BatchView): string {
  const shelfLife = batchShelfLifeDays(batch);
  const lead = recommendedLeadDays(shelfLife);
  if (shelfLife === null || lead === null) return '';
  return `按 ${shelfLife} 天保质期，默认提前 ${lead} 天`;
}

async function consumeOne(): Promise<void> {
  const current = detail.value;
  if (!current || busy.value) return;
  busy.value = true;
  try {
    const result = await store.consume(current.item.id, 1);
    startUndo(result);
    await load();

    if (result.remaining === 0) {
      if (result.restockPending) {
        toast('已用完，已在待购清单');
      } else if (await confirm('用完了', '数量归零，要加入待购吗？', '加入待购', '不用了')) {
        await addItemToShopping(current.item.id);
        await load();
        toast('已加入待购');
      }
    } else if (result.restockId) {
      toast(`还剩 ${result.remaining}${result.unit} · 已加入待购`);
    } else {
      toast(`还剩 ${result.remaining}${result.unit}`);
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : '用掉失败');
  } finally {
    busy.value = false;
  }
}

async function addToShoppingList(): Promise<void> {
  const current = detail.value;
  if (!current) return;
  try {
    await addItemToShopping(current.item.id);
    await load();
    toast('已加入待购');
  } catch {
    toast('加入待购失败');
  }
}

/** 点照片区：拍一张或从相册选一张，换了会覆盖原来的 */
function changePhoto(): void {
  const current = detail.value;
  if (!current || photoBusy.value) return;
  uni.showActionSheet({
    itemList: current.item.image ? ['重新拍照', '从相册选一张'] : ['拍一张', '从相册选一张'],
    success: (res) => {
      void applyPhoto(res.tapIndex === 0 ? 'camera' : 'album');
    },
  });
}

async function applyPhoto(source: 'camera' | 'album'): Promise<void> {
  const current = detail.value;
  if (!current || photoBusy.value) return;
  const image = await chooseAndPersistImage(source);
  if (!image) return;
  photoBusy.value = true;
  try {
    await setItemImage(current.item.id, image);
    await load();
    // 库存页和种类页的缩略图用的也是 store.items
    await store.refresh();
    toast('照片已保存');
  } catch {
    toast('照片保存失败');
  } finally {
    photoBusy.value = false;
  }
}

function changeExpiry(batch: BatchView, e: any): void {
  const value = String(e.detail.value);
  if (!value || value === (batch.expiry_date ?? '')) return;
  updateBatch(batch.id, { expiry_date: value })
    .then(load)
    .then(() => toast('保质期已更新'))
    .catch(() => toast('保存失败'));
}

/** 记录/修改开封；months=0 表示只记录开封，不设开封后保质期 */
async function saveOpened(batch: BatchView, months: number, resetDate: boolean): Promise<void> {
  try {
    await updateBatch(batch.id, {
      opened_at: resetDate ? todayISO() : batch.opened_at,
      pao_months: months > 0 ? months : null,
    });
    await load();
    toast(months > 0 ? `已开封，按 ${months} 个月算` : '已记录开封');
  } catch {
    toast('保存失败');
  }
}

function markOpened(batch: BatchView): void {
  uni.showActionSheet({
    itemList: PAO_LABELS,
    success: (res) => {
      void saveOpened(batch, PAO_MONTHS[res.tapIndex] ?? 0, true);
    },
  });
}

/** 已经开封的行点进来：改开封后保质期，或者清掉这次开封记录 */
function editOpened(batch: BatchView): void {
  uni.showActionSheet({
    itemList: [...PAO_LABELS, '清除开封记录'],
    success: (res) => {
      if (res.tapIndex === PAO_LABELS.length) {
        clearOpened(batch);
        return;
      }
      void saveOpened(batch, PAO_MONTHS[res.tapIndex] ?? 0, false);
    },
  });
}

async function clearOpened(batch: BatchView): Promise<void> {
  try {
    await updateBatch(batch.id, { opened_at: null, pao_months: null });
    await load();
    toast('已清除开封记录');
  } catch {
    toast('保存失败');
  }
}
</script>

<template>
  <view class="page">
    <view v-if="!detail" class="hint">{{ loading ? '正在读取…' : '找不到这件物品' }}</view>

    <template v-else>
      <view class="head">
        <view class="head__row">
          <view class="head__title">
            <view class="head__name">{{ detail.item.name }}</view>
            <view class="head__meta">{{ displayCategory(detail.item) }}</view>
            <view class="head__qty">
              {{ detail.item.quantity }}<text class="head__unit">{{ detail.item.unit }}</text>
            </view>
            <view class="head__tags">
              <text v-if="detail.item.is_shared" class="tag tag--plain">公用</text>
              <text v-if="detail.item.calories" class="tag tag--plain">
                {{ detail.item.calories }} kcal / {{ detail.item.unit }}
              </text>
              <text v-if="detail.item.storage_text" class="tag tag--plain">{{ detail.item.storage_text }}</text>
              <text v-if="detail.item.threshold > 0" class="tag tag--plain">阈值 {{ detail.item.threshold }}</text>
            </view>
          </view>

          <view :class="['photo', hasPhoto ? 'photo--filled' : 'photo--empty']" @click="changePhoto">
            <image
              v-if="hasPhoto"
              class="photo__img"
              :src="detail.item.image"
              mode="aspectFill"
              @error="imageBroken = true"
            />
            <template v-else>
              <text class="photo__emoji">{{ itemEmoji(detail.item.name, displayCategory(detail.item)) }}</text>
              <text class="photo__hint">{{ photoBusy ? '保存中' : '加照片' }}</text>
            </template>
            <text v-if="hasPhoto" class="photo__badge">{{ photoBusy ? '保存中' : '更换' }}</text>
          </view>
        </view>
      </view>

      <view class="section-title">
        <text>批次与到期</text>
        <text class="muted">{{ detail.batches.length }} 批</text>
      </view>
      <view class="card">
        <view v-if="!detail.batches.length" class="hint">入库时没填日期，所以没有批次</view>
        <view v-for="batch in detail.batches" :key="batch.id" class="batch">
          <view class="batch__head">
            <text class="batch__qty">剩 {{ batch.quantity }}{{ detail.item.unit }}</text>
            <text :class="['tag', expiryClass(batch)]">
              {{ batch.daysLeft === null ? '无保质期' : describeDays(batch.daysLeft) }}
            </text>
          </view>

          <view class="batch__row tour-anchor-edit">
            <text class="batch__label">印刷到期</text>
            <picker mode="date" :value="batch.expiry_date || todayISO()" @change="changeExpiry(batch, $event)">
              <text class="batch__value">{{ batch.expiry_date ?? '未填写' }}</text>
            </picker>
          </view>

          <view v-if="batch.expiry && batch.expiry !== batch.expiry_date" class="batch__row">
            <text class="batch__label">实际到期</text>
            <text class="batch__value batch__value--real">
              {{ batch.expiry }}
              <text v-if="batch.pao_months" class="batch__note">
                · 按开封后 {{ batch.pao_months }} 个月
              </text>
            </text>
          </view>

          <view class="batch__row">
            <text class="batch__label">生产日期</text>
            <text class="batch__value">{{ batch.production_date ?? '未填写' }}</text>
          </view>

          <view v-if="batchReminderText(batch)" class="batch__row">
            <text class="batch__label">默认提醒</text>
            <text class="batch__value">{{ batchReminderText(batch) }}</text>
          </view>

          <view class="batch__row">
            <text class="batch__label">开封</text>
            <text v-if="batch.opened_at" class="batch__value batch__link" @click="editOpened(batch)">
              {{ batch.opened_at }}<text v-if="batch.pao_months"> · 开封后 {{ batch.pao_months }} 个月</text>
            </text>
            <text v-else class="batch__link" @click="markOpened(batch)">标记今天开封</text>
          </view>
        </view>
      </view>

      <view class="section-title">
        <text>最近消耗</text>
        <text class="muted">最近 10 条</text>
      </view>
      <view class="card">
        <view v-if="!detail.consumptions.length" class="hint">还没有消耗记录</view>
        <view v-for="record in detail.consumptions" :key="record.id" class="line">
          <text>用掉 {{ record.delta }} {{ detail.item.unit }}</text>
          <text class="muted">{{ record.created_at }}</text>
        </view>
      </view>

      <view class="actions">
        <view
          v-if="detail.item.quantity > 0"
          :class="['actions__btn', busy ? 'actions__btn--busy' : '']"
          @click="consumeOne"
        >
          用掉 1 {{ detail.item.unit }}
        </view>
        <view class="actions__btn actions__btn--ghost" @click="addToShoppingList">加入待购</view>
      </view>

      <view v-if="undoState" class="undo-bar">
        <text class="undo-bar__text">
          已用掉 {{ undoState.amount }}{{ undoState.unit }} · {{ undoState.name }}
        </text>
        <text class="undo-bar__btn" @click="undo">撤销</text>
      </view>
      <FeatureTour current="detail" />
    </template>
  </view>
</template>

<style>
.photo {
  position: relative;
  width: 200rpx;
  height: 230rpx;
  flex-shrink: 0;
  margin-left: 24rpx;
  border-radius: 20rpx;
  overflow: hidden;
  background: #ffffff;
}

.photo--filled {
  background: rgba(255, 255, 255, 0.14);
}

.photo--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: 2rpx dashed rgba(255, 255, 255, 0.45);
}

.photo__img {
  width: 100%;
  height: 100%;
  display: block;
}

.photo__emoji {
  font-size: 68rpx;
  line-height: 1;
}

.photo__hint {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.78);
}

.photo__badge {
  position: absolute;
  right: 10rpx;
  bottom: 10rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(0, 0, 0, 0.45);
  color: #ffffff;
  font-size: 20rpx;
}

.head {
  background: linear-gradient(135deg, #9a6514 0%, #7c4f0e 100%);
  border-radius: 28rpx;
  padding: 34rpx 32rpx;
  color: #ffffff;
  margin-bottom: 24rpx;
}

.head__row {
  display: flex;
  align-items: flex-start;
}

.head__title {
  flex: 1;
  min-width: 0;
}

.head__name {
  font-size: 38rpx;
  font-weight: 600;
  line-height: 1.3;
  word-break: normal;
  overflow-wrap: break-word;
}

.head__meta {
  margin-top: 10rpx;
  font-size: 24rpx;
  opacity: 0.8;
}

.head__qty {
  margin-top: 22rpx;
  font-size: 64rpx;
  font-weight: 600;
  line-height: 1.1;
}

.head__unit {
  margin-left: 8rpx;
  font-size: 26rpx;
  font-weight: 400;
  opacity: 0.8;
}

.head__tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 16rpx;
}

.head__tags .tag {
  margin: 0 12rpx 8rpx 0;
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

.batch {
  padding: 22rpx 0;
  border-bottom: 1rpx solid #f0e4ca;
}

.batch:last-child {
  border-bottom: none;
}

.batch__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.batch__qty {
  font-size: 28rpx;
  font-weight: 500;
}

.batch__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8rpx 0;
  font-size: 24rpx;
}

.batch__label {
  color: #826b47;
}

.batch__value {
  color: #3a2b16;
}

/* 开封后按 PAO 算出来的实际到期日，比印刷日期更值得注意 */
.batch__value--real {
  color: #9a6514;
  font-weight: 600;
}

.batch__note {
  color: #826b47;
  font-size: 22rpx;
  font-weight: 400;
}

.batch__link {
  color: #9a6514;
  text-decoration: underline;
}

.line {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  font-size: 25rpx;
  border-bottom: 1rpx solid #f0e4ca;
}

.line:last-child {
  border-bottom: none;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8rpx;
}

.actions__btn {
  flex: 1;
  min-width: 30%;
  margin: 0 8rpx 16rpx;
  padding: 26rpx 0;
  border-radius: 999rpx;
  text-align: center;
  font-size: 27rpx;
  background: #3a2b16;
  color: #ffffff;
}

.actions__btn--busy {
  opacity: 0.5;
}

.actions__btn--ghost {
  background: #ffffff;
  color: #3a2b16;
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
