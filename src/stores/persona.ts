import { defineStore } from 'pinia';
import { loadPersona, normalizePersona, savePersona } from '@/services/persona';
import { DEFAULT_PERSONA, type PetPersona } from '@/types/pet';

/** 管家设定。每个用到名字的页面 onShow 时 load() 一下，改完 save() 全局同步 */
export const usePersonaStore = defineStore('persona', {
  state: () => ({
    name: DEFAULT_PERSONA.name,
    personality: DEFAULT_PERSONA.personality,
    custom: DEFAULT_PERSONA.custom,
    loaded: false,
  }),

  actions: {
    async load(force = false): Promise<void> {
      if (this.loaded && !force) return;
      const persona = await loadPersona();
      this.apply(persona);
    },

    async save(next: PetPersona): Promise<PetPersona> {
      const saved = await savePersona(next);
      this.apply(saved);
      return saved;
    },

    apply(persona: PetPersona): void {
      const normalized = normalizePersona(persona);
      this.name = normalized.name;
      this.personality = normalized.personality;
      this.custom = normalized.custom;
      this.loaded = true;
    },

    toPersona(): PetPersona {
      return { name: this.name, personality: this.personality, custom: this.custom };
    },
  },
});
