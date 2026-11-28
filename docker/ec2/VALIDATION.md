# Validación local — 27 de noviembre de 2026

Esta evidencia corresponde a la actualización de guías prácticas y TLS interno. **No es una validación ni un despliegue nuevo en EC2.** No se solicitaron evaluaciones públicas ni SSL Labs. La fase inicial no cambió dependencias. La revisión r2 posterior corrigió Effect y separó el runtime; no cambió esquema, migraciones ni datos existentes.

| Comprobación ejecutada | Resultado y alcance |
|---|---|
| Backend lint, typecheck, build | Aprobados con Node 24.22.2 |
| Jest backend seleccionado | 92 casos distintos aprobados entre catálogo, comparación, motor, OpenAPI, configuración TLS y handshakes; no es la suite completa. La aserción inicial incorrecta sobre la longitud de «Nginx» se corrigió y sus casos se repitieron. |
| Frontend lint, typecheck, build | Aprobados con Node 24.22.2 |
| Jest frontend | 93/93 aprobados, 12 suites. Después del ajuste de aplicabilidad/copia se repitieron únicamente tres suites afectadas: 18/18. |
| Imágenes | Backend, frontend y gateway Linux/amd64, etiqueta `tls-practical-20261127`, construidas localmente |
| MySQL | Instancia y volumen NUEVOS del proyecto `nexoguard-internal-tls-20261127`; migraciones oficiales existentes y permisos runtime mínimos. Ninguna migración sobre la base actual. |
| Flujo HTTPS real aislado | Registro 201, duplicado 409, Argon2id, login, sesión, CSRF/origen, propietario ajeno 404, logout y revocación aprobados |
| Sitio y análisis | Archivo de propiedad generado por API, publicado y descargado en destino Docker controlado; dos análisis persistidos; dos mejoras HSTS/marcos y CSP no comparable. Es respuesta de red controlada, no DNS/ensayo público. |
| Programación/alerta | Programación diaria guardada y desactivada; alerta controlada de certificado persistida. No demuestra una ejecución diaria natural. |
| Catálogo en API real | Las 12 filas de comparación incluyen `practical-v1`; sin cambiar `manual-v1`, resultados ni evidencia histórica |
| TLS interno positivo | Nginx→back/front y SSR→back operativos; servicios saludables; SSR autenticado muestra «Tu cuenta» |
| TLS negativo listeners | CA desconocida y nombre incorrecto rechazados por ambos listeners HTTPS |
| Renovación privada | Bundle nuevo con misma CA, hojas nuevas verificadas; clave UID 1000/modo 0400 y sintaxis sh comprobados, sin cambiar los certificados de servicios en ejecución |
| TLS negativo Nginx | Dos variantes aisladas: CA incorrecta y SNI/nombre incorrecto. Tanto /login como /health/ready devolvieron 502. Gateway válido restaurado al terminar. |
| Chrome real, fixture visual | 12 guías renderizadas con API/datos SIMULADOS, escritorio 1440×1100 y móvil 390×1000; sin desbordamiento horizontal. Copia al portapapeles real: solo bloque corregido (normalización CRLF de Windows); foco accesible y localStorage vacío. No es prueba de persistencia ni TLS. |

## Comandos ejecutados

En cada repositorio se usó Node 24.22.2 y sus scripts `npm run lint`, `npm run typecheck`, `npm run build`. No se alteraron scripts de package.json.

```powershell
# Backend: selección inicial; después solo se repitieron los casos modificados.
npm test -- --runTestsByPath test/practical-guides.spec.ts test/analysis-comparison.spec.ts test/analysis.spec.ts test/tls-network.spec.ts test/openapi.spec.ts
# La configuración de listener se separó después en su suite propia:
npm test -- --runTestsByPath test/practical-guides.spec.ts test/internal-tls-config.spec.ts
# Frontend:
npm test
npm test -- --runTestsByPath src/app/cuenta/practical-guide.test.tsx src/app/cuenta/analysis-comparison.test.tsx src/app/cuenta/page.test.tsx
```

El ensayo integrado utilizó el Compose operativo local, el overlay [compose.internal-tls.yaml](./compose.internal-tls.yaml) y una selección de redes/volumen nueva, con variables privadas de prueba fuera de ambos repositorios. `docker compose config --quiet` aprobó. Se ejecutó [ec2-https.integration.mjs](../../test/ec2-https.integration.mjs) desde un contenedor de herramientas del ensayo. [internal-proxy-negative.integration.mjs](../../test/internal-proxy-negative.integration.mjs) verificó las dos variantes negativas. El entrypoint del gateway ejecutó `nginx -t`; el arranque y healthchecks completaron correctamente.

Las capturas se obtuvieron con [practical-ui.browser.mjs](../../test/practical-ui.browser.mjs), Chrome headless y perfil nuevo contra [practical-ui.fixture.mjs](../../test/practical-ui.fixture.mjs). Las primeras tentativas detectaron el puerto no publicado de una red interna y la falta de foco del portapapeles headless; se corrigió la preparación del ensayo. Se conservan los intentos por separado; no se sustituyeron por imágenes fabricadas. No se ignoraron certificados para obtener capturas: la fixture visual es HTTP local de desarrollo explícito y no se usa como evidencia de TLS. La prueba TLS real es la topología HTTPS separada.

## Límites y tareas del propietario

- Aplicar y comprobar en EC2 el [procedimiento de despliegue/reversión](./INTERNAL_TLS.md). No afirmar que TLS interno está desplegado antes de comprobarlo allí.
- Renovación/supervisión de hojas internas de 90 días; rotación futura de CA. CA y claves deben conservarse en respaldo privado cifrado.
- El diagnóstico inicial de 18 moderados y 3 altos fue corregido en r2 según el apartado siguiente. Los moderados de desarrollo siguen pendientes; no se declara que toda la imagen/OS carezca de vulnerabilidades.
- La alerta Google Safe Browsing sigue pendiente, sin resolución atribuible a esta actualización.
- Los comandos orientativos del catálogo son instrucciones para el propietario del sitio, no cambios ya aplicados ni evidencia de que conocemos su código.


## Cierre r2: dependencias y renovación (27/11/2026)

Comprobaciones nuevas, sin repetir las suites completas ni análisis externos. Los resultados anteriores corresponden a la fase inicial; sus 92/93 casos no se atribuyen a una nueva ejecución.

| Comprobación nueva realmente ejecutada | Resultado |
|---|---|
| npm audit completo backend | 0 altos/críticos, 18 moderados; los tres altos eran una vulnerabilidad de Effect y dos entradas transitivas, no tres CVE |
| npm audit --omit=dev --json | 0 avisos después del parche; no equivale a un análisis de vulnerabilidades del sistema operativo |
| Lockfile | Solo una versión cambió: Effect 3.20.0 → 3.22.1; Prisma/client/adapter continúan 7.10.1 |
| Herramientas Prisma | validate y generate aprobados con Node 24; carga de config y esquema sintético válido/no coincidente aprobados en imagen migration corregida; sin migrar |
| Runtime back y transport r2 | CLI/config/Effect/TypeScript/Jest no resolubles; AppModule, PrismaService, adaptador y Argon2id verificable cargados |
| Imágenes nuevas | back, transport y migration Linux/amd64 reconstruidas; front/gateway previamente validadas etiquetadas r2; imágenes anteriores conservadas |
| Typecheck y Jest afectados | Typecheck aprobado; 17 pruebas de practical-guides e internal-tls-config aprobadas |
| Lint | La ejecución detectó imports require en dos chequeos nuevos; se ajustaron y ESLint de esos chequeos/sonda aprobó. No se omitieron suites para ocultar fallos. |
| Docker integrado r2 | Salud real y consultas TLS al MySQL de prueba; RPC autenticado/TLS hacia DNS controlado aprobado, sin solicitar análisis |
| Renovación real local | Hojas nuevas realmente servidas, CA conservada, postcheck estricto positivo y MySQL/transporte sin reinicio durante las rotaciones |
| Postcheck fallido | Fallo inyectado de forma controlada, reversión real a bundle previo y postcheck posterior aprobado |
| Interrupción de renovación | Interrupción de proceso simulada tras activación; instancia nueva recuperó diario pendiente y bundle anterior. No es prueba de corte eléctrico real |
| Bind mount real | Reemplazo atómico del archivo host mantuvo el inode anterior en contenedor existente; montaje nuevo leyó el certificado nuevo. No se alteraron los certificados activos para esta prueba |
| Política de renovación | Certificado inválido bloqueado antes de activar, permisos de CA comprobados, segunda invocación concurrente descartada |
| Unidades systemd finales | systemd-analyze verify aprobó en Linux; no se ejecutó un timer real ni se instaló en EC2 |
| Persistencia intacta | Cantidades de usuarios, sitios, análisis y resultados iguales antes/después de las rotaciones; no se imprimieron registros, hashes ni secretos |
| Respaldo operativo | bash -n aprobó el script con la selección adicional de unidades. No se ejecutó respaldo ni restauración en esta fase |

### Comandos adicionales y herramientas

Node 24.22.2, npm, Docker Linux/amd64, Python 3, OpenSSL 3 y systemd-analyze del contenedor operativo de prueba. El contenedor de comprobación del operador usa el socket Docker únicamente en la fixture aislada; no se entrega como servicio de aplicación ni se monta el socket en back/front.

```powershell
# Backend; comandos ya ejecutados, no es necesario repetirlos sin nuevos cambios.
npm install --ignore-scripts --no-audit --no-fund
npm audit --json
npm audit --omit=dev --json
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm test -- --runTestsByPath test/practical-guides.spec.ts test/internal-tls-config.spec.ts
npx eslint test/prisma-toolchain.check.cjs test/runtime-dependencies.check.cjs docker/ec2/verify-internal-tls.mjs
# Desde la raíz NexoGuard, ensayo Docker existente, sin EC2:
python back/test/run-internal-tls-renewal.py
```

El ensayo usa el proyecto `nexoguard-internal-tls-20261127`, un volumen nuevo exclusivo para sus bundles/configuración privada y red/respuestas controladas. La comprobación adicional de política se ejecutó en su contenedor de herramientas. No demuestra TLS desplegado remotamente ni una ejecución programada natural. No tocó servicios/datos personales. La imagen de transporte fue actualizada deliberadamente al inicio del ensayo r2; las rotaciones posteriores conservaron su ID, al igual que MySQL.

El paquete se prepara con inventario y checksums usando [package-update.ps1](./package-update.ps1). Las instrucciones exactas de activación, respaldo y reversión están en [INTERNAL_TLS.md](./INTERNAL_TLS.md); [RENEWAL.md](./RENEWAL.md) explica el timer y sus limitaciones. Falta desplegar y verificar las imágenes/saltos HTTPS/guías reales en EC2 y observar su timer después de habilitarlo manualmente.
