import { describe, expect, it } from '@jest/globals';
import { codes } from '../src/analysis/domain/checks';
import { guidanceFor } from '../src/analysis/domain/recommendations';

describe('Catálogo práctico independiente de reglas e historial', () => {
  it.each(codes)('%s tiene ubicación, aplicación y comprobación en cada tecnología', code => {
    const guide = guidanceFor(code)!;
    expect(guide.version).toBe('catalog-v1');
    expect(guide.practical?.version).toBe('practical-v1');
    for (const example of guide.practical!.examples) {
      expect(example.technology.length).toBeGreaterThan(0);
      for (const key of ['location', 'deficient', 'verification', 'expected', 'caution'] as const) expect(example[key].length).toBeGreaterThan(5);
      expect(example.steps.length).toBeGreaterThanOrEqual(2);
      if (!example.corrected) expect(example.steps.join(' ').length).toBeGreaterThan(150);
    }
  });
  it('HSTS conserva ejemplo de laboratorio sin subdominios ni preload implícitos', () => {
    const example = guidanceFor('HSTS')!.practical!.examples[0];
    expect(example.deficient).toBe('/*\n  ! Strict-Transport-Security');
    expect(example.corrected).toBe('/*\n  Strict-Transport-Security: max-age=300');
    expect(example.caution).toContain('laboratorio');
  });
  it('cookies usan Express, datos ficticios y conservan protecciones', () => {
    for (const code of ['COOKIE_SECURE', 'COOKIE_HTTPONLY', 'COOKIE_SAMESITE']) {
      const example = guidanceFor(code)!.practical!.examples[0];
      expect(example.technology).toBe('NestJS / Express');
      expect(example.corrected).toContain('nexoguard_demo');
      expect(example.corrected).toContain('secure: true');
      expect(example.corrected).toContain('httpOnly: true');
    }
  });
  it('CSP no promete aprobación ni impone una política universal', () => {
    expect(guidanceFor('CSP')!.practical!.examples.every(example => example.caution.includes('NO_EVALUADO') && example.corrected.includes('Report-Only'))).toBe(true);
  });
});
