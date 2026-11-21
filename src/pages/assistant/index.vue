<script setup lang="ts">
/**
 * 问答深链页：从别处带问题跳进来（?q=...），主体和「管家」tab 共用。
 */
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import AssistantCompanion from '@/components/AssistantCompanion.vue';

const preset = ref('');

onLoad((query) => {
  preset.value = decodeURIComponent(String((query as Record<string, unknown>)?.q ?? ''));
});
</script>

<template>
  <AssistantCompanion :preset="preset" />
</template>
