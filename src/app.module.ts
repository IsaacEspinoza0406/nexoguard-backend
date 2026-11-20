import { Module } from '@nestjs/common';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { SitesModule } from './sites/sites.module';
import { AnalysisModule } from './analysis/analysis.module';

@Module({ imports: [PrismaModule, UsersModule, AuthModule, SitesModule, AnalysisModule] })
export class AppModule {}
