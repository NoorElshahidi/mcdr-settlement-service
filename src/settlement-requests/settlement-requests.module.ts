import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/entities/company.entity';
import { Meeting } from '../meetings/entities/meeting.entity';
import { SettlementRequest } from './entities/settlement-request.entity';
import { SettlementRequestsController } from './settlement-requests.controller';
import { SettlementRequestsService } from './settlement-requests.service';
import { User } from '../users/entities/user.entity';
import { OwnerActiveRequestLock } from './entities/owner-active-request-lock.entity';
import { Document } from '../documents/entities/document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SettlementRequest,
      Company,
      Meeting,
      User,
      OwnerActiveRequestLock,
      Document,
    ]),
  ],
  controllers: [SettlementRequestsController],
  providers: [SettlementRequestsService],
})
export class SettlementRequestsModule {}
