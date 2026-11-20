import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../application/auth.service';
import { httpSecurity, readCookie } from '../../security/http-security';

export type AuthenticatedRequest = Request & { user: { id: string; email: string } };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.auth.authenticate(readCookie(request, httpSecurity().sessionCookie));
    return true;
  }
}
