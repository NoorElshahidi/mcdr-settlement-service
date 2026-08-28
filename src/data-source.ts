import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseConfig } from './config/database.config';

export default new DataSource({ ...databaseConfig(), entities: ['dist/src/**/*.entity.js'] });
