import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { SettlementStatus } from '../../common/enums/settlement-status.enum';

@Entity('status_history')
export class StatusHistory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'request_id', type: 'char', length: 36 }) requestId!: string;
  @Column({ name: 'from_status', type: 'enum', enum: SettlementStatus, nullable: true })
  fromStatus!: SettlementStatus | null;
  @Column({ name: 'to_status', type: 'enum', enum: SettlementStatus }) toStatus!: SettlementStatus;
  @Column({ name: 'actor_id', type: 'char', length: 36, nullable: true }) actorId!: string | null;
  @Column({ type: 'varchar', length: 1000, nullable: true }) reason!: string | null;
  @Column({ name: 'correlation_id', type: 'varchar', length: 36, nullable: true }) correlationId!:
    string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
