import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum DocumentKind {
  MeetingAttachment = 'MEETING_ATTACHMENT',
  SettlementDocument = 'SETTLEMENT_DOCUMENT',
}
export enum ScanStatus {
  Quarantined = 'QUARANTINED',
  Scanning = 'SCANNING',
  Approved = 'APPROVED',
  Rejected = 'REJECTED',
}

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'object_key', length: 512, unique: true }) objectKey!: string;
  @Column({ name: 'original_name', length: 255 }) originalName!: string;
  @Column({ name: 'mime_type', length: 100 }) mimeType!: string;
  @Column({ name: 'byte_size', type: 'bigint' }) byteSize!: string;
  @Column({ length: 64 }) checksum!: string;
  @Column({ type: 'enum', enum: DocumentKind }) kind!: DocumentKind;
  @Column({ name: 'scan_status', type: 'enum', enum: ScanStatus, default: ScanStatus.Quarantined })
  scanStatus!: ScanStatus;
  @Column({ name: 'uploaded_by', type: 'char', length: 36 }) uploadedBy!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
