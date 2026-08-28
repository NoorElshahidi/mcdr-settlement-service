import { Connection, RowDataPacket, createConnection } from 'mysql2/promise';

describe('MySQL integration', () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await createConnection({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3307),
      user: process.env.DB_USER ?? 'mcdr_test',
      password: process.env.DB_PASSWORD ?? 'mcdr_test',
      database: process.env.DB_NAME ?? 'mcdr_test',
    });
  });

  afterAll(async () => connection?.end());

  it('uses strict MySQL settings and has the settlement schema', async () => {
    const [tables] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users','settlement_requests','meetings','owner_active_request_locks')",
    );
    expect(tables.map((row) => row.table_name).sort()).toEqual([
      'meetings',
      'owner_active_request_locks',
      'settlement_requests',
      'users',
    ]);
    const [settings] = await connection.query<RowDataPacket[]>(
      'SELECT @@sql_mode AS sql_mode, @@character_set_database AS charset_name',
    );
    expect(settings[0]!.sql_mode).toContain('STRICT');
    expect(settings[0]!.charset_name).toBe('utf8mb4');
    const [seeded] = await connection.query<RowDataPacket[]>(
      "SELECT crn, settlement_required FROM companies WHERE crn IN ('CRN-DEMO-001', 'CRN-CLEAR-001') ORDER BY crn",
    );
    expect(seeded).toEqual([
      { crn: 'CRN-CLEAR-001', settlement_required: 0 },
      { crn: 'CRN-DEMO-001', settlement_required: 1 },
    ]);
  });
});
