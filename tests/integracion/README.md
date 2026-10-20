# Tests de integración

Corren contra un PostgreSQL 15 real, el mismo motor de producción, sin instalar
nada:

```bash
npm run test:integracion
```

No hace falta tener levantada la base local (`npm run db:local`): cada corrida
crea la suya y no toca `.local/pgdata`.

## Qué hace el arnés

`global-setup.ts`, una vez por corrida:

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
- **Funciones**: `f_unaccent`, `f_normalizar`, `f_actor`,
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
    `expediente_personas_dni_idx`, `expediente_personas_nombre_norm_idx` (GIN
    trigram);
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
| `personas.test.ts` | `expediente_personas_proteger`: nace vigente y con actor, baja y reemplazo (sin ciclos), supresión con motivo, todo otro UPDATE rechazado, sin DELETE; CHECKs e índices únicos | 2.7, 2.13(b) |
| `plantillas.test.ts` | `plantillas_congelar`: nace borrador, transiciones, solo se borran borradores, índices únicos parciales | 2.5, 2.13(a) |
| `usuarios.test.ts` | `usuarios_area_interna`, `cementerios_area_externa` y `areas_tipo_coherente`; CHECKs de rol, área y CUIL, SISTEMA | 2.2, 2.4, 2.13(e) |
| `auditoria.test.ts` | `auditar_cambio` en catálogos, plantillas, feriados y usuarios (antes, después, actor, motivo), y no en el login | 2.10, 2.11, 2.13(b) |
| `expedientes.test.ts` | `expedientes_preparar` (actor, números normalizados, `ubicacion_clave` que solo arma el trigger, `fecha_inicio`) y CHECKs de estado | 2.6, 2.13(d) |
| `funciones.test.ts` | `f_normalizar`, `f_actor`, días hábiles con fines de semana y feriados | 2.9, 2.11 |
| `privilegios.test.ts` | Privilegios exactos de la app, DDL prohibido, roles, dueños, triggers `ENABLE ALWAYS`, columnas identity, `pg_indexes` | 2, 2.11, 2.13(b), 6 |
| `replica.test.ts` | Los demás triggers también se disparan con `session_replication_role = replica` | 2.11 |
| `fechas.test.ts` | Proceso en UTC y base en hora de Tucumán; columnas `date` y precisión de día | 6, "Fechas" |
| `conactor.test.ts` | `conActorEn()` fija actor y motivo solo para la transacción | 2, "Convenciones" |
| `semilla.test.ts` | La semilla corre con el rol de la app como SISTEMA, pasa los triggers y es idempotente (confirma sus filas) | 6, "Desarrollo local" |

Si una regla de la base no cumple la propuesta, el test se escribe igual, como
especificación, con `it.fails` y un comentario `DEFECTO:` que diga qué falta. La
migración se corrige aparte; cuando quede bien, `it.fails` empieza a fallar y
se cambia por `it`.
