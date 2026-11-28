# Actualización r2: guías prácticas y TLS interno

Preparada y comprobada **en local, no aplicada en EC2**. HTTPS público existente en https://nexoguard.duckdns.org no demuestra los nuevos saltos internos. Se conservan las doce guías, las reglas históricas y la excepción diagnóstica sin datos del analizador.

## Diseño

- NestJS usa su listener HTTPS nativo. En modo HTTP `production`, la ausencia de certificado/clave bloquea el arranque.
- Next.js utiliza un arranque HTTPS mínimo (`server.mjs` en el repositorio frontend), conservando el manejador de Next, SSR, rutas y CSP. `next start` no ofrece un listener HTTPS de producción; se evita añadir un proxy por contenedor. No se utiliza salida `standalone`. Esta elección conserva las rutas dinámicas existentes y debe mantenerse al actualizar Next.
- Nginx valida CA, SAN y SNI explícitos `back`/`front`; no toma la identidad TLS del encabezado Host público. Next SSR utiliza `https://back:3001` y el almacén adicional de Node cargado al arrancar. No hay fallback a HTTP en el arranque de producción.
- Una **CA web independiente** firma los SAN DNS `back` y `front`. No se rota ni sustituye la CA de MySQL/RPC ni se cambia el transporte del analizador. Las claves de la CA nunca se montan en contenedores de aplicación.
- HTTP permanece solo para ACME, redirección pública y salud local sin datos. La comprobación anónima HTTP del sitio y el handshake diagnóstico sin datos del analizador conservan su propósito; las descargas siguen verificando CA e identidad.
- El Compose de desarrollo anterior conserva HTTP explícito en una red local; no es el modelo de producción ni demuestra estos nuevos saltos TLS.

Referencias oficiales: [Nest HTTPS](https://docs.nestjs.com/faq/multiple-servers), [servidor personalizado de Next](https://nextjs.org/docs/app/guides/custom-server), [validación TLS del proxy Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_verify).

## Dependencias, imágenes y alcance

La [corrección de la cadena Prisma](./DEPENDENCIES.md) mantiene Prisma 7.10.1, actualiza solamente Effect a 3.22.1 y separa herramientas de ejecución. La entrega `tls-practical-20261127-r2` contiene cinco imágenes Linux/amd64:

- back, transport y migration reconstruidas. El runtime de back/transport ya no contiene el CLI/config/Effect; migration conserva el CLI parcheado.
- front y gateway: misma imagen previamente validada, etiquetada r2; sin reconstrucción innecesaria.

La activación inicial sustituye **back/front/gateway/transport**, porque también debe retirar el árbol antiguo del transporte. Preserva su CA, RPC, firewall y configuración; puede interrumpir un trabajo en curso. La imagen migration solo queda disponible para futuras operaciones explícitas: **no iniciar el perfil tools ni ejecutar migraciones**. DB, backup, cuentas/permisos, volúmenes y RELEASE_TAG general no cambian.

La renovación periódica, en cambio, recrea **solo back/front/gateway**. MySQL y transporte deben conservar ID y tiempo de arranque en cada renovación.

## Paquete privado y transferencia (PowerShell, raíz NexoGuard)

[package-update.ps1](./package-update.ps1) usa [release-files.json](./release-files.json): exporta únicamente cinco imágenes y archivos explícitos revisados. No copia toda la configuración privada EC2. Incluye `config.tar.gz` para el servidor, `source-changes.tar.gz` para conservar/revisar los cambios (no es un clon completo), `release.json` con IDs/huellas y `transfer.sha256`. No incluye .env reales, claves, certificados generados, respaldos ni datos. Se conservan LICENSE, NOTICE, logo y preview. El directorio de destino debe ser nuevo, fuera de repositorios y OneDrive.

```powershell
# Imágenes ya construidas y comprobadas; no volver a construir por ejecutar este bloque.
& ./back/docker/ec2/package-update.ps1
$package = Join-Path $env:LOCALAPPDATA 'NexoGuard/private-source-packages/tls-practical-20261127-r2'
Get-Content "$package/transfer.sha256"
# Crear solo un directorio de subida; comprobar primero la identidad SSH conocida.
ssh -i "$env:USERPROFILE/Downloads/nexoguard-ec2.pem" ubuntu@18.191.243.112 'mkdir -p /home/ubuntu/nexoguard-tls-upload-r2'
scp -i "$env:USERPROFILE/Downloads/nexoguard-ec2.pem" "$package/images.tar" "$package/config.tar.gz" "$package/source-changes.tar.gz" "$package/release.json" "$package/transfer.sha256" ubuntu@18.191.243.112:/home/ubuntu/nexoguard-tls-upload-r2/
```

No ejecutar ahora si todavía se está revisando: este documento prepara la operación manual, no la acredita. Una publicación Git no despliega contenedores.

## Activación manual Ubuntu: destino y respaldo primero

Requiere root, Python 3, OpenSSL 3, Docker/Compose y `flock` (util-linux) ya disponibles o instalados explícitamente antes de activar. El despliegue existente utiliza `/opt/nexoguard/current/deploy/ec2/compose.production.yaml`, proyecto `nexoguard-production`, `/etc/nexoguard/public.env` y `/run/nexoguard-host.env`. Si difiere, detenerse y revisar. No imprimir env/config/inspect completos.

1. Abrir `sudo -i`. Comprobar hostname, `readlink -f /opt/nexoguard/current`, `docker compose version`, `docker ps --format '{{.Names}} {{.Status}}'`, `df -h`. El release previo observado localmente fue `ec2-20261123-catalog`; volver a comprobarlo en EC2, no asumirlo.
2. Ejecutar el respaldo cifrado existente: `bash /opt/nexoguard/current/deploy/ec2/export-recovery.sh`. Exigir `ONLINE_TRANSACTIONAL_BACKUP=verified` y `ENCRYPTED_CONFIG_ARCHIVE=verified`. Descargar/custodiar el respaldo privado y su checksum; claves por separado. Si no existe una recuperación utilizable, no continuar.
3. En esa misma shell root, tomar el bloqueo compartido y preparar una versión nueva. No sobrescribir releases ni metadatos anteriores:

```bash
set -euo pipefail
set -o noclobber
umask 077
command -v python3
command -v flock
openssl version
exec 9>>/run/lock/nexoguard-internal-tls.lock
flock -n 9 || { echo 'Rotación/publicación en curso'; exit 1; }
old=$(readlink -f /opt/nexoguard/current)
new=/opt/nexoguard/releases/ec2-20261127-internal-tls-r2
test -d "$old/deploy/ec2" && test ! -e "$new"
test ! -e /etc/nexoguard/internal-web.env
test ! -e /etc/nexoguard/internal-web-20261127
cd /home/ubuntu/nexoguard-tls-upload-r2
sha256sum -c transfer.sha256
docker load -i images.tar
for role in back front gateway transport migration; do
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' nexoguard-ec2-$role:tls-practical-20261127-r2)" = linux/amd64
done
mkdir -p "$new/deploy"
# Copia operativa privada servidor→servidor, nunca se publica en back/front.
cp -a "$old/deploy/ec2" "$new/deploy/ec2"
tar -xzf config.tar.gz -C "$new" --no-same-owner
sh "$new/back/docker/ec2/generate-internal-tls.sh" /etc/nexoguard/internal-web-20261127
cat > /etc/nexoguard/internal-web.env <<'ENV'
TLS_RELEASE_TAG=tls-practical-20261127-r2
INTERNAL_TLS_DIR=/etc/nexoguard/internal-web-20261127
ENV
chmod 600 /etc/nexoguard/internal-web.env
printf '%s\n' "$old" > /etc/nexoguard/internal-web-previous-release
docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' nexoguard-production-db-1 > /etc/nexoguard/internal-web-db.before
cd "$new/deploy/ec2"
dc=(docker compose --env-file /etc/nexoguard/public.env --env-file /run/nexoguard-host.env --env-file /etc/nexoguard/internal-web.env -f compose.production.yaml -f ../../back/docker/ec2/compose.internal-tls.yaml)
"${dc[@]}" config --quiet
test "$("${dc[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')" = nexoguard-production
```

Mantener `COMPOSE_PROJECT_NAME` y `RELEASE_TAG` general existentes; el overlay solo selecciona las cinco imágenes indicadas. `migrate` mantiene perfil `tools`, no arranca por defecto. No ejecutar `up` del Compose antiguo separado, pues revertiría las imágenes/configuración.

4. Recrear únicamente los cuatro servicios afectados. No iniciar DB ni usar `down`, `-v`, `prune`, comandos SQL ni perfil tools:

```bash
"${dc[@]}" up -d --no-deps --force-recreate --pull never --wait --wait-timeout 180 back front gateway transport
"${dc[@]}" exec -T gateway nginx -t -c /tmp/nexoguard-nginx.conf
"${dc[@]}" ps
back_fp=$(openssl x509 -in /etc/nexoguard/internal-web-20261127/back.pem -noout -fingerprint -sha256 | cut -d= -f2)
front_fp=$(openssl x509 -in /etc/nexoguard/internal-web-20261127/front.pem -noout -fingerprint -sha256 | cut -d= -f2)
"${dc[@]}" exec -T back node --input-type=module - "$back_fp" "$front_fp" nexoguard.duckdns.org < "$new/back/docker/ec2/verify-internal-tls.mjs"
"${dc[@]}" exec -T front node -e "fetch('https://back:3001/health/ready').then(r=>{if(!r.ok)throw Error();console.log('SSR_TO_API_TLS_OK')}).catch(()=>process.exit(1))"
for service in back front; do
  "${dc[@]}" exec -T "$service" node -e "const h=require('https'),fs=require('fs'),host=process.argv[1],port=host==='back'?3001:3000;h.get({hostname:host,port,servername:'incorrect.example.invalid',ca:fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS)},r=>{r.resume();process.exitCode=1}).on('error',e=>{if(e.code!=='ERR_TLS_CERT_ALTNAME_INVALID')process.exitCode=1;else console.log('WRONG_NAME_REJECTED')})" "$service"
  "${dc[@]}" exec -T "$service" node -e "const h=require('https'),host=process.argv[1],port=host==='back'?3001:3000;h.get({hostname:host,port,ca:require('tls').rootCertificates},r=>{r.resume();process.exitCode=1}).on('error',e=>{if(!['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e.code))process.exitCode=1;else console.log('UNKNOWN_CA_REJECTED')})" "$service"
done
curl --fail --head https://nexoguard.duckdns.org/login
curl --fail https://nexoguard.duckdns.org/google9ba5ca0ab47e9b8d.html | sha256sum
# Comparar la huella Google con el archivo público original conservado.
docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}}' nexoguard-production-db-1 > /etc/nexoguard/internal-web-db.after
cmp /etc/nexoguard/internal-web-db.before /etc/nexoguard/internal-web-db.after
```

Transport se reemplaza deliberadamente una vez por su árbol runtime corregido; no comparar su ID como si debiera permanecer igual en esta activación inicial. Confirmar salud del transporte sin solicitar análisis. Verificar en consola privada las imágenes seleccionadas contra `release.json` (solo IDs), y ausencia de CLI/config/Effect en back/transport con el chequeo suministrado en el paquete fuente si se desea reproducirlo. No ejecutar el script de migraciones.

Comprobar en navegador con cuenta ficticia autorizada: login, /cuenta SSR, CSRF, sitios, consulta de resultados existentes, doce guías, tecnología, aplicabilidad y copia. No cambiar cuentas personales, iniciar análisis públicos ni SSL Labs. Verificar JS/CSS, CSP, cookies y ruta `/api`. Hasta observarlo **las guías y saltos HTTPS de EC2 quedan pendientes**, aunque hayan pasado localmente.

5. Solo tras comprobar todo, actualizar el arranque persistente sin reiniciar el servicio principal:

```bash
test ! -e /etc/nexoguard/nexoguard.service.before-internal-tls
cp -p /etc/systemd/system/nexoguard.service /etc/nexoguard/nexoguard.service.before-internal-tls
ln -sfn "$new" /opt/nexoguard/current
mkdir -p /etc/systemd/system/nexoguard.service.d
test ! -e /etc/systemd/system/nexoguard.service.d/internal-tls.conf
install -m 644 -o root -g root "$new/back/docker/ec2/nexoguard.service.internal-tls.conf" /etc/systemd/system/nexoguard.service.d/internal-tls.conf
systemctl daemon-reload
systemctl show nexoguard.service -p ExecStart -p WorkingDirectory
# NO systemctl restart nexoguard: su ExecStop alcanzaría los otros contenedores.
```

El `renew-hook.sh` público existente solo hace `exec gateway nginx -t` y `nginx -s reload`, con el mismo nombre de proyecto y sin recrear servicios: conserva el HTTPS interno y el montaje de CA. No necesita ejecutar otro `up`. Si la copia del servidor difiere de esa función, revisar antes de instalar. El hook ACME público y el timer de hojas internas son independientes.

6. Instalar/habilitar la automatización según [RENEWAL.md](./RENEWAL.md), usando todavía el bloqueo de esta shell; allí se libera únicamente al finalizar. No confundir la invocación inicial manual `NOT_DUE` con un disparo natural del timer. Ejecutar después el respaldo cifrado actualizado del nuevo release y descargarlo: ahora incluye CA web, metadatos, diario, unidades/drop-in y certificados privados **solo dentro del respaldo cifrado**, jamás en el paquete fuente. No cambiar las cuentas de MySQL para respaldar.

## Renovación y permisos

[generate-internal-tls.sh](./generate-internal-tls.sh) genera CA de 730 días y hojas de 90 días. Directorio root/0700, CA privada root/0600, claves de servicio UID 1000/0400 y certificados 0444. No se monta la CA privada en aplicaciones. La CA no se sustituye al renovar hojas; se exige margen superior a 92 días. La futura rotación de CA requiere planificar confianza solapada, no desactivar validación.

El [timer preparado](./nexoguard-internal-tls.timer) revisa diariamente y renueva con 30 días de margen. El [procedimiento](./RENEWAL.md) describe validación previa, diario persistente, reinicio de tres procesos, comprobación posterior y reversión. Se demostró con Docker que reemplazar atómicamente un archivo del host **no actualiza el inode del bind mount existente**: se utilizan bundles nuevos y recreación de montajes, no sobrescritura en caliente. No hay timer instalado ni ejecución natural observada en EC2 todavía.

## Reversión completa sin tocar la base

Si la activación falla, no continuar pruebas sobre producción. Si el timer ya se habilitó, desactivarlo y esperar que su servicio termine antes de adquirir el bloqueo; desactivar el timer no cancela una rotación activa. Si esta shell todavía conserva el descriptor 9 bloqueado, no abrir un segundo bloqueo contra sí misma.

```bash
# Si se instaló la automatización:
if systemctl cat nexoguard-internal-tls.timer >/dev/null 2>&1; then
  systemctl disable --now nexoguard-internal-tls.timer
fi
# Comprobar que nexoguard-internal-tls.service NO esté activating/running.
# En una shell nueva (si no conserva el bloqueo del despliegue):
# exec 9>>/run/lock/nexoguard-internal-tls.lock
# flock -n 9 || exit 1
old=$(cat /etc/nexoguard/internal-web-previous-release)
test -d "$old/deploy/ec2"
cd "$old/deploy/ec2"
docker compose --env-file /etc/nexoguard/public.env --env-file /run/nexoguard-host.env -f compose.production.yaml up -d --no-deps --force-recreate --pull never --wait --wait-timeout 180 back front gateway transport
ln -sfn "$old" /opt/nexoguard/current
if test -f /etc/systemd/system/nexoguard.service.d/internal-tls.conf; then
  test ! -e /etc/nexoguard/internal-tls.conf.disabled
  mv /etc/systemd/system/nexoguard.service.d/internal-tls.conf /etc/nexoguard/internal-tls.conf.disabled
fi
systemctl daemon-reload
curl --fail --head https://nexoguard.duckdns.org/login
flock -u 9
```

Las imágenes anteriores se conservan: recuperan la versión anterior, incluidos sus HTTP internos y árbol de dependencias anterior. No declarar corregido TLS/avisos después de revertir. Mantener deshabilitado el timer mientras current use el release anterior; conservar diario/bundles/metadata para revisión. No restaurar, borrar ni recrear DB o sus volúmenes. Las recuperaciones de datos se ensayan en otro destino, no sobre esta base.

## Cobertura de recomendaciones (practical-v1)

| Comprobación | Guía y ubicación orientativa | Comprobación posterior |
|---|---|---|
| Confianza/identidad | Nginx fullchain/SAN; dominio/certificado administrado Pages | OpenSSL con CA y verify_hostname; curl estricto |
| Vigencia | Certbot configurado: ensayo, renovación, instalación; estado Pages | Fechas servidas y renovación supervisada |
| HttpOnly | NestJS/Express Response.cookie, según finalidad | Atributos y necesidad legítima de JavaScript |
| SameSite | NestJS/Express; Strict/Lax/None+Secure según flujo | Navegación propia y entre sitios, CSRF conservado |
| Secure | NestJS/Express; cookie ficticia nexoguard_demo | Secure presente, no envío HTTP |
| CSP | _headers / Nginx, plantilla Report-Only contextual | DevTools, fuentes y violaciones; presencia NO_EVALUADO |
| Marcos | _headers / Nginx; DENY si no hay incrustación necesaria | Cabecera e incrustación; respetar frame-ancestors existente |
| HSTS | _headers / Nginx; max-age=300 de laboratorio | Respuesta HTTPS; sin subdominios/preload implícitos |
| HTTPS | Diagnóstico DNS/TCP/TLS/HTTP y restauración del servicio | Certificado validado y respuesta satisfactoria |
| Redirección | Puerto 80 Nginx / controles de dominio Pages | 3xx al mismo dominio HTTPS, sin bucles |
| nosniff | _headers / Nginx, MIME correcto | Cabeceras y carga de recursos |
| Referrer-Policy | _headers / Nginx, política según flujo | Cabecera y referencias entre orígenes |

Las 12 tienen explicación y pasos; algunos procedimientos de proveedor no tienen un bloque de configuración copiable porque una cabecera no emite certificados. Ninguna guía cambia la evidencia, procedencia ni reglas históricas. NO_APLICABLE/NO_EVALUADO se explican antes de recomendar cambios. La selección de tecnología es del propietario, sin identificación inventada del sitio.

## Publicación manual y comprobaciones

La [lista exacta por commit y los comandos PowerShell](./PUBLICACION.md) se basan en los archivos actuales y en [release-files.json](./release-files.json). Ambos checkouts estaban en main y sus referencias locales main/dev coincidían; no se requiere merge mientras ese estado no cambie. Revisar el estado antes de confirmar; no se ejecutaron operaciones Git de escritura ni acceso remoto.

[VALIDATION.md](./VALIDATION.md) separa ensayos previos, comprobaciones nuevas y lo que todavía exige observación en EC2. La alerta Google sigue pendiente: esta actualización no la resuelve.
