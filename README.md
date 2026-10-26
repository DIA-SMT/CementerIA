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
visor) y los Route Handlers de adjuntos.

Semana 4, primera parte: los cambios que pidieron las fuentes de la Dirección
([docs/fuentes/README.md](docs/fuentes/README.md), "Cambios que esto implica",
1 a 6): panteón y monumentos por cementerio; conceptos, documentos y subtareas
según el cementerio (Jardín no cobra inspección técnica; Conservación pagada en
el Oeste y Jardín); titulares que son personas jurídicas (razón social y CUIT,
migración `*_personas_juridicas`); nomenclatura del Oeste (sección A a H) y de
Jardín (romanos); y el paso DIM omitible. Ver
[docs/api-dominio.md](docs/api-dominio.md), sección 14.

Semana 4, el dominio ([docs/api-dominio.md](docs/api-dominio.md), sección
15): concluir, archivar (también sin concluir, con el regreso del papel desde
un paso externo), desarchivar, anular y reabrir; reiniciar con otra
plantilla (precarga del alta y enlace anterior/siguiente) y "archivar y abrir
vinculado" para la caducidad; correcciones (revertir, fecha, observación,
subtarea, retirar y purgar adjuntos, suprimir persona), con la proyección
reconstruida desde el historial; vencimiento y semáforo del plazo DIM y la API
de feriados con "Cerrar año"; transcripción histórica y "Terminar carga
histórica"; pestañas Plazos y Carga histórica; panel; CSV del buscador; notas.
Sin cambios de esquema.

Semana 4, las pantallas (sección 16 de la referencia): en la ficha, los
diálogos de concluir ("Faltan N"), archivar (también sin concluir, con el
regreso del papel), desarchivar, anular, reabrir, ubicación de archivo,
reiniciar con otra plantilla, archivar y abrir vinculado y nota; el plazo DIM
con semáforo; el menú "Corregir" de cada movimiento del historial (revertir,
fecha, observación, subtarea, retirar y purgar adjuntos) con lo corregido
tachado y enlazado, y "Suprimir datos" (admin); el alta precargada
(`/expedientes/nuevo?desde=`); `/expedientes/[numero]/transcribir` (grilla
manejable con teclado, tildes con fecha, estado final, foto de la ficha y
"Terminar carga histórica"); las pestañas Plazos y Carga histórica de la
bandeja; `/panel` con cada número enlazado a la búsqueda e imprimible; y
"Exportar CSV" en el buscador (`GET /expedientes/exportar`, Dirección y
admin).

Semana 5, la administración (solo el admin; dominio en `src/lib/dominio/admin/`,
[docs/api-dominio.md](docs/api-dominio.md), secciones 17 y 18):
`/admin/plantillas` (catálogo por código con la versión publicada, el
borrador y los expedientes en curso por versión; Nueva, Editar y Retirar);
`/admin/plantillas/[codigo]/v/[version]`, el editor del borrador (o visor de
una versión congelada) con pestañas General, Personas, Pasos, Documentación,
Conceptos, Campos extra y Vista previa por cementerio, todo armado desde el
esquema `DefinicionPlantilla`: Guardar borrador, Validar (cada error de
`validar.ts` en su pestaña y su campo) y Publicar con notas de cambio, que
retira la versión anterior en la misma transacción (los expedientes en curso
siguen con la suya); `/admin/usuarios` (alta por CUIL, área o rol,
desactivar, que corta la sesión en el request siguiente, y reactivar; nunca
sin un administrador activo); `/admin/catalogos` (áreas, cementerios con su
nomenclatura, donde una clave con valores no se borra ni se renombra, tipos
de monumento y de trámite, y feriados con "Cerrar año"); y `/admin/auditoria`
(accesos, con "Ver datos completos" y su motivo, y cambios de configuración
con el antes y el después, filtrados, paginados y con CSV registrado como
`exportar`). Sin cambios de esquema.

Rediseño visual, primera etapa: tokens de color y tipografía (Inter
autoalojada), componentes base, ingreso, barra lateral y panel. Tokens, tabla de
contrastes, marca provisoria y pendientes en [docs/diseno.md](docs/diseno.md).

Historial (26/10/2026; [docs/api-dominio.md](docs/api-dominio.md), sección
19): la **cadena de hash** que la propuesta dejaba para la fase 2 (migración
`*_cadena_hash`): cada movimiento guarda el SHA-256 de sus campos y del hash del
anterior del mismo expediente, lo fija el trigger `movimientos_sellar` y
`f_verificar_cadena` lo recalcula. La ficha tiene "Verificar integridad", la
carátula y el historial impresos llevan la huella (16 caracteres del hash del
último movimiento) y `npm run historial:verificar` verifica todos los
expedientes (de noche en producción, timer `cementeria-historial`). Y la línea
de tiempo de la ficha se filtra sin recargar (tipos de movimiento, "Solo lo
importante", paso) y se agrupa por paso, con los días hábiles en cada área, o
por día; el historial impreso va agrupado por paso.

Métricas de gestión (26/10/2026; [docs/api-dominio.md](docs/api-dominio.md),
sección 20): `/panel/metricas`, para Dirección y el admin (permiso
`ver_metricas`, ítem "Métricas" de la barra lateral y botón en el panel). El
panel dice qué hay que mirar hoy; esto mide cómo viene el circuito, todo desde
`movimientos` y `expedientes` con la fecha efectiva y días hábiles de la base:
tiempo de punta a punta de los concluidos (mediana, promedio y percentil 90,
por tipo de trámite y plantilla), tiempo por paso y área con el cuello de
botella, tiempo hasta confirmar la recepción, flujo por mes o semana (ingresados,
concluidos, archivados, anulados y stock en trámite), devoluciones (tasa por
paso, de qué área a qué área y motivos agrupados por los atajos), carga por
área, plazo DIM, la **línea de base** de antes del sistema (con las fichas de
papel transcriptas, avisando cuando la muestra es chica) y el papel (fichas
reemplazadas y una estimación de hojas con su supuesto a la vista). Gráficos
hechos a mano en HTML y CSS, sin librerías, cada uno con su tabla accesible y
su CSV (`GET /panel/metricas/exportar`, registrado como `exportar`). Por
defecto, los últimos 6 meses y sin la carga histórica. Sin cambios de esquema.

Avisos en el sistema (26/10/2026; [docs/api-dominio.md](docs/api-dominio.md),
sección 21; migración `*_avisos`): la **campana** del encabezado con el
contador de no leídos ("Avisos, 3 sin leer") y un panel con los últimos, y
`/avisos` con la lista completa, filtros y marcar leído o no leído. Avisan, a
los operadores activos del área que corresponde (nunca a quien actuó, ni al
admin ni a Dirección): "Llegó un expediente" (pase; en un paso externo, a la
custodia), "Te devolvieron un expediente" (con el motivo, prioridad alta),
"Plazo DIM por vencer" y "vencido" (a Tributario), "Enviado sin confirmar"
(más de 2 días hábiles, al área que lo envió), "Demorado" (los `dias_alerta`
del paso, uno por paso) y "Concluido o archivado" (a Mesa de Entradas, que lo
puede apagar). Los de un pase o una devolución nacen en la misma transacción
del movimiento; los del tiempo, con `npm run avisos:generar` (timer
`cementeria-avisos`, 6:00) o, si ese día no corrió, en la primera carga de un
operador. Sin datos personales. Sin correo ni WhatsApp todavía (el diseño los
deja listos). La campana se refresca al cambiar de pantalla y cada 60 s con la
pestaña visible, sin renovar la sesión.

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
| `npm run build` / `npm start` | Build de producción y servidor de producción, para probar en local. Con `output: 'standalone'`, `next start` avisa que no es lo que corre en el servidor: allá va `node server.js` del paquete (`npm run empaquetar`) |
| `npm run lint` | ESLint (incluye la regla que prohíbe escribir fuera de `conActor()`) |
| `npm run typecheck` | `next typegen` y `tsc --noEmit` (sin typegen no existen los tipos globales de rutas, como `LayoutProps`) |
| `npm test` | Tests unitarios (Vitest): `src/**/*.test.ts` y `prisma/**/*.test.ts` |
| `npm run test:integracion` | Tests contra un PostgreSQL 15 efímero (ver abajo) |
| `npm run test:e2e` | Pruebas de punta a punta con Playwright contra la app (`next build` + `next start`) y un PostgreSQL efímero (ver abajo) |
| `npm run db:local` | Crea (la primera vez) y arranca el PostgreSQL local, y corre `scripts/db-init.sql`. Idempotente |
| `npm run db:local:estado` | Si corre, versión y bases |
| `npm run db:local:detener` | Lo detiene |
| `npm run db:reset` | Base vacía, migraciones (`prisma migrate deploy`) y semilla |
| `npm run db:seed` | Solo la semilla. Idempotente: crea lo que falta y no toca lo que existe |
| `npm run adjuntos:barrer` | Borra los temporales de adjuntos (`<ADJUNTOS_DIR>/tmp/`) de más de 24 h (`-- --horas N` para otra antigüedad) |
| `npm run empaquetar` | Arma el paquete de despliegue (build standalone, migraciones y CLI de Prisma) desde el último commit, en `build/paquetes/`. Ver [docs/despliegue.md](docs/despliegue.md) |
| `npm run db:verificar-restauracion` | Controla una base restaurada (conteos, dueños, triggers, cadena de hash, sha256 de adjuntos). Lo usa `scripts/restaurar-prueba.sh` |
| `npm run historial:verificar` | Verifica la cadena de hash del historial de todos los expedientes y lo registra en `auditoria.accesos` como SISTEMA (`-- --sin-registro` para no registrar). Sale con 1 si hay alguno roto |
| `npm run avisos:generar` | Genera los avisos por tiempo (plazo DIM, sin confirmar, demorado) como SISTEMA. Idempotente; `-- --fecha AAAA-MM-DD` para generar como si fuera ese día |
| `npm run avisos:purgar` | Cuenta los avisos leídos hace más de 90 días; `-- --confirmar` los borra (`-- --dias N`, 90 o más). Con `MIGRATE_DATABASE_URL`: la app no puede borrar avisos |
| `npm run db:migrate` | `prisma migrate dev`, para crear una migración nueva |
| `npm run db:deploy` | `prisma migrate deploy`, como en un despliegue |
| `node scripts/db-local.mjs reiniciar-datos` | **Borra** el clúster local entero y lo crea de nuevo (por ejemplo, para cambiar la clave del superusuario) |

## Estructura

```
docs/                      especificación y documentos de la semana 1
prisma/
  schema.prisma            tablas, claves e índices (también parciales y GIN)
  migrations/              *_inicial (generada y retocada), *_reglas_base (a mano:
                           CHECKs, funciones, triggers, GRANTs, usuario SISTEMA),
                           *_personas_juridicas (semana 4, a mano), *_cadena_hash
                           (26/10/2026, a mano: la cadena de hash del historial) y
                           *_avisos (26/10/2026: avisos, preferencias y corridas)
  seed.ts, semilla/        semilla: áreas, catálogos, cementerios, feriados,
                           usuarios ficticios y las 4 plantillas de la sección 4
scripts/
  db-local.mjs, lib/       PostgreSQL local con embedded-postgres
  db-init.sql              roles, bases y extensiones de DESARROLLO (owner con CREATEDB)
  roles.sql                roles de PRODUCCIÓN, staging y restauración (sin CREATEDB)
  empaquetar.mjs           paquete de despliegue (npm run empaquetar)
  backup.sh, restaurar-prueba.sh, verificar-restauracion.mjs
                           backup nocturno, prueba de restauración y su verificación
  verificar-historial.ts   la cadena de hash de todos los expedientes (npm run historial:verificar)
  generar-avisos.ts, purgar-avisos.ts
                           los avisos por tiempo (npm run avisos:generar) y la purga de los
                           leídos viejos (npm run avisos:purgar)
deploy/                    systemd, nginx, modelos de entorno y desplegar.sh (docs/despliegue.md)
src/
  proxy.ts                 renovación deslizante de la sesión (no autoriza)
  instrumentation.ts       valida el entorno al arrancar (lib/arranque.ts)
  app/                     rutas: /login, /auth/*, /dev/login, /sin-acceso y,
                           en (app)/, las pantallas con sesión; los adjuntos en
                           /adjuntos/[movimientoId], POST /api/expedientes/[numero]/adjuntos y,
                           semana 4, GET /expedientes/exportar (CSV); semana 5, /admin/* y
                           GET /admin/auditoria/exportar (CSV); 26/10/2026, /avisos y
                           GET /api/avisos/resumen (el refresco de la campana)
  lib/db/                  cliente de Prisma (solo lectura) y conActor() (escrituras)
  lib/auth/                Cidituc, sesión, cookies, ingreso y salida
  lib/dominio/             permisos, navegación, CUIL y plantillas (esquema zod y
                           validación de "Publicar"); búsqueda (busqueda.ts) y
                           expedientes/ (alta, edición, ficha, carátula, esquemas
                           zod armados en tiempo de ejecución); semana 3: recepción,
                           subtareas, documentos, adjuntos, pase, devolución,
                           bandejas y flujo.ts (puro); semana 5: admin/ (plantillas,
                           usuarios, catálogos y auditoría) y plantillas/borrador.ts;
                           metricas/ (las métricas de gestión: recorrido, cálculo puro
                           y consultas); avisos/ (tipos y textos, los de cada evento,
                           los del tiempo y lo que ve cada usuario). Ver docs/api-dominio.md
  lib/adjuntos/            tipos por magic bytes y el almacén en disco (AlmacenAdjuntos)
  lib/presentacion/        lógica de las pantallas, sin Next: modelo del formulario, parámetros
                           del buscador, URL del QR, enlace wa.me, textos, la lógica de las
                           Server Actions (acciones.ts) y, semana 3, "Faltan N", pestañas y
                           fecha efectiva (flujo.ts), reducción de imágenes (imagen.ts) y los
                           Route Handlers de adjuntos (adjuntos-http.ts); semana 4: semáforo,
                           botones de estado y menú Corregir (estados.ts), grilla de
                           transcripción (transcripcion.ts), panel (panel.ts), CSV
                           (exportar-http.ts) y sus Server Actions (acciones-estados.ts);
                           semana 5: el editor de plantillas (editor-plantilla.ts), la
                           auditoría en la URL (auditoria.ts) y las Server Actions y el CSV
                           de /admin (acciones-admin.ts); métricas: filtros, textos y CSV
                           (metricas.ts) y la escala de los gráficos (graficos.ts); avisos:
                           la campana, "hace cuánto" y los filtros de /avisos (avisos.ts)
  lib/fechas.ts            fechas YYYY-MM-DD, hoy en Tucumán, datetime-local y formato es-AR
  lib/entorno.ts           variables de entorno validadas con zod
  generated/               cliente de Prisma generado (no se versiona)
tests/
  integracion/             batería contra PostgreSQL real (ver su README); base-efimera.ts
                           levanta el PostgreSQL efímero (también para e2e)
  e2e/                     pruebas de punta a punta con Playwright (ver su README)
  stubs/                   reemplazo de server-only para Vitest
playwright.config.ts       configuración de Playwright (el arnés está en tests/e2e/global-setup.ts)
```

## Base de datos

- Roles (sección 2): `cementeria_owner` (NOLOGIN, dueño de todo),
  `cementeria_deploy` (migraciones; al conectarse toma el rol owner) y
  `cementeria_app` (la aplicación, con privilegios mínimos).
- El historial (`movimientos`) es **solo inserción**, también para el owner y
  con `session_replication_role = replica`: los triggers son `ENABLE ALWAYS`.
  Desde el 26/10/2026, además, **encadenado**: cada movimiento lleva `hash` y
  `hash_anterior` (SHA-256, `f_hash_movimiento`, los fija el trigger) y
  `f_verificar_cadena(expediente_id)` encuentra el primero alterado o borrado.
  Un superusuario que recalcule la cadena entera solo se ve contra la huella
  impresa (y, en la fase 2, contra el export firmado).
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
y firmado por el usuario técnico SISTEMA: 11 áreas, 3 cementerios con su
nomenclatura (Oeste: sección A a H; Jardín: romanos; Norte: provisoria) y sus
tipos de monumento, tipos de monumento y de trámite, feriados 2026 y 2027
(años sin cerrar), las 4 plantillas publicadas como v1, el admin de
`ADMIN_INICIAL_CUIL` y un usuario ficticio por área. Los datos están en
`prisma/semilla/`, con las marcas [I] y [C] de la propuesta.

Después carga los **30 expedientes ficticios** de la sección 6
(`prisma/semilla/expedientes.ts`): los da de alta el usuario ficticio de Mesa
de Entradas con la función de alta del dominio, repartidos entre las 4
plantillas y los 3 cementerios, algunos con solicitante distinto del titular,
2 con una asociación ficticia como titular (persona jurídica, panteón en el
Oeste) y 3 históricos. Quedan en el primer paso. Cada uno tiene un `comando_id` fijo, así
que una segunda corrida no los duplica.

Después de los 30 carga los **escenarios** (`prisma/semilla/escenarios.ts`):
34 expedientes ficticios más (`CEM-2026-00031` a `00064` en una base recién
reseteada) repartidos por todo el circuito, para que cada bandeja y el panel
tengan algo. Se crean y se mueven solo con las funciones del dominio (alta,
recepción, tildes, documentos, pases, devoluciones, estados, correcciones,
notas, adjuntos y transcripción), cada acción hecha por el usuario ficticio
del área que corresponde, así que el historial, la proyección y la auditoría
son los de un trámite real. Las fechas son días hábiles hacia atrás desde el
día en que corre la semilla (deterministas para ese día) y respetan las reglas
del dominio (no retroceden, hasta 30 días). Cada acción tiene un `comando_id`
fijo: una segunda corrida no crea ni mueve nada. Personas: nombres "…
Escenario", DNI de 9 dígitos `9999NNNNN` (no existen y no chocan con los de las
pruebas), teléfonos `0381 000-5NNN`, correos `@ejemplo.test`.

Con quién entrar por `/dev/login` para ver cada uno (el número es el de una
base recién reseteada):

| Entrar como | Escenario | Qué muestra |
|---|---|---|
| Cómputo | C1 · 00031 | Renovación (Norte) enviada hace 4 días hábiles y sin confirmar: Por confirmar y "sin confirmar" del panel |
| Cómputo | C2 · 00032 | Sin perjuicio de tercero (Jardín) en Cómputo final, llegó ayer sin confirmar |
| Cómputo | C3 · 00033 | Cómputo alta a medias (grabación tildada, constancia pendiente), demorado; Mesa corrigió la fecha de su pase |
| Cómputo | C4 · 00034 | Cómputo final confirmado, sin grabar |
| Liquidación | L1 · 00035, L2 · 00036 | Por confirmar (uno de hoy) |
| Liquidación | L3 · 00037 | Panteón de una asociación (persona jurídica, Oeste): boleta emitida esperando el pago, con nota |
| Liquidación | L4 · 00038 | Todo listo, con el comprobante adjunto (PNG): "Dar pase rápido" |
| Liquidación | L5 · 00039 | Nueva concesión con dos difuntos, confirmada y sin empezar |
| Liquidación | L6 · 00040 | Pase a Legal revertido (corrección del mes); queda listo |
| Liquidación | L7 · 00041 | Devuelto por Asesoría Legal con motivo y la boleta para rehacer (fila roja) |
| Asesoría Legal | G1 · 00042 | 12 días hábiles en Legal (demorado), con nota |
| Asesoría Legal | G2 · 00043 | Vínculo acreditado y dictamen pendiente; actas "no corresponde" (hijo de crianza) |
| Asesoría Legal | G3 · 00044 | Nueva concesión que volvió del cementerio, sin confirmar |
| Administrativo | A1 · 00045 | Resolución confeccionada, falta la firma |
| Administrativo | A2 · 00046 | Plan de pagos que volvió de la DIM pagado: título confeccionado, falta la firma |
| Administrativo | A3 · 00047 | Entrega pendiente (nueva concesión, Jardín) |
| Administrativo | A4 · 00048 | Título entregado: listo para concluir |
| Administrativo | A5 · 00049 | Por confirmar |
| Tributario | T1 · 00050 | Por confirmar |
| Tributario | T2 · 00051 | Notificada, faltan los débitos y la remisión |
| Tributario | D1 · 00052 | En la DIM (Afuera y Plazos): asociación con panteón, plazo en término |
| Tributario | D2 · 00053 | En la DIM: plazo por vencer (iniciado antes del sistema, transcripto hasta Tributario) |
| Tributario | D3 · 00054 | En la DIM: plazo vencido (iniciado antes del sistema, transcripto hasta la DIM), con nota |
| Mesa de Entradas | M1 · 00055, M2 · 00056 | Nuevas concesiones en el cementerio (Afuera, custodia de Mesa); M1 con el conocimiento tildado y una nota |
| Mesa de Entradas | M3 · 00057 | Devuelto por Cómputo ("Falta documentación"), sin confirmar hace 3 días hábiles |
| Dirección | K1 · 00058, K2 · 00059 | Concluidos (K1 con el informe técnico adjunto en PDF) |
| Dirección | K3 · 00060 | Concluido y archivado con caja |
| Mesa de Entradas | X1 · 00061 | Archivado sin concluir desde el cementerio, con motivo, regreso del papel y caja |
| Mesa de Entradas | Y1 · 00062 | Anulado con motivo (alta duplicada) |
| Mesa de Entradas | R1 · 00063 → 00064 | Reiniciado desde Liquidación como plan de pagos: el anterior anulado y el nuevo en Mesa, enlazados |

Como **Dirección**, `/panel` tiene números en todas las secciones: por estado,
la matriz área × trámite, demorados, plazos por vencer y vencidos, sin
confirmar, diferidos y correcciones del mes, y las 3 cargas históricas de los
30. Mesa de Entradas ve además en Afuera y Plazos lo de la DIM, como consulta.
En `/panel/metricas` salen tiempos, flujo, devoluciones (la de Legal y la de
Cómputo), carga, el plazo DIM y una línea de base chica con los pases
transcriptos de D2 y D3 (5 cargas históricas, ninguna con la conclusión: el
punta a punta "antes" queda sin datos).

**Avisos** (la campana): los crea el dominio en cada pase, devolución y
cierre de los escenarios, y al final la semilla corre la generación por tiempo
como la tarea de cada mañana. Los "llegó" y "te devolvieron" de un paso que el
expediente ya dejó quedan leídos (`prisma/semilla/avisos.ts`: los escenarios
recorren en minutos lo que llevó semanas). En una base recién reseteada son
145, 55 sin leer:

| Área | Sin leer | Qué |
|---|---|---|
| Mesa de Entradas | 30 | 22 demorados (los 30 ficticios llevan más de 2 días hábiles en el primer paso), 4 concluidos o archivados, el devuelto por Cómputo (M3), 2 llegados y 1 sin confirmar (C1) |
| Cómputo | 5 | 3 llegados, 1 demorado (C3) y 1 sin confirmar (lo que devolvió a Mesa, M3) |
| Liquidación | 7 | 6 llegados y el devuelto por Legal (L7) |
| Asesoría Legal | 4 | 3 llegados y 1 demorado (G1) |
| Administrativo | 5 | 5 llegados |
| Tributario | 4 | 2 llegados, plazo DIM por vencer (D2) y vencido (D3) |

Dirección y el admin no reciben avisos.

- Los plazos por vencer y vencido necesitan una notificación de hace más de 25
  días hábiles, que el límite de 30 días corridos no admite en un expediente
  normal: D2 y D3 son "iniciados antes del sistema", transcriptos de la ficha
  de papel con la notificación y su fecha, y con la carga histórica terminada.
- No hay escenario de "archivar y abrir vinculado" (caducidad): la plantilla de
  caducidad todavía no existe (docs/api-dominio.md, 15.2) y ninguna de las 4
  sirve para abrir el expediente vinculado.
- Cómputo, Liquidación, Legal y Administrativo no custodian pasos externos:
  su pestaña Afuera queda vacía.
- Si la semilla se corta a la mitad, la siguiente corrida del mismo día
  completa lo que falta; otro día, `npm run db:reset`.

- Cada plantilla pasa la validación de "Publicar" antes de grabarse; si una
  falla, no se graba nada.
- Una plantilla publicada no se modifica (está congelada): si la semilla cambió
  una, `npm run db:reset`. Lo mismo con un cementerio ya sembrado: la semilla
  no lo toca y avisa si no coincide.
- Las plantillas de la semilla se actualizaron el 20/10/2026 según docs/fuentes
  editando la v1 (todavía no hay producción); sus notas de cambio lo dicen.
- En producción corre con `npm run db:seed -- --sin-ficticios` (sin usuarios,
  expedientes ficticios ni escenarios) y exige `ADMIN_INICIAL_CUIL`.

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
npm run test:e2e          # de punta a punta, con Playwright y Chromium
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

### De punta a punta (Playwright)

```bash
npx playwright install chromium   # la primera vez: el navegador
npm run test:e2e
```

Tampoco usa la base local ni el puerto 3000: el `globalSetup` levanta un
PostgreSQL efímero (el mismo módulo que la integración) con la semilla y los 30
expedientes ficticios, hace `next build` y arranca `next start` en un puerto
libre con `NODE_ENV=test` (así Next no lee `.env.local`, y el login simulado se
habilita sin tocar la regla de producción) y lo apaga y borra todo al
terminar. Cada prueba entra por `/dev/login` con el usuario de su área y crea
lo que necesita, así que corren en paralelo y en cualquier orden. Tarda menos
de un minuto. Cubren:

- el alta de una renovación de contado en el Oeste desde Mesa de Entradas, con
  un error de campo antes y la carátula con número, QR y la huella del
  historial, que "Verificar integridad" muestra igual en la ficha; y los filtros
  del historial (botones con `aria-pressed`, sin recargar);
- el circuito de la propuesta, alta → pase → recepción → devolución →
  conclusión, por los 7 pasos y con cada área en su sesión: "Faltan N", Por
  confirmar, tildes, un adjunto PNG, la devolución en rojo con su motivo y el
  reenvío directo, Concluir y Archivar con caja;
- los avisos: Liquidación devuelve a Cómputo y la campana de Cómputo dice
  "Avisos, 1 sin leer"; el panel (foco, Escape) muestra el aviso con el motivo
  y "Prioridad alta", y abrirlo lleva a la ficha y lo deja leído;
- el conflicto de versión entre dos sesiones del mismo área;
- la búsqueda por DNI con puntos, por N° interno corto y por apellido sin acento;
- el contacto enmascarado y "Ver datos completos" con motivo;
- el panel de Dirección, cuyos números llevan a la búsqueda filtrada;
- las métricas de gestión: se abren desde el panel y la barra, cada sección
  con su gráfico y su tabla, un número enlazado a la búsqueda, el CSV, los
  filtros en la URL, y que los operadores no las ven;
- un borrador de plantilla con un error de validación en su pestaña, que se
  descarta (no se publica);
- los diálogos, que se cierran con Escape y devuelven el foco.

`E2E_SIN_BUILD=1` reusa el build de `.next` para iterar sobre una prueba.
Trazas y capturas de las que fallan en `test-results/` y el reporte en
`playwright-report/` (`npx playwright show-report`). Cómo funciona el arnés,
las ayudas y cómo escribir una prueba: [tests/e2e/README.md](tests/e2e/README.md).

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
  (alta, edición, ficha, búsqueda, carátula, flujo, estados) y de la
  administración (semana 5) para quien hace las pantallas.
- [docs/pedidos-dia-1.md](docs/pedidos-dia-1.md): pedidos a Sistemas, al equipo
  del derivador y a Asesoría Legal, listos para completar y enviar.
- [docs/borrador-tecnico-art22.md](docs/borrador-tecnico-art22.md): insumo
  técnico para el acto de creación del archivo (art. 22, Ley 25.326).
- [docs/despliegue.md](docs/despliegue.md): runbook de staging y producción
  (servidor, base y roles, entorno, nginx, systemd, paquete, actualizaciones,
  rollback, backups, prueba de restauración y checklist), para Sistemas y el
  equipo.
- [docs/taller-plantillas.md](docs/taller-plantillas.md): guía del taller de
  validación de plantillas con la Dirección de Cementerios.
- [tests/integracion/README.md](tests/integracion/README.md): la batería de
  integración.
- [tests/e2e/README.md](tests/e2e/README.md): las pruebas de punta a punta.
