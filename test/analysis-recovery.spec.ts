import 'reflect-metadata';
import { jest } from '@jest/globals';
import { AnalysisService } from '../src/analysis/application/analysis.service';
import { AnalysisRepository } from '../src/analysis/infrastructure/analysis.repository';
import { ManualEngine } from '../src/analysis/application/manual-engine';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

it('recupera al arrancar, reintenta tras fallo de DB y libera temporizadores al cerrar', async () => {
  jest.useFakeTimers();
  const expire = jest.fn<AnalysisRepository['expire']>().mockRejectedValueOnce(new Error('private DB error')).mockResolvedValue({ count: 1 });
  const service = new AnalysisService({ expire } as unknown as AnalysisRepository, {} as ManualEngine);
  try {
    await service.onModuleInit(); expect(expire).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15000); expect(expire).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy(); await jest.advanceTimersByTimeAsync(30000);
    expect(expire).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});

it('no solapa tareas de recuperación cuando MySQL responde lentamente', async () => {
  jest.useFakeTimers();
  let release!: (value: { count: number }) => void;
  const expire = jest.fn<() => Promise<{ count: number }>>().mockResolvedValueOnce({ count: 0 }).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const service = new AnalysisService({ expire } as unknown as AnalysisRepository, {} as ManualEngine);
  try {
    await service.onModuleInit(); await jest.advanceTimersByTimeAsync(45000);
    expect(expire).toHaveBeenCalledTimes(2);
    release({ count: 0 }); await service.onModuleDestroy();
  } finally { jest.useRealTimers(); }
});

it('incluye reclamos vencidos y trabajos antiguos sin reclamo, sin tocar terminales ni trabajos nuevos', async () => {
  const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 0 });
  const repository = new AnalysisRepository({ analisis: { updateMany } } as unknown as PrismaService);
  await repository.expire();
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ estado: { in: ['PENDIENTE', 'EN_EJECUCION'] }, OR: expect.arrayContaining([
      { reclamoExpiraEn: { lte: expect.any(Date) } },
      expect.objectContaining({ reclamoExpiraEn: null, OR: expect.arrayContaining([
        { estado: 'PENDIENTE', creadoEn: { lte: expect.any(Date) } },
        { estado: 'EN_EJECUCION', iniciadoEn: { lte: expect.any(Date) } },
      ]) }),
    ]) }), data: expect.objectContaining({ estado: 'FALLIDO', versionReclamo: { increment: 1 } }),
  }));
});
