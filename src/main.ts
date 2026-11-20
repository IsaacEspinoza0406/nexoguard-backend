import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { httpSecurity } from './security/http-security';
import { validateCsrfConfiguration } from './users/presentation/registration-token';
import { sessionDurations } from './auth/domain/session';
import { setupSwagger } from './documentation/openapi';

async function bootstrap(): Promise<void> {
  const security = httpSecurity();
  validateCsrfConfiguration();
  sessionDurations();
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: security.origin, credentials: true });
  app.enableShutdownHooks();
  setupSwagger(app);
  await app.listen(3001, process.env.HOST || '127.0.0.1');
}

void bootstrap();
