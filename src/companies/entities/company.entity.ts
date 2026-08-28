import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ length: 32, unique: true }) crn!: string;
  @Column({ length: 255 }) name!: string;
  @Column({ name: 'settlement_required' }) settlementRequired!: boolean;
  @Column({ name: 'eligibility_reason', type: 'varchar', length: 500, nullable: true })
  eligibilityReason!: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
