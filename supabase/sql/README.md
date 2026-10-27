# supabase/sql: la base de Supabase a mano, desde el SQL Editor

Lo mismo que hace `npm run supabase:preparar`, partido en archivos SQL para
aplicarlos desde el **SQL Editor** del panel de Supabase (que corre como el rol
`postgres`, sin psql). La forma recomendada sigue siendo `npm run
supabase:preparar` (un comando, con verificación); esto es para cuando se
prefiere el panel. El contexto completo está en
[docs/despliegue.md](../../docs/despliegue.md), "Base en Supabase".

Los archivos los **genera** `npm run supabase:sql` (scripts/supabase/generar-sql.mjs)
desde las mismas fuentes que preparar.mjs: `scripts/supabase/sql/*.sql`, cada
migración de `prisma/migrations` tal cual y la semilla real de `prisma/semilla`
(corrida en un simulador efímero y volcada). No se editan a mano: se cambia la
fuente y se vuelve a generar. `npm run supabase:probar` comprueba que estén al
día y que aplicarlos dé lo mismo que preparar.mjs.

## Antes de empezar

1. `.env.supabase.local` con `SUPABASE_ADMIN_URL` y `ADMIN_INICIAL_CUIL`
   (ver `.env.supabase.ejemplo`).
2. `npm run supabase:sql`. Además de los archivos versionados, escribe en
   `supabase/sql/.local/` (ignorado por git):
   - `05_claves.sql`: las contraseñas de `cementeria_app` y `cementeria_deploy`
     como **verificadores SCRAM** (la clave en texto plano no está en el archivo
     ni llega a la base ni al historial del SQL Editor);
   - `35_admin_inicial.sql`: el administrador inicial con el CUIL real y el
     **hash** (scrypt) de su contraseña temporal, con `debe_cambiar_clave`
     (login propio, 27/10/2026);
   - `clave-admin-inicial.txt`: esa contraseña temporal, en texto. Es el
     único lugar donde está: no se imprime, no va a la base ni al SQL Editor.
     Si ya existe, se reusa (volver a generar no invalida la que ya se
     entregó). Se entrega en mano y se borra después del primer ingreso
     (docs/despliegue.md, 18.12).

   Las claves de los roles no se regeneran: si `.env.supabase.local` ya tiene
   `DATABASE_URL` y `MIGRATE_DATABASE_URL`, `05_claves.sql` lleva
   verificadores de esas mismas claves.

   Y en `.env.supabase.local`, las URLs de los dos roles con esas claves
   (`DATABASE_URL`, `MIGRATE_DATABASE_URL`). Nunca se imprimen.

## Orden exacto

El de los números, mezclando las dos carpetas: 00, 01, 02, .local/05, 20_*, 30,
.local/35, 40, 99.

Cada archivo se pega **entero** en el SQL Editor y se ejecuta **de una sola
vez** (Run): todo el archivo es una única transacción, y si algo falla no queda
nada a medias. Con psql: `psql -1 -v ON_ERROR_STOP=1 -f <archivo>`.

| # | Archivo | Qué hace | ¿Se puede repetir? |
|---|---|---|---|
| 1 | `00_roles.sql` | Crea `cementeria_owner` (NOLOGIN), `cementeria_deploy` (LOGIN, NOINHERIT, entra como owner) y `cementeria_app` (LOGIN), sin claves. Zona horaria por rol (app en UTC, deploy en Tucumán). CONNECT y CREATE sobre la base `postgres` y CREATE sobre `public` para el owner | Sí |
| 2 | `01_extensiones.sql` | `unaccent` y `pg_trgm` en el esquema **public** (o las mueve ahí) | Sí |
| 3 | `02_prisma_migrations.sql` | La tabla de control de Prisma, a nombre del owner | Sí |
| 4 | `.local/05_claves.sql` | Las contraseñas (verificadores SCRAM) | Sí (pone la misma clave) |
| 5 | `20_migracion_<nombre>.sql`, **todas, en orden de nombre** | Cada migración de `prisma/migrations` tal cual, como `cementeria_owner`, y su fila en `_prisma_migrations` con el checksum de Prisma | **No**: si ya está aplicada, se niega y no cambia nada |
| 6 | `30_semilla_produccion.sql` | Áreas, catálogos, cementerios, feriados y las 4 plantillas publicadas (nacen borrador y se publican, como exige `plantillas_congelar`), con el actor SISTEMA | Sí (lo que existe no se toca) |
| 7 | `.local/35_admin_inicial.sql` | El administrador inicial (`ADMIN_INICIAL_CUIL`) con el hash de su contraseña temporal y `debe_cambiar_clave`. Si ya existe con contraseña, no lo toca; si existe sin, le pone la temporal | Sí |
| 8 | `40_cierre_api.sql` | Les saca todo a `anon`, `authenticated` y `service_role` sobre las tablas, secuencias y funciones de `public` y `auditoria`, y los privilegios por defecto | Sí |
| 8b | `45_storage.sql` | El bucket **privado** `adjuntos` de Supabase Storage (10 MB, PDF/JPEG/PNG, sin políticas). Solo lo usa el despliegue en Vercel ([docs/despliegue-vercel.md](../../docs/despliegue-vercel.md)); controles 19 y 20 de `99_verificar.sql` | Sí |
| 9 | `99_verificar.sql` | **Solo lectura**: una fila por control (`ok` true/false/null) | Sí, las veces que haga falta |

Los archivos que corren como dueño hacen `GRANT cementeria_owner TO postgres`,
`SET LOCAL ROLE cementeria_owner` y, al final, `REVOKE`: `postgres` no queda
como miembro del owner.

## Después

1. **Data API apagada** en el panel (Settings → API → Data API): ver
   docs/despliegue.md. Los archivos cierran la base, pero la primera barrera es
   que PostgREST no publique nada.
2. `npm run db:deploy` con la conexión de deploy (o
   `npx prisma migrate status`): tiene que decir que no hay nada pendiente. Con
   el entorno de `.env.supabase.local`:

   ```powershell
   # PowerShell, en la raíz del repositorio
   Get-Content .env.supabase.local | Where-Object { $_ -match '^(MIGRATE_DATABASE_URL|DATABASE_CA_FILE)=' } | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }
   npx prisma migrate status
   ```

3. `npm run supabase:verificar`: la verificación completa como `cementeria_app`
   (la misma de preparar.mjs: los controles de `99_verificar.sql` que leen datos
   y que con `postgres` salen en null, intentos reales de UPDATE/DELETE del
   historial y de lectura con anon y authenticated, un alta de prueba que se
   deshace y `historial:verificar`).

## Una migración nueva

Cuando se agrega una migración a `prisma/migrations` (por ejemplo, la del login
propio):

- con conexión desde la máquina: `npm run supabase:preparar` (aplica solo lo
  nuevo con `prisma migrate deploy` y vuelve a verificar), o `npm run db:deploy`
  con la conexión de deploy;
- a mano: `npm run supabase:sql` (genera `20_migracion_<nueva>.sql` sola; los
  demás archivos no cambian salvo que cambie la semilla), y en el SQL Editor se
  corre **solo** ese archivo nuevo, después `40_cierre_api.sql` (idempotente) y
  `99_verificar.sql`. Si la semilla cambió, también `30_semilla_produccion.sql`
  (agrega lo que falta; lo existente no se toca).

Si la migración nueva crea tablas, tiene que habilitarles RLS y crear la
política de `cementeria_app` (ver la migración `*_rls_defensa`):
`tests/integracion/rls.test.ts` falla si falta.

### El login propio (27/10/2026)

Agrega `20_migracion_20261027180000_login_propio.sql` (columnas de contraseña
en `usuarios`, sin tablas nuevas) y cambia `30_semilla_produccion.sql` (solo
la huella) y `99_verificar.sql` (el control de la semilla cuenta admins con
contraseña). En una base que ya tenía todo hasta `*_rls_defensa`, en orden:
`20_migracion_20261027180000_login_propio.sql`, `30_semilla_produccion.sql`,
`.local/35_admin_inicial.sql`, `40_cierre_api.sql` y `99_verificar.sql`.
En una base vacía, el orden completo de arriba. Después, el primer ingreso del
admin: docs/despliegue.md, 18.12.
