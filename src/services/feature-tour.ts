/**
 * 新用户功能引导：不逐个介绍 tab，而是指向具体控件，
 * 告诉用户「拍照入库、问库存、搜东西、看分类、改信息、删物品、看月报、设提醒、做备份」怎么用。
 *
 * 只有刚注册的新账号会看到：注册时打上「待引导」标记，首次进入「管家」页弹出；
 * 游客和老账号都不会自动弹。「我的 → 关于 → 功能引导」可以手动重看。
 *
 * 有库存时，「改信息」和「删物品」会真的跳到物品详情 / 分类列表，
 * 高亮具体控件；没有库存时退回两条文字说明，避免把人带到空页面。
 */
import { reactive } from 'vue';
import { getSession } from '@/services/auth';
import { useInventoryStore } from '@/stores/inventory';
import { displayCategory } from '@/constants/categories';

export type FeatureTourTab = 'items' | 'dashboard' | 'report' | 'profile' | 'detail' | 'category';

export interface FeatureTourStep {
  tab: FeatureTourTab;
  path: string;
  /** 按顺序找第一个存在的控件；都找不到时给一个兜底高亮 */
  selectors: string[];
  title: string;
  desc: string;
  hint?: string;
  /** 控件不在首屏时先滚过去 */
  scroll?: boolean;
}

/** 基础 8 步；中间会根据有没有库存插入「改信息 / 删物品」 */
export const FEATURE_TOUR_STEPS: FeatureTourStep[] = [
  {
    tab: 'items',
    path: '/pages/items/index',
    selectors: ['.fab'],
    title: '看到东西，先拍下来',
    desc: '点这个 +，拍包装正面和日期；我会帮你认出名称、分类和保质期。',
    hint: '没有包装或认不出来，也可以手动填。',
  },
  {
    tab: 'items',
    path: '/pages/items/index',
    selectors: ['.composer'],
    title: '想不起来，就问我',
    desc: '比如「还剩多少牛奶」「什么快过期了」，我会翻你手机里的库存再回答。',
    hint: '上面的常用问题也可以直接点。',
  },
  {
    tab: 'dashboard',
    path: '/pages/dashboard/index',
    selectors: ['.search'],
    title: '东西多了，用搜的',
    desc: '按名称、分类或储存方式搜；记不清放哪也能找到。',
    hint: '右边的「待购」是买东西前的清单。',
  },
  {
    tab: 'dashboard',
    path: '/pages/dashboard/index',
    selectors: ['.cat-card--low', '.cat-card', '.empty'],
    title: '分类看库存，偏低先补',
    desc: '入库后这里按分类摆开，点卡片看清单；「库存偏低」会排在最前面。',
    hint: '清单里左滑一行可以直接删。',
  },
  {
    tab: 'report',
    path: '/pages/report/index',
    selectors: ['.month'],
    title: '月报帮你看节奏',
    desc: '这里按月看用掉了什么、吃得快不快；翻月份可以回看以前。',
    hint: '图表下面的「小囤说」会给你下个月的补货建议。',
  },
  {
    tab: 'report',
    path: '/pages/report/index',
    selectors: ['.export__btn--month'],
    title: '把月报存成图片',
    desc: '选一套手账、冰箱贴或拍立得模板，生成一张完整的月报图片。',
    hint: 'H5 会下载并弹大图，长按存相册；App 直接存进相册。',
    scroll: true,
  },
  {
    tab: 'profile',
    path: '/pages/profile/index',
    selectors: ['.tour-anchor-reminders'],
    title: '临期提醒在这里开',
    desc: '打开后，快到期的东西会在提醒时间推给你；免打扰和提前量也能改。',
    hint: '提醒只在本机排期，换手机要重新登录同步。',
    scroll: true,
  },
  {
    tab: 'profile',
    path: '/pages/profile/index',
    selectors: ['.tour-anchor-backup'],
    title: '换机前先备份',
    desc: '导出一份 JSON 备份，换手机或重装时选「恢复备份」就能把库存带回来。',
    hint: '登录后也会自动同步，但备份更稳。',
    scroll: true,
  },
];

const PENDING_PREFIX = 'feature_tour_pending_';

export const featureTour = reactive({
  visible: false,
  step: 0,
  /** 本次引导实际使用的步骤（有库存时会加入详情/分类两步） */
  steps: [] as FeatureTourStep[],
});

function pendingKey(userId: string): string {
  return `${PENDING_PREFIX}${userId}`;
}

function currentUserId(): string {
  return getSession()?.user.id ?? '';
}

/**
 * 根据当前库存拼出本次引导的步骤。
 * 有物品时，编辑/删除两步直接跳到真实页面；没有物品时保留文字说明。
 */
function buildSteps(): FeatureTourStep[] {
  const steps = [...FEATURE_TOUR_STEPS];
  let first: ReturnType<typeof useInventoryStore>['items'][number] | undefined;
  try {
    first = useInventoryStore().items[0];
  } catch {
    first = undefined;
  }

  const editAndDelete: FeatureTourStep[] = first
    ? [
        {
          tab: 'detail',
          path: `/pages/item-detail/index?id=${first.item.id}`,
          selectors: ['.tour-anchor-edit'],
          title: '信息变了，点这里改',
          desc: '这一行能改印刷到期；往下还能标记开封 / 开封后保质期，点照片可以换图。',
          hint: '改完到期日，临期提醒和月报会跟着变。',
          scroll: true,
        },
        {
          tab: 'category',
          path: `/pages/category/index?name=${encodeURIComponent(displayCategory(first.item))}`,
          selectors: ['.row'],
          title: '不要了，向左滑这一行',
          desc: '在物品行上向左滑，点右侧红色「删除」；清单里任何一行都可以。',
          hint: '物品、批次、消耗记录和提醒会一起删，待购会保留。',
        },
      ]
    : [
        {
          tab: 'dashboard',
          path: '/pages/dashboard/index',
          selectors: ['.cat-card--low', '.cat-card', '.empty'],
          title: '信息变了，点进去改',
          desc: '分类 → 点某件东西进详情：印刷到期、开封 / 开封后保质期、照片都能改。',
          hint: '改完到期日，临期提醒和月报会跟着变。',
        },
        {
          tab: 'dashboard',
          path: '/pages/dashboard/index',
          selectors: ['.search'],
          title: '不要了，向左滑删掉',
          desc: '搜到它，在结果列表里向左滑一行，点红色「删除」。',
          hint: '物品、批次、消耗记录和提醒会一起删，待购会保留。',
        },
      ];

  // 插在「分类看库存」之后，月报之前
  steps.splice(4, 0, ...editAndDelete);
  return steps;
}

/**
 * 注册成功时按账号打上「还没看过功能引导」的标记。
 * 只有带这个标记的账号才会自动弹引导；老账号换设备登录不再被打扰。
 */
export function markFeatureTourPending(userId: string): void {
  try {
    uni.setStorageSync(pendingKey(userId), '1');
  } catch {
    // 存储不可用就退化成不自动弹，不阻断注册
  }
}

function pending(userId: string): boolean {
  try {
    return uni.getStorageSync(pendingKey(userId)) === '1';
  } catch {
    return false;
  }
}

function clearPending(userId: string): void {
  try {
    uni.removeStorageSync(pendingKey(userId));
  } catch {
    // ignore
  }
}

function finish(): void {
  featureTour.visible = false;
  const userId = currentUserId();
  if (userId) clearPending(userId);
}

let starting = false;

/**
 * 第一次进主页时调用；只有刚注册的新账号会弹。
 * 游客不弹；老账号没有注册时打的待引导标记，也不会被自动拦住。
 */
export async function maybeStartFeatureTour(): Promise<void> {
  if (featureTour.visible || starting) return;

  const userId = currentUserId();
  if (!userId || !pending(userId)) return;

  starting = true;
  try {
    try {
      await useInventoryStore().init();
    } catch {
      // 数据没读出来就按空库存走，至少能看基础引导
    }
    featureTour.steps = buildSteps();
    featureTour.step = 0;
    featureTour.visible = featureTour.steps.length > 0;
  } finally {
    starting = false;
  }
}

/** 手动重看：从「管家」页第一步开始 */
export async function startFeatureTour(): Promise<void> {
  try {
    await useInventoryStore().init();
  } catch {
    // 读不到库存也能看基础步骤
  }
  featureTour.steps = buildSteps();
  featureTour.step = 0;
  featureTour.visible = true;
  uni.switchTab({ url: featureTour.steps[0]?.path ?? '/pages/items/index' });
}

/** 下一步：跳到下一步所在的 tab 或详情/分类页；最后一步完成后回管家 */
export function nextFeatureTour(): void {
  const steps = featureTour.steps;
  const current = steps[featureTour.step];
  const next = featureTour.step + 1;
  if (next >= steps.length) {
    finish();
    uni.switchTab({ url: steps[0]?.path ?? '/pages/items/index' });
    return;
  }

  const nextStep = steps[next];
  featureTour.step = next;
  // 同页面的下一步不重复切页，避免页面被重置、滚动位置丢失
  if (!current || current.tab !== nextStep.tab) {
    if (nextStep.tab === 'detail' || nextStep.tab === 'category') {
      uni.navigateTo({ url: nextStep.path });
    } else {
      uni.switchTab({ url: nextStep.path });
    }
  }
}

export function skipFeatureTour(): void {
  finish();
}
