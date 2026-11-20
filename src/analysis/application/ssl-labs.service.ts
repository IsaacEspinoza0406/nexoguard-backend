import { BadRequestException, HttpException, Injectable, InternalServerErrorException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SslLabsClient } from '../infrastructure/ssl-labs.client';
import { SslLabsRepository } from '../infrastructure/ssl-labs.repository';
import { AnalysisNetwork } from '../infrastructure/analysis-network';
import { providerReport, retryDelay, SslReport } from '../domain/ssl-labs';

@Injectable()
export class SslLabsService implements OnModuleInit, OnModuleDestroy {
  private running?: Promise<void>;
  private stopped = false;
  constructor(private readonly repository: SslLabsRepository, private readonly client: SslLabsClient, private readonly network: AnalysisNetwork) {}
  async onModuleInit() { await this.tick(); }
  async onModuleDestroy() { this.stopped = true; await this.running; }
  @Interval(15000)
  tick(now = new Date()): Promise<void> {
    if (this.stopped || !this.client.configured()) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.work(now).catch(() => { /* DB failure preserves leases; no provider/configuration details are logged. */ }).finally(() => { this.running = undefined; });
    return this.running;
  }
  private async work(now: Date) {
    const claim = await this.repository.claim(now); if (!claim) return;
    let report: SslReport = { ...claim.report }, delay = 30000;
    try {
      await this.network.destination(claim.domain); // Revalidate the authorized target before disclosure to Qualys.
      const info = await this.client.get('info');
      if (info.status !== 200) ({ report, delay } = this.failure(info.status, info.retryAfter, report, now));
      else {
        const d = info.data as Record<string, unknown> | null;
        const maximum = d?.maxAssessments, current = d?.currentAssessments, coolOff = d?.newAssessmentCoolOff;
        if (typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 1 || typeof current !== 'number' || !Number.isInteger(current) || current < 0 || typeof coolOff !== 'number' || !Number.isFinite(coolOff) || coolOff < 0 || coolOff > 31536000000) throw new Error('INVALID_PROVIDER_INFO');
        delay = Math.max(10000, coolOff);
        if (!report.submitted && current >= maximum) {
          report = { ...report, phase: 'WAITING', reason: 'Capacidad del proveedor ocupada; se consultará más tarde.' }; delay = Math.max(60000, delay);
        } else {
          if (!await this.repository.authorized(claim.id, report.requestedBy, claim.domain, new Date(Math.max(now.getTime(), Date.now())))) throw new Error('AUTHORIZATION_EXPIRED');
          await this.network.destination(claim.domain);
          const response = await this.client.get('analyze', claim.domain);
          if (response.status !== 200) { const failed = this.failure(response.status, response.retryAfter, report, now); report = failed.report; delay = Math.max(delay, failed.delay); }
          else {
            report = providerReport(response.data, claim.domain, report, now);
            delay = Math.max(delay, report.phase === 'DNS' ? 5000 : 10000);
            if (Number.isFinite(response.maximum) && response.maximum > 0 && Number.isFinite(response.current) && response.current >= response.maximum) delay = Math.max(delay, 60000);
          }
        }
      }
    } catch { report = { ...report, phase: 'ERROR', reason: 'No se pudo consultar o validar la respuesta de SSL Labs. Los resultados propios siguen disponibles.' }; }
    // Use actual wall time after HTTP, but preserve a controlled logical clock in tests.
    const ended = new Date(Math.max(now.getTime(), Date.now()));
    await this.repository.finish(claim, report, delay, ended);
  }
  private failure(status: number, retryAfter: unknown, report: SslReport, now: Date) {
    if ([429, 503, 529].includes(status)) return { report: { ...report, phase: 'WAITING' as const, reason: status === 429 ? 'El proveedor limitó las solicitudes; consulta aplazada.' : 'El proveedor no está disponible; consulta aplazada.' }, delay: retryDelay(status, retryAfter, now) + 1000 };
    return { report: { ...report, phase: 'ERROR' as const, reason: [401, 403, 441].includes(status) ? 'SSL Labs rechazó la configuración de registro. Revisa la configuración privada del backend.' : 'SSL Labs no pudo atender la consulta. Los resultados propios siguen disponibles.' }, delay: 60000 };
  }
  private async safe<T>(work: () => Promise<T>) { try { return await work(); } catch (e) { if (e instanceof HttpException) throw e; throw new InternalServerErrorException('No se pudo completar la operación SSL Labs.'); } }
  history(owner: string, site: string) { return this.safe(async () => ({ configured: this.client.configured(), reason: this.client.configured() ? null : 'Configura SSLLABS_ENABLED y un correo institucional registrado en SSLLABS_EMAIL.', reports: await this.repository.history(owner, site) })); }
  start(owner: string, site: string, consent: boolean) {
    return this.safe(async () => {
      if (consent !== true) throw new BadRequestException('Debes autorizar que Qualys evalúe este dominio.');
      if (!this.client.configured()) throw new ServiceUnavailableException('SSL Labs requiere habilitación y un correo institucional registrado en la configuración privada.');
      return this.repository.start(owner, site, new Date());
    });
  }
}
