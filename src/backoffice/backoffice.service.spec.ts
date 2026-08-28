import { BackofficeService } from './backoffice.service';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { Meeting } from '../meetings/entities/meeting.entity';
import { MeetingFee } from '../meetings/entities/meeting-fee.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { User } from '../users/entities/user.entity';

jest.mock('../common/workflow/workflow-events', () => ({
  notifyUsers: jest.fn(),
  recordTransition: jest.fn(),
}));

describe('BackofficeService', () => {
  const actor = { id: 'actor-id', isActive: true, role: Role.BackofficeEmployee } as User;
  const request = {
    id: 'request-id',
    status: SettlementStatus.UnderReview,
    currency: 'EGP',
  } as SettlementRequest;
  const meetings = [{ id: 'meeting-a' }, { id: 'meeting-b' }] as Meeting[];

  function service() {
    const manager = {
      findOne: jest.fn().mockResolvedValueOnce(actor).mockResolvedValueOnce(request),
      find: jest.fn().mockResolvedValue(meetings),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn((_, value) => value),
    };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    return {
      instance: new BackofficeService(
        dataSource as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
      manager,
    };
  }

  it('persists a partial fee draft without allowing duplicate meeting fees', async () => {
    const { instance, manager } = service();

    await expect(
      instance.setFees('request-id', 'actor-subject', {
        fees: [{ meetingId: 'meeting-a', amount: 50 }],
      }),
    ).resolves.toEqual({ total: 50 });

    expect(manager.delete).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalled();
  });

  it('rejects approval when the fee draft is incomplete', async () => {
    const { instance, manager } = service();
    manager.find
      .mockReset()
      .mockResolvedValueOnce(meetings)
      .mockResolvedValueOnce([{ meetingId: 'meeting-a', amount: '50.00' } as MeetingFee]);

    await expect(instance.decide('request-id', 'actor-subject', true)).rejects.toMatchObject({
      response: { error: { code: 'INCOMPLETE_FEES' } },
    });
  });

  it('rejects a request after a partial fee draft and makes it final', async () => {
    const { instance, manager } = service();
    manager.find
      .mockReset()
      .mockResolvedValueOnce(meetings)
      .mockResolvedValueOnce([{ meetingId: 'meeting-a', amount: '50.00' } as MeetingFee]);

    await expect(
      instance.decide('request-id', 'actor-subject', false, 'Needs clarification'),
    ).resolves.toBe(SettlementStatus.Rejected);
    expect(request.status).toBe(SettlementStatus.Rejected);
    expect(manager.delete).toHaveBeenCalled();
  });

  it('returns an empty cursor page from the request queue', async () => {
    const { instance } = service();
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    (instance as unknown as { requests: { createQueryBuilder: jest.Mock } }).requests = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    await expect(instance.list()).resolves.toMatchObject({ items: [], nextCursor: null });
  });

  it('returns request detail with its meetings, fees, and history', async () => {
    const { instance } = service();
    const repositories = instance as unknown as {
      requests: { findOne: jest.Mock };
      meetings: { find: jest.Mock };
      fees: { find: jest.Mock };
      dataSource: { getRepository: jest.Mock };
    };
    repositories.requests = { findOne: jest.fn().mockResolvedValue(request) };
    repositories.meetings = { find: jest.fn().mockResolvedValue(meetings) };
    repositories.fees = { find: jest.fn().mockResolvedValue([]) };
    repositories.dataSource = {
      getRepository: jest.fn().mockReturnValue({ find: jest.fn().mockResolvedValue([]) }),
    };

    await expect(instance.detail('request-id')).resolves.toMatchObject({ request, meetings });
  });

  it('emits an opaque cursor when the queue has another page', async () => {
    const { instance } = service();
    const rows = Array.from({ length: 26 }, (_, index) => ({
      id: `request-${index}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
    (instance as unknown as { requests: { createQueryBuilder: jest.Mock } }).requests = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const result = await instance.list();
    expect(result.items).toHaveLength(25);
    expect(result.nextCursor).toEqual(expect.any(String));
  });
});
