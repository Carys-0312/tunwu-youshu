<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { CATEGORIES, displayCategory } from '@/constants/categories';
import { RecognizeError, recognizeImages, type RecognizedItem } from '@/services/recognize';
import { persistImage } from '@/services/item-image';
import { useInventoryStore } from '@/stores/inventory';
import { describeDays, todayISO } from '@/utils/date';
import { recommendedLeadDays, shelfLifeDays } from '@/utils/reminder-policy';

const store = useInventoryStore();

/** [0] 正面，[1] 背面/日期特写；第二张可选。role 要随图一起传给服务端，模型才知道第二张是特写 */
type ShotRole = 'front' | 'back';

interface Shot {
  path: string;
  role: ShotRole;
}

const shots = ref<Shot[]>([]);
const recognizing = ref(false);
const recognized = ref(false);
const saving = ref(false);
const confidence = ref<RecognizedItem['confidence'] | null>(null);
/** 模型对日期来源的一句话说明，显示在核对提示下面 */
const dateNote = ref('');
/** P0 分类提示：模型原始分类、是否属于内置分类、选择理由 */
const categoryGuess = ref<string | null>(null);
const categoryKnown = ref(true);
const categoryReason = ref('');
/** 点过保存但日期没填全时，把缺的字段标出来 */
const missingProduction = ref(false);
const missingExpiry = ref(false);

/** 识别没成功时的页内提示；不用弹窗，也不在识别过程中显示 */
interface RecognitionProblem {
  title: string;
  body: string;
}
const problem = ref<RecognitionProblem | null>(null);

/**
 * 每次发起识别递增。只有最后一次请求能改页面状态，
 * 否则选第二张照片时，第一张的失败/旧结果会晚一步回来，盖掉新结果。
 */
let runId = 0;

/** App 端压过的图片路径，重试时不用再压一次 */
const preparedImages = new Map<string, string>();

/** 拍照/选图时尽量压到长边 1600px：手机上原图动辄好几 MB，上传慢，模型也更慢 */
const MAX_IMAGE_SIDE = 1600;

const form = reactive({
  name: '',
  categoryIndex: Math.max(0, CATEGORIES.indexOf('食品')),
  quantity: '1',
  unit: '件',
  production_date: '',
  expiry_date: '',
  storage_text: '',
  calories: '',
  threshold: '1',
  isShared: false,
});

/** 最终入库的保质期（到期日），由识别结果带入或用户直接选择 */
const effectiveExpiry = computed(() => form.expiry_date);

/** 根据这份食物自身的保质期，提示会默认提前几天提醒 */
const autoReminderText = computed(() => {
  const shelfLife = shelfLifeDays(form.production_date || null, form.expiry_date || null);
  const lead = recommendedLeadDays(shelfLife);
  if (shelfLife === null || lead === null) return '';
  return `按 ${shelfLife} 天保质期，默认到期前 ${lead} 天提醒；到期当天也会提醒`;
});

const dateUncertain = computed(
  () => !!confidence.value && confidence.value.dates < 0.8 && !!effectiveExpiry.value,
);

/** 当前库存里已经有的分类，用来提示「保存后会新增一类」 */
const inventoryCategories = computed(
  () => new Set(store.items.map((row) => displayCategory(row.item))),
);
const selectedCategory = computed(() => CATEGORIES[form.categoryIndex] ?? '其他');

interface CategoryHint {
  tone: 'warn' | 'info';
  text: string;
}

/**
 * P0：不自动建分类，只把模型的判断讲清楚。
 * 模型给了内置分类之外的分类时，暂存「其他」并提醒用户确认；
 * 选中的是内置分类、但库存里还没有时，提示保存后会新增这一类。
 */
const categoryHint = computed<CategoryHint | null>(() => {
  const selected = selectedCategory.value;
  if (!categoryKnown.value && categoryGuess.value && selected === '其他') {
    let text = `没认出是现有分类，模型建议「${categoryGuess.value}」，暂时放在「其他」。`;
    if (categoryReason.value) text += `模型理由：${categoryReason.value}。`;
    text += '保存前可以手动改分类。';
    return { tone: 'warn', text };
  }
  if (
    selected !== '其他' &&
    store.items.length > 0 &&
    !inventoryCategories.value.has(selected)
  ) {
    return {
      tone: 'info',
      text: `库存里还没有「${selected}」分类，保存后会自动新增这一类。`,
    };
  }
  return null;
});

const recognizingHint = computed(() =>
  shots.value.length > 1 ? '正在用两张照片识别…' : '正在识别包装信息…',
);

/** 买前查重：名称相同或互相包含的现有物品 */
const duplicate = computed(() => {
  const q = form.name.trim().toLowerCase();
  if (q.length < 2) return null;
  return (
    store.items.find((row) => {
      const existing = row.item.name.trim().toLowerCase();
      if (existing.length < 2) return false;
      return existing === q || existing.includes(q) || q.includes(existing);
    }) ?? null
  );
});

onLoad(async () => {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    uni.showToast({ title: '本地数据初始化失败', icon: 'none' });
  }
});

function toast(title: string): void {
  uni.showToast({ title, icon: 'none' });
}

/** slot 0 = 正面，slot 1 = 背面/日期；重拍时沿用原来的角色 */
function choose(slot: number, role: ShotRole, source: 'camera' | 'album'): void {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: async (res) => {
      const path = Array.isArray(res.tempFilePaths) ? res.tempFilePaths[0] : '';
      if (!path) return;
      const next = shots.value.slice();
      next[slot] = { path, role };
      shots.value = next.filter((shot) => !!shot);
      problem.value = null;
      // 已有识别结果时保留表单，只在上面显示「正在识别…」，避免整页闪一下
      await runRecognize();
    },
    fail: (err) => {
      const msg = String(err?.errMsg ?? '');
      if (!msg.includes('cancel')) toast('打开相机失败');
    },
  });
}

function removeImage(index: number): void {
  shots.value = shots.value.filter((_, i) => i !== index);
  problem.value = null;
  if (!shots.value.length) {
    // 没有照片了，正在路上的识别结果也作废，回到最初的拍照入口
    runId += 1;
    recognizing.value = false;
    recognized.value = false;
    confidence.value = null;
    resetCategorySuggestion();
    missingProduction.value = false;
    missingExpiry.value = false;
    return;
  }
  void runRecognize();
}

/** 图片交给识别服务前先压一下；只影响上传，库存里保存的还是原图 */
function compressForUpload(path: string): Promise<string> {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    uni.getImageInfo({
      src: path,
      success: (info) => {
        const longest = Math.max(info.width, info.height) || 1;
        const scale = longest > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / longest : 1;
        const options: any = { src: path, quality: 86 };
        if (scale < 1) {
          options.compressedWidth = Math.round(info.width * scale);
          options.compressedHeight = Math.round(info.height * scale);
        }
        uni.compressImage({
          ...options,
          success: (res: any) => resolve(res.tempFilePath || path),
          fail: () => resolve(path),
        });
      },
      fail: () => resolve(path),
    });
  });
  // #endif
  // #ifdef H5
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const longest = Math.max(image.naturalWidth, image.naturalHeight);
        if (!longest || longest <= MAX_IMAGE_SIDE) {
          resolve(path);
          return;
        }
        const scale = MAX_IMAGE_SIDE / longest;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(path);
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : path), 'image/jpeg', 0.86);
      } catch {
        resolve(path);
      }
    };
    image.onerror = () => resolve(path);
    image.src = path;
  });
  // #endif
  // #ifndef APP-PLUS
  // #ifndef H5
  return Promise.resolve(path);
  // #endif
  // #endif
}

async function prepareImage(path: string): Promise<string> {
  const cached = preparedImages.get(path);
  if (cached) return cached;
  const prepared = await compressForUpload(path);
  preparedImages.set(path, prepared);
  return prepared;
}

async function runRecognize(): Promise<void> {
  // 拍完第一张马上开始识别；用户这时补第二张，会再发起一次，
  // 旧请求的序号对不上就直接丢弃，不会再把「识别失败」弹到新的识别上面。
  const snapshot = shots.value.map((shot) => ({ ...shot }));
  if (!snapshot.length) return;

  const id = ++runId;
  recognizing.value = true;
  problem.value = null;
  try {
    const paths = await Promise.all(snapshot.map((shot) => prepareImage(shot.path)));
    if (id !== runId) return;
    const items = await recognizeImages(paths, snapshot.map((shot) => shot.role));
    if (id !== runId) return;

    if (!items.length) {
      // 照片里没有可识别的包装是正常结果，不当作异常弹窗
      recognized.value = true;
      showProblem(
        '没认出包装',
        form.name.trim()
          ? '这张照片没帮上忙，下面还是上一次识别的内容。'
          : '可以离近一点、避开反光再拍一张；也可以直接手动填写。',
      );
      return;
    }

    applyRecognition(items[0]);
    recognized.value = true;
    if (items.length > 1) toast(`识别到 ${items.length} 件，先录入第一件`);
  } catch (err) {
    if (id !== runId) return;
    console.warn('[capture] 识别失败', err);
    showRecognitionError(err);
    recognized.value = true;
  } finally {
    if (id === runId) recognizing.value = false;
  }
}

function showProblem(title: string, body: string): void {
  problem.value = { title, body };
}

function showRecognitionError(err: unknown): void {
  const message = err instanceof RecognizeError ? err.message : '识别没成功，稍后再试';
  const title =
    err instanceof RecognizeError && err.kind === 'timeout' ? '这次等太久了' : '这次没识别成功';
  const kept = form.name.trim()
    ? '下面还是上一次识别的内容，可以直接改。'
    : '照片已经保留，可以再试一次，也可以手动填写。';
  showProblem(title, `${message}。${kept}`);
}

function dismissProblem(): void {
  problem.value = null;
}

function retryRecognition(): void {
  if (recognizing.value) return;
  void runRecognize();
}

function resetCategorySuggestion(): void {
  categoryGuess.value = null;
  categoryKnown.value = true;
  categoryReason.value = '';
}

function applyRecognition(item: RecognizedItem): void {
  form.name = item.name;
  const idx = CATEGORIES.indexOf(item.category as (typeof CATEGORIES)[number]);
  form.categoryIndex = idx >= 0 ? idx : CATEGORIES.length - 1;
  form.quantity = String(item.quantity);
  form.unit = item.unit;
  form.production_date = item.production_date ?? '';
  form.expiry_date = item.expiry_date ?? '';
  form.storage_text = item.storage_text ?? '';
  form.calories = item.calories === null || item.calories === undefined ? '' : String(item.calories);
  dateNote.value = item.date_note ?? '';
  confidence.value = item.confidence;
  categoryGuess.value = item.category_guess?.trim() || item.category || null;
  // 旧版服务端没有 category_known，按「模型选了内置分类」处理，不误报
  categoryKnown.value = item.category_known !== false;
  categoryReason.value = item.category_reason?.trim() ?? '';
  missingProduction.value = false;
  missingExpiry.value = false;
}

function startManual(): void {
  runId += 1;
  recognizing.value = false;
  problem.value = null;
  recognized.value = true;
  confidence.value = null;
  shots.value = [];
  dateNote.value = '';
  resetCategorySuggestion();
  missingProduction.value = false;
  missingExpiry.value = false;
}

function onCategoryChange(e: any): void {
  form.categoryIndex = Number(e.detail.value);
}

function onDateChange(field: 'production_date' | 'expiry_date', e: any): void {
  form[field] = String(e.detail.value);
  if (field === 'production_date') missingProduction.value = false;
  else missingExpiry.value = false;
}

function onSharedChange(e: any): void {
  form.isShared = Boolean(e.detail.value);
}

async function save(): Promise<void> {
  if (!form.name.trim()) {
    toast('先填一下物品名称');
    return;
  }
  // 生产日期和保质期（到期日）必须都有，否则无法判断临期和提醒
  missingProduction.value = !form.production_date;
  missingExpiry.value = !effectiveExpiry.value;
  if (missingProduction.value || missingExpiry.value) {
    const missing = [missingProduction.value ? '生产日期' : '', missingExpiry.value ? '保质期' : '']
      .filter(Boolean)
      .join('和');
    toast(`请先填写${missing}`);
    return;
  }
  const quantity = Number(form.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    toast('数量要填非负数字');
    return;
  }
  if (form.production_date && effectiveExpiry.value && effectiveExpiry.value < form.production_date) {
    toast('保质期不能早于生产日期');
    return;
  }
  const caloriesText = form.calories.trim();
  const calories = caloriesText ? Number(caloriesText) : NaN;
  if (caloriesText && (!Number.isFinite(calories) || calories < 0)) {
    toast('热量要填非负数字，没有就留空');
    return;
  }
  if (saving.value) return;

  saving.value = true;
  try {
    // 库存只存一张代表图：优先用正面那张；只补拍了日期时退回唯一一张
    const cover = shots.value.find((shot) => shot.role === 'front')?.path ?? shots.value[0]?.path ?? '';
    const image = await persistImage(cover);
    await store.addItem({
      name: form.name.trim(),
      category: CATEGORIES[form.categoryIndex],
      quantity: Math.trunc(quantity),
      unit: form.unit.trim() || '件',
      location_id: null,
      storage_text: form.storage_text.trim() || null,
      calories: caloriesText ? Math.trunc(calories) : null,
      image,
      is_shared: form.isShared,
      threshold: Math.max(0, Math.trunc(Number(form.threshold) || 0)),
      production_date: form.production_date || null,
      expiry_date: effectiveExpiry.value || null,
      pao_months: null,
    });
    uni.showToast({ title: '已存入', icon: 'success' });
    setTimeout(goBack, 600);
  } catch (err) {
    console.error(err);
    toast('保存失败，请重试');
  } finally {
    saving.value = false;
  }
}

function goBack(): void {
  const pages = getCurrentPages();
  if (pages.length > 1) uni.navigateBack();
  else uni.switchTab({ url: '/pages/items/index' });
}
</script>

<template>
  <view class="page capture-page" :class="{ 'capture-page--form': recognized }">
    <!-- 还没拍照：把拍照本身做成一个取景场景，文案、快门、相册入口都在这里 -->
    <template v-if="!shots.length && !recognized">
      <!-- 整屏刚好放满：取景框自己吃掉剩下的高度，矮屏上也不会吊在半空 -->
      <view class="start">
        <view class="hero">
          <view class="hero__seal"><text>囤</text></view>
          <view class="hero__copy">
            <view class="hero__title">拍一下，就记下了</view>
            <view class="hero__sub">包装正面或日期喷码都行，小囤读出名称、分类和保质期。</view>
          </view>
        </view>

        <view
          class="stage"
          hover-class="stage--press"
          :hover-stay-time="60"
          @click="choose(0, 'front', 'camera')"
        >
          <view class="frame">
            <view class="frame__corner frame__corner--tl"></view>
            <view class="frame__corner frame__corner--tr"></view>
            <view class="frame__corner frame__corner--bl"></view>
            <view class="frame__corner frame__corner--br"></view>
          </view>
          <image class="stage__scene" src="/static/capture-desk.svg" mode="widthFix" />
          <view class="stage__focus">
            <view class="shutter">
              <view class="shutter__dot">
                <image class="shutter__icon" src="/static/icons/camera.svg" mode="aspectFit" />
              </view>
            </view>
            <view class="stage__title">拍摄包装正面</view>
            <view class="stage__desc">对准品名、净含量和日期</view>
          </view>
          <view
            class="stage__album"
            hover-class="stage__album--press"
            :hover-stay-time="60"
            @click.stop="choose(0, 'front', 'album')"
          >
            <text>从相册选择</text>
          </view>
        </view>

        <view class="manual" @click="startManual">
          <text>跳过拍照，手动填写</text>
          <text class="manual__arrow">→</text>
        </view>
      </view>
    </template>

    <!-- 已拍：缩略图 + 补拍槽位 -->
    <view v-else-if="shots.length" class="shots">
      <view v-for="(shot, i) in shots" :key="`${i}-${shot.path}`" class="shot-card">
        <image class="shot-card__img" :src="shot.path" mode="aspectFill" />
        <view class="shot-card__tag">{{ shot.role === 'front' ? '正面' : '背面 / 日期' }}</view>
        <view class="shot-card__ops">
          <text class="photo__btn" @click="choose(i, shot.role, 'camera')">重拍</text>
          <text class="photo__btn photo__btn--muted" @click="removeImage(i)">删除</text>
        </view>
      </view>

      <view v-if="shots.length < 2" class="shot-card shot-card--add" @click="choose(1, 'back', 'camera')">
        <view class="shot__plus shot__plus--small">＋</view>
        <view class="shot-card__add-title">补拍日期</view>
        <view class="shot-card__add-desc">只拍喷码那一小块也行</view>
        <view class="shot-card__add-album" @click.stop="choose(1, 'back', 'album')">从相册</view>
      </view>
    </view>

    <view v-if="recognizing" class="recognizing" :class="{ 'recognizing--inline': recognized }">
      <view class="recognizing__dot"></view>
      <text>{{ recognizingHint }}</text>
    </view>

    <template v-if="recognized">
      <view v-if="problem && !recognizing" class="problem">
        <view class="problem__title">{{ problem.title }}</view>
        <view class="problem__body">{{ problem.body }}</view>
        <view class="problem__ops">
          <text v-if="shots.length" class="problem__btn" @click="retryRecognition">再试一次</text>
          <text class="problem__btn problem__btn--ghost" @click="dismissProblem">知道了</text>
        </view>
      </view>

      <view v-if="confidence" class="review-badge">AI 识别结果，请核对日期和储存方式</view>
      <view v-if="dateNote" class="date-note">日期判断：{{ dateNote }}</view>

      <view class="form" :class="{ 'form--busy': recognizing }">
        <!-- 补拍/重拍时表单还在，明确告诉用户字段正在被识别刷新，避免以为改不动 -->
        <view v-if="recognizing" class="form-busy">
          <view class="recognizing__dot"></view>
          <text>正在识别，字段稍后自动更新…</text>
        </view>

        <view class="field">
          <text class="field__label">名称</text>
          <input v-model="form.name" class="field__input" placeholder-class="field__ph" placeholder="例如：蒙牛纯牛奶 250ml" />
        </view>

        <view v-if="duplicate" class="dup">
          <text class="dup__title">已有同款</text>
          <text class="dup__body">
            {{ duplicate.item.name }} · 剩 {{ duplicate.item.quantity }}{{ duplicate.item.unit }} ·
            {{ duplicate.daysLeft === null ? '无保质期' : describeDays(duplicate.daysLeft) }}
          </text>
        </view>

        <view class="field">
          <text class="field__label">存放种类</text>
          <picker mode="selector" :range="CATEGORIES" :value="form.categoryIndex" @change="onCategoryChange">
            <view class="field__value">{{ CATEGORIES[form.categoryIndex] }}</view>
          </picker>
          <text
            v-if="categoryHint"
            :class="['field__hint', categoryHint.tone === 'warn' ? 'field__hint--warn' : '']"
          >
            {{ categoryHint.text }}
          </text>
        </view>

        <view class="field-row">
          <view class="field field--half">
            <text class="field__label">数量</text>
            <input v-model="form.quantity" class="field__input" placeholder-class="field__ph" type="number" />
          </view>
          <view class="field field--half">
            <text class="field__label">单位</text>
            <input v-model="form.unit" class="field__input" placeholder-class="field__ph" placeholder="件" />
          </view>
        </view>

        <view class="field">
          <text class="field__label">生产日期</text>
          <picker mode="date" :value="form.production_date || todayISO()" @change="onDateChange('production_date', $event)">
            <view
              class="field__value"
              :class="{ 'field__value--empty': !form.production_date, 'field__value--missing': missingProduction }"
            >
              {{ form.production_date || '未填写' }}
            </view>
          </picker>
          <text v-if="missingProduction" class="field__hint field__hint--warn">请选择生产日期</text>
        </view>

        <view class="field">
          <view class="field__label-row">
            <text class="field__label">保质期</text>
            <text v-if="dateUncertain" class="field__warn">建议核对</text>
          </view>
          <picker mode="date" :value="form.expiry_date || todayISO()" @change="onDateChange('expiry_date', $event)">
            <view
              class="field__value"
              :class="{
                'field__value--empty': !form.expiry_date,
                'field__value--warn': dateUncertain,
                'field__value--missing': missingExpiry,
              }"
            >
              {{ form.expiry_date || '选择日期' }}
            </view>
          </picker>
          <text v-if="missingExpiry" class="field__hint field__hint--warn">请选择保质期（到期日）</text>
          <text v-if="autoReminderText" class="field__hint">{{ autoReminderText }}</text>
        </view>

        <view class="field">
          <text class="field__label">储存方法</text>
          <input v-model="form.storage_text" class="field__input" placeholder-class="field__ph" placeholder="如：冷藏 2-6℃、冷冻 -18℃、阴凉干燥处" />
          <text class="field__hint">需要冷冻/速冻的食品，存放种类选「冷冻」，并写清冷冻温度</text>
        </view>

        <view class="field">
          <text class="field__label">每件热量</text>
          <input v-model="form.calories" class="field__input" placeholder-class="field__ph" type="number" placeholder="kcal，没有就留空" />
        </view>

        <view class="field">
          <text class="field__label">低库存提醒</text>
          <input v-model="form.threshold" class="field__input" placeholder-class="field__ph" type="number" placeholder="0 表示不提醒" />
        </view>

        <view class="field field--switch">
          <text class="field__label">公用物品</text>
          <switch :checked="form.isShared" color="#9a6514" @change="onSharedChange" />
        </view>
      </view>

      <view class="conf" v-if="confidence">
        <text>模型自评把握（仅供参考）</text>
        <text class="muted">名称 {{ Math.round(confidence.name * 100) }}% · 分类 {{ Math.round(confidence.category * 100) }}%</text>
        <text class="muted">日期 {{ Math.round(confidence.dates * 100) }}% · 储存 {{ Math.round(confidence.storage * 100) }}%</text>
      </view>

      <view class="footer">
        <view
          class="footer__btn"
          :class="{ 'footer__btn--busy': saving }"
          hover-class="footer__btn--press"
          :hover-stay-time="60"
          @click="save"
        >
          {{ saving ? '保存中…' : '存入库存' }}
        </view>
      </view>
    </template>
  </view>
</template>

<style>
/* 冷启动页和登录页用同一套暖色纸感：页面上半是取景场景，下半直接铺表单，不套白卡片 */
.capture-page {
  /* H5 的 100vh 会把导航栏那 44px 也算进来，不扣掉页面就凭空多出一截滚动 */
  box-sizing: border-box;
  min-height: calc(100vh - var(--window-top, 0px));
  padding-bottom: 0;
  background:
    radial-gradient(120% 56% at 50% -8%, rgba(255, 232, 178, 0.9), rgba(255, 232, 178, 0) 62%),
    linear-gradient(180deg, #fdf3dd 0%, #f8e9c9 46%, #f6e5c2 100%);
}

/* 只有出表单时才需要给底部固定按钮留空间 */
.capture-page--form {
  padding-bottom: 300rpx;
}

/* ---------- 首屏：标题 + 取景场景 ---------- */
.start {
  display: flex;
  flex-direction: column;
  /* 一屏放满：扣掉页面上下内边距，取景框把剩下的高度吃掉 */
  min-height: calc(100vh - var(--window-top, 0px) - 48rpx - env(safe-area-inset-bottom));
  padding-bottom: calc(env(safe-area-inset-bottom) + 8rpx);
}

.hero {
  display: flex;
  align-items: flex-start;
  padding: 8rpx 8rpx 0;
}

/* 和登录页同一个「囤」字章，先盖个戳再进门 */
.hero__seal {
  flex: none;
  width: 64rpx;
  height: 64rpx;
  margin: 8rpx 20rpx 0 0;
  border: 2rpx solid #b0894f;
  border-radius: 16rpx;
  background: #fffaf0;
  color: #8a5a0e;
  font-family: 'Songti SC', 'STSong', 'SimSun', serif;
  font-size: 38rpx;
  line-height: 60rpx;
  text-align: center;
  box-shadow: 0 6rpx 14rpx rgba(143, 92, 15, 0.1);
  transform: rotate(-3deg);
}

.hero__copy {
  flex: 1;
  min-width: 0;
}

.hero__title {
  font-size: 42rpx;
  font-weight: 700;
  line-height: 1.25;
  color: #3a2b16;
  letter-spacing: -0.5rpx;
}

.hero__sub {
  margin-top: 10rpx;
  color: #8a7350;
  font-size: 23rpx;
  line-height: 1.65;
}

/* 取景舞台：整块可点，直接进相机；高度跟着屏幕走，矮屏也不会剩一大片空 */
.stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 520rpx;
  /* 屏幕再高，取景框也不无限拉长，多出来的高度交给上下留白 */
  max-height: 900rpx;
  margin-top: 28rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.12);
  border-radius: 32rpx;
  overflow: hidden;
  background:
    radial-gradient(72% 58% at 72% 4%, rgba(255, 226, 160, 0.92), rgba(255, 226, 160, 0) 70%),
    linear-gradient(180deg, #fffbf1 0%, #fbf0d6 100%);
  box-shadow: 0 20rpx 44rpx rgba(143, 92, 15, 0.12);
  transition: transform 0.16s ease;
}

.stage--press {
  transform: scale(0.995);
}

/* 取景框四角，告诉用户「把包装放进来」；要压在囤货剪影上面，四个角才都看得见 */
.frame {
  position: absolute;
  inset: 26rpx;
  z-index: 2;
  pointer-events: none;
}

.frame__corner {
  position: absolute;
  width: 36rpx;
  height: 36rpx;
  border: 0 solid rgba(154, 101, 20, 0.42);
}

.frame__corner--tl {
  top: 0;
  left: 0;
  border-top-width: 3rpx;
  border-left-width: 3rpx;
  border-top-left-radius: 12rpx;
}

.frame__corner--tr {
  top: 0;
  right: 0;
  border-top-width: 3rpx;
  border-right-width: 3rpx;
  border-top-right-radius: 12rpx;
}

.frame__corner--bl {
  bottom: 0;
  left: 0;
  border-bottom-width: 3rpx;
  border-left-width: 3rpx;
  border-bottom-left-radius: 12rpx;
}

.frame__corner--br {
  right: 0;
  bottom: 0;
  border-right-width: 3rpx;
  border-bottom-width: 3rpx;
  border-bottom-right-radius: 12rpx;
}

/* 底部露出一截拍摄台：桌上摆着待拍的那件包装，和登录页的货架图不是一张 */
.stage__scene {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 1;
  width: 100%;
  opacity: 0.3;
  pointer-events: none;
}

.stage__focus {
  position: absolute;
  top: 48%;
  right: 0;
  left: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateY(-58%);
}

/* 快门：外圈奶油纸、内圈铜色，不依赖任何图标素材 */
.shutter {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 152rpx;
  height: 152rpx;
  border: 2rpx solid rgba(154, 101, 20, 0.2);
  border-radius: 50%;
  background: #fffdf8;
  box-shadow: 0 16rpx 32rpx rgba(143, 92, 15, 0.18);
}

.shutter__dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 106rpx;
  height: 106rpx;
  border-radius: 50%;
  background: linear-gradient(180deg, #ab7522, #8f5c0f);
  box-shadow:
    inset 0 -8rpx 16rpx rgba(58, 43, 22, 0.18),
    0 6rpx 14rpx rgba(143, 92, 15, 0.2);
}

/* 圆钮中间一台奶油色相机，一眼看出是快门 */
.shutter__icon {
  width: 52rpx;
  height: 52rpx;
  pointer-events: none;
}

.stage__title {
  margin-top: 26rpx;
  color: #3a2b16;
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 0.5rpx;
}

.stage__desc {
  margin-top: 8rpx;
  color: #a08a5f;
  font-size: 22rpx;
}

.stage__album {
  position: absolute;
  bottom: 26rpx;
  left: 50%;
  z-index: 4;
  height: 64rpx;
  padding: 0 34rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.2);
  border-radius: 999rpx;
  background: rgba(255, 253, 248, 0.86);
  color: #7a633f;
  font-size: 23rpx;
  line-height: 62rpx;
  transform: translateX(-50%);
  transition: background 0.16s;
}

.stage__album--press {
  background: #f6ead2;
}

.manual {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 26rpx;
  padding: 10rpx 6rpx 4rpx;
  color: #8b7550;
  font-size: 24rpx;
}

.manual__arrow {
  margin-left: 8rpx;
  color: #9a6514;
}

/* ---------- 拍完：缩略图 + 补拍槽位 ---------- */
.shots {
  display: flex;
  margin-bottom: 8rpx;
}

.shot-card {
  flex: 1;
  position: relative;
  border: 1rpx solid rgba(154, 101, 20, 0.12);
  border-radius: 24rpx;
  background: #fffdf8;
  box-shadow: 0 12rpx 26rpx rgba(143, 92, 15, 0.08);
  overflow: hidden;
}

.shot-card + .shot-card {
  margin-left: 20rpx;
}

.shot-card__img {
  width: 100%;
  height: 300rpx;
  display: block;
}

.shot-card__tag {
  position: absolute;
  left: 16rpx;
  top: 16rpx;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background: rgba(58, 43, 22, 0.7);
  color: #ffffff;
  font-size: 20rpx;
}

.shot-card__ops {
  display: flex;
  justify-content: flex-end;
  padding: 12rpx 20rpx;
}

.photo__btn {
  margin-left: 28rpx;
  font-size: 24rpx;
  color: #9a6514;
}

.photo__btn--muted {
  color: #a08a5f;
}

.shot-card--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 372rpx;
  border-style: dashed;
  border-color: rgba(154, 101, 20, 0.3);
  background: rgba(255, 250, 240, 0.7);
  box-shadow: none;
}

.shot__plus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96rpx;
  height: 96rpx;
  margin: 0 auto 20rpx;
  border-radius: 50%;
  background: #fdf4e4;
  color: #9a6514;
  font-size: 52rpx;
  line-height: 1;
}

.shot__plus--small {
  width: 72rpx;
  height: 72rpx;
  margin-bottom: 12rpx;
  font-size: 40rpx;
}

.shot-card__add-title {
  font-size: 26rpx;
  color: #9a6514;
}

.shot-card__add-desc {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #a08a5f;
}

.shot-card__add-album {
  margin-top: 18rpx;
  font-size: 22rpx;
  color: #7a633f;
  text-decoration: underline;
}

.recognizing {
  display: flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  margin: 10rpx auto 24rpx;
  padding: 14rpx 28rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.16);
  border-radius: 999rpx;
  background: rgba(255, 253, 248, 0.82);
  color: #7a633f;
  font-size: 24rpx;
}

/* 已有表单时只占一条窄提示，不把整页顶下去 */
.recognizing--inline {
  margin: 4rpx 0 20rpx 8rpx;
  padding: 10rpx 22rpx;
  font-size: 22rpx;
  color: #a08a5f;
}

.problem {
  margin: 0 0 22rpx;
  padding: 24rpx 26rpx;
  border: 1rpx solid rgba(176, 122, 42, 0.26);
  border-left-width: 5rpx;
  border-radius: 6rpx 20rpx 20rpx 6rpx;
  background: linear-gradient(180deg, #fffaf0, #fdf6e8);
}

.problem__title {
  font-size: 26rpx;
  font-weight: 600;
  color: #7a5110;
}

.problem__body {
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.6;
  color: #826b47;
}

.problem__ops {
  display: flex;
  justify-content: flex-end;
  margin-top: 16rpx;
}

.problem__btn {
  margin-left: 32rpx;
  font-size: 24rpx;
  color: #9a6514;
}

.problem__btn--ghost {
  color: #a08a5f;
}

.recognizing__dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #9a6514;
  margin-right: 16rpx;
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

.review-badge {
  display: inline-block;
  margin: 0 8rpx 14rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(253, 244, 228, 0.9);
  color: #9a6514;
  font-size: 22rpx;
  letter-spacing: 0.2rpx;
}

/* 模型说明日期是从哪张照片判断出来的，方便核对是哪一张拍错了 */
.date-note {
  margin: 0 8rpx 22rpx;
  padding: 4rpx 0 4rpx 20rpx;
  border-left: 3rpx solid rgba(154, 101, 20, 0.28);
  color: #7a633f;
  font-size: 22rpx;
  line-height: 1.65;
}

/* 下划线表单：没有白卡片，字段直接用一条细线分节 */
.form {
  padding: 0 8rpx;
}

/* 识别中被刷新的字段先压暗、暂时不能编辑，防止刚改的内容被识别结果覆盖 */
.form--busy > .field,
.form--busy > .field-row,
.form--busy > .dup {
  opacity: 0.45;
  pointer-events: none;
}

.form-busy {
  display: flex;
  align-items: center;
  width: fit-content;
  margin: 6rpx 0 14rpx;
  padding: 12rpx 24rpx;
  border: 1rpx solid rgba(154, 101, 20, 0.18);
  border-radius: 999rpx;
  background: rgba(255, 253, 248, 0.9);
  color: #7a633f;
  font-size: 23rpx;
}

.field {
  padding: 22rpx 0 16rpx;
  border-bottom: 1rpx solid rgba(154, 101, 20, 0.16);
}

.field:last-child {
  border-bottom: none;
}

.field-row {
  display: flex;
  border-bottom: 1rpx solid rgba(154, 101, 20, 0.16);
}

.field--half {
  flex: 1;
  border-bottom: none;
}

.field--half + .field--half {
  margin-left: 24rpx;
}

.field__derived {
  display: flex;
  flex-direction: column;
  margin-top: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: 12rpx;
  background: #fdf9ef;
}

.field__derived-main {
  font-size: 26rpx;
  color: #3a2b16;
}

.field__derived .field__hint {
  margin-top: 4rpx;
}

.field--switch {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dup {
  display: flex;
  align-items: baseline;
  margin: 2rpx 0 6rpx;
  padding: 16rpx 20rpx;
  border-left: 4rpx solid #c98d2e;
  border-radius: 0 12rpx 12rpx 0;
  background: rgba(252, 235, 212, 0.72);
}

.dup__title {
  flex-shrink: 0;
  margin-right: 14rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: #9a6514;
  color: #ffffff;
  font-size: 20rpx;
}

.dup__body {
  flex: 1;
  font-size: 23rpx;
  color: #7a5110;
  line-height: 1.5;
}

.field__label {
  color: #8a7350;
  font-size: 22rpx;
  letter-spacing: 0.3rpx;
}

.field__label-row {
  display: flex;
  align-items: center;
}

.field__warn {
  margin-left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: #fcebd4;
  color: #a05205;
  font-size: 20rpx;
}

.field__input {
  margin-top: 6rpx;
  height: 52rpx;
  font-size: 32rpx;
  line-height: 52rpx;
  color: #3a2b16;
}

.field__ph {
  color: #b7a37a;
  font-size: 30rpx;
}

.field__hint {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.5;
  color: #a08a5f;
}

/* 分类兜底提示：模型建议了新分类但暂存「其他」时，提醒用户核对 */
.field__hint--warn {
  padding: 10rpx 14rpx;
  border-radius: 10rpx;
  background: #fdf0dc;
  color: #a05205;
}

.field__value {
  margin-top: 6rpx;
  font-size: 32rpx;
  line-height: 52rpx;
  color: #3a2b16;
}

/* picker 的值加一个小箭头，让「能点开选」这件事看得出来 */
.field__value::after {
  content: '›';
  float: right;
  color: #c0ab84;
  font-size: 34rpx;
  line-height: 52rpx;
}

.field__value--empty {
  color: #b09b74;
}

.field__value--warn {
  color: #a05205;
}

/* 日期必填拦截：点过保存但没填时标红 */
.field__value--missing {
  color: #b8433a;
  font-weight: 600;
}

.conf {
  display: flex;
  flex-direction: column;
  padding: 16rpx 8rpx;
  font-size: 22rpx;
  color: #a08a5f;
  line-height: 1.8;
}

/* 底部固定主按钮：整条暖色渐隐托住，滚动内容从底下穿过去也不会糊 */
.footer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  padding: 34rpx 24rpx calc(28rpx + env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(246, 229, 194, 0), rgba(246, 229, 194, 0.94) 38%);
  pointer-events: none;
}

.footer__btn {
  height: 96rpx;
  border-radius: 999rpx;
  background: linear-gradient(180deg, #ab7522, #8f5c0f);
  color: #fffdf8;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 96rpx;
  letter-spacing: 2rpx;
  text-align: center;
  box-shadow: 0 12rpx 28rpx rgba(143, 92, 15, 0.28);
  pointer-events: auto;
  transition: transform 0.15s, opacity 0.15s;
}

.footer__btn--press {
  transform: scale(0.995);
  opacity: 0.94;
}

.footer__btn--busy {
  opacity: 0.62;
  pointer-events: none;
}
</style>
