import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { SettlementRequest } from '../settlement-requests/entities/settlement-request.entity';
import { User } from '../users/entities/user.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { OwnerActiveRequestLock } from '../settlement-requests/entities/owner-active-request-lock.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, SettlementRequest, User, OwnerActiveRequestLock])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
