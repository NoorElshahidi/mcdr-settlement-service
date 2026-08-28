import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('owner_active_request_locks')
export class OwnerActiveRequestLock {
  @PrimaryColumn({ name: 'owner_id', type: 'char', length: 36 }) ownerId!: string;
  @Column({ name: 'request_id', type: 'char', length: 36, unique: true }) requestId!: string;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
