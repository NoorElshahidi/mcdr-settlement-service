import mysql from 'mysql2/promise';

// Resets the Dockerized dev database to the same fixture state the
// migrations produce, so the real-Keycloak browser suite (playwright.docker.config.ts)
// can run repeatedly against `docker compose up` without tripping the
// one-active-request-per-owner lock from a previous run.
export default async function globalSetup() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'mcdr',
    password: process.env.DB_PASSWORD ?? 'mcdr',
    database: process.env.DB_NAME ?? 'mcdr',
  });
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of [
      'audit_events',
      'notifications',
      'status_history',
      'payments',
      'meeting_fees',
      'meetings',
      'documents',
      'owner_active_request_locks',
      'settlement_requests',
      'companies',
      'users',
    ]) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.query(
      `INSERT INTO companies (id, crn, name, settlement_required, eligibility_reason) VALUES
       ('00000000-0000-4000-8000-000000000001', 'CRN-DEMO-001', 'MCDR Demo Trading Company', TRUE, 'Outdated General Assembly meetings require settlement.'),
       ('00000000-0000-4000-8000-000000000002', 'CRN-CLEAR-001', 'MCDR Clear Company', FALSE, 'No settlement is currently required.')`,
    );
    await connection.query(
      `INSERT INTO users (id, keycloak_subject, email, display_name, role, is_active) VALUES
       ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-9000-000000000001', 'backoffice@example.test', 'Backoffice Test', 'backoffice_employee', TRUE)`,
    );
  } finally {
    await connection.end();
  }
}
