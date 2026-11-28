import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { httpSecurity, securityHeaders } from './security/http-security';
import { validateCsrfConfiguration } from './users/presentation/registration-token';
import { sessionDurations } from './auth/domain/session';
import { setupSwagger } from './documentation/openapi';
import { securityEvents } from './security/security-events';
import { listenerConfig } from './security/listener-config';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { internalTls } from './security/internal-tls';

async function bootstrap(): Promise<void> {
  const security = httpSecurity();
  validateCsrfConfiguration();
  sessionDurations();
  const app = await NestFactory.create(AppModule, { httpsOptions: internalTls(security.production) });
  const listener = listenerConfig();
  const server = app.getHttpAdapter().getInstance() as import('express').Express;
  server.set('trust proxy', listener.trustProxy);
  server.get('/health/live', (_request, response) => { response.json({ status: 'ok' }); });
  server.get('/health/ready', async (_request, response) => {
    try { await app.get(PrismaService).$queryRaw`SELECT 1`; response.json({ status: 'ok' }); }
    catch { response.status(503).json({ status: 'unavailable' }); }
  });
  app.use(securityHeaders);
  app.use(securityEvents());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: security.origin, credentials: true });
  app.enableShutdownHooks();
  setupSwagger(app);
  await app.listen(listener.port, listener.host);
}

void bootstrap();
