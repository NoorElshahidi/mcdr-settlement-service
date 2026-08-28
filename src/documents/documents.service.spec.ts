import { DocumentsService } from './documents.service';
import { Role } from '../common/enums/role.enum';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { Document, ScanStatus } from './entities/document.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { User } from '../users/entities/user.entity';

jest.mock('../common/workflow/workflow-events', () => ({
  notifyUsers: jest.fn(),
  recordTransition: jest.fn(),
}));

describe('DocumentsService', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

  it('scans and stores an owner meeting attachment', async () => {
    const owner = { id: 'owner-id', isActive: true, role: Role.Owner } as User;
    const document = { id: 'document-id', scanStatus: ScanStatus.Approved } as Document;
    const storage = { put: jest.fn().mockResolvedValue({ key: 'attachments/pending/file' }) };
    const scanner = { scan: jest.fn().mockResolvedValue(true) };
    const documents = {
      create: jest.fn().mockReturnValue(document),
      save: jest.fn().mockResolvedValue(document),
    };
    const users = { findOne: jest.fn().mockResolvedValue(owner) };
    const service = new DocumentsService(
      {} as never,
      {} as never,
      {} as never,
      users as never,
      documents as never,
      storage as never,
      scanner as never,
    );

    await expect(
      service.uploadMeetingAttachment('owner-subject', {
        buffer: pdf,
        mimetype: 'application/pdf',
        originalname: 'minutes.pdf',
        size: pdf.length,
      }),
    ).resolves.toMatchObject({ documentId: 'document-id', scanStatus: ScanStatus.Approved });
    expect(scanner.scan).toHaveBeenCalledWith(pdf);
    expect(documents.save).toHaveBeenCalledWith(document);
  });

  it('allows an owner to download an approved document they uploaded', async () => {
    const document = {
      id: 'document-id',
      objectKey: 'attachments/file',
      uploadedBy: 'owner-id',
      scanStatus: ScanStatus.Approved,
    } as Document;
    const documents = { findOne: jest.fn().mockResolvedValue(document) };
    const users = { findOne: jest.fn().mockResolvedValue({ id: 'owner-id' }) };
    const storage = { get: jest.fn().mockResolvedValue(pdf) };
    const service = new DocumentsService(
      {} as never,
      {} as never,
      {} as never,
      users as never,
      documents as never,
      storage as never,
      {} as never,
    );

    await expect(
      service.download('document-id', {
        subject: 'owner-subject',
        roles: [Role.Owner],
      }),
    ).resolves.toMatchObject({ document, data: pdf });
    expect(storage.get).toHaveBeenCalledWith('attachments/file');
  });

  it('settles a paid request when its final meeting document is uploaded', async () => {
    const meeting = {
      id: 'meeting-id',
      requestId: 'request-id',
      settlementDocumentId: null,
    } as unknown as Meeting;
    const request = {
      id: 'request-id',
      status: SettlementStatus.Paid,
      ownerId: 'owner-id',
    } as SettlementRequest;
    const actor = { id: 'employee-id', role: Role.BackofficeEmployee, isActive: true } as User;
    const document = { id: 'document-id', scanStatus: ScanStatus.Approved } as Document;
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(meeting)
        .mockResolvedValueOnce(request)
        .mockResolvedValueOnce(actor),
      create: jest.fn().mockReturnValue(document),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue([meeting]),
      insert: jest.fn(),
      delete: jest.fn(),
    };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    const storage = {
      put: jest.fn().mockResolvedValue({ key: 'settlements/pending/file' }),
      delete: jest.fn(),
    };
    const scanner = { scan: jest.fn().mockResolvedValue(true) };
    const service = new DocumentsService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      storage as never,
      scanner as never,
    );

    await expect(
      service.uploadSettlementDocument('meeting-id', 'employee-subject', {
        buffer: pdf,
        mimetype: 'application/pdf',
        originalname: 'settled.pdf',
        size: 32,
      }),
    ).resolves.toMatchObject({ status: SettlementStatus.Settled });
    expect(meeting.settlementDocumentId).toBe('document-id');
    expect(request.status).toBe(SettlementStatus.Settled);
    expect(manager.delete).toHaveBeenCalled();
    expect(scanner.scan).toHaveBeenCalledTimes(1);
  });
});
