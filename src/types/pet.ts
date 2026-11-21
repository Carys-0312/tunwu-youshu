/** 小囤的状态。库存页只有 idle；问答页会跟着提问/回答/出错切换。 */
export type PetMood = 'idle' | 'thinking' | 'speaking' | 'error';

/** 预设性格的 id，和服务端 AssistantService 里的 PERSONALITIES 对应 */
export type PersonalityId = 'gentle' | 'sharp' | 'genki' | 'calm' | 'custom';

/** 用户对管家的设定：名字 + 性格。存在 schema_meta 里，会跟着备份/同步走 */
export interface PetPersona {
  name: string;
  personality: PersonalityId;
  /** personality 为 custom 时用户自己写的性格描述 */
  custom: string;
}

export const PERSONA_NAME_MAX = 8;
export const PERSONA_CUSTOM_MAX = 120;

export const DEFAULT_PERSONA: PetPersona = {
  name: '小囤',
  personality: 'gentle',
  custom: '',
};
