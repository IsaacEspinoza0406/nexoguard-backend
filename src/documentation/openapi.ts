import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject, SchemaObject, ReferenceObject, OperationObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { httpSecurity } from '../security/http-security';

type Schema = SchemaObject | ReferenceObject;
const ref = (name: string): ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const str: SchemaObject = { type: 'string' };
const bool: SchemaObject = { type: 'boolean' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const nullable = (schema: SchemaObject): SchemaObject => ({ ...schema, nullable: true });
const list = (items: Schema): SchemaObject => ({ type: 'array', items });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): SchemaObject => ({ type: 'object', properties, required });
const jobState: SchemaObject = { type: 'string', enum: ['PENDIENTE', 'EN_EJECUCION', 'COMPLETADO', 'FALLIDO'] };
const checkState: SchemaObject = { type: 'string', enum: ['APROBADO', 'HALLAZGO', 'NO_APLICABLE', 'NO_EVALUADO'] };
const revision = object({ revisionDominio: object({ dominioCanonico: str, numeroRevision: { type: 'integer' } }) });
const job = { id: uuid, estado: jobState, creadoEn: date, finalizadoEn: nullable(date), motivoFallo: nullable(str), procedencia: str };
const emptyBody: SchemaObject = { ...object({}), additionalProperties: false };

// Presentation-only schemas: they describe existing validators/serializers, never change them.
const schemas: Record<string, Schema> = {
  RegistrationInput: { ...object({ email: { type: 'string', format: 'email', maxLength: 254, description: 'Espacios exteriores eliminados; clave de unicidad en minúsculas. No se eliminan puntos ni alias.' }, password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true, description: 'Sin recorte ni normalización. Argon2id en almacenamiento; nunca se devuelve.' } }), additionalProperties: false },
  SiteInput: { ...object({ domain: { type: 'string', maxLength: 1024, description: 'Solo dominio. Se recorta, convierte a minúsculas/ASCII IDN y elimina punto final. Máximo canónico 253 caracteres; sin URL, IP, puerto, ruta o destino local/reservado.' } }), additionalProperties: false },
  ScheduleInput: { ...object({ enabled: bool, intervalMinutes: { type: 'integer', minimum: 1, maximum: 10080, description: 'Al activar es obligatorio indicar 1440 (diaria) o 10080 (semanal). Al desactivar puede omitirse.' } }, ['enabled']), additionalProperties: false },
  SslConsentInput: { ...object({ consent: { type: 'boolean', enum: [true], description: 'Consentimiento explícito por solicitud para comunicar el dominio a Qualys.' } }), additionalProperties: false },
  CreatedUser: object({ id: uuid }),
  User: object({ id: uuid, email: { type: 'string', format: 'email' } }),
  CsrfToken: object({ token: { type: 'string', description: 'Token dinámico, sin ejemplo. Enviar como X-CSRF-Token junto con la cookie HttpOnly y Origin permitido. Caduca en diez minutos.' } }),
  Error: object({ statusCode: { type: 'integer' }, message: { oneOf: [str, list(str)] }, error: str }, ['statusCode', 'message']),
  Site: object({ id: uuid, domain: str, createdAt: date, status: { type: 'string', enum: ['verified', 'pending', 'unverified'] }, verification: { ...object({ id: uuid, expiresAt: date, verifiedAt: nullable(date), validUntil: nullable(date) }), nullable: true } }),
  Challenge: object({ id: uuid, content: { type: 'string', description: 'Código recién generado, solo en esta respuesta; publicar exactamente en el archivo indicado. No se incluye ejemplo ni hash.' }, url: { type: 'string', format: 'uri' }, expiresAt: date }),
  Verified: object({ verifiedAt: date, validUntil: date }),
  AcceptedAnalysis: object({ id: uuid, estado: jobState }),
  HistoryEntry: object({ ...job, iniciadoEn: nullable(date), verificacion: revision }),
  PracticalExample: object({ technology: str, location: str, deficient: str, corrected: str, steps: list(str), verification: str, expected: str, caution: str }),
  PracticalGuide: object({ version: str, examples: list(ref('PracticalExample')) }),
  Guidance: object({ version: str, explanation: str, consequence: str, applicability: str, correctiveAction: str, verification: str, practical: ref('PracticalGuide') }),
  Check: object({ codigoComprobacion: str, estado: checkState, evidencia: { type: 'object', nullable: true, additionalProperties: true, description: 'Evidencia mínima según comprobación; nunca valores secretos de cookies.' }, observadoEn: nullable(date), guidance: { ...ref('Guidance'), nullable: true } }),
  AnalysisDetail: object({ ...job, resultados: list(ref('Check')) }),
  Comparison: object({ before: object({ id: uuid, creadoEn: date, estado: jobState }), after: object({ id: uuid, creadoEn: date, estado: jobState }), revisionId: uuid, results: list(object({ code: str, before: nullable(checkState), after: nullable(checkState), change: { type: 'string', enum: ['MEJORO', 'EMPEORO', 'IGUAL', 'NO_COMPARABLE'] }, reason: str, guidance: { ...ref('Guidance'), nullable: true } })), }),
  Schedule: { ...object({ activa: bool, intervaloMinutos: { type: 'integer' }, proximaEjecucionEn: nullable(date), ultimoEstado: str, revisionDominioId: uuid, actualizadoEn: date }), nullable: true },
  Monitoring: object({ schedule: ref('Schedule'), allowedMinutes: list({ type: 'integer', enum: [1440, 10080] }), warningDays: nullable({ type: 'integer' }), channel: { type: 'string', enum: ['IN_APP'] } }),
  Alert: object({ id: uuid, analisisId: uuid, codigoComprobacion: str, tipo: str, detalle: { type: 'object', additionalProperties: true }, creadoEn: date, leidaEn: nullable(date) }),
  AlertRead: object({ read: { type: 'boolean', enum: [true] } }),
  SslReport: { ...object({ provider: str, phase: { type: 'string', enum: ['PENDING', 'WAITING', 'DNS', 'IN_PROGRESS', 'READY', 'ERROR'] }, reason: nullable(str), requestedAt: date, fetchedAt: nullable(date), submitted: bool, startTime: nullable(date), testTime: nullable(date), engineVersion: nullable(str), criteriaVersion: nullable(str), endpoints: list(object({ endpoint: { type: 'integer' }, status: { type: 'string', enum: ['READY', 'ERROR', 'PENDING'] }, grade: nullable(str), hasWarnings: bool })) }), nullable: true },
  SslHistory: object({ configured: bool, reason: nullable(str), reports: list(object({ id: uuid, estado: jobState, creadoEn: date, finalizadoEn: nullable(date), motivoFallo: nullable(str), disponibleEn: date, verificacion: revision, report: ref('SslReport') })) }),
};

type Contract = { method: 'get' | 'post'; path: string; tag: string; summary: string; description: string; status: number; response?: Schema; input?: Schema; optionalBody?: boolean; auth?: boolean; csrf?: 'registration' | 'auth'; origin?: boolean; errors?: number[]; limit: number };
export const contracts: Contract[] = [
  { method: 'get', path: '/users/registration-token', tag: 'Registro', summary: 'Obtener token CSRF de registro', description: 'Establece registration_csrf HttpOnly con Path=/users; token firmado de diez minutos.', status: 200, response: ref('CsrfToken'), origin: true, errors: [403], limit: 10 },
  { method: 'post', path: '/users', tag: 'Registro', summary: 'Registrar cuenta sin iniciar sesión', description: 'Solo email y password; normalización compartida con login. UNIQUE y manejo de concurrencia; respuesta sin contraseña/hash.', status: 201, response: ref('CreatedUser'), input: ref('RegistrationInput'), csrf: 'registration', errors: [409], limit: 5 },
  { method: 'get', path: '/auth/csrf', tag: 'Autenticación', summary: 'Obtener token CSRF ligado a la sesión si existe', description: 'Establece cookie CSRF HttpOnly. Tras login obtener un token nuevo; la cookie de sesión se rota.', status: 200, response: ref('CsrfToken'), origin: true, errors: [403], limit: 10 },
  { method: 'post', path: '/auth/login', tag: 'Autenticación', summary: 'Iniciar sesión y rotar la cookie previa', description: 'Argon2; mismo 401 para correo desconocido o contraseña incorrecta. Cookie HttpOnly/SameSite Strict; Secure en modo production. No retorna identificador de sesión en JSON.', status: 200, response: ref('User'), input: ref('RegistrationInput'), csrf: 'auth', errors: [401], limit: 5 },
  { method: 'get', path: '/auth/me', tag: 'Autenticación', summary: 'Consultar usuario de la sesión vigente', description: 'Comprueba revocación, expiración absoluta e inactividad; actualiza último uso.', status: 200, response: ref('User'), auth: true, limit: 60 },
  { method: 'post', path: '/auth/logout', tag: 'Autenticación', summary: 'Revocar sesión actual y borrar cookies', description: 'Sin cuerpo de entrada ni respuesta; no revoca otros dispositivos.', status: 204, auth: true, csrf: 'auth', limit: 10 },
  { method: 'get', path: '/sites', tag: 'Sitios', summary: 'Listar sitios propios', description: 'Devuelve estado de propiedad y último desafío no invalidado, sin código ni hash.', status: 200, response: list(ref('Site')), auth: true, limit: 60 },
  { method: 'post', path: '/sites', tag: 'Sitios', summary: 'Registrar dominio propio', description: 'Crea sitio y primera revisión atómicamente. Duplicado por propietario y dominio canónico: 409. Registrar no acredita control del dominio.', status: 201, response: ref('Site'), input: ref('SiteInput'), auth: true, csrf: 'auth', errors: [409], limit: 10 },
  { method: 'post', path: '/sites/{id}/verification-challenges', tag: 'Propiedad', summary: 'Generar o renovar desafío de archivo', description: 'Invalida la prueba anterior. Archivo HTTPS:443 /.well-known/nexoguard-verification.txt; 32 bytes aleatorios, desafío de treinta minutos.', status: 201, response: ref('Challenge'), input: emptyBody, optionalBody: true, auth: true, csrf: 'auth', errors: [404], limit: 5 },
  { method: 'post', path: '/sites/{id}/verification-challenges/{challengeId}/check', tag: 'Propiedad', summary: 'Comprobar archivo público', description: 'Descarga sin redirecciones con protección SSRF; hash y revisión actuales. Prueba válida treinta días. 400 archivo/código/destino inválido; 409 desafío vencido, usado o renovado.', status: 200, response: ref('Verified'), input: emptyBody, optionalBody: true, auth: true, csrf: 'auth', errors: [404, 409], limit: 5 },
  { method: 'post', path: '/sites/{siteId}/analyses', tag: 'Análisis', summary: 'Encolar análisis manual propio', description: 'Exige propiedad de revisión actual y vigente; 409 si hay trabajo propio activo. Motor manual-v1, página principal; SSL Labs separado. Cuerpo omitido, nulo o vacío; rechaza campos.', status: 202, response: ref('AcceptedAnalysis'), input: { ...emptyBody, nullable: true }, optionalBody: true, auth: true, csrf: 'auth', errors: [404, 409, 503], limit: 3 },
  { method: 'get', path: '/sites/{siteId}/analyses', tag: 'Análisis', summary: 'Consultar últimos cincuenta análisis propios', description: 'Solo manual-v1, orden descendente. No incluye informes SSL Labs.', status: 200, response: list(ref('HistoryEntry')), auth: true, errors: [404], limit: 60 },
  { method: 'get', path: '/sites/{siteId}/analyses/{id}', tag: 'Análisis', summary: 'Consultar detalle, evidencia y recomendaciones', description: 'Recurso propio. NO_EVALUADO y NO_APLICABLE no equivalen a APROBADO; no revela cookies secretas.', status: 200, response: ref('AnalysisDetail'), auth: true, errors: [404], limit: 60 },
  { method: 'get', path: '/sites/{siteId}/analyses/compare/{before}/{after}', tag: 'Análisis', summary: 'Comparar dos análisis del mismo sitio y revisión', description: 'IDs distintos, base anterior cronológicamente. 409 si revisiones diferentes; errores, datos ausentes o no evaluados no demuestran mejoras. Sin puntuación global.', status: 200, response: ref('Comparison'), auth: true, errors: [404, 409], limit: 60 },
  { method: 'get', path: '/sites/{siteId}/schedule', tag: 'Programación y alertas', summary: 'Consultar programación y política', description: 'Solo propietario. Diaria/semanal, aviso inicial treinta días, canal en aplicación.', status: 200, response: ref('Monitoring'), auth: true, errors: [404], limit: 60 },
  { method: 'post', path: '/sites/{siteId}/schedule', tag: 'Programación y alertas', summary: 'Activar, modificar o desactivar programación', description: 'Activación expresa con intervalo 1440 o 10080. Requiere revisión verificada vigente al activar; al desactivar puede omitirse intervalo. No ejecuta inmediatamente ni solicita SSL Labs.', status: 200, response: ref('Schedule'), input: ref('ScheduleInput'), auth: true, csrf: 'auth', errors: [404, 409], limit: 10 },
  { method: 'get', path: '/sites/{siteId}/alerts', tag: 'Programación y alertas', summary: 'Consultar últimas cincuenta alertas del sitio propio', description: 'Alertas persistidas por regresión o ventana de certificado; con estado de lectura.', status: 200, response: list(ref('Alert')), auth: true, errors: [404], limit: 60 },
  { method: 'post', path: '/sites/{siteId}/alerts/{id}/read', tag: 'Programación y alertas', summary: 'Marcar alerta propia leída', description: 'Idempotente: conserva la fecha de la primera lectura. Cuerpo omitido, nulo o vacío; rechaza campos.', status: 200, response: ref('AlertRead'), input: { ...emptyBody, nullable: true }, optionalBody: true, auth: true, csrf: 'auth', errors: [404], limit: 20 },
  { method: 'get', path: '/sites/{siteId}/ssl-labs', tag: 'SSL Labs', summary: 'Leer últimos veinte informes externos guardados', description: 'Solo consulta MySQL; no solicita evaluaciones ni llama a Qualys. Un fallo de actualización no implica fallo del informe conservado. Procedencia y fechas explícitas, sin correo de configuración ni requestedBy.', status: 200, response: ref('SslHistory'), auth: true, errors: [404], limit: 30 },
  { method: 'post', path: '/sites/{siteId}/ssl-labs', tag: 'SSL Labs', summary: 'Autorizar y encolar consulta externa', description: 'Consentimiento explícito y propiedad actual vigente. Caché hasta 24 h; una falta de caché puede iniciar evaluación. Cuotas/esperas/estados persistidos; no bloquea motor propio. 503 sin configuración; nota externa no equivale a aprobado propio.', status: 202, response: ref('AcceptedAnalysis'), input: ref('SslConsentInput'), auth: true, csrf: 'auth', errors: [404, 409, 503], limit: 2 },
];

export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.NEXOGUARD_SWAGGER_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') throw new Error('NEXOGUARD_SWAGGER_ENABLED debe ser true o false.');
  const mode = env.NEXOGUARD_HTTP_MODE || (env.NODE_ENV === 'production' ? 'production' : 'local');
  return value === undefined ? mode === 'local' : value === 'true';
}

export function createApiDocument(app: INestApplication): OpenAPIObject {
  const security = httpSecurity();
  const config = new DocumentBuilder().setTitle('NexoGuard API').setVersion('1.0')
    .setDescription('Contrato del código actual. Todos los cuerpos DTO rechazan campos adicionales. Cookies HttpOnly: credentials: include. CSRF exige cookie, token y Origin autorizado; Origin por sí solo no basta. Los tokens no se guardan en localStorage. Swagger es de consulta: las acciones interactivas están deshabilitadas; no permite saltar guardas ni iniciar evaluaciones externas. Los límites son por IP/ruta en memoria por instancia y se reinician con el proceso.')
    .addCookieAuth(security.sessionCookie, { type: 'apiKey', in: 'cookie', description: 'Sesión revocable de servidor; identificador aleatorio en cookie HttpOnly. Secure y prefijo __Host- en modo production.' }, 'session')
    .addCookieAuth('registration_csrf', { type: 'apiKey', in: 'cookie', description: 'Cookie HttpOnly de GET /users/registration-token; Path=/users.' }, 'registrationCsrfCookie')
    .addCookieAuth(security.csrfCookie, { type: 'apiKey', in: 'cookie', description: 'Cookie HttpOnly de GET /auth/csrf, ligada a sesión si existe; renovar tras login.' }, 'authCsrfCookie')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Token devuelto por GET de CSRF correspondiente. Debe coincidir con cookie válida y firma/origen; sin ejemplos de tokens.' }, 'csrfToken').build();
  const doc = SwaggerModule.createDocument(app, config);
  doc.components = { ...doc.components, schemas: { ...doc.components?.schemas, ...schemas } };
  const failures: Record<number, string> = { 400: 'Entrada o parámetros inválidos; campos inesperados o regla de negocio no satisfecha.', 401: 'Sesión ausente/revocada/caducada o credenciales incorrectas.', 403: 'Origin, cookie o token CSRF ausente, inválido, caducado o no ligado a la sesión.', 404: 'Recurso inexistente o no perteneciente al usuario; no se revela propiedad ajena.', 409: 'Conflicto de unicidad, revisión/propiedad/desafío o trabajo activo, según operación.', 429: 'Límite local de solicitudes excedido.', 500: 'Error interno genérico, sin detalles de persistencia ni secretos.', 503: 'Motor sin capacidad o integración externa sin configurar, según operación.' };
  for (const contract of contracts) {
    const operation = doc.paths[contract.path]?.[contract.method] as OperationObject | undefined;
    if (!operation) throw new Error('El contrato OpenAPI no coincide con las rutas de la aplicación.');
    operation.tags = [contract.tag];
    operation.summary = contract.summary;
    operation.description = `${contract.description} Límite: ${contract.limit} solicitudes/minuto/IP/ruta.`;
    operation.parameters = [...contract.path.matchAll(/\{(\w+)\}/g)].map(match => ({ name: match[1], in: 'path' as const, required: true, schema: uuid }));
    if (contract.csrf || contract.origin) operation.parameters.push({ name: 'Origin', in: 'header', required: !!contract.csrf, schema: { type: 'string', format: 'uri' }, description: contract.csrf ? 'Obligatorio: exactamente el origen frontend permitido; además de cookie y token CSRF.' : 'Obligatorio en local. En producción, GET sin Origin solo se admite con Sec-Fetch-Site=same-origin y Host exacto al origen configurado. Un Origin explícito debe coincidir siempre.' });
    const requirements: Record<string, string[]> = {};
    if (contract.auth) requirements.session = [];
    if (contract.csrf) { requirements.csrfToken = []; requirements[contract.csrf === 'registration' ? 'registrationCsrfCookie' : 'authCsrfCookie'] = []; }
    operation.security = Object.keys(requirements).length ? [requirements] : [];
    operation.responses = { [contract.status]: { description: contract.status === 202 ? 'Trabajo encolado; no significa evaluación completada.' : contract.status === 204 ? 'Sesión revocada; sin cuerpo.' : 'Operación completada.', ...(contract.response ? { content: { 'application/json': { schema: contract.response } } } : {}) } };
    for (const code of new Set([400, 429, 500, ...(contract.auth ? [401] : []), ...(contract.csrf || contract.origin ? [403] : []), ...contract.errors || []])) operation.responses[code] = { description: failures[code], content: { 'application/json': { schema: ref('Error') } } };
    if (contract.input) operation.requestBody = { required: !contract.optionalBody, content: { 'application/json': { schema: contract.input } } };
    else delete operation.requestBody;
    if (contract.path.includes('csrf') || contract.path.includes('registration-token') || contract.path === '/auth/login' || contract.path === '/auth/logout') {
      const success = operation.responses[contract.status];
      if (success && !('$ref' in success)) success.headers = { 'Set-Cookie': { description: 'Cookie HttpOnly emitida/rotada o eliminada según operación; gestionada por el navegador. Sin valores de ejemplo.', schema: str } };
    }
  }
  // Fail closed if a future route lacks a reviewed contract.
  for (const [path, item] of Object.entries(doc.paths)) for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    if (item[method] && !contracts.some(c => c.path === path && c.method === method)) throw new Error('Ruta sin contrato OpenAPI revisado.');
  }
  return doc;
}

export function setupSwagger(app: INestApplication): void {
  if (!swaggerEnabled()) return;
  SwaggerModule.setup('docs', app, createApiDocument(app), {
    jsonDocumentUrl: '/docs-json', raw: ['json'],
    swaggerOptions: { supportedSubmitMethods: [], persistAuthorization: false, validatorUrl: null },
    customSiteTitle: 'NexoGuard · API',
  });
}
