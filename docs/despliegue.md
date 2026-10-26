# Despliegue de CementerIA: staging y producción

> Runbook para el **Área de Sistemas** y el **equipo de la Dirección de IA**.
> Fuente: `docs/propuesta-mvp.md`, sección 6 ("Hosting", "Backups",
> "Autenticación", "Adjuntos", "Ley 25.326") y sección 2 ("Roles de base");
> `docs/pedidos-dia-1.md` (pedidos A, B y C).
> Todavía no hay servidores: todo lo que sigue está listo para usarse cuando
> Sistemas entregue las VM. Lo que falta para poder hacerlo está en la sección 1.

Cada paso dice quién lo hace: **[S]** Sistemas, **[D]** Dirección de IA.
Lo que va entre `<…>` o `__…__` se reemplaza (ver `docs/pedidos-dia-1.md`,
"Lo que hay que completar").

## Índice

0. [Cómo queda](#0-cómo-queda)
1. [Qué falta de los pedidos del día 1](#1-qué-falta-de-los-pedidos-del-día-1)
2. [Requisitos del servidor](#2-requisitos-del-servidor)
3. [Usuarios, directorios y permisos](#3-usuarios-directorios-y-permisos)
4. [Base de datos y roles](#4-base-de-datos-y-roles)
5. [Variables de entorno](#5-variables-de-entorno)
6. [nginx](#6-nginx)
7. [Unidades de systemd](#7-unidades-de-systemd)
8. [El paquete](#8-el-paquete)
9. [Primer despliegue](#9-primer-despliegue)
10. [Actualizaciones](#10-actualizaciones)
11. [Rollback](#11-rollback)
12. [Backups](#12-backups)
13. [Prueba mensual de restauración](#13-prueba-mensual-de-restauración)
14. [Rotación de SESSION_SECRET y de claves](#14-rotación-de-session_secret-y-de-claves)
15. [Checklist posterior a cada despliegue](#15-checklist-posterior-a-cada-despliegue)
16. [Staging](#16-staging)
17. [Probar el paquete en local](#17-probar-el-paquete-en-local)

---

## 0. Cómo queda

```
 PC de la red municipal
        │ https (443)
        ▼
 nginx  ── TLS municipal, default_server 444, sin query string en el log,
        │  12m solo en la subida de adjuntos, encabezados de seguridad
        │ http://127.0.0.1:3010            (staging: 127.0.0.1:3011)
        ▼
 cementeria.service ── node server.js (paquete standalone, usuario cementeria)
        │                    │
        │                    └── /var/lib/cementeria/adjuntos   (AAAA/MM/<uuid>, 0440)
        ▼
 PostgreSQL 15 (base cementeria, rol cementeria_app)
        ▲
        │ 02:00  cementeria-backup.timer ── pg_dump -Fc + adjuntos ── restic ──► servidor de backup
        │ 03:30  cementeria-historial.timer ── verifica la cadena de hash del historial
        │ 04:30  cementeria-adjuntos-tmp.timer ── borra tmp/ de más de 24 h
        │ 06:00  cementeria-avisos.timer ── avisos por tiempo (plazos DIM, sin confirmar, demorados)
```

| Qué | Dónde |
|---|---|
| Código (una carpeta por versión) | `/opt/cementeria/releases/cementeria-<versión>/` |
| Versión en uso / la anterior | `/opt/cementeria/actual` y `/opt/cementeria/anterior` (enlaces) |
| Entorno de la app (secretos) | `/etc/cementeria/cementeria.env` |
| Entorno del backup (secretos) | `/etc/cementeria/backup.env` |
| Adjuntos | `/var/lib/cementeria/adjuntos/` |
| Dump mientras se sube | `/var/backups/cementeria/` (se borra al terminar) |
| Caché de Next | `/var/cache/cementeria/` (la crea systemd) |
| Logs de la app y de los timers | journald: `journalctl -u cementeria`, `-u cementeria-backup`, `-u cementeria-adjuntos-tmp`, `-u cementeria-historial`, `-u cementeria-avisos` |
| Logs de nginx | `/var/log/nginx/cementeria-{access,error}.log` |

Los archivos de configuración están versionados en `deploy/` y viajan dentro
del paquete:

| Archivo | Va en |
|---|---|
| `deploy/systemd/cementeria.service` | `/etc/systemd/system/` |
| `deploy/systemd/cementeria-backup.{service,timer}` | `/etc/systemd/system/` |
| `deploy/systemd/cementeria-adjuntos-tmp.{service,timer}` | `/etc/systemd/system/` |
| `deploy/systemd/cementeria-historial.{service,timer}` | `/etc/systemd/system/` |
| `deploy/systemd/cementeria-avisos.{service,timer}` | `/etc/systemd/system/` |
| `deploy/systemd/staging/*` | `/etc/systemd/system/` (solo en la VM de staging) |
| `deploy/nginx/conf.d/cementeria-log.conf` | `/etc/nginx/conf.d/` |
| `deploy/nginx/snippets/cementeria-*.conf` | `/etc/nginx/snippets/` |
| `deploy/nginx/00-cementeria-default.conf` | `/etc/nginx/sites-available/` (+ enlace en `sites-enabled/`) |
| `deploy/nginx/cementeria.conf` / `cementeria-staging.conf` | `/etc/nginx/sites-available/` (+ enlace) |
| `deploy/env/*.env.ejemplo` | modelos de `/etc/cementeria*/…` |
| `deploy/desplegar.sh` | se corre desde el paquete (o la copia que deja `npm run empaquetar`) |
| `deploy/prisma.config.mjs` | `npm run empaquetar` lo pone en la raíz del paquete |
| `scripts/backup.sh`, `scripts/restaurar-prueba.sh`, `scripts/verificar-restauracion.mjs`, `scripts/roles.sql` | dentro del paquete, en `scripts/` |

---

## 1. Qué falta de los pedidos del día 1

Nada de esto lo puede resolver la Dirección de IA sola. Mientras falte, el
paso que lo necesita queda bloqueado.

| Pedido | Qué falta | Bloquea |
|---|---|---|
| A1 | Las VM (Ubuntu 24.04, Node 24, nginx), el acceso SSH del responsable y el permiso para instalar las unidades. **Nuevo:** confirmar el puerto de staging (acá se propone **3011**) | Todo |
| A2 | Base `cementeria` con dueño `cementeria_owner`, `scripts/roles.sql` corrido, claves de `cementeria_app` y `cementeria_deploy` entregadas por canal seguro, `pg_hba.conf`; el clúster aparte para staging; quién tiene el superusuario | Primer despliegue |
| A3 | Salida HTTPS de las VM a `estadisticas.smt.gob.ar:5000` | Ingreso con Cidituc |
| A4 | **Los nombres de dominio** (`__DOMINIO_PROD__`, `__DOMINIO_STAGING__`), DNS y certificado con la cadena completa. Si el nginx es de Sistemas, que aplique `deploy/nginx/` (sección 6) | nginx, `APP_URL`, pedido B1 |
| A5 | Acceso solo desde la red municipal (rangos para el `allow` de nginx, o el firewall) | Piloto |
| A6 | `log_statement = 'ddl'` y pgaudit | Primer dato real |
| A7 | Destino del repositorio restic (`<SERVIDOR_BACKUP>`, protocolo, espacio), **el rol del `pg_dump`** (sección 4 propone `cementeria_backup`), quién custodia la clave de restic, y dónde levantar la instancia efímera de restauración | Backups, primer dato real |
| A8 | pgBackRest (opcional) | No bloquea: sin él, RPO de 24 h |
| B1 | Claves `cementeria` y `cementeria-staging` en el derivador **desplegado**, con `/auth/callback` | Ingreso. Producción no tiene alternativa; staging puede usar `AUTH_DEV_LOGIN_STAGING` |
| C1 | Acto del art. 22 publicado | Datos reales en producción (si no, piloto como simulacro en staging) |
| C2 | Retenciones (backups: 30 diarias y 12 mensuales propuestas) y si la prueba de restauración puede hacerse con datos reales | Configurar la retención como definitiva; prueba con datos reales |

Además, en la **máquina de build** [D]: el motor de migraciones de Prisma
para Linux (sección 8, "Una sola vez").

---

## 2. Requisitos del servidor

**[S]** En cada VM (producción y staging):

| Paquete | Para qué | Cómo se verifica |
|---|---|---|
| Ubuntu 24.04 LTS | — | `lsb_release -d` |
| Node.js 24 LTS, en `/usr/bin/node` | La app y los scripts. Solo el runtime: en el servidor no se usa npm | `node --version` → v24.x |
| nginx (1.24 de Ubuntu) | TLS y proxy | `nginx -v` |
| `curl`, `tar` | `deploy/desplegar.sh` | — |
| `restic` (0.16 o posterior; `apt install restic`) | Backups (solo producción) | `restic version` |
| `postgresql-client` (`pg_dump` y `pg_restore` 15 o posterior) | Backups (solo producción) | `pg_dump --version` |

Si Node queda instalado en otra ruta (por ejemplo `/usr/local/bin/node`), hay
que cambiar `ExecStart=` en las unidades.

`pg_dump` tiene que ser de la misma versión que el servidor o más nuevo. El de
Ubuntu 24.04 es el 16 y sirve para PostgreSQL 15; el dump que genera se
restaura con `pg_restore` 16 o posterior (sección 13).

**Instancia de restauración** (donde Sistemas indique, pedido A7): los
binarios del **servidor** PostgreSQL 15 (`postgresql-15` de PGDG, en
`/usr/lib/postgresql/15/bin`), `restic` y Node 24, y disco para el dump, la
base restaurada y los adjuntos. Con datos reales, disco cifrado.

---

## 3. Usuarios, directorios y permisos

**[S]** En la VM de producción:

```bash
# Usuario del servicio: sin shell ni home.
sudo adduser --system --group --no-create-home --home /nonexistent --shell /usr/sbin/nologin cementeria
# Usuario del backup: lee los adjuntos por el grupo cementeria; su home guarda
# la clave SSH del servidor de backup (si el repositorio es sftp:).
sudo adduser --system --group --home /var/lib/cementeria-backup --shell /usr/sbin/nologin cementeria-backup
sudo usermod -aG cementeria cementeria-backup

sudo install -d -o root -g root -m 0755 /opt/cementeria /opt/cementeria/releases
sudo install -d -o root -g root -m 0700 /etc/cementeria
sudo install -d -o cementeria -g cementeria -m 0750 /var/lib/cementeria /var/lib/cementeria/adjuntos
sudo install -d -o cementeria-backup -g cementeria-backup -m 0700 /var/backups/cementeria
```

| Ruta | Dueño | Modo | Por qué |
|---|---|---|---|
| `/opt/cementeria/releases/*` | root | 0755 / archivos 0644 | El servicio lee el código pero no puede modificarlo |
| `/etc/cementeria/*.env` | root | 0600 | systemd los lee como root antes de bajar de usuario; el proceso de la app no puede leer el archivo |
| `/var/lib/cementeria/adjuntos` | cementeria:cementeria | 0750 | Fuera del webroot. La app crea carpetas 0750 y archivos 0440; el grupo (el backup) solo lee |
| `/var/lib/cementeria/adjuntos/tmp` | cementeria | 0700 (lo crea la app) | Subidas en curso: no se respaldan |
| `/var/backups/cementeria` | cementeria-backup | 0700 | El dump vive acá solo mientras se sube |

`ProtectSystem=strict` en las unidades deja todo el sistema de archivos de solo
lectura para el servicio, salvo `ReadWritePaths=` (los adjuntos) y la caché.

---

## 4. Base de datos y roles

**[S]** Pedido A2. Como superusuario del clúster de producción:

```bash
# 1. Roles (idempotente; no lleva contraseñas). Ver el encabezado de scripts/roles.sql.
psql -h <host> -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/roles.sql
```

```sql
-- 2. Claves, sin que queden en el historial de la consola.
\password cementeria_app
\password cementeria_deploy

-- 3. La base, como la deja scripts/db-init.sql en desarrollo (sin la shadow).
CREATE DATABASE cementeria OWNER cementeria_owner ENCODING 'UTF8' TEMPLATE template0;
ALTER DATABASE cementeria SET timezone TO 'America/Argentina/Tucuman';
REVOKE ALL ON DATABASE cementeria FROM PUBLIC;
GRANT CONNECT ON DATABASE cementeria TO cementeria_app, cementeria_deploy;
```

- `unaccent` y `pg_trgm` las crea la primera migración si faltan (hace falta
  el paquete contrib, que en Ubuntu viene con el servidor).
- `pg_hba.conf`: `cementeria_app`, `cementeria_deploy` (y `cementeria_backup`)
  solo desde la IP de la VM de producción, con `scram-sha-256`.
- La clave de `cementeria_deploy` se entrega al responsable de la Dirección de
  IA por un canal seguro y **no se guarda en el servidor**: la pide
  `deploy/desplegar.sh` en cada despliegue.

**Rol del `pg_dump` nocturno** (pendiente de acordar, pedido A7). Propuesta: un
rol de solo lectura cuya clave queda en `/etc/cementeria/backup.env`:

```sql
CREATE ROLE cementeria_backup LOGIN;
GRANT pg_read_all_data TO cementeria_backup;
GRANT CONNECT ON DATABASE cementeria TO cementeria_backup;
\password cementeria_backup
```

`pg_read_all_data` lee todo y no escribe nada; `pg_dump` igual vuelca los
dueños reales (`cementeria_owner`). No hace falta en `scripts/roles.sql`: no
es dueño de nada ni recibe permisos dentro de la base, así que el dump no lo
nombra y la restauración no lo necesita. Si Sistemas prefiere hacer el dump
con su propio usuario, `backup.env` lleva ese.

**Verificación** [D] (la de A2): conectado como `cementeria_app`,
`SELECT version();` (15.x), `SHOW timezone;` (`America/Argentina/Tucuman`);
como `cementeria_deploy`, `SELECT current_user;` (`cementeria_owner`).

**Staging:** otro clúster (pedido A2: los roles son globales del clúster y las
migraciones dan permisos a esos nombres fijos), con los mismos pasos y otras
claves.

---

## 5. Variables de entorno

**[D]** con los valores que entregue **[S]**. Los modelos están en
`deploy/env/`, con cada variable comentada; la referencia completa es
`.env.example`.

```bash
sudo install -o root -g root -m 0600 deploy/env/cementeria.env.ejemplo /etc/cementeria/cementeria.env
sudo install -o root -g root -m 0600 deploy/env/backup.env.ejemplo /etc/cementeria/backup.env
sudoedit /etc/cementeria/cementeria.env
```

| Variable | Producción | Staging | Secreta |
|---|---|---|---|
| `DATABASE_URL` | `cementeria_app` del clúster de producción | la del clúster de staging | **Sí** |
| `SESSION_SECRET` | 48 bytes aleatorios | otros 48 bytes | **Sí** |
| `APP_URL` | `https://__DOMINIO_PROD__` | `https://__DOMINIO_STAGING__` | No |
| `ADJUNTOS_DIR` | `/var/lib/cementeria/adjuntos` | `/var/lib/cementeria-staging/adjuntos` | No |
| `CIDITUC_HABILITADO` | `1` (con B1 hecho) | `1`, o `0` con `AUTH_DEV_LOGIN_STAGING` | No |
| `CIDITUC_DERIVADOR_URL` | `https://cidituc.smt.gob.ar/` | igual | No |
| `CIDITUC_CLAVE` | `cementeria` | `cementeria-staging` | No |
| `CIDITUC_API_URL` | `https://estadisticas.smt.gob.ar:5000` | igual | No |
| `CIDITUC_CA_PEM` | opcional | opcional | No (es un certificado público) |
| `DB_POOL_MAX` | opcional (5) | opcional | No |
| `AUTH_DEV_LOGIN_STAGING` | **nunca** | lista blanca de CUIL ficticios, mientras falte B1 | No |
| `AUTH_DEV_LOGIN` | **nunca** (la app no arranca) | **nunca** | — |
| `MIGRATE_DATABASE_URL` | **no va**: la arma `desplegar.sh` en el momento | no va | **Sí** |
| `NODE_ENV`, `TZ`, `HOSTNAME`, `PORT` | los fija la unidad | los fija la unidad | No |

Backup (`/etc/cementeria/backup.env`, solo producción): `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, **`PGPASSWORD`** (secreta), `RESTIC_REPOSITORY`,
**`RESTIC_PASSWORD`** (secreta; custodia fuera del servidor de backup),
`BACKUP_DIR`, `ADJUNTOS_DIR`, `RETENCION_DIARIAS`, `RETENCION_MENSUALES`,
`RETENCION_EN_ESTE_SERVIDOR`.

Generar un secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

La app valida el entorno al arrancar (`src/lib/arranque.ts`): si falta algo o
sobra `AUTH_DEV_LOGIN`, termina con código 1 y el motivo (sin el valor) queda
en `journalctl -u cementeria`.

---

## 6. nginx

**[S]** (o **[D]** con acceso). Pedido A4.

```bash
sudo cp deploy/nginx/conf.d/cementeria-log.conf /etc/nginx/conf.d/
sudo cp deploy/nginx/snippets/cementeria-proxy.conf deploy/nginx/snippets/cementeria-seguridad.conf /etc/nginx/snippets/
sudo cp deploy/nginx/00-cementeria-default.conf deploy/nginx/cementeria.conf /etc/nginx/sites-available/
sudo sed -i 's/__DOMINIO_PROD__/<dominio>/g' /etc/nginx/sites-available/cementeria.conf
# Certificado: ssl_certificate y ssl_certificate_key de cementeria.conf
sudo rm /etc/nginx/sites-enabled/default        # un solo default_server por puerto
sudo ln -s /etc/nginx/sites-available/00-cementeria-default.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/cementeria.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Qué cumple cada pedido de A4:

| Pedido | Dónde |
|---|---|
| No registrar la query string de `/auth/callback` | `conf.d/cementeria-log.conf`: el formato `cementeria` no tiene query string **en ninguna ruta** (tampoco la del buscador, que lleva nombres y CUIL) ni Referer. En `location = /auth/callback`, el `error_log` solo registra lo crítico, porque un error de nginx escribe el request entero |
| `client_max_body_size 12m` solo en la subida | `location ~ ^/api/expedientes/[^/]+/adjuntos$`, con `proxy_request_buffering off` (el Route Handler lee en streaming). El resto, `2m` |
| Reenviar a `127.0.0.1:3010` | `upstream cementeria_produccion` |
| `Host $host` y `X-Real-IP $remote_addr` | `snippets/cementeria-proxy.conf`. `X-Forwarded-For` se **reemplaza** por `$remote_addr`; `X-Forwarded-Host` no se manda |
| `default_server` con `return 444` | `00-cementeria-default.conf`, también en 443 con `ssl_reject_handshake on` |
| Cadena completa | `ssl_certificate` apunta al `fullchain` |

Además: redirección de 80 a 443, HSTS, `X-Content-Type-Options`,
`X-Frame-Options SAMEORIGIN` (el visor de adjuntos es un iframe del mismo
sitio), `Referrer-Policy`, `Permissions-Policy`, una CSP mínima, gzip,
`server_tokens off`, sin `X-Powered-By`, y `/_next/image` cerrado (la app no
lo usa). Si el acceso solo desde la red municipal (A5) no lo resuelve el
firewall, completar el `allow`/`deny` comentado en `cementeria.conf`.

**`proxy_redirect` (red de seguridad):** con el paquete standalone, Next arma la URL
de cada request con **su** host y puerto (`http://localhost:3010/…`), no con
el `Host` que manda nginx. Al probar el paquete (sección 17), Salir, el callback
de Cidituc y `/auth/ingresar` redirigían a `https://localhost:3010/…`. Ya está
corregido en la app: esas rutas responden con un `Location` relativo
(`src/lib/auth/redireccion.ts`), que el navegador resuelve contra el dominio
público. El `proxy_redirect` de `snippets/cementeria-proxy.conf` queda como red
de seguridad por si alguna redirección futura vuelve a armarse con
`request.url`; no es obligatorio si Sistemas usa su propio nginx.

---

## 7. Unidades de systemd

**[S]** (pedido A1):

```bash
sudo cp deploy/systemd/cementeria.service \
        deploy/systemd/cementeria-backup.service deploy/systemd/cementeria-backup.timer \
        deploy/systemd/cementeria-adjuntos-tmp.service deploy/systemd/cementeria-adjuntos-tmp.timer \
        deploy/systemd/cementeria-historial.service deploy/systemd/cementeria-historial.timer \
        deploy/systemd/cementeria-avisos.service deploy/systemd/cementeria-avisos.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/cementeria*.service /etc/systemd/system/cementeria*.timer
sudo systemctl enable cementeria.service      # arranca en el primer despliegue (sección 9)
```

| Unidad | Qué hace |
|---|---|
| `cementeria.service` | `node server.js` como `cementeria`, `Restart=always` (hasta 5 veces en 10 min; después queda en falla), `TZ=America/Argentina/Tucuman`, `EnvironmentFile=/etc/cementeria/cementeria.env`, escucha en `127.0.0.1:3010`. Endurecida: `NoNewPrivileges`, `ProtectSystem=strict` con `ReadWritePaths=` a los adjuntos, `PrivateTmp`, sin capacidades, filtro de llamadas al sistema |
| `cementeria-backup.timer` → `.service` | 02:00 de Tucumán: `scripts/backup.sh` como `cementeria-backup` (sección 12) |
| `cementeria-adjuntos-tmp.timer` → `.service` | 04:30: `scripts/barrer-adjuntos-tmp.mjs` (compilado a JavaScript, sin tsx), sin red y sin los secretos de la app |
| `cementeria-historial.timer` → `.service` | 03:30 (desde el 26/10/2026): `scripts/verificar-historial.mjs` (compilado, sin tsx) como `cementeria`, con `DATABASE_URL` del entorno de la app. Recalcula la cadena de hash de todos los expedientes (`f_verificar_cadena`) y deja el resumen en `auditoria.accesos` (`verificar_historial`, firmado por SISTEMA). Si hay un expediente con la cadena rota sale con 1: la unidad queda en `systemctl --failed` y el journal dice cuál, en qué movimiento y por qué (evento `historial.roto`). Ver "Verificación del historial" abajo |
| `cementeria-avisos.timer` → `.service` | 06:00 (desde el 26/10/2026), antes de que empiece el trabajo: `scripts/generar-avisos.mjs` (compilado, sin tsx) como `cementeria`, con `DATABASE_URL` del entorno de la app. Genera los avisos por tiempo (plazo DIM por vencer y vencido, enviado sin confirmar, demorado; docs/api-dominio.md, 21.3), firmados por SISTEMA. Idempotente. Sale con 2 si no pudo; aun así la app los genera en la primera pantalla que carga un operador ese día. Ver "Avisos" abajo |

Los timers se activan después del primer despliegue (sección 9, paso 6).

**Avisos.** La campana del encabezado (docs/api-dominio.md, sección 21). Los
avisos de los pases y devoluciones los crea la app al moverse el expediente;
los que dependen del tiempo, `cementeria-avisos` cada mañana (y, si no
corrió, la primera carga del día de un operador). Para mirar:
`journalctl -u cementeria-avisos -n 5 -o cat` (evento `avisos.generados`, con
lo creado por tipo). A mano: `sudo systemctl start cementeria-avisos`.

*Retención.* Los avisos **leídos hace más de 90 días** se pueden borrar; los
no leídos y los leídos recientes, nunca (lo que pasó está en el historial del
expediente, que no se toca). La app no puede borrar avisos: la purga es del
admin del sistema **[D]**, a mano y cuando haga falta (unos cientos de filas
por día en producción: una vez por trimestre alcanza), con la credencial de
deploy, como las migraciones:

```bash
# En el servidor. La URL se arma como en desplegar.sh: la clave no queda en la
# línea de comandos ni en el historial del shell.
cd /opt/cementeria/actual
url_app=$(sudo grep -E '^DATABASE_URL=' /etc/cementeria/cementeria.env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
read -rsp "Clave de cementeria_deploy: " clave; echo
export MIGRATE_DATABASE_URL=$(printf '%s\n%s' "$url_app" "$clave" | node -e '
  const [app, clave] = require("fs").readFileSync(0, "utf8").split("\n");
  const u = new URL(app); u.username = "cementeria_deploy"; u.password = encodeURIComponent(clave);
  process.stdout.write(u.toString());')
unset clave url_app
node scripts/purgar-avisos.mjs                 # cuenta lo que borraría (90 días)
node scripts/purgar-avisos.mjs --confirmar     # borra; --dias N para más de 90
unset MIGRATE_DATABASE_URL
```

Una línea JSON (`avisos.purga_simulada` o `avisos.purgados` con la cantidad).
En desarrollo: `npm run avisos:purgar` (y `-- --confirmar`), con
`MIGRATE_DATABASE_URL` de `.env.local`. `avisos_corridas` tiene una fila por
día y no hace falta purgarla.

**Verificación del historial.** Cada movimiento lleva el hash del anterior
(docs/api-dominio.md, sección 19). Una cadena rota quiere decir que alguien
cambió o borró un movimiento **por fuera de la aplicación** (la app no puede:
privilegios y triggers), y solo un superusuario de PostgreSQL o el owner con
DDL pueden. Qué hacer si `cementeria-historial` falla:

1. `journalctl -u cementeria-historial -n 5 -o cat`: el expediente, el
   movimiento y el motivo (`hash_distinto`: cambió un campo;
   `hash_anterior_distinto`: no encadena con el anterior;
   `secuencia_faltante`: se borró).
2. No tocar nada en la base. Avisar al responsable de la base (Dirección de IA)
   y a Sistemas, y revisar el log de DDL y pgaudit (pedido A6) de esa noche y
   de las anteriores.
3. Comparar con el último backup íntegro (sección 13: restaurarlo en la
   instancia efímera y mirar ese movimiento) y con la huella del papel (la
   carátula y el historial impresos llevan los 16 primeros caracteres del hash
   del último movimiento al emitirse).
4. La corrección, si corresponde, se decide por escrito: el historial no se
   "arregla" recalculando la cadena.

A mano, en cualquier momento: `sudo systemctl start cementeria-historial`. En
la ficha, "Verificar integridad" hace lo mismo con un expediente.

---

## 8. El paquete

**[D]** En la máquina de build (la PC del equipo o CI), **no** en el servidor.

### Una sola vez: el motor de migraciones para Linux

`prisma migrate deploy` usa un binario nativo (`schema-engine`) que `npm
install` baja solo para la plataforma de la máquina de build. Para el
servidor hace falta el de Linux con OpenSSL 3 (`debian-openssl-3.0.x`):

```powershell
# PowerShell, en la raíz del repositorio. Lo baja Prisma de su servidor,
# como en npm install. Hay que repetirlo si cambia la versión de Prisma.
$env:PRISMA_CLI_BINARY_TARGETS='native,debian-openssl-3.0.x'; node node_modules/@prisma/engines/scripts/postinstall.js; Remove-Item Env:PRISMA_CLI_BINARY_TARGETS
```

Sin él, `npm run empaquetar` se niega a armar el paquete y lo explica. Si el
build se hace en Linux x64 (por ejemplo en CI con Ubuntu 24.04), ya está.

### Armar el paquete

```bash
git switch main && git pull     # el paquete sale de un commit
npm ci                          # node_modules al día con el package-lock
npm run empaquetar
```

`npm run empaquetar` (`scripts/empaquetar.mjs`):

1. exporta el árbol del commit (`HEAD`, u otro con `-- --ref <commit>`) a una
   carpeta temporal: los cambios sin commitear y los `.env*` **no** entran;
2. enlaza `node_modules`, genera el cliente de Prisma y corre `next build`
   con `output: 'standalone'` y `NEXT_DEPLOYMENT_ID=<versión>`;
3. arma `build/paquetes/cementeria-<versión>/` con `server.js`, el
   `node_modules` mínimo, `.next/static`, `public`, `prisma/` (esquema y
   migraciones), `prisma.config.mjs`, la CLI de Prisma completa con el motor
   de Linux, `pg`, `scripts/` (backup, restauración, verificación,
   `roles.sql`, el barrido, la verificación del historial, la generación y la
   purga de avisos y la semilla
   compilados a `.mjs`), `deploy/`,
   `VERSION` y `paquete.json`;
4. controla que no haya `.env` ni binarios de otra plataforma y lo comprime:
   `cementeria-<versión>.tar.gz` y su `.sha256`, más una copia de
   `desplegar.sh` al lado.

El paquete ocupa unos 240 MB (70 MB comprimido); más de la mitad es la CLI de
Prisma, que carga módulos de Prisma Studio aunque `migrate deploy` no los use.
Si falla, borra lo que armó: en `build/paquetes/` solo quedan paquetes
completos.

La versión es la del `package.json` más el commit: `0.1.0-b0e15db`. Es la que
devuelve `/api/salud`. Con `NEXT_DEPLOYMENT_ID`, una pestaña que quedó abierta
con la versión anterior recarga sola en vez de fallar.

### Llevarlo al servidor

```bash
scp build/paquetes/cementeria-<versión>.tar.gz build/paquetes/cementeria-<versión>.tar.gz.sha256 \
    build/paquetes/desplegar.sh <usuario>@<IP_VM_PROD>:/tmp/
```

---

## 9. Primer despliegue

Orden, con todo lo de las secciones 2 a 7 hecho:

1. **[S]** Base y roles (sección 4). **[D]** verifica.
2. **[D]** `/etc/cementeria/cementeria.env` (sección 5). Si la clave
   `cementeria` todavía no está en el derivador (B1), `CIDITUC_HABILITADO=0`:
   la app arranca, pero nadie puede ingresar.
3. **[D]** Instalar la versión y migrar:

   ```bash
   sudo bash /tmp/desplegar.sh /tmp/cementeria-<versión>.tar.gz
   ```

   Pide la clave de `cementeria_deploy` (no se muestra ni se guarda), corre
   `prisma migrate deploy` como `nobody`, apunta `/opt/cementeria/actual`,
   arranca el servicio y espera `/api/salud` 200.
4. **[D]** Semilla de producción: áreas, cementerios, catálogos, feriados, las
   4 plantillas y el administrador inicial, **sin** usuarios ni expedientes
   ficticios. Corre con el rol de la app y es idempotente:

   ```bash
   sudo systemd-run --pipe --wait --collect \
     -p User=cementeria -p WorkingDirectory=/opt/cementeria/actual \
     -p EnvironmentFile=/etc/cementeria/cementeria.env \
     -E NODE_ENV=production -E ADMIN_INICIAL_CUIL=<CUIL del primer admin> \
     /usr/bin/node scripts/semilla.mjs --sin-ficticios
   ```

5. **[D]** El administrador ingresa con Cidituc y da de alta al resto de los
   usuarios desde la pantalla de administración.
6. **[S]** Backups (sección 12) y timers:

   ```bash
   sudo systemctl enable --now cementeria-backup.timer cementeria-adjuntos-tmp.timer cementeria-historial.timer cementeria-avisos.timer
   systemctl list-timers 'cementeria*'
   ```

7. **[D]** Checklist de la sección 15.
8. **Datos reales**, recién con el acto del art. 22 publicado (C1), los
   backups andando y la primera prueba de restauración aprobada.

---

## 10. Actualizaciones

**[D]**

```bash
# En la máquina de build
npm run empaquetar
scp build/paquetes/cementeria-<versión>.tar.gz{,.sha256} build/paquetes/desplegar.sh <usuario>@<VM>:/tmp/
# En el servidor
sudo bash /tmp/desplegar.sh /tmp/cementeria-<versión>.tar.gz
```

- El servicio se corta unos segundos mientras reinicia. Las sesiones siguen
  (son una cookie firmada) y una pestaña abierta recarga sola.
- Si no hay migraciones nuevas, igual conviene dejar que `desplegar.sh` corra
  `migrate deploy` (no hace nada si está al día). `--sin-migraciones` existe
  para cuando no se tiene la clave de deploy a mano y se sabe que no hay
  migraciones.
- Las migraciones tienen que ser compatibles con la versión anterior
  (agregar antes que renombrar o borrar): es lo que permite el rollback del
  código sin tocar la base (sección 11).
- `desplegar.sh` deja las últimas 5 versiones en `/opt/cementeria/releases`.

---

## 11. Rollback

**Del código** (la versión nueva arranca mal o tiene un error):

```bash
sudo bash /opt/cementeria/actual/deploy/desplegar.sh --volver
```

Apunta `actual` a `anterior`, reinicia y espera `/api/salud`. Las migraciones
**no** se deshacen: Prisma no tiene migraciones "down". Si la versión nueva
trajo una migración compatible (lo normal, ver sección 10), la versión
anterior funciona con la base migrada.

**De la base** (una migración rompió datos): no se "deshace" una migración a
mano. Opciones, de menos a más drástica:

1. una migración nueva que corrija, en una versión nueva;
2. restaurar el último backup **completo** (sección 13, "Restauración real"):
   se pierde lo cargado desde las 02:00. Nunca `pg_restore --data-only`
   sobre producción: los triggers se crean después de los datos.

---

## 12. Backups

**[S]** con **[D]**. Pedido A7. Lo hace `scripts/backup.sh`, que dispara
`cementeria-backup.timer` a las 02:00:

1. `pg_dump -Fc` a `/var/backups/cementeria/cementeria.dump` y un control de
   que el dump se lee y tiene datos (`pg_restore --list`);
2. **después**, un snapshot de restic con el dump, su `.info` (fecha, sha256,
   versión de `pg_dump`) y `/var/lib/cementeria/adjuntos` (sin `tmp/`). Como
   los adjuntos solo se agregan, los que se copian después del dump cubren
   todo lo que el dump referencia;
3. la retención: `restic forget --keep-daily 30 --keep-monthly 12 --prune`
   (`RETENCION_DIARIAS`, `RETENCION_MENSUALES`), salvo que el repositorio sea
   append-only y la aplique Sistemas (`RETENCION_EN_ESTE_SERVIDOR=0`);
4. borra el dump local.

Todo queda en `journalctl -u cementeria-backup`, con prioridad (error en rojo).
Si algo falla, el script sale con error y la unidad queda en
`systemctl --failed`: el monitoreo de Sistemas tiene que mirar eso.

### Puesta en marcha

```bash
# Repositorio sftp: clave SSH del usuario de backup y known_hosts armado AHORA
# (la unidad monta el home de solo lectura: no puede aceptar una clave nueva).
sudo -u cementeria-backup install -d -m 0700 /var/lib/cementeria-backup/.ssh
sudo -u cementeria-backup ssh-keygen -t ed25519 -N '' -f /var/lib/cementeria-backup/.ssh/id_ed25519
sudo -u cementeria-backup sh -c 'ssh-keyscan <SERVIDOR_BACKUP> >> /var/lib/cementeria-backup/.ssh/known_hosts'
# (Sistemas autoriza la clave pública en el servidor de backup.)

# Crear el repositorio una vez, con la clave de /etc/cementeria/backup.env:
sudo systemd-run --pipe --wait --collect -p User=cementeria-backup \
  -p EnvironmentFile=/etc/cementeria/backup.env restic init

# Primera corrida a mano y control
sudo systemctl start cementeria-backup
journalctl -u cementeria-backup -n 30
sudo systemd-run --pipe --wait --collect -p User=cementeria-backup \
  -p EnvironmentFile=/etc/cementeria/backup.env restic snapshots
```

- La clave de restic (`RESTIC_PASSWORD`) se guarda además **fuera** del
  servidor de backup, con `<CUSTODIO_CLAVE_RESTIC>`: sin ella, los backups no
  se pueden leer.
- `restic check` una vez por mes (en la prueba de restauración, sección 13).
- Ley 25.326: una supresión o purga alcanza a los backups recién cuando vence
  la retención (con la propuesta, unos 12 meses). Así se documenta (pedido C2,
  pregunta 4).
- Staging no tiene backup: solo datos ficticios.

---

## 13. Prueba mensual de restauración

**[D]** con la instancia que dé **[S]** (pedido A7). Con datos reales solo si
Asesoría Legal lo aprobó (C2, pregunta 5). **No se restaura en staging.**

```bash
# En la máquina de restauración, como un usuario sin privilegios, con el
# paquete en uso copiado (o el de la misma versión) y la clave de restic:
export RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=...
restic check --read-data-subset=5%
bash <paquete>/scripts/restaurar-prueba.sh --salida resultado.json
```

`scripts/restaurar-prueba.sh` arma la instancia efímera y aislada
`cementeria-restore` y la destruye al terminar, pase lo que pase:

1. `restic restore` del último snapshot (`--snapshot <id>` para otro) a una
   carpeta temporal 0700, y control del sha256 del dump;
2. un clúster PostgreSQL 15 **nuevo**, sin TCP (solo un socket en esa
   carpeta): nadie más puede conectarse y no hay nada que exponer;
3. `scripts/roles.sql` **antes** de restaurar (`pg_dump` no incluye los roles);
4. la base con dueño `cementeria_owner` y la zona de Tucumán, y
   `pg_restore` completo como superusuario (conserva los dueños);
5. `scripts/verificar-restauracion.mjs`, que controla:

   | Control | Qué mira |
   |---|---|
   | roles | los tres roles, sin SUPERUSER, CREATEDB, CREATEROLE ni REPLICATION; deploy NOINHERIT y miembro del owner |
   | base | dueño `cementeria_owner`, zona de Tucumán, `unaccent` y `pg_trgm` |
   | dueños | todas las tablas, secuencias, vistas y funciones de `public` y `auditoria` son de `cementeria_owner` |
   | triggers | los triggers que las migraciones declaran `ENABLE ALWAYS` existen y están así; ninguno deshabilitado |
   | migraciones | ninguna fallida; las mismas que el paquete (si no, aviso) |
   | conteos | filas por tabla en la base = filas en el dump (lee los `COPY` de `pg_restore --data-only`) |
   | historial | la secuencia de movimientos de cada expediente es 1..N, sin huecos |
   | cadena | la cadena de hash de cada expediente está íntegra (`f_verificar_cadena`; aviso si el dump es de antes de la migración `*_cadena_hash`) |
   | adjuntos | 50 adjuntos al azar (no purgados) existen y coinciden en tamaño y sha256 con el historial |

6. borra todo.

Sale con 0 si todo dio bien. El resultado (`resultado.json`) no tiene datos
personales. **Registrarlo** en producción, como pide la sección 6 de la
propuesta (`auditoria.accesos`, `accion = 'exportar'`, detalle
`restauracion`):

```bash
# En la VM de producción, con el CUIL del responsable que hizo la prueba
sudo node /opt/cementeria/actual/scripts/verificar-restauracion.mjs registrar \
  --resultado /tmp/resultado.json --cuil <CUIL> --env-file /etc/cementeria/cementeria.env
```

Si falla: no es "un warning". Un dump que no restaura o un adjunto que no
coincide quiere decir que hoy no hay backup. Se avisa a Sistemas el mismo día
y se repite después de corregir. (Un adjunto purgado justo entre el dump de
las 02:00 y la copia de los archivos puede dar una falsa alarma: se ve en el
historial del expediente.)

### Restauración real (desastre)

Los mismos pasos 1, 3 y 4 sobre el clúster de producción (o uno nuevo), con
la app detenida (`systemctl stop cementeria`) y la base vacía; después los
adjuntos a `/var/lib/cementeria/adjuntos` con dueño `cementeria:cementeria`,
el control con `verificar-restauracion.mjs` (con `--dump` y `--adjuntos`) y
recién ahí `systemctl start cementeria`. Se pierde lo cargado desde el último
backup (RPO 24 h sin pgBackRest).

---

## 14. Rotación de SESSION_SECRET y de claves

**`SESSION_SECRET`** firma la cookie de sesión. Rotarlo **cierra todas las
sesiones**: cada usuario vuelve a ingresar con Cidituc. Se rota si pudo
filtrarse (un respaldo del `.env` donde no correspondía, alguien con acceso
al servidor que deja de tenerlo) y, como rutina, una vez por año.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
sudoedit /etc/cementeria/cementeria.env      # reemplazar SESSION_SECRET
sudo systemctl restart cementeria
curl -fsS http://127.0.0.1:3010/api/salud
```

Mejor fuera del horario de atención. Staging tiene el suyo y se rota aparte.

**Clave de `cementeria_app`:** **[S]** `ALTER ROLE cementeria_app PASSWORD …`
(o `\password`), **[D]** actualiza `DATABASE_URL` y reinicia. Hay unos
segundos de 503 entre el cambio y el reinicio.

**Clave de `cementeria_deploy`:** la cambia **[S]** y la entrega por canal
seguro; nada que tocar en el servidor.

**Clave de restic:** `restic key add` / `restic key remove` (el repositorio
admite varias), y se actualiza `backup.env` y la copia del custodio.

---

## 15. Checklist posterior a cada despliegue

**[D]** Desde una PC de la red municipal (salvo donde dice "en la VM").
`DOM` es `__DOMINIO_PROD__` (o el de staging).

| # | Qué | Cómo | Esperado |
|---|---|---|---|
| 1 | Salud | `curl -sS https://DOM/api/salud` (sin `-k`) | `200` y `{"estado":"ok","version":"<la del paquete>","base":"ok"}` |
| 2 | Servicio y timers (en la VM) | `systemctl status cementeria`; `systemctl list-timers 'cementeria*'`; `journalctl -u cementeria -p warning -n 20` | activo, tres timers, sin errores |
| 3 | Cadena TLS | `openssl s_client -showcerts -connect DOM:443 -servername DOM </dev/null \| grep -c "BEGIN CERTIFICATE"` | 2 o más |
| 4 | http → https | `curl -sI http://DOM/login` | `301` a `https://DOM/login` |
| 5 | Encabezados | `curl -sI https://DOM/login` | `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy`, `content-security-policy`; **sin** `x-powered-by` ni versión de nginx en `server` |
| 6 | Login simulado cerrado | `curl -s -o /dev/null -w '%{http_code}\n' https://DOM/dev/login` | `404` (en producción siempre; en staging, salvo la lista blanca) |
| 7 | Host ajeno | `curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: otro.ejemplo' https://DOM/login` | `000` (444: nginx cierra sin responder) |
| 8 | Ingreso con Cidituc | Pedido B1, pasos 1 a 3: `/login` lleva a `cidituc.smt.gob.ar/#/login?next=cementeria&state=…`; con la cuenta de empleado vuelve a `https://DOM/auth/callback` y entra | Entra. Si dice "Cidituc no está disponible", revisar A3 |
| 9 | El token no queda en el log (en la VM) | `grep -c 'auth=' /var/log/nginx/cementeria-access.log` | `0` |
| 10 | Token de **vecino** | Pedido B1, paso 4: ingresar con una cuenta de Ciudadano Digital sin cuenta de empleado | "token inválido" (401 en `/usuarios/authStatusIA`), **no** "sin alta". Anotarlo en `docs/pedidos-dia-1.md`, seguimiento |
| 11 | Salir | Ingresar y apretar **Salir** | Vuelve a `https://DOM/login` (303; si va a `localhost`, falta el `proxy_redirect` de la sección 6). En `auditoria.accesos`, la `salida` tiene la IP de la PC, no `127.0.0.1` |
| 12 | Adjunto de 10 MB | En **staging** (con un expediente ficticio): subir un PDF de 10 MB desde la ficha. Para armarlo: `{ printf '%%PDF-1.4\n'; head -c 10485751 /dev/urandom; } > prueba-10mb.pdf` | Se sube y se ve en el visor; uno de 11 MB da el mensaje de "más de 10 MB" |
| 13 | El límite de nginx en producción (sin crear datos) | `head -c 10485760 /dev/zero \| curl -s -o /dev/null -w '%{http_code}\n' --data-binary @- https://DOM/api/expedientes/X/adjuntos` y lo mismo con 13 MB (`13631488`) | `401` (llega a la app, que pide sesión) y `413` (lo corta nginx) |
| 14 | Barrido (en la VM) | `sudo systemctl start cementeria-adjuntos-tmp && journalctl -u cementeria-adjuntos-tmp -n 3` | Evento `adjuntos.barrido` |
| 14 b | Verificación del historial (en la VM) | `sudo systemctl start cementeria-historial && journalctl -u cementeria-historial -n 3 -o cat` | Evento `historial.verificado` con `rotos: 0` |
| 15 | Backup (en la VM, producción) | `sudo systemctl start cementeria-backup && journalctl -u cementeria-backup -n 20` | `backup terminado … (snapshot …)` |
| 16 | pgaudit (A6, antes del primer dato real) | Pedido A6, "Cómo se verifica" | La migración aparece con `cementeria_deploy`; el ingreso de la app no |

---

## 16. Staging

Igual que producción, con estas diferencias. Puede compartir VM con producción
(pedido A1) porque todo va con otro usuario, otras carpetas, otro puerto y
otro clúster de base:

| | Producción | Staging |
|---|---|---|
| Usuario | `cementeria` | `cementeria-staging` |
| Código | `/opt/cementeria` | `/opt/cementeria-staging` |
| Entorno | `/etc/cementeria/cementeria.env` | `/etc/cementeria-staging/cementeria.env` (`deploy/env/cementeria-staging.env.ejemplo`) |
| Adjuntos | `/var/lib/cementeria/adjuntos` | `/var/lib/cementeria-staging/adjuntos` |
| Puerto | 3010 | 3011 (propuesta; `<PUERTO_STAGING>`) |
| Unidades | `deploy/systemd/*` | `deploy/systemd/staging/*` (sin backup) |
| nginx | `cementeria.conf` | `cementeria-staging.conf` (`X-Robots-Tag: noindex`) |
| Base | clúster de producción | **otro clúster** |
| Clave del derivador | `cementeria` | `cementeria-staging` |
| Datos | reales (con C1) | solo ficticios |

```bash
sudo adduser --system --group --no-create-home --home /nonexistent --shell /usr/sbin/nologin cementeria-staging
sudo install -d -o root -g root -m 0755 /opt/cementeria-staging /opt/cementeria-staging/releases
sudo install -d -o root -g root -m 0700 /etc/cementeria-staging
sudo install -d -o cementeria-staging -g cementeria-staging -m 0750 /var/lib/cementeria-staging /var/lib/cementeria-staging/adjuntos
sudo cp deploy/systemd/staging/* /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable cementeria-staging.service

# Desplegar: el mismo paquete que producción
sudo bash /tmp/desplegar.sh /tmp/cementeria-<versión>.tar.gz --instancia staging

# Semilla CON los usuarios y expedientes ficticios (NODE_ENV=development solo
# para la semilla: con production se niega a cargar ficticios)
sudo systemd-run --pipe --wait --collect \
  -p User=cementeria-staging -p WorkingDirectory=/opt/cementeria-staging/actual \
  -p EnvironmentFile=/etc/cementeria-staging/cementeria.env \
  -E NODE_ENV=development -E ADMIN_INICIAL_CUIL=<CUIL> \
  /usr/bin/node scripts/semilla.mjs

sudo systemctl enable --now cementeria-staging-adjuntos-tmp.timer cementeria-staging-historial.timer cementeria-staging-avisos.timer
```

Mientras `cementeria-staging` no esté en el derivador (B1), staging usa el
ingreso de prueba: `AUTH_DEV_LOGIN_STAGING` con la lista blanca de CUIL
ficticios y `APP_URL` https con "staging" en el host. La app se niega a
arrancar si ese host no es de staging.

---

## 17. Probar el paquete en local

Para revisar un cambio de empaquetado sin servidor. En Windows o Linux:

```bash
npm run empaquetar -- --destino local     # motor de migraciones de esta máquina; NO sirve para el servidor
cd build/paquetes/cementeria-<versión>
# Contra una base con las migraciones aplicadas (npm run db:local y npm run db:deploy):
NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3999 \
  DATABASE_URL=... SESSION_SECRET=<32+ caracteres> ADJUNTOS_DIR=<ruta absoluta> \
  node server.js
curl -s http://127.0.0.1:3999/api/salud        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3999/dev/login   # 404
```

`AUTH_DEV_LOGIN` no puede estar definida (la app no arranca).

**Probarlo fuera del repositorio.** Dentro de `build/paquetes/`, Node
encuentra lo que le falte al paquete en el `node_modules` del repositorio (la
búsqueda sube de carpeta en carpeta) y la prueba da bien aunque el paquete
esté incompleto. Para que valga, descomprimir el `.tar.gz` en otra carpeta
(por ejemplo `%TEMP%`) y probar ahí. Así apareció que la CLI de Prisma 7 carga
`@prisma/studio-core` y `@prisma/dev` aunque `migrate deploy` no los use.

La primera prueba del paquete (21/10/2026), descomprimido fuera del
repositorio y sobre un clúster PostgreSQL 15 efímero con `scripts/roles.sql`
y la base creada como en la sección 4, comprobó: `migrate deploy` y `migrate
status` con la CLI y el `prisma.config.mjs` del paquete;
la semilla compilada (`--sin-ficticios` en producción y con ficticios);
`/api/salud` 200 con la versión y `no-store`; `/login` 200; `/dev/login` 404;
estáticos con `?dpl=`; Salir 303 con el `Origin` correcto y 403 con otro;
subida de un PDF de 10 MB (201) y de 10 MB + 1 byte (413); lectura del
adjunto; la IP de `X-Real-IP` en `auditoria.accesos`; que el servidor no
escribe en la carpeta del código; el barrido compilado;
`verificar-restauracion` (OK, y que detecta un sha256 alterado, un trigger
deshabilitado o sin ALWAYS y una tabla con otro dueño) y su registro; y
`/api/salud` 503 con la base detenida, sin datos de conexión en el log. Y
mostró que las redirecciones de los Route Handlers salían con
`localhost:<puerto>`, ya corregido en la app (sección 6).

Sin `pg_dump` ni `pg_restore` en las máquinas del equipo (embedded-postgres no
los trae), la comparación de conteos contra un dump real y
`scripts/restaurar-prueba.sh` completo se prueban recién en la instancia de
restauración; las funciones que leen el dump y comparan se probaron con un
dump de texto armado a mano, y `scripts/backup.sh` con `pg_dump` y `restic`
simulados (camino feliz, falla de `pg_dump`, falla de `restic`, retención
inválida o a cargo del servidor, sin clave).
