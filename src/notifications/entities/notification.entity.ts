import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
@Index('idx_notifications_recipient_created', ['recipientId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'recipient_id', type: 'char', length: 36 }) recipientId!: string;
  @Column({ length: 100 }) type!: string;
  @Column({ length: 255 }) title!: string;
  @Column({ length: 1000 }) body!: string;
  @Column({ name: 'request_id', type: 'char', length: 36, nullable: true }) requestId!:
    string | null;
  @Column({ name: 'read_at', type: 'datetime', nullable: true }) readAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
