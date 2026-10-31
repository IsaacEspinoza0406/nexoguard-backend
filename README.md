# NexoGuard — Backend

NexoGuard es un proyecto para ayudar a los propietarios de sitios web a identificar problemas observables de seguridad y comprender sus resultados. Busca facilitar revisiones de configuración que pueden ser difíciles de interpretar sin conocimientos técnicos especializados.

Su objetivo general es ofrecer una plataforma que permita verificar el control de un dominio, revisar aspectos de seguridad de su página principal y presentar hallazgos y recomendaciones comprensibles. El proyecto está en desarrollo y todavía no ofrece esas funciones de análisis.

## Tecnologías y arquitectura

El backend utiliza Node.js, TypeScript y NestJS. Para persistencia se han configurado Prisma ORM 7.10.1, `@prisma/adapter-mariadb` y MySQL; Jest, ESLint y TypeScript proporcionan herramientas de validación. Docker prepara la imagen de ejecución local.

La arquitectura separa presentación, aplicación, dominio e infraestructura. Existe un módulo de registro con caso de uso y repositorio Prisma; no hay otros casos de uso implementados. Prisma se registra mediante inyección de dependencias y gestiona conexión y cierre.

```text
src/
  app.module.ts                 Módulo raíz
  main.ts                       Arranque de NestJS
  infrastructure/prisma/        Módulo y servicio Prisma en desarrollo
  generated/prisma/             Cliente generado, no versionado
prisma/
  schema.prisma                 Modelo Prisma
  migrations/                   Migración inicial y metadatos
docker/                         Ejecución controlada de migraciones
test/                           Prueba inicial de NestJS
```

## Base de datos y migraciones

El esquema define siete tablas de aplicación: `usuarios`, `sesiones`, `sitios`, `revisiones_dominio`, `verificaciones_dominio`, `analisis` y `resultados_comprobacion`. Prisma genera el cliente a partir del esquema. La migración inicial se conserva como código fuente y su aplicación se controla por separado; el arranque normal del backend no ejecuta migraciones.

PrismaService ejecutó consultas reales y el registro se probó contra MySQL local. Un error previo `P2010/45028` no volvió a reproducirse y su causa subyacente no quedó confirmada.

## Entorno y Docker

La plantilla `.env.example` muestra el formato de `DATABASE_URL` sin credenciales reales. El servicio actual exige además `NEXOGUARD_DB_MODE=local_unencrypted` y valida el destino Docker local previsto; la URL de ejemplo local no satisface por sí sola esas restricciones. No publiques archivos `.env`, contraseñas ni claves.

El archivo Compose y su guía se encuentran en la raíz del espacio de trabajo, fuera de este repositorio. Compose organiza MySQL, backend y frontend, y ofrece un perfil separado para migraciones. La configuración disponible es para desarrollo local: el tráfico hacia MySQL no está cifrado y no debe usarse en producción. La ejecución de migraciones requiere autorización explícita y la configuración de destino correspondiente.

## Desarrollo y validación

Con Node.js 24 y npm disponibles, desde este directorio:

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

La generación del cliente requiere una `DATABASE_URL` válida para la configuración de Prisma. El arranque requiere además una base accesible y la configuración local indicada. El puerto predeterminado es 3001. Las pruebas automatizadas usan sustitutos de Prisma; la prueba real con MySQL se realizó por separado.

## Estado y trabajo previsto

Hay una estructura inicial de NestJS, un modelo y migración Prisma, una imagen Docker y herramientas de validación. El registro está implementado de forma provisional y en validación; no hay inicio de sesión ni sesiones. Quedan previstos, entre otros, la gestión de usuarios y sesiones, sitios y verificación de dominio, análisis, resultados y alertas.

## Registro de usuario (en validación)

Para desarrollo local, `GET /users/registration-token` requiere `Origin: http://127.0.0.1:3000` y devuelve `{ "token": "..." }` y una cookie HttpOnly, SameSite Strict, con vigencia de diez minutos. El navegador debe solicitarlo con credenciales habilitadas y enviar la cookie y el token en `X-CSRF-Token` al hacer `POST /users`, junto con el mismo origen. El servidor comprueba por separado el origen, la coincidencia del token con la cookie, su firma y su vencimiento. La clave es temporal y los tokens dejan de ser válidos al reiniciar el proceso.

El cuerpo acepta únicamente `email` y `password`. El correo válido de hasta 254 caracteres se recorta y normaliza a minúsculas; la contraseña requiere entre 12 y 128 caracteres. La respuesta prevista es `201` con `{ "id": "..." }`, sin contraseña ni hash. Los errores incluyen `400` por entrada inválida, `403` por origen o CSRF, `409` por duplicado, `429` por límite y `500` por fallo interno. No se crea una sesión.

El límite provisional es de diez solicitudes de token y cinco registros por minuto y dirección IP; se almacena en memoria por proceso y se pierde al reiniciar. El origen está fijado al frontend local y la cookie no usa Secure en HTTP local; este mecanismo requiere revisión y configuración segura para HTTPS, proxy y múltiples instancias antes de producción. Se verificó el registro en MySQL local con datos ficticios y limpieza controlada; no existe integración del frontend todavía.
