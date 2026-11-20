import { Injectable } from '@nestjs/common';

@Injectable()
export class MonitoringPolicy {
  // DP-08 approved: each owner must explicitly opt in per site.
  readonly allowedMinutes: number[] = [1440, 10080];
  readonly warningDays: number | null;
  constructor() {
    const days = Number(process.env.NEXOGUARD_CERT_WARNING_DAYS ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Ventana de aviso de certificados no válida.');
    this.warningDays = days;
  }
}
