import { daysBetween } from '@/utils/date';

export interface ShelfLifeSource {
  production_date: string | null;
  expiry_date: string | null;
  opened_at: string | null;
  pao_months: number | null;
  /** 按天的开封后保质期（新数据优先用这个） */
  pao_days?: number | null;
}

/** 包装上的总保质期天数：到期日 - 生产日期；日期缺失或倒挂时返回 null */
export function shelfLifeDays(
  productionDate: string | null,
  expiryDate: string | null,
): number | null {
  if (!productionDate || !expiryDate) return null;
  const days = daysBetween(productionDate, expiryDate);
  return days > 0 ? days : null;
}

/** 批次的保质期：优先包装日期，缺到期日时用「开封后保质期」兜底 */
export function batchShelfLifeDays(batch: ShelfLifeSource): number | null {
  const printed = shelfLifeDays(batch.production_date, batch.expiry_date);
  if (printed !== null) return printed;
  // 没有包装到期日时，开封后保质期才是实际会用到的那段
  if (!batch.expiry_date && batch.opened_at) {
    if (batch.pao_days && batch.pao_days > 0) return batch.pao_days;
    if (batch.pao_months && batch.pao_months > 0) {
      return Math.round(batch.pao_months * 30.44);
    }
  }
  return null;
}

/**
 * 按食物自身保质期推荐默认提前天数：
 * ≤7 天 → 1 天；≤30 天 → 3 天；≤90 天 → 7 天；≤180 天 → 15 天；更长 → 30 天。
 * 到期当天始终提醒，不依赖这个推荐值。
 */
export function recommendedLeadDays(shelfLife: number | null): number | null {
  if (shelfLife === null || !Number.isFinite(shelfLife) || shelfLife <= 0) return null;
  if (shelfLife <= 7) return 1;
  if (shelfLife <= 30) return 3;
  if (shelfLife <= 90) return 7;
  if (shelfLife <= 180) return 15;
  return 30;
}
