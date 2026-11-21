/** 统一使用本地日期，格式 YYYY-MM-DD，避免时区造成的跨天偏差。 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return formatDate(new Date());
}

/** 本地时间戳，用于 created_at：YYYY-MM-DD HH:mm:ss */
export function nowStamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mm}:${ss}`;
}

export function addDays(days: number, base: Date = new Date()): string {
  const d = new Date(base.getTime());
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

/** 在 YYYY-MM-DD 上加月份，月末自动收敛（如 1-31 + 1 月 = 2-28/29） */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return formatDate(date);
}

/**
 * 包装上的保质期换算成到期日：6个月、180天、2年、1.5年都能认。
 * 认不出、或者缺少生产日期时返回 null，由页面退回手动选到期日。
 */
export function expiryFromShelfLife(production: string, text: string): string | null {
  if (!production || !text.trim()) return null;
  const compact = text.replace(/\s+/g, '').toLowerCase();
  // 「生产日期 2026年8月1日」这类完整日期不是保质期，避免把年份当月数
  if (/\d{4}[-年]\d{1,2}[-月]\d{1,2}/.test(compact)) return null;

  const months = compact.match(/(?:^|\D)(\d{1,3}(?:\.\d+)?)(个月|月|months?|mos?)/);
  if (months) {
    const value = Math.round(Number(months[1]));
    if (value > 0 && value <= 120) return addMonths(production, value);
  }

  const years = compact.match(/(?:^|\D)(\d{1,2}(?:\.\d+)?)(年|years?|yrs?)/);
  if (years) {
    const value = Math.round(Number(years[1]) * 12);
    if (value > 0 && value <= 120) return addMonths(production, value);
  }

  const days = compact.match(/(?:^|\D)(\d{1,4})(天|日|days?)/);
  if (days) {
    const value = Number(days[1]);
    const base = new Date(`${production}T12:00:00`);
    if (value > 0 && value <= 3650 && !Number.isNaN(base.getTime())) {
      return addDays(value, base);
    }
  }

  return null;
}

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 两个日期之间相差的天数，end 晚于 start 时为正数 */
export function daysBetween(start: string, end: string): number {
  return Math.round((toUTC(end) - toUTC(start)) / 86_400_000);
}

/** 目标日期减今天，负数表示已过去 */
export function daysFromToday(iso: string, today: string = todayISO()): number {
  return Math.round((toUTC(iso) - toUTC(today)) / 86_400_000);
}

/** 5 → 「5 天后」，-2 → 「已过期 2 天」，0 → 「今天到期」 */
export function describeDays(days: number): string {
  if (days === 0) return '今天到期';
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  return `${days} 天后`;
}
