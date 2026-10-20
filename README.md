# CementerIA

Seguimiento de expedientes de la **Dirección de Cementerios** de la
Municipalidad de San Miguel de Tucumán. Reemplaza la ficha de papel donde cada
área anota los pases: el expediente de papel sigue siendo el oficial, y la
herramienta registra por dónde anda, quién lo tiene, qué falta para avanzar y
cuánto tiempo lleva en cada área.

La especificación es [docs/propuesta-mvp.md](docs/propuesta-mvp.md). Este
repositorio tiene la **semana 1** del plan (sección 6): base de datos con sus
reglas, semilla, ingreso con Cidituc y login simulado; y de la **semana 2**, el
dominio (alta con personas versionadas y ubicación dinámica, ficha, búsqueda,
edición, carátula e historial, en `src/lib/dominio/`, con su referencia en
[docs/api-dominio.md](docs/api-dominio.md)) y sus pantallas: buscador
(`/expedientes`, también desde la búsqueda del encabezado), alta
(`/expedientes/nuevo`), ficha de solo lectura, edición e imprimibles (carátula
con QR e historial, A4). De la **semana 3** está el dominio del flujo (pases
con "Faltan N", recepción, devoluciones, subtareas, documentos, adjuntos y
bandejas; [docs/api-dominio.md](docs/api-dominio.md), sección 12) y sus pantallas
(sección 13): `/bandeja` con las pestañas Por confirmar, En mi área y Afuera
(confirmar de a uno o en lote, "Dar pase rápido"), el contador "Por confirmar"
del encabezado, los diálogos de la ficha (confirmar recepción, "Qué falta para
avanzar" y "Dar pase · Faltan N", devolver, tildar, documentos, adjuntar con
visor) y los Route Handlers de adjuntos. El panel sigue "En construcción"
(semana 4).

Stack: Next.js 16.4 (App Router), React 19, TypeScript 5 estricto, Tailwind 4,
Prisma 7.9 con `@prisma/adapter-pg`, PostgreSQL 15, zod 4 y jose 6. Antes de
tocar código de Next, leer [AGENTS.md](AGENTS.md): Next 16 cambia APIs y
convenciones (por ejemplo, el middleware es `src/proxy.ts`).

Solo datos ficticios en desarrollo y staging.

## Requisitos

- **Node.js 24** y npm.
- **Nada más.** No hace falta PostgreSQL instalado, ni Docker ni WSL: el
  paquete `embedded-postgres` (dependencia de desarrollo) trae los binarios de
  PostgreSQL 15, con `unaccent` y `pg_trgm`, y `scripts/db-local.mjs` los usa
  para levantar un clúster local en `.local/pgdata`, puerto 54329.

## Puesta en marcha local

1. **Dependencias.** También genera el cliente de Prisma en `src/generated/`.

   ```bash
   npm install
   ```

2. **Variables de entorno.** Copiar el ejemplo y completar las claves
   (`.env.local` no se versiona).

   ```bash
   cp .env.example .env.local
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

   Con ese comando se generan las claves de `cementeria_app`,
   `cementeria_deploy` y del superusuario local, y (con 48 bytes) el
   `SESSION_SECRET`. Van en las URLs de `DATABASE_URL`, `MIGRATE_DATABASE_URL`
   y `SHADOW_DATABASE_URL`, sin caracteres especiales.

3. **Login simulado.** Va en un archivo aparte que solo lee `next dev`
   (si estuviera en `.env.local`, `next start` se negaría a arrancar):

   ```bash
   echo AUTH_DEV_LOGIN=1 > .env.development.local
   ```

4. **Base local.** Crea el clúster la primera vez, lo arranca y crea roles,
   bases y extensiones. El servidor queda corriendo al terminar el comando.

   ```bash
   npm run db:local
   ```

5. **Migraciones y semilla.** Borra y recrea la base `cementeria`, aplica las
   migraciones con `cementeria_deploy` y carga la semilla.

   ```bash
   npm run db:reset
   ```

6. **App.**

   ```bash
   npm run dev
   ```

   Abrir <http://localhost:3000>: sin sesión lleva a `/login`, que ofrece el
   **login simulado** (`/dev/login`). Ahí se entra como cualquier usuario de la
   semilla: los operadores van a `/bandeja`; Dirección y el administrador, a
   `/panel`.

7. **Al terminar**, detener la base: `npm run db:local:detener`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | `next dev` (Turbopack) en el puerto 3000 |
| `npm run build` / `npm start` | Build de producción y servidor de producción |
| `npm run lint` | ESLint (incluye la regla que prohíbe escribir fuera de `conActor()`) |
| `npm run typecheck` | `next typegen` y `tsc --noEmit` (sin typegen no existen los tipos globales de rutas, como `LayoutProps`) |
| `npm test` | Tests unitarios (Vitest): `src/**/*.test.ts` y `prisma/**/*.test.ts` |
| `npm run test:integracion` | Tests contra un PostgreSQL 15 efímero (ver abajo) |
| `npm run db:local` | Crea (la primera vez) y arranca el PostgreSQL local, y corre `scripts/db-init.sql`. Idempotente |
| `npm run db:local:estado` | Si corre, versión y bases |
| `npm run db:local:detener` | Lo detiene |
| `npm run db:reset` | Base vacía, migraciones (`prisma migrate deploy`) y semilla |
| `npm run db:seed` | Solo la semilla. Idempotente: crea lo que falta y no toca lo que existe |
| `npm run adjuntos:barrer` | Borra los temporales de adjuntos (`<ADJUNTOS_DIR>/tmp/`) de más de 24 h (`-- --horas N` para otra antigüedad) |
| `npm run db:migrate` | `prisma migrate dev`, para crear una migración nueva |
| `npm run db:deploy` | `prisma migrate deploy`, como en un despliegue |
| `node scripts/db-local.mjs reiniciar-datos` | **Borra** el clúster local entero y lo crea de nuevo (por ejemplo, para cambiar la clave del superusuario) |

## Estructura

```
docs/                      especificación y documentos de la semana 1
prisma/
  schema.prisma            tablas, claves e índices (también parciales y GIN)
  migrations/              *_inicial (generada y retocada) y *_reglas_base (a mano:
                           CHECKs, funciones, triggers, GRANTs, usuario SISTEMA)
  seed.ts, semilla/        semilla: áreas, catálogos, cementerios, feriados,
                           usuarios ficticios y las 4 plantillas de la sección 4
scripts/
  db-local.mjs, lib/       PostgreSQL local con embedded-postgres
  db-init.sql              roles, bases y extensiones de DESARROLLO (owner con CREATEDB)
  roles.sql                roles de PRODUCCIÓN, staging y restauración (sin CREATEDB)
src/
  proxy.ts                 renovación deslizante de la sesión (no autoriza)
  instrumentation.ts       valida el entorno al arrancar (lib/arranque.ts)
  app/                     rutas: /login, /auth/*, /dev/login, /sin-acceso y,
                           en (app)/, las pantallas con sesión; los adjuntos en
                           /adjuntos/[movimientoId] y POST /api/expedientes/[numero]/adjuntos
  lib/db/                  cliente de Prisma (solo lectura) y conActor() (escrituras)
  lib/auth/                Cidituc, sesión, cookies, ingreso y salida
  lib/dominio/             permisos, navegación, CUIL y plantillas (esquema zod y
                           validación de "Publicar"); búsqueda (busqueda.ts) y
                           expedientes/ (alta, edición, ficha, carátula, esquemas
                           zod armados en tiempo de ejecución); semana 3: recepción,
                           subtareas, documentos, adjuntos, pase, devolución,
                           bandejas y flujo.ts (puro). Ver docs/api-dominio.md
  lib/adjuntos/            tipos por magic bytes y el almacén en disco (AlmacenAdjuntos)
  lib/presentacion/        lógica de las pantallas, sin Next: modelo del formulario, parámetros
                           del buscador, URL del QR, enlace wa.me, textos, la lógica de las
                           Server Actions (acciones.ts) y, semana 3, "Faltan N", pestañas y
                           fecha efectiva (flujo.ts), reducción de imágenes (imagen.ts) y los
                           Route Handlers de adjuntos (adjuntos-http.ts)
  lib/fechas.ts            fechas YYYY-MM-DD, hoy en Tucumán, datetime-local y formato es-AR
  lib/entorno.ts           variables de entorno validadas con zod
  generated/               cliente de Prisma generado (no se versiona)
tests/
  integracion/             batería contra PostgreSQL real (ver su README)
  stubs/                   reemplazo de server-only para Vitest
```

## Base de datos

- Roles (sección 2): `cementeria_owner` (NOLOGIN, dueño de todo),
  `cementeria_deploy` (migraciones; al conectarse toma el rol owner) y
  `cementeria_app` (la aplicación, con privilegios mínimos).
- El historial (`movimientos`) es **solo inserción**, también para el owner y
  con `session_replication_role = replica`: los triggers son `ENABLE ALWAYS`.
- **Toda escritura pasa por `conActor(usuarioId, motivo, async (tx) => …)`**
  (`src/lib/db/transaccion.ts`), que fija el actor de la transacción. En
  movimientos, expedientes, personas y la configuración auditada, la base
  rechaza una escritura sin actor. `prisma` (`src/lib/db/cliente.ts`) es para
  leer; ESLint marca una escritura con él fuera de `src/lib/db`.
- Las conexiones de Prisma van con `TimeZone=UTC` (`crearCliente()`):
  `@prisma/adapter-pg` lo da por hecho y, con la sesión en hora de Tucumán,
  corría 3 horas cada `timestamptz`. psql y los scripts siguen viendo la hora
  de Tucumán (`ALTER DATABASE … SET timezone`), y los triggers usan
  `AT TIME ZONE` explícito.
- Para cambiar el esquema: editar `prisma/schema.prisma`,
  `npx prisma migrate dev --create-only`, revisar el SQL generado (que no borre
  nada escrito a mano), agregarle los GRANTs de cada tabla nueva y aplicar con
  `npm run db:migrate`. Control de deriva (también para CI):

  ```bash
  npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
  ```

  tiene que decir "No difference detected".
- El log del PostgreSQL local queda en `.local/postgres.log`. Las claves de los
  roles salen de las URLs de `.env.local`; si se cambia una, volver a correr
  `npm run db:local`.

## Semilla

`npm run db:seed` (y el final de `npm run db:reset`) carga, con el rol de la app
y firmado por el usuario técnico SISTEMA: 11 áreas, 3 cementerios con
nomenclatura provisoria, tipos de monumento y de trámite, feriados 2026 y 2027
(años sin cerrar), las 4 plantillas publicadas como v1, el admin de
`ADMIN_INICIAL_CUIL` y un usuario ficticio por área. Los datos están en
`prisma/semilla/`, con las marcas [I] y [C] de la propuesta.

Después carga los **30 expedientes ficticios** de la sección 6
(`prisma/semilla/expedientes.ts`): los da de alta el usuario ficticio de Mesa
de Entradas con la función de alta del dominio, repartidos entre las 4
plantillas y los 3 cementerios, algunos con solicitante distinto del titular y
3 históricos. Quedan en el primer paso. Cada uno tiene un `comando_id` fijo, así
que una segunda corrida no los duplica.

- Cada plantilla pasa la validación de "Publicar" antes de grabarse; si una
  falla, no se graba nada.
- Una plantilla publicada no se modifica (está congelada): si la semilla cambió
  una, `npm run db:reset`.
- En producción corre con `npm run db:seed -- --sin-ficticios` (sin usuarios
  ni expedientes ficticios) y exige `ADMIN_INICIAL_CUIL`.

## Ingreso

- **Desarrollo:** con `AUTH_DEV_LOGIN=1` (en `.env.development.local`),
  `/dev/login` deja entrar como cualquier usuario activo de la semilla. En
  producción esa ruta responde 404, y el servidor **no arranca** si
  `AUTH_DEV_LOGIN` está definida (`src/lib/arranque.ts` termina el proceso).
- **Staging sin clave en el derivador:** `AUTH_DEV_LOGIN_STAGING` con una lista
  blanca de CUILs y `APP_URL` https con "staging" en el host.
- **Cidituc:** `CIDITUC_HABILITADO=1` y `CIDITUC_API_URL`. El botón "Ingresar
  con Cidituc" va a `GET /auth/ingresar`, que deja el `state` en una cookie y
  manda al derivador; el derivador vuelve a `/auth/callback`, que valida el
  token contra `/usuarios/authStatusIA` (empleados) y busca al usuario por CUIL.
  El derivador desplegado no acepta `localhost`: para probarlo entero hay que
  correr el derivador local (`C:\repo\derivador`) con callback a
  `http://localhost:3000/auth/callback`.
- **Diagnóstico sin una persona real:** `curl -i -c c.txt localhost:3000/auth/ingresar`,
  tomar el `state` del `Location` y llamar a
  `curl -i -b c.txt "localhost:3000/auth/callback?state=<state>&auth=token-basura"`.
  `error=token_invalido` en el `Location` quiere decir que el backend respondió
  (401); `sin_conexion` o `no_disponible`, que no se llegó.
- **Pendiente de verificar a mano:** que un token de **vecino** reciba 401 en
  `/usuarios/authStatusIA`. Los tests solo simulan esa respuesta; la prueba
  real está en `docs/pedidos-dia-1.md`, B1, paso 4.
- **Sesión:** cookie `cem_sesion` (en producción, `__Host-cem_sesion`), JWT
  HS256 con `SESSION_SECRET`, 60 minutos de inactividad y 10 horas como máximo.
  `src/proxy.ts` la renueva, pero no autoriza: cada página y cada acción llama
  a `getUsuarioActual()` / `exigirPantalla()` (`src/lib/auth/sesion.ts`) y a
  `exigirPermiso()` (`src/lib/dominio/permisos.ts`). Salir cierra todas las
  sesiones del usuario.

## Tests

```bash
npm test                  # unitarios, sin base
npm run test:integracion  # contra PostgreSQL 15 real
npm run typecheck
npm run lint
```

`npm run test:integracion` **no usa la base local**: cada corrida crea su
propio clúster efímero en `%TEMP%/cementeria-it-*`, en un puerto libre, aplica
las migraciones y lo borra al terminar. No hace falta `npm run db:local`. Cómo
escribir tests nuevos y qué cubre cada archivo:
[tests/integracion/README.md](tests/integracion/README.md). Si una corrida se
corta con Ctrl+C, puede quedar un `postgres.exe` huérfano y su carpeta en
`%TEMP%`; ahí está cómo limpiarlos.

Los dos tipos de test corren con `TZ=UTC`: el código no puede depender de la
zona horaria de la máquina.

## Variables de entorno

Documentadas una por una en [.env.example](.env.example).

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | La app, con el rol `cementeria_app` |
| `MIGRATE_DATABASE_URL` | Migraciones, con `cementeria_deploy` (en producción no queda en el servidor) |
| `SHADOW_DATABASE_URL` | Shadow database de `prisma migrate dev` y `migrate diff` |
| `DB_LOCAL_CLAVE_SUPERUSUARIO` | Superusuario del clúster local (solo `db-local.mjs`) |
| `DB_POOL_MAX` | Opcional: conexiones del pool (5 por defecto) |
| `SESSION_SECRET` | Firma de la cookie de sesión; 32 caracteres o más |
| `AUTH_DEV_LOGIN` | `1` habilita `/dev/login`. Solo en `.env.development.local` |
| `AUTH_DEV_LOGIN_STAGING`, `APP_URL` | Staging: lista blanca de CUILs para `/dev/login` y su URL https. `APP_URL` es además la base del QR de la carátula (sin ella, el host del request) |
| `ADMIN_INICIAL_CUIL` | CUIL del primer administrador que crea la semilla |
| `CIDITUC_HABILITADO` | `1` muestra el botón de Cidituc; `0` mientras el derivador no tenga la clave |
| `CIDITUC_DERIVADOR_URL`, `CIDITUC_CLAVE` | Origen del derivador y clave de esta instancia (`cementeria` o `cementeria-staging`) |
| `CIDITUC_API_URL` | Backend contra el que se valida el token; https en producción |
| `CIDITUC_CA_PEM` | Opcional: certificado intermedio que reemplaza al embebido |
| `ADJUNTOS_DIR` | Carpeta de los adjuntos, fuera del webroot. Obligatoria y absoluta en producción; en desarrollo, `./.data/adjuntos` |

## Documentos

- [docs/propuesta-mvp.md](docs/propuesta-mvp.md): el diseño confirmado (modelo
  de datos, reglas del flujo, plantillas, pantallas, stack y plan).
- [docs/api-dominio.md](docs/api-dominio.md): la API del dominio de expedientes
  (alta, edición, ficha, búsqueda, carátula) para quien hace las pantallas.
- [docs/pedidos-dia-1.md](docs/pedidos-dia-1.md): pedidos a Sistemas, al equipo
  del derivador y a Asesoría Legal, listos para completar y enviar.
- [docs/borrador-tecnico-art22.md](docs/borrador-tecnico-art22.md): insumo
  técnico para el acto de creación del archivo (art. 22, Ley 25.326).
- [docs/taller-plantillas.md](docs/taller-plantillas.md): guía del taller de
  validación de plantillas con la Dirección de Cementerios.
- [tests/integracion/README.md](tests/integracion/README.md): la batería de
  integración.
