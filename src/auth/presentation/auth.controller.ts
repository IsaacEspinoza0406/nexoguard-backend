import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RegisterDto } from '../../users/presentation/register.dto';
import { createRegistrationToken, isValidRegistrationToken } from '../../users/presentation/registration-token';
import { cookieOptions, httpSecurity, readCookie, trustedTokenRequest } from '../../security/http-security';
import { AuthService } from '../application/auth.service';
import { sessionDurations } from '../domain/session';
import { AuthenticatedRequest, SessionGuard } from './session.guard';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private binding(request: Request) { return readCookie(request, httpSecurity().sessionCookie); }
  private checkCsrf(request: Request) {
    const config = httpSecurity();
    if (request.get('origin') !== config.origin || !isValidRegistrationToken(request.get('x-csrf-token') || '', readCookie(request, config.csrfCookie), this.binding(request))) throw new ForbiddenException();
  }

  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const config = httpSecurity();
    if (!trustedTokenRequest(request)) throw new ForbiddenException();
    const token = createRegistrationToken(this.binding(request));
    response.cookie(config.csrfCookie, token, { ...cookieOptions(), maxAge: 600000 });
    return { token };
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() body: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.checkCsrf(request);
    const result = await this.auth.login(body.email, body.password, this.binding(request));
    response.cookie(httpSecurity().sessionCookie, result.token, { ...cookieOptions(), maxAge: sessionDurations().absolute });
    response.clearCookie(httpSecurity().csrfCookie, cookieOptions());
    return result.user;
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  me(@Req() request: AuthenticatedRequest) { return request.user; }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    this.checkCsrf(request);
    await this.auth.logout(this.binding(request));
    response.clearCookie(httpSecurity().sessionCookie, cookieOptions());
    response.clearCookie(httpSecurity().csrfCookie, cookieOptions());
  }
}
