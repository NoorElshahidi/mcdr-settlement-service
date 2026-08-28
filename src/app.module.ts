import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { validationSchema } from './config/validation.schema';
import { HealthController } from './health/health.controller';
import { User } from './users/entities/user.entity';
import { Company } from './companies/entities/company.entity';
import { SettlementRequest } from './settlement-requests/entities/settlement-request.entity';
import { Meeting } from './meetings/entities/meeting.entity';
import { MeetingFee } from './meetings/entities/meeting-fee.entity';
import { Document } from './documents/entities/document.entity';
import { Payment } from './payments/entities/payment.entity';
import { Notification } from './notifications/entities/notification.entity';
import { AuditEvent } from './audit/entities/audit-event.entity';
import { StatusHistory } from './status-history/entities/status-history.entity';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakAuthGuard } from './auth/keycloak-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { CompaniesModule } from './companies/companies.module';
import { SettlementRequestsModule } from './settlement-requests/settlement-requests.module';
import { BackofficeModule } from './backoffice/backoffice.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DocumentsModule } from './documents/documents.module';
import { OwnerActiveRequestLock } from './settlement-requests/entities/owner-active-request-lock.entity';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { LoggerModule } from 'nestjs-pino';

@Module({
  controllers: [HealthController],
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    TerminusModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig], validationSchema }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...databaseConfig(), autoLoadEntities: true }),
    }),
    TypeOrmModule.forFeature([
      User,
      Company,
      SettlementRequest,
      Meeting,
      MeetingFee,
      Document,
      Payment,
      Notification,
      AuditEvent,
      StatusHistory,
      OwnerActiveRequestLock,
    ]),
    CompaniesModule,
    SettlementRequestsModule,
    BackofficeModule,
    PaymentsModule,
    NotificationsModule,
    DocumentsModule,
  ],
  providers: [
    KeycloakAuthGuard,
    { provide: APP_GUARD, useExisting: KeycloakAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
