# Publicación manual en main — actualización r2

El inventario exacto está en [release-files.json](./release-files.json), que también limita el paquete a archivos revisados. No incluye los Markdown internos previos sin seguimiento ni configuraciones Railway ajenas a este cambio.

Se inspeccionaron referencias locales: backend main/dev en `3cdc081`; frontend main/dev en `e8bf4b3`, con ambos checkouts en main. No se ejecutó fetch ni escritura Git. Si el estado cambió, revisa antes de seguir. Esta entrega está preparada en el árbol de trabajo; **no se ha confirmado ni publicado en Git**. No hace falta un merge mientras main/dev sigan en esos mismos puntos y los cambios estén en el main actual.

## Archivos por commit

### back

**1. fix: corrige Effect y separa dependencias de runtime y herramientas**

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)
- [Dockerfile](../../Dockerfile)
- [test/prisma-toolchain.check.cjs](../../test/prisma-toolchain.check.cjs)
- [test/runtime-dependencies.check.cjs](../../test/runtime-dependencies.check.cjs)
- [docker/ec2/DEPENDENCIES.md](../../docker/ec2/DEPENDENCIES.md)

**2. feat: agrega guías prácticas versionadas para doce comprobaciones**

- [src/analysis/domain/practical-guides.ts](../../src/analysis/domain/practical-guides.ts)
- [src/analysis/domain/recommendations.ts](../../src/analysis/domain/recommendations.ts)
- [src/documentation/openapi.ts](../../src/documentation/openapi.ts)
- [test/practical-guides.spec.ts](../../test/practical-guides.spec.ts)
- [test/practical-ui.fixture.mjs](../../test/practical-ui.fixture.mjs)
- [test/practical-ui.browser.mjs](../../test/practical-ui.browser.mjs)

**3. feat: cifra los saltos internos con CA y nombres validados**

- [src/main.ts](../../src/main.ts)
- [src/security/internal-tls.ts](../../src/security/internal-tls.ts)
- [test/internal-tls-config.spec.ts](../../test/internal-tls-config.spec.ts)
- [test/tls-network.spec.ts](../../test/tls-network.spec.ts)
- [test/ec2-https.integration.mjs](../../test/ec2-https.integration.mjs)
- [test/internal-proxy-negative.integration.mjs](../../test/internal-proxy-negative.integration.mjs)
- [docker/ec2/.env.example](../../docker/ec2/.env.example)
- [docker/ec2/compose.tls.example.yaml](../../docker/ec2/compose.tls.example.yaml)
- [docker/ec2/compose.internal-tls.yaml](../../docker/ec2/compose.internal-tls.yaml)
- [docker/ec2/generate-internal-tls.sh](../../docker/ec2/generate-internal-tls.sh)

**4. ops: automatiza renovación TLS con diario y reversión comprobada**

- [docker/ec2/renew-internal-tls.py](../../docker/ec2/renew-internal-tls.py)
- [docker/ec2/verify-internal-tls.mjs](../../docker/ec2/verify-internal-tls.mjs)
- [docker/ec2/nexoguard-internal-tls.service](../../docker/ec2/nexoguard-internal-tls.service)
- [docker/ec2/nexoguard-internal-tls.timer](../../docker/ec2/nexoguard-internal-tls.timer)
- [docker/ec2/nexoguard.service.internal-tls.conf](../../docker/ec2/nexoguard.service.internal-tls.conf)
- [test/Dockerfile.tls-operations](../../test/Dockerfile.tls-operations)
- [test/internal-tls-renewal.integration.py](../../test/internal-tls-renewal.integration.py)
- [test/run-internal-tls-renewal.py](../../test/run-internal-tls-renewal.py)
- [test/internal-tls-renewal-policy.check.py](../../test/internal-tls-renewal-policy.check.py)

**5. docs: prepara publicación y despliegue r2 con evidencias y reversión**

- [README.md](../../README.md)
- [docker/ec2/INTERNAL_TLS.md](../../docker/ec2/INTERNAL_TLS.md)
- [docker/ec2/RENEWAL.md](../../docker/ec2/RENEWAL.md)
- [docker/ec2/VALIDATION.md](../../docker/ec2/VALIDATION.md)
- [docker/ec2/PUBLICACION.md](../../docker/ec2/PUBLICACION.md)
- [docker/ec2/release-files.json](../../docker/ec2/release-files.json)
- [docker/ec2/package-update.ps1](../../docker/ec2/package-update.ps1)

### front

**1. feat: presenta ejemplos orientativos accesibles y copia de correcciones**

- `src/app/cuenta/practical-guide.tsx`
- `src/app/cuenta/practical-guide.test.tsx`
- `src/app/cuenta/analysis-comparison.tsx`
- `src/app/cuenta/analysis-comparison.test.tsx`
- `src/app/cuenta/analysis-panel.tsx`
- `src/app/globals.css`

**2. feat: sirve Next por HTTPS y valida TLS en proxy y SSR**

- `Dockerfile`
- `server.mjs`
- `.env.example`
- `docker/ec2/entrypoint.sh`
- `docker/ec2/tls.conf.template`
- `src/app/cuenta/page.tsx`

**3. docs: explica TLS interno preparado y guías prácticas**

- `README.md`

## Comandos manuales (PowerShell, raíz NexoGuard)

No son operaciones ejecutadas por el asistente. Revisa el índice antes de cada commit; no incluir secretos ni archivos privados. El manifiesto evita `git add .`.

```powershell
$root = (Get-Location).Path
$manifest = Get-Content back/docker/ec2/release-files.json -Raw | ConvertFrom-Json
foreach ($repo in @('back','front')) {
  Set-Location (Join-Path $root $repo)
  if ((git branch --show-current) -ne 'main') { throw 'Revisa la rama antes de continuar' }
  if (@(git diff --cached --name-only).Count -ne 0) { throw 'Hay cambios previamente preparados: revísalos sin sobrescribirlos' }
  git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Revisa los errores de formato' }
  foreach ($group in $manifest.repositories.$repo) {
    $files = @($group.files)
    git add -- @files
    if ($LASTEXITCODE -ne 0) { throw 'Falló git add; no continúes automáticamente' }
    git diff --cached --name-only
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw 'Revisa el índice antes de confirmar' }
    # Revisa los archivos mostrados; ejecuta estos pasos por grupo si deseas pausar.
    git commit -m $group.message
    if ($LASTEXITCODE -ne 0) { throw 'Revisa el commit antes de continuar' }
  }
  git status --short
}
Set-Location $root
# Solo después de revisar ambos historiales y confirmar el destino remoto:
git -C back push origin main
git -C front push origin main
```

No hay force push. Si el remoto rechaza main, detente y revisa sus diferencias; los refs locales no prueban que GitHub no haya cambiado. La sincronización posterior de dev es una decisión manual y no es necesaria para publicar estos commits en el main actual. No ejecutar estos bloques sobre una rama distinta ni cambiar ramas con modificaciones sin revisar.

## Fuera de los repositorios

Conservar por separado `compose.yaml`, `deploy/ec2/test/compose.internal-tls.local.yaml` y `deploy/ec2/export-recovery.sh`. El último amplía únicamente la selección de unidades NexoGuard en el respaldo cifrado. Se incluyen en el paquete privado de revisión según la lista explícita; **no se añaden a back/front ni se publica toda la carpeta deploy/ec2**.

AGENTS.md, docs/, bd/, perfiles, claves, certificados generados, datos, respaldos, informes privados y .env reales permanecen excluidos. Las plantillas .env.example no contienen valores reales. Logo, preview, LICENSE y NOTICE se conservan sin modificación.

Publicar main no despliega la aplicación. Sigue [INTERNAL_TLS.md](./INTERNAL_TLS.md) para EC2, [RENEWAL.md](./RENEWAL.md) para el timer y [VALIDATION.md](./VALIDATION.md) para el alcance comprobado. Las conexiones reales de EC2 y las guías visibles allí todavía requieren comprobación tras la actualización manual.
