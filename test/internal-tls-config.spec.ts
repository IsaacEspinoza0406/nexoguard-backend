import { describe, expect, it } from '@jest/globals';
import { internalTls } from '../src/security/internal-tls';

describe('Listener TLS obligatorio en producción', () => {
  it('solo permite HTTP en desarrollo explícito', () => {
    expect(internalTls(false, {})).toBeUndefined();
    expect(() => internalTls(true, {})).toThrow('INTERNAL_TLS_CONFIGURATION_REQUIRED');
  });
  it('rechaza configuración parcial o archivos inexistentes sin filtrar contenido', () => {
    expect(() => internalTls(false, { NEXOGUARD_INTERNAL_TLS_CERT: 'missing' })).toThrow('INTERNAL_TLS_CONFIGURATION_REQUIRED');
    expect(() => internalTls(true, { NEXOGUARD_INTERNAL_TLS_CERT: 'missing', NEXOGUARD_INTERNAL_TLS_KEY: 'private-missing' })).toThrow('INTERNAL_TLS_CONFIGURATION_INVALID');
  });
});
