import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { Role } from '../enums/role.enum';
import { SettlementStatus } from '../enums/settlement-status.enum';
import { AuditEvent } from '../../audit/entities/audit-event.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import { StatusHistory } from '../../status-history/entities/status-history.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationsGateway } from '../../notifications/notifications.gateway';

const labels: Record<SettlementStatus, string> = {
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under review',
  REJECTED: 'rejected',
  AWAITING_PAYMENT: 'awaiting payment',
  PAYMENT_PROCESSING: 'payment processing',
  PAID: 'paid',
  PARTIALLY_SETTLED: 'partially settled',
  SETTLED: 'settled',
};

export async function recordTransition(
  manager: EntityManager,
  requestId: string,
  fromStatus: SettlementStatus | null,
  toStatus: SettlementStatus,
  actorId: string | null,
  reason?: string,
): Promise<void> {
  await manager.insert(StatusHistory, {
    id: randomUUID(),
    requestId,
    fromStatus,
    toStatus,
    actorId: actorId ?? null,
    reason: reason ?? null,
    correlationId: null,
  });
  await manager.insert(AuditEvent, {
    id: randomUUID(),
    actorId: actorId ?? null,
    action: 'STATUS_CHANGED',
    targetType: 'settlement_request',
    targetId: requestId,
    correlationId: null,
    metadata: { fromStatus: fromStatus ?? undefined, toStatus },
  });
}

export async function notifyUsers(
  manager: EntityManager,
  recipientIds: string[],
  type: string,
  title: string,
  body: string,
  requestId: string,
): Promise<void> {
  if (!recipientIds.length) return;
  try {
    await manager.insert(
      Notification,
      recipientIds.map((recipientId) => ({
        id: randomUUID(),
        recipientId,
        type,
        title,
        body,
        requestId,
        readAt: null,
      })),
    );
    const users = await manager.find(User, {
      where: recipientIds.map((id) => ({ id })),
      select: ['keycloakSubject'],
    });
    for (const user of users)
      NotificationsGateway.emitToSubject(user.keycloakSubject, { type, title, body, requestId });
  } catch {
    // Notification delivery is deliberately best-effort and must not roll back
    // the business transition that triggered it.
  }
}

export async function notifyBackoffice(
  manager: EntityManager,
  type: string,
  title: string,
  body: string,
  requestId: string,
) {
  const users = await manager.find(User, {
    where: { role: Role.BackofficeEmployee, isActive: true },
    select: ['id'],
  });
  await notifyUsers(
    manager,
    users.map((user) => user.id),
    type,
    title,
    body,
    requestId,
  );
}

export function statusLabel(status: SettlementStatus): string {
  return labels[status];
}
