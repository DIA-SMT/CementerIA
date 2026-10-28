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
31, 32, .local/35, 40, 45, 99. En una base nueva, el 31 y el 32 no hacen nada
(el 30 ya trae todo), pero se pueden correr igual.

**¿Es la base que ya está en uso** (con todo hasta `*_login_propio` y la
inhumación)? Entonces no es este orden completo: ver "La base en uso: qué
correr ahora (28/10/2026)", más abajo.

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
| 6 | `30_semilla_produccion.sql` | Áreas, catálogos, cementerios, feriados, las 6 plantillas publicadas (las 4 de la carga inicial y las 2 de inhumación; nacen borrador y se publican, como exige `plantillas_congelar`) y, desde el 28/10/2026, las 3 preguntas frecuentes del sitio público, con el actor SISTEMA y los ids de una base vacía | Sí, sobre una base que tiene solo lo de la semilla. **No** sobre una base en uso: ver "La semilla cambió" |
| 6b | `31_inhumacion.sql` | Solo lo que la semilla agregó el 27/10/2026: el tipo de trámite `INHUMACION` y las plantillas `INHUMACION_DIRECCION` e `INHUMACION_EMPRESA`, publicadas. Busca por código y deja que la base ponga los ids; al final controla que las dos queden publicadas (si no, falla y no deja nada) | Sí (lo que existe, por código, no se toca) |
| 6c | `32_sitio_publico.sql` | Solo lo que la semilla agregó el 28/10/2026: las 3 preguntas frecuentes iniciales de la página pública (`sitio_preguntas`). Busca por el texto de la pregunta y deja que la base ponga los ids. Va **después** de la migración `*_sitio_publico` (antes, se niega: falta la tabla). Lo demás del sitio arranca vacío: lo carga la Dirección | Sí (una pregunta que ya existe, por su texto, no se toca) |
| 7 | `.local/35_admin_inicial.sql` | El administrador inicial (`ADMIN_INICIAL_CUIL`) con el hash de su contraseña temporal y `debe_cambiar_clave`. Si ya existe con contraseña, no lo toca; si existe sin, le pone la temporal | Sí |
| 8 | `40_cierre_api.sql` | Les saca todo a `anon`, `authenticated` y `service_role` sobre las tablas, secuencias y funciones de `public` y `auditoria`, y los privilegios por defecto | Sí |
| 8b | `45_storage.sql` | El bucket **privado** `adjuntos` de Supabase Storage (10 MB, PDF/JPEG/PNG, sin políticas). Solo lo usa el despliegue en Vercel ([docs/despliegue-vercel.md](../../docs/despliegue-vercel.md)); controles 19 y 20 de `99_verificar.sql` | Sí |
| 9 | `99_verificar.sql` | **Solo lectura**: una fila por control (`ok` true/false/null). El control 21 ("plantillas de la semilla publicadas") dice si falta alguna de las 6; el 24 (28/10/2026), si las 6 tablas del sitio público tienen RLS, auditoría y los privilegios mínimos; el 25, si están las preguntas frecuentes iniciales. Como los otros que leen datos, el 21 y el 25 salen en null con `postgres` y los hace `npm run supabase:verificar` | Sí, las veces que haga falta |

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
  `99_verificar.sql`. Si la semilla cambió, ver la sección siguiente.

## La semilla cambió (tipos de trámite o plantillas nuevas)

`30_semilla_produccion.sql` es la semilla **entera** con los ids de una base
vacía (`INSERT … ON CONFLICT DO NOTHING` sin clave). Es idempotente y, sobre
una base que tiene **solo** la semilla anterior, agrega lo nuevo sin duplicar
(probado: paquete del 27/10/2026 a la mañana, después el 30 nuevo, dos veces).
Pero en una base **en uso** no es seguro:

- si el admin creó un tipo de trámite o una plantilla (aunque sea un borrador),
  ocupan los ids que el 30 nuevo usa: la fila nueva se saltea en silencio, una
  plantilla puede quedar con el tipo de trámite de otra y el UPDATE de la
  publicación intenta publicar **el borrador del admin** (si ya tiene notas de
  cambio, lo publica; si no, el archivo falla por `plantillas_publicacion_check`
  y no cambia nada);
- si los ids ya difieren (por ejemplo, después de aplicar el incremental en una
  base con los números corridos), el 30 falla (y no cambia nada).

Por eso lo nuevo de la semilla va además en un archivo **incremental**
(`31_…`, `32_…`), que busca por código, deja que la base ponga los ids, no
toca lo que ya existe y controla que las plantillas queden publicadas.
`npm run supabase:probar` lo prueba sobre una base con la semilla anterior y un
tipo de trámite y un borrador del admin (simulador C). Con conexión desde la
máquina, `npm run supabase:preparar` hace lo mismo con la semilla en TS (crea
lo que falta, por código).

### La inhumación (27/10/2026): qué correr en Supabase

En la base de Supabase que ya está andando (con todo hasta el login propio y la
semilla anterior, las 4 plantillas), en el SQL Editor y en este orden:

1. `31_inhumacion.sql`: el tipo de trámite y las dos plantillas, publicadas.
2. `99_verificar.sql` (opcional desde el panel: el control 21 sale en null con
   `postgres`). Mejor, desde la máquina: `npm run supabase:verificar`, que lo
   corre como `cementeria_app` y tiene que dar "6 de 6 publicadas".

No hace falta volver a correr `30_semilla_produccion.sql` (y no conviene, por
lo de arriba), ni `40_cierre_api.sql` (no hay tablas ni funciones nuevas), ni
ninguna migración: no hay migración nueva. La app no se redespliega por esto:
las plantillas son datos y aparecen en "Nuevo expediente" al recargar. En una
base vacía, el orden completo de arriba (el 30 ya las trae y el 31 no hace nada).

Si la migración nueva crea tablas, tiene que habilitarles RLS y crear la
política de `cementeria_app` (ver la migración `*_rls_defensa`):
`tests/integracion/rls.test.ts` falla si falta.

### La base en uso: qué correr ahora (28/10/2026)

En la base de Supabase que ya está andando (con todo hasta `*_login_propio` y
la inhumación, es decir, el paquete del 27/10/2026), en el SQL Editor y **en
este orden exacto**, cada archivo entero y de una sola vez:

1. `20_migracion_20261028120000_consulta_publica.sql`: la consulta pública, que
   **todavía no se aplicó** (ver la sección siguiente). Una sola vez.
2. `20_migracion_20261028180000_sitio_publico.sql`: las 6 tablas del sitio
   público (`sitio_cementerios`, `sitio_recorridos`, `sitio_recorrido_fechas`,
   `sitio_novedades`, `sitio_contacto`, `sitio_preguntas`) con sus CHECKs,
   auditoría, GRANTs y RLS. Una sola vez (repetida, se niega y no cambia nada).
3. `32_sitio_publico.sql`: las 3 preguntas frecuentes iniciales. Idempotente.
4. `40_cierre_api.sql` (idempotente): hay tablas y funciones nuevas; les saca
   todo a `anon`, `authenticated` y `service_role`. El archivo no cambió: cierra
   todo lo de `public` y `auditoria`, también lo nuevo.
5. `99_verificar.sql`: nada en falso; en verde el 22 ("consulta pública:
   código e intentos protegidos") y el 24 ("sitio público: RLS, auditoría y
   privilegios"). El 23 y el 25 salen en null con `postgres`: desde la máquina,
   `npm run supabase:verificar` (como `cementeria_app`) tiene que decir "0 sin
   un código de consulta válido" y "3 de las 3 iniciales".

**No** se corren el 30, el 31 ni ninguna otra migración. **Después**,
redesplegar la app en Vercel; en Vercel no se agrega ninguna variable (las
`LANDING_*` ya no existen). Probado en `npm run supabase:probar`, simulador D:
el paquete anterior con 300 expedientes, y encima exactamente estos cinco pasos
(el 32 antes de la migración del sitio se niega; después, dos veces, deja las
preguntas una sola vez). Con conexión desde la máquina, en lugar de los pasos
1 a 5: `npm run supabase:preparar`.

### El sitio público (28/10/2026)

Agrega `20_migracion_20261028180000_sitio_publico.sql` (el contenido de la
página pública que carga la Dirección: docs/api-dominio.md, sección 25) y
`32_sitio_publico.sql` (las preguntas frecuentes de la semilla de producción,
para una base en uso). Cambian `30_semilla_produccion.sql` (trae también las
preguntas, para una base nueva) y `99_verificar.sql` (controles 24 y 25). La
app lee, inserta y actualiza las 6 tablas, y borra solo fechas de recorrido y
novedades. El orden, en "La base en uso", arriba.

### La consulta pública (28/10/2026): qué correr en Supabase

Agrega `20_migracion_20261028120000_consulta_publica.sql`: la columna
`expedientes.codigo_consulta` (con el **relleno** de un código para cada
expediente que ya existe), el trigger que no deja cambiarlo salvo con
"Regenerar código de consulta", la tabla `auditoria.intentos_consulta` (con RLS,
sus GRANTs y su trigger) y las acciones nuevas de `auditoria.accesos`. Cambian
también `99_verificar.sql` (controles 22 y 23) y `30_semilla_produccion.sql`,
**solo en su huella** (la semilla de producción es la misma: no se vuelve a
correr).

En la base de Supabase que ya está andando (con todo hasta `*_login_propio` y
la inhumación), en el SQL Editor y **en este orden**:

1. `20_migracion_20261028120000_consulta_publica.sql`: una sola vez (si ya está
   aplicada, se niega y no cambia nada). Con expedientes cargados, el relleno
   les da a todos un código válido y distinto, sin tocar `actualizado_en`
   (probado: `npm run supabase:probar`, simulador D, con 300 expedientes).
2. `40_cierre_api.sql` (idempotente): hay una tabla y funciones nuevas, y les
   saca todo a `anon`, `authenticated` y `service_role`.
3. `99_verificar.sql`: nada en falso; el control 22 ("consulta pública: código
   e intentos protegidos") en verde. El 23 ("expedientes con código") sale en
   null con `postgres`: mejor, desde la máquina, `npm run supabase:verificar`,
   que lo corre como `cementeria_app` y tiene que decir "0 sin un código de
   consulta válido".

**Después**, redesplegar la app en Vercel (la versión nueva lee
`codigo_consulta`). En ese orden: la versión anterior de la app sigue andando
con la base ya migrada (el alta deja el código por el DEFAULT de la columna),
pero la nueva no anda con la base sin migrar. Con conexión desde la máquina, en
lugar de los pasos 1 a 3: `npm run supabase:preparar` (aplica solo lo nuevo y
verifica). En una base vacía, el orden completo de arriba.

### El login propio (27/10/2026)

Agrega `20_migracion_20261027180000_login_propio.sql` (columnas de contraseña
en `usuarios`, sin tablas nuevas) y cambia `30_semilla_produccion.sql` (solo
la huella) y `99_verificar.sql` (el control de la semilla cuenta admins con
contraseña). En una base que ya tenía todo hasta `*_rls_defensa`, en orden:
`20_migracion_20261027180000_login_propio.sql`, `30_semilla_produccion.sql`,
`.local/35_admin_inicial.sql`, `40_cierre_api.sql` y `99_verificar.sql`.
En una base vacía, el orden completo de arriba. Después, el primer ingreso del
admin: docs/despliegue.md, 18.12.
