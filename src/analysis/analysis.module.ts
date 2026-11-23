import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { ownershipProvider, engineProvider, sslProvider, networkProvider } from '../transport/providers';
import { CsrfGuard } from '../security/csrf.guard';
import { AnalysisService } from './application/analysis.service';
import { AnalysisRepository } from './infrastructure/analysis.repository';
import { AnalysisController } from './presentation/analysis.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringController } from './presentation/monitoring.controller';
import { MonitoringService } from './application/monitoring.service';
import { MonitoringPolicy } from './application/monitoring-policy';
import { MonitoringRepository } from './infrastructure/monitoring.repository';
import { SslLabsRepository } from './infrastructure/ssl-labs.repository';
import { SslLabsService } from './application/ssl-labs.service';
import { SslLabsController } from './presentation/ssl-labs.controller';

@Module({ imports: [ScheduleModule.forRoot(), AuthModule, PrismaModule, HttpModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])], controllers: [AnalysisController, MonitoringController, SslLabsController], providers: [CsrfGuard, ownershipProvider, AnalysisService, engineProvider, networkProvider, AnalysisRepository, MonitoringPolicy, MonitoringRepository, MonitoringService, sslProvider, SslLabsRepository, SslLabsService] })
export class AnalysisModule {}
