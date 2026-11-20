import 'reflect-metadata';
import { jest } from '@jest/globals';
import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import { canonicalDomain, challengeHash, CHALLENGE_MS, VERIFIED_MS } from '../src/sites/domain/domain';
import { SitesService } from '../src/sites/application/sites.service';
import { SitesRepository } from '../src/sites/infrastructure/sites.repository';
import { OwnershipFileReader, isPublicAddress } from '../src/sites/infrastructure/ownership-file.reader';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

describe('Normalización de dominios', () => {
  it.each([[' EXAMPLE.COM. ', 'example.com'], ['MÜNICH.de', 'xn--mnich-kva.de'], ['www.Example.com', 'www.example.com']])('%s → %s', (input, expected) => expect(canonicalDomain(input)).toBe(expected));
  it.each(['', 'localhost', 'app.local', 'demo.test', 'a.invalid', 'http://example.com', 'example.com:443', 'example.com/path', 'user@example.com', '127.0.0.1', '[::1]', '-x.com', 'a..com', '*.example.com', 'x.com?query', `${'a'.repeat(64)}.com`])('rechaza %s', input => expect(() => canonicalDomain(input)).toThrow());
});

describe('Destinos y lectura de archivo (DNS/HTTPS simulados)', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', 'not-ip'])('bloquea %s', address => expect(isPublicAddress(address)).toBe(false));
  it.each(['93.184.215.14', '8.8.8.8', '2606:4700:4700::1111'])('permite dirección pública %s', address => expect(isPublicAddress(address)).toBe(true));

  it('fija la conexión a la IP validada y no vuelve a resolver', async () => {
    const reader = new OwnershipFileReader();
    const resolve = jest.spyOn(reader, 'resolve').mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
    const download = jest.spyOn(reader, 'download').mockResolvedValue('contenido');
    expect(await reader.read('example.com')).toBe('contenido');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('example.com', '93.184.215.14', 4);
  });
  it('rechaza DNS mixto sin realizar ninguna petición HTTPS', async () => {
    const reader = new OwnershipFileReader();
    jest.spyOn(reader, 'resolve').mockResolvedValue([{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    const download = jest.spyOn(reader, 'download');
    await expect(reader.read('example.com')).rejects.toBeInstanceOf(BadGatewayException);
    expect(download).not.toHaveBeenCalled();
  });
  it.each(['DNS', 'HTTPS'])('devuelve error seguro ante fallo de %s y libera el cupo', async kind => {
    const reader = new OwnershipFileReader();
    const resolve = jest.spyOn(reader, 'resolve').mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
    const download = jest.spyOn(reader, 'download').mockResolvedValue('ok');
    if (kind === 'DNS') resolve.mockRejectedValueOnce(new Error('detalle interno'));
    else download.mockRejectedValueOnce(new Error('detalle interno'));
    await expect(reader.read('example.com')).rejects.toThrow('No se pudo leer el archivo.');
    expect(await reader.read('example.com')).toBe('ok');
  });
  it('limita cuatro verificaciones simultáneas y libera los recursos', async () => {
    const reader = new OwnershipFileReader();
    let finish!: (value: { address: string; family: number }[]) => void;
    const dns = new Promise<{ address: string; family: number }[]>(resolve => { finish = resolve; });
    jest.spyOn(reader, 'resolve').mockReturnValue(dns);
    jest.spyOn(reader, 'download').mockResolvedValue('ok');
    const pending = Array.from({ length: 4 }, () => reader.read('example.com'));
    await expect(reader.read('example.com')).rejects.toThrow('Hay verificaciones en curso.');
    finish([{ address: '93.184.215.14', family: 4 }]);
    expect(await Promise.all(pending)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(await reader.read('example.com')).toBe('ok');
  });
});

describe('Casos de uso de sitios (repositorio simulado)', () => {
  const code = `nexoguard-verification=${'a'.repeat(64)}`;
  function setup() {
    const repository = {
      list: jest.fn<SitesRepository['list']>(), create: jest.fn<SitesRepository['create']>(),
      issue: jest.fn<SitesRepository['issue']>().mockResolvedValue({ id: 'challenge', domain: 'example.com' }),
      pending: jest.fn<SitesRepository['pending']>().mockResolvedValue({ id: 'challenge', domain: 'example.com', codigoHash: challengeHash(code), desafioExpiraEn: new Date(Date.now() + 60000), verificadoEn: null }),
      complete: jest.fn<SitesRepository['complete']>().mockImplementation(async (_owner, _id, _challenge, verifiedAt, validUntil) => ({ verifiedAt, validUntil })),
    };
    const reader = { read: jest.fn<OwnershipFileReader['read']>().mockResolvedValue(code) };
    return { repository, reader, service: new SitesService(repository as unknown as SitesRepository, reader as unknown as OwnershipFileReader) };
  }
  it('normaliza antes de persistir y devuelve solo campos públicos', async () => {
    const { service, repository } = setup();
    repository.create.mockResolvedValue({ id: 's', dominioCanonico: 'example.com', creadoEn: new Date(), revisionActual: { verificaciones: [] } });
    expect(await service.create('owner', ' EXAMPLE.COM. ')).toEqual(expect.objectContaining({ id: 's', domain: 'example.com', status: 'unverified', verification: null }));
    expect(repository.create).toHaveBeenCalledWith('owner', 'example.com');
  });
  it('traduce la restricción UNIQUE incluso en concurrencia', async () => {
    const { service, repository } = setup();
    repository.create.mockRejectedValue({ code: 'P2002', secret: 'detalle privado' });
    await expect(service.create('owner', 'example.com')).rejects.toBeInstanceOf(ConflictException);
  });
  it('oculta errores de persistencia', async () => {
    const { service, repository } = setup();
    repository.list.mockRejectedValue(new Error('detalle privado'));
    await expect(service.list('owner')).rejects.toThrow('No se pudo completar la operación de sitios.');
  });
  it('genera códigos distintos, almacena solo hash y fija caducidad', async () => {
    const { service, repository } = setup();
    const before = Date.now();
    const first = await service.issue('owner', 's');
    const second = await service.issue('owner', 's');
    expect(first.content).toMatch(/^nexoguard-verification=[a-f0-9]{64}$/);
    expect(second.content).not.toEqual(first.content);
    expect(first.expiresAt.getTime()).toBeGreaterThanOrEqual(before + CHALLENGE_MS);
    expect(repository.issue.mock.calls[0][2]).toEqual(challengeHash(first.content));
    expect(first.url).toBe('https://example.com/.well-known/nexoguard-verification.txt');
  });
  it('verifica archivo correcto y fija validez', async () => {
    const { service, repository } = setup();
    const result = await service.verify('owner', 's', 'challenge');
    expect(result.validUntil.getTime() - result.verifiedAt.getTime()).toBe(VERIFIED_MS);
    expect(repository.complete).toHaveBeenCalledWith('owner', 's', 'challenge', expect.any(Date), expect.any(Date));
  });
  it('rechaza archivo incorrecto sin marcar verificado', async () => {
    const { service, repository, reader } = setup();
    reader.read.mockResolvedValue(`nexoguard-verification=${'b'.repeat(64)}`);
    await expect(service.verify('owner', 's', 'challenge')).rejects.toThrow('El archivo no contiene el código esperado.');
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it('rechaza desafío caducado antes de consultar DNS', async () => {
    const { service, repository, reader } = setup();
    repository.pending.mockResolvedValue({ id: 'c', domain: 'example.com', codigoHash: challengeHash(code), desafioExpiraEn: new Date(0), verificadoEn: null });
    await expect(service.verify('owner', 's', 'c')).rejects.toBeInstanceOf(ConflictException);
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('no consulta red para sitios ajenos', async () => {
    const { service, repository, reader } = setup();
    repository.pending.mockRejectedValue(new NotFoundException('Sitio no encontrado.'));
    await expect(service.verify('other', 's', 'c')).rejects.toBeInstanceOf(NotFoundException);
    expect(reader.read).not.toHaveBeenCalled();
  });
  it('conserva error DNS seguro y no guarda éxito', async () => {
    const { service, repository, reader } = setup();
    reader.read.mockRejectedValue(new BadGatewayException('DNS no disponible.'));
    await expect(service.verify('owner', 's', 'c')).rejects.toBeInstanceOf(BadGatewayException);
    expect(repository.complete).not.toHaveBeenCalled();
  });
  it('no resucita un desafío renovado durante la petición de red', async () => {
    const { service, repository } = setup();
    repository.complete.mockRejectedValue(new ConflictException('Renovado.'));
    await expect(service.verify('owner', 's', 'c')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Alcance de consultas Prisma (sin MySQL)', () => {
  it('incluye propietario al listar y consultar desafíos', async () => {
    const findMany = jest.fn<() => Promise<never[]>>().mockResolvedValue([]);
    const findFirst = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const repository = new SitesRepository({ sitio: { findMany, findFirst } } as unknown as PrismaService);
    await repository.list('owner');
    await expect(repository.pending('other', 's', 'c')).rejects.toBeInstanceOf(NotFoundException);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { propietarioId: 'owner' } }));
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's', propietarioId: 'other' } }));
  });
  it('condiciona confirmación al propietario, revisión, vigencia y no invalidación', async () => {
    const query = jest.fn<() => Promise<never[]>>().mockResolvedValue([]);
    const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 0 });
    const tx = { $queryRaw: query, sitio: { findFirst: async () => ({ dominioCanonico: 'example.com', revisionActualId: 'r' }) }, verificacionDominio: { updateMany } };
    const repository = new SitesRepository({ $transaction: async (run: (value: typeof tx) => unknown) => run(tx) } as unknown as PrismaService);
    const now = new Date();
    await expect(repository.complete('owner', 's', 'c', now, now)).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls[0]).toEqual(expect.arrayContaining(['s', 'owner']));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', revisionDominioId: 'r', invalidadoEn: null, verificadoEn: null, desafioExpiraEn: { gt: now } } }));
  });
});
