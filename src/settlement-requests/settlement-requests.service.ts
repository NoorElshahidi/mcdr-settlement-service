import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { ActiveRequestExistsException, DomainException } from '../common/exceptions/app.exceptions';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { Company } from '../companies/entities/company.entity';
import { CreateSettlementRequestDto } from './dto/create-settlement-request.dto';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from './entities/settlement-request.entity';
import { User } from '../users/entities/user.entity';
import { OwnerActiveRequestLock } from './entities/owner-active-request-lock.entity';
import { notifyBackoffice, recordTransition } from '../common/workflow/workflow-events';
import { Document, DocumentKind, ScanStatus } from '../documents/entities/document.entity';
import { StatusHistory } from '../status-history/entities/status-history.entity';

@Injectable()
export class SettlementRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettlementRequest) private readonly requests: Repository<SettlementRequest>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
  ) {}

  async create(
    owner: AuthenticatedUser,
    dto: CreateSettlementRequestDto,
  ): Promise<{ id: string; status: SettlementStatus }> {
    if (!owner.roles.includes(Role.Owner))
      throw new DomainException('OWNER_ROLE_REQUIRED', 'An owner role is required.');
    const crn = dto.crn.trim().toUpperCase();
    return this.dataSource.transaction(async (manager) => {
      let user = await manager.findOne(User, { where: { keycloakSubject: owner.subject } });
      if (!user)
        user = await manager.save(
          manager.create(User, {
            id: randomUUID(),
            keycloakSubject: owner.subject,
            email: owner.email ?? '',
            displayName: owner.displayName ?? owner.subject,
            role: Role.Owner,
            isActive: true,
          }),
        );
      if (!user.isActive) throw new DomainException('USER_DISABLED', 'This user is disabled.');
      const requestId = randomUUID();
      const company = await manager.findOne(Company, { where: { crn } });
      if (!company)
        throw new DomainException(
          'COMPANY_NOT_FOUND',
          'Company was not found.',
          HttpStatus.NOT_FOUND,
        );
      if (!company.settlementRequired)
        throw new DomainException(
          'SETTLEMENT_NOT_REQUIRED',
          'This company does not require settlement.',
        );
      const attachmentIds = dto.meetings.map((meeting) => meeting.attachmentDocumentId);
      const attachments = await manager.find(Document, { where: { id: In(attachmentIds) } });
      if (
        attachments.length !== attachmentIds.length ||
        attachments.some(
          (document) =>
            document.kind !== DocumentKind.MeetingAttachment ||
            document.scanStatus !== ScanStatus.Approved ||
            document.uploadedBy !== user.id,
        )
      ) {
        throw new DomainException(
          'INVALID_ATTACHMENT',
          'Every attachment must be an approved upload owned by the requester.',
        );
      }
      const request = manager.create(SettlementRequest, {
        id: requestId,
        ownerId: user.id,
        companyId: company.id,
        // Submission enters the backoffice queue immediately; SUBMITTED remains
        // reserved for an optional asynchronous intake stage.
        status: SettlementStatus.UnderReview,
        currency: 'EGP',
      });
      await manager.save(request);
      // The lock references the request, so the request must exist first. Both
      // writes share this transaction; a duplicate owner lock rolls everything back.
      try {
        await manager.insert(OwnerActiveRequestLock, { ownerId: user.id, requestId });
      } catch {
        throw new ActiveRequestExistsException();
      }
      await recordTransition(manager, request.id, null, request.status, user.id);
      await notifyBackoffice(
        manager,
        'REQUEST_SUBMITTED',
        'New settlement request',
        'A new request is ready for review.',
        request.id,
      );
      await manager.save(
        Meeting,
        dto.meetings.map((meeting) =>
          manager.create(Meeting, {
            id: randomUUID(),
            requestId: request.id,
            meetingAt: meeting.meetingAt,
            capital: meeting.capital.toFixed(2),
            attachmentDocumentId: meeting.attachmentDocumentId,
          }),
        ),
      );
      return { id: request.id, status: request.status };
    });
  }

  async list(owner: AuthenticatedUser) {
    const user = await this.users.findOne({
      where: { keycloakSubject: owner.subject },
      select: ['id'],
    });
    if (!user) return [];
    return this.requests.find({
      where: { ownerId: user.id },
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'companyId',
        'status',
        'rejectionReason',
        'approvedTotal',
        'currency',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async detail(owner: AuthenticatedUser, id: string) {
    const user = await this.users.findOne({
      where: { keycloakSubject: owner.subject },
      select: ['id'],
    });
    const request = user
      ? await this.requests.findOne({
          where: { id, ownerId: user.id },
          select: [
            'id',
            'companyId',
            'status',
            'rejectionReason',
            'approvedTotal',
            'currency',
            'createdAt',
            'updatedAt',
          ],
        })
      : null;
    if (!request)
      throw new DomainException(
        'REQUEST_NOT_FOUND',
        'Settlement request was not found.',
        HttpStatus.NOT_FOUND,
      );
    const meetings = await this.dataSource
      .getRepository(Meeting)
      .find({ where: { requestId: request.id } });
    const history = await this.dataSource
      .getRepository(StatusHistory)
      .find({ where: { requestId: request.id }, order: { createdAt: 'ASC' } });
    return { ...request, meetings, history };
  }
}
