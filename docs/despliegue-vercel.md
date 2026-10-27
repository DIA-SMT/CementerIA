# Despliegue de CementerIA en Vercel

> **Decisión (27/10/2026):** la app se despliega en **Vercel**, con la base y
> los adjuntos en **Supabase** (proyecto `blkqkevgsorfflolxiah`, São Paulo).
> El despliegue en el servidor municipal (nginx + systemd + disco,
> [docs/despliegue.md](despliegue.md)) **sigue funcionando igual**: las dos
> variantes salen del mismo código y se eligen por configuración.
>
> Para el **equipo de la Dirección de IA** ([D]). Sistemas ([S]) solo
> interviene en el DNS del dominio (paso 7).

## Índice

0. [Cómo queda](#0-cómo-queda)
1. [Antes de empezar](#1-antes-de-empezar)
2. [Bucket de adjuntos en Supabase Storage](#2-bucket-de-adjuntos-en-supabase-storage-d)
3. [Clave secreta de Supabase para el servidor](#3-clave-secreta-de-supabase-para-el-servidor-d)
4. [Crear el proyecto en Vercel](#4-crear-el-proyecto-en-vercel-d)
5. [Variables de entorno](#5-variables-de-entorno-d)
6. [Primer despliegue y migraciones](#6-primer-despliegue-y-migraciones-d)
7. [Dominio](#7-dominio-d--s)
8. [Tareas programadas (Vercel Cron)](#8-tareas-programadas-vercel-cron)
9. [Verificación posterior al despliegue](#9-verificación-posterior-al-despliegue-d)
10. [Decisiones y fuentes](#10-decisiones-y-fuentes)
11. [Riesgos y límites](#11-riesgos-y-límites)

---

## 0. Cómo queda

```
Navegador ──https──► Vercel (región gru1, São Paulo; funciones Node)
   │                   ├─ páginas, Server Actions, /api/*  ── Transaction pooler (6543, TLS con la CA de Supabase) ──► Postgres de Supabase
   │                   ├─ /adjuntos/[id]: permisos, motivo, auditoría y el archivo EN STREAMING desde Storage
   │                   └─ /api/cron/*: Vercel Cron, con Authorization: Bearer CRON_SECRET
   └──PUT con URL firmada (solo al subir un adjunto)──► Supabase Storage, bucket PRIVADO `adjuntos`
```

| | Servidor municipal | Vercel |
|---|---|---|
| Build | `output: "standalone"` + `npm run empaquetar` | el de Vercel (sin standalone; `VERCEL=1` lo decide en `next.config.ts`) |
| Adjuntos | disco (`ADJUNTOS_DIR`) | Supabase Storage (`ADJUNTOS_ALMACEN=supabase`) |
| Subida de un adjunto | `POST …/adjuntos` en streaming (hasta 10 MB) | en dos fases: autorizar → el navegador sube directo a Storage → confirmar |
| Lectura de un adjunto | `/adjuntos/[id]` desde el disco | `/adjuntos/[id]` en streaming desde Storage |
| Encabezados de seguridad | nginx (`cementeria-seguridad.conf`) | Next (`headers()` de `next.config.ts`), los mismos valores |
| Tareas programadas | timers de systemd | Vercel Cron (`vercel.json`) |
| Base | Session pooler (5432) | **Transaction pooler (6543)**, `DB_POOL_MAX=3` |

Para la persona que usa el sistema no cambia nada: la pantalla de adjuntar es
la misma (las fotos se siguen achicando en el navegador antes de subir).

## 1. Antes de empezar

- La base de Supabase ya está preparada ([docs/despliegue.md](despliegue.md),
  sección 18) y la **Data API apagada** (18.2). La app la usa igual que en el
  servidor municipal: rol `cementeria_app`, TLS con la CA de Supabase, RLS.
- Acceso de administración al repo `DIA-SMT/CementerIA` en GitHub y a la
  organización de la Dirección en Vercel.
- **Plan.** Vercel Hobby es para uso personal y no comercial y sus crons
  corren una vez por día con hasta 59 minutos de demora; para producción
  conviene **Pro** (sección 11). Supabase **Free pausa el proyecto tras una
  semana sin uso** y no tiene backups ni de la base ni de Storage: para
  producción, **Pro** (sección 11).

## 2. Bucket de adjuntos en Supabase Storage [D]

Un bucket **privado** `adjuntos`, de 10 MB por archivo, solo PDF, JPEG y PNG,
**sin políticas** para `anon` ni `authenticated` (con RLS y sin políticas
nadie entra salvo la clave secreta del servidor).

Cualquiera de los dos caminos (son equivalentes e idempotentes):

- **Con el comando**, desde la PC del admin: `npm run supabase:preparar` (ya
  incluye el bucket en el paso e y lo verifica en el g).
- **A mano**: `npm run supabase:sql` y correr
  **`supabase/sql/45_storage.sql`** entero en el SQL Editor del panel (rol
  `postgres`). Después `99_verificar.sql`: los controles 19 ("Storage: bucket
  adjuntos privado") y 20 ("Storage: sin políticas") tienen que salir en `true`.

Si el SQL Editor rechazara el `INSERT` en `storage.buckets` (Supabase puede
restringir el acceso directo a las tablas de Storage en el futuro), crearlo
desde el panel: **Storage → New bucket** → nombre `adjuntos`, **Public bucket
apagado**, **Restrict file size** 10 MB, **Allowed MIME types**
`application/pdf, image/jpeg, image/png`. No crear ninguna política en
**Storage → Policies**.

## 3. Clave secreta de Supabase para el servidor [D]

**Settings → API Keys → Secret keys → Create new secret key**, con un nombre
que diga para qué es (`cementeria-vercel`). Empieza con `sb_secret_`.

- Va **solo** en Vercel, como `SUPABASE_SECRET_KEY` (sensible). Nunca en el
  repo, en un `.env` versionado ni en el navegador (Supabase la rechaza con
  401 si llega desde un navegador).
- **No** usar la clave publicable (`sb_publishable_…`: la app no arranca con
  ella) ni las heredadas `anon`/`service_role` (Supabase las va a dar de baja).
- La app la manda solo en el encabezado `apikey`, como pide Supabase para las
  claves nuevas.

## 4. Crear el proyecto en Vercel [D]

1. **Add New → Project → Import Git Repository** → `DIA-SMT/CementerIA`
   (rama de producción: `main`).
2. **Framework Preset:** Next.js (lo detecta). **Root Directory:** `./`.
   Build e install por defecto (`npm install` corre `prisma generate` en el
   `postinstall`; `next build`). **No** poner `npm run empaquetar`.
3. **Node.js Version** (Settings → Build and Deployment): **24.x** (la que usa
   el equipo; Prisma 7 pide 20.19 o más).
4. **Región de las funciones:** la fija `vercel.json` (`"regions": ["gru1"]`,
   São Paulo, junto a la base en `sa-east-1`). Comprobarlo en Settings →
   Functions después del primer despliegue.
5. **Fluid compute:** prendido (es el valor por defecto en proyectos nuevos).
6. **Deployment Protection:** dejar Vercel Authentication en los Preview.
7. **Variables de entorno**: las de la sección 5, en el entorno
   **Production** solamente, **antes** del primer despliegue.

## 5. Variables de entorno [D]

En **Settings → Environment Variables**, entorno **Production**. Las
marcadas como secretas, con **Sensitive** prendido (Vercel no las vuelve a
mostrar).

| Variable | Valor | De dónde sale | Secreta |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://cementeria_app.blkqkevgsorfflolxiah:<clave>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres` | `DATABASE_URL` de `.env.supabase.local`, **cambiando el puerto `5432` por `6543`** (Transaction pooler; mismo host, mismo usuario, misma clave) | **Sí** |
| `DATABASE_CA_PEM` | el contenido completo de `certs/supabase-prod-ca-2021.crt` (de `-----BEGIN CERTIFICATE-----` a `-----END CERTIFICATE-----`, con los saltos de línea) | el repo (es el certificado público de Supabase) | No (es público) |
| `DB_POOL_MAX` | `3` | — (conexiones por instancia; el pooler multiplexa) | No |
| `SESSION_SECRET` | **una nueva**: `openssl rand -base64 48` | se genera para Vercel; distinta de la de desarrollo y de la del servidor municipal | **Sí** |
| `APP_URL` | `https://<dominio definitivo>` (mientras tanto, `https://<proyecto>.vercel.app`), sin barra final | el dominio (sección 7) | No |
| `CLAVE_POLITICA` | `estricta` | — | No |
| `CIDITUC_HABILITADO` | `0` | — (login propio; Cidituc no está habilitado) | No |
| `ADJUNTOS_ALMACEN` | `supabase` | — | No |
| `SUPABASE_URL` | `https://blkqkevgsorfflolxiah.supabase.co` | Settings → API → Project URL (solo el origen, sin `/storage/v1`) | No |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | sección 3 | **Sí** |
| `CRON_SECRET` | `openssl rand -base64 48` (32 caracteres o más) | se genera; Vercel Cron lo manda como `Authorization: Bearer …` | **Sí** |
| `PERFILES_PRUEBA_CUILS` | **Opcional, solo mientras se prueba**: tu CUIL (o varios, separados por coma; con o sin guiones) | el CUIL con el que entrás (el de `ADMIN_INICIAL_CUIL`) | No, pero son CUILs de personas: no pegarlos en capturas ni tickets |

Las que **NO** van en Vercel:

| Variable | Por qué |
|---|---|
| `NODE_ENV` | La pone Vercel (`production`). |
| `VERCEL`, `VERCEL_GIT_COMMIT_SHA` | Las pone Vercel (variables de sistema). La app usa la primera para exigir Storage y `CRON_SECRET`, y la segunda para la versión de `/api/salud`. |
| `TZ` | Reservada por Vercel. La app no depende de la zona del proceso (todo se calcula con `America/Argentina/Tucuman` explícita; los tests corren en UTC). |
| `MIGRATE_DATABASE_URL`, `SUPABASE_ADMIN_URL` | Migraciones y administración: solo en la PC del admin (`.env.supabase.local`), como en el servidor municipal. |
| `ADMIN_INICIAL_CUIL`, `ADMIN_INICIAL_CLAVE_ARCHIVO` | Son de la semilla (`supabase:preparar`), no de la app. |
| `ADJUNTOS_DIR` | No hay disco persistente en Vercel. |
| `DATABASE_CA_FILE` | El archivo no viaja dentro de la función: va `DATABASE_CA_PEM`. |
| `AUTH_DEV_LOGIN`, `AUTH_DEV_LOGIN_STAGING` | El login simulado no existe en producción (la app no arranca con `AUTH_DEV_LOGIN`). |
| `CIDITUC_API_URL`, `CIDITUC_CLAVE`, `CIDITUC_DERIVADOR_URL`, `CIDITUC_CA_PEM` | Recién cuando se habilite Cidituc (`CIDITUC_HABILITADO=1`). |
| `ENCABEZADOS_SEGURIDAD` | En Vercel los encabezados ya salen de la app (`VERCEL=1`). |
| `NEXT_DEPLOYMENT_ID` | Es del paquete del servidor municipal. |
| Clave publicable, `anon` o `service_role` de Supabase | La app no las usa. |

**Modo prueba (`PERFILES_PRUEBA_CUILS`).** Con la variable, quienes estén en
la lista ven "Ver como…" en el encabezado y pueden pasar su propio usuario a
cualquier área (operador), a Dirección (lectura) y volver a Administrador;
cada cambio queda en la auditoría (docs/api-dominio.md, sección 23). Se carga
en **Production** y hace falta **Redeploy** para que la tome. Al arrancar, el
log de la función muestra `entorno.modo_prueba_activo` (advertencia) con la
cantidad de CUILs. **Antes de cargar datos reales: volver a Administrador,
borrar la variable y redesplegar** (si se borra con alguien en otro perfil,
queda en ese perfil: ver README, "Modo prueba"). Un valor mal escrito (un CUIL
con el dígito verificador equivocado) hace que la app no arranque, con
`PERFILES_PRUEBA_CUILS` en `arranque.rechazado`.

Si falta o sobra algo, la app **no arranca**: el log de la función
(Deployments → el despliegue → Logs) muestra `arranque.rechazado` con la
variable y la regla, nunca el valor.

## 6. Primer despliegue y migraciones [D]

- Vercel **no corre migraciones** (a propósito: el build no tiene la
  credencial de deploy). Las migraciones se aplican antes, desde la PC del
  admin, como siempre: `npm run supabase:preparar` (idempotente; aplica solo
  lo nuevo y verifica) o el `20_migracion_<nueva>.sql` en el SQL Editor.
- Opcional, para confirmar el Transaction pooler con `cementeria_app` antes
  de desplegar: `npm run supabase:verificar -- --app-pooler transaccion`
  (corre la verificación completa, alta de prueba incluida, por el 6543).
- **Deploy**: el primero sale al importar el proyecto; después, cada push a
  `main`. Orden en un cambio con migración: **migrar primero, después el push**
  (la versión vieja de la app convive bien con una migración nueva; al revés no).

## 7. Dominio [D + S]

1. [D] **Settings → Domains → Add**: el dominio definitivo (pedido A4; por
   ejemplo `cementerios.smt.gob.ar`). Vercel muestra el registro DNS a crear.
2. [S] Sistemas crea ese registro (un `CNAME` al destino que indique Vercel
   para un subdominio). Vercel emite el certificado solo.
3. [D] `APP_URL` con ese dominio y **Redeploy** (la base del QR de la carátula).
4. Mientras tanto se puede usar `https://<proyecto>.vercel.app` (con
   `APP_URL` igual a esa URL).

## 8. Tareas programadas (Vercel Cron)

Las mismas tareas que los timers de systemd, en `vercel.json` (horario **UTC**;
Tucumán es UTC−3 todo el año):

| Ruta | UTC | Tucumán | Qué hace (igual que…) | `maxDuration` |
|---|---|---|---|---|
| `/api/cron/historial` | `30 6 * * *` | 03:30 | verificación de la cadena de hash de todo el historial (`historial:verificar`); **500 si hay alguna rota** | 300 s |
| `/api/cron/adjuntos-tmp` | `30 7 * * *` | 04:30 | borra temporales de Storage de más de 24 h (`adjuntos:barrer`) | 120 s |
| `/api/cron/avisos` | `0 9 * * *` | 06:00 | avisos por tiempo del día (`avisos:generar`) | 300 s |

- Las tres son **idempotentes** (Vercel puede saltear una o llamarla dos veces).
- Responden **401** sin `Authorization: Bearer <CRON_SECRET>` (comparación en
  tiempo constante) y no corren nada. Están fuera del proxy de sesión.
- **Plan Hobby:** una ejecución por día por cron y en cualquier momento dentro
  de la hora (los avisos de las 06:00 pueden salir 06:59). Si un día no
  corren, la primera carga de un operador genera los avisos igual.
- Los logs (Logs del proyecto, filtrando por `requestPath:/api/cron/…`) son
  una línea JSON por corrida (`cron.avisos`, `cron.historial`,
  `cron.adjuntos_tmp`) con cantidades; si la cadena está rota, los números
  internos de los expedientes (no son datos personales).
- **Correr una a mano** (para probar o si falló):

  ```sh
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/avisos
  ```

  (o **Settings → Cron Jobs → Run** en el panel de Vercel).
- **La purga de avisos leídos** sigue siendo **manual** (no hay cron): la app
  no puede borrar avisos. El admin, desde su PC, con la credencial de deploy:
  `MIGRATE_DATABASE_URL=<de .env.supabase.local> DATABASE_CA_FILE=certs/supabase-prod-ca-2021.crt npm run avisos:purgar -- --confirmar`
  (sin `--confirmar` solo cuenta).
- Los **backups** no son un cron de Vercel: ver sección 11.

## 9. Verificación posterior al despliegue [D]

1. **Salud:** `curl -fsS https://<dominio>/api/salud` → `{"estado":"ok","version":"vercel-<commit>","base":"ok"}`.
2. **Encabezados:** `curl -sI https://<dominio>/login` muestra
   `strict-transport-security`, `x-frame-options: SAMEORIGIN`,
   `x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy` y
   `content-security-policy: frame-ancestors 'self'; …`; y **no**
   `x-powered-by`.
3. **Login:** ingresar con el admin (contraseña propia) y abrir la bandeja.
   En Admin → Auditoría, el ingreso tiene que tener la IP real (no vacía).
4. **Adjunto grande:** en un expediente de prueba, adjuntar un **PDF de unos
   9 MB** (más que los 4,5 MB que deja pasar una función de Vercel). Tiene que
   decir "Se adjuntó …". En el panel de Supabase, Storage → `adjuntos`: el
   archivo en `AAAA/MM/<uuid>` y nada en `tmp/`.
5. **Verlo:** abrirlo desde la ficha (visor) y descargarlo: se ve completo, y en
   Auditoría quedan `ver_adjunto` y `descargar_adjunto`.
6. **Una foto:** adjuntar una foto del celular: se achica antes de subir
   (igual que antes).
7. **Cron:** `curl -i https://<dominio>/api/cron/adjuntos-tmp` sin encabezado →
   **401**; con `-H "Authorization: Bearer $CRON_SECRET"` → **200** con
   `{"ok":true,"tarea":"adjuntos_tmp",…}`. Después, `…/api/cron/historial`
   → 200 con `rotos: 0`.
8. Al día siguiente: Settings → Cron Jobs, las tres con su última corrida en 200.

## 10. Decisiones y fuentes

**Adjuntos en Supabase Storage, sin dependencias nuevas.** La API REST de
Storage con `fetch` (`src/lib/adjuntos/supabase.ts`), con los mismos
endpoints que usa `@supabase/storage-js`
([StorageFileApi.ts](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts)):
`POST /object/{bucket}/{ruta}`, `GET /object/{bucket}/{ruta}`,
`POST /object/upload/sign/{bucket}/{ruta}` (→ `{ url: "/object/upload/sign/…?token=…" }`),
`PUT` a esa URL, `POST /object/move`, `DELETE /object/{bucket}` con
`{ prefixes }` y `POST /object/list/{bucket}`. Mismo ciclo que el disco:
`tmp/<uuid>` → movimiento → `AAAA/MM/<uuid>`; purga y retiro iguales.

**La clave secreta va solo en `apikey`.** Las claves nuevas no son JWT;
Supabase pide mandarlas en `apikey` y no como `Authorization: Bearer`, y las
rechaza (401) desde un navegador
([Understanding API keys](https://supabase.com/docs/guides/api/api-keys)).
Una heredada `service_role` (JWT) se manda en los dos, como siempre.

**Subida en dos fases.** Una función de Vercel no recibe más de **4,5 MB** de
cuerpo (413 `FUNCTION_PAYLOAD_TOO_LARGE`), y Vercel recomienda que el
navegador suba directo al almacenamiento con un token que da el servidor
después de autenticar ([Functions limits](https://vercel.com/docs/functions/limitations);
[How to bypass the 4.5MB limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)).
Por eso, con `ADJUNTOS_ALMACEN=supabase`:

1. `POST /api/expedientes/[numero]/adjuntos/autorizar`: los mismos controles
   que la subida de siempre (comando ya usado, expediente, estado, permiso
   `adjuntar`, documento) **más la versión**, y una URL firmada de subida hacia
   `tmp/<uuid>` sin `x-upsert` (crea ese objeto; no puede pisar ninguno). La
   app le da también un **ticket** HMAC (con `SESSION_SECRET`) que ata ese
   temporal al usuario, al expediente y al comando, y vence con la URL
   (2 horas: [createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)).
2. El navegador hace `PUT` del archivo a esa URL con el tipo detectado por
   magic bytes. El bucket vuelve a limitar tamaño y tipo.
3. `POST …/adjuntos/confirmar`: con el ticket, la app vuelve a hacer los
   controles, **lee el temporal en streaming** desde Storage (corta pasados
   10 MB), **calcula el sha256**, mira los **magic bytes** y recién entonces
   inserta el movimiento con la misma lógica de hoy y lo mueve a
   `AAAA/MM/<uuid>`. Cualquier error borra el temporal.

El disco sigue con el Route Handler en streaming de siempre (y con
`supabase`, ese camino también funciona, juntando hasta 10 MB en memoria, para
un servidor propio sin el límite de Vercel).

**Lectura en streaming, sin URL firmada.** El límite de 4,5 MB es del cuerpo
del pedido; Vercel indica que las respuestas en streaming no lo tienen
([How to bypass the 4.5MB limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions):
"streaming functions, which don't have this limit"), y el streaming está
activo por defecto en las funciones de Node. Por eso `/adjuntos/[id]` sigue
pasando el archivo por la app (permisos, motivo, auditoría y los encabezados
`sandbox`), con `Accept-Encoding: identity` hacia Storage para que el
`Content-Length` sea el del archivo. No se usa una URL firmada de descarga:
saltearía el `Content-Security-Policy: sandbox` y dejaría un enlace reusable
durante su vigencia. Si algún día Vercel limitara también eso, la salida sería
una URL firmada de pocos segundos solo para `?descargar=1`, con el registro
de auditoría antes de redirigir.

**El bucket desde SQL.** La guía oficial crea buckets con
`insert into storage.buckets` desde el SQL Editor
([Creating buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets));
el esquema `storage` da privilegios por defecto a `postgres`. `45_storage.sql`
lo hace con `ON CONFLICT (id) DO UPDATE` (idempotente) y avisa si hay
políticas. El simulador (`npm run supabase:probar`) imita `storage.buckets` y
`storage.objects` (dueño `supabase_storage_admin`, RLS, privilegios para
`postgres`) y aplica el archivo dos veces; no imita la API de Storage (eso lo
hacen los tests con un Storage falso en memoria).

**Transaction pooler (6543).** Supabase lo recomienda para serverless
([Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)).
Con `cementeria_app` funciona: `@prisma/adapter-pg` no usa prepared
statements con nombre, `conActor()` fija el actor con `set_config(…, true)`
(de transacción), el alta usa `pg_advisory_xact_lock` (de transacción) y no
hay `SET` de sesión, `LISTEN` ni tablas temporales; la zona horaria UTC va
**por rol** porque Supavisor no pasa `options` (docs/despliegue.md, 18.6).
`DB_POOL_MAX=3`: Fluid compute reusa la instancia para varios pedidos y el
pooler multiplexa.

**Encabezados de seguridad.** En el servidor municipal los pone nginx; en
Vercel no hay nginx, así que `next.config.ts` los pone con `headers()` solo
cuando el build es de Vercel (`VERCEL=1`) o con `ENCABEZADOS_SEGURIDAD=app`:
así no salen dos veces detrás de nginx. Mismos valores. La CSP general no se
aplica a `/adjuntos/…`, que manda la suya (`sandbox; default-src 'none'`):
en Next un encabezado de `next.config` le gana al del Route Handler
(`next/dist/server/send-response.js` no agrega uno que ya está). Ahí el
enmarcado lo sigue limitando `X-Frame-Options: SAMEORIGIN`. Vercel agrega su
propio HSTS por defecto ([Response headers](https://vercel.com/docs/headers/response-headers)).
También `poweredByHeader: false` (nginx ya sacaba `X-Powered-By`).

**IP, Host y redirecciones detrás de Vercel.** Vercel pisa `X-Forwarded-For`
con la IP del cliente para que no se pueda falsificar, y `X-Real-IP` es igual
([Request headers](https://vercel.com/docs/headers/request-headers)):
`ipDeSolicitud()` sirve tal cual. `Host` es el dominio que pidió el navegador,
así que `mismoOrigen()` compara bien; `request.url` es la URL pública, así que
las redirecciones (proxy, Salir) salen con el dominio correcto. `/api/salud`
no pide sesión y muestra `vercel-<commit>` (`VERCEL_GIT_COMMIT_SHA`).

**Crons.** Vercel manda `CRON_SECRET` como `Authorization: Bearer …`, usa
UTC, no reintenta, puede saltear o duplicar una corrida y en Hobby corre una
vez por día con precisión de una hora
([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs);
[Usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)).
`maxDuration` por ruta, por debajo del máximo de Hobby (300 s;
[Functions limits](https://vercel.com/docs/functions/limitations)). Los
scripts y las rutas llaman a las mismas funciones (`src/lib/tareas/programadas.ts`).

**`output: "standalone"` solo fuera de Vercel.** Vercel empaqueta cada función
con su propio rastreo de archivos; el paquete del servidor municipal sigue
saliendo igual (`npm run empaquetar`).

**Rastreo de archivos.** `src/lib/db/tls.ts` lee `DATABASE_CA_FILE` con una
ruta de configuración, y Turbopack avisaba "Dynamic filesystem access causes
tracing of the whole project": metía el repositorio entero (docs, tests,
`entregables/`…) en el paquete de cada función (`.next/standalone` pesaba
85 MB). Con `/*turbopackIgnore: true*/` en esas dos lecturas el aviso
desaparece y el standalone baja a 37 MB; probado con `server.js` contra una
base efímera (salud, login y los tres crons). En Vercel la CA va por
`DATABASE_CA_PEM`, así que no hace falta ningún archivo.

## 11. Riesgos y límites

- **Supabase Free pausa el proyecto** tras una semana sin actividad y no tiene
  backups (docs/despliegue.md, 18.1 y 18.9). Para producción, **Pro**.
- **Los backups de la base no incluyen los archivos de Storage**: Supabase lo
  dice explícitamente ([Backups](https://supabase.com/docs/guides/platform/backups)).
  Mientras no haya una copia periódica del bucket (por ejemplo, un script del
  admin que baje `adjuntos/` con la clave secreta a un disco municipal), los
  adjuntos dependen de la durabilidad de Storage. Pendiente de decidir con
  Sistemas.
- **Vercel Hobby** es para uso personal y no comercial y sus crons pueden
  demorarse hasta 59 minutos. Para producción, **Pro**.
- **La URL firmada de subida vale 2 horas** para `tmp/<uuid>`: después de
  confirmar (el temporal se mueve), quien la tenga podría volver a subir un
  archivo a ese mismo `tmp/<uuid>`. No llega a ningún expediente: confirmar
  otra vez con ese ticket devuelve lo ya registrado (el comando quedó usado) y
  borra el temporal; si nadie confirma, el barrido lo borra a las 24 h.
- **El rol `postgres` y la clave secreta** pueden leer y borrar todo el
  bucket: van al gestor de contraseñas, con pocas personas en la organización
  de Supabase y MFA (como en 18.7). La cadena de hash del historial guarda el
  sha256 de cada adjunto.
- **Logs:** la retención de los logs de Vercel depende del plan; los logs de
  la app no llevan datos personales ni secretos.
