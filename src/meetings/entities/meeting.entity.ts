import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('meetings')
@Index('idx_meetings_request', ['requestId'])
export class Meeting {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'request_id', type: 'char', length: 36 }) requestId!: string;
  @Column({ name: 'meeting_at', type: 'datetime', precision: 6 }) meetingAt!: Date;
  @Column({ type: 'decimal', precision: 15, scale: 2 }) capital!: string;
  @Column({ name: 'attachment_document_id', type: 'char', length: 36, nullable: true })
  attachmentDocumentId!: string | null;
  @Column({ name: 'settlement_document_id', type: 'char', length: 36, nullable: true })
  settlementDocumentId!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
