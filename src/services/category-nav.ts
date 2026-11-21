/**
 * 分类页的跳转参数与分类名清洗。
 *
 * 只靠 URL 查询串在 H5 / App 上的解码次数不一致，中文分类（如「饮品」）
 * 到分类页可能变成编码串，筛选结果就成了空列表。这里用一个同进程的
 * 一次性变量把原始分类名带过去，URL 里的 name 只作为深链兜底。
 *
 * 兜底路径上还要清洗「编码串」和「UTF-8 被当成 Latin-1」的乱码，
 * 否则导航栏会把 %E9%A5%AE%E5%93%81 或 é¥®å… 直接显示给用户。
 */
import { CATEGORIES } from '@/constants/categories';

let pending = '';

const KNOWN_CATEGORIES = new Set<string>(CATEGORIES);

export function rememberCategoryTarget(name: string): void {
  pending = name;
}

export function takeCategoryTarget(): string {
  const name = pending;
  pending = '';
  return name;
}

/**
 * 把「UTF-8 字节被当成 Latin-1 显示」的乱码还原成中文（é¥®å… → 饮品）。
 * 只在整串都是单字节字符、且能严格按 UTF-8 解出中文时采用，避免误伤普通英文。
 */
function repairLatin1Utf8(value: string): string {
  if (typeof TextDecoder === 'undefined') return value;
  if (!/[\u0080-ÿ]/.test(value) || /[^\u0000-ÿ]/.test(value)) return value;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i);
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[㐀-鿿]/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

/** 把分类页的 name 参数清洗成可比较、可显示的文本 */
export function normalizeCategoryName(value: unknown): string {
  let name = String(value ?? '').trim();

  // 单层编码 / 双层编码都可能出现，循环解到稳定为止
  for (let i = 0; i < 3; i += 1) {
    if (!/%[0-9A-Fa-f]{2}/.test(name)) break;
    try {
      const next = decodeURIComponent(name);
      if (next === name) break;
      name = next;
    } catch {
      break;
    }
  }

  // 个别 WebView 会先做 percent 解码、再按 Latin-1 转一次，修两层兜底
  for (let i = 0; i < 2; i += 1) {
    const repaired = repairLatin1Utf8(name);
    if (repaired === name) break;
    name = repaired;
  }

  return name.trim();
}

/** 只有落在固定分类里的名字才拿来当导航栏标题，避免把残余乱码显示出来 */
export function isKnownCategory(value: string): boolean {
  return KNOWN_CATEGORIES.has(value);
}
