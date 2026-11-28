# Cadena Prisma: diagnóstico y corrección acotada

## Aviso concreto

Los tres altos de npm no eran tres CVE distintos: derivaban de **GHSA-7589-6fvf-x4pw / CVE-2026-121707**, ReDoS en `Schema.TemplateLiteral` de Effect. El paquete afectado permite retroceso costoso al validar cadenas no confiables con varios tramos de cadena ambiguos. No basta con que Effect esté instalado: debe ejecutarse esa validación sobre entrada controlada por un atacante. El [aviso del mantenedor](https://github.com/Effect-TS/effect/security/advisories/GHSA-7589-6fvf-x4pw) identifica versiones hasta 3.22.0 y corrección 3.22.1; npm/base revisada de GitHub lo clasificaron alto, mientras el aviso original muestra moderado. Se conserva la clasificación alta observada, sin minimizarla.

| Paquete antes | Clasificación npm | Rango comunicado | Corrección aplicada |
|---|---|---|---|
| effect 3.20.0 | Vulnerabilidad directa del paquete | ≤3.22.0 | Override exacto 3.22.1 |
| @prisma/config 7.10.1 | Metavulnerabilidad transitiva | ≥6.13.0-dev.1 según npm | Sigue 7.10.1, con Effect corregido |
| prisma 7.10.1 | Metavulnerabilidad transitiva | ≥6.13.0-dev.1 según npm | Sigue 7.10.1, con cadena corregida |

El descenso a Prisma 6.12.0 sugerido por `audit fix` no se aplicó. Tampoco se aplicaron cambios mayores ni `audit fix --force`.

## Presencia y uso real

- La imagen anterior `nexoguard-ec2-back:tls-practical-20261127` contenía las tres versiones indicadas: se comprobó ejecutando consultas de metadatos de paquetes dentro de ella, sin red ni base de datos. El Dockerfile copiaba todas las dependencias de construcción al backend y al transporte.
- Prisma CLI está declarado como desarrollo, pero `@prisma/client` lo admite como peer opcional. El lockfile marcaba esa cadena `devOptional`; por eso `--omit=dev` por sí solo seguía incluyéndola en la auditoría/instalación. La categoría de npm no demuestra ejecución dentro de un endpoint.
- El único import de configuración de la aplicación de herramientas está en `prisma.config.ts`: `prisma/config`. Se usa al validar/generar/migrar. El servidor importa el cliente generado y el adaptador MariaDB. La inspección de código mantenido/compilado no encontró imports de Effect/configuración CLI en el servidor; la configuración instalada no contiene `TemplateLiteral`. Esto limita la exposición observada, **no equivale por sí solo a una corrección ni garantiza ausencia de rutas desconocidas**.

## Dos medidas verificables

1. `overrides["@prisma/config@7.10.1"].effect = "3.22.1"`. Solo cambió de versión el paquete Effect en el lockfile; Prisma/client/adaptador continúan en 7.10.1. Es una actualización menor dentro de Effect 3, impuesta sobre el pin del proveedor: se comprobó su compatibilidad en los usos de herramientas del proyecto, sin atribuir al proveedor una certificación de esa combinación.
2. Etapa Docker `production-deps`: `npm prune --omit=dev --omit=optional --ignore-scripts`. Backend y transporte copian ese árbol, no el completo de build. El build falla si todavía se resuelven Prisma CLI, @prisma/config, Effect, TypeScript o Jest. Conserva el cliente generado, adaptador y Argon2 nativo. Las etapas build/migration retienen la herramienta **parcheada**; no se borró el CLI de la imagen que lo necesita.

Se comprobó la ausencia de esos módulos en ambas imágenes de ejecución y la carga real de AppModule, PrismaService, adaptador y Argon2id. Se usó MySQL TLS de prueba para consultas y healthchecks. El CLI corregido aprobó validate/generate y un caso sintético válido/no coincidente del esquema afectado, sin ejecutar la versión vulnerable ni hacer un ataque a la aplicación.

Después: audit completo backend **0 altos/críticos, 18 moderados**; `npm audit --omit=dev --json`: **0 avisos**. No significa que toda la imagen/OS carezca de vulnerabilidades ni que exista una auditoría completa. Los moderados de otras cadenas de desarrollo siguen pendientes. No se actualizaron dependencias del frontend.

## Operación

Las imágenes `*-r2` del backend y transporte deben reemplazar sus versiones anteriores para que la separación exista realmente en EC2. La imagen de migración corregida se entrega para futuras operaciones explícitas, no se inicia al desplegar. MySQL, sus usuarios/permisos, CA, datos y migraciones no cambian. La configuración TLS/RPC/firewall del transporte se conserva.

El override debe revisarse al actualizar Prisma o Effect; no es una autorización para cambiar automáticamente de versión mayor. Las imágenes antiguas conservadas para reversión siguen conteniendo la cadena anterior. **No se declara corregida la instalación remota hasta desplegar y comprobar sus imágenes reales.**
