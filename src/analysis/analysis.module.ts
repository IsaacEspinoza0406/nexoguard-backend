import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { OwnershipFileReader } from '../sites/infrastructure/ownership-file.reader';
import { CsrfGuard } from '../security/csrf.guard';
import { AnalysisService } from './application/analysis.service';
import { ManualEngine } from './application/manual-engine';
import { AnalysisNetwork } from './infrastructure/analysis-network';
import { AnalysisRepository } from './infrastructure/analysis.repository';
import { AnalysisController } from './presentation/analysis.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitoringController } from './presentation/monitoring.controller';
import { MonitoringService } from './application/monitoring.service';
import { MonitoringPolicy } from './application/monitoring-policy';
import { MonitoringRepository } from './infrastructure/monitoring.repository';
import { SslLabsClient } from './infrastructure/ssl-labs.client';
import { SslLabsRepository } from './infrastructure/ssl-labs.repository';
import { SslLabsService } from './application/ssl-labs.service';
import { SslLabsController } from './presentation/ssl-labs.controller';

@Module({ imports: [ScheduleModule.forRoot(), AuthModule, PrismaModule, HttpModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])], controllers: [AnalysisController, MonitoringController, SslLabsController], providers: [CsrfGuard, OwnershipFileReader, AnalysisService, ManualEngine, AnalysisNetwork, AnalysisRepository, MonitoringPolicy, MonitoringRepository, MonitoringService, SslLabsClient, SslLabsRepository, SslLabsService] })
export class AnalysisModule {}
