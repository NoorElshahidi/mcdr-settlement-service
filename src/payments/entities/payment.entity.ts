import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum PaymentStatus {
  Processing = 'PROCESSING',
  Paid = 'PAID',
  Failed = 'FAILED',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'request_id', type: 'char', length: 36, unique: true }) requestId!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) amount!: string;
  @Column({ length: 3 }) currency!: string;
  @Column({ name: 'transaction_reference', length: 255, unique: true })
  transactionReference!: string;
  @Column({ name: 'paid_by', type: 'char', length: 36 }) paidBy!: string;
  @Column({ type: 'enum', enum: PaymentStatus }) status!: PaymentStatus;
  @Column({ name: 'idempotency_key', length: 255, unique: true }) idempotencyKey!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
