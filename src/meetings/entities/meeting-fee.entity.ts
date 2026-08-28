import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('meeting_fees')
export class MeetingFee {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'meeting_id', type: 'char', length: 36, unique: true }) meetingId!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) amount!: string;
  @Column({ length: 3, default: 'EGP' }) currency!: string;
  @Column({ name: 'entered_by', type: 'char', length: 36 }) enteredBy!: string;
  @Column({ name: 'is_locked', default: false }) isLocked!: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
