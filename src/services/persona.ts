/**
 * 管家的名字和性格。
 *
 * 存在 schema_meta 里（key = pet_persona），所以导出备份、推同步都会带上；
 * 换机恢复后管家设定也还在。默认值仍然是「小囤 + 温柔体贴」。
 */
import { readMeta, writeMeta } from '@/db/repo';
import { PERSONALITY_PRESETS } from '@/constants/personality';
import {
  DEFAULT_PERSONA,
  PERSONA_CUSTOM_MAX,
  PERSONA_NAME_MAX,
  type PetPersona,
  type PersonalityId,
} from '@/types/pet';

const PERSONA_KEY = 'pet_persona';

function isPersonalityId(value: unknown): value is PersonalityId {
  if (value === 'custom') return true;
  return PERSONALITY_PRESETS.some((preset) => preset.id === value);
}

/** 名字去空白、截断；性格 id 不认识的退回默认；自定义描述限长 */
export function normalizePersona(raw: unknown): PetPersona {
  const data = (raw ?? {}) as Partial<PetPersona>;
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, PERSONA_NAME_MAX) : '';
  const personality = isPersonalityId(data.personality)
    ? data.personality
    : DEFAULT_PERSONA.personality;
  const custom =
    typeof data.custom === 'string' ? data.custom.trim().slice(0, PERSONA_CUSTOM_MAX) : '';
  return {
    name: name || DEFAULT_PERSONA.name,
    personality,
    // 选了自定义但没写字，退回默认性格，避免服务端拿到空人设
    custom: personality === 'custom' ? custom : '',
  };
}

export async function loadPersona(): Promise<PetPersona> {
  const raw = await readMeta(PERSONA_KEY);
  if (!raw) return { ...DEFAULT_PERSONA };
  try {
    return normalizePersona(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PERSONA };
  }
}

export async function savePersona(persona: PetPersona): Promise<PetPersona> {
  const next = normalizePersona(persona);
  await writeMeta(PERSONA_KEY, JSON.stringify(next));
  return next;
}
