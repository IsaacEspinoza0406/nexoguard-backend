export type Status = 'APROBADO' | 'HALLAZGO' | 'NO_APLICABLE' | 'NO_EVALUADO';
export type Check = { code: string; status: Status; evidence: Record<string, string | number | boolean | null>; recommendation: string };
export type CertificateObservation = { trusted: boolean; identity: boolean; validFrom: string | null; validTo: string | null };
export type PageObservation = { status: number; headers: Record<string, string>; cookies: string[] };
export const codes = ['HTTP_REDIRECT', 'HTTPS', 'CERTIFICATE', 'CERTIFICATE_EXPIRY', 'HSTS', 'CSP', 'FRAMING', 'NOSNIFF', 'REFERRER', 'COOKIE_SECURE', 'COOKIE_HTTPONLY', 'COOKIE_SAMESITE'] as const;
export function check(code: string, status: Status, evidence: Check['evidence'], recommendation: string): Check { return { code, status, evidence, recommendation }; }
export function unavailable(code: string, reason: string) { return check(code, 'NO_EVALUADO', { reason }, 'Restablece la conexión o corrige el destino y repite el análisis.'); }

export function certificateChecks(cert: CertificateObservation, now = Date.now()): Check[] {
  const from = cert.validFrom ? Date.parse(cert.validFrom) : NaN, to = cert.validTo ? Date.parse(cert.validTo) : NaN;
  const dated = Number.isFinite(from) && Number.isFinite(to);
  return [
    check('CERTIFICATE', cert.trusted && cert.identity ? 'APROBADO' : 'HALLAZGO', { trusted: cert.trusted, identityMatches: cert.identity }, 'Instala una cadena de confianza completa y un certificado emitido para el dominio. Comprueba el nombre y la cadena con un cliente TLS.'),
    dated ? check('CERTIFICATE_EXPIRY', from <= now && now < to ? 'APROBADO' : 'HALLAZGO', { validFrom: cert.validFrom, validTo: cert.validTo, daysRemaining: Math.floor((to - now) / 86400000) }, 'Renueva el certificado antes de su vencimiento y verifica las fechas tras instalarlo. Los avisos de proximidad utilizan la ventana de monitoreo configurada y las observaciones de cada análisis.') : unavailable('CERTIFICATE_EXPIRY', 'No se obtuvieron fechas válidas del certificado.'),
  ];
}

export function pageChecks(page: PageObservation): Check[] {
  const h = page.headers;
  const csp = h['content-security-policy'] || '';
  const maxAges = (h['strict-transport-security'] || '').split(';').map(value => value.trim()).filter(value => /^max-age\s*=/i.test(value));
  const positiveMaxAge = maxAges.length === 1 && /^max-age\s*=\s*[1-9]\d*$/i.test(maxAges[0]);
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(csp);
  // An enforced CSP frame-ancestors overrides X-Frame-Options in modern browsers.
  const restrictiveFramePolicy = ancestors ? /^\s*'(none|self)'\s*$/i.test(ancestors[1]) : /^(DENY|SAMEORIGIN)$/i.test(h['x-frame-options'] || '');
  // Only a structural check: CSP efficacy depends on the application and is never inferred here.
  const rules: Check[] = [
    check('HSTS', positiveMaxAge ? 'APROBADO' : 'HALLAZGO', { positiveMaxAge }, 'Configura Strict-Transport-Security con max-age positivo tras comprobar HTTPS. Revisa la cabecera con un cliente HTTP; subdominios y preload requieren evaluación propia.'),
    check('CSP', csp ? 'NO_EVALUADO' : 'HALLAZGO', { present: !!csp }, 'Define una Content-Security-Policy adaptada a los recursos de la aplicación. Su presencia no demuestra eficacia: revisa directivas, fuentes y comportamiento en el navegador.'),
    check('FRAMING', restrictiveFramePolicy ? 'APROBADO' : 'HALLAZGO', { restrictiveFramePolicy }, 'Para páginas que no deben incrustarse externamente, configura frame-ancestors o X-Frame-Options. Comprueba que la política permite las integraciones legítimas y bloquea marcos no autorizados.'),
    check('NOSNIFF', (h['x-content-type-options'] || '').toLowerCase() === 'nosniff' ? 'APROBADO' : 'HALLAZGO', { nosniff: (h['x-content-type-options'] || '').toLowerCase() === 'nosniff' }, 'Configura X-Content-Type-Options: nosniff y tipos MIME correctos para reducir interpretaciones inesperadas. Verifica la cabecera de la página.'),
    check('REFERRER', ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes((h['referrer-policy'] || '').toLowerCase()) ? 'APROBADO' : 'HALLAZGO', { explicitRestrictivePolicy: ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes((h['referrer-policy'] || '').toLowerCase()) }, 'Define una Referrer-Policy que limite datos enviados a otros sitios y verifica las solicitudes del navegador. La ausencia de cabecera no demuestra filtración: también influyen sus valores predeterminados.'),
  ];
  // Drop the entire name=value pair. Never retain raw cookie, domain, path or arbitrary attributes.
  const attributes = page.cookies.map(cookie => cookie.split(';').slice(1).map(value => { const parts = value.trim().toLowerCase().split('='); return parts.map(part => part.trim()).join('='); }));
  const count = attributes.length;
  const secure = attributes.filter(parts => parts.includes('secure')).length;
  const httpOnly = attributes.filter(parts => parts.includes('httponly')).length;
  const sameSite = attributes.filter(parts => parts.some(p => ['samesite=lax', 'samesite=strict', 'samesite=none'].includes(p)) && (!parts.includes('samesite=none') || parts.includes('secure'))).length;
  rules.push(
    check('COOKIE_SECURE', !count ? 'NO_APLICABLE' : secure === count ? 'APROBADO' : 'HALLAZGO', { count, withSecure: secure }, 'En cookies que deban viajar solo por HTTPS, añade Secure para evitar su envío por HTTP. Revisa Set-Cookie sin copiar sus valores.'),
    check('COOKIE_HTTPONLY', !count ? 'NO_APLICABLE' : httpOnly === count ? 'APROBADO' : 'NO_EVALUADO', { count, withHttpOnly: httpOnly }, 'Aplica HttpOnly a cookies sensibles que JavaScript no necesite leer. La finalidad no puede inferirse de esta respuesta anónima: revisa cada cookie antes de decidir.'),
    check('COOKIE_SAMESITE', !count ? 'NO_APLICABLE' : sameSite === count ? 'APROBADO' : 'HALLAZGO', { count, withExplicitValidSameSite: sameSite }, 'Elige SameSite según el flujo legítimo; None exige Secure. Revisa Set-Cookie y prueba solicitudes entre sitios. SameSite no sustituye CSRF.'),
  );
  return rules;
}
