import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SettlementStatus } from '../../common/enums/settlement-status.enum';

@Entity('settlement_requests')
@Index('idx_requests_owner_status', ['ownerId', 'status'])
@Index('idx_requests_status_created', ['status', 'createdAt'])
export class SettlementRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'owner_id', type: 'char', length: 36 }) ownerId!: string;
  @Column({ name: 'company_id', type: 'char', length: 36 }) companyId!: string;
  @Column({ type: 'enum', enum: SettlementStatus }) status!: SettlementStatus;
  @Column({ name: 'rejection_reason', type: 'varchar', length: 1000, nullable: true })
  rejectionReason!: string | null;
  @Column({ name: 'approved_total', type: 'decimal', precision: 12, scale: 2, nullable: true })
  approvedTotal!: string | null;
  @Column({ length: 3, default: 'EGP' }) currency!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
