import { HttpException, Injectable, InternalServerErrorException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { MonitoringRepository } from '../infrastructure/monitoring.repository';
import { AnalysisService } from './analysis.service';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private running?: Promise<void>;
  private stopped = false;
  constructor(private readonly repository: MonitoringRepository, private readonly analyses: AnalysisService) {}
  async onModuleInit() { await this.tick(); }
  async onModuleDestroy() { this.stopped = true; await this.running; }
  @Interval(15000)
  tick(now = new Date()): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        for (const row of await this.repository.due(now)) {
          if (this.stopped) break;
          try { await this.analyses.start(row.configuradoPorId, row.sitioId, now); }
          catch (error) { if (error instanceof HttpException && error.getStatus() === 503) break; /* Other sites remain eligible; no internal data logged. */ }
        }
      } catch { /* Persistent due dates survive DB failure; next tick retries without catch-up bursts. */ }
    })().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async safe<T>(work: () => Promise<T>) { try { return await work(); } catch (error) { if (error instanceof HttpException) throw error; throw new InternalServerErrorException('No se pudo completar la operación de monitoreo.'); } }
  get(owner: string, site: string) { return this.safe(() => this.repository.get(owner, site)); }
  configure(owner: string, site: string, enabled: boolean, minutes: number) { return this.safe(() => this.repository.configure(owner, site, enabled, minutes, new Date())); }
  alerts(owner: string, site: string) { return this.safe(() => this.repository.alerts(owner, site)); }
  read(owner: string, site: string, id: string) { return this.safe(() => this.repository.read(owner, site, id, new Date())); }
}
