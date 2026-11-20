import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { AuthService } from './application/auth.service';
import { AuthRepository } from './infrastructure/auth.repository';
import { AuthController } from './presentation/auth.controller';
import { SessionGuard } from './presentation/session.guard';

@Module({ imports: [PrismaModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])], controllers: [AuthController], providers: [AuthService, AuthRepository, SessionGuard], exports: [SessionGuard, AuthService] })
export class AuthModule {}
