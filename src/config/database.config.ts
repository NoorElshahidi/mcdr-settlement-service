import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  type: 'mysql' as const,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  migrations: ['dist/src/migrations/*.js'],
  entities: ['dist/src/**/*.entity.js'],
}));
