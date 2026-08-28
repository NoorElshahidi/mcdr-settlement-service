import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'keycloak_subject', length: 255, unique: true }) keycloakSubject!: string;
  @Column({ length: 255 }) email!: string;
  @Column({ name: 'display_name', length: 255 }) displayName!: string;
  @Column({ type: 'enum', enum: Role }) role!: Role;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
