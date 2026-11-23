import { EventEmitter } from 'node:events';
import { Request, Response } from 'express';
import { securityEvents, SecurityEvent } from '../src/security/security-events';

function run(method: string, path: string, status: number, sink: (e: SecurityEvent) => void) {
  const response = Object.assign(new EventEmitter(), { statusCode: status });
  securityEvents(sink)({ method, path, body: { password: 'fixture-private-marker' }, headers: { cookie: 'fixture-cookie-marker' } } as unknown as Request, response as unknown as Response, () => {});
  response.emit('finish');
}
test('registra resultado estructurado sin cuerpos, cookies, usuarios, dominios ni rutas', () => {
  const events: SecurityEvent[] = [];
  run('POST', '/auth/login', 401, e => events.push(e));
  expect(events[0]).toMatchObject({ event: 'auth.login', outcome: 'failure', status: 401 });
  expect(Object.keys(events[0]).sort()).toEqual(['at', 'event', 'outcome', 'status']);
  expect(JSON.stringify(events)).not.toContain('fixture-');
});
test('incluye mutaciones y rechazos de guardas, sin registrar lecturas normales', () => {
  const events: SecurityEvent[] = [];
  run('POST', '/users', 201, e => events.push(e));
  run('GET', '/sites/private-id/analyses', 403, e => events.push(e));
  run('GET', '/sites', 200, e => events.push(e));
  expect(events.map(e => e.event)).toEqual(['user.registration', 'access.denied']);
  expect(JSON.stringify(events)).not.toContain('private-id');
});
test('un fallo de salida no rompe una respuesta ya completada', () => {
  expect(() => run('POST', '/auth/logout', 204, () => { throw new Error('fixture'); })).not.toThrow();
});
