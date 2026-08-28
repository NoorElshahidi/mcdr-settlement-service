import { MigrationInterface, QueryRunner } from 'typeorm';

// The dev-fixture backoffice Keycloak user (infra/keycloak/mcdr-realm.json)
// is imported with a pinned id so its JWT `sub` matches this row. Backoffice
// review actions (setFees/decide/uploadSettlementDocument) look up the actor
// by keycloak_subject and never JIT-provision it the way owner uploads do,
// so without this seed a real Keycloak login gets USER_NOT_FOUND.
export class SeedBackofficeUser1761500002000 implements MigrationInterface {
  name = 'SeedBackofficeUser1761500002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO users (id, keycloak_subject, email, display_name, role, is_active) VALUES
       ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-9000-000000000001', 'backoffice@example.test', 'Backoffice Test', 'backoffice_employee', TRUE)
       ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), role = VALUES(role), is_active = VALUES(is_active)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM users WHERE keycloak_subject = '00000000-0000-4000-9000-000000000001'`,
    );
  }
}
