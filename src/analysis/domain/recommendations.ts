import { codes } from './checks';

export type Guidance = { version: string; explanation: string; consequence: string; applicability: string; correctiveAction: string; verification: string };
// Editorial guidance is versioned independently from the persisted manual-v1 rules.
const entries: Record<typeof codes[number], Omit<Guidance, 'version'>> = {
  HTTP_REDIRECT: {
    explanation: 'La entrada HTTP debe conducir a HTTPS en el mismo dominio acreditado.',
    consequence: 'Una entrada sin redirección puede mantener al visitante en una conexión sin cifrado.',
    applicability: 'Página principal accesible por HTTP. Una conexión fallida no demuestra ausencia de redirección.',
    correctiveAction: 'Configura una redirección de HTTP a HTTPS hacia el mismo dominio, sin bucles.',
    verification: 'Solicita la página por HTTP y revisa el estado 3xx y Location; confirma la carga HTTPS con certificado válido.',
  },
  HTTPS: {
    explanation: 'La página principal debe responder por HTTPS con certificado confiable e identidad coincidente.',
    consequence: 'Un certificado inválido impide autenticar el servidor; errores HTTP pueden impedir acceder a la página.',
    applicability: 'Solicitud anónima a la página principal, dentro de los límites de red. No evalúa áreas autenticadas.',
    correctiveAction: 'Corrige el certificado y los errores de disponibilidad del servidor HTTPS.',
    verification: 'Abre la página con un cliente que valide TLS y comprueba una respuesta HTTP satisfactoria; repite el análisis.',
  },
  CERTIFICATE: {
    explanation: 'La cadena de confianza y el nombre del certificado permiten autenticar el destino.',
    consequence: 'Una cadena no confiable o un nombre incorrecto impide garantizar la identidad del servidor.',
    applicability: 'Certificado presentado durante el saludo TLS con SNI del dominio; no se envían credenciales.',
    correctiveAction: 'Instala el certificado del dominio con su cadena intermedia completa y una autoridad confiable.',
    verification: 'Comprueba cadena y nombre con validación TLS habilitada. El diagnóstico permisivo no sustituye esta validación.',
  },
  CERTIFICATE_EXPIRY: {
    explanation: 'El instante observado debe estar dentro del intervalo de validez del certificado.',
    consequence: 'Un certificado vencido o todavía no válido provoca rechazos de conexión en clientes que verifican TLS.',
    applicability: 'Solo cuando se obtuvieron fechas interpretables. El estado evalúa la vigencia actual; el aviso de proximidad usa la ventana configurada de monitoreo (30 días inicialmente) y los certificados observados en cada análisis.',
    correctiveAction: 'Renueva e instala el certificado vigente y revisa la automatización de su renovación.',
    verification: 'Comprueba notBefore y notAfter del certificado servido y repite el análisis después de instalarlo.',
  },
  HSTS: {
    explanation: 'Strict-Transport-Security con max-age positivo indica que el navegador debe usar HTTPS.',
    consequence: 'Sin esta instrucción explícita el navegador puede permitir futuras entradas por HTTP.',
    applicability: 'Respuesta HTTPS autenticada. includeSubDomains y preload requieren evaluar todos los servicios afectados.',
    correctiveAction: 'Tras garantizar HTTPS estable, configura un único max-age positivo; evalúa por separado subdominios y preload.',
    verification: 'Revisa la cabecera HTTPS y confirma un único max-age entero positivo; prueba los servicios afectados.',
  },
  CSP: {
    explanation: 'Content-Security-Policy limita las fuentes y comportamientos permitidos; su presencia no demuestra eficacia.',
    consequence: 'Sin una política adecuada se pierde una defensa adicional frente a inyección de contenido; no demuestra por sí sola XSS.',
    applicability: 'La ausencia es un hallazgo. Una política presente queda NO_EVALUADO hasta revisión contextual.',
    correctiveAction: 'Diseña una política de mínimo permiso adaptada a los recursos reales; evita habilitaciones amplias y valida las integraciones.',
    verification: 'Inspecciona directivas y fuentes, prueba el sitio en el navegador y revisa violaciones. Repetir el análisis solo confirma presencia.',
  },
  FRAMING: {
    explanation: 'frame-ancestors restringe quién puede incrustar la página y tiene prioridad sobre X-Frame-Options.',
    consequence: 'Una política permisiva puede facilitar interfaces engañosas mediante marcos, según el contenido y las acciones disponibles.',
    applicability: 'La regla automática reconoce únicamente self/none o XFO DENY/SAMEORIGIN cuando no hay frame-ancestors. Otras listas legítimas requieren revisión.',
    correctiveAction: 'Configura frame-ancestors con los orígenes necesarios; usa none si no se admite incrustación. Revisa compatibilidad antes de restringir.',
    verification: 'Revisa las cabeceras y prueba la incrustación desde un origen permitido y otro no autorizado.',
  },
  NOSNIFF: {
    explanation: 'X-Content-Type-Options: nosniff reduce interpretaciones de tipos distintas del MIME declarado.',
    consequence: 'Una interpretación inesperada de contenido puede facilitar ejecución de recursos bajo condiciones específicas.',
    applicability: 'Cabecera de la respuesta observada; no comprueba todos los recursos ni garantiza tipos MIME correctos.',
    correctiveAction: 'Sirve tipos MIME correctos y añade X-Content-Type-Options: nosniff.',
    verification: 'Inspecciona Content-Type y X-Content-Type-Options y prueba que los recursos legítimos siguen cargando.',
  },
  REFERRER: {
    explanation: 'Referrer-Policy explícita limita la información de origen enviada al navegar a otros destinos.',
    consequence: 'Una política permisiva puede comunicar rutas o parámetros a otros sitios; la ausencia no demuestra una filtración efectiva.',
    applicability: 'Se reconocen no-referrer, same-origin, strict-origin y strict-origin-when-cross-origin; también influyen los valores predeterminados del navegador.',
    correctiveAction: 'Elige una política restrictiva compatible con las necesidades del sitio y evita datos sensibles en las URL.',
    verification: 'Revisa la cabecera y las solicitudes del navegador a destinos de otro origen.',
  },
  COOKIE_SECURE: {
    explanation: 'Secure restringe el envío de una cookie a conexiones seguras.',
    consequence: 'Sin Secure una cookie podría enviarse por HTTP si su ámbito y el navegador lo permiten.',
    applicability: 'Solo cookies recibidas en la respuesta anónima. Sin cookies es NO_APLICABLE; no inspecciona cookies posteriores al login.',
    correctiveAction: 'Añade Secure a las cookies que deban viajar por HTTPS y garantiza HTTPS en sus flujos.',
    verification: 'Inspecciona los atributos Set-Cookie sin copiar valores y verifica que no se envían por HTTP.',
  },
  COOKIE_HTTPONLY: {
    explanation: 'HttpOnly impide leer la cookie mediante las API JavaScript habituales.',
    consequence: 'Las cookies sensibles accesibles a JavaScript pueden exponerse si se ejecuta código malicioso en el origen.',
    applicability: 'No se infiere la finalidad de la cookie. Si falta HttpOnly queda NO_EVALUADO; ciertas cookies necesitan lectura legítima por JavaScript.',
    correctiveAction: 'Identifica las cookies sensibles que no necesitan JavaScript y configura HttpOnly en ellas.',
    verification: 'Revisa la finalidad y los atributos de cada cookie sin divulgar valores; comprueba los flujos que necesitan JavaScript.',
  },
  COOKIE_SAMESITE: {
    explanation: 'SameSite explícito limita el envío de cookies entre sitios; None requiere Secure.',
    consequence: 'Una política inadecuada puede ampliar el envío entre sitios o romper flujos legítimos; no prueba por sí misma una vulnerabilidad CSRF.',
    applicability: 'Solo atributos de cookies recibidas. Se reconocen Lax, Strict o None con Secure; no se infiere su finalidad.',
    correctiveAction: 'Elige Lax o Strict según los flujos; reserva None con Secure para necesidades entre sitios y conserva protección CSRF.',
    verification: 'Revisa Set-Cookie y prueba solicitudes del mismo sitio y entre sitios, sin almacenar ni publicar los valores.',
  },
};

export function guidanceFor(code: string): Guidance | null {
  return Object.hasOwn(entries, code) ? { version: 'catalog-v1', ...entries[code as keyof typeof entries] } : null;
}
