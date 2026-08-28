import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDevelopmentCompanies1761500001000 implements MigrationInterface {
  name = 'SeedDevelopmentCompanies1761500001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO companies (id, crn, name, settlement_required, eligibility_reason) VALUES
       ('00000000-0000-4000-8000-000000000001', 'CRN-DEMO-001', 'MCDR Demo Trading Company', TRUE, 'Outdated General Assembly meetings require settlement.'),
       ('00000000-0000-4000-8000-000000000002', 'CRN-CLEAR-001', 'MCDR Clear Company', FALSE, 'No settlement is currently required.')
       ON DUPLICATE KEY UPDATE name = VALUES(name), settlement_required = VALUES(settlement_required), eligibility_reason = VALUES(eligibility_reason)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM companies WHERE crn IN ('CRN-DEMO-001', 'CRN-CLEAR-001')`);
  }
}
