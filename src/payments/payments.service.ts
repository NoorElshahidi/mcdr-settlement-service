import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { DomainException, InvalidTransitionException } from '../common/exceptions/app.exceptions';
import { User } from '../users/entities/user.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { notifyBackoffice, recordTransition } from '../common/workflow/workflow-events';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettlementRequest) private readonly requests: Repository<SettlementRequest>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async summary(requestId: string, subject: string) {
    const user = await this.users.findOne({
      where: { keycloakSubject: subject },
      select: ['id', 'role'],
    });
    const request = await this.requests.findOne({
      where: { id: requestId },
      select: ['id', 'ownerId', 'status', 'approvedTotal', 'currency'],
    });
    if (!request || !user || (user.role === Role.Owner && request.ownerId !== user.id))
      throw new DomainException(
        'REQUEST_NOT_FOUND',
        'Settlement request was not found.',
        HttpStatus.NOT_FOUND,
      );
    if (request.status !== SettlementStatus.AwaitingPayment) throw new InvalidTransitionException();
    return { requestId, total: request.approvedTotal, currency: request.currency };
  }

  async pay(requestId: string, subject: string, idempotencyKey: string) {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { keycloakSubject: subject } });
      const request = await manager.findOne(SettlementRequest, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || !request || user.role !== Role.Owner || request.ownerId !== user.id)
        throw new DomainException(
          'REQUEST_NOT_FOUND',
          'Settlement request was not found.',
          HttpStatus.NOT_FOUND,
        );
      // Locking read: under REPEATABLE READ, a plain read here can miss a payment
      // a concurrent transaction just committed with the same key (its snapshot
      // predates that commit), so a legitimate retry would wrongly 400 instead of
      // returning the original payment. A locking read always sees latest data.
      const prior = await manager.findOne(Payment, {
        where: { idempotencyKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (prior) {
        if (prior.requestId !== requestId || prior.paidBy !== user.id)
          throw new DomainException(
            'IDEMPOTENCY_KEY_CONFLICT',
            'The idempotency key is already in use.',
          );
        return prior;
      }
      if (request.status !== SettlementStatus.AwaitingPayment)
        throw new InvalidTransitionException();
      request.status = SettlementStatus.PaymentProcessing;
      await manager.save(request);
      await recordTransition(
        manager,
        request.id,
        SettlementStatus.AwaitingPayment,
        SettlementStatus.PaymentProcessing,
        user.id,
      );
      const payment = manager.create(Payment, {
        id: randomUUID(),
        requestId,
        amount: request.approvedTotal!,
        currency: request.currency,
        transactionReference: `SIM-${randomUUID()}`,
        paidBy: user.id,
        status: PaymentStatus.Paid,
        idempotencyKey,
      });
      await manager.save(payment);
      request.status = SettlementStatus.Paid;
      await manager.save(request);
      await recordTransition(
        manager,
        request.id,
        SettlementStatus.PaymentProcessing,
        SettlementStatus.Paid,
        user.id,
      );
      await notifyBackoffice(
        manager,
        'PAYMENT_RECEIVED',
        'Payment received',
        'A settlement payment is ready for document completion.',
        request.id,
      );
      // The owner may submit another request only after this one reaches a final
      // outcome; payment itself is not final, so the reservation remains.
      return payment;
    });
  }
}
