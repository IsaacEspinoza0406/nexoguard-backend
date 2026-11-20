import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { CsrfGuard } from '../security/csrf.guard';
import { SitesService } from './application/sites.service';
import { SitesRepository } from './infrastructure/sites.repository';
import { OwnershipFileReader } from './infrastructure/ownership-file.reader';
import { SitesController } from './presentation/sites.controller';

@Module({ imports: [PrismaModule, AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])], controllers: [SitesController], providers: [SitesService, SitesRepository, OwnershipFileReader, CsrfGuard] })
export class SitesModule {}
