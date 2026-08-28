import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_events')
@Index('idx_audit_target_created', ['targetType', 'targetId', 'createdAt'])
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'actor_id', type: 'char', length: 36, nullable: true }) actorId!: string | null;
  @Column({ name: 'action', length: 100 }) action!: string;
  @Column({ name: 'target_type', length: 100 }) targetType!: string;
  @Column({ name: 'target_id', length: 36 }) targetId!: string;
  @Column({ name: 'correlation_id', type: 'varchar', length: 36, nullable: true }) correlationId!:
    string | null;
  @Column({ type: 'json', nullable: true }) metadata!: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
