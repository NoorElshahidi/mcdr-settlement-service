import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSettlementSchema1761500000000 implements MigrationInterface {
  name = 'CreateSettlementSchema1761500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE users (id CHAR(36) NOT NULL PRIMARY KEY, keycloak_subject VARCHAR(255) NOT NULL UNIQUE, email VARCHAR(255) NOT NULL, display_name VARCHAR(255) NOT NULL, role ENUM('owner','backoffice_employee') NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE companies (id CHAR(36) NOT NULL PRIMARY KEY, crn VARCHAR(32) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL, settlement_required BOOLEAN NOT NULL, eligibility_reason VARCHAR(500) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE settlement_requests (id CHAR(36) NOT NULL PRIMARY KEY, owner_id CHAR(36) NOT NULL, company_id CHAR(36) NOT NULL, status ENUM('SUBMITTED','UNDER_REVIEW','REJECTED','AWAITING_PAYMENT','PAYMENT_PROCESSING','PAID','PARTIALLY_SETTLED','SETTLED') NOT NULL, rejection_reason VARCHAR(1000) NULL, approved_total DECIMAL(12,2) NULL, currency CHAR(3) NOT NULL DEFAULT 'EGP', created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), CONSTRAINT fk_requests_owner FOREIGN KEY (owner_id) REFERENCES users(id), CONSTRAINT fk_requests_company FOREIGN KEY (company_id) REFERENCES companies(id), INDEX idx_requests_owner_status (owner_id,status), INDEX idx_requests_status_created (status,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE owner_active_request_locks (owner_id CHAR(36) NOT NULL PRIMARY KEY, request_id CHAR(36) NOT NULL UNIQUE, updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), CONSTRAINT fk_active_lock_owner FOREIGN KEY (owner_id) REFERENCES users(id), CONSTRAINT fk_active_lock_request FOREIGN KEY (request_id) REFERENCES settlement_requests(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE meetings (id CHAR(36) NOT NULL PRIMARY KEY, request_id CHAR(36) NOT NULL, meeting_at DATETIME(6) NOT NULL, capital DECIMAL(15,2) NOT NULL, attachment_document_id CHAR(36) NULL, settlement_document_id CHAR(36) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_meetings_request FOREIGN KEY (request_id) REFERENCES settlement_requests(id), INDEX idx_meetings_request (request_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE meeting_fees (id CHAR(36) NOT NULL PRIMARY KEY, meeting_id CHAR(36) NOT NULL UNIQUE, amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'EGP', entered_by CHAR(36) NOT NULL, is_locked BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_fees_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id), CONSTRAINT fk_fees_user FOREIGN KEY (entered_by) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE documents (id CHAR(36) NOT NULL PRIMARY KEY, object_key VARCHAR(512) NOT NULL UNIQUE, original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(100) NOT NULL, byte_size BIGINT NOT NULL, checksum CHAR(64) NOT NULL, kind ENUM('MEETING_ATTACHMENT','SETTLEMENT_DOCUMENT') NOT NULL, scan_status ENUM('QUARANTINED','SCANNING','APPROVED','REJECTED') NOT NULL DEFAULT 'QUARANTINED', uploaded_by CHAR(36) NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_documents_user FOREIGN KEY (uploaded_by) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `ALTER TABLE meetings ADD CONSTRAINT fk_meetings_attachment FOREIGN KEY (attachment_document_id) REFERENCES documents(id), ADD CONSTRAINT fk_meetings_settlement_document FOREIGN KEY (settlement_document_id) REFERENCES documents(id)`,
    );
    await queryRunner.query(
      `CREATE TABLE payments (id CHAR(36) NOT NULL PRIMARY KEY, request_id CHAR(36) NOT NULL UNIQUE, amount DECIMAL(12,2) NOT NULL, currency CHAR(3) NOT NULL, transaction_reference VARCHAR(255) NOT NULL UNIQUE, paid_by CHAR(36) NOT NULL, status ENUM('PROCESSING','PAID','FAILED') NOT NULL, idempotency_key VARCHAR(255) NOT NULL UNIQUE, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_payments_request FOREIGN KEY (request_id) REFERENCES settlement_requests(id), CONSTRAINT fk_payments_user FOREIGN KEY (paid_by) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE status_history (id CHAR(36) NOT NULL PRIMARY KEY, request_id CHAR(36) NOT NULL, from_status ENUM('SUBMITTED','UNDER_REVIEW','REJECTED','AWAITING_PAYMENT','PAYMENT_PROCESSING','PAID','PARTIALLY_SETTLED','SETTLED') NULL, to_status ENUM('SUBMITTED','UNDER_REVIEW','REJECTED','AWAITING_PAYMENT','PAYMENT_PROCESSING','PAID','PARTIALLY_SETTLED','SETTLED') NOT NULL, actor_id CHAR(36) NULL, reason VARCHAR(1000) NULL, correlation_id CHAR(36) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_history_request FOREIGN KEY (request_id) REFERENCES settlement_requests(id), CONSTRAINT fk_history_actor FOREIGN KEY (actor_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE notifications (id CHAR(36) NOT NULL PRIMARY KEY, recipient_id CHAR(36) NOT NULL, type VARCHAR(100) NOT NULL, title VARCHAR(255) NOT NULL, body VARCHAR(1000) NOT NULL, request_id CHAR(36) NULL, read_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id), CONSTRAINT fk_notifications_request FOREIGN KEY (request_id) REFERENCES settlement_requests(id), INDEX idx_notifications_recipient_created (recipient_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    await queryRunner.query(
      `CREATE TABLE audit_events (id CHAR(36) NOT NULL PRIMARY KEY, actor_id CHAR(36) NULL, action VARCHAR(100) NOT NULL, target_type VARCHAR(100) NOT NULL, target_id CHAR(36) NOT NULL, correlation_id CHAR(36) NULL, metadata JSON NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id), INDEX idx_audit_target_created (target_type,target_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'audit_events',
      'notifications',
      'status_history',
      'payments',
      'documents',
      'meeting_fees',
      'meetings',
      'owner_active_request_locks',
      'settlement_requests',
      'companies',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}
