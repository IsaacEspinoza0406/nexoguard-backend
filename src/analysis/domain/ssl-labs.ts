export const SSL_SOURCE = 'ssllabs-v4';
export const SSL_CODE = 'SSL_LABS_V4';
export type SslReport = {
  provider: string; phase: 'PENDING' | 'WAITING' | 'DNS' | 'IN_PROGRESS' | 'READY' | 'ERROR';
  reason: string | null; requestedBy: string; requestedAt: string; fetchedAt: string | null;
  submitted: boolean;
  startTime: string | null; testTime: string | null; engineVersion: string | null; criteriaVersion: string | null;
  endpoints: { endpoint: number; status: 'READY' | 'ERROR' | 'PENDING'; grade: string | null; hasWarnings: boolean }[];
};
export function initialSslReport(owner: string, now: Date): SslReport {
  return { provider: 'Qualys SSL Labs API v4', phase: 'PENDING', reason: null, requestedBy: owner, requestedAt: now.toISOString(), fetchedAt: null, submitted: false, startTime: null, testTime: null, engineVersion: null, criteriaVersion: null, endpoints: [] };
}
export function storedSslReport(value: unknown): SslReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as SslReport;
  return typeof r.requestedBy === 'string' && typeof r.requestedAt === 'string' && ['PENDING', 'WAITING', 'DNS', 'IN_PROGRESS', 'READY', 'ERROR'].includes(r.phase) && Array.isArray(r.endpoints) ? r : null;
}
export function publicSslReport(value: unknown) {
  const report = storedSslReport(value);
  if (!report) return null;
  const { requestedBy: _owner, ...safe } = report;
  void _owner;
  return safe;
}
function version(value: unknown): string | null { return typeof value === 'string' && /^[\w.+-]{1,40}$/.test(value) ? value : null; }
function date(value: unknown): string | null { return typeof value === 'number' && value > 0 && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null; }
export function providerReport(data: unknown, domain: string, previous: SslReport, now: Date): SslReport {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_PROVIDER_RESPONSE');
  const d = data as Record<string, unknown>;
  if (d.host !== domain || (d.port != null && d.port !== 443) || !['DNS', 'IN_PROGRESS', 'READY', 'ERROR'].includes(String(d.status))) throw new Error('INVALID_PROVIDER_RESPONSE');
  if (d.endpoints != null && !Array.isArray(d.endpoints)) throw new Error('INVALID_PROVIDER_RESPONSE');
  const grades = ['A+', 'A', 'A-', 'B', 'C', 'D', 'E', 'F', 'T', 'M'];
  const endpoints = (Array.isArray(d.endpoints) ? d.endpoints.slice(0, 20) : []).map((e: Record<string, unknown>, index: number) => {
    if (!e || typeof e !== 'object') throw new Error('INVALID_PROVIDER_RESPONSE');
    const ready = e.statusMessage === 'Ready';
    return { endpoint: index + 1, status: ready ? 'READY' as const : d.status === 'READY' || d.status === 'ERROR' ? 'ERROR' as const : 'PENDING' as const, grade: ready && typeof e.grade === 'string' && grades.includes(e.grade) ? e.grade : null, hasWarnings: e.hasWarnings === true };
  });
  if (d.status === 'READY' && (!endpoints.length || !date(d.testTime))) throw new Error('INCOMPLETE_PROVIDER_REPORT');
  return { ...previous, submitted: true, phase: d.status as SslReport['phase'], reason: d.status === 'ERROR' ? 'El proveedor no pudo completar la evaluación.' : null, fetchedAt: now.toISOString(), startTime: date(d.startTime), testTime: date(d.testTime), engineVersion: version(d.engineVersion), criteriaVersion: version(d.criteriaVersion), endpoints };
}
export function retryDelay(status: number, retryAfter: unknown, now: Date) {
  const base = status === 529 ? 1800000 : status === 503 ? 900000 : 60000;
  const seconds = typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : NaN;
  const absolute = typeof retryAfter === 'string' ? Date.parse(retryAfter) - now.getTime() : NaN;
  return Math.min(31536000000, Math.max(base, Number.isFinite(seconds) ? seconds : Number.isFinite(absolute) ? absolute : 0));
}
