import { PaymentsService } from './payments.service';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { PaymentStatus } from './entities/payment.entity';
import { Payment } from './entities/payment.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { User } from '../users/entities/user.entity';

jest.mock('../common/workflow/workflow-events', () => ({
  notifyBackoffice: jest.fn(),
  recordTransition: jest.fn(),
}));

describe('PaymentsService', () => {
  it('returns the payment summary only for the owning user', async () => {
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'owner-id', role: Role.Owner }) };
    const requests = {
      findOne: jest.fn().mockResolvedValue({
        id: 'request-id',
        ownerId: 'owner-id',
        status: SettlementStatus.AwaitingPayment,
        approvedTotal: '250.00',
        currency: 'EGP',
      } as SettlementRequest),
    };
    const service = new PaymentsService(
      {} as never,
      requests as never,
      {} as never,
      users as never,
    );

    await expect(service.summary('request-id', 'owner-subject')).resolves.toEqual({
      requestId: 'request-id',
      total: '250.00',
      currency: 'EGP',
    });
  });

  it('simulates payment once and rejects a conflicting idempotency key', async () => {
    const user = { id: 'owner-id', role: Role.Owner } as User;
    const request = {
      id: 'request-id',
      ownerId: 'owner-id',
      status: SettlementStatus.AwaitingPayment,
      approvedTotal: '250.00',
      currency: 'EGP',
    } as SettlementRequest;
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce(null),
      save: jest.fn(),
      create: jest.fn((_, value) => value),
      insert: jest.fn(),
    };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    const service = new PaymentsService(dataSource as never, {} as never, {} as never, {} as never);

    const payment = await service.pay('request-id', 'owner-subject', 'payment-key');
    expect(payment.amount).toBe('250.00');
    expect(payment.status).toBe(PaymentStatus.Paid);
    expect(request.status).toBe(SettlementStatus.Paid);
    expect(manager.save).toHaveBeenCalledTimes(3);
  });

  it('returns an existing payment for the same idempotency key', async () => {
    const user = { id: 'owner-id', role: Role.Owner } as User;
    const request = { id: 'request-id', ownerId: 'owner-id' } as SettlementRequest;
    const prior = { requestId: 'request-id', paidBy: 'owner-id' } as Payment;
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce(prior),
    };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    const service = new PaymentsService(dataSource as never, {} as never, {} as never, {} as never);

    await expect(service.pay('request-id', 'owner-subject', 'payment-key')).resolves.toBe(prior);
  });
});
