import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { DomainException, InvalidTransitionException } from '../common/exceptions/app.exceptions';
import { SettlementStatus } from '../common/enums/settlement-status.enum';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { Document, DocumentKind, ScanStatus } from './entities/document.entity';
import { validateFile } from './file-policy';
import { User } from '../users/entities/user.entity';
import { FileScannerService } from './file-scanner.service';
import { ObjectStorageService } from './storage.service';
import { OwnerActiveRequestLock } from '../settlement-requests/entities/owner-active-request-lock.entity';
import { notifyUsers, recordTransition } from '../common/workflow/workflow-events';
import { Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/types/authenticated-user';

export interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Meeting) private readonly meetings: Repository<Meeting>,
    @InjectRepository(SettlementRequest) private readonly requests: Repository<SettlementRequest>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    private readonly storage: ObjectStorageService,
    private readonly scanner: FileScannerService,
  ) {}

  async uploadMeetingAttachment(ownerSubject: string, file: UploadFile) {
    if (!file) throw new DomainException('FILE_REQUIRED', 'A meeting attachment is required.');
    let checked;
    try {
      checked = validateFile(file.buffer, file.mimetype, file.originalname);
    } catch {
      throw new DomainException('FILE_INVALID', 'The uploaded file is invalid or unsupported.');
    }
    let actor = await this.users.findOne({
      where: { keycloakSubject: ownerSubject, isActive: true },
    });
    if (!actor) {
      const existing = await this.users.findOne({ where: { keycloakSubject: ownerSubject } });
      if (existing && !existing.isActive)
        throw new DomainException('USER_DISABLED', 'This user is disabled.');
      actor = await this.users.save(
        this.users.create({
          id: randomUUID(),
          keycloakSubject: ownerSubject,
          email: '',
          displayName: ownerSubject,
          role: Role.Owner,
          isActive: true,
        }),
      );
    }
    const stored = await this.storage.put(
      `attachments/pending/${randomUUID()}`,
      file.buffer,
      file.mimetype,
    );
    try {
      if (!(await this.scanner.scan(file.buffer)))
        throw new DomainException('FILE_REJECTED', 'The uploaded file failed security scanning.');
    } catch (error) {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
    const document = this.documents.create({
      id: randomUUID(),
      objectKey: stored.key,
      originalName: file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'),
      mimeType: file.mimetype,
      byteSize: String(checked.size),
      checksum: checked.checksum,
      kind: DocumentKind.MeetingAttachment,
      scanStatus: ScanStatus.Approved,
      uploadedBy: actor.id,
    });
    await this.documents.save(document);
    return { documentId: document.id, scanStatus: document.scanStatus };
  }

  async download(documentId: string, user: AuthenticatedUser) {
    const document = await this.documents.findOne({
      where: { id: documentId, scanStatus: ScanStatus.Approved },
    });
    if (!document)
      throw new DomainException(
        'DOCUMENT_NOT_FOUND',
        'Document was not found.',
        HttpStatus.NOT_FOUND,
      );
    if (user.roles.includes(Role.BackofficeEmployee))
      return { document, data: await this.storage.get(document.objectKey) };
    const owner = await this.users.findOne({
      where: { keycloakSubject: user.subject },
      select: ['id'],
    });
    if (!owner)
      throw new DomainException(
        'DOCUMENT_NOT_FOUND',
        'Document was not found.',
        HttpStatus.NOT_FOUND,
      );
    if (document.uploadedBy !== owner.id) {
      const meeting = await this.meetings.findOne({
        where: [{ attachmentDocumentId: document.id }, { settlementDocumentId: document.id }],
      });
      const request = meeting
        ? await this.requests.findOne({
            where: { id: meeting.requestId, ownerId: owner.id },
            select: ['id'],
          })
        : null;
      if (!request)
        throw new DomainException(
          'DOCUMENT_NOT_FOUND',
          'Document was not found.',
          HttpStatus.NOT_FOUND,
        );
    }
    return { document, data: await this.storage.get(document.objectKey) };
  }

  async uploadSettlementDocument(meetingId: string, actorId: string, file: UploadFile) {
    if (!file) throw new DomainException('FILE_REQUIRED', 'A settlement document is required.');
    const checked = validateFile(file.buffer, file.mimetype, file.originalname);
    const objectKey = `settlements/pending/${randomUUID()}`;
    const stored = await this.storage.put(objectKey, file.buffer, file.mimetype);
    try {
      if (!(await this.scanner.scan(file.buffer)))
        throw new DomainException('FILE_REJECTED', 'The uploaded file failed security scanning.');
    } catch (error) {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Locking read: two concurrent uploads for the same meeting must not both
        // pass the "no document yet" check against the same stale snapshot.
        const meeting = await manager.findOne(Meeting, {
          where: { id: meetingId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!meeting)
          throw new DomainException(
            'MEETING_NOT_FOUND',
            'Meeting was not found.',
            HttpStatus.NOT_FOUND,
          );
        const request = await manager.findOne(SettlementRequest, {
          where: { id: meeting.requestId },
        });
        const actor = await manager.findOne(User, {
          where: { keycloakSubject: actorId, isActive: true },
        });
        if (!actor)
          throw new DomainException('USER_NOT_FOUND', 'Authenticated user was not found.');
        if (actor.role !== Role.BackofficeEmployee)
          throw new DomainException('BACKOFFICE_ROLE_REQUIRED', 'A backoffice role is required.');
        if (
          !request ||
          ![SettlementStatus.Paid, SettlementStatus.PartiallySettled].includes(request.status)
        )
          throw new InvalidTransitionException();
        if (meeting.settlementDocumentId)
          throw new DomainException(
            'DOCUMENT_ALREADY_ATTACHED',
            'This meeting already has a settlement document.',
          );
        const document = manager.create(Document, {
          id: randomUUID(),
          objectKey: stored.key,
          originalName: file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'),
          mimeType: file.mimetype,
          byteSize: String(checked.size),
          checksum: checked.checksum,
          kind: DocumentKind.SettlementDocument,
          scanStatus: ScanStatus.Approved,
          uploadedBy: actor.id,
        });
        await manager.save(document);
        meeting.settlementDocumentId = document.id;
        await manager.save(meeting);
        const allMeetings = await manager.find(Meeting, { where: { requestId: request.id } });
        const complete = allMeetings.every((item) =>
          item.id === meeting.id ? true : Boolean(item.settlementDocumentId),
        );
        const previousStatus = request.status;
        request.status = complete ? SettlementStatus.Settled : SettlementStatus.PartiallySettled;
        await manager.save(request);
        await recordTransition(manager, request.id, previousStatus, request.status, actor.id);
        await notifyUsers(
          manager,
          [request.ownerId],
          complete ? 'REQUEST_SETTLED' : 'DOCUMENT_UPLOADED',
          complete ? 'Request settled' : 'Settlement document uploaded',
          complete
            ? 'All settlement documents are complete.'
            : 'A settlement document was uploaded for your request.',
          request.id,
        );
        if (complete) await manager.delete(OwnerActiveRequestLock, { requestId: request.id });
        return { documentId: document.id, requestId: request.id, status: request.status };
      });
    } catch (error) {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  }
}
