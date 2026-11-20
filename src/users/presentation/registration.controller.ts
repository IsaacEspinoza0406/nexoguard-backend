import { Body, Controller, Get, Header, Post, Req, Res, ForbiddenException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { RegisterUserService } from '../application/register-user.service';
import { RegisterDto } from './register.dto';
import { createRegistrationToken, isValidRegistrationToken } from './registration-token';
import { cookieOptions, httpSecurity, readCookie } from '../../security/http-security';

@Controller('users')
@UseGuards(ThrottlerGuard)
export class RegistrationController {
  constructor(private readonly registration: RegisterUserService) {}

  @Get('registration-token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  token(@Req() request: Request, @Res({ passthrough: true }) response: Response): { token: string } {
    if (request.get('origin') !== httpSecurity().origin) throw new ForbiddenException();
    const token = createRegistrationToken();
    response.cookie('registration_csrf', token, { ...cookieOptions('/users'), maxAge: 600000 });
    return { token };
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() body: RegisterDto, @Req() request: Request): Promise<{ id: string }> {
    const header = request.get('x-csrf-token') || '';
    const cookie = readCookie(request, 'registration_csrf');
    if (request.get('origin') !== httpSecurity().origin || !isValidRegistrationToken(header, cookie)) throw new ForbiddenException();
    return this.registration.register(body.email, body.password);
  }
}
