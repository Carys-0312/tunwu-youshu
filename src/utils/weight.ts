/**
 * 囤积体重：用当前库存的食物热量驱动，公式是饱和曲线
 *
 *   体重 = 上限 × (1 - e^(-库存热量 / K))
 *
 * 空库为 0；囤得越多涨得越多，但永远不超过上限，而且越接近上限涨得越慢。
 * 吃掉/过期清掉后库存热量下降，体重会自动回落，不需要单独的扣减规则。
 */

/** 视觉最大形态对应的数值，一个刻度，不一定是真实公斤 */
export const WEIGHT_CAP = 40;

/**
 * 饱和速度：约 6000 kcal（三天口粮）到半满，越大越难涨满。
 * 这个值决定「加一件物品能不能看出来」——宿舍库存在一两千到一万卡之间，
 * 取 2 万的话整段都压在曲线最平坦的地方，加一箱牛奶都不动。
 */
export const WEIGHT_K = 6000;

export function weightFromCalories(kcal: number): number {
  if (!Number.isFinite(kcal) || kcal <= 0) return 0;
  return WEIGHT_CAP * (1 - Math.exp(-kcal / WEIGHT_K));
}

/** 库存总热量 = Σ(每件热量 × 数量)；没填热量的物品按 0 算 */
export function stockCalories(items: { quantity: number; calories: number | null }[]): number {
  return items.reduce((total, item) => {
    const per = item.calories ?? 0;
    return per > 0 ? total + per * item.quantity : total;
  }, 0);
}

/** 角色视觉缩放：0 时给 0.28 的下限，避免缩成一个点 */
export function visualScale(weight: number): number {
  const ratio = Math.max(0, Math.min(weight / WEIGHT_CAP, 1));
  return 0.28 + 0.72 * ratio;
}
