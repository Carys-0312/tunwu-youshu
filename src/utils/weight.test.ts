import { describe, expect, it } from 'vitest';
import {
  WEIGHT_CAP,
  stockCalories,
  visualScale,
  weightFromCalories,
} from './weight';

describe('weightFromCalories', () => {
  it('空库为 0，无效值为 0', () => {
    expect(weightFromCalories(0)).toBe(0);
    expect(weightFromCalories(-10)).toBe(0);
    expect(weightFromCalories(Number.NaN)).toBe(0);
  });

  it('随热量单调增加但不超过上限', () => {
    const half = weightFromCalories(6000);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(WEIGHT_CAP);
    expect(weightFromCalories(6000)).toBeCloseTo(40 * (1 - Math.exp(-1)), 6);
    expect(weightFromCalories(1_000_000)).toBeLessThanOrEqual(WEIGHT_CAP);
  });
});

describe('stockCalories', () => {
  it('热量 × 数量求和，忽略空值和 0', () => {
    expect(stockCalories([
      { quantity: 2, calories: 100 },
      { quantity: 1, calories: null },
      { quantity: 3, calories: 0 },
      { quantity: 1, calories: 50 },
    ])).toBe(250);
  });

  it('空数组为 0', () => {
    expect(stockCalories([])).toBe(0);
  });
});

describe('visualScale', () => {
  it('空库给下限，满库和超量都封顶 1', () => {
    expect(visualScale(0)).toBeCloseTo(0.28, 6);
    expect(visualScale(-5)).toBeCloseTo(0.28, 6);
    expect(visualScale(WEIGHT_CAP)).toBeCloseTo(1, 6);
    expect(visualScale(WEIGHT_CAP * 2)).toBeCloseTo(1, 6);
  });
});
