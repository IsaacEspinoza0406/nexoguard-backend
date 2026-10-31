import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { normalizeEmail } from '../domain/registration';
import { UserRepository } from '../infrastructure/user.repository';

@Injectable()
export class RegisterUserService {
  constructor(private readonly users: UserRepository) {}

  async register(email: string, password: string): Promise<{ id: string }> {
    try {
      const hash = await argon2.hash(password, { type: argon2.argon2id });
      return await this.users.create(email.trim(), normalizeEmail(email), hash);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('No se pudo completar el registro.');
    }
  }
}
