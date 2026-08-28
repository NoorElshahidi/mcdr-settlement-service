import { SettlementStatus } from '../enums/settlement-status.enum';
import { assertTransition, canTransition } from './settlement-transition.policy';

describe('settlement transition policy', () => {
  it('allows approval and payment progression', () => {
    expect(canTransition(SettlementStatus.UnderReview, SettlementStatus.AwaitingPayment)).toBe(
      true,
    );
    expect(
      canTransition(SettlementStatus.AwaitingPayment, SettlementStatus.PaymentProcessing),
    ).toBe(true);
    expect(canTransition(SettlementStatus.PaymentProcessing, SettlementStatus.Paid)).toBe(true);
  });

  it('blocks transitions out of final states', () => {
    expect(canTransition(SettlementStatus.Rejected, SettlementStatus.UnderReview)).toBe(false);
    expect(canTransition(SettlementStatus.Settled, SettlementStatus.Paid)).toBe(false);
    expect(() => assertTransition(SettlementStatus.Settled, SettlementStatus.Paid)).toThrow();
  });

  it('allows partial progress until every meeting is complete', () => {
    expect(canTransition(SettlementStatus.Paid, SettlementStatus.PartiallySettled)).toBe(true);
    expect(canTransition(SettlementStatus.PartiallySettled, SettlementStatus.Settled)).toBe(true);
  });
});
