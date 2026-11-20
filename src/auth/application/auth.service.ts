import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { normalizeEmail } from '../../users/domain/registration';
import { AuthRepository } from '../infrastructure/auth.repository';
import { newSessionToken, sessionDurations, sessionHash, validSessionToken } from '../domain/session';

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;
  constructor(private readonly repository: AuthRepository) {}

  async login(email: string, password: string, previous: string) {
    try {
      const user = await this.repository.findUser(normalizeEmail(email));
      if (!user) this.dummyHash ||= argon2.hash(randomBytes(32), { type: argon2.argon2id });
      const verified = await argon2.verify(user?.passwordHash || await this.dummyHash!, password);
      if (!verified || !user) throw new UnauthorizedException('Correo o contraseña incorrectos.');
      const token = newSessionToken();
      const now = new Date();
      const expires = new Date(now.getTime() + sessionDurations().absolute);
      await this.repository.createSession(user.id, sessionHash(token), validSessionToken(previous) ? sessionHash(previous) : undefined, now, expires);
      return { token, expires, user: { id: user.id, email: user.correoOriginal } };
    } catch (error) { if (error instanceof UnauthorizedException) throw error; throw new InternalServerErrorException('No se pudo completar el acceso.'); }
  }

  async authenticate(token: string) {
    if (!validSessionToken(token)) throw new UnauthorizedException('Sesión no válida o caducada.');
    try {
      const now = new Date();
      const user = await this.repository.authenticate(sessionHash(token), now, new Date(now.getTime() - sessionDurations().idle));
      if (!user) throw new UnauthorizedException('Sesión no válida o caducada.');
      return user;
    } catch (error) { if (error instanceof UnauthorizedException) throw error; throw new InternalServerErrorException('No se pudo comprobar la sesión.'); }
  }

  async logout(token: string) {
    try { await this.repository.revoke(sessionHash(token), new Date()); }
    catch { throw new InternalServerErrorException('No se pudo cerrar la sesión.'); }
  }
}
