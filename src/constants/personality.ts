import type { PersonalityId } from '@/types/pet';

export interface PersonalityPreset {
  id: Exclude<PersonalityId, 'custom'>;
  label: string;
  /** 设置页里的一句话说明，真正的提示词在服务端 */
  hint: string;
}

export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  { id: 'gentle', label: '温柔体贴', hint: '像室友一样关心你，先问人再谈库存' },
  { id: 'sharp', label: '毒舌吐槽', hint: '嘴上不饶人，建议倒是实在' },
  { id: 'genki', label: '元气满满', hint: '短句、有精神，每天都在给你打气' },
  { id: 'calm', label: '冷静专业', hint: '只说重点，不寒暄' },
];

export function personalityLabel(id: PersonalityId): string {
  if (id === 'custom') return '自定义';
  return PERSONALITY_PRESETS.find((item) => item.id === id)?.label ?? '温柔体贴';
}
