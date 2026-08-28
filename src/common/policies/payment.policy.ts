export function calculateTotal(fees: readonly number[]): number {
  if (fees.length === 0 || fees.some((fee) => !Number.isFinite(fee) || fee <= 0)) {
    throw new Error('Every meeting must have a positive fee');
  }
  return Number(fees.reduce((total, fee) => total + fee, 0).toFixed(2));
}
