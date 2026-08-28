import { calculateTotal } from './payment.policy';

describe('payment policy', () => {
  it('calculates a stable two-decimal total', () => {
    expect(calculateTotal([100, 25.5, 0.5])).toBe(126);
  });

  it('rejects missing or invalid fees', () => {
    expect(() => calculateTotal([])).toThrow();
    expect(() => calculateTotal([0])).toThrow();
    expect(() => calculateTotal([Number.NaN])).toThrow();
    expect(() => calculateTotal([-1])).toThrow();
    expect(() => calculateTotal([Number.POSITIVE_INFINITY])).toThrow();
    expect(() => calculateTotal([100, 0])).toThrow();
  });
});
