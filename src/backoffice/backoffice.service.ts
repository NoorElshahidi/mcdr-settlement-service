import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { DomainException, InvalidTransitionException } from '../common/exceptions/app.exceptions';
import { calculateTotal } from '../common/policies/payment.policy';
import { MeetingFee } from '../meetings/entities/meeting-fee.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { SetFeesDto } from './dto/review.dto';
import { User } from '../users/entities/user.entity';
import { OwnerActiveRequestLock } from '../settlement-requests/entities/owner-active-request-lock.entity';
import { notifyUsers, recordTransition } from '../common/workflow/workflow-events';
import { StatusHistory } from '../status-history/entities/status-history.entity';
import { ListRequestsDto } from './dto/list-requests.dto';

@Injectable()
export class BackofficeService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettlementRequest) private readonly requests: Repository<SettlementRequest>,
    @InjectRepository(Meeting) private readonly meetings: Repository<Meeting>,
    @InjectRepository(MeetingFee) private readonly fees: Repository<MeetingFee>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async setFees(requestId: string, actorId: string, dto: SetFeesDto): Promise<{ total: number }> {
    return this.dataSource.transaction(async (manager) => {
      const actor = await manager.findOne(User, { where: { keycloakSubject: actorId } });
      if (!actor?.isActive)
        throw new DomainException('USER_NOT_FOUND', 'Backoffice user is not active.');
      const request = await manager.findOne(SettlementRequest, { where: { id: requestId } });
      if (!request || request.status !== SettlementStatus.UnderReview)
        throw new InvalidTransitionException();
      const meetings = await manager.find(Meeting, { where: { requestId } });
      if (
        dto.fees.length > meetings.length ||
        new Set(dto.fees.map((fee) => fee.meetingId)).size !== dto.fees.length
      )
        throw new DomainException('INVALID_FEES', 'Each meeting can have at most one fee.');
      const meetingIds = new Set(meetings.map((meeting) => meeting.id));
      if (dto.fees.some((fee) => !meetingIds.has(fee.meetingId)))
        throw new DomainException('UNKNOWN_MEETING', 'Fee references an unknown meeting.');
      const total = calculateTotal(dto.fees.map((fee) => fee.amount));
      // Fee entry is a draft: partial updates are allowed, while approval below
      // still requires one fee for every meeting.
      await manager.delete(MeetingFee, { meetingId: In(dto.fees.map((fee) => fee.meetingId)) });
      await manager.save(
        MeetingFee,
        dto.fees.map((fee) =>
          manager.create(MeetingFee, {
            id: randomUUID(),
            meetingId: fee.meetingId,
            amount: fee.amount.toFixed(2),
            enteredBy: actor.id,
            isLocked: false,
            currency: request.currency,
          }),
        ),
      );
      return { total };
    });
  }

  async list(query: ListRequestsDto = new ListRequestsDto()) {
    const limit = query.limit ?? 25;
    const builder = this.requests
      .createQueryBuilder('request')
      .innerJoin('companies', 'company', 'company.id = request.company_id')
      .select([
        'request.id AS id',
        'request.owner_id AS ownerId',
        'request.company_id AS companyId',
        'request.status AS status',
        'request.rejection_reason AS rejectionReason',
        'request.approved_total AS approvedTotal',
        'request.currency AS currency',
        'request.created_at AS createdAt',
        'request.updated_at AS updatedAt',
        'company.crn AS crn',
      ])
      .orderBy('request.created_at', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .limit(limit + 1);
    if (query.status) builder.andWhere('request.status = :status', { status: query.status });
    if (query.crn) builder.andWhere('company.crn = :crn', { crn: query.crn.trim().toUpperCase() });
    if (query.from) builder.andWhere('request.created_at >= :from', { from: query.from });
    if (query.to) builder.andWhere('request.created_at <= :to', { to: query.to });
    if (query.cursor) {
      const decoded = this.decodeCursor(query.cursor);
      builder.andWhere(
        '(request.created_at < :cursorDate OR (request.created_at = :cursorDate AND request.id < :cursorId))',
        decoded,
      );
    }
    const rows = await builder.getRawMany<Record<string, unknown>>();
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      limit,
      nextCursor:
        hasNext && last ? this.encodeCursor(String(last.createdAt), String(last.id)) : null,
    };
  }

  private encodeCursor(date: string, id: string): string {
    return Buffer.from(`${new Date(date).toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): { cursorDate: string; cursorId: string } {
    try {
      const [cursorDate, cursorId] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
      if (!cursorDate || !cursorId || Number.isNaN(Date.parse(cursorDate)))
        throw new Error('invalid');
      return { cursorDate: new Date(cursorDate).toISOString(), cursorId };
    } catch {
      throw new DomainException('INVALID_CURSOR', 'The pagination cursor is invalid.');
    }
  }

  async detail(requestId: string) {
    const request = await this.requests.findOne({
      where: { id: requestId },
      select: [
        'id',
        'ownerId',
        'companyId',
        'status',
        'rejectionReason',
        'approvedTotal',
        'currency',
        'createdAt',
        'updatedAt',
      ],
    });
    if (!request)
      throw new DomainException(
        'REQUEST_NOT_FOUND',
        'Settlement request was not found.',
        HttpStatus.NOT_FOUND,
      );
    const meetings = await this.meetings.find({
      where: { requestId },
      select: ['id', 'meetingAt', 'capital', 'attachmentDocumentId', 'settlementDocumentId'],
    });
    const history = await this.dataSource
      .getRepository(StatusHistory)
      .find({ where: { requestId }, order: { createdAt: 'ASC' } });
    const fees = await this.fees.find({
      where: meetings.map((meeting) => ({ meetingId: meeting.id })),
    });
    return { request, meetings, fees, history };
  }

  async decide(
    requestId: string,
    actorId: string,
    approve: boolean,
    reason?: string,
  ): Promise<SettlementStatus> {
    return this.dataSource.transaction(async (manager) => {
      const actor = await manager.findOne(User, { where: { keycloakSubject: actorId } });
      if (!actor?.isActive)
        throw new DomainException('USER_NOT_FOUND', 'Backoffice user is not active.');
      // Locking read: two concurrent decisions (e.g. approve + reject) must not
      // both pass this check against the same stale snapshot and blindly
      // overwrite each other — the second caller has to see the first's result.
      const request = await manager.findOne(SettlementRequest, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request || request.status !== SettlementStatus.UnderReview)
        throw new InvalidTransitionException();
      if (!approve && !reason?.trim())
        throw new DomainException('REJECTION_REASON_REQUIRED', 'A rejection reason is required.');
      const meetings = await manager.find(Meeting, { where: { requestId } });
      const fees = await manager.find(MeetingFee, {
        where: { meetingId: In(meetings.map((meeting) => meeting.id)) },
      });
      if (approve && fees.length !== meetings.length)
        throw new DomainException('INCOMPLETE_FEES', 'Every meeting needs a fee before approval.');
      request.status = approve ? SettlementStatus.AwaitingPayment : SettlementStatus.Rejected;
      request.rejectionReason = approve ? null : reason!.trim();
      request.approvedTotal = approve
        ? calculateTotal(fees.map((fee) => Number(fee.amount))).toFixed(2)
        : null;
      await manager.save(request);
      await recordTransition(
        manager,
        request.id,
        SettlementStatus.UnderReview,
        request.status,
        actor.id,
        request.rejectionReason ?? undefined,
      );
      await notifyUsers(
        manager,
        [request.ownerId],
        approve ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
        approve ? 'Request approved' : 'Request rejected',
        approve ? 'Your request is ready for payment.' : request.rejectionReason!,
        request.id,
      );
      if (!approve) await manager.delete(OwnerActiveRequestLock, { requestId });
      return request.status;
    });
  }
}
