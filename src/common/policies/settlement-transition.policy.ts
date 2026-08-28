import { SettlementStatus } from '../enums/settlement-status.enum';

const transitions: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  [SettlementStatus.Submitted]: [SettlementStatus.UnderReview],
  [SettlementStatus.UnderReview]: [SettlementStatus.Rejected, SettlementStatus.AwaitingPayment],
  [SettlementStatus.Rejected]: [],
  [SettlementStatus.AwaitingPayment]: [SettlementStatus.PaymentProcessing],
  [SettlementStatus.PaymentProcessing]: [SettlementStatus.Paid, SettlementStatus.AwaitingPayment],
  [SettlementStatus.Paid]: [SettlementStatus.PartiallySettled, SettlementStatus.Settled],
  [SettlementStatus.PartiallySettled]: [
    SettlementStatus.PartiallySettled,
    SettlementStatus.Settled,
  ],
  [SettlementStatus.Settled]: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid settlement transition: ${from} -> ${to}`);
  }
}
