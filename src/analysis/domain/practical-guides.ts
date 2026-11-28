import { codes } from './checks';

export type PracticalExample = {
  technology: string; location: string; deficient: string; corrected: string;
  steps: string[]; verification: string; expected: string; caution: string;
};
export type PracticalGuide = { version: string; examples: PracticalExample[] };
type Code = typeof codes[number];
const pageHeader = (name: string, before: string, after: string, caution: string): PracticalExample[] => [
  {
    technology: 'Cloudflare Pages', location: '_headers, dentro del directorio publicado. Conserva las otras reglas.',
    deficient: `/*\n  ${before}`, corrected: `/*\n  ${name}: ${after}`,
    steps: ['Revisa qué rutas necesitan esta política y conserva las otras cabeceras.', 'Integra la regla en _headers y publica una nueva versión del proyecto existente. Las respuestas de Functions deben establecer sus propias cabeceras.'],
    verification: `curl --head https://tu-dominio.example/ ; revisa ${name} y prueba las rutas afectadas en el navegador. No uses opciones que ignoren TLS.`,
    expected: `${name}: ${after} en la respuesta HTTPS aplicable.`, caution,
  },
  {
    technology: 'Nginx', location: 'Bloque server HTTPS o location que sirve la página. No reemplaza el resto de la configuración.',
    deficient: `# ${before}`, corrected: `add_header ${name} "${after}" always;`,
    steps: ['Integra la directiva sin duplicar cabeceras del servidor de aplicación. Revisa la herencia: un add_header en location puede reemplazar las cabeceras heredadas.', 'Ejecuta nginx -t; solo si valida, recarga Nginx con el procedimiento de tu instalación.'],
    verification: `curl --head https://tu-dominio.example/ ; inspecciona ${name} y prueba el sitio sin deshabilitar TLS.`,
    expected: `Una política coherente de ${name} en la respuesta HTTPS.`, caution,
  },
];
const certificate: PracticalExample[] = [
  {
    technology: 'Nginx', location: 'Bloque server HTTPS y servicio de renovación del certificado.',
    deficient: 'ssl_certificate /ruta/al/certificado-vencido-o-sin-intermedios.pem;',
    corrected: 'ssl_certificate /etc/letsencrypt/live/tu-dominio.example/fullchain.pem;\nssl_certificate_key /etc/letsencrypt/live/tu-dominio.example/privkey.pem;',
    steps: ['Comprueba DNS, reloj y SAN: el certificado debe incluir el dominio solicitado. Nunca publiques la clave privada.', 'Si ya utilizas Certbot y tienes autorización administrativa: sudo certbot renew --dry-run. Después renueva con sudo certbot renew. Si no existe certificado, configura primero la validación ACME de tu dominio con el proveedor.', 'Verifica la configuración con sudo nginx -t y recarga con sudo systemctl reload nginx únicamente tras instalar la cadena válida. Comprueba también el certificado servido: cambiar el archivo no basta.', 'Programa la renovación con el temporizador del cliente ACME y revisa sus fallos.'],
    verification: 'openssl s_client -connect tu-dominio.example:443 -servername tu-dominio.example -verify_hostname tu-dominio.example -verify_return_error -CApath /etc/ssl/certs </dev/null\ncurl --head https://tu-dominio.example/',
    expected: 'Cadena confiable, nombre coincidente y certificado dentro de notBefore/notAfter. El almacén CA del cliente debe estar actualizado.',
    caution: 'Requiere Linux, OpenSSL, Nginx y, para estos comandos de renovación, Certbot instalado y configurado. No es una cabecera ni una solución universal de emisión. No uses certificados autofirmados para clientes públicos.',
  },
  {
    technology: 'Cloudflare Pages', location: 'Panel del proyecto: dominios personalizados y estado del certificado administrado.',
    deficient: 'Ejemplo ilustrativo: dominio personalizado con DNS incorrecto o certificado pendiente/vencido.', corrected: '',
    steps: ['Confirma que el dominio corresponde al proyecto y que DNS apunta según las instrucciones del panel.', 'Comprueba el estado de activación del dominio y del certificado administrado; revisa restricciones CAA y errores indicados por el proveedor.', 'Si la emisión o renovación sigue fallando, resuelve el error indicado por el proveedor antes de forzar redirecciones. No subas claves ni certificados a _headers.'],
    verification: 'curl --head https://tu-dominio.example/ y comprobación de cadena, nombre y fechas en el visor de certificados del navegador.',
    expected: 'Conexión HTTPS validada y certificado vigente para el dominio. Una cabecera no corrige una cadena ni una fecha inválida.', caution: 'La emisión y renovación dependen del proveedor y del control DNS. No se garantiza un plazo de activación.',
  },
];
const cookie = (attribute: 'secure' | 'httpOnly' | 'sameSite', explanation: string): PracticalExample[] => [{
  technology: 'NestJS / Express', location: 'Código servidor que crea la cookie: Response.cookie de Express en el controlador NestJS. No el HTML ni _headers.',
  deficient: attribute === 'secure'
    ? 'Set-Cookie: nexoguard_demo=valor_ficticio; Path=/'
    : `// Cookie ficticia de laboratorio\nresponse.cookie('nexoguard_demo', 'valor_ficticio', { path: '/', secure: true${attribute === 'httpOnly' ? ', httpOnly: false' : ''} });`,
  corrected: attribute === 'secure'
    ? "// Cookie ficticia de laboratorio: conserva los demás atributos reales.\nresponse.cookie('nexoguard_demo', 'valor_ficticio', {\n  path: '/', secure: true, httpOnly: true, sameSite: 'strict'\n});\n// Resultado ilustrativo: Set-Cookie: nexoguard_demo=valor_ficticio; Path=/; Secure; HttpOnly; SameSite=Strict"
    : "// Cookie ficticia sensible que no necesita lectura JavaScript.\nresponse.cookie('nexoguard_demo', 'valor_ficticio', {\n  path: '/', secure: true, httpOnly: true, sameSite: 'strict'\n});",
  steps: ['Identifica primero finalidad, propietario y todos los puntos que emiten o renuevan la cookie. No copies valores de sesión.', 'Integra solo los atributos necesarios en la configuración de la aplicación, conservando nombre, path, duración, revocación y CSRF existentes.', 'Prueba creación, navegación, renovación y cierre de sesión bajo HTTPS. No crees una segunda cookie de sesión en Nginx.'],
  verification: 'En las herramientas del navegador inspecciona los atributos de Set-Cookie sin copiar valores. Prueba los flujos legítimos y el comportamiento entre sitios.',
  expected: attribute === 'secure' ? 'Secure presente; la cookie no viaja por HTTP.' : attribute === 'httpOnly' ? 'HttpOnly presente en cookies sensibles sin necesidad de lectura JavaScript; no accesibles mediante document.cookie.' : 'SameSite explícito y compatible con el flujo, manteniendo CSRF. None exige Secure.',
  caution: `${explanation} nexoguard_demo y valor_ficticio son únicamente un laboratorio; no constituyen la configuración ni los valores del sitio analizado.`,
}];
const entries: Record<Code, PracticalExample[]> = {
  CERTIFICATE: certificate,
  CERTIFICATE_EXPIRY: certificate,
  COOKIE_SECURE: cookie('secure', 'HTTPS es un requisito. No retires HttpOnly, SameSite ni otras protecciones para añadir Secure.'),
  COOKIE_HTTPONLY: cookie('httpOnly', 'No añadas HttpOnly a ciegas si JavaScript necesita legítimamente esa cookie. Se requiere revisar su finalidad; ausencia no implica por sí sola vulnerabilidad.'),
  COOKIE_SAMESITE: cookie('sameSite', 'Strict puede impedir flujos iniciados desde otros sitios; Lax permite determinadas navegaciones superiores; None con Secure permite uso entre sitios. Elige según el flujo, sin sustituir CSRF.'),
  HSTS: pageHeader('Strict-Transport-Security', '! Strict-Transport-Security', 'max-age=300', '300 segundos es un ejemplo de laboratorio. Evalúa una duración de producción tras garantizar HTTPS estable. No añade includeSubDomains ni preload por defecto.'),
  FRAMING: pageHeader('X-Frame-Options', '! X-Frame-Options', 'DENY', 'DENY solo si no necesitas incrustación. Si ya existe CSP frame-ancestors, conserva su política coherente: tiene prioridad. No reemplaces toda la CSP para añadir esta defensa.'),
  NOSNIFF: pageHeader('X-Content-Type-Options', '! X-Content-Type-Options', 'nosniff', 'Corrige también los Content-Type reales. No cambia tipos MIME incorrectos ni valida todos los recursos del sitio.'),
  REFERRER: pageHeader('Referrer-Policy', 'Referrer-Policy: unsafe-url', 'strict-origin-when-cross-origin', 'Evalúa compatibilidad con los flujos. Evita información sensible en las URL incluso con esta política.'),
  CSP: pageHeader('Content-Security-Policy-Report-Only', '! Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'self'", 'Solo plantilla inicial de observación, no una política universal ni una corrección terminada. Report-Only no impone restricciones ni hace aprobar CSP en NexoGuard. Inventaría recursos y revisa violaciones en DevTools; diseña nonces/hashes y excepciones mínimas según la aplicación. Tras probar todas las funciones, despliega Content-Security-Policy de cumplimiento sin retirar directivas existentes. Una CSP presente sigue NO_EVALUADO: requiere revisión contextual.'),
  HTTPS: [
    ...certificate.map(item => ({ ...item, steps: ['Determina si el fallo es DNS, TCP, TLS o HTTP. Comprueba DNS, puerto 443, estado del servicio y logs privados sin divulgar secretos.', ...item.steps, 'Si TLS es válido pero HTTP falla, corrige la ruta o el servidor de aplicación y sus dependencias. Las cabeceras no resuelven un 5xx ni una conexión caída.'], expected: 'Conexión TLS validada y respuesta satisfactoria de la página principal. No es garantía de disponibilidad continua.' })),
  ],
  HTTP_REDIRECT: [
    {
      technology: 'Nginx', location: 'Bloque server del puerto 80 del dominio propio.', deficient: 'server { listen 80; server_name tu-dominio.example; root /var/www/html; }',
      corrected: 'server {\n  listen 80;\n  server_name tu-dominio.example;\n  location ^~ /.well-known/acme-challenge/ { root /var/www/acme; }\n  location / { return 308 https://tu-dominio.example$request_uri; }\n}',
      steps: ['Garantiza primero HTTPS válido. Sustituye solo el manejo HTTP de este dominio y conserva la ubicación ACME real de tu instalación.', 'Usa el dominio literal autorizado, no un Host arbitrario. Valida nginx -t antes de recargar. Conserva las reglas HTTPS existentes.'],
      verification: 'curl --head http://tu-dominio.example/\ncurl --head https://tu-dominio.example/', expected: 'HTTP 308 con Location HTTPS del mismo dominio, sin bucles; HTTPS válido y satisfactorio.', caution: 'No añade HSTS ni corrige certificados. El directorio ACME depende de tu instalación.',
    },
    {
      technology: 'Cloudflare Pages', location: 'Configuración HTTPS/redirecciones del dominio en el proveedor, no _headers.', deficient: 'Ejemplo ilustrativo: HTTP sirve contenido sin redirección.', corrected: '',
      steps: ['Comprueba primero si Pages ya redirige HTTP automáticamente.', 'Para un dominio propio bajo tu control, configura la redirección HTTPS disponible en su panel si hace falta. Conserva rutas y parámetros y evita reglas que vuelvan a HTTP.', 'No intentes resolver la redirección solo con una cabecera ni generes un bucle con una regla indiscriminada en _redirects.'],
      verification: 'curl --head http://tu-dominio.example/ y luego curl --head https://tu-dominio.example/', expected: 'Estado 3xx y Location HTTPS del mismo dominio; certificado válido, sin bucles.', caution: 'Si el proveedor ya redirige y el resultado es aprobado, no es necesario añadir otra regla. Los controles disponibles dependen del dominio/proveedor.',
    },
  ],
};

export function practicalGuideFor(code: Code): PracticalGuide {
  return { version: 'practical-v1', examples: entries[code] };
}
