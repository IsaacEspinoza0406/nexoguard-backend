import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { httpSecurity, readCookie } from './http-security';
import { isValidRegistrationToken } from '../users/presentation/registration-token';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const config = httpSecurity();
    if (request.get('origin') !== config.origin || !isValidRegistrationToken(request.get('x-csrf-token') || '', readCookie(request, config.csrfCookie), readCookie(request, config.sessionCookie))) throw new ForbiddenException('Solicitud no autorizada.');
    return true;
  }
}
