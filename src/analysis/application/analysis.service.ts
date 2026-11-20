import { HttpException, Injectable, InternalServerErrorException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { AnalysisRepository } from '../infrastructure/analysis.repository';
import { ManualEngine } from './manual-engine';
import { codes, unavailable } from '../domain/checks';

@Injectable()
export class AnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly running = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private reserved = 0;
  private recovery?: Promise<void>;
  constructor(private readonly repository: AnalysisRepository, private readonly engine: ManualEngine) {}
  async onModuleInit() {
    await this.recover();
    this.timer = setInterval(() => { void this.recover(); }, 15000);
    this.timer.unref();
  }
  private recover(): Promise<void> {
    if (this.recovery) return this.recovery;
    this.recovery = (async () => {
      try { await this.repository.expire(); } catch { /* Retry next interval without exposing database internals. */ }
    })().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }
  async onModuleDestroy() { this.stopped = true; clearInterval(this.timer); await Promise.allSettled([...this.running, ...(this.recovery ? [this.recovery] : [])]); }
  private async safe<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { if (error instanceof HttpException) throw error; throw new InternalServerErrorException('No se pudo completar la operación de análisis.'); } }
  history(owner: string, site: string) { return this.safe(() => this.repository.history(owner, site)); }
  detail(owner: string, site: string, id: string) { return this.safe(() => this.repository.detail(owner, site, id)); }
  compare(owner: string, site: string, before: string, after: string) { return this.safe(() => this.repository.compare(owner, site, before, after)); }
  start(owner: string, site: string): Promise<{ id: string; estado: string }>;
  start(owner: string, site: string, scheduled: Date): Promise<{ id: string; estado: string } | null>;
  async start(owner: string, site: string, scheduled?: Date): Promise<{ id: string; estado: string } | null> {
    if (this.stopped || this.reserved >= 2) throw new ServiceUnavailableException('Hay dos análisis en curso. Inténtalo más tarde.');
    this.reserved++;
    try {
      const job = await this.safe(() => this.repository.start(owner, site, scheduled));
      if (!job) { this.reserved--; return null; }
      const task = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.execute(job.id)).finally(() => { this.reserved--; this.running.delete(task); });
      this.running.add(task);
      return job;
    } catch (error) { this.reserved--; throw error; }
  }
  private async execute(id: string) {
    let version: number | undefined;
    try {
      const claim = await this.repository.claim(id); if (!claim) return;
      version = claim.version;
      const result = await this.engine.run(claim.domain);
      await this.repository.finish(id, version, result.results, result.failed);
    } catch {
      if (version !== undefined) await this.repository.finish(id, version, codes.map(code => unavailable(code, 'Ejecución interrumpida.')), true).catch(() => {});
      // Persistence failure stays leased and is marked failed by expiry; never log driver data.
    }
  }
}
