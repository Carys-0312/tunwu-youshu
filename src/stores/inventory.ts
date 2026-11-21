import { defineStore } from 'pinia';
import type { DashboardData, InventoryRow, ShoppingItem } from '@/types/models';
import {
  addManualShoppingItem,
  addShoppingItem,
  buyShoppingItem,
  consumeItem,
  createItem,
  deleteItemDeep,
  deleteShoppingItem,
  initDatabase,
  loadDashboard,
  loadInventory,
  loadShopping,
  restoreShoppingItem,
  undoConsume,
  updateShoppingItem,
  type BuyShoppingResult,
  type ConsumeResult,
  type NewItemInput,
  type ShoppingDraft,
} from '@/db/repo';
import { stockCalories as sumStockCalories, weightFromCalories } from '@/utils/weight';
import { displayCategory } from '@/constants/categories';

let initPromise: Promise<void> | null = null;

export const useInventoryStore = defineStore('inventory', {
  state: () => ({
    items: [] as InventoryRow[],
    shopping: [] as ShoppingItem[],
    dashboard: null as DashboardData | null,
    ready: false,
    loading: false,
    error: '',
  }),

  getters: {
    /** 库存食物总热量 kcal */
    stockCalories(state): number {
      return sumStockCalories(state.items.map((row) => row.item));
    },
    /** 囤积体重，0 ~ WEIGHT_CAP，由库存热量算出来 */
    weight(state): number {
      return weightFromCalories(sumStockCalories(state.items.map((row) => row.item)));
    },
    expiringSoon(state): InventoryRow[] {
      return state.items.filter((row) => row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 7);
    },
    expired(state): InventoryRow[] {
      return state.items.filter((row) => row.daysLeft !== null && row.daysLeft < 0);
    },
  },

  actions: {
    /** 幂等初始化：多个页面同时调用也只会建库、灌数据一次 */
    async init(): Promise<void> {
      if (this.ready) return;
      if (!initPromise) {
        initPromise = (async () => {
          await initDatabase();
          await this.refresh();
        })();
      }
      try {
        await initPromise;
        this.ready = true;
      } catch (err) {
        initPromise = null;
        this.error = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },

    async refresh(): Promise<void> {
      this.loading = true;
      try {
        const items = await loadInventory();
        this.items = items;
        this.dashboard = await loadDashboard(items);
        this.shopping = await loadShopping();
      } finally {
        this.loading = false;
      }
    },

    async addItem(input: NewItemInput): Promise<string> {
      const id = await createItem(input);
      await this.refresh();
      return id;
    },

    /** 彻底删除一件物品，批次、流水和相关提醒一起清掉 */
    async deleteItem(itemId: string): Promise<void> {
      await deleteItemDeep(itemId);
      await this.refresh();
    },

    /** 用掉若干件，刷新后体重会跟着回落 */
    async consume(itemId: string, amount = 1): Promise<ConsumeResult> {
      const result = await consumeItem(itemId, amount);
      await this.refresh();
      return result;
    },

    async undoConsume(result: ConsumeResult): Promise<void> {
      await undoConsume(result);
      await this.refresh();
    },

    async addToShopping(row: InventoryRow): Promise<void> {
      await addShoppingItem({
        item_id: row.item.id,
        name: row.item.name,
        qty: 1,
        section: displayCategory(row.item),
      });
      this.shopping = await loadShopping();
      this.dashboard = await loadDashboard();
    },

    /** 手动添加一条待购；同名条目已存在时返回 false */
    async addManualShopping(draft: ShoppingDraft): Promise<boolean> {
      const added = await addManualShoppingItem(draft);
      if (added) await this.refresh();
      return added;
    },

    async updateShopping(
      id: string,
      patch: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'section'>>,
    ): Promise<void> {
      await updateShoppingItem(id, patch);
      await this.refresh();
    },

    async removeShopping(id: string): Promise<void> {
      await deleteShoppingItem(id);
      await this.refresh();
    },

    /** 勾选买好；restock=true 且条目来自库存时，同时把数量加回库存 */
    async buyShopping(id: string, restock: boolean): Promise<BuyShoppingResult> {
      const result = await buyShoppingItem(id, restock);
      await this.refresh();
      return result;
    },

    /** 把已买条目放回待购，回库过的会同时扣回库存 */
    async restoreShopping(id: string): Promise<{ reversed: boolean }> {
      const result = await restoreShoppingItem(id);
      await this.refresh();
      return result;
    },

  },
});
