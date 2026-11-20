import { BadRequestException } from '@nestjs/common';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

export const VERIFICATION_PATH = '/.well-known/nexoguard-verification.txt';
export const CHALLENGE_MS = 30 * 60 * 1000;
export const VERIFIED_MS = 30 * 24 * 60 * 60 * 1000;

export function canonicalDomain(input: string): string {
  const fail = () => { throw new BadRequestException('Introduce un dominio público, sin URL, puerto ni ruta.'); };
  const raw = input.trim().toLowerCase().replace(/\.$/, '');
  if (!raw || /[\s/:@\\?#%\[\]]/.test(raw)) return fail();
  const domain = domainToASCII(raw);
  const labels = domain.split('.');
  if (!domain || domain.length > 253 || isIP(domain) || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z][a-z0-9-]*$/.test(labels.at(-1)!)) return fail();
  if (['localhost', 'local', 'internal', 'invalid', 'test', 'example', 'onion', 'arpa'].includes(labels.at(-1)!)) return fail();
  return domain;
}

export function challengeHash(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(value).digest());
}
