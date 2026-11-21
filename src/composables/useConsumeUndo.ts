import { ref } from 'vue';
import { onUnload } from '@dcloudio/uni-app';
import { useInventoryStore } from '@/stores/inventory';
import type { ConsumeResult } from '@/db/repo';

/** 「用掉一个」之后的 6 秒撤销窗口，列表页和详情页共用 */
export function useConsumeUndo(afterUndo?: () => Promise<void> | void) {
  const store = useInventoryStore();
  const undoState = ref<ConsumeResult | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearUndo(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    undoState.value = null;
  }

  function startUndo(result: ConsumeResult): void {
    undoState.value = result;
    if (timer) clearTimeout(timer);
    timer = setTimeout(clearUndo, 6000);
  }

  async function undo(): Promise<void> {
    const state = undoState.value;
    if (!state) return;
    clearUndo();
    try {
      await store.undoConsume(state);
      await afterUndo?.();
      uni.showToast({ title: '已撤销', icon: 'none' });
    } catch {
      uni.showToast({ title: '撤销失败', icon: 'none' });
    }
  }

  onUnload(clearUndo);

  return { undoState, startUndo, undo };
}
