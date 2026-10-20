# API del dominio de expedientes (semana 2)

Referencia para quien hace las pantallas de la semana 2: alta (`/expedientes/nuevo`),
ficha (`/expedientes/[numero]`), edición (`/expedientes/[numero]/editar`),
buscador (`/expedientes`) e imprimibles (`/expedientes/[numero]/imprimir?hoja=caratula|historial`).
Las pantallas ya están hechas sobre esta API (sección 11).
La especificación es [propuesta-mvp.md](propuesta-mvp.md); acá está solo lo que
hace falta para llamar al dominio. Los tipos completos, con comentarios, están
en el código: esto es el mapa.

| Módulo | Qué tiene |
|---|---|
| `@/lib/dominio/expedientes/servidor` | **Lo que importan las páginas, Server Actions y Route Handlers**: `expedientes` (el servicio, ya conectado a la base) y todos los tipos. `server-only` |
| `@/lib/dominio/expedientes/esquemas` | Esquemas zod del alta y la edición, armados en tiempo de ejecución. Puro: se puede usar en el navegador |
| `@/lib/dominio/permisos` | `evaluarPermiso`, `exigirPermiso`, `PermisoDenegado` (semana 1, con lo nuevo de la semana 2) |
| `@/lib/fechas` | Fechas `YYYY-MM-DD`, hoy en Tucumán, `datetime-local`, formato es-AR |
| `@/lib/dominio/busqueda` | La columna `busqueda` y la caja única (el servicio la expone como `expedientes.buscar`) |

## 1. Cómo se usa

```ts
import { exigirUsuario } from "@/lib/auth/sesion";
import { ipDeSolicitud } from "@/lib/auth/red";
import { expedientes } from "@/lib/dominio/expedientes/servidor";
import { headers } from "next/headers";

const usuario = await exigirUsuario(); // UsuarioActual cumple UsuarioPermisos
const ip = ipDeSolicitud(await headers());
const ficha = await expedientes.obtenerFicha(usuario, numero, { ip });
```

Reglas comunes:

- **Primer argumento: el usuario de la sesión** (`getUsuarioActual()` /
  `exigirUsuario()`). Cada función controla sus permisos con la misma
  `evaluarPermiso()` que usa la pantalla para decidir qué botones mostrar.
- **El número del expediente** es la clave pública: `CEM-2026-00042`. Las
  funciones que reciben `numero` aceptan también `cem-2026-42` y la forma corta
  `42/2026` (`canonizarNumeroInterno()`).
- **`comandoId`**: un UUID que genera el formulario **al abrirse**
  (`crypto.randomUUID()`, en un `<input type="hidden">`), no al enviar. Un doble
  clic o un reintento con el mismo comando no repite la acción: devuelve el
  resultado de la primera vez con `repetido: true`. Un formulario nuevo, un
  comando nuevo.
- **`version`**: la ficha y el formulario de edición la traen; se manda de vuelta
  como `versionVista`. Si otro usuario cambió el expediente en el medio, la
  acción falla con `conflicto_version` y el texto fijo "Otro usuario modificó el
  expediente; recargá".
- **Ids**: los `bigint` de la base (expedientes, personas, movimientos) viajan
  como `string`. Las áreas, cementerios y plantillas son `number`.
- **Fechas**: un día del calendario es `FechaISO` (`"2026-10-15"`, string). Un
  instante es `Date`. Para mostrar: `formatearFecha()`, `formatearFechaHora()` y
  `formatearSegunPrecision()` de `@/lib/fechas` (siempre hora de Tucumán).
- **Lo que escribe y lo que registra accesos** va en una transacción de
  `conActor()` con el usuario como actor. La pantalla no escribe nada por su
  cuenta.

## 2. Errores

Dos clases, para distinguir con `instanceof`:

- `PermisoDenegado` (`@/lib/dominio/permisos`): `accion` y `motivo`
  (`solo_lectura`, `area_no_habilitada`, `no_es_responsable`,
  `estado_no_admite`, `admin_no_opera`, `usuario_inactivo`…). Mostrar "No podés
  hacer esto" o, mejor, no ofrecer el botón (ver `ficha.acciones`).
- `ErrorDominio` (`@/lib/dominio/expedientes/servidor`): `codigo`, `message`
  (escrito para el usuario, se muestra tal cual) y `errores: ErrorCampo[]`
  (`{ ruta, mensaje }`, uno por campo).

| `codigo` | Cuándo | Qué hace la pantalla |
|---|---|---|
| `validacion` | Datos inválidos | Mostrar cada `errores[i].mensaje` junto al campo `ruta` (`personas[1].dni`, `ubicacion.lote`, `fechaInicio`). Ruta vacía o `personas`: arriba de la sección |
| `no_encontrado` | No existe ese número | 404 (`notFound()`) |
| `plantilla_no_publicada` | Se publicó otra versión o se retiró mientras el formulario estaba abierto | Pedir que recargue |
| `configuracion_incompleta` | El cementerio no tiene tipos de monumento o campos de ubicación, o la configuración está rota | Mostrar el mensaje ("Falta configurar el cementerio…") |
| `conflicto_version` | Bloqueo optimista | Mostrar "Otro usuario modificó el expediente; recargá" (`MENSAJE_CONFLICTO_VERSION`) |
| `estado_no_admite` | Editar un archivado o anulado | Mostrar el mensaje |
| `motivo_requerido` | Falta el motivo (10 caracteres o más, `LARGO_MINIMO_MOTIVO`) | Pedir el motivo (`errores[0].ruta === "motivo"`) |
| `sin_cambios` | Una edición que no cambia nada | Avisar y no navegar |

En una Server Action conviene atrapar los dos y devolver un estado serializable
(por ejemplo `{ ok: false, codigo, mensaje, errores }`) para `useActionState`;
cualquier otro error es un defecto y se deja subir.

## 3. Alta (`/expedientes/nuevo`)

Flujo del formulario (sección 5): tipo de trámite y plantilla → cementerio →
el resto, armado con el contexto.

### `expedientes.opcionesAlta(): Promise<OpcionesAlta>`

Plantillas publicadas (una por código, con su `tipoTramite` y su `formaPago`) y
cementerios activos. Para los dos primeros selects. No pide usuario.

```ts
{ plantillas: [{ id: 12, codigo: "RENOV_CONTADO", version: 1, nombre: "Renovación, pago de contado",
                 tipoTramite: { id: 1, codigo: "RENOVACION", nombre: "Renovación de concesión" },
                 formaPago: "contado" }, …],
  cementerios: [{ id: 1, codigo: "OESTE", nombre: "Cementerio del Oeste" }, …] }
```

### `expedientes.contextoAlta(usuario, plantillaId, cementerioId): Promise<ContextoFormulario>`

Todo lo que el formulario necesita para esa plantilla y ese cementerio:

| Campo | Para qué |
|---|---|
| `plantilla.definicion` | `personas` (rol, etiqueta, min, max, fallecido, pide_vinculo), `campos_extra`, `documentos` (con `origen`, para las dos columnas de "documentos recibidos"), `forma_pago`, `requiere_contacto`, `ubicacion_obligatoria` |
| `camposUbicacion` | Los campos **activos** del cementerio, en orden: `{ clave, etiqueta, tipo: "texto" \| "entero", obligatorio, patron }`. Son obligatorios solo si `definicion.ubicacion_obligatoria` |
| `tiposMonumento` | `{ codigo, nombre }[]`: los de la plantilla habilitados en el cementerio |
| `cementerios` | Para los campos extra de tipo `cementerio` |
| `hoy` | Hoy en Tucumán, para el máximo del date picker |
| `problemas` | Si no está vacío, mostrar esto **en lugar del formulario** ("Falta configurar el cementerio…", 2.2) |
| `esquema` | Para `construirEsquemaAlta(contexto.esquema)` en el navegador |

Permiso: Mesa de Entradas o admin. Errores: `PermisoDenegado`,
`validacion` (no existe), `plantilla_no_publicada`.

### Validación en el navegador (opcional)

```ts
"use client";
import { construirEsquemaAlta, erroresDe } from "@/lib/dominio/expedientes/esquemas";
const esquema = construirEsquemaAlta(contexto.esquema);
const errores = erroresDe(esquema, datos); // ErrorCampo[]: mismas reglas, rutas y mensajes que el servidor
```

`erroresDe(esquema, datos)` es `validarCon()` sin tirar: devuelve los errores por
campo (vacío si pasa), con el locale `es` de zod como el servidor.

El servidor vuelve a validar siempre. Pasar `contexto.esquema` del Server
Component al Client Component es seguro (no tiene datos personales).

### `expedientes.alta(usuario, datos: DatosAlta, comandoId): Promise<ResultadoAlta>`

```ts
interface DatosAlta {
  plantillaId: number;               // de opcionesAlta (la versión publicada)
  cementerioId: number;
  tipoMonumento: string;             // código
  ubicacion?: Record<string, string | null>;   // por clave de campo; "012" se guarda "12"
  padron?: string | null;
  numeroMunicipal?: string | null;   // tal como se escribe: "12.345/2026"
  formaPago?: "contado" | "plan_pagos" | null; // solo si forma_pago es "a_elegir"
  personas: PersonaEntrada[];
  datosExtra?: Record<string, string | number | null>;  // por clave de campos_extra
  documentosRecibidos?: string[];    // claves de definicion.documentos
  observaciones?: string | null;
  fechaInicio: string;               // "YYYY-MM-DD"
  cargaHistorica?: boolean;          // "Expediente iniciado antes del sistema"
  fuente?: string | null;            // obligatoria con cargaHistorica
}

interface PersonaEntrada {
  rol: string;                       // de definicion.personas
  apellido: string; nombres: string;
  dni?: string | null;               // con o sin puntos; 6 a 9 dígitos
  fallecido?: boolean;               // se puede omitir si la plantilla dice "si" o "no"
  fechaDefuncion?: string | null;    // solo si falleció
  vinculo?: string | null;           // obligatorio si pide_vinculo
  telefono?: string | null; telefonoWhatsapp?: boolean;
  email?: string | null; domicilio?: string | null;
  esContacto?: boolean;
}

interface ResultadoAlta {
  id: string; numero: string;        // "CEM-2026-00042"
  numeroCorto: string;               // "42/2026"
  version: number;                   // 0
  repetido: boolean;                 // el comando ya se había usado
  avisos: AvisoDuplicado[];          // otros expedientes sobre lo mismo
}
```

Reglas que conviene reflejar en el formulario (las valida igual el servidor):

- **Personas**: cantidad por rol entre `min` y `max`. `fallecido: "si"` o `"no"`
  lo fija la plantilla (no mostrar la casilla); `"opcional"`, casilla.
  `pide_vinculo`: campo vínculo obligatorio.
- **Contacto**: si `requiere_contacto`, exactamente una persona viva con
  teléfono o correo. Si no se marca ninguna y hay una sola posible, el servidor
  la marca (por ejemplo, en RENOV_SPT_CONTADO el solicitante). Con dos posibles,
  hay que elegir (`ruta: "personas"`, "Marcá qué persona es el contacto").
- **Fecha de inicio**: sin carga histórica, de hoy a 30 días atrás
  (`DIAS_RETROACTIVOS_MAX`). Con carga histórica, de 1950 a hoy y con `fuente`.
  La carga histórica es de Mesa de Entradas y del admin.
- **Campos extra**: ninguno es obligatorio en el alta; los `obligatorio` se
  exigen al dar el pase (semana 3).

Qué hace: número `CEM-<año de registro>-NNNNN` sin huecos; `alta` con fecha
efectiva = fecha de inicio (si es hoy, ahora); expediente en el primer paso,
recibido por Mesa (`recibido_en` = fecha del alta); personas versionadas;
documentos recibidos en `items`. Después del alta: "**Guardar e imprimir
carátula**" (sección 5) navega a la carátula con `numero`.

Ejemplo (Server Action):

```ts
"use server";
export async function guardarAlta(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  const datos = JSON.parse(String(form.get("datos"))) as DatosAlta;
  try {
    const r = await expedientes.alta(usuario, datos, String(form.get("comandoId")));
    redirect(`/expedientes/${r.numero}/imprimir?hoja=caratula`);
  } catch (e) {
    if (e instanceof ErrorDominio) return { ok: false, codigo: e.codigo, mensaje: e.message, errores: [...e.errores] };
    if (e instanceof PermisoDenegado) return { ok: false, codigo: "permiso", mensaje: "No podés dar altas", errores: [] };
    throw e;
  }
}
```

(Ojo: `redirect()` tira una excepción propia de Next; va fuera del `try` o se
deja pasar.)

### `expedientes.avisosDuplicados(usuario, consulta): Promise<AvisoDuplicado[]>`

Para avisar **antes** de guardar (al salir de los campos de ubicación, padrón o
N° municipal). Compara con los expedientes no anulados.

```ts
consulta: { cementerioId: number; ubicacion?: Record<string, string | null>;
            padron?: string | null; numeroMunicipal?: string | null;
            excluirNumero?: string | null }   // en la edición, el propio
// →
[{ numero: "CEM-2026-00012", estado: "en_tramite", coincidencias: ["ubicacion", "padron"],
   mensaje: "CEM-2026-00012 (en trámite) tiene la misma ubicación y el mismo padrón" }]
```

Es un aviso, no un bloqueo. El alta y la edición devuelven lo mismo en `avisos`.

## 4. Edición (`/expedientes/[numero]/editar`)

### `expedientes.formularioEdicion(usuario, numero, { ip? }): Promise<FormularioEdicion>`

El contexto (como `contextoAlta`), los valores actuales con la forma de
`CambiosEdicion` (las personas vigentes con su `id`, con el contacto completo),
`version`, y qué puede editar el usuario:

```ts
acciones: { editarIdentificatorios: Decision; editarContacto: Decision; completarCamposExtra: Decision }
// Decision = { permitido: true; requiereMotivo: boolean } | { permitido: false; motivo }
```

Deshabilitar lo que no está permitido. Si `editarIdentificatorios.requiereMotivo`
(ya hubo un pase), pedir motivo al cambiar algo identificatorio. Registra
`ver_expediente` (detalle `{ para: "editar" }`). Errores: `PermisoDenegado` si
no puede editar nada, `no_encontrado`, `estado_no_admite` (archivado o anulado).

### `expedientes.editar(usuario, numero, cambios, versionVista, motivo, comandoId): Promise<ResultadoEdicion>`

```ts
interface CambiosEdicion {          // ausente = no cambia; null o "" = borrar
  tipoMonumento?: string;
  ubicacion?: Record<string, string | null>;    // la ubicación completa
  padron?: string | null;
  numeroMunicipal?: string | null;
  fechaInicio?: string;
  observaciones?: string | null;
  datosExtra?: Record<string, string | number | null>;  // solo las claves que cambian
  personas?: PersonaEntrada[];      // la lista COMPLETA de vigentes después de editar
}

interface ResultadoEdicion {
  numero: string; version: number; // la nueva
  repetido: boolean; movimientoId: string;
  campos: string[];                 // "padron", "ubicacion", "datos_extra.concesion_hasta", "personas"
  avisos: AvisoDuplicado[];
}
```

- **Personas**: mandar todas las vigentes. Con `id` y sin cambios: no pasa nada.
  Con `id` y cambios: versión nueva (la vieja queda como historia). Sin `id`:
  persona nueva. Una vigente que no viene: se da de baja. No se cambia el rol de
  una persona (quitarla y agregarla). Las suprimidas no vienen en
  `valores.personas` y no se tocan.
- **Qué permiso pide cada cosa** (3.2):
  - identificatorios (nombre, DNI, fallecimiento, vínculo, altas y bajas de
    personas, ubicación, tipo de monumento, padrón, N° municipal, fecha de
    inicio): Mesa de Entradas, Cómputo si es la responsable, admin. **Después
    del primer pase, `motivo` de 10 caracteres o más.**
  - contacto (teléfono, WhatsApp, correo, domicilio, quién es contacto) y
    observaciones: Mesa de Entradas, el área responsable, admin. Sin motivo.
  - campos extra: Mesa de Entradas, el área responsable, admin.
- `motivo` puede ir `null` si no hace falta; si viene, se guarda igual.
- La fecha de inicio respeta las reglas del alta y no puede quedar después del
  primer pase.
- No se editan la plantilla, la forma de pago ni el cementerio (eso es
  "Reiniciar con otra plantilla", semana 4).

Errores: `PermisoDenegado`, `no_encontrado`, `estado_no_admite`,
`conflicto_version`, `validacion`, `motivo_requerido`, `sin_cambios`.

## 5. Ficha (`/expedientes/[numero]`)

### `expedientes.obtenerFicha(usuario, numero, { ip? }): Promise<Ficha>`

Registra `ver_expediente` en `auditoria.accesos`. Cualquiera la ve. Lo que trae
(ver `Ficha` en `ficha.ts`):

| Bloque | Campos |
|---|---|
| Cabecera | `numero`, `numeroCorto`, `numeroMunicipal`, `estado`, `version`, `fechaInicio`, `cargaHistorica`, `tipoTramite`, `plantilla` (`texto`: "Renovación, pago de contado · v1 (hay v2)", `hayVersionNueva`), `cementerio`, `tipoMonumento`, `ubicacion` (etiqueta y valor) y `ubicacionTexto`, `padron`, `formaPago`, `observaciones`, `datosExtra` (con etiqueta y `valorTexto`), `paso` (`orden`/`total`, `esFinal`), `areaActual`, `areaResponsable`, `enAreaDesde`, `recibidoEn`, `plazo`, `situaciones` (`sin_confirmar`, `devuelto`, `carga_historica`, `reiniciado`, `plazo_por_vencer`, `plazo_vencido`), `expedienteAnterior` / `expedientesSiguientes`, `creadoPor` |
| Recorrido | `recorrido[]`: cada paso con `area` resuelta (también `$CEMENTERIO`), `custodia`, `diasAlerta`, `instrucciones`, `situacion` (`cumplido` / `actual` / `pendiente`) y sus `subtareas` (`hecha`, `valor`, `obligatoria`, `dato`) |
| Documentación | `documentacion.direccion[]` y `documentacion.concesionario[]`: `estado` (`pendiente`, `presentado`, `no_corresponde`, `historico`), `exigirAlSalirDe`, `adjunto`, `adjuntos` (ids; `null` si están enmascarados) y `cantidadAdjuntos` |
| Personas | `personas[]` vigentes (por rol en el orden de la plantilla) y `personasHistoricas[]` (versiones viejas y bajas): `etiquetaRol`, nombre, DNI, `fallecido`, `vinculo`, `esContacto`, `suprimida`, `contacto` |
| Conceptos | `conceptos[]` con el paso en que se liquidan |
| Historial | `historial[]` del más viejo al más nuevo (fecha efectiva, secuencia): `fechaEfectiva` + `precisionFecha`, `registradoEn`, `diferido` (> 48 h), `usuario.corto` ("J. Pérez"), áreas y pasos, `motivo`, `observacion`, `fuente`, `cargaHistorica`, `datos`, `corregidoPor`, `personasCreadas` (con `reemplazaA` para mostrar la diferencia entre versiones) |
| Permisos | `datosCompletos` y `acciones` (`verDatosCompletos`, `editarIdentificatorios`, `editarContacto`, `completarCamposExtra`, `imprimir`) |

Línea de tiempo, como pide 2.13(c): `formatearSegunPrecision(m.fechaEfectiva,
m.precisionFecha)` · "cargado el `formatearFecha(m.registradoEn)` por
`m.usuario.corto`" · "fuente: `m.fuente`".

**Contacto enmascarado** (decisión 13): si `datosCompletos` es `false`, cada
`persona.contacto` viene con `enmascarado: true` (`"•••• •••-••90"`,
`"m•••@c•••"`, `"•••"`) y los adjuntos en `null`. Mostrar el botón **"Ver datos
completos"** cuando `acciones.verDatosCompletos.requiereMotivo` es `true`. El
enlace de WhatsApp (`wa.me`) solo con el teléfono completo.

### `expedientes.verDatosCompletos(usuario, numero, motivo, { ip? }): Promise<DatosCompletos>`

Pide motivo (10 caracteres o más) a quien no trabaja el expediente y lo
registra en `auditoria.accesos` (`ver_datos_completos`, `detalle.motivo`).
Devuelve el contacto sin enmascarar de todas las versiones no suprimidas (por
`id`, para cruzar con `ficha.personas` y `personasHistoricas`) y los adjuntos
vigentes. Errores: `motivo_requerido`, `no_encontrado`.

## 6. Imprimibles (`/expedientes/[numero]/imprimir?hoja=caratula|historial`)

### `expedientes.datosCaratula(usuario, numero, { ip? }): Promise<Caratula>`

Registra `imprimir` (`detalle.hoja = "caratula"`). Todos pueden imprimir.

```ts
{ numero, numeroCorto, numeroMunicipal,
  rutaFicha: "/expedientes/CEM-2026-00042",       // QR: new URL(rutaFicha, APP_URL), con qrcode (SVG)
  tramite: { tipo, plantilla, version }, cementerio, tipoMonumento,
  ubicacion: [{ etiqueta, valor }], ubicacionTexto, padron, fechaInicio, cargaHistorica,
  titulares: [{ apellido, nombres, dni, fallecido, vinculo }],   // sin teléfono, correo ni domicilio
  solicitantes: [ … ],
  recorrido: [{ orden, clave, nombre, area, custodia, subtareas: [{ clave, nombre, obligatoria }] }], // casilleros
  emitidaEl: "2026-10-20" }
```

### `expedientes.datosHistorial(usuario, numero, { ip? }): Promise<HojaHistorial>`

La hoja imprimible del historial (`?hoja=historial`). Registra `imprimir`
(`detalle.hoja = "historial"`). Todos pueden imprimir. Como la carátula, sin
teléfono, correo ni domicilio:

```ts
{ numero, numeroCorto, numeroMunicipal, estado, tramite /* plantilla.texto */, tipoTramite, cementerio,
  ubicacionTexto, padron, fechaInicio, cargaHistorica, paso, areaActual,
  personas: [{ id, etiquetaRol, apellido, nombres, dni, vigente, suprimida }],  // vigentes e históricas
  camposExtra: [{ clave, etiqueta }],      // para leer "datos_extra.<clave>" en las ediciones
  historial: MovimientoFicha[],            // el mismo de la ficha
  emitidaEl: "2026-10-20" }
```

Errores: `no_encontrado`.

## 7. Buscador (`/expedientes?q=`)

### `expedientes.buscar(usuario, { q?, filtros? }): Promise<ResultadoBusqueda>`

La caja única **no adivina** el tipo de número (2.13(g)):

| Lo que se escribe | Qué busca | `abrir` |
|---|---|---|
| `CEM-2026-42`, `cem 2026/42` | Ese expediente (aunque esté anulado) | su número, si existe |
| Solo dígitos y `. - /` y espacios: `30.111.222`, `20-30111222-3`, `1234/2026` | Por igualdad: N° municipal, padrón, DNI de las personas vigentes (con 11 dígitos también el DNI del CUIL) y, si tiene forma `N/AAAA`, el N° interno | el número si hay **un** resultado |
| Texto: `gonzalez maria` | Cada palabra (sin acentos) en `busqueda`, ordenado por similitud | nunca |

Si `abrir` no es `null`, ir directo a la ficha. Si no, listar `resultados`
(como máximo 50; `hayMas` dice que hay que afinar). Cada fila trae `numero`,
`numeroCorto`, `numeroMunicipal`, `estado`, `fechaInicio`, `tipoTramite`,
`plantilla`, `cementerio`, `ubicacionTexto`, `paso`, `areaActual`, `titular`
("APELLIDO, Nombres"), `sinConfirmar`, `cargaHistorica` y, en la búsqueda
numérica, `coincidencias` (`{ campo, etiqueta }`: "N° municipal", "N° interno",
"Padrón", "DNI del solicitante") para mostrar por dónde coincidió.

```ts
filtros?: {
  cementerioId?: number;
  ubicacion?: Record<string, string | null>;  // requiere cementerioId; "012" encuentra el lote "12"
  estados?: EstadoExpediente[];
  tipoTramiteId?: number;
  plantillaCodigo?: string;                   // todas sus versiones
  areaActualId?: number;
  fechaInicioDesde?: string; fechaInicioHasta?: string;
  incluirAnulados?: boolean;                  // por defecto no
}
```

Con `q` vacío lista por filtros, los más nuevos primero. Buscar no registra
accesos (abrir la ficha sí). Errores: `validacion` (fecha inválida, ubicación
sin cementerio).

### `expedientes.opcionesBusqueda(): Promise<OpcionesBusqueda>`

Los catálogos de los filtros. No pide usuario (como `opcionesAlta`).

```ts
{ tiposTramite: [{ id, codigo, nombre }],          // también los inactivos, al final
  plantillas: [{ codigo, nombre }],                 // una por código (las versiones no borrador)
  cementerios: [{ id, codigo, nombre, activo, camposUbicacion }],  // campos ACTIVOS; los inactivos al final
  areas: [{ id, codigo, nombre }] }                 // las que reciben pases (sin Dirección)
```

## 8. Permisos (`@/lib/dominio/permisos`)

Lo de la semana 1 sigue igual (`evaluarPermiso(accion, expediente, usuario)`,
`exigirPermiso`, `puede`). Cambios de la semana 2:

- Acción nueva `imprimir`: todos, también Dirección.
- `editar_identificatorios`, `editar_contacto` y `completar_campos_extra`
  devuelven `estado_no_admite` en archivado y anulado (3.1).

Para la ficha no hace falta llamar a `evaluarPermiso`: `ficha.acciones` ya trae
las decisiones de lo que se puede hacer en la semana 2.

## 9. Fechas (`@/lib/fechas`)

| Función | Para qué |
|---|---|
| `hoyEnTucuman(ahora?)` | `"2026-10-20"`: máximo de los date pickers |
| `formatearFecha(fechaISO \| Date)` | `"15/03/2019"` |
| `formatearFechaHora(date)` | `"15/03/2026 14:05"` (hora de Tucumán) |
| `formatearSegunPrecision(date, "dia" \| "minuto")` | Fecha efectiva de un movimiento |
| `interpretarDatetimeLocal("2026-10-15T14:30")` | Un `<input type="datetime-local">` leído en hora de Tucumán (para los pases de la semana 3) |
| `comoDatetimeLocal(date)` | Precargar un `datetime-local` |
| `esFechaValida`, `sumarDias`, `diasEntre`, `fechaDesdeDb`, `fechaParaDb`, `inicioDelDiaEnTucuman` | Aritmética y conversión con Prisma (las columnas `date` nunca como `Date` en el dominio) |

## 10. Fuera de la app

La semilla y los tests arman el servicio con su propio cliente:

```ts
import { conActorEn } from "@/lib/db/actor";
import { crearCliente } from "@/lib/db/crear-cliente";
import { crearServicioExpedientes } from "@/lib/dominio/expedientes";

const cliente = crearCliente();
const expedientes = crearServicioExpedientes({
  leer: cliente,
  escribir: (usuarioId, motivo, fn) => conActorEn(cliente, usuarioId, motivo, fn),
});
```

## 11. Las pantallas (semana 2)

Lo que usa cada pantalla, para la semana 3:

| Ruta | Qué llama |
|---|---|
| `/expedientes` | `opcionesBusqueda` y `buscar`; si `abrir`, `redirect` a la ficha. La búsqueda vive en la URL (`src/lib/presentacion/busqueda.ts`: `q`, `estado`, `tramite`, `plantilla`, `cementerio`, `u.<clave>`, `area`, `desde`, `hasta`, `anulados=1`) |
| `/expedientes/nuevo?plantilla=&cementerio=` | `opcionesAlta`, `contextoAlta`; Server Action `guardarAlta` → `alta`; `consultarDuplicados` → `avisosDuplicados` |
| `/expedientes/[numero]` | `obtenerFicha`; Server Action `verDatosCompletos` |
| `/expedientes/[numero]/editar` | `formularioEdicion` (sin permiso: vuelve a la ficha); Server Action `guardarEdicion` → `editar` |
| `/expedientes/[numero]/imprimir?hoja=` | `datosCaratula` (QR con `qrcode`, SVG en el servidor) o `datosHistorial` |

- Las Server Actions están en `src/app/(app)/expedientes/acciones.ts` y solo
  ponen la sesión y el `redirect()`; la lógica (leer el FormData, llamar al
  dominio, traducir `ErrorDominio` y `PermisoDenegado` a un estado
  serializable) está en `src/lib/presentacion/acciones.ts`, que los tests de
  integración llaman con el servicio de la base de prueba
  (`tests/integracion/pantallas.test.ts`).
- El formulario manda `datos` (JSON de `DatosAlta` o `CambiosEdicion`),
  `comandoId` (generado por el servidor al abrir la página), `destino`
  (`caratula` o `ficha`, en el alta), `versionVista` y `motivo` (en la
  edición). El modelo del formulario y su conversión están en
  `src/lib/presentacion/formulario.ts`.
- El QR apunta a `APP_URL` + `rutaFicha` si `APP_URL` está definida; si no, al
  `Host` del request (`origenPublico()` en `src/lib/presentacion/enlaces.ts`).
  En producción conviene definir `APP_URL`.
- El enlace de WhatsApp (`enlaceWhatsapp()`) arma `https://wa.me/549…` con un
  mensaje que solo lleva el N° interno y el área de quien escribe; se ofrece
  solo con el contacto sin enmascarar.
