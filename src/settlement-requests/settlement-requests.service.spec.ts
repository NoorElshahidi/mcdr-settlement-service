import { DataSource, EntityManager, Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { ActiveRequestExistsException } from '../common/exceptions/app.exceptions';
import { Company } from '../companies/entities/company.entity';
import { Document, DocumentKind, ScanStatus } from '../documents/entities/document.entity';
import { User } from '../users/entities/user.entity';
import { OwnerActiveRequestLock } from './entities/owner-active-request-lock.entity';
import { SettlementRequest } from './entities/settlement-request.entity';
import { SettlementRequestsService } from './settlement-requests.service';
import { CreateSettlementRequestDto } from './dto/create-settlement-request.dto';

jest.mock('../notifications/notifications.gateway', () => ({
  NotificationsGateway: { emitToSubject: jest.fn() },
}));

const owner = {
  subject: 'owner-sub',
  roles: [Role.Owner],
  email: 'owner@test',
  displayName: 'Owner',
};
const dto = {
  crn: ' 123 ',
  meetings: [
    {
      meetingAt: new Date('2025-01-01T10:00:00.000Z'),
      capital: 100,
      attachmentDocumentId: 'doc-1',
    },
  ],
} as CreateSettlementRequestDto;

function service(manager: Partial<EntityManager>) {
  const dataSource = {
    transaction: jest.fn((callback: (tx: EntityManager) => unknown) =>
      callback(manager as EntityManager),
    ),
    getRepository: jest.fn(),
  } as unknown as DataSource;
  return new SettlementRequestsService(
    dataSource,
    {} as Repository<SettlementRequest>,
    {} as Repository<Company>,
    {} as Repository<User>,
    {} as Repository<Document>,
  );
}

describe('SettlementRequestsService', () => {
  it('lists only the authenticated owner requests', async () => {
    const requests = { find: jest.fn().mockResolvedValue([{ id: 'request-1' }]) };
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'owner-1' }) };
    const instance = new SettlementRequestsService(
      {} as DataSource,
      requests as unknown as Repository<SettlementRequest>,
      {} as Repository<Company>,
      users as unknown as Repository<User>,
      {} as Repository<Document>,
    );

    await expect(instance.list(owner)).resolves.toEqual([{ id: 'request-1' }]);
    expect(requests.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'owner-1' } }),
    );
  });

  it('returns owner request detail with meetings and status history', async () => {
    const requests = { findOne: jest.fn().mockResolvedValue({ id: 'request-1' }) };
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'owner-1' }) };
    const meetings = { find: jest.fn().mockResolvedValue([{ id: 'meeting-1' }]) };
    const history = {
      find: jest.fn().mockResolvedValue([{ status: SettlementStatus.UnderReview }]),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValueOnce(meetings).mockReturnValueOnce(history),
    };
    const instance = new SettlementRequestsService(
      dataSource as unknown as DataSource,
      requests as unknown as Repository<SettlementRequest>,
      {} as Repository<Company>,
      users as unknown as Repository<User>,
      {} as Repository<Document>,
    );

    await expect(instance.detail(owner, 'request-1')).resolves.toEqual({
      id: 'request-1',
      meetings: [{ id: 'meeting-1' }],
      history: [{ status: SettlementStatus.UnderReview }],
    });
  });

  it('rejects a concurrent second active request using the database lock', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: 'user-1', isActive: true })
        .mockResolvedValueOnce({ id: 'company-1', settlementRequired: true }),
      find: jest.fn().mockResolvedValue([
        {
          id: 'doc-1',
          kind: DocumentKind.MeetingAttachment,
          scanStatus: ScanStatus.Approved,
          uploadedBy: 'user-1',
        },
      ]),
      create: jest.fn((_entity, value) => value),
      save: jest.fn().mockResolvedValue({ id: 'request-1', status: SettlementStatus.UnderReview }),
      insert: jest.fn().mockRejectedValue(new Error('duplicate key')),
    };
    await expect(
      service(manager as unknown as Partial<EntityManager>).create(owner, dto),
    ).rejects.toThrow(ActiveRequestExistsException);
  });

  it('creates an under-review request only with an approved owner attachment', async () => {
    const user = { id: 'user-1', isActive: true, keycloakSubject: owner.subject, role: Role.Owner };
    const company = { id: 'company-1', settlementRequired: true };
    const document = {
      id: 'doc-1',
      kind: DocumentKind.MeetingAttachment,
      scanStatus: ScanStatus.Approved,
      uploadedBy: user.id,
    };
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(user).mockResolvedValueOnce(company),
      find: jest.fn().mockImplementation((type: unknown) => (type === Document ? [document] : [])),
      insert: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((_type: unknown, value: unknown) => value),
      save: jest
        .fn()
        .mockImplementation((_typeOrEntity: unknown, entity?: unknown) => entity ?? _typeOrEntity),
    };
    const result = await service(manager as unknown as Partial<EntityManager>).create(owner, dto);
    expect(result.status).toBe(SettlementStatus.UnderReview);
    expect(manager.insert).toHaveBeenCalledWith(
      OwnerActiveRequestLock,
      expect.objectContaining({ ownerId: user.id }),
    );
  });
});
