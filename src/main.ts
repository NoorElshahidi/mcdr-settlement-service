import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ credentials: true, origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1');
  const openApi = new DocumentBuilder()
    .setTitle('MCDR Settlement Service')
    .setDescription('Secure settlement workflow API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, openApi));
  app.enableShutdownHooks();
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
