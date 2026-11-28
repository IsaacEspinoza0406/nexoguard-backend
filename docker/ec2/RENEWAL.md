# Renovación automática interna (preparada, no instalada en EC2)

La [unidad](./nexoguard-internal-tls.service) y el [timer](./nexoguard-internal-tls.timer) usan el systemd ya empleado por NexoGuard. No hay un nuevo servicio externo. El timer comprueba diariamente entre 04:00 y 05:00 UTC, recupera una activación perdida tras el arranque y renueva cuando a alguna hoja le quedan **30 días o menos**. No altera el reloj. Una comprobación sin necesidad de renovar no recrea contenedores.

## Qué hace

1. Solo root, `umask 077` y bloqueo exclusivo `/run/lock/nexoguard-internal-tls.lock`. Una invocación simultánea sale sin actuar. La publicación/reversión manual debe tomar ese mismo bloqueo.
2. Resuelve el release actual una vez; lee únicamente metadatos TLS desde `/etc/nexoguard/internal-web.env` (root/0600). Confirma proyecto `nexoguard-production`, montajes TLS de solo lectura y backend interno HTTPS. Comprueba que MySQL y transporte están en ejecución y saludables.
3. Verifica CA, correspondencia de claves, SAN y permisos. Exige a la CA más de 92 días: si no los tiene, falla sin sustituirla y requiere una rotación de confianza planificada. La CA privada se conserva root/0600 y nunca se monta en aplicaciones. Los bundles anteriores no se borran.
4. Genera un directorio **nuevo**, hojas de 90 días y claves nuevas con [generate-internal-tls.sh](./generate-internal-tls.sh), reutilizando la CA. Valida identidad, propósito servidor, cadena, fechas, clave coincidente y permisos antes de activar. Para reconocer un bundle anterior vencido, la comprobación offline de ese archivo permite ignorar solamente su fecha; los certificados nuevos y **todos los clientes de aplicación siguen comprobando fechas, CA y nombre**.
5. Guarda un diario root/0600 con el puntero anterior y la identidad de configuración. Cambia atómicamente el archivo de metadatos, no los archivos montados. Ejecuta `up --no-deps --force-recreate --pull never --wait` **solo para back/front/gateway**. Docker respeta los períodos de cierre existentes; puede haber una interrupción breve. Los trabajos interrumpidos siguen sujetos a la recuperación ya existente: no se promete cero impacto en un análisis activo.
6. Cada proceso relee su certificado al arrancar: NestJS en su listener nativo; Next en `server.mjs`; Nginx al cargar configuración. El almacén adicional de Node también se relee al iniciar. No se presupone recarga en caliente ni seguimiento de un inode reemplazado.
7. La [sonda](./verify-internal-tls.mjs) verifica TLS y las huellas **servidas** de back/front, salud MySQL, `/login`, proxy `/health/ready` y el 401 esperado de `/api/auth/me` sin cookies. Nginx aprueba `nginx -t`. No inicia sesiones, análisis, verificación pública ni SSL Labs; no imprime cuerpos/cookies/secretos.
8. Comprueba que MySQL/transporte conservaron ID y tiempo de arranque. Archiva el diario y resultado privado en `internal-web-rotations/`. Si falla una postcondición, restaura el puntero anterior, recrea los tres procesos y vuelve a comprobar. Si la reversión no puede verificarse, conserva el diario y falla; no declara éxito.

## Interrupción y errores

- Si el proceso se interrumpe después de cambiar el puntero, la siguiente invocación detecta el diario pendiente y restaura/verifica el bundle anterior **antes de intentar otra renovación**. Un cambio externo de release/configuración exige revisión manual, evitando revertir otra publicación por error.
- systemd reintenta fallos a los 60 segundos, con límite de tres arranques por media hora. Al agotarlo, revisar el servicio fallido y el diario. No hay un canal de avisos por correo inventado; el operador debe supervisar systemd/journald. Una máquina apagada no puede renovar.
- Un bundle previo ya vencido no garantiza una reversión saludable: ese caso exige intervención, sin desactivar TLS. La ventana de 30 días reduce ese riesgo; no sustituye supervisión.
- Nunca ejecutes `down`, borres volúmenes, restaures sobre MySQL ni cambies la CA de DB/RPC para renovar estas hojas. El certificado público de Let's Encrypt y su hook permanecen independientes.

## Instalación manual posterior al despliegue aprobado

**No ejecutada en EC2.** Primero sigue [INTERNAL_TLS.md](./INTERNAL_TLS.md), verifica sus saltos y utiliza su shell con el bloqueo adquirido. Ubuntu necesita Python 3, OpenSSL 3, Docker Compose y los metadatos privados ya preparados.

```bash
# Shell Ubuntu root, tras validar el release nuevo:
release=$(readlink -f /opt/nexoguard/current)
test -f "$release/back/docker/ec2/renew-internal-tls.py"
command -v python3
openssl version
test ! -e /etc/systemd/system/nexoguard-internal-tls.service
test ! -e /etc/systemd/system/nexoguard-internal-tls.timer
install -m 644 -o root -g root "$release/back/docker/ec2/nexoguard-internal-tls.service" /etc/systemd/system/nexoguard-internal-tls.service
install -m 644 -o root -g root "$release/back/docker/ec2/nexoguard-internal-tls.timer" /etc/systemd/system/nexoguard-internal-tls.timer
systemd-analyze verify /etc/systemd/system/nexoguard-internal-tls.service /etc/systemd/system/nexoguard-internal-tls.timer
systemctl daemon-reload
# Liberar el bloqueo manual SOLO después de terminar publicación y comprobaciones.
flock -u 9
systemctl enable --now nexoguard-internal-tls.timer
systemctl list-timers nexoguard-internal-tls.timer
# Comprobación manual inicial: hojas nuevas → debería registrar NOT_DUE.
systemctl start nexoguard-internal-tls.service
systemctl status nexoguard-internal-tls.service --no-pager
journalctl -u nexoguard-internal-tls.service -n 30 --no-pager
```

El servicio usa exclusivamente el socket Unix del Docker del sistema y un directorio de configuración Docker efímero, sin copiar credenciales del usuario. Tiene aislamiento de filesystem; solo escribe configuración privada de NexoGuard, estado de rotación y su bloqueo. Nunca montar el socket Docker en frontend/backend/transporte.

Una salida `NOT_DUE` o una invocación manual no demuestra una ejecución natural del timer. Validar el próximo disparo real con su timestamp/journal; **esa observación remota está pendiente**. Un `last-result.json` antiguo no acredita que una comprobación reciente haya pasado: revisar estado de la unidad, fecha y diario.

## Recuperación y reversión operativa

Si hay diario pendiente, con el mismo release/configuración puede ejecutarse manualmente el servicio para que restaure el bundle previo. Ante `RECOVERY_REQUIRES_MANUAL_REVIEW` o `ROLLBACK_PENDING_MANUAL_REVIEW`, conserva archivos y revisa el destino/errores en consola privada. No borres el diario para ocultar el fallo.

Para desactivar únicamente la automatización: `systemctl disable --now nexoguard-internal-tls.timer`; comprueba antes si el servicio está ejecutándose. Desactivar el timer no cancela una rotación en curso. Espera su finalización y toma el bloqueo antes de cambiar metadatos.

Para revertir la actualización completa, sigue el bloque de reversión de [INTERNAL_TLS.md](./INTERNAL_TLS.md). Los bundles, diario, imágenes y respaldos anteriores se conservan. El respaldo operativo actualizado incluye las unidades/drop-in de NexoGuard si existen. Descarga el respaldo cifrado y custodia sus claves separadas. Al restaurar en otro host, recupera primero configuración/certificados y el release, instala las unidades revisadas, verifica Docker y el proyecto correcto y solo entonces habilita el timer. No arrancarlo apuntando a una base o configuración desconocida.

## Evidencia local

El ensayo [internal-tls-renewal.integration.py](../../test/internal-tls-renewal.integration.py) realizó renovación y conexiones reales en el proyecto Docker de prueba existente: CA conservada, huellas nuevas, reversión ante postcheck fallido y recuperación de una interrupción **inyectada de forma controlada**. IDs/arranque de MySQL/transporte y cantidades de registros permanecieron iguales durante esas rotaciones.

Un lector Docker de un certificado público mantuvo el inode antiguo después de un reemplazo atómico en el host; un montaje nuevo leyó el nuevo archivo. Por eso se recrean los procesos y sus montajes. No se sobrescribieron los certificados activos para esa demostración.

El [chequeo adicional](../../test/internal-tls-renewal-policy.check.py) comprobó certificado incorrecto rechazado antes de activar, permisos de CA y bloqueo concurrente real. `systemd-analyze verify` aprobó las unidades finales en Linux. Esto no es una ejecución de systemd en EC2, ni una prueba de apagado eléctrico real del host.
