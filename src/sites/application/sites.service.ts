import { BadRequestException, ConflictException, HttpException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SitesRepository } from '../infrastructure/sites.repository';
import { OwnershipFileReader } from '../infrastructure/ownership-file.reader';
import { canonicalDomain, challengeHash, CHALLENGE_MS, VERIFIED_MS, VERIFICATION_PATH } from '../domain/domain';

@Injectable()
export class SitesService {
  constructor(private readonly repository: SitesRepository, private readonly reader: OwnershipFileReader) {}

  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('Ya registraste ese dominio.');
      throw new InternalServerErrorException('No se pudo completar la operación de sitios.');
    }
  }

  private view(site: Awaited<ReturnType<SitesRepository['create']>>) {
    const challenge = site.revisionActual?.verificaciones[0];
    const verified = challenge?.verificadoEn && challenge.verificacionValidaHasta && challenge.verificacionValidaHasta.getTime() > Date.now();
    return { id: site.id, domain: site.dominioCanonico, createdAt: site.creadoEn, status: verified ? 'verified' : challenge && !challenge.verificadoEn && challenge.desafioExpiraEn.getTime() > Date.now() ? 'pending' : 'unverified', verification: challenge ? { id: challenge.id, expiresAt: challenge.desafioExpiraEn, verifiedAt: challenge.verificadoEn, validUntil: challenge.verificacionValidaHasta } : null };
  }

  list(owner: string) { return this.safe(async () => (await this.repository.list(owner)).map(site => this.view(site))); }
  create(owner: string, domain: string) { return this.safe(async () => this.view(await this.repository.create(owner, canonicalDomain(domain)))); }

  issue(owner: string, id: string) {
    return this.safe(async () => {
      const code = `nexoguard-verification=${randomBytes(32).toString('hex')}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CHALLENGE_MS);
      const challenge = await this.repository.issue(owner, id, challengeHash(code), expiresAt, now);
      return { id: challenge.id, content: code, url: `https://${challenge.domain}${VERIFICATION_PATH}`, expiresAt };
    });
  }

  verify(owner: string, id: string, challengeId: string) {
    return this.safe(async () => {
      const challenge = await this.repository.pending(owner, id, challengeId);
      if (challenge.verificadoEn || challenge.desafioExpiraEn.getTime() <= Date.now()) throw new ConflictException('El desafío caducó o ya fue utilizado. Genera otro.');
      const content = await this.reader.read(challenge.domain);
      const actual = challengeHash(content);
      if (!/^nexoguard-verification=[0-9a-f]{64}$/.test(content) || !timingSafeEqual(actual, challenge.codigoHash)) throw new BadRequestException('El archivo no contiene el código esperado.');
      const now = new Date();
      return this.repository.complete(owner, id, challengeId, now, new Date(now.getTime() + VERIFIED_MS));
    });
  }
}
