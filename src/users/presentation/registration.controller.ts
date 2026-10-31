import { Body, Controller, Get, Header, Post, Req, Res, ForbiddenException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RegisterUserService } from '../application/register-user.service';
import { RegisterDto } from './register.dto';
import { createRegistrationToken, isValidRegistrationToken } from './registration-token';

const allowedOrigin = 'http://127.0.0.1:3000';

@Controller('users')
@UseGuards(ThrottlerGuard)
export class RegistrationController {
  constructor(private readonly registration: RegisterUserService) {}

  @Get('registration-token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  token(@Req() request: Request, @Res({ passthrough: true }) response: Response): { token: string } {
    if (request.get('origin') !== allowedOrigin) throw new ForbiddenException();
    const token = createRegistrationToken();
    response.cookie('registration_csrf', token, { httpOnly: true, sameSite: 'strict', path: '/users', maxAge: 600000 });
    return { token };
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() body: RegisterDto, @Req() request: Request): Promise<{ id: string }> {
    const header = request.get('x-csrf-token') || '';
    const cookie = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('registration_csrf='))?.slice('registration_csrf='.length) || '';
    if (request.get('origin') !== allowedOrigin || !isValidRegistrationToken(header, cookie)) throw new ForbiddenException();
    return this.registration.register(body.email, body.password);
  }
}
