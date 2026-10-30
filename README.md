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
contrastes, marca y pendientes en [docs/diseno.md](docs/diseno.md).

Kit institucional (30/10/2026; [docs/diseno.md](docs/diseno.md), "Kit
institucional"): la paleta del kit (`#006BFF`, `#32B2F6`, `#F4D900`,
`#0F2F5D`), el **logo oficial** de la Municipalidad (solo sobre azul), el sitio
público como el moodboard aprobado, el ingreso dividido 55/45 y el banner de
bienvenida del panel. Las imágenes están en `public/assets/cementeria/` y son
**conceptuales, generadas con IA** (procedencia en
`public/assets/cementeria/LEEME.md`). Sin cambios de base ni de lógica.

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

Base en **Supabase** (decisión del 27/10/2026; [docs/despliegue.md](docs/despliegue.md),
sección 18): `npm run supabase:preparar` deja lista la base del proyecto con un
solo comando (roles, extensiones, migraciones, cierre de la API pública de
Supabase, semilla de producción y verificación), leyendo la conexión de
administración de `.env.supabase.local` ([.env.supabase.ejemplo](.env.supabase.ejemplo)).
Lo mismo, como archivos SQL para el SQL Editor del panel, en
[supabase/sql/](supabase/sql/README.md) (`npm run supabase:sql`). TLS con la CA
de Supabase verificando el host (`DATABASE_CA_FILE`), RLS en todas las tablas
con política solo para la app (migración `*_rls_defensa`) y un simulador local
de Supabase para probar todo sin el proyecto real (`npm run supabase:probar`).

Despliegue en **Vercel** (decisión del 27/10/2026;
[docs/despliegue-vercel.md](docs/despliegue-vercel.md)): región `gru1` junto a
la base, adjuntos en un bucket privado de Supabase Storage
(`ADJUNTOS_ALMACEN=supabase`; el navegador sube directo con una URL firmada y
la app verifica tamaño, magic bytes y sha256 antes de registrar; la lectura
sigue pasando por la app en streaming), tareas programadas con Vercel Cron
(`/api/cron/*`, con `CRON_SECRET`) y los encabezados de seguridad desde
`next.config.ts`. El despliegue en el servidor municipal (nginx, systemd,
disco) sigue igual: se elige por configuración.

Recorridos guiados (27/10/2026; [docs/diseno.md](docs/diseno.md), sección
"Recorridos guiados"): para el piloto, cada pantalla tiene un recorrido corto
(de 4 a 8 pasos) que resalta cada parte y la explica en lenguaje de mostrador,
según el rol (Mesa de Entradas, las demás áreas, Dirección, el admin): la
bandeja, la ficha, el alta (primer paso y formulario), la búsqueda, la
transcripción, el panel, las métricas, los avisos, cambiar la contraseña y las
pantallas de administración, más una **bienvenida** general que se ofrece una
sola vez al primer ingreso. Nunca se abre solo: la primera vez que se entra a
una pantalla aparece una invitación chica abajo a la derecha (Empezar · Ahora
no · No volver a mostrar) que no tapa ni toma el foco, y el botón **"?"**
("Recorrido de esta pantalla") del encabezado lo abre cuando se quiera. Lo
contestado queda en el navegador (localStorage, por usuario, pantalla y
versión del recorrido); en `/avisos`, "Reiniciar los recorridos" vuelve a
ofrecerlos. Componente propio (`src/components/recorrido/`, motor puro en
`src/lib/presentacion/recorridos/`), sin dependencias nuevas ni cambios en la
base.

Inhumación (27/10/2026; [docs/fuentes/README.md](docs/fuentes/README.md),
"Procedimiento de inhumación"): el procedimiento que pasó la Dirección, cargado
como datos, sin código de dominio ni migraciones. Un tipo de trámite nuevo,
**Inhumación**, con dos plantillas publicadas (v1, "Carga inicial, a validar"):
**INHUMACION_DIRECCION** (Mesa de Entradas, Liquidación con la boleta, que
lleva la apertura solo en Jardín, el cementerio y "Conocimiento y archivo" en
Mesa) e **INHUMACION_EMPRESA** (paga la empresa fúnebre: Mesa verifica e informa
el horario, el cementerio y "Conocimiento y archivo"). Lo que el modelo no puede
decir (una vía de pago "la paga la empresa fúnebre", la fecha de defunción
obligatoria) y las preguntas para la Dirección están en
[docs/taller-plantillas.md](docs/taller-plantillas.md), plantillas E y F. En
Supabase: `supabase/sql/31_inhumacion.sql` ([supabase/sql/README.md](supabase/sql/README.md),
"La semilla cambió").

Página pública y consulta del trámite (28/10/2026; [docs/api-dominio.md](docs/api-dominio.md),
sección 24; migración `*_consulta_publica`): ver "Página pública y consulta",
más abajo. Sin sesión, `/` es el inicio del sitio público y `/consulta` la
consulta del trámite; con sesión, `/` sigue llevando a cada uno a su inicio.
El concesionario consulta con el número de expediente y un **código de
consulta** que le entrega Mesa de Entradas en un comprobante (con QR).

Sitio público (28/10/2026; [docs/api-dominio.md](docs/api-dominio.md), sección
25; migración `*_sitio_publico`): ver "Sitio público", más abajo. El sitio de
los cementerios, una página por sección (`/`, `/cementerios`, `/horarios`,
`/recorridos`, `/tramites`, `/consulta` y `/contacto`), y su contenido lo carga
la **Dirección** desde `/admin/sitio-publico`, sin tocar código ni variables de
entorno.

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

   Abrir <http://localhost:3000>: sin sesión es el inicio del sitio público (ver
   "Sitio público" y "Página pública y consulta") y "Ingreso del personal" lleva
   a `/login` (cualquier otra pantalla, sin sesión, también). Ahí se entra
   con el **CUIL** (con o sin guiones) o el correo y la **contraseña de
   desarrollo** de todos los usuarios de la semilla, `cementeria-local-2026`
   (ver "Ingreso", más abajo), o por el **login simulado** (`/dev/login`,
   enlace al pie), que entra como cualquier usuario sin contraseña. Los
   operadores van a `/bandeja`; Dirección y el administrador, a `/panel`.

7. **Al terminar**, detener la base: `npm run db:local:detener`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | `next dev` (Turbopack) en el puerto 3000 |
| `npm run build` / `npm start` | Build de producción y servidor de producción, para probar en local. Con `output: 'standalone'`, `next start` avisa que no es lo que corre en el servidor: allá va `node server.js` del paquete (`npm run empaquetar`) |
| `npm run lint` | ESLint (incluye la regla que prohíbe escribir fuera de `conActor()`) |
| `npm run typecheck` | `next typegen` y `tsc --noEmit` (sin typegen no existen los tipos globales de rutas, como `LayoutProps`) |
| `npm test` | Tests unitarios (Vitest): `src/**/*.test.ts`, `prisma/**/*.test.ts` y `scripts/**/*.test.ts` |
| `npm run test:integracion` | Tests contra un PostgreSQL 15 efímero (ver abajo) |
| `npm run test:e2e` | Pruebas de punta a punta con Playwright contra la app (`next build` + `next start`) y un PostgreSQL efímero (ver abajo) |
| `npm run db:local` | Crea (la primera vez) y arranca el PostgreSQL local, y corre `scripts/db-init.sql`. Idempotente |
| `npm run db:local:estado` | Si corre, versión y bases |
| `npm run db:local:detener` | Lo detiene |
| `npm run db:reset` | Base vacía, migraciones (`prisma migrate deploy`) y semilla |
| `npm run db:seed` | Solo la semilla. Idempotente: crea lo que falta y no toca lo que existe |
| `npm run adjuntos:barrer` | Borra los temporales de adjuntos (`tmp/` del almacén: `<ADJUNTOS_DIR>/tmp/` o Supabase Storage) de más de 24 h (`-- --horas N` para otra antigüedad) |
| `npm run empaquetar` | Arma el paquete de despliegue (build standalone, migraciones y CLI de Prisma) desde el último commit, en `build/paquetes/`. Ver [docs/despliegue.md](docs/despliegue.md) |
| `npm run db:verificar-restauracion` | Controla una base restaurada (conteos, dueños, triggers, cadena de hash, sha256 de adjuntos). Lo usa `scripts/restaurar-prueba.sh` |
| `npm run historial:verificar` | Verifica la cadena de hash del historial de todos los expedientes y lo registra en `auditoria.accesos` como SISTEMA (`-- --sin-registro` para no registrar). Sale con 1 si hay alguno roto |
| `npm run avisos:generar` | Genera los avisos por tiempo (plazo DIM, sin confirmar, demorado) como SISTEMA. Idempotente; `-- --fecha AAAA-MM-DD` para generar como si fuera ese día. Desde el 28/10/2026, después borra los intentos fallidos de la consulta pública de más de 7 días |
| `npm run avisos:purgar` | Cuenta los avisos leídos hace más de 90 días; `-- --confirmar` los borra (`-- --dias N`, 90 o más). Con `MIGRATE_DATABASE_URL`: la app no puede borrar avisos |
| `npm run supabase:preparar` | Prepara la base de Supabase de punta a punta (roles con claves aleatorias, extensiones, migraciones, cierre de la API, semilla de producción y verificación). Idempotente. Lee `.env.supabase.local`; `-- --rotar-claves`, `-- --app-pooler transaccion`, `-- --env <archivo>`. Ver [docs/despliegue.md](docs/despliegue.md), sección 18 |
| `npm run supabase:verificar` | Solo la verificación final de la base de Supabase, como `cementeria_app` |
| `npm run supabase:sql` | Genera `supabase/sql/` (lo mismo, en archivos para el SQL Editor; ver su README) y, con `.env.supabase.local`, las claves y el admin en `supabase/sql/.local/`. `-- --verificar` controla que estén al día |
| `npm run supabase:simular` | Simulador local de Supabase (`iniciar --dir <carpeta> --env-salida <archivo>` / `detener --dir <carpeta> --borrar`) |
| `npm run supabase:probar` | Prueba de punta a punta contra simuladores: preparar dos veces, TLS, los archivos de `supabase/sql/` en orden y que los dos caminos den lo mismo |
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
                           (26/10/2026, a mano: la cadena de hash del historial),
                           *_avisos (26/10/2026: avisos, preferencias y corridas),
                           *_rls_defensa y *_login_propio (27/10/2026),
                           *_consulta_publica (28/10/2026: código de consulta e intentos) y
                           *_sitio_publico (28/10/2026: el contenido de la página pública)
  seed.ts, semilla/        semilla: áreas, catálogos, cementerios, feriados,
                           usuarios ficticios, las 4 plantillas de la sección 4 y
                           las 2 de inhumación (27/10/2026); las preguntas frecuentes
                           y, en desarrollo, el sitio público de ejemplo (28/10/2026)
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
  app/                     rutas: en (publico)/ (28/10/2026, sin sesión), el sitio
                           público: / (el inicio), /cementerios, /horarios, /recorridos,
                           /tramites, /contacto y la consulta, /consulta y /consulta/[numero];
                           /login, /cambiar-clave, /auth/*, /dev/login, /sin-acceso y,
                           en (app)/, las pantallas con sesión; los adjuntos en
                           /adjuntos/[movimientoId], POST /api/expedientes/[numero]/adjuntos y,
                           semana 4, GET /expedientes/exportar (CSV); semana 5, /admin/* y
                           GET /admin/auditoria/exportar (CSV); 26/10/2026, /avisos y
                           GET /api/avisos/resumen (el refresco de la campana)
  lib/db/                  cliente de Prisma (solo lectura) y conActor() (escrituras)
  lib/auth/                login propio (clave.ts, ingreso-clave.ts, límites), Cidituc
                           (en pausa), sesión, cookies, ingreso y salida
  lib/dominio/             permisos, navegación, CUIL y plantillas (esquema zod y
                           validación de "Publicar"); búsqueda (busqueda.ts) y
                           expedientes/ (alta, edición, ficha, carátula, esquemas
                           zod armados en tiempo de ejecución); semana 3: recepción,
                           subtareas, documentos, adjuntos, pase, devolución,
                           bandejas y flujo.ts (puro); semana 5: admin/ (plantillas,
                           usuarios, catálogos y auditoría) y plantillas/borrador.ts;
                           metricas/ (las métricas de gestión: recorrido, cálculo puro
                           y consultas); avisos/ (tipos y textos, los de cada evento,
                           los del tiempo y lo que ve cada usuario); publico/ (28/10/2026:
                           la consulta pública y los trámites de la página pública); sitio/
                           (28/10/2026: el contenido de la página que carga la Dirección). Ver docs/api-dominio.md
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
                           la campana, "hace cuánto" y los filtros de /avisos (avisos.ts);
                           recorridos/: los recorridos guiados (contenido.ts, uno por
                           pantalla) y su motor puro (pasos según el rol y lo que se ve,
                           lo recordado en localStorage)
  components/              piezas compartidas de la interfaz (formulario, diálogo, avisos…)
                           y recorrido/: el motor de los recorridos guiados en el navegador
                           (proveedor, invitación, globo y el botón "?")
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
- RLS en todas las tablas (migración `*_rls_defensa`, 27/10/2026), con una sola
  política, para `cementeria_app`: defensa extra para Supabase (si a `anon` o
  `authenticated` les quedara un GRANT, no verían nada). El owner no queda
  filtrado.
- Para cambiar el esquema: editar `prisma/schema.prisma`,
  `npx prisma migrate dev --create-only`, revisar el SQL generado (que no borre
  nada escrito a mano), agregarle los GRANTs de cada tabla nueva **y su RLS con
  la política de `cementeria_app`** (`tests/integracion/rls.test.ts` lo exige) y
  aplicar con `npm run db:migrate`. Después, `npm run supabase:sql` para
  regenerar `supabase/sql/` (`npm test` avisa si quedó desactualizado). Control de deriva (también para CI):

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
tipos de monumento, tipos de monumento y de trámite (con Inhumación, desde el
27/10/2026), feriados 2026 y 2027 (años sin cerrar), las 6 plantillas
publicadas como v1 (las 4 de la carga inicial y las 2 de inhumación), el admin de
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
37 expedientes ficticios más (`CEM-2026-00031` a `00067` en una base recién
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
| Liquidación | I1 · 00065 | Inhumación con pago en la Dirección (Jardín): boleta emitida con la apertura, esperando el pago; demorada (alerta al día hábil) |
| Mesa de Entradas | I2 · 00066 | Inhumación con pago en la empresa fúnebre (Oeste): horario informado, en el cementerio (Afuera) con los comprobantes presentados |
| Mesa de Entradas | I3 · 00067 | Inhumación con pago en la Dirección (Norte) que volvió del cementerio: en "Conocimiento y archivo", falta tildar el conocimiento para concluir y archivar |

**Códigos de consulta** (28/10/2026): la semilla de desarrollo les da a sus
expedientes códigos **deterministas** (`codigoDeSemilla`, en
`src/lib/dominio/expedientes/codigo-consulta.ts`; la app, en cambio, los genera
al azar), así se puede probar la consulta pública siempre con los mismos. En una
base recién reseteada (el año es el del día en que corre la semilla):

| Expediente | Código de consulta | Qué muestra `/consulta` |
|---|---|---|
| `CEM-2026-00001` (uno de los 30) | `PRVE-8A01` | En trámite, en Mesa de Entradas, paso 1 |
| `CEM-2026-00052` (D1) | `PRVE-8A52` | Esperando el pago en la DIM, en la Dirección de Ingresos Municipales (DIM) |
| `CEM-2026-00058` (K1) | `PRVE-8A58` | Finalizado: acercate a Mesa de Entradas |

Directo, como desde el QR del comprobante:
<http://localhost:3000/consulta/CEM-2026-00052#PRVE-8A52>. Los demás tienen uno
derivado de su número (se ve en la ficha). Son públicos (están acá): la semilla
de producción no crea expedientes.

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
recorren en minutos lo que llevó semanas). En una base recién reseteada el
27/10/2026 eran 153, 61 sin leer (los demorados de Mesa dependen del día en que
corre la semilla):

| Área | Sin leer | Qué |
|---|---|---|
| Mesa de Entradas | 34 | 26 demorados (los 30 ficticios que llevan más de 2 días hábiles en el primer paso, M3 y el nuevo de R1), 4 concluidos o archivados, el devuelto por Cómputo (M3), 2 llegados y 1 sin confirmar (C1) |
| Cómputo | 5 | 3 llegados, 1 demorado (C3) y 1 sin confirmar (lo que devolvió a Mesa, M3) |
| Liquidación | 9 | 7 llegados, el devuelto por Legal (L7) y 1 demorado (la inhumación I1) |
| Asesoría Legal | 4 | 3 llegados y 1 demorado (G1) |
| Administrativo | 5 | 5 llegados |
| Tributario | 4 | 2 llegados, plazo DIM por vencer (D2) y vencido (D3) |

Dirección y el admin no reciben avisos.

- Los plazos por vencer y vencido necesitan una notificación de hace más de 25
  días hábiles, que el límite de 30 días corridos no admite en un expediente
  normal: D2 y D3 son "iniciados antes del sistema", transcriptos de la ficha
  de papel con la notificación y su fecha, y con la carga histórica terminada.
- No hay escenario de "archivar y abrir vinculado" (caducidad): la plantilla de
  caducidad todavía no existe (docs/api-dominio.md, 15.2) y ninguna de las de
  la semilla sirve para abrir el expediente vinculado.
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
  expedientes ficticios ni escenarios) y exige `ADMIN_INICIAL_CUIL`. Ahí el
  admin inicial nace con una contraseña temporal que se imprime una sola vez
  (ver "Ingreso").
- Con ficticios, todos los usuarios de la semilla tienen la contraseña de
  desarrollo `cementeria-local-2026` (`CLAVE_DESARROLLO` de
  `prisma/semilla/usuarios.ts`).

## Página pública y consulta

Desde el 28/10/2026 ([docs/api-dominio.md](docs/api-dominio.md), sección 24;
diseño en [docs/diseno.md](docs/diseno.md), "Página pública").

- **`/` sin sesión:** el inicio del sitio de los cementerios (ver "Sitio
  público", más abajo), que lleva a cada página; entre ellas, `/tramites` (los
  tipos de trámite con una plantilla publicada y, para cada uno, "Qué tenés que
  traer": los documentos de origen concesionario de esas plantillas, sin
  repetir, y las modalidades) y `/consulta`. Server Components; el único
  JavaScript es el del formulario. **Con sesión**, `/` redirige como siempre al
  inicio de cada uno (o a cambiar la contraseña temporal), salvo
  `/?vista=publica` (la vista previa de la administración); las demás páginas
  públicas se ven igual con o sin sesión.
- **`/consulta` y `/consulta/[numero]`:** los 3 pasos y el **formulario de
  consulta** (número de expediente y código). El QR del
  comprobante lleva a `/consulta/CEM-…#CODIGO`: el código va en el fragmento,
  que el navegador no manda al servidor (no queda en ningún log); la página lo
  lee, lo saca de la barra de direcciones y consulta por POST (Server Action).
  Nunca por GET ni en la query. `Cache-Control: no-store` y
  `Referrer-Policy: no-referrer` (`next.config.ts`, y `<meta name="referrer">`
  por si delante hay un nginx).
- **Qué responde:** número, tipo de trámite, cementerio, fecha de inicio, el
  estado en lenguaje del ciudadano ("En trámite", "Esperando el pago en la
  DIM", "Finalizado: acercate a Mesa de Entradas" [C], "Archivado"; un anulado,
  "Sin curso: acercate a Mesa de Entradas" [C]), en qué área está (los
  cementerios por su nombre) y desde qué día, el avance (paso X de N y su
  nombre), la fecha del último movimiento y "Información orientativa: el
  expediente oficial es el de papel". **Nunca** personas, DNI o CUIL, ubicación
  de la sepultura, motivos, observaciones, adjuntos, usuarios ni el historial.
- **Errores:** número inexistente, código incorrecto o con otra forma, el
  mismo mensaje: "No encontramos un trámite con ese número y código". El código
  se compara en tiempo constante.
- **Límite de intentos, en la base** (vale con varias instancias en Vercel):
  10 fallidos por IP y 5 por número cada 15 minutos; al llegar, "Hubo
  demasiados intentos fallidos…" sin buscar nada. Los fallidos van a
  `auditoria.intentos_consulta` (IP y número; solo inserción para la app) y se
  borran a los **7 días** (`f_purgar_intentos_consulta()`, con la tarea de los
  avisos de cada mañana; un intento más nuevo no se puede borrar). Cada consulta correcta queda en `auditoria.accesos`
  como `consulta_publica`, sin usuario (para las métricas).
- **El código de consulta:** 8 caracteres de Crockford base32 sin I, L, O ni U
  (`K7QM-3XZP`), al azar (40 bits), único. Lo genera el alta; los expedientes
  anteriores lo recibieron en la migración. Lo ve en la ficha quien ve el
  expediente ("Código de consulta"), con **"Imprimir comprobante"**
  (`/expedientes/[numero]/imprimir?hoja=comprobante`: media hoja A4 con número,
  trámite, cementerio, fecha de inicio, el código grande, la dirección de la
  consulta y el QR; registra `imprimir`), que también se ofrece al terminar el
  alta, junto a la carátula. **"Regenerar código"** (Mesa de Entradas y el
  admin, con motivo) da uno nuevo si el concesionario lo perdió o se filtró: el
  anterior deja de servir y queda `regenerar_codigo_consulta` en
  `auditoria.accesos` con el motivo. No es un movimiento (no toca el historial
  ni su cadena de hash). En la base, el código no cambia con un UPDATE (ni de
  la app ni del owner): solo cuando la transacción lo pide para ese expediente y
  trae el motivo, y el mismo trigger deja la constancia.
- **Sin indexar [C]:** la página pública y la consulta llevan
  `robots: noindex, nofollow` (como el resto) hasta que la Dirección apruebe la
  publicación. Para publicarla, sacarlo del layout de las páginas públicas,
  `src/app/(publico)/layout.tsx` (el layout raíz lo sigue poniendo para lo
  interno).
- **Pendiente [C] de la Dirección:** los textos de los estados "Finalizado" y
  "Sin curso", y la aprobación para publicar e indexar la página. Los datos de
  Mesa de Entradas y el resto del contenido los carga ella misma (ver "Sitio
  público").

## Sitio público

Desde el 28/10/2026 ([docs/api-dominio.md](docs/api-dominio.md), sección 25;
diseño en [docs/diseno.md](docs/diseno.md), "Página pública"; migración
`*_sitio_publico`).

- **Las páginas** (`src/app/(publico)/`; desde el 28/10/2026, una por
  sección: antes era una sola página con anclas): barra fija con la marca, un
  enlace por página (Cementerios, Horarios de visita, Recorridos, Trámites,
  **Consultá tu trámite**, Contacto; la actual, con el subrayado amarillo; en
  celular, un menú que abre sin JavaScript), el botón de **modo claro u
  oscuro** e "Ingreso del personal"; pie. Todo sobre un **fondo fijo** (la
  panorámica de cipreses con un velo, quieta mientras se desplaza el
  contenido) y con tarjetas de vidrio esmerilado.
  - **Modo oscuro:** por defecto el del sistema; el botón de la barra (luna y
    sol) lo alterna y lo recuerda en el navegador (localStorage); si lo elegido
    coincide con el sistema, vuelve a seguir al sistema. Solo el sitio
    público: la app interna y el comprobante imprimible no cambian.
  - **`/` (inicio):** hero de alto completo con el título "Cementerios de San
    Miguel de Tucumán", "Consultá tu trámite" y "Horarios de visita"; seis
    accesos, uno por página; las **novedades** (solo si hay vigentes);
    "Próximos recorridos" (hasta 3 fechas, solo si hay) y una banda corta
    "Consultá tu trámite" que lleva a `/consulta`.
  - **Las internas** comparten un encabezado sobre la foto con las migas de
    pan ("Inicio › Recorridos"), el título de la página y una bajada; el
    contenido en un panel de lectura casi opaco y, al pie, dos invitaciones a
    otras páginas: **`/cementerios`** (tarjetas
    con foto, domicilio, "Cómo llegar"); **`/horarios`** (tabla; en celular,
    tarjetas; arriba, las novedades vigentes); **`/recorridos`** (la ficha
    destacada, las demás, las próximas fechas y "Grupos, escuelas e
    instituciones"); **`/tramites`** (de las plantillas publicadas);
    **`/consulta`** (los 3 pasos y el formulario); **`/contacto`**
    (Mesa de Entradas y las preguntas frecuentes en acordeón).
- **Cómo se carga:** la Dirección (y el admin) entra a **Sitio público**
  (`/admin/sitio-publico`; en el menú de Dirección, o en Administración): pestañas
  Cementerios (domicilio, enlace al mapa, descripción, "qué tiene", horarios de
  lunes a viernes, de sábados, domingos y feriados y de fechas especiales,
  foto y si se muestra), Recorridos (con sus fechas), Novedades (desde y hasta,
  inclusive), Contacto (Mesa de Entradas) y Preguntas frecuentes. "Ver la
  página pública" abre la vista previa del inicio, y cada pestaña ofrece además
  la página donde se ve lo suyo (Recorridos, `/recorridos`; Contacto y
  Preguntas, `/contacto`). Cada cambio queda en la auditoría
  (Administración, Auditoría, cambios de configuración "Sitio: …"). Los
  operadores no entran.
- **Reglas:** todo es texto plano (se ve tal cual se escribe: nada de HTML ni
  Markdown); cada texto tiene un largo máximo; los enlaces de mapa son solo
  https de Google Maps (`google.com/maps`, `maps.app.goo.gl`) u OpenStreetMap;
  el de inscripción, https. La foto se elige de las ilustrativas que trae el
  sistema (`public/assets/cementeria`, conceptuales generadas con IA): **subir
  fotos propias queda para más adelante**.
  Lo que no se quiere mostrar se desactiva; solo las fechas de recorrido y las
  novedades se quitan.
- **Vacía, como arranca en producción:** los cementerios del catálogo se listan
  igual, con el nombre (sin domicilio no hay "Cómo llegar"); sin horarios,
  "Consultá los horarios en Mesa de Entradas" con el contacto; sin recorridos,
  "Por ahora no hay recorridos programados. Para visitas de grupos o
  instituciones, escribinos."; sin novedades no hay franja; sin fechas, el
  inicio no muestra "Próximos recorridos"; sin preguntas no hay acordeón.
  Nunca "A completar".
- **Semillas:** la de producción trae solo tres preguntas frecuentes (el código
  de consulta perdido, que la consulta no reemplaza al expediente y dónde se
  pagan las tasas); la de desarrollo, además, contenido de ejemplo ficticio
  ("(dato de prueba)", "(ejemplo)") para ver todas las secciones. En Supabase,
  `supabase/sql/32_sitio_publico.sql` (ver su README).
- **Imagen del hero:** `public/assets/cementeria/hero-landing.webp` y su versión
  de 960 px (`hero-landing-960.webp`). Cada página interna tiene su foto del
  kit en la banda del encabezado; el panel usa `hero-dashboard`.

## Ingreso

**Desde el 27/10/2026 se entra con usuario y contraseña propios; el ingreso
con Cidituc está en pausa** (su código sigue, detrás de `CIDITUC_HABILITADO`).
Detalle técnico: [docs/api-dominio.md](docs/api-dominio.md), sección 22.

- **Formulario de `/login`:** CUIL (con o sin guiones) o correo, y contraseña
  (con "Mostrar"). Ante cualquier rechazo el mensaje es el mismo, "CUIL, correo
  o contraseña incorrectos": no dice si el usuario existe. Cinco fallos
  seguidos bloquean al usuario 15 minutos (lo puede desbloquear un admin), y
  hay además un tope de 30 fallos cada 15 minutos por IP, en la memoria del
  proceso (por instancia). Las contraseñas se guardan con scrypt
  (`src/lib/auth/clave.ts`); nunca en texto, ni en la auditoría ni en los logs.
- **Contraseña temporal:** la del alta de un usuario, la de un blanqueo y la
  del admin inicial. Se muestra una sola vez; al ingresar con ella, la única
  pantalla disponible es `/cambiar-clave` (y Salir). La propia se cambia
  cuando se quiere desde la llave del encabezado. Política: 12 caracteres o
  más, no el CUIL ni el apellido, no una clave común; se muestra en la pantalla.
- **Desarrollo:** la semilla (`npm run db:reset` o `npm run db:seed`) les pone a
  todos sus usuarios (los siete ficticios y el admin de desarrollo,
  `20000000001`) la contraseña **`cementeria-local-2026`**, sin cambio
  obligatorio. Es solo local y pública (está acá): la semilla de producción no
  crea ficticios y la política de contraseñas la rechaza. Por ejemplo, Mesa de
  Entradas: CUIL `27-00000002-2` y esa contraseña. Para ver el cambio
  obligatorio, dar de alta un usuario desde `/admin/usuarios` (o blanquearle
  la contraseña a uno) y entrar con la temporal.
- **Producción:** `npm run db:seed -- --sin-ficticios` con `ADMIN_INICIAL_CUIL`
  crea al admin inicial con una contraseña temporal, que imprime **una sola
  vez** en la consola de quien la corre y escribe en
  `.local/clave-admin-inicial.txt` (o `ADMIN_INICIAL_CLAVE_ARCHIVO`; no se
  versiona). Con el paquete SQL de Supabase, la temporal queda solo en
  `supabase/sql/.local/clave-admin-inicial.txt` (docs/despliegue.md, 18.12).
  El admin entra con su CUIL y esa contraseña, la cambia y da de alta al resto
  desde `/admin/usuarios` (cada alta muestra la temporal una vez). No hay
  correo: las temporales se entregan en mano.
- **Login simulado:** con `AUTH_DEV_LOGIN=1` (en `.env.development.local`),
  `/dev/login` deja entrar como cualquier usuario activo de la semilla. En
  producción esa ruta responde 404, y el servidor **no arranca** si
  `AUTH_DEV_LOGIN` está definida (`src/lib/arranque.ts` termina el proceso).
- **Staging sin clave en el derivador:** `AUTH_DEV_LOGIN_STAGING` con una lista
  blanca de CUILs y `APP_URL` https con "staging" en el host.
- **Cidituc (en pausa):** `CIDITUC_HABILITADO=1` y `CIDITUC_API_URL`. El botón "Ingresar
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

### Modo prueba ("Ver como…")

Para recorrer todas las pantallas con **un solo usuario** (el propio CUIL),
sin crear un usuario por área. Detalle: [docs/api-dominio.md](docs/api-dominio.md),
sección 23; diseño: [docs/diseno.md](docs/diseno.md), "Modo prueba".

- **Qué hace:** con `PERFILES_PRUEBA_CUILS` definida, los usuarios cuyo CUIL
  está en la lista ven en el encabezado un botón con un matraz, **"Ver
  como…"**: un menú con un perfil por área interna (Mesa de Entradas, Cómputo,
  Liquidación, Asesoría Legal, Administrativo y Tributario como operador;
  Dirección como solo lectura) y **Administrador**. Elegir uno cambia el área y
  el rol **de tu propio usuario** y te lleva al inicio de ese perfil (bandeja o
  panel). Mientras no seas Administrador, una franja ámbar arriba del contenido
  dice "Modo prueba: estás viendo como Liquidación" con **Volver a
  Administrador**. Lo que hagas como Liquidación queda hecho por vos, en
  Liquidación (es un pase real).
- **Auditado:** cada cambio queda en Administración → Auditoría → Cambios
  (tabla usuarios, antes y después) con el motivo "Modo prueba: ver como …".
  La sesión no se corta.
- **Sin la variable no existe:** ni el botón ni la acción (responde 404).
- **En desarrollo:** en `.env.local`, `PERFILES_PRUEBA_CUILS=20-12345678-6`
  (tu CUIL; varios separados por coma, con o sin guiones) y reiniciar `npm run
  dev` o `npm run dev:supabase`. Con la semilla de desarrollo, por ejemplo el
  admin `20000000001`.
- **En Vercel:** Settings → Environment Variables → `PERFILES_PRUEBA_CUILS`
  (Production) y **Redeploy** (las variables se leen al arrancar). El log de
  la función muestra al arrancar `entorno.modo_prueba_activo` con la cantidad
  de CUILs (nunca los números). Ver docs/despliegue-vercel.md, sección 5.
- **Antes de producción con datos reales: volver a Administrador y BORRAR la
  variable** (y redesplegar). Si se borra con alguien en otro perfil, el botón
  desaparece y esa persona queda en ese perfil (si era el único admin, sin
  administrador): volver a ponerla, volver a Administrador y borrarla de nuevo.

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
lo que necesita, así que corren en paralelo y en cualquier orden (la de
`login.spec.ts` entra por el formulario real: un usuario nuevo con su
contraseña temporal, el cambio obligatorio y la bandeja). Tarda menos
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
- los diálogos, que se cierran con Escape y devuelven el foco;
- los recorridos guiados: el de la bandeja se abre con el "?", se navega con
  el teclado (flechas, Enter, Tab sin salir del globo) y Escape devuelve el
  foco; el de la ficha saltea "Dar pase" para Dirección; la invitación aparece
  la primera vez, no bloquea y respeta "Ahora no" (vuelve al día siguiente) y
  "No volver a mostrar"; "Reiniciar los recorridos"; y en el celular el globo
  es una hoja inferior;
- la página pública y la consulta (28/10/2026): `/` sin sesión con un solo h1,
  la banda que lleva a `/consulta` y "Ingreso del personal"; con sesión, `/`
  redirige como antes; la consulta con un código de la semilla (llegando desde
  el inicio), la incorrecta con el mismo mensaje (y los encabezados `no-store`
  y `no-referrer`), `/consulta/NUMERO#CODIGO` que se completa solo, el
  comprobante con el código y el QR desde la ficha, y `/consulta` en 375 px
  sin scroll horizontal; el sitio público, página por página (su h1, su
  título, la barra con la actual marcada, la navegación desde el inicio, 375
  px sin scroll lateral en todas y las páginas vacías); y el modo oscuro del
  sitio (el botón alterna, se recuerda al recargar y anda sin localStorage;
  con el sistema en oscuro arranca en oscuro; 375 px sin scroll lateral en
  las siete páginas en los dos modos; y el contraste de los tokens del sitio
  contra sus superficies, en los dos modos);
- el modo prueba: un admin de prueba propio (CUIL ficticio en
  `PERFILES_PRUEBA_CUILS` de la app de las pruebas) elige "Ver como…
  Liquidación" con el teclado, ve la bandeja de Liquidación con la franja (que
  no sale al imprimir) y vuelve a Administrador; y en 390 px el selector entra
  en el encabezado de una fila.

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
| `DATABASE_CA_FILE`, `DATABASE_CA_PEM` | Base en Supabase: el certificado raíz de Supabase (ruta o contenido), para TLS verificado en la app, la semilla, los scripts y la CLI de Prisma. Con un host de Supabase es obligatorio |
| `SUPABASE_ADMIN_URL` | Solo en `.env.supabase.local`: la conexión de administración (rol `postgres`, Session pooler) para `npm run supabase:preparar`. La app nunca la usa |
| `SESSION_SECRET` | Firma de la cookie de sesión; 32 caracteres o más |
| `AUTH_DEV_LOGIN` | `1` habilita `/dev/login`. Solo en `.env.development.local` |
| `AUTH_DEV_LOGIN_STAGING`, `APP_URL` | Staging: lista blanca de CUILs para `/dev/login` y su URL https. `APP_URL` es además la base del QR de la carátula (sin ella, el host del request) |
| `ADMIN_INICIAL_CUIL` | CUIL del primer administrador que crea la semilla |
| `PERFILES_PRUEBA_CUILS` | Opcional, **solo para probar**: CUILs (separados por coma, con o sin guiones) que pueden usar "Ver como…" para cambiar su propio perfil. Vacía o ausente, no existe. Borrarla antes de cargar datos reales (ver "Modo prueba") |
| `ADMIN_INICIAL_CLAVE_ARCHIVO` | Opcional: dónde deja la semilla de producción la contraseña temporal del admin inicial (por defecto `.local/clave-admin-inicial.txt`) |
| `CIDITUC_HABILITADO` | `1` muestra el botón de Cidituc debajo del formulario; `0` (el ingreso con Cidituc está en pausa desde el 27/10/2026) |
| `CIDITUC_DERIVADOR_URL`, `CIDITUC_CLAVE` | Origen del derivador y clave de esta instancia (`cementeria` o `cementeria-staging`) |
| `CIDITUC_API_URL` | Backend contra el que se valida el token; https en producción |
| `CIDITUC_CA_PEM` | Opcional: certificado intermedio que reemplaza al embebido |
| `ADJUNTOS_DIR` | Carpeta de los adjuntos, fuera del webroot. Obligatoria y absoluta en producción; en desarrollo, `./.data/adjuntos` |
| `ADJUNTOS_ALMACEN` | `disco` (por defecto, `ADJUNTOS_DIR`) o `supabase` (Supabase Storage, bucket privado `adjuntos`: Vercel) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Con `ADJUNTOS_ALMACEN=supabase`: el origen del proyecto y la clave **secreta** del servidor (`sb_secret_…`, solo en `apikey`; nunca llega al navegador) |
| `CRON_SECRET` | Vercel Cron: `Authorization: Bearer` de `/api/cron/*` (32 caracteres o más; obligatoria en Vercel) |
| `ENCABEZADOS_SEGURIDAD` | `app` (en el build): los encabezados de seguridad desde Next fuera de Vercel, para un hosting sin nginx |

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
  equipo. La sección 18 es la base en Supabase.
- [docs/despliegue-vercel.md](docs/despliegue-vercel.md): el despliegue en
  Vercel paso a paso (proyecto, región, variables, bucket de Storage,
  dominio, crons y verificación).
- [supabase/sql/README.md](supabase/sql/README.md): la base de Supabase a mano,
  desde el SQL Editor del panel.
- [docs/taller-plantillas.md](docs/taller-plantillas.md): guía del taller de
  validación de plantillas con la Dirección de Cementerios.
- [tests/integracion/README.md](tests/integracion/README.md): la batería de
  integración.
- [tests/e2e/README.md](tests/e2e/README.md): las pruebas de punta a punta.
