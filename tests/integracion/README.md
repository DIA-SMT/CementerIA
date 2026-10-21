# Tests de integración

Corren contra un PostgreSQL 15 real, el mismo motor de producción, sin instalar
nada:

```bash
npm run test:integracion
```

No hace falta tener levantada la base local (`npm run db:local`): cada corrida
crea la suya y no toca `.local/pgdata`.

## Qué hace el arnés

`global-setup.ts`, una vez por corrida (los pasos 1 a 3 los hace
`base-efimera.ts`, `levantarBaseEfimera(prefijo, raiz)`, que también usan las
pruebas de punta a punta, `tests/e2e/`):

1. Crea un clúster con los binarios de `embedded-postgres` en un directorio
   temporal propio (`%TEMP%/cementeria-it-XXXX`) y lo arranca en un puerto
   libre que elige el sistema operativo. Dos corridas simultáneas no chocan.
2. Corre `scripts/db-init.sql` como superusuario, con contraseñas aleatorias:
   roles `cementeria_owner`, `cementeria_deploy` y `cementeria_app`, bases
   `cementeria` y `cementeria_shadow`, y las extensiones `unaccent` y `pg_trgm`.
3. Corre `prisma migrate deploy` con `cementeria_deploy`, igual que en un
   despliegue. Si una migración falla, la corrida se corta con la salida de
   Prisma.
4. Expone las URLs con `provide("baseIntegracion", …)` y por entorno:
   `DATABASE_URL` (app), `CEMENTERIA_IT_URL_APP`, `CEMENTERIA_IT_URL_DEPLOY` y
   `CEMENTERIA_IT_URL_SUPERUSUARIO`.
5. Al terminar detiene el servidor y borra el directorio.

Si cortás la corrida con Ctrl+C antes de que termine, puede quedar un
`postgres.exe` huérfano escuchando en un puerto alto y su carpeta
`cementeria-it-*` en `%TEMP%`. No molesta a otras corridas. Para limpiarlo:
cerrá ese proceso desde el Administrador de tareas y borrá la carpeta.

Los archivos de test van de a uno (`fileParallelism: false`) sobre una misma
base, y el proceso corre con `TZ=UTC`: el código no puede depender de la zona
horaria de la máquina. La base sí tiene `timezone = America/Argentina/Tucuman`.

## Cómo escribir un test

Archivo `tests/integracion/<tema>.test.ts`. Ayudas en `helper.ts`:

| Ayuda | Para qué |
|---|---|
| `enTransaccion(rol, async (c) => …)` | Corre el test en una transacción que **siempre se revierte**. Es la forma recomendada: no deja filas y no depende del orden de los tests |
| `fijarActor(c, usuarioId, motivo?)` | Lo mismo que hace `conActor()`: `set_config('app.usuario_id' / 'app.motivo', …, true)`. Sin actor, los triggers de auditoría y `movimientos_sellar` rechazan la escritura |
| `intentar(c, sql, params?)` | Corre una sentencia dentro de un SAVEPOINT y devuelve `{ ok: true, filas }` o `{ ok: false, error, codigo }`, sin abortar la transacción del test |
| `conPg(rol, fn)` / `clientePg(rol)` | Cliente `pg` suelto con un rol, para lo que no puede ir en una transacción (TRUNCATE, SET de sesión, varias conexiones) |
| `clientePrisma()` | Cliente de Prisma con el rol de la app, para probar `conActorEn()` y el código de `src/lib/db` |
| `SISTEMA` | Id del usuario técnico (1). Existe desde la migración |
| `unico(prefijo)` | Código único (`[A-Z0-9_]`) para catálogos creados por el test |

Roles (`Rol`):

- `"app"`: `cementeria_app`. Es el que importa: lo que la aplicación puede y no
  puede hacer.
- `"owner"`: `cementeria_deploy`, que al conectarse pasa a ser
  `cementeria_owner`, dueño de todo. Sirve para mostrar que los triggers
  `ENABLE ALWAYS` frenan incluso al dueño.
- `"superusuario"`: `postgres`. Para preparar lo que solo él puede hacer, como
  crear un rol de prueba, `GRANT SET ON PARAMETER session_replication_role` o
  leer catálogos. No sirve para probar reglas: el superusuario puede todo.

Ejemplo:

```ts
import { describe, expect, it } from "vitest";
import { SISTEMA, enTransaccion, fijarActor, intentar } from "./helper";

describe("movimientos", () => {
  it("la app no puede borrar el historial", async () => {
    await enTransaccion("app", async (c) => {
      await fijarActor(c, SISTEMA, "prueba de integración");
      // …crear área, cementerio, tipo de monumento, tipo de trámite,
      // plantilla, expediente y un movimiento…
      const r = await intentar(c, "DELETE FROM movimientos");
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/permission denied/);
    });
  });
});
```

Para Prisma:

```ts
import { conActorEn } from "@/lib/db/actor";
import { SISTEMA, clientePrisma } from "./helper";

const prisma = clientePrisma();
// afterAll(() => prisma.$disconnect());
await conActorEn(prisma, SISTEMA, "motivo", async (tx) => tx.area.create({ data: { … } }));
```

Lo que se escribe con Prisma sí se confirma (no hay transacción envolvente):
usá códigos con `unico()` y no cuentes filas globales. Si no hace falta que
quede, `fechas.test.ts` muestra cómo deshacerlo (`conPrismaYDeshacer`).

### Datos mínimos: `escenario.ts`

Los tests no dependen de la semilla: cada uno arma, dentro de su transacción,
lo que necesita, con códigos únicos y datos ficticios.

| Ayuda | Para qué |
|---|---|
| `crearEscenario(c)` | Dos áreas internas, una externa con su cementerio, tipo de monumento, tipo de trámite, plantilla publicada y un operador. Exige el actor fijado (los catálogos se auditan) |
| `crearExpediente(c, e, columnas?)` | Un expediente en el primer paso, con `fecha_inicio` = hoy en Tucumán |
| `crearMovimiento(c, expedienteId, columnas?)` | Por defecto una `nota` del actor de la transacción (`usuario_id` = `ACTOR`) |
| `crearPersona(c, expedienteId, columnas?)` | Persona con todos los datos personales; si no se pasa `creada_mov_id`, inserta antes el `alta` |
| `crearArea`, `crearCementerio`, `crearTipoMonumento`, `crearTipoTramite`, `crearPlantilla`, `crearUsuario` | Cada pieza por separado |
| `insertar(c, tabla, fila)`, `sql("…")`, `json(v)` | INSERT genérico; `sql()` pasa una expresión tal cual (`now()`), `json()` para jsonb que son arrays |
| `crearRolDePrueba(prefijo, grants)` / `borrarRolDePrueba` / `enTransaccionCon(url, fn)` | Roles LOGIN de prueba (por ejemplo, con `GRANT SET ON PARAMETER session_replication_role`) |
| `quitarActor(c)`, `errorDe(r)`, `fila(c, sql)` | Varios |

### Tests del dominio: `dominio.ts`

Los tests del dominio de expedientes (alta, edición, ficha, búsqueda) no van en
una transacción que se revierte: el dominio abre la suya con `conActorEn()`.
Usan la semilla real, porque las reglas de permisos miran el código de área
(`MESA_ENTRADAS`, `COMPUTO`…) y las plantillas apuntan a esas áreas. Lo que
crean se confirma: nombres, padrones y DNI únicos, y nada de contar filas
globales.

| Ayuda | Para qué |
|---|---|
| `asegurarSemilla(prisma)` | Corre `sembrar()` (idempotente) en el `beforeAll` |
| `servicio(prisma, ahora?)` | `crearServicioExpedientes()` con el cliente y `conActorEn()` |
| `usuario(prisma, "MESA_ENTRADAS" | … | "ADMIN")` | El usuario ficticio de la semilla, como lo da `getUsuarioActual()` |
| `datosAlta(prisma, cambios?)` | Un alta válida de `RENOV_CONTADO` en el Oeste, con ubicación, padrón y titular únicos |
| `titular()`, `unicoLetras()`, `dniUnico()`, `comando()` | Piezas sueltas |
| `loteUnico()`, `ubicacionDe(cementerio)`, `cuitUnico()` | Semana 4: un lote único, una ubicación válida en la nomenclatura de cada cementerio (`datosAlta` la usa) y un CUIT ficticio de persona jurídica (30-98…) con dígito verificador válido |
| `simularPase(prisma, numero, usuario, paso, fecha?)` | Inserta un `pase` a mano y mueve la proyección (lo usan los tests de la semana 2; los de la semana 3 dan pases de verdad) |
| `servicio(prisma, ahora?, almacen?)` | Con `almacen` (`crearAlmacenEnDisco(carpetaTemporal)`) se pueden subir y leer adjuntos |
| `responsable(prisma, numero)` | El usuario de la semilla del área responsable (en un paso externo, la custodia) |
| `completarPaso(exp, prisma, numero, { fecha? })` | Hace, como el responsable, lo que falta para salir del paso: tilda (con fecha o texto) y marca documentos |
| `avanzar(exp, prisma, numero, { fecha?, fechaPase? })` | `completarPaso` y el pase al siguiente |
| `proyeccion(prisma, numero)`, `movimientos(prisma, numero)`, `definicionDe(prisma, numero)` | Para mirar el resultado. `definicionDe` devuelve la definición resuelta para el cementerio y las personas del expediente, como la ve el dominio |
| `forzarEstado(prisma, numero, estado)` | Archivado, anulado o concluido, a mano (los tests de las semanas 2 y 3; la semana 4 tiene las acciones) |
| `conciliacion(prisma, numero)` | Semana 4: `{ actual, reconstruida }`, la proyección del flujo en la base y la reconstruida desde el historial (`reconstruccion.ts`); `expect(c.actual).toEqual(c.reconstruida)` |
| `flujo(prisma, numero)` | Semana 4: las columnas del flujo, para comparar antes y después de revertir |
| `plantillaDePrueba(prisma, definicion, nombre)` | Semana 4: publica una plantilla con código único (la caducidad de prueba) |
| `hastaElUltimoPaso(exp, prisma, numero)` | Semana 4: `avanzar` hasta el último paso |

### Tests de la administración: `admin.ts` (semana 5)

La administración cambia lo que comparten todos los tests (la plantilla
publicada de RENOV_CONTADO, los administradores activos, áreas, años de
feriados): si quedara confirmado, otros archivos verían "v2" o un año cerrado
según el orden de la corrida.

| Ayuda | Para qué |
|---|---|
| `conServiciosQueSeDeshacen(prisma, async ({ admin, expedientes, tx, comoActor }) => …)` | Los servicios de administración y de expedientes sobre UNA transacción que se revierte al final: sus lecturas ven lo que escribieron y nada queda. Cada escritura del dominio va en un SAVEPOINT, así un rechazo de un trigger no aborta la transacción. `comoActor(id, motivo?)` fija el actor para escribir directo con `tx` |
| `servicioAdmin(prisma)` | El servicio confirmado, para lo que no molesta a nadie (plantillas con código único) |
| `comoUsuario(tx, id)`, `cuilFicticio()`, `codigoUnico(prefijo)` | El usuario como lo da la sesión, un CUIL ficticio válido (20-9…) y un código `[A-Z_]` único |

Lo que va en la transacción que se deshace no puede mezclarse con lecturas
de otra conexión que esperen ver lo escrito; los ayudantes de `dominio.ts`
que usan `prisma` (como `datosAlta`) sirven para armar datos, no para mirar.

`escenario.ts` crea sus expedientes con el año 1999: los del dominio numeran el
año en curso con `max + 1`, y un expediente confirmado con una secuencia al
azar en ese año les correría la numeración.

## Cuidados

- **Filas de un trigger que no se dispara.** UPDATE, DELETE y los triggers por
  fila no hacen nada sobre una tabla vacía. Para probar que algo se rechaza,
  primero insertá la fila.
- **`now()` es el comienzo de la transacción.** Dentro de `enTransaccion` todas
  las sentencias ven la misma hora; `movimientos.registrado_en` lo pisa el
  trigger con ese valor.
- **Las identity no retroceden** con el ROLLBACK: no afirmes sobre ids
  concretos, salvo `SISTEMA = 1`.
- **`session_replication_role`** solo lo puede cambiar el superusuario o un rol
  con `GRANT SET ON PARAMETER`. Para la prueba de "incluso en replica": como
  superusuario creá un rol de prueba, dale el SET y los privilegios de la app,
  y probá con ese rol.
- **`server-only`** se reemplaza por un módulo vacío en los tests, así que se
  puede importar código de `src/lib/db/cliente.ts`. Aun así, preferí
  `crearCliente(url)` y `conActorEn()`: el singleton toma `DATABASE_URL` en el
  primer uso, y el arnés la apunta a la base efímera.

## Qué hay en la base (para la batería)

Detalle completo en `prisma/migrations/*_reglas_base/migration.sql`.

- **13 tablas**: 11 de dominio en `public` y `auditoria.cambios` y
  `auditoria.accesos`. Más `public._prisma_migrations`. Todas de
  `cementeria_owner`.
- **Triggers, todos `ENABLE ALWAYS`** (`pg_trigger.tgenabled = 'A'`):
  `expedientes_preparar`, `expediente_personas_proteger`, `movimientos_sellar`,
  `movimientos_inmutables` (por fila: UPDATE/DELETE) y
  `movimientos_inmutables_truncate` (por sentencia), `plantillas_congelar`,
  `usuarios_area_interna`, `cementerios_area_externa`,
  `areas_tipo_coherente` y `auditar_cambio` (en plantillas, areas,
  cementerios, tipos_monumento, tipos_tramite, feriados, feriados_anios y
  usuarios). 17 en total.
- **Exigen el actor** (`f_actor()`): `movimientos_sellar`, `auditar_cambio`,
  `expedientes_preparar` y `expediente_personas_proteger`. Sin
  `fijarActor`, no se puede crear ni modificar un expediente ni una persona.
- **Nacen en su estado inicial**: una plantilla se inserta como `borrador`
  (`crearPlantilla` la publica con UPDATE) y una persona, vigente, sin
  `reemplazada_por_id` y sin suprimir.
- **Identity**: `expedientes`, `expediente_personas`, `movimientos` y las
  dos de `auditoria` son `GENERATED ALWAYS` (un INSERT con `id` explícito
  falla); catálogos, usuarios y plantillas, `BY DEFAULT`.
- **Funciones**: `f_unaccent`, `f_normalizar`, `f_actor`, `f_cuit_valido`
  (semana 4: 11 dígitos y dígito verificador),
  `f_sumar_dias_habiles`, `f_dias_habiles_entre` (intervalo `(desde, hasta]`,
  negativo si `hasta < desde`; las dos dan NULL con un argumento NULL).
- **Privilegios de `cementeria_app`**: SELECT+INSERT en `movimientos` y
  `auditoria.*`; SELECT+INSERT+UPDATE en `expedientes`, `expediente_personas`,
  catálogos, `usuarios` y `feriados_anios`; además DELETE en `plantillas` y
  `feriados`. Nada sobre `_prisma_migrations`.
- **Índices** (los que compara el test de `pg_indexes`), además de las PK:
  - `areas_codigo_key`, `cementerios_codigo_key`, `cementerios_area_id_key`,
    `tipos_monumento_codigo_key`, `tipos_tramite_codigo_key`,
    `usuarios_cuil_key`, `usuarios_cidituc_id_key`;
  - `plantillas_codigo_version_key`; parciales únicos
    `plantillas_codigo_publicada_key` y `plantillas_codigo_borrador_key`;
  - `expedientes_numero_interno_key`, `expedientes_anio_secuencia_key`,
    `expedientes_numero_municipal_norm_idx`, `expedientes_padron_norm_idx`,
    `expedientes_ubicacion_idx` (GIN `jsonb_path_ops`),
    `expedientes_cementerio_id_ubicacion_clave_idx` (parcial),
    `expedientes_busqueda_idx` (GIN `gin_trgm_ops`),
    `expedientes_area_responsable_id_estado_idx`,
    `expedientes_area_actual_id_idx` (parcial, `recibido_en IS NULL`),
    `expedientes_estado_en_area_desde_idx`,
    `expedientes_tipo_tramite_id_fecha_inicio_idx`,
    `expedientes_plazo_desde_idx` (parcial);
  - `expediente_personas_vigente_key` (único parcial `WHERE vigente`),
    `expediente_personas_contacto_key` (único parcial
    `WHERE es_contacto AND vigente`), `expediente_personas_expediente_id_idx`,
    `expediente_personas_dni_idx`, `expediente_personas_cuit_idx` (semana 4),
    `expediente_personas_nombre_norm_idx` (GIN trigram);
  - `movimientos_expediente_id_secuencia_key`,
    `movimientos_expediente_id_comando_id_tipo_key`,
    `movimientos_usuario_id_registrado_en_idx`,
    `movimientos_area_destino_id_fecha_efectiva_idx` (parcial, pase y
    devolución), `movimientos_expediente_id_area_destino_id_idx`,
    `movimientos_tipo_registrado_en_idx`;
  - `cambios_tabla_registro_id_idx`, `accesos_expediente_id_en_idx`,
    `accesos_usuario_id_en_idx`.

## La batería

Cada archivo prueba una garantía de la propuesta (`docs/propuesta-mvp.md`):

| Archivo | Qué garantiza | Propuesta |
|---|---|---|
| `humo.test.ts` | Migraciones aplicadas, 13 tablas, todas del owner | 2, "Roles de base" |
| `movimientos.test.ts` | UPDATE, DELETE y TRUNCATE fallan con la app, con el owner y en replica (rol de prueba y superusuario); `movimientos_sellar` (secuencia, `registrado_en`, actor, `area_usuario_id`, lock); CHECKs de motivo, corrección, fecha efectiva, fuente; idempotencia de `comando_id` | 2.8, 2.11, 2.13(b) |
| `personas.test.ts` | `expediente_personas_proteger`: nace vigente y con actor, baja y reemplazo (sin ciclos), supresión con motivo, todo otro UPDATE rechazado, sin DELETE; CHECKs e índices únicos. Semana 4: personas jurídicas (razón social y CUIT, `f_cuit_valido`, datos por tipo, el tipo no cambia por UPDATE, supresión que también borra razón social y CUIT) | 2.7, 2.13(b) |
| `plantillas.test.ts` | `plantillas_congelar`: nace borrador, transiciones, solo se borran borradores, índices únicos parciales | 2.5, 2.13(a) |
| `usuarios.test.ts` | `usuarios_area_interna`, `cementerios_area_externa` y `areas_tipo_coherente`; CHECKs de rol, área y CUIL, SISTEMA | 2.2, 2.4, 2.13(e) |
| `auditoria.test.ts` | `auditar_cambio` en catálogos, plantillas, feriados y usuarios (antes, después, actor, motivo), y no en el login | 2.10, 2.11, 2.13(b) |
| `expedientes.test.ts` | `expedientes_preparar` (actor, números normalizados, `ubicacion_clave` que solo arma el trigger, `fecha_inicio`) y CHECKs de estado | 2.6, 2.13(d) |
| `funciones.test.ts` | `f_normalizar`, `f_actor`, días hábiles con fines de semana y feriados | 2.9, 2.11 |
| `privilegios.test.ts` | Privilegios exactos de la app, DDL prohibido, roles, dueños, triggers `ENABLE ALWAYS`, columnas identity, `pg_indexes` | 2, 2.11, 2.13(b), 6 |
| `replica.test.ts` | Los demás triggers también se disparan con `session_replication_role = replica` | 2.11 |
| `fechas.test.ts` | Proceso en UTC y base en hora de Tucumán; columnas `date` y precisión de día; las sesiones de Prisma en UTC (sin eso, `@prisma/adapter-pg` corría 3 horas cada `timestamptz`) | 6, "Fechas" |
| `conactor.test.ts` | `conActorEn()` fija actor y motivo solo para la transacción | 2, "Convenciones" |
| `semilla.test.ts` | La semilla corre con el rol de la app como SISTEMA, pasa los triggers y es idempotente (confirma sus filas). Si otro archivo sembró antes, su "primera corrida" no crea nada | 6, "Desarrollo local" |
| `semilla-expedientes.test.ts` | Los 30 expedientes ficticios: con la función de alta, repartidos entre plantillas y cementerios, en el primer paso, ficticios e idempotentes | 6, "Desarrollo local" |
| `alta.test.ts` | Alta normal e histórica, proyección, movimiento y personas; validaciones; plantilla no publicada; cementerio sin configurar; permisos; numeración sin huecos y concurrente; idempotencia; avisos de duplicados | 2.6, 2.7, 2.13(c), (d) y (f), 3.1 |
| `edicion.test.ts` | Movimiento `edicion` con antes y después; personas versionadas (baja, reemplazo, alta, contacto); bloqueo optimista; idempotencia; motivo después del primer pase; permisos de 3.2; archivado y anulado; fecha de inicio | 2.7, 2.8, 2.13(b), 3.2 |
| `busqueda.test.ts` | Normalización TS = base; caja única (texto con acentos, DNI con puntos, CUIL, N° municipal con barra, forma corta, prefijo CEM); filtros de ubicación, anulados, estado y plantilla; máximo 50 | 2.13(g) |
| `ficha.test.ts` | Ficha completa; enmascarado según 3.2 y decisión 13; `ver_expediente`, `ver_datos_completos` e `imprimir` en `auditoria.accesos`; "hay vN"; historial con versiones de persona; carátula sin contacto | 5, 2.10, 2.13(a), 3.2 |
| `pases.test.ts` | Recorridos completos de (a), (b) entrando y saliendo de la DIM con custodia de Tributario y plazo (y, semana 4, el circuito que contó la Dirección: DIM → devolución a Tributario "no abonó" → pase a ADM_TITULO salteando la DIM con motivo), y (d) con `$CEMENTERIO`; "Faltan N" exacto; destino inválido; pases concurrentes (uno gana, el otro recibe el mensaje de versión); idempotencia (también simultánea); recepción implícita; fechas retroactivas válidas e inválidas; omitibles con motivo; carga histórica abierta | 3.3, 3.5, 3.6, 2.13(c) y (e) |
| `devoluciones.test.ts` | Legal a Liquidación con reenvío directo; reenvío salteando intermedios; devoluciones encadenadas; motivo, destino y subtareas inválidas; idempotencia; devolver desde la DIM | 3.4, 3.3 punto 8 |
| `recepcion.test.ts` | Confirmar de a uno y en lote, contador, fecha anterior; tildar y destildar (dato, motivo, paso actual, permisos, estado); documentos (no corresponde con observación, Mesa, estados) | decisión 8, 3.2, 3.3, 3.5 |
| `bandejas.test.ts` | Por confirmar, En mi área (columnas, días hábiles, demorado, orden), sin bandeja para Dirección y admin; la ficha de la semana 3 (acciones, Faltan N, destinos, reiniciables); por fila, `puedeConfirmar` y `paseRapido` (solo sin faltantes y con un único destino; no con reenvío directo), devuelto con el motivo; `contadoresBandeja` igual a lo que muestra cada pestaña | 5, 3.2, 3.4 |
| `adjuntos.test.ts` | Subida con sha256, movimiento, items y archivo; magic bytes (también HEIC), vacío, 10 MB; temporal limpio si falla la transacción; controles antes de leer el cuerpo; idempotencia; lectura con `ver_adjunto`/`descargar_adjunto` y motivo | 6 "Adjuntos", 3.2, decisión 13 |
| `estados.test.ts` | Semana 4: concluir (Faltan N con lo de "al concluir", último paso, idempotencia) y archivar el recorrido completo de (a), cambiar la caja y desarchivar; archivar sin concluir desde la DIM (regreso del papel a Tributario) y desarchivar a la DIM con su plazo; anular y reabrir (solo admin); reiniciar con otra plantilla (precarga, `expedienteAnteriorId`, enlaces anterior/siguiente, un solo siguiente); archivar y abrir vinculado con una plantilla de caducidad de prueba (una transacción, reintento, sin anular). Cada uno concilia la proyección con el historial | 3.1, 2.13(a), docs/fuentes punto 6 |
| `correcciones.test.ts` | Semana 4: revertir un pase (con su recepción implícita y la recepción y la nota posteriores), una devolución, concluir, archivar y una subtarea, comparando con la proyección de antes; autor, 7 días, admin en archivado; corregir fecha (vecinos; la ficha toma la precisión de la fecha corregida) y observación; corregir una subtarea de un paso cerrado (el plazo la sigue); retirar y purgar adjuntos (el archivo se conserva o se borra); suprimir persona (búsqueda) | 2.13(b), 3.2 |
| `plazos.test.ts` | Semana 4: vencimiento con `f_sumar_dias_habiles`, "faltan N", provisorio con el año sin cerrar y definitivo al cerrarlo (auditado), un asueto que corre el vencimiento, semáforo ámbar y rojo con el reloj adelantado, pestaña Plazos, plazo cumplido; ABM de feriados (deshace lo que cambia) | 3.6, 2.9 |
| `transcripcion.test.ts` | Semana 4: un expediente de 2019 con 5 filas hasta Legal (salteando pasos y con una devolución), validaciones por fila y lote atómico, reintento, tilde con fecha, "Terminar carga histórica"; fuera de las bandejas de trabajo y de los demorados mientras está abierta; otro llevado a concluido y archivado con DESCONOCIDA | 2.13(c) |
| `panel.test.ts` | Semana 4: demorados, sin confirmar, diferidos, correcciones, cargas históricas, conteos y matriz contra la base (y sus enlaces al buscador), avisos de feriados, filtro por tipo; CSV de Dirección y admin sin contacto, registrado en `auditoria.accesos` | 5, 3.2, decisión 13 |
| `fuentes.test.ts` | Semana 4 (docs/fuentes): titular persona jurídica en el Oeste (alta, Faltan con personería y designación de asamblea, ficha, carátula, búsqueda por CUIT, edición de física a jurídica, rol que no la admite); Jardín sin inspección técnica en conceptos, boleta y carátula, con Conservación; Norte sin Conservación; la nueva concesión sin inspección en ningún cementerio; pase rápido de la bandeja con lo del cementerio | docs/fuentes, 2.5, 2.7 |
| `pantallas.test.ts` | La lógica de las Server Actions de las pantallas (`src/lib/presentacion/acciones.ts`) con FormData como el del formulario: alta (destino carátula o ficha, doble clic, errores por campo, formulario roto, sin permiso), aviso de duplicados, edición (conflicto de versión, sin cambios, permiso), "Ver datos completos"; hoja del historial (sin contacto, registra `imprimir`) y opciones del buscador | 5, 3.2, decisión 13 |
| `pantallas-semana4.test.ts` | Las Server Actions de la semana 4 (`src/lib/presentacion/acciones-estados.ts`) con la entrada de los diálogos y la grilla: concluir con "Faltan N", archivar sin caja y con caja, desarchivar con motivo, entrada sin forma; reiniciar (destino `?desde=`, precarga y alta enlazada) y "archivar y abrir vinculado" (falla sin caja sin archivar nada); revertir un pase, nota y corregir su fecha; purgar sin confirmación; la grilla de transcripción (error de una fila en su celda, lote, reintento, terminar la carga); el Route Handler del CSV (`exportar-http.ts`) con Request reales: BOM, acentos, sin contacto, `exportar` en auditoría, 401, 403 y 422 | 5, 3.1, 2.13(a) a (c), 15.7 de api-dominio |
| `pantallas-flujo.test.ts` | Las Server Actions del flujo (`procesarRecepcion`, `procesarRecepciones`, `procesarSubtarea`, `procesarDocumento`, `procesarPase`, `procesarDevolucion`) con la entrada de los diálogos: versión nueva en cada respuesta, errores por campo, Faltan N, conflicto de versión, lote parcial, entrada sin forma; los Route Handlers de adjuntos (`src/lib/presentacion/adjuntos-http.ts`) con Request reales: subida de PNG y PDF en streaming, headers de la sección 6, descarga, HEIC, más de 10 MB sin Content-Length, sin permiso, versión vieja, sin sesión; lectura con y sin motivo para quien no trabaja el expediente | 5, 6 "Adjuntos", 3.2 a 3.4, decisión 13 |
| `admin-plantillas.test.ts` | Semana 5: el ciclo de una plantilla (crear, doble clic, guardar con huella y conflicto, validar, publicar con notas, editar v2, publicar con retiro de la v1, expediente en curso con la v1 y "hay v2", auditoría, retirar con motivo, alta rechazada, editar un retirado, descartar); Publicar rechazado por integridad sin cambiar nada (y los errores por ruta en la Server Action); solo el admin; **una v2 de RENOV_CONTADO** en una transacción que se deshace: el expediente en curso sigue con la v1 y el alta nueva toma la v2 | 2.5, 2.13(a), 3.2 |
| `admin-usuarios-catalogos.test.ts` | Semana 5, en transacciones que se deshacen: alta por CUIL (dígito verificador, área externa, repetido, ya existe, auditada); desactivar (`sesion_version` + 1 y la sesión vieja deja de valer), reactivar, cambiar área o rol, uno mismo, SISTEMA; el último admin activo; áreas (código fijo, en uso, tipo, mensaje legible de un trigger); cementerios (clave de ubicación usada no se borra, renombra ni cambia de tipo; se desactiva; área interna o ya usada); tipos de monumento y de trámite; feriados con cierre y reapertura de 2026, auditados | 2.1 a 2.4, 2.9, 2.13(d), 3.2 |
| `admin-auditoria.test.ts` | Semana 5, en transacciones que se deshacen: accesos por expediente (también la forma corta), acción (`ver_datos_completos` con su motivo e IP), usuario y fechas; paginado de a 50; cambios con el antes y el después legibles (área por nombre, cierre de año); el Route Handler del CSV (BOM, `;`, campos con `;` entre comillas, `exportar` con `origen: auditoria`, 401, 403, 422) | 2.10, 5 |

Si una regla de la base no cumple la propuesta, el test se escribe igual, como
especificación, con `it.fails` y un comentario `DEFECTO:` que diga qué falta. La
migración se corrige aparte; cuando quede bien, `it.fails` empieza a fallar y
se cambia por `it`.
