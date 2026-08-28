import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { Document } from './entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { User } from '../users/entities/user.entity';
import { MinioStorageService } from './minio-storage.service';
import { ClamAvScannerService, FileScannerService } from './file-scanner.service';
import { ObjectStorageService } from './storage.service';
import { OwnerActiveRequestLock } from '../settlement-requests/entities/owner-active-request-lock.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, Meeting, SettlementRequest, User, OwnerActiveRequestLock]),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    MinioStorageService,
    ClamAvScannerService,
    { provide: ObjectStorageService, useExisting: MinioStorageService },
    { provide: FileScannerService, useExisting: ClamAvScannerService },
  ],
})
export class DocumentsModule {}
