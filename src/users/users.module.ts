import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { RegisterUserService } from './application/register-user.service';
import { UserRepository } from './infrastructure/user.repository';
import { RegistrationController } from './presentation/registration.controller';

@Module({ imports: [PrismaModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])], controllers: [RegistrationController], providers: [RegisterUserService, UserRepository] })
export class UsersModule {}
