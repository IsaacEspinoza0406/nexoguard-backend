import { codes } from './checks';
import { guidanceFor } from './recommendations';

export type HistoricalResult = { codigoComprobacion: string; estado: string; evidencia: unknown; observadoEn: Date | null };
export type HistoricalAnalysis = { id: string; estado: string; procedencia: string; creadoEn: Date; resultados: HistoricalResult[] };

// Require the evidence used by each manual-v1 decision, not merely a status label.
function supported(result: HistoricalResult): boolean {
  const e = result.evidencia;
  if (!e || typeof e !== 'object' || Array.isArray(e) || !result.observadoEn || !Number.isFinite(result.observadoEn.getTime())) return false;
  const v = e as Record<string, unknown>;
  if (v.rulesVersion !== 'manual-v1') return false;
  const bool = (key: string) => typeof v[key] === 'boolean';
  const status = () => typeof v.status === 'number' && Number.isInteger(v.status) && v.status >= 100 && v.status <= 599;
  switch (result.codigoComprobacion) {
    case 'HTTP_REDIRECT': return status() && bool('redirectsToSameDomainHttps');
    case 'HTTPS': return bool('authenticated') && (v.authenticated === true ? status() : v.tlsReached === true);
    case 'CERTIFICATE': return bool('trusted') && bool('identityMatches');
    case 'CERTIFICATE_EXPIRY': return ['validFrom', 'validTo'].every(k => typeof v[k] === 'string' && Number.isFinite(Date.parse(v[k] as string))) && typeof v.daysRemaining === 'number' && Number.isFinite(v.daysRemaining);
    case 'HSTS': return bool('positiveMaxAge');
    case 'CSP': return bool('present');
    case 'FRAMING': return bool('restrictiveFramePolicy');
    case 'NOSNIFF': return bool('nosniff');
    case 'REFERRER': return bool('explicitRestrictivePolicy');
    case 'COOKIE_SECURE': case 'COOKIE_HTTPONLY': case 'COOKIE_SAMESITE': {
      const key = { COOKIE_SECURE: 'withSecure', COOKIE_HTTPONLY: 'withHttpOnly', COOKIE_SAMESITE: 'withExplicitValidSameSite' }[result.codigoComprobacion];
      return typeof v.count === 'number' && Number.isInteger(v.count) && v.count > 0 && typeof v[key] === 'number' && Number.isInteger(v[key]) && v[key] >= 0 && v[key] <= v.count;
    }
    default: return false;
  }
}

export function compareAnalyses(before: HistoricalAnalysis, after: HistoricalAnalysis) {
  const allCodes = [...new Set<string>([...codes, ...before.resultados.map(r => r.codigoComprobacion), ...after.resultados.map(r => r.codigoComprobacion)])];
  return allCodes.map(code => {
    const left = before.resultados.filter(r => r.codigoComprobacion === code), right = after.resultados.filter(r => r.codigoComprobacion === code);
    const a = left[0], b = right[0];
    let change: 'MEJORO' | 'EMPEORO' | 'IGUAL' | 'NO_COMPARABLE' = 'NO_COMPARABLE';
    let reason = 'Falta evidencia compatible y evaluada en ambos análisis.';
    if (before.estado !== 'COMPLETADO' || after.estado !== 'COMPLETADO') reason = 'Ambos análisis deben estar completados; un fallo no demuestra una mejora.';
    else if (before.procedencia !== 'manual-v1' || after.procedencia !== 'manual-v1') reason = 'Las reglas de origen no son compatibles con manual-v1.';
    else if (left.length === 1 && right.length === 1 && a && b && ['APROBADO', 'HALLAZGO'].includes(a.estado) && ['APROBADO', 'HALLAZGO'].includes(b.estado) && supported(a) && supported(b)) {
      change = a.estado === b.estado ? 'IGUAL' : b.estado === 'APROBADO' ? 'MEJORO' : 'EMPEORO';
      reason = change === 'IGUAL' ? 'Mismo estado evaluado; la evidencia técnica puede haber cambiado.' : change === 'MEJORO' ? 'De hallazgo a comprobación aprobada según manual-v1.' : 'De comprobación aprobada a hallazgo según manual-v1.';
    }
    return { code, before: a?.estado ?? null, after: b?.estado ?? null, change, reason, guidance: guidanceFor(code) };
  });
}
