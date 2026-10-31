# NexoGuard — Backend

NexoGuard es un proyecto para ayudar a los propietarios de sitios web a identificar problemas observables de seguridad y comprender sus resultados. Busca facilitar revisiones de configuración que pueden ser difíciles de interpretar sin conocimientos técnicos especializados.

Su objetivo general es ofrecer una plataforma que permita verificar el control de un dominio, revisar aspectos de seguridad de su página principal y presentar hallazgos y recomendaciones comprensibles. El proyecto está en desarrollo y todavía no ofrece esas funciones de negocio.

## Tecnologías y arquitectura

El backend utiliza Node.js, TypeScript y NestJS. Para persistencia se han configurado Prisma ORM 7.10.1, `@prisma/adapter-mariadb` y MySQL; Jest, ESLint y TypeScript proporcionan herramientas de validación. Docker prepara la imagen de ejecución local.

La arquitectura prevista separa presentación, aplicación, dominio e infraestructura. Actualmente existe el módulo raíz de Nest y una carpeta de infraestructura para Prisma; todavía no existen repositorios, casos de uso ni módulos de negocio implementados. El servicio Prisma se registra mediante inyección de dependencias y contiene lógica de conexión y cierre, pero su conexión real aún no está validada.

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

**La integración real de PrismaService sigue pendiente:** la última consulta desde NestJS falló con `P2010/45028`, por lo que no debe considerarse funcional. Es necesario diagnosticarla y validar consulta, cierre y estado de las tablas antes de darla por terminada.

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

La generación del cliente requiere una `DATABASE_URL` válida para la configuración de Prisma. El arranque requiere además una base accesible y la configuración local indicada; actualmente está bloqueado por el error descrito. El puerto predeterminado es 3001. La prueba existente sustituye el servicio Prisma y no comprueba una conexión real.

## Estado y trabajo previsto

Hay una estructura inicial de NestJS, un modelo y migración Prisma, una imagen Docker y herramientas de validación. No hay endpoints de negocio ni autenticación implementados. Quedan previstos, entre otros, la gestión de usuarios y sesiones, sitios y verificación de dominio, análisis, resultados y alertas. Estas funciones aún no están disponibles.
