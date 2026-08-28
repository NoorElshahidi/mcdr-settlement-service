import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Meeting } from '../meetings/entities/meeting.entity';
import { MeetingFee } from '../meetings/entities/meeting-fee.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { BackofficeController } from './backoffice.controller';
import { BackofficeService } from './backoffice.service';
import { User } from '../users/entities/user.entity';
import { OwnerActiveRequestLock } from '../settlement-requests/entities/owner-active-request-lock.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SettlementRequest,
      Meeting,
      MeetingFee,
      User,
      OwnerActiveRequestLock,
    ]),
  ],
  controllers: [BackofficeController],
  providers: [BackofficeService],
})
export class BackofficeModule {}
