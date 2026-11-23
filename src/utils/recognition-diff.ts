import type { RecognizedItem } from '@/services/recognize';

export interface FinalRecognitionValues {
  name: string;
  category: string;
  quantity: number;
  production_date: string;
  expiry_date: string;
  storage_text: string;
}

export interface RecognitionCorrectionFlags {
  name: boolean;
  category: boolean;
  dates: boolean;
  storage: boolean;
  quantity: boolean;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** 对比 AI 原始结果和用户最终保存的值，只返回字段是否被改过。 */
export function correctionFlags(
  original: RecognizedItem,
  final: FinalRecognitionValues,
): RecognitionCorrectionFlags {
  return {
    name: normalized(original.name) !== normalized(final.name),
    category: normalized(original.category) !== normalized(final.category),
    dates:
      normalized(original.production_date) !== normalized(final.production_date)
      || normalized(original.expiry_date) !== normalized(final.expiry_date),
    storage: normalized(original.storage_text) !== normalized(final.storage_text),
    quantity: Number(original.quantity) !== Number(final.quantity),
  };
}
