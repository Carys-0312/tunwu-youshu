/**
 * 识别纠正回流：保存 AI 识别结果时，只上报「哪些字段被用户改过」。
 *
 * 不上传原始文本、照片或物品内容；服务端只用这些布尔标记统计字段级纠正率，
 * 用来判断提示词和模型在哪个字段上最不可靠。
 */
import { API_BASE } from './api';
import { authHeader } from './auth';
import type { RecognizedItem } from './recognize';
import {
  correctionFlags,
  type FinalRecognitionValues,
} from '@/utils/recognition-diff';

export type { FinalRecognitionValues, RecognitionCorrectionFlags } from '@/utils/recognition-diff';
export { correctionFlags } from '@/utils/recognition-diff';

function platformName(): string {
  try {
    const platform = String(uni.getSystemInfoSync().platform || '').toLowerCase();
    if (platform === 'android' || platform === 'ios') return platform;
    if (platform === 'devtools') return 'h5';
    if (platform) return platform;
  } catch {
    // ignore
  }
  return 'unknown';
}

/** 保存成功后调用；失败静默忽略，不打扰用户 */
export function reportRecognitionFeedback(
  original: RecognizedItem | null,
  final: FinalRecognitionValues,
  model = '',
): void {
  if (!original) return;
  const flags = correctionFlags(original, final);
  try {
    uni.request({
      url: `${API_BASE}/api/recognize/feedback`,
      method: 'POST',
      data: {
        model: model || '',
        platform: platformName(),
        ...flags,
      } as any,
      header: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader(),
      },
      timeout: 5000,
      success: () => undefined,
      fail: () => undefined,
    });
  } catch {
    // 回流失败不影响保存
  }
}
