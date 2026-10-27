# API del dominio de expedientes (semanas 2 a 5 y el historial del 26/10/2026)

Referencia para quien hace las pantallas. Semana 2: alta (`/expedientes/nuevo`),
ficha (`/expedientes/[numero]`), edición (`/expedientes/[numero]/editar`),
buscador (`/expedientes`) e imprimibles (`/expedientes/[numero]/imprimir?hoja=caratula|historial`);
esas pantallas ya están hechas sobre esta API (sección 11). Semana 3 (sección
12): recepción, subtareas, documentos, adjuntos, pase con "Faltan N",
devolución y bandejas; sus pantallas (los diálogos de la ficha, `/bandeja`, el
contador del encabezado y los Route Handlers de adjuntos) están en la sección 13.
Semana 4 (sección 14, actualizado el 20/10/2026 según docs/fuentes): personas
jurídicas, conceptos, documentos y subtareas según el cementerio, nomenclatura
por cementerio y DIM omitible; y (sección 15) estados, reiniciar con otra
plantilla, caducidad vinculada, correcciones, plazo DIM y feriados,
transcripción histórica, panel y CSV, con sus pantallas en la sección 16.
Semana 5 (sección 17): la administración (plantillas con su editor, usuarios,
catálogos con feriados y auditoría), con sus pantallas en la sección 18.
Actualizado el 26/10/2026 (sección 19): la cadena de hash del historial
("Verificar integridad", la huella en los imprimibles y la verificación
nocturna) y la línea de tiempo con filtros y agrupada por paso; y (sección
20) las métricas de gestión (`/panel/metricas`); y (sección 21) los avisos en
el sistema (la campana del encabezado y `/avisos`).
Actualizado el 27/10/2026 (sección 22): el ingreso con usuario y contraseña
propios (Cidituc en pausa), el cambio de contraseña y lo que agrega a la
administración de usuarios; y (sección 23) el modo prueba, "Ver como…"
(`PERFILES_PRUEBA_CUILS`), para recorrer todos los perfiles con un solo usuario.
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
| `@/lib/adjuntos/tipos` | Semana 3. `MAXIMO_BYTES_ADJUNTO`, `detectarTipo()` (magic bytes), `esHeic()`. Puro: el navegador lo puede usar para avisar antes de subir |
| `@/lib/dominio/metricas/servidor` | 26/10/2026. `metricas` (el servicio de las métricas de gestión, ya conectado) y sus tipos. `server-only`. Sección 20 |
| `@/lib/dominio/avisos/servidor` | 26/10/2026. `avisos` (el servicio de los avisos en el sistema, ya conectado) y sus tipos. `server-only`. Sección 21 |
| `@/lib/dominio/admin/servidor` | Semana 5. `admin` (el servicio de la administración, ya conectado) y sus tipos. `server-only`. Sección 17. Desde el 27/10/2026, también `perfilPrueba` (el modo prueba, sección 23) |
| `@/lib/dominio/plantillas/borrador` | Semana 5. `definicionEditable()` y `definicionInicial()`: la definición de un borrador con la forma del esquema. Puro |
| `@/lib/adjuntos/almacen` | Semana 3. `AlmacenAdjuntos` (interfaz), `crearAlmacenEnDisco()`, `raizAdjuntos()`, `barrerTemporales()`. Servidor |

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
| `sin_cambios` | Una edición que no cambia nada; tildar lo ya tildado; marcar un documento como ya está | Avisar y no navegar |
| `faltan_requisitos` | Semana 3. El pase no puede salir: `message` es "Faltan N: …" y `errores` trae una entrada por faltante (`subtareas.LIQ_PAGO`, `documentos.DNI`, `datosExtra.concesion_hasta`) | Abrir la lista de lo que falta (mejor: no llegar acá, ver `ficha.pase`) |
| `destino_invalido` | Semana 3. El paso elegido no es un destino del pase o de la devolución | Recargar los destinos |
| `ya_recibido` | Semana 3. Confirmar una recepción ya confirmada | Recargar |
| `adjunto_invalido` | Semana 3. No es PDF, JPG ni PNG por su contenido, está vacío, o es una foto HEIC ("Subilo como JPG") | Mostrar el mensaje |
| `adjunto_muy_grande` | Semana 3. Más de 10 MB | Mostrar el mensaje |

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
| `plantilla.definicion` | La definición tal como se publicó (todos los cementerios) |
| `definicion` | **La que usa el formulario** (semana 4): la de la plantilla sin lo que no corresponde al cementerio (`resolverPorCementerio`). `personas` (rol, etiqueta, min, max, fallecido, pide_vinculo, `admite_juridica`), `campos_extra`, `documentos` (con `origen`, para las dos columnas de "documentos recibidos"; los de `solo_si_juridica` se muestran según las personas cargadas: `documentosDelAlta()` de `@/lib/presentacion/formulario`), `forma_pago`, `requiere_contacto`, `ubicacion_obligatoria` |
| `camposUbicacion` | Los campos **activos** del cementerio, en orden: `{ clave, etiqueta, tipo: "texto" \| "entero", obligatorio, patron, ayuda? }`. Son obligatorios solo si `definicion.ubicacion_obligatoria`. `ayuda` (opcional, semana 4) dice cómo se escribe ("una letra de la A a la H"): va debajo del campo y en el error de formato |
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
  tipo?: "fisica" | "juridica";      // semana 4; por defecto "fisica". "juridica" solo si el rol tiene admite_juridica
  apellido?: string | null; nombres?: string | null;  // obligatorios en una física; una jurídica no los lleva
  dni?: string | null;               // con o sin puntos; 6 a 9 dígitos. Solo física
  razonSocial?: string | null;       // semana 4: obligatoria en una jurídica
  cuit?: string | null;              // semana 4: obligatorio en una jurídica; con o sin guiones, 11 dígitos,
                                     // prefijo 30, 33 o 34 y dígito verificador válido
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
  `pide_vinculo`: campo vínculo obligatorio. Semana 4: en los roles con
  `admite_juridica`, selector "Persona física / Persona jurídica"; una jurídica
  lleva razón social y CUIT, y no DNI, apellido ni fallecimiento (el error va en
  `personas[i].tipo` si el rol no la admite).
- **Documentos recibidos**: los de `contexto.definicion` (ya filtrados por el
  cementerio). Los que tienen `solo_si_juridica` (personería, designación de
  asamblea) solo si esa persona es jurídica; si no, error en
  `documentosRecibidos`.
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
| Personas | `personas[]` vigentes (por rol en el orden de la plantilla) y `personasHistoricas[]` (versiones viejas y bajas): `etiquetaRol`, `tipo` (física o jurídica), nombre o `razonSocial`, DNI o `cuit`, `fallecido`, `vinculo`, `esContacto`, `suprimida`, `contacto`. La razón social y el CUIT, como el nombre y el DNI, no se enmascaran |
| Conceptos | `conceptos[]` con el paso en que se liquidan |
| Historial | `historial[]` del más viejo al más nuevo (fecha efectiva, secuencia): `fechaEfectiva` + `precisionFecha`, `registradoEn`, `diferido` (> 48 h), `usuario.corto` ("J. Pérez"), áreas y pasos, `motivo`, `observacion`, `fuente`, `cargaHistorica`, `datos`, `corregidoPor`, `personasCreadas` (con `reemplazaA` para mostrar la diferencia entre versiones). 26/10/2026: `tramos[]`, el historial agrupado por paso con los días hábiles en cada área (19.3) |
| Permisos | `datosCompletos` y `acciones` (`verDatosCompletos`, `editarIdentificatorios`, `editarContacto`, `completarCamposExtra`, `imprimir`; semana 3: `confirmarRecepcion`, `tildarSubtarea`, `marcarDocumento`, `adjuntar`, `darPase`, `devolver`) |
| Semana 3 | `enAreaDesdePrecision` y `recibidoEnPrecision` (`dia` o `minuto`); `pase` (`faltan`, `destinos`); `devolucion` (`destinos`, `subtareasReiniciables`); `adjuntos` (vigentes, o `null` enmascarados) y `cantidadAdjuntos`. Ver 12.9 |

Línea de tiempo, como pide 2.13(c): `formatearSegunPrecision(m.fechaEfectiva,
m.precisionFecha)` · "cargado el `formatearFecha(m.registradoEn)` por
`m.usuario.corto`" · "fuente: `m.fuente`". Desde el 26/10/2026, filtrada y
agrupada por paso, y con la fecha de registro solo si es otra (sección 19.4).

"En el área desde" y "Recibido el": `formatearSegunPrecision(ficha.enAreaDesde,
ficha.enAreaDesdePrecision)` y lo mismo con `recibidoEn`. Un alta con fecha de
inicio pasada o un pase cargado "el 15" tienen precisión de día: con
`formatearFechaHora` se veía "19/10/2026 00:00" (corregido en la ficha).

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
vigentes: `{ documento, movimientoId, nombre, mime, bytes }` (semana 3: con el
nombre, el tipo y el tamaño, para que la ficha liste los adjuntos que trae en
`null`). Errores: `motivo_requerido`, `no_encontrado`.

## 6. Imprimibles (`/expedientes/[numero]/imprimir?hoja=caratula|historial`)

### `expedientes.datosCaratula(usuario, numero, { ip? }): Promise<Caratula>`

Registra `imprimir` (`detalle.hoja = "caratula"`). Todos pueden imprimir.

```ts
{ numero, numeroCorto, numeroMunicipal,
  rutaFicha: "/expedientes/CEM-2026-00042",       // QR: new URL(rutaFicha, APP_URL), con qrcode (SVG)
  tramite: { tipo, plantilla, version }, cementerio, tipoMonumento,
  ubicacion: [{ etiqueta, valor }], ubicacionTexto, padron, fechaInicio, cargaHistorica,
  titulares: [{ tipo, apellido, nombres, dni, razonSocial, cuit, fallecido, vinculo }],   // sin teléfono, correo ni domicilio
  solicitantes: [ … ],
  recorrido: [{ orden, clave, nombre, area, custodia, subtareas: [{ clave, nombre, obligatoria }] }], // casilleros (las del cementerio del expediente)
  integridad: ResultadoIntegridad,         // 26/10/2026: la huella del historial al emitirla (sección 19)
  emitidaEl: "2026-10-20" }
```

### `expedientes.datosHistorial(usuario, numero, { ip? }): Promise<HojaHistorial>`

La hoja imprimible del historial (`?hoja=historial`). Registra `imprimir`
(`detalle.hoja = "historial"`). Todos pueden imprimir. Como la carátula, sin
teléfono, correo ni domicilio:

```ts
{ numero, numeroCorto, numeroMunicipal, estado, tramite /* plantilla.texto */, tipoTramite, cementerio,
  ubicacionTexto, padron, fechaInicio, cargaHistorica, paso, areaActual,
  personas: [{ id, etiquetaRol, apellido, nombres, dni, razonSocial, cuit, vigente, suprimida }],  // vigentes e históricas
  camposExtra: [{ clave, etiqueta }],      // para leer "datos_extra.<clave>" en las ediciones
  subtareas: [{ clave, nombre }], documentos: [{ clave, nombre }],  // 26/10/2026: para nombrar tildes y marcas, como la ficha
  historial: MovimientoFicha[],            // el mismo de la ficha
  tramos: TramoHistorial[],                // 26/10/2026: agrupado por paso, con días hábiles (19.3)
  integridad: ResultadoIntegridad,         // 26/10/2026: la huella al emitir (19.2)
  emitidaEl: "2026-10-20" }
```

Errores: `no_encontrado`.

## 7. Buscador (`/expedientes?q=`)

### `expedientes.buscar(usuario, { q?, filtros? }): Promise<ResultadoBusqueda>`

La caja única **no adivina** el tipo de número (2.13(g)):

| Lo que se escribe | Qué busca | `abrir` |
|---|---|---|
| `CEM-2026-42`, `cem 2026/42` | Ese expediente (aunque esté anulado) | su número, si existe |
| Solo dígitos y `. - /` y espacios: `30.111.222`, `20-30111222-3`, `1234/2026` | Por igualdad: N° municipal, padrón, DNI de las personas vigentes (con 11 dígitos también el DNI del CUIL y el CUIT de una persona jurídica, semana 4) y, si tiene forma `N/AAAA`, el N° interno | el número si hay **un** resultado |
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

Cambios de la semana 3 (3.1, 3.2 y 3.3 punto 1):

- `confirmar_recepcion`, `tildar_subtarea`, `dar_pase`, `devolver` (y
  `concluir`): el operador del área responsable (en un paso externo, la
  custodia), solo en `en_tramite` o `espera_pago_dim` (`estado_no_admite`).
- `dar_pase` y `devolver`: no con la carga histórica abierta
  (`carga_historica_abierta`); `dar_pase` no en el último paso
  (`paso_final`: se concluye) y `devolver` no en el primero (`primer_paso`).
- `marcar_documento` y `adjuntar`: el responsable (también en concluido) y Mesa
  de Entradas en estados activos; nadie en archivado ni anulado.
- Acción nueva `ver_bandeja`: operadores con área (Dirección y el admin van al panel).
- `ExpedientePermisos` suma `cargaHistorica`, `pasoFinal` y `primerPaso`
  (opcionales; `permisosDelExpediente()` los completa). `MotivoDenegacion`
  suma `carga_historica_abierta`, `paso_final` y `primer_paso`
  (`TEXTO_DENEGACION` tiene sus textos).

Para la ficha no hace falta llamar a `evaluarPermiso`: `ficha.acciones` ya trae
las decisiones de lo que se puede hacer.

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
  // Solo para subirAdjunto y leerAdjunto:
  almacen: crearAlmacenEnDisco(raizAdjuntos()),
});
```

En la app, `expedientes` de `servidor.ts` ya trae el almacén en disco
(`ADJUNTOS_DIR`, o `./.data/adjuntos` en desarrollo), creado en el primer uso.

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

## 12. Semana 3: el flujo

Pases, recepción, devoluciones, subtareas, documentos, adjuntos, bandejas y
"Faltan N" (propuesta, 3.3 a 3.5, decisión 8 y sección 5). Todo está en
`expedientes` (`servidor.ts`); los módulos son `recepcion.ts`, `subtareas.ts`,
`documentos.ts`, `adjuntos.ts`, `pase.ts`, `devolucion.ts`, `bandejas.ts` y,
puro, `flujo.ts` (lo que falta, destinos, fechas, plazo).

### 12.1 Reglas comunes de las acciones

Cada acción que inserta un movimiento sigue el mismo esqueleto
(`operacion.ts`, `ejecutarAccion`), en una transacción de `conActor()`:

1. **Idempotencia primero**: si el `comandoId` ya hizo esa acción en el
   expediente, devuelve lo de la primera vez con `repetido: true`, sin validar
   nada (ni la versión). El `version` del resultado es el ACTUAL.
2. `SELECT … FOR UPDATE` y otra vez la idempotencia (dos reintentos
   simultáneos del mismo comando no hacen la acción dos veces).
3. **`versionVista`**: la `version` que mostraba la pantalla (ficha o fila de
   la bandeja). Si cambió: `conflicto_version` ("Otro usuario modificó el
   expediente; recargá"). Va antes que el estado y el permiso: si otro dio el
   pase en el medio, el mensaje es ese y no "no sos el responsable".
4. Estado (`estado_no_admite`), permiso (`PermisoDenegado`) y las
   validaciones de la acción.
5. **Recepción implícita**: si el área donde está el papel actúa sin haber
   confirmado (`recibido_en` nulo), primero se inserta una `recepcion` con
   `{implicita: true}`, `fecha_efectiva = en_area_desde` (con su precisión) y el
   mismo `comando_id`. La dispara solo el área donde está el papel: que Mesa de
   Entradas marque un documento de un expediente que está en Legal no es una
   recepción de Legal.
6. El movimiento, la proyección y `version + 1` (una vez por acción, aunque
   haya recepción implícita). El resultado trae la `version` nueva para la
   próxima acción.

**Fecha efectiva** (`EntradaFechaEfectiva`, opcional en todas): nada = ahora
(precisión de minuto); `"2026-10-15"` = ese día (precisión de día, 00:00 de
Tucumán); `"2026-10-15T14:30"` (`datetime-local`) = esa hora en Tucumán; o un
`Date`. Se controla (`validacion`, ruta `fechaEfectiva`): no futura (un minuto
de tolerancia), hasta 30 días atrás, no anterior a `fecha_inicio`. Pase,
devolución y recepción, además, no anterior al último movimiento de ubicación
(alta, recepción explícita, pase, devolución o estado), por día si alguno de
los dos tiene precisión de día. Las subtareas, documentos y adjuntos no entran
en esa regla (decisión 6).

Una Server Action típica:

```ts
"use server";
export async function darPase(_: Estado, form: FormData): Promise<Estado> {
  const usuario = await exigirUsuario();
  try {
    const r = await expedientes.darPase(usuario, String(form.get("numero")), String(form.get("pasoDestino")),
      Number(form.get("versionVista")), String(form.get("comandoId")),
      { fechaEfectiva: String(form.get("fecha") ?? ""), motivo: String(form.get("motivo") ?? "") });
    return { ok: true, version: r.version };
  } catch (e) {
    return estadoDeError(e); // src/lib/presentacion/errores.ts: ErrorDominio y PermisoDenegado
  }
}
```

### 12.2 Recepción

`expedientes.confirmarRecepcion(usuario, numero, versionVista, comandoId, { fechaEfectiva? }): Promise<ResultadoRecepcion>`

```ts
{ numero, version, repetido, movimientoId, recibidoEn: Date }
```

La confirma el área responsable (en un paso interno, donde está el papel).
Movimiento `recepcion` con `{implicita: false}`; `recibido_en` = su fecha
efectiva. Errores: `PermisoDenegado`, `no_encontrado`, `conflicto_version`,
`estado_no_admite`, `ya_recibido`, `validacion` (fecha anterior a la llegada,
futura…).

`expedientes.confirmarRecepciones(usuario, seleccion: { numero, version }[], comandoId, { fechaEfectiva? }): Promise<ResultadoItemLote[]>`

El lote de la pestaña Por confirmar: cada expediente en su transacción; los que
fallan no frenan a los demás. Un `comandoId` para todo el lote (la
idempotencia es por expediente: reintentar no repite nada).

```ts
[{ ok: true, numero, version, repetido, movimientoId, recibidoEn },
 { ok: false, numero, codigo: "conflicto_version" | "ya_recibido" | "permiso" | …, mensaje }]
```

### 12.3 Subtareas

`expedientes.tildarSubtarea(usuario, numero, clave, dato, versionVista, comandoId, { fechaEfectiva?, observacion? }): Promise<ResultadoSubtarea>`

`expedientes.destildarSubtarea(usuario, numero, clave, motivo, versionVista, comandoId, { fechaEfectiva?, observacion? }): Promise<ResultadoSubtarea>`

```ts
{ numero, version, repetido, movimientoId, clave, hecha, dato: string | null, recepcionImplicita: boolean }
```

- Solo las del **paso actual** (`validacion`, ruta `subtarea`, "Solo se tildan
  las subtareas del paso actual"), solo el responsable (la custodia en un
  paso externo), en estados activos.
- `dato` según `subtareas[].dato`: `fecha` → `"YYYY-MM-DD"`, no futura ni
  anterior al inicio; `texto` → hasta 200 caracteres (`LARGO_MAXIMO_DATO_TEXTO`);
  `null` si la subtarea no lleva dato. Con `dato_obligatorio`, sin dato es
  `validacion` (ruta `dato`: "Indicá la fecha" / "Completá el dato").
  Tildar otra vez con otro dato lo cambia; con el mismo, `sin_cambios`.
- Destildar exige `motivo` (10 o más; `motivo_requerido`).
- **Paso externo** (DIM, cementerio) y subtarea con `dato: fecha`: la fecha del
  movimiento es ese día, con precisión de día (3.5). Sin el límite de 30 días:
  es la fecha del papel que vuelve, no un registro demorado.
- **Plazo** (3.6): tildar la subtarea de inicio del plazo del paso actual carga
  `plazo_desde`; la de cierre (DIM_PLAN_INICIADO), `plazo_cumplido_en`.
  Destildarlas los vacía. (El vencimiento y el semáforo son de la semana 4.)
- Movimiento `subtarea` con `{subtarea, hecha, dato, paso}`; actualiza `items`
  (tildarla saca la marca de "reiniciada") y `busqueda`.

### 12.4 Documentos

`expedientes.marcarDocumento(usuario, numero, clave, estado, observacion, versionVista, comandoId, { fechaEfectiva? }): Promise<ResultadoDocumento>`

```ts
estado: "presentado" | "no_corresponde" | "pendiente"   // ESTADOS_MARCABLES; "historico" no se marca a mano
// →
{ numero, version, repetido, movimientoId, clave, estado, observacion, recepcionImplicita }
```

- `no_corresponde` exige `observacion` (`validacion`, ruta `observacion`).
  Con `pendiente` la observación se descarta.
- Cualquier documento de la plantilla. Quién (3.2): el responsable (también en
  concluido) y Mesa de Entradas en estados activos; nadie en archivado ni anulado.
- Movimiento `documento` con `{documento, estado}` y la observación en
  `observacion`; `items.documentos[clave]` conserva sus adjuntos.

### 12.5 Adjuntos

**Subida** (para el Route Handler `POST /api/expedientes/[numero]/adjuntos`,
fuera del `matcher` del proxy y con `client_max_body_size 12m` en nginx):

`expedientes.subirAdjunto(usuario, numero, contenido: ReadableStream<Uint8Array>, { nombre, documento }, versionVista, comandoId): Promise<ResultadoAdjunto>`

```ts
// En el Route Handler, sin leer el cuerpo antes (los metadatos van en la URL o en headers):
const r = await expedientes.subirAdjunto(usuario, numero, request.body, {
  nombre: url.searchParams.get("nombre") ?? "archivo",
  documento: url.searchParams.get("documento"),   // clave, o null
}, Number(url.searchParams.get("version")), url.searchParams.get("comando") ?? "");
// →
{ numero, version, repetido, movimientoId, documento, nombre, mime, bytes, sha256, recepcionImplicita }
```

1. Antes de leer el cuerpo: comando repetido (devuelve lo de entonces y cancela
   el cuerpo), expediente, estado, permiso `adjuntar` y documento (que exista y
   no tenga `adjunto: "no"`, como las actas de defunción).
2. El cuerpo, en streaming a `tmp/<uuid>` con sha256 al vuelo y fsync; corta
   pasados 10 MB (`adjunto_muy_grande`) y borra lo escrito.
3. El tipo por magic bytes: PDF, JPG o PNG. Si no: `adjunto_invalido` ("Solo se
   admiten PDF, JPG o PNG", "Subilo como JPG" para HEIC, "El archivo está
   vacío"), y se borra el temporal.
4. En `conActor()`: el movimiento `adjunto` con
   `{nombre, mime, bytes, sha256, documento, ruta}` (ruta `AAAA/MM/<uuid>`) e
   `items` (`adjuntos[id] = {documento, vigente: true}` y el id en la lista del
   documento). Adjuntar **no** marca el documento como presentado.
5. Hecho el commit, el rename a `AAAA/MM/<uuid>` (0440 en Linux). Si la
   transacción falló (por ejemplo `conflicto_version`), se borra el temporal.

El `nombre` se guarda limpio (sin carpetas ni caracteres de control, 150 como
máximo); en el disco el archivo se llama con el UUID. El id del adjunto es el
`movimientoId`. Si `request.body` es `null` (cuerpo vacío), pasar un stream
vacío: da `adjunto_invalido` ("El archivo está vacío").

**Lectura** (para `/adjuntos/[movimientoId]`, `?descargar=1`):

`expedientes.leerAdjunto(usuario, movimientoId, { descargar?, motivo?, ip? }): Promise<AdjuntoLeido>`

```ts
{ numero, movimientoId, nombre, mime, bytes, sha256, disposicion: "inline" | "attachment",
  contenido: ReadableStream<Uint8Array> }
// El Route Handler:
return new Response(a.contenido, { headers: {
  "Content-Type": a.mime,
  "Content-Disposition": `${a.disposicion}; filename*=UTF-8''${encodeURIComponent(a.nombre)}`,
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
} });
```

Permiso de ver los datos completos (3.2): quien no trabaja el expediente tiene
que mandar `motivo` (10 o más; si no, `motivo_requerido`), como en "Ver datos
completos". Registra `ver_adjunto` o `descargar_adjunto` en `auditoria.accesos`
(`detalle: { movimiento, motivo? }`). Un id que no es un adjunto vigente:
`no_encontrado`.

**Almacén** (`@/lib/adjuntos/almacen`): `ADJUNTOS_DIR` (en producción
obligatoria y absoluta; la app no arranca sin ella) o `./.data/adjuntos` en
desarrollo. **Barrido** de temporales de más de 24 h: `npm run adjuntos:barrer`
(`scripts/barrer-adjuntos-tmp.ts`, opción `--horas N`), o
`barrerTemporales(almacen, ahora, horas)` desde otro script.

**Supabase Storage** (27/10/2026, despliegue en Vercel;
[docs/despliegue-vercel.md](despliegue-vercel.md)): con
`ADJUNTOS_ALMACEN=supabase` el almacén es `crearAlmacenSupabase()`
(`@/lib/adjuntos/supabase`, bucket privado `adjuntos`) con la misma interfaz
(`tmp/<uuid>` → `AAAA/MM/<uuid>`, purga, retiro, barrido) más dos métodos para
la **subida directa** del navegador, porque en Vercel una función no recibe
más de 4,5 MB:

```ts
// POST /api/expedientes/[numero]/adjuntos/autorizar  { documento, version, comando, bytes }
expedientes.autorizarSubidaAdjunto(usuario, numero, { documento }, versionVista, comandoId)
// → { tipo: "subir", subida: { id, url } }        url firmada de subida hacia tmp/<id>
// → { tipo: "repetido", resultado: ResultadoAdjunto }   el comando ya se usó
// La capa HTTP responde { ok, subida: { url, ticket } } (ticket HMAC: usuario, expediente, comando, id; 2 h).

// El navegador: PUT <url> con el archivo (Content-Type por magic bytes).

// POST /api/expedientes/[numero]/adjuntos/confirmar  { ticket, nombre, documento, version, comando }
expedientes.confirmarSubidaAdjunto(usuario, numero, idTemporal, { nombre, documento }, versionVista, comandoId)
// → ResultadoAdjunto, como subirAdjunto
```

`autorizarSubidaAdjunto` hace el paso 1 y además compara la versión (el mismo
`conflicto_version` que daría el movimiento). `confirmarSubidaAdjunto` vuelve a
hacer el paso 1, lee el temporal desde Storage en streaming (más de 10 MB:
`adjunto_muy_grande`; si no está: `validacion`, "El archivo no llegó…") y
sigue con los pasos 3 a 5 tal cual; cualquier error borra el temporal. Con el
disco las dos responden `validacion` ("…recibe los adjuntos por la app"). La
pantalla elige el transporte con `DatosFlujo.subidaAdjuntos` (`"app"` o
`"directa"`, `modoDeSubida()` de `@/lib/adjuntos/config`). `leerAdjunto`
devuelve `bytes: null` si el almacén no informa el largo (sin Content-Length).

### 12.6 Pase y "Faltan N"

`expedientes.validarPase(usuario, numero): Promise<ValidacionPase>` (no escribe ni registra accesos)

```ts
{ numero, version,
  paso: RefPaso,                    // { clave, nombre, orden }
  faltan: Faltante[],               // para el paso siguiente: el "Faltan N" del botón
  destinos: DestinoPase[],          // vacío en el último paso
  permiso: Decision }               // dar_pase para este usuario

type Faltante =
  | { tipo: "subtarea"; clave; nombre; paso: RefPaso; motivo: "sin_tildar" | "sin_dato" | "reiniciada"; mensaje }
  | { tipo: "documento"; clave; nombre; exigirAlSalirDe: RefPaso; motivo: "pendiente" | "sin_observacion" | "sin_adjunto"; mensaje }
  | { tipo: "campo_extra"; clave; etiqueta; exigirAlSalirDe: RefPaso; mensaje };

interface DestinoPase extends RefPaso {
  tipo: "siguiente" | "reenvio" | "omitiendo";
  esRetorno: boolean;               // es el paso que devolvió
  pasosSalteados: string[];         // reenvío directo
  pasosOmitidos: string[];          // omitiendo: exige motivo
  requiereMotivo: boolean;
  faltan: Faltante[];               // vacío = disponible
}
```

Qué falta (3.3, puntos 4 a 6): las subtareas `obligatoria` del paso sin tildar
o sin el dato que pide `dato_obligatorio`; los documentos `obligatorio` con
`exigir_al_salir_de` en el paso o en uno anterior (acumulativo) que no están
presentados, `no_corresponde` con observación o `historico` (y si
`adjunto: obligatorio`, presentados con un adjunto vigente); los campos extra
`obligatorio` exigibles hasta el paso, vacíos. Los de `exigir_al_salir_de: null`
son para Concluir (semana 4).

Destinos (3.3, punto 8): el **siguiente**; el **reenvío directo** al paso que
devolvió (`paso_retorno_clave`) si el actual y los intermedios están completos,
incluso lo que reinició la devolución aunque no sea obligatorio; y los
posteriores **salteando solo omitibles**, con motivo. Cada uno con su `faltan`:
el diálogo los ofrece todos y deshabilita los que tienen algo.

`expedientes.darPase(usuario, numero, pasoDestino, versionVista, comandoId, { fechaEfectiva?, motivo?, observacion? }): Promise<ResultadoPase>`

```ts
{ numero, version, repetido, movimientoId,
  recepcionImplicitaId: string | null,
  paso: RefPaso,                              // el destino
  areaActual: { id, codigo, nombre },         // el área concreta ($CEMENTERIO resuelto)
  areaResponsable: { id, codigo, nombre },    // la custodia en un paso externo
  sinConfirmar: boolean,                      // el destino tiene que confirmar la recepción
  estado: "en_tramite" | "espera_pago_dim" }
```

Errores: `PermisoDenegado` (no es el responsable, `carga_historica_abierta`,
`paso_final`), `no_encontrado`, `conflicto_version`, `estado_no_admite`,
`destino_invalido`, `faltan_requisitos`, `motivo_requerido` (omitiendo),
`validacion` (fecha).

Efectos: el `pase` (`datos: {pasos_omitidos, pasos_salteados}`,
`estado_anterior`/`estado_nuevo` si cambia, área de origen y de destino
concretas); en el expediente, paso, áreas, `estado` del paso destino (la DIM:
`espera_pago_dim`), `en_area_desde` = fecha efectiva, `recibido_en` (= esa fecha
si el destino es externo o es del área del usuario; si no, null: "sin
confirmar"), `plazo_*` (se cargan al entrar a un paso con plazo y se limpian
al salir), `paso_retorno_clave` (null al llegar) y `version + 1`.

**El último paso no tiene salida en la semana 3**: `dar_pase` da `paso_final` y
Concluir es de la semana 4. Mientras tanto se puede trabajar ahí (confirmar,
tildar, documentos, adjuntos) y devolver.

### 12.7 Devolución

`expedientes.devolver(usuario, numero, pasoDestino, motivo, subtareasARehacer, versionVista, comandoId, { fechaEfectiva?, observacion? }): Promise<ResultadoDevolucion>`

```ts
{ numero, version, repetido, movimientoId, recepcionImplicitaId,
  paso: RefPaso,                 // el destino
  pasoRetorno: string | null,    // a dónde se podrá reenviar directo
  subtareasReiniciadas: string[], sinConfirmar, estado }
```

- A cualquier paso anterior (`destino_invalido` si no); no desde el primero
  (`primer_paso`) ni con la carga histórica abierta.
- `motivo` de 10 o más (`motivo_requerido`). Atajos del diálogo: "Falta
  firma", "Error en boleta", "Falta documentación" (el comienzo del texto).
- No valida subtareas ni documentos.
- `subtareasARehacer`: claves de subtareas tildadas de los pasos desde el
  destino hasta el anterior al actual (`ficha.devolucion.subtareasReiniciables`
  con `paso.orden >= destino.orden`); otra cosa es `validacion` (ruta
  `subtareas.<clave>`). Pasan a `hecha: false` con `reiniciada_por_mov`.
- `paso_retorno_clave`: el paso que devolvió; en devoluciones encadenadas, el
  más avanzado.
- Estado del paso destino (sale de `espera_pago_dim`), plazo limpio (o cargado
  si el destino tiene plazo).
- La bandeja del destino muestra la etiqueta `devuelto` con el área y el motivo.

### 12.8 Bandejas

`expedientes.bandeja(usuario, pestana): Promise<Bandeja>` con `pestana` en `PESTANAS_BANDEJA`:

| Pestaña | Qué trae |
|---|---|
| `por_confirmar` | El papel está en el área del usuario y nadie confirmó (`recibido_en` nulo) |
| `en_mi_area` | El área del usuario es la responsable y el papel está en ella (con y sin confirmar). Los que custodia afuera van en Afuera |
| `afuera` | Pasos externos cuya custodia es el área del usuario. Mesa de Entradas ve todo lo que está afuera; lo que no custodia viene con `soloConsulta: true` |

Plazos y Carga histórica: sección 15.6. Siempre estados activos, del que
llegó antes al más nuevo, 200 filas como máximo (`hayMas`).

```ts
{ pestana, area: { id, codigo }, hayMas,
  filas: [{ numero, numeroCorto, numeroMunicipal, titular /* "APELLIDO, Nombres" */,
            tramite: { tipo, plantilla, codigo, version }, paso: { clave, nombre, orden, total },
            estado, version /* para el lote */, areaActual: { codigo, nombre, externa }, areaResponsable,
            enAreaDesde, recibidoEn,
            diasEnArea /* hábiles, f_dias_habiles_entre */, diasAlerta, demorado /* diasEnArea >= diasAlerta */,
            etiquetas: Array<{ tipo: "sin_confirmar" }
                           | { tipo: "devuelto"; porArea; desdePaso; motivo }   // "Devuelto por Asesoría Legal: …"
                           | { tipo: "plazo"; desde; diasHabiles; cumplidoEn }>,
            soloConsulta,
            puedeConfirmar,   // sin confirmar y con permiso confirmar_recepcion: casilla y botón "Confirmar"
            paseRapido }] }   // RefPaso del siguiente, o null (ver abajo)
```

`paseRapido` es el "Dar pase rápido" de la sección 5: viene solo si el usuario
puede dar el pase (`dar_pase`), no falta nada y el **único** destino es el
paso siguiente (`destinosPosibles` con un solo elemento `siguiente` y
`faltan` vacío). Con reenvío directo u omitibles hay que elegir: eso va en la
ficha. Lo que Mesa de Entradas solo consulta afuera no tiene acciones.

Permiso `ver_bandeja`: operadores con área (`PermisoDenegado` para Dirección y el admin).

`expedientes.contadorPorConfirmar(usuario): Promise<number>`: el contador del
encabezado (0 para quien no tiene bandeja).

`expedientes.contadoresBandeja(usuario): Promise<ContadoresBandeja>`: cuántos
hay en cada pestaña, con las mismas condiciones que `bandeja()`:
`{ por_confirmar, en_mi_area, afuera, afueraCustodia }` (`afueraCustodia`: lo
de Afuera que custodia el área; para Mesa de Entradas, `afuera` incluye lo que
solo consulta). Todo en 0 para quien no tiene bandeja. Para los números de las
pestañas y para abrir la que tiene trabajo (`pestanaPorDefecto` en
`src/lib/presentacion/flujo.ts`).

### 12.9 Lo que la ficha suma

| Campo | Para qué |
|---|---|
| `enAreaDesdePrecision`, `recibidoEnPrecision` | `formatearSegunPrecision(…)`: sin hora si es de día |
| `acciones.confirmarRecepcion` | El permiso; el botón va si además `situaciones` incluye `sin_confirmar` |
| `acciones.tildarSubtarea`, `marcarDocumento`, `adjuntar`, `darPase`, `devolver` | Qué botones mostrar (las mismas reglas que exige la acción) |
| `pase.faltan` | "Faltan N" (vacío en el último paso) y el panel "Qué falta para avanzar", con acceso directo a cada cosa (`tipo` y `clave`) |
| `pase.destinos` | El diálogo "Dar pase" (ver 12.6) |
| `devolucion.destinos` | Los pasos anteriores, para el diálogo "Devolver" |
| `devolucion.subtareasReiniciables` | Las tildadas de los pasos anteriores (`paso.orden`); ofrecer las del destino en adelante |
| `adjuntos` | Vigentes (`movimientoId`, `documento`, `nombre`, `mime`, `bytes`, `registradoEn`, `usuario`), o `null` si están enmascarados; `cantidadAdjuntos` siempre |

Después de cada acción, recargar la ficha (o usar la `version` del resultado
para la siguiente).

### 12.10 Pendientes para la semana 4

Hechos en la semana 4: ver la sección 15.

Concluir (el último paso hoy no tiene salida), archivar, anular, reabrir,
correcciones (incluido `retirar_adjunto`, que ya respeta
`items.adjuntos[id].vigente`), vencimiento y semáforo del plazo DIM, pestañas
Plazos y Carga histórica, transcripción y "Terminar carga histórica" (que marca
`historica`, ya aceptado por "Faltan N").

## 13. Las pantallas (semana 3)

| Ruta | Qué llama |
|---|---|
| `/bandeja?pestana=` | `contadoresBandeja` (números de las pestañas y la que se abre sin `?pestana=`: Por confirmar, En mi área o Afuera, la primera con trabajo) y `bandeja`. Lote: `accionRecepciones`; fila: `accionRecepcion` y "Dar pase rápido" (`accionPase` con `fila.paseRapido` y `fila.version`) |
| Encabezado (`(app)/layout.tsx`) | `contadorPorConfirmar` para los operadores, enlazado a `/bandeja?pestana=por_confirmar` |
| `/expedientes/[numero]` | `obtenerFicha`; los diálogos de `[numero]/flujo/` llaman a `accionRecepcion`, `accionSubtarea` (tildar y destildar), `accionDocumento`, `accionPase`, `accionDevolucion` y `verDatosCompletos` (los adjuntos de quien no trabaja el expediente) |
| `POST /api/expedientes/[numero]/adjuntos?nombre=&documento=&version=&comando=` | El archivo es el cuerpo (sin multipart). `subirAdjunto` con `request.body`. JSON: 201 `{ ok: true, …ResultadoAdjunto }` (200 si es un comando repetido) o `{ ok: false, codigo, mensaje, errores }` con 401, 403 (permiso u origen), 404, 409 (versión), 413, 415 (tipo, HEIC) o 422. Fuera del `matcher` del proxy |
| `GET /adjuntos/[movimientoId]` (`?descargar=1`, `?motivo=` o `X-Motivo`) | `leerAdjunto`. Los headers de 12.5; los errores en texto plano con los mismos headers (401, 403 `motivo_requerido` o permiso, 404). El proxy la cubre (sin cookie, a /login) y la ruta vuelve a pedir el usuario |

- **Server Actions** en `src/app/(app)/expedientes/acciones.ts`
  (`accionRecepcion`, `accionRecepciones`, `accionSubtarea`,
  `accionDocumento`, `accionPase`, `accionDevolucion`): reciben un objeto
  (no FormData), lo validan con zod en `src/lib/presentacion/acciones.ts`
  (`procesar…`, probados en `tests/integracion/pantallas-flujo.test.ts`) y,
  si salió bien, llaman a `refresh()` de `next/cache`: la misma respuesta trae
  la página re-renderizada (la ficha con la versión nueva, la bandeja y el
  contador). Devuelven `{ ok: true, version, repetido, mensaje }` o el
  `EstadoError` de siempre. Ojo: el proxy renueva la cookie de sesión en cada
  request, y Next re-renderiza la página en toda respuesta de una Server Action
  que cambia cookies; así que también tras un error (por ejemplo
  `conflicto_version`) la ficha de fondo ya viene con la versión nueva.
- **Route Handlers**: la lógica está en `src/lib/presentacion/adjuntos-http.ts`
  (`responderSubida`, `responderLectura`), sin Next; los `route.ts` solo ponen
  `getUsuarioActual()` y el servicio. Tras una subida, el navegador pide
  `router.refresh()` (un Route Handler no puede).
- **`comandoId`**: lo genera cada diálogo al abrirse (`nuevoComandoId()`:
  `crypto.randomUUID()` o, fuera de un contexto seguro, `getRandomValues()`);
  un reintento desde el mismo diálogo no repite la acción. **`versionVista`**:
  la mayor entre la de la ficha y la que devolvió la última acción.
- **Diálogos**: `<dialog>` nativo con `showModal()` (`src/components/dialogo.tsx`):
  el resto queda inerte, Escape cierra, el foco va a `data-autofocus` y vuelve
  al botón que lo abrió. Errores: `src/components/aviso-error.tsx` (con
  "Recargar la página" para `conflicto_version`, `ya_recibido` y
  `destino_invalido`).
- **"Faltan N"** (`itemsFaltan` en `src/lib/presentacion/flujo.ts`): cada
  faltante con su acceso directo (subtarea → diálogo Tildar; documento →
  Marcar, o Adjuntar si falta el archivo; campo extra → el formulario de
  edición con el foco en el campo, `#campo-datosExtra-<clave>`). Desde el
  diálogo "Dar pase", al terminar el acceso directo se vuelve al pase.
- **Fecha efectiva** en recepción, pase, devolución y tildar: "Ahora" (por
  defecto, se manda vacío), "Otro día y hora" (`datetime-local`, precisión de
  minuto) o "Solo el día" (precisión de día), de hoy a 30 días atrás
  (`limitesFecha`). En un paso externo, una subtarea con `dato: fecha` no
  pide fecha: es la del dato.
- **Adjuntos en el navegador** (`src/lib/presentacion/imagen.ts`): tipo por
  magic bytes y nombre (HEIC: "subila como JPG"), PDF de hasta 10 MB; las
  imágenes se reducen a 2000 px de lado mayor y se recomprimen como JPEG 0,8
  con canvas (fondo blanco para PNG con transparencia; si no hacía falta
  reducir y la original pesa menos, va la original). El 413 de nginx y la
  sesión vencida tienen su mensaje (`mensajeRespuestaSubida`).
- **Visor**: `<img>` para imágenes e `<iframe>` para PDF sobre
  `/adjuntos/[id]` (Chrome muestra el PDF aun con `Content-Security-Policy:
  sandbox`); "Descargar" es un enlace aparte (`?descargar=1`). Quien no
  trabaja el expediente ve "Hay N adjuntos" y "Ver adjuntos": con el motivo,
  `verDatosCompletos` devuelve la lista y cada vista o descarga lleva
  `?motivo=` (queda en `auditoria.accesos` con `ver_adjunto`).


## 14. Semana 4: lo que cambió con las fuentes de la Dirección

> Actualizado el 20/10/2026 según docs/fuentes (README, "Cambios que esto
> implica", puntos 1 a 6). El 7 (los trámites que faltan) depende de la
> Dirección.

### 14.1 La definición de un expediente (`@/lib/dominio/plantillas/resolver`)

Una plantilla sirve para los tres cementerios; lo que no vale en todos se marca
en la definición, sin código por caso:

| Clave | Dónde | Qué hace |
|---|---|---|
| `solo_cementerios` / `excepto_cementerios` | conceptos, documentos y subtareas | Códigos de `cementerios`; `null` = en todos. Uno u otro |
| `solo_si_juridica` | documentos | Rol de persona: el documento corresponde solo si alguna persona vigente de ese rol es jurídica |
| `admite_juridica` | personas | El rol puede ser una persona jurídica (razón social y CUIT) |

Las cuatro tienen valor por defecto (`null`, `false`): una definición sin
ellas se lee igual que antes.

- `resolverDefinicion(def, { cementerio, rolesJuridicos })`: la definición sin
  lo que no corresponde. **Todo lo que mira la definición de un expediente la
  toma así**: la ficha (`recorrido`, `documentacion`, `conceptos`), la
  carátula, `validarPase`/"Faltan N", `darPase`, `devolver`, subtareas,
  documentos, adjuntos y la bandeja (pase rápido). En el servidor:
  `definicionDelExpediente(lector, exp, plantilla)` de `expedientes/contexto`.
- `resolverPorCementerio(def, cementerio)`: solo por cementerio. Es
  `contexto.definicion` del alta y la edición.
- Validación de "Publicar" (`validarPublicacion`): `CatalogosPlantilla` suma
  `cementerios`. Reglas nuevas: `cementerios` (los códigos existen y están
  activos, sin repetir, no los dos filtros juntos, y las subtareas de un plazo
  no se filtran) y `juridica` (`solo_si_juridica` nombra un rol con
  `admite_juridica`); en `personas`, un rol siempre fallecido no admite
  jurídica.

Un documento, subtarea o concepto que no corresponde al expediente no aparece
en la ficha y no se puede tildar, marcar ni adjuntar (`validacion`: "No
existe esa subtarea en la plantilla" / "No existe ese documento en la
plantilla").

### 14.2 Personas jurídicas

`expediente_personas` suma `tipo_persona` (`fisica` | `juridica`),
`razon_social` y `cuit` (migración `20261020120000_personas_juridicas`). La
base exige: una física con apellido y nombres, sin razón social ni CUIT; una
jurídica con razón social y CUIT válido (`f_cuit_valido`: 11 dígitos y
verificador), sin apellido, nombres, DNI ni fallecimiento; la supresión (Ley
25.326) borra también razón social y CUIT y conserva el tipo. El tipo no cambia
con un UPDATE: la edición inserta una versión nueva (es un cambio
identificatorio).

- Alta y edición: `PersonaEntrada.tipo`, `razonSocial`, `cuit` (ver 3).
  `FormularioEdicion.valores.personas[]` trae `tipo`, `razonSocial` y `cuit`.
- Ficha, carátula e historial: `tipo`, `razonSocial` y `cuit` en cada
  persona. Para mostrar: `nombreCompleto(p)` (la razón social si la hay) y
  `documentoDePersona(p)` ("DNI 30.111.222" o "CUIT 30-99999013-0") de
  `@/lib/presentacion/textos`.
- Búsqueda: la razón social y el CUIT entran en `busqueda`; un número de 11
  dígitos busca también `expediente_personas.cuit` (coincidencia
  `{ campo: "cuit", etiqueta: "CUIT del titular" }`). `titular` de la fila del
  buscador y de la bandeja es la razón social si es jurídica.
- Enmascarado: sin cambios. El contacto de una jurídica (teléfono, correo,
  domicilio) se enmascara igual; la razón social y el CUIT no.

### 14.3 Nomenclatura

`camposUbicacion[].ayuda` (opcional). Los valores se siguen guardando en
mayúsculas, así que una letra o un romano dan la misma `ubicacion_clave` como
sea que se tipeen ("iv" = "IV").

### 14.4 DIM omitible (plantilla b)

Sin cambios de API: el paso `DIM` de `RENOV_PLAN` es `omitible`, así que desde
`TRIBUTARIO` `validarPase().destinos` trae `ADM_TITULO` con
`tipo: "omitiendo"` y `requiereMotivo: true`. El circuito que contó la
Dirección (DIM → devolución a Tributario "no abonó" → pase a `ADM_TITULO`
salteando la DIM) está en `tests/integracion/pases.test.ts`.

## 15. Semana 4: estados, correcciones, plazo DIM, transcripción, panel y CSV

El dominio de la semana 4 (propuesta, 3.1, 2.13(a) a (c), 3.6 y sección 5),
con sus pantallas en la sección 16. Todo está en `expedientes`
(`servidor.ts`); los módulos son `estados.ts`, `correcciones.ts`,
`reconstruccion.ts` (puro), `transcripcion.ts`, `nota.ts`, `plazos.ts`,
`panel.ts`, `exportar.ts` y `feriados.ts`. Las acciones siguen las reglas de
12.1 (comando, `versionVista`, idempotencia, `conflicto_version`, recepción
implícita, `version + 1`) y tiran, como antes, `ErrorDominio` y
`PermisoDenegado`. **No hubo cambios de esquema**: no hay migración nueva.

### 15.1 Estados (3.1)

| Función | De → A | Quién (`PermisoDenegado.motivo` si no) | Exige |
|---|---|---|---|
| `concluir(usuario, numero, versionVista, comandoId, { fechaEfectiva?, observacion? })` | en trámite / espera DIM → concluido | operador del área responsable del **último paso** (`no_es_paso_final`, `carga_historica_abierta`) | lo del pase más los documentos y campos con `exigir_al_salir_de: null` (`faltan_requisitos`, como el pase) |
| `archivar(usuario, numero, ubicacionArchivo, versionVista, comandoId, opciones?)` | concluido → archivado | responsable, Mesa de Entradas, admin | `ubicacionArchivo` (hasta 120 caracteres; `DESCONOCIDA` no) |
| `archivarSinConcluir(usuario, numero, { motivo, ubicacionArchivo, fechaEfectiva?, observacion? }, versionVista, comandoId)` | en trámite / espera DIM → archivado | Mesa de Entradas, admin | motivo (10+) y ubicación. Desde un paso externo, el mismo movimiento registra el regreso del papel (`datos.regreso_papel: {fecha, area_id}`) y el área actual pasa a la custodia |
| `desarchivar(usuario, numero, motivo, versionVista, comandoId, opciones?)` | archivado → `estado_previo` | Mesa de Entradas, admin | motivo. Si vuelve a un estado activo, el papel va del archivo al paso en que estaba (recibido si el paso es externo o del área del usuario; si no, sin confirmar) y el plazo se vuelve a cargar |
| `anular(usuario, numero, motivo, versionVista, comandoId, opciones?)` | en trámite / espera DIM → anulado | Mesa de Entradas, admin | motivo |
| `reabrir(usuario, numero, motivo, versionVista, comandoId, opciones?)` | anulado → `estado_previo` | admin | motivo; no depende de que la anulación sea el último movimiento |
| `cambiarUbicacionArchivo(usuario, numero, ubicacion, versionVista, comandoId, { motivo? })` | archivado | responsable, Mesa de Entradas, admin | movimiento `edicion` `{cambios: {ubicacion_archivo: [a, b]}}`; `DESCONOCIDA` solo si ya lo era |

Devuelven `ResultadoEstado`: `{ numero, version, repetido, movimientoId,
recepcionImplicitaId, estado, estadoPrevio, ubicacionArchivo, paso,
areaActual, areaResponsable }`. Todas insertan un movimiento `estado`
(`estado_anterior`, `estado_nuevo`, `paso_origen`, `area_origen_id`) con la
fecha efectiva de las reglas del pase (no retrocede, hasta 30 días). Al salir
de los estados activos el plazo se limpia. En concluido, archivado y anulado
no hay pases ni devoluciones; en archivado y anulado tampoco ediciones,
documentos ni adjuntos: solo notas, retirar adjuntos, correcciones del admin,
desarchivar, reabrir y la ubicación de archivo.

`agregarNota(usuario, numero, texto, versionVista, comandoId, { fechaEfectiva? })`:
nota libre (todos menos Dirección), en cualquier estado; devuelve `{ numero,
version, repetido, movimientoId }`. No dispara la recepción implícita.

### 15.2 Reiniciar con otra plantilla y "archivar y abrir vinculado"

- `reiniciar(usuario, numero, motivo, versionVista, comandoId)` (Mesa de
  Entradas, admin; estados activos): anula con `datos.reinicio = true` y
  devuelve `ResultadoReinicio`, que es `ResultadoEstado` más `precarga`.
- `precargaAlta(usuario, numero, { ip? })`: lo de
  `/expedientes/nuevo?desde=<numero>`. Registra `ver_expediente`
  (`detalle.para = "precargar_alta"`) porque trae el contacto completo.

  ```ts
  { desde: { id, numero, estado, plantilla, tipoTramite, fechaInicio, reiniciable },
    datos: { plantillaId: null, cementerioId, tipoMonumento, ubicacion, padron, numeroMunicipal,
             formaPago, personas /* vigentes, sin id */, datosExtra, documentosRecibidos: [],
             observaciones, fechaInicio /* hoy */, expedienteAnteriorId /* solo si reiniciable */ } }
  ```

  El formulario elige la plantilla nueva (`contextoAlta`), quita las personas
  de roles que esa plantilla no tiene y llama a `alta()` con estos datos.
- `alta()` acepta `expedienteAnteriorId` (string): el anterior tiene que
  existir, estar anulado por un reinicio (`datos.reinicio`) y no tener ya un
  siguiente; si no, `validacion` con ruta `expedienteAnteriorId`. El
  movimiento `alta` guarda `datos.expediente_anterior` y `datos.vinculo`. El
  aviso de duplicados no repite al anterior.
- `archivarYAbrirVinculado(usuario, numero, { motivo, ubicacionArchivo }, datosAlta, versionVista, comandoId)`:
  la caducidad de docs/fuentes, punto 6. En **una** transacción archiva sin
  concluir (`datos.abre_vinculado = true`, sin anular) y da el alta del nuevo
  con `expediente_anterior_id`. Devuelve `{ archivado: ResultadoEstado, nuevo:
  ResultadoAlta }`; un reintento con el mismo comando devuelve lo mismo. Si el
  alta falla, no se archiva nada. Revertir ese archivo con el nuevo abierto no
  se permite. La plantilla de caducidad todavía no existe: el mecanismo se
  probó con una de prueba (`tests/integracion/estados.test.ts`).
- Ficha: `enlaces: { anterior: { numero, estado, plantilla, vinculo } | null,
  siguientes: [...] }`, con `vinculo` `reinicio` o `vinculado` (además de
  `expedienteAnterior` y `expedientesSiguientes`) y la situación `reiniciado`.

### 15.3 Correcciones (2.13(b))

Todas con motivo (10+), `versionVista` y `comandoId`; devuelven
`ResultadoCorreccion`: `{ numero, version, repetido, movimientoId,
corrigeMovimientoId, arrastrados }`. La ficha dice cuáles puede hacer el
usuario sobre cada movimiento: `historial[i].correcciones` (`"revertir"`,
`"fecha"`, `"observacion"`, `"subtarea"`, `"retirar_adjunto"`,
`"purgar_adjunto"`) y `acciones.corregir`.

| Función | Qué hace | Quién |
|---|---|---|
| `revertir(usuario, numero, movimientoId, motivo, …)` | El último movimiento que cambió el expediente (pase, devolución, cambio de estado o subtarea del paso actual), con su recepción implícita y las recepciones y notas posteriores (`arrastrados`). La proyección queda **idéntica** a la de antes. Si ya no es el último: `estado_no_admite` | autor (7 días) o admin |
| `corregirFecha(usuario, numero, movimientoId, fecha, motivo, …)` | Fecha efectiva (`"YYYY-MM-DD"` o `datetime-local`); en un movimiento de ubicación, sin pasar al anterior ni al siguiente. No el alta (se edita la fecha de inicio) ni los adjuntos | autor (7 días) o admin |
| `corregirObservacion(usuario, numero, movimientoId, observacion, motivo, …)` | La observación (la original queda en el historial) | autor (7 días) o admin |
| `corregirSubtarea(usuario, numero, clave, cambio, motivo, …)` | `cambio` es `{ dato }` o `{ hecha: false }`: dato o tilde de una subtarea de un paso cerrado. Si el paso actual mide su plazo con ella (la notificación y la DIM), el plazo la sigue | autor del tilde (7 días) o admin |
| `retirarAdjunto(usuario, numero, adjuntoId, motivo, …)` | Deja de verse; el archivo se conserva. También en archivado y anulado | autor (7 días) o admin |
| `purgarAdjunto(usuario, numero, adjuntoId, motivo, …)` | Ley 25.326: lo retira y borra el archivo del disco después del commit (`AlmacenAdjuntos.borrar`). Nombre, tamaño y sha256 quedan en el movimiento `adjunto` | admin |
| `suprimirPersona(usuario, numero, personaId, motivo, …)` | Ley 25.326: datos personales de esa versión en NULL y `suprimida_en`; la corrección apunta al movimiento que la creó. `busqueda` se rearma | admin |

En archivado y anulado solo corrige el admin, salvo retirar un adjunto propio.
La línea de tiempo: `historial[i].revertido`, `fechaCorregida`,
`observacionCorregida` y `corregidoPor` (los ids de las correcciones). La
reconstrucción (`reconstruirProyeccion`, pura) rehace las columnas del flujo
desde el historial; las correcciones la usan para escribir la proyección, y
los tests comparan con ella la proyección que escribe cada acción.

### 15.4 Plazo DIM (3.6) y feriados

- `ficha.plazo` (y la etiqueta `plazo` de la bandeja, y las filas de plazos
  del panel): `{ desde, diasHabiles, cumplidoEn, vence, faltan, provisorio,
  aniosSinCerrar, semaforo, texto }`. `vence` es `f_sumar_dias_habiles(desde,
  30)`; `faltan`, `f_dias_habiles_entre(hoy, vence)` (negativo: vencido).
  `semaforo`: `sin_iniciar`, `en_termino`, `por_vencer` (ámbar, 5 o menos),
  `vencido` (rojo) o `cumplido` (DIM_PLAN_INICIADO tildada). `provisorio` si
  algún año entre el inicio y el vencimiento no está cerrado en
  `feriados_anios`. `texto`: "vence 30/11 · faltan 3 días hábiles
  (provisorio)". Las situaciones `plazo_por_vencer` y `plazo_vencido` salen
  del semáforo. Al vencer no cambia nada solo.
- Feriados (escribe el admin; la pantalla es de la semana 5):
  `listarFeriados(anio)`, `aniosDeFeriados()`, `guardarFeriado(usuario, {
  fecha, descripcion, ambito, norma? }, motivo?)` (crea o modifica; da de alta
  el año si falta), `quitarFeriado(usuario, fecha, motivo?)`,
  `cerrarAnioFeriados(usuario, anio, motivo?)` y `reabrirAnioFeriados(usuario,
  anio, motivo)` (con motivo obligatorio). Todo queda en `auditoria.cambios`
  por el trigger, con el motivo.

### 15.5 Transcripción histórica (2.13(c))

Solo con `carga_historica` abierta; Mesa de Entradas y admin (permiso
`transcribir`; si la carga no está abierta, `sin_carga_historica`).

- `transcribir(usuario, numero, filas, versionVista)`: cada fila
  `{ comandoId, fecha, precision?, pasoDestino, observacion?, fuente, motivo? }`
  es un `pase` (hacia adelante; `datos.pasos_salteados` con los pasos que la
  ficha no registra) o una `devolucion` (hacia atrás, con `motivo`), con
  `carga_historica` y su `comando_id`. No exige subtareas ni documentos, no
  tiene el límite de 30 días y no retrocede respecto de la fila anterior. El
  lote es una transacción; los errores van en `filas[i].campo`; las filas ya
  registradas vuelven con `repetida: true`. El papel llega recibido (nadie
  confirma en la ficha). Devuelve `{ numero, version, filas: [{ comandoId,
  movimientoId, tipo, repetida, paso }], paso }`.
- `tildarSubtareaHistorica(usuario, numero, clave, dato, { fecha?, fuente, observacion? }, versionVista, comandoId)`:
  una subtarea de un paso recorrido o del actual, con su fecha.
- `transcribirEstado(usuario, numero, { estado, fecha, precision?, fuente, ubicacionArchivo?, motivo? }, versionVista, comandoId)`:
  `estado` es `concluido` (desde el último paso) o `archivado` (desde
  concluido o, con motivo, sin concluir); `ubicacionArchivo` admite
  `DESCONOCIDA`.
- `terminarCargaHistorica(usuario, numero, versionVista, comandoId)`: un
  `edicion` `{cambios: {carga_historica: [true, false]}, historicos:
  {subtareas, documentos}}`; lo obligatorio pendiente de los pasos anteriores
  (de todos, si está concluido) pasa a histórico. `ficha.cargaHistoricaPendiente`
  dice qué pasaría.

### 15.6 Bandejas y panel

- `PESTANAS_BANDEJA` suma `plazos` (lo que está en un paso con plazo y cuya
  custodia es el área; Mesa de Entradas ve todo, con `soloConsulta`; ordenado
  por vencimiento) y `carga_historica` (solo Mesa de Entradas: las cargas
  abiertas, menos las anuladas). `contadoresBandeja` suma `plazos`,
  `plazosAlerta` (ámbar y rojo de la custodia) y `carga_historica`. Con la
  carga histórica abierta, el expediente no está en Por confirmar, En mi área,
  Afuera ni Plazos, no suma al contador del encabezado y no es `demorado`.
- `panel(usuario, { tipoTramiteId?, cementerioId? })` (todos): `conteos` por
  estado, `matriz` área × tipo de trámite (estados activos), `demorados`,
  `plazos.porVencer` y `plazos.vencidos`, `sinConfirmar` (más de 2 días
  hábiles), `diferidos` y `correcciones` del mes, `cargasHistoricas` y
  `avisos` ("Feriados de 2027 sin cerrar"). Todo sin las cargas históricas
  abiertas, salvo su bloque. Las listas traen 50 filas y la cantidad. Cada
  conteo y cada celda traen `busqueda` (`FiltrosBusqueda`); `rutaBusqueda()`
  de `@/lib/presentacion/busqueda` arma la URL. El buscador suma el filtro
  `cargaHistorica` (`historica=1|0` en la URL).

### 15.7 CSV del buscador

`exportarCsv(usuario, { q?, filtros? }, { ip? })` (Dirección y admin):
`{ nombreArchivo, tipo, contenido, filas, truncado }`, hasta 5000 filas, sin
teléfono, correo ni domicilio; separador `;`, CRLF, UTF-8 con BOM y las celdas
que empiezan con `=`, `+`, `-` o `@` neutralizadas. Registra `exportar` en
`auditoria.accesos` (`expediente_id` nulo, `detalle: { formato, q, filtros,
filas, truncado }`). El Route Handler responde con `Content-Disposition:
attachment` y `Cache-Control: private, no-store`.

### 15.8 Lo nuevo en la ficha y en los permisos

- `acciones` suma `concluir`, `archivar`, `archivarSinConcluir`,
  `desarchivar`, `anular`, `reabrir`, `reiniciar`, `cambiarUbicacionArchivo`,
  `nota`, `transcribir`, `suprimirPersona` y `purgarAdjunto` (Decision) y
  `corregir` (boolean). `concluir.faltan` es el "Faltan N" de Concluir.
- Permisos (3.2): `reiniciar_con_otra_plantilla`, `archivar_sin_concluir` y
  `anular`, solo en estados activos; `desarchivar`, solo un archivado;
  `reabrir`, solo un anulado; `concluir`, desde el último paso y sin la carga
  abierta; nuevas `cambiar_ubicacion_archivo` y `transcribir`;
  `corregir_movimiento` en archivado y anulado, solo el admin
  (`ContextoPermiso.retirarAdjunto` deja al autor retirar su adjunto).
  `MotivoDenegacion` suma `no_es_paso_final` y `sin_carga_historica` (con su
  texto en `TEXTO_DENEGACION`).

### 15.9 Pendientes

- La plantilla real de caducidad (y su tipo de trámite): la Dirección no pasó
  el circuito. "Archivar y abrir vinculado" ya funciona con cualquier
  plantilla publicada.
- La pantalla de feriados: hecha en la semana 5 (`/admin/catalogos?pestana=feriados`, sección 18). Las demás están hechas: sección 16.

## 16. Las pantallas (semana 4)

| Ruta | Qué llama |
|---|---|
| `/expedientes/[numero]` | `obtenerFicha` (y `opcionesAlta` si puede reiniciar o abrir un vinculado). Barra "Estado del expediente" según `ficha.acciones` (`botonesEstado()`): Concluir (con "Faltan N" de `ficha.concluir.faltan`, como el pase), Archivar, Archivar sin concluir (desde un paso externo, con la fecha en que volvió el papel; vuelve a la custodia), Archivar y abrir vinculado, Desarchivar, Cambiar ubicación de archivo, Reabrir, Reiniciar con otra plantilla, Anular y Agregar nota. Plazo DIM con semáforo en la cabecera y en el recorrido. "Reinicio de / Reiniciado en" y "Vinculado a / Sigue (vinculado) en" con `ficha.enlaces`. En el historial, el menú "Corregir" de cada movimiento con `correcciones`; Suprimir datos en cada persona (admin) |
| `/expedientes/nuevo?desde=<numero>&plantilla=<id>` | `precargaAlta` (cementerio fijo, el del anterior), `contextoAlta`; el formulario abre con `valoresDesdePrecarga()` y manda `expedienteAnteriorId` si el anterior es `reiniciable`. Aviso "Reinicio de CEM-…" (y qué roles no pasan) |
| `/expedientes/[numero]/transcribir` | `obtenerFicha` (`acciones.transcribir`, `cargaHistoricaPendiente`). Arriba lo ya transcripto (los movimientos con `cargaHistorica` y el alta); la grilla (`accionTranscribir` → `transcribir`), las subtareas de los pasos recorridos (`accionSubtareaHistorica`), "Cómo terminó según la ficha" (`accionEstadoHistorico`, con "No se sabe" = `DESCONOCIDA`), la foto de la ficha (el Route Handler de adjuntos, suelto, con el nombre "Ficha de papel - …") y "Terminar carga histórica" con confirmación (`accionTerminarCarga`, vuelve a la ficha) |
| `/bandeja?pestana=plazos` y `?pestana=carga_historica` | `bandeja` y `contadoresBandeja`. Plazos: columna Vencimiento con semáforo, texto y "provisorio"; la pestaña aparece si hay algo (`contadores.plazos`) y muestra aparte cuántos están en ámbar o rojo (`plazosAlerta`). Carga histórica: solo Mesa de Entradas, con "Transcribir" en cada fila (`pestanasVisibles()`) |
| `/panel?tramite=&cementerio=` | `panel` y `opcionesBusqueda`. Cada conteo, celda y lista con `busqueda` es un enlace a `rutaBusqueda()`; las filas van a la ficha y los movimientos (diferidos, correcciones) a `#mov-<id>`. Imprimible (`@media print`: sin encabezado ni filtros) |
| `GET /expedientes/exportar?<los filtros del buscador>` | `exportarCsv`. 200 `text/csv; charset=utf-8` con `Content-Disposition: attachment; filename="expedientes-AAAA-MM-DD.csv"`, `Cache-Control: private, no-store`, `X-Filas` y `X-Truncado`; 401 sin sesión, 403 sin permiso, 422 con filtros inválidos (texto plano). El botón "Exportar CSV" del buscador (Dirección y admin) lleva los mismos parámetros (`rutaExportarDesde()`) |

- **Server Actions** (en `src/app/(app)/expedientes/acciones.ts`, lógica en
  `src/lib/presentacion/acciones-estados.ts`, probada en
  `tests/integracion/pantallas-semana4.test.ts`): `accionEstado` (`accion`:
  `concluir`, `archivar`, `archivar_sin_concluir`, `desarchivar`, `anular`,
  `reabrir`, `ubicacion_archivo`), `accionNota`, `accionCorreccion` (`tipo`:
  `revertir`, `fecha`, `observacion`, `subtarea_dato`, `subtarea_destildar`,
  `retirar_adjunto`, `purgar_adjunto` con `confirmado: true`),
  `accionSupresion` (con `confirmado: true`), `accionTranscribir`,
  `accionSubtareaHistorica`, `accionEstadoHistorico`: como las del flujo,
  `{ ok, version, repetido, mensaje }` o el `EstadoError`, y `refresh()`.
  `accionReiniciar`, `accionVinculado` y `accionTerminarCarga` navegan con
  `redirect()` (al alta precargada, a la ficha del nuevo, a la ficha) y solo
  devuelven algo si hay error.
- **"Archivar y abrir vinculado"** arma el alta del nuevo en el servidor:
  `precargaAlta` + `contextoAlta` de la plantilla elegida +
  `datosAltaVinculado()` (`src/lib/presentacion/formulario.ts`: quita las
  personas de roles que la plantilla no tiene, lo que el cementerio o la
  plantilla no piden y los documentos; la fecha de inicio es hoy). Si el alta
  no valida, el diálogo muestra los errores y no se archiva nada.
- **Correcciones**: `menuCorreccion()` ordena y rotula lo que dice
  `historial[i].correcciones` (la de subtarea se parte en "Corregir el dato" y
  "Destildar"); `movimientoCorregible()` arma lo que el diálogo precarga (la
  fecha y la observación que valen). La línea de tiempo marca "Revertido",
  tacha lo corregido (o solo la fecha u observación original) y enlaza cada
  movimiento con su corrección (`#mov-<id>`) y al revés; `resumenCorreccion()`
  dice qué hizo cada una. Purgar y suprimir piden una casilla de
  confirmación explícita.
- **Semáforo**: `mostrarPlazo()` (`src/lib/presentacion/estados.ts`): etiqueta
  y color (ámbar por vencer, rojo vencido; el texto siempre acompaña al
  color), el `texto` del dominio con mayúscula y, si es provisorio, qué años
  de feriados faltan cerrar.
- **Grilla de transcripción** (`src/lib/presentacion/transcripcion.ts`): cada
  fila tiene su `comandoId` desde que se agrega (un reintento no repite
  filas); `recorrerFilas()` dice si es pase o devolución (motivo) respecto de
  la fila anterior; `loteParaEnviar()` saltea las vacías;
  `erroresDeGrilla()` lleva `filas[i].campo` a la celda. Teclado: Tab recorre
  la fila, Enter baja (en la última agrega una), Mayús+Enter sube y
  Ctrl+Enter registra el lote.
- **Cambio en el dominio** (mínimo, con test en `correcciones.test.ts`): la
  ficha calcula `enAreaDesdePrecision` y `recibidoEnPrecision` con la fecha
  corregida si la hubo (antes, un pase corregido a "solo el día" mostraba
  "00:00").
- **Piezas comunes**: `Pie`, `Motivo`, `Observacion` y `motivoCorto` pasaron
  de `flujo/dialogos.tsx` a `flujo/piezas.tsx`; `useAccesoFaltante` y
  `dialogoDeVuelta` (volver al pase o a concluir después de resolver un
  faltante) están en `flujo/estado.ts`. `BotonImprimir` está en
  `src/components/`.

## 17. Semana 5: la administración (`@/lib/dominio/admin`)

Plantillas, usuarios, catálogos y auditoría: todo exige el permiso
`administrar` (solo el admin, 3.2) y tira `PermisoDenegado` si no. Como el de
expedientes, el servicio recibe sus dependencias: la app usa `admin` de
`@/lib/dominio/admin/servidor` (cliente global y `conActor()`); los tests,
`crearServicioAdmin({ leer, escribir, ahora? })`. `leer` es un `LectorAdmin`
(el `Lector` de expedientes más `auditoriaCambio` y `auditoriaAcceso`), y las
lecturas van en serie (`enSerie`), nunca con `Promise.all`: el lector puede ser
un `tx`. Toda escritura queda en `auditoria.cambios` por el trigger
`auditar_cambio`, con el motivo (o las notas de cambio) como `motivo`.

**Idempotencia.** Las acciones de la administración describen el estado al que
se quiere llegar (publicada, activo o no, tal área y rol, tal nombre), así que
repetirlas no hace nada nuevo y devuelven `repetido: true`. Por eso no llevan
`comandoId` ni hace falta una columna para guardarlo: las altas tienen clave
natural (código, CUIL, fecha) y un segundo pedido igual se reconoce.

**Errores nuevos** (`CodigoErrorDominio`): `ya_existe` (código, CUIL o versión
repetidos) y `en_uso` (lo que se quiere borrar, renombrar o desactivar está en
uso: una clave de ubicación con valores, un área con usuarios o en una
plantilla publicada, el último administrador activo). Los rechazos de los
triggers de coherencia (`usuarios_area_interna`, `cementerios_area_externa`,
`areas_tipo_coherente`) y de los índices únicos se controlan antes, con un
mensaje propio; si igual llegan (dos administradores a la vez),
`traducirErrorBase()` los devuelve como `validacion` o `ya_existe` con el
mensaje legible (sin ids internos).

### 17.1 Plantillas (2.5, 2.13(a))

| Función | Qué hace |
|---|---|
| `catalogoPlantillas(usuario)` | Una fila por código: `nombre`, `tipoTramite`, `publicada` y `borrador` (`{ version, enCurso, total, … }`) y `versiones[]` con los expedientes en curso (en trámite o en espera de pago) y totales de cada una |
| `catalogosEditor(usuario)` | Áreas (con tipo, activa y recibe pases), cementerios (con su área y monumentos), tipos de monumento y de trámite, para las listas del editor |
| `obtenerVersion(usuario, codigo, version)` | La versión con `estado`, notas, quién y cuándo, `definicion` **con la forma completa** (`definicionEditable`, aunque sea un borrador a medio hacer), `huella` y las demás versiones. `no_encontrado` si no existe |
| `crearPlantilla(usuario, { codigo, tipoTramiteId, nombre })` | "Nueva": borrador v1 con `definicionInicial()` (un titular vivo, sin pasos). `ya_existe` si el código existe |
| `editarPlantilla(usuario, codigo)` | "Editar": borrador `max + 1` copiando la publicada (o, si se retiró, la última). Si ya hay borrador, lo devuelve (`repetido`) |
| `guardarBorrador(usuario, codigo, version, { nombre, definicion }, huella)` | Guarda aunque no valide; `{ huella, repetido, pendientes }` (`pendientes`: cuántos errores de Publicar quedan). `conflicto_version` si otro guardó en el medio (la huella no coincide), `estado_no_admite` si no es borrador |
| `validarBorrador(usuario, { nombre, definicion })` | Los errores de "Publicar" (`validarPublicacion`, contra los catálogos actuales) para lo que está en pantalla; no escribe. `{ ok, errores: [{ ruta, mensaje }] }` |
| `publicarBorrador(usuario, codigo, version, contenido, huella, notas)` | En una transacción: guarda el contenido, valida esquema e integridad, retira la publicada y publica el borrador con `notas_cambio` (10 caracteres o más, `motivo_requerido`). Si no valida: `validacion` con `errores` por ruta y nada cambia. `{ retirada: n \| null }` |
| `descartarBorrador(usuario, codigo, version)` | Borra el borrador (solo borradores) |
| `retirarPlantilla(usuario, codigo, version, motivo)` | La publicada pasa a retirada (con motivo): el trámite deja de ofrecerse en el alta; los expedientes en curso siguen |

- **Borradores** (`@/lib/dominio/plantillas/borrador`, puro):
  `definicionEditable(valor)` lleva cualquier valor a la forma de
  `DefinicionPlantilla` (completa lo que falta, descarta claves desconocidas;
  una definición publicada no cambia) y `definicionInicial()`. Un filtro "Solo
  en…" sin cementerios se conserva como `[]` para que Validar lo marque.
- **Huella**: `huellaBorrador(nombre, definicion)` (sha256 del JSON con las
  claves ordenadas, porque jsonb no conserva el orden). Guardar o publicar lo
  mismo que ya está no compara la huella (un doble clic no da conflicto).
- **Rutas de los errores**: las de `validar.ts` y del esquema
  (`pasos[2].custodia`, `documentos[0].solo_cementerios[1]`, `personas`,
  `nombre`). El editor las lleva a su pestaña y a su campo.
- **Expedientes en curso**: conservan su `plantilla_id` y siguen con su
  versión (la ficha dice "· v1 (hay v2)"); el alta ofrece solo la publicada y
  una versión retirada da `plantilla_no_publicada`. Probado con una v2 de
  RENOV_CONTADO en `tests/integracion/admin-plantillas.test.ts`.

### 17.2 Usuarios (2.4)

| Función | Qué hace |
|---|---|
| `listarUsuarios(usuario)` | `{ usuarios, areas, adminsActivos }`: todos menos SISTEMA (activos primero), con área, rol, activo y último ingreso; `areas` son las internas activas (las asignables) |
| `altaUsuario(usuario, { cuil, nombre, apellido, email?, areaId, rol }, motivo?)` | CUIL con o sin guiones, con dígito verificador (`cuilValido`); área interna y activa, obligatoria salvo para el admin. `ya_existe` si el CUIL tiene usuario (dice si está inactivo). Desde el 27/10/2026 devuelve `claveTemporal` (sección 22) y el correo no puede repetir el de otro usuario |
| `cambiarAccesoUsuario(usuario, id, { areaId, rol }, motivo?)` | Rige en el request siguiente (la sesión relee área y rol). No el propio rol |
| `desactivarUsuario(usuario, id, motivo?)` | `activo = false` y `sesion_version + 1`: la cookie que tenía deja de valer en el request siguiente (`usuarioDeSesion`). No a uno mismo |
| `reactivarUsuario(usuario, id, motivo?)` | Vuelve a activo (las sesiones viejas siguen sin valer). Si su área ya no es asignable, `validacion` |
| `blanquearClave(usuario, id, motivo, { ip? })` | 27/10/2026, sección 22.5: contraseña temporal nueva, `debe_cambiar_clave`, cierra sus sesiones y lo desbloquea. Motivo obligatorio. No a uno mismo |
| `desbloquearUsuario(usuario, id, motivo?, { ip? })` | 27/10/2026, sección 22.5: levanta el bloqueo por intentos fallidos. `repetido` si no estaba bloqueado |

**El último administrador**: desactivar a un admin o quitarle el rol bloquea
las filas de los administradores activos (`FOR UPDATE`) y exige que quede otro
(`en_uso`). Así, dos administradores que se desactivan uno al otro a la vez se
serializan y el segundo recibe el error.

### 17.3 Catálogos (2.1 a 2.3, 2.13(d))

| Función | Qué hace |
|---|---|
| `listarCatalogos(usuario)` | Áreas (con usuarios activos, su cementerio y las plantillas publicadas que la usan), cementerios (campos de ubicación, monumentos, `clavesUsadas` con cuántos expedientes tienen cada clave), tipos de monumento (en qué cementerios) y tipos de trámite (sus plantillas) |
| `guardarArea(usuario, { id?, codigo, nombre, tipo, recibePases, activa, orden }, motivo?)` | Sin `id`, alta. El código no cambia. Externa ⇒ recibe pases. No se desactiva con usuarios activos, si es la de un cementerio activo o si la usa una plantilla publicada; no pasa a externa con usuarios ni a interna si es de un cementerio (`en_uso`, con el detalle en `errores`) |
| `guardarCementerio(usuario, { id?, codigo, nombre, areaId, activo, camposUbicacion, tiposMonumento }, motivo?)` | Área externa y libre; monumentos que existen; campos de ubicación válidos (`controlarCamposUbicacion`): claves únicas, patrones que compilan, y **una clave con valores no se borra, no se renombra ni cambia de tipo** (`en_uso`): se desactiva |
| `guardarTipoMonumento` / `guardarTipoTramite(usuario, { id?, codigo, nombre, activo }, motivo?)` | Alta o modificación; el código no cambia |

Los **feriados** siguen en el servicio de expedientes (15.4): la pestaña los usa
tal cual (`listarFeriados`, `aniosDeFeriados`, `guardarFeriado`,
`quitarFeriado`, `cerrarAnioFeriados`, `reabrirAnioFeriados`).

### 17.4 Auditoría (2.10)

| Función | Qué hace |
|---|---|
| `opcionesAuditoria(usuario)` | Usuarios (también SISTEMA), acciones y tablas para los filtros |
| `listarAccesos(usuario, { usuarioId?, numero?, accion?, desde?, hasta?, pagina? })` | `auditoria.accesos`, del más nuevo al más viejo, de a 50 (`POR_PAGINA`): `{ filas, total, pagina, paginas }`. Cada fila trae usuario, acción, expediente (número), `motivo` (el de "Ver datos completos") y `detalle`. `numero` acepta la forma corta; uno que no existe da la lista vacía. Fechas `YYYY-MM-DD` de Tucumán, inclusive |
| `listarCambios(usuario, { tabla?, usuarioId?, desde?, hasta?, pagina? })` | `auditoria.cambios` con `registro` ("RENOV_CONTADO v2", "CUIL …", "Año 2026"), `operacionEtiqueta` y `diferencias: [{ campo, etiqueta, antes, despues }]` legibles (`diferenciasCambio`: áreas y usuarios por nombre, fechas en hora de Tucumán, la definición resumida en cantidades) |
| `exportarAuditoria(usuario, { vista, filtros }, { ip? })` | CSV de lo filtrado (hasta 5000 filas, como el del buscador: `;`, CRLF, BOM) y registra `exportar` con `detalle: { formato, origen: "auditoria", vista, filtros, filas, truncado }` |

Mirar la auditoría no se registra; exportarla sí.

## 18. Las pantallas (semana 5)

| Ruta | Qué llama |
|---|---|
| `/admin` | `catalogoPlantillas` y `aniosDeFeriados`: las cuatro secciones y lo pendiente (borradores, años sin cerrar). El layout de `/admin/*` agrega el menú Plantillas · Usuarios · Catálogos · Auditoría (`SECCIONES_ADMIN` de `@/lib/dominio/navegacion`) |
| `/admin/plantillas` | `catalogoPlantillas`, `catalogosEditor`. Nueva (diálogo), Editar (`accionEditarPlantilla`, navega al borrador) y Retirar (diálogo con motivo) |
| `/admin/plantillas/[codigo]/v/[version]` | `obtenerVersion`, `catalogosEditor`. El editor (`editor.tsx`, con pestañas General, Personas, Pasos, Documentación, Conceptos, Campos extra y Vista previa) o el visor (los mismos controles deshabilitados). Guardar borrador (Ctrl+S), Validar, Publicar (con notas) y Descartar |
| `/admin/usuarios` | `listarUsuarios`. Alta por CUIL, Área o rol, Desactivar y Reactivar en diálogos |
| `/admin/catalogos?pestana=areas\|cementerios\|monumentos\|tramites\|feriados&anio=` | `listarCatalogos`; en Feriados, `aniosDeFeriados` y `listarFeriados`. Alta y modificación en diálogos; Cerrar año y Reabrir año (con motivo) |
| `/admin/auditoria?vista=accesos\|cambios&usuario=&expediente=&accion=&tabla=&desde=&hasta=&pagina=` | `opcionesAuditoria` y `listarAccesos` o `listarCambios`. Los filtros viven en la URL (`@/lib/presentacion/auditoria`) |
| `GET /admin/auditoria/exportar?<los mismos parámetros>` | `exportarAuditoria`: 200 `text/csv` attachment (`auditoria-<vista>-AAAA-MM-DD.csv`), 401 sin sesión, 403 sin permiso, 422 con filtros inválidos |

- **Server Actions** en `src/app/(app)/admin/acciones.ts`; la lógica en
  `src/lib/presentacion/acciones-admin.ts` (probada en los tests de
  integración `admin-*.test.ts`): `procesarNuevaPlantilla`,
  `procesarEditarPlantilla`, `procesarGuardarBorrador`,
  `procesarValidarBorrador`, `procesarPublicar`, `procesarDescartar`,
  `procesarRetirar`, `procesarUsuario` (`accion`: `alta`, `acceso`,
  `desactivar`, `reactivar`), `procesarCatalogo` (`catalogo`: `area`,
  `cementerio`, `tipo_monumento`, `tipo_tramite`) y `procesarFeriado`
  (`accion`: `guardar`, `quitar`, `cerrar`, `reabrir`; `sin_cambios` cuenta
  como repetido). Las que cambian lo que se ve llaman a `refresh()`; Nueva,
  Editar, Publicar y Descartar navegan con `redirect()`.
- **El editor** (`src/lib/presentacion/editor-plantilla.ts`, puro, con
  tests): las operaciones sobre la definición (agregar, quitar y mover pasos,
  subtareas, roles, documentos, conceptos y campos; `cambiarPaso` vacía la
  custodia al elegir un área interna; `cambiarCampoExtra` pone o quita las
  opciones), `renombrarClave` (rechaza una clave que ya usa otro elemento y
  renombra las referencias: `exigir_al_salir_de`, `conceptos[].paso`, el
  plazo, `$CAMPO:x`, `solo_si_juridica`), los filtros por cementerio,
  `pestanaDeRuta` / `erroresPorPestana` / `rutasAncestras` /
  `ubicacionDeRuta` (cada error a su pestaña, a su campo y en palabras en el
  resumen) y `vistaPrevia` (la plantilla resuelta con `resolverPorCementerio`
  para cada cementerio, con lo que el filtro saca). El `id` de cada control es
  `idDeCampo(ruta)`: el resumen de errores enfoca el campo (o el elemento más
  cercano) y abre su paso. Las claves se aplican al salir del campo. Mover o
  quitar limpia los errores (sus rutas cambian) y pide volver a validar.
- **Teclado**: las pestañas con ← → Inicio Fin; cada paso es un `<details>`
  (Enter o Espacio); ↑ ↓ y Quitar con el nombre del elemento para el lector de
  pantalla, y el foco sigue al elemento movido; los diálogos son `<dialog>`
  nativos (Escape cierra).

## 19. El historial: cadena de hash, filtros y agrupación (26/10/2026)

Dos frentes sobre el historial. **Integridad**: la cadena de hash que la
propuesta dejaba para la fase 2 (sección 8; Tramita Capital, otro sistema de
la Dirección, ya tiene sus fojas encadenadas). **Legibilidad**: la línea de
tiempo de la ficha con filtros y agrupada por paso, con los días hábiles en
cada área. Sin cambios de reglas de negocio ni de permisos.

### 19.1 La cadena (migración `*_cadena_hash`)

Cada movimiento lleva dos columnas nuevas, `hash` y `hash_anterior` (texto,
hex en minúsculas de SHA-256; en `schema.prisma` como `String?` para que
Prisma no las pida al crear, y un CHECK las exige). Las fija el trigger
`movimientos_sellar`, bajo el mismo `FOR UPDATE` del expediente que ya
serializaba la secuencia: `hash_anterior` es el `hash` del movimiento
anterior del expediente (por secuencia) y, en el primero,
`f_hash_inicial(numero_interno)`; `hash` es `f_hash_movimiento(fila)`. Lo
que mande la app en esas columnas se pisa. SHA-256 con `sha256()`, nativa de
PostgreSQL 15: no hace falta pgcrypto ni otra extensión.

| Función | Qué hace |
|---|---|
| `f_hash_inicial(numero_interno) → text` | SHA-256 de `cementeria-inicio-v1\|<número interno>`, en hex: el "anterior" del primer movimiento. Ata la cadena al número que figura en el papel |
| `f_hash_movimiento(m movimientos) → text` | El hash de una fila, sobre una lista **explícita** de campos (no `to_jsonb` de la fila): ver abajo |
| `f_verificar_cadena(expediente bigint) → (integra, movimientos, hash_final, secuencia_rota, motivo)` | Recorre los movimientos por secuencia y devuelve la primera rotura: `secuencia_faltante` (un movimiento borrado), `hash_anterior_distinto` (no encadena con el anterior), `hash_distinto` (cambió algún campo) o `sin_movimientos`. Solo lee |

**Formato canónico (v1)**, en UTF-8: `cementeria-mov-v1|c1|c2|…|c22`, donde
cada campo es `-` si es NULL y `<largo>:<valor>` si no (largo en caracteres:
un texto con `|` o un `-` no es ambiguo). Campos, en orden: `expediente_id`,
`secuencia`, `tipo`, `fecha_efectiva`, `precision_fecha`, `registrado_en`,
`usuario_id`, `area_usuario_id`, `paso_origen`, `paso_destino`,
`area_origen_id`, `area_destino_id`, `estado_anterior`, `estado_nuevo`,
`observacion`, `motivo`, `datos::text`, `corrige_movimiento_id`,
`carga_historica` (`true`/`false`), `fuente`, `comando_id`, `hash_anterior`.
Las fechas, en UTC con microsegundos (`2026-10-26T15:04:05.123000Z`), con
`AT TIME ZONE 'UTC'` explícito: el hash no depende de la zona de la sesión (la
app escribe en UTC y psql en hora de Tucumán). `datos::text` es el texto de
`jsonb`, que PostgreSQL escribe siempre igual para el mismo valor.
`tests/integracion/cadena.test.ts` lo vuelve a calcular en TypeScript a
partir de esta descripción: es lo que haría un verificador externo.

**Backfill**: la migración encadena los movimientos que ya existían, por
expediente y en orden de secuencia, con `movimientos_inmutables`
deshabilitado **solo** dentro de su transacción (DDL del owner, que queda en
el log; no hay producción todavía) y vuelto a `ENABLE ALWAYS` al terminar.
Después agrega el CHECK `movimientos_hash_check` (los dos presentes y hex de
64).

**Qué detecta y qué no.** Un UPDATE o DELETE hecho por un superusuario
saltando los triggers deja la cadena rota en el primer movimiento tocado. La
función de hash es pública y sin clave: quien pueda reescribir el historial
también puede recalcular la cadena desde ahí, o borrar los últimos
movimientos. Eso se ve comparando el hash final con una copia fuera de la
base: la **huella** impresa en la carátula y el historial (los 16 primeros
caracteres del hash del último movimiento) y, pendiente de la fase 2, el
export nocturno firmado (HMAC) de las cabezas de cada cadena.

`auditoria.accesos` suma la acción `verificar_historial` (CHECK y
`ACCIONES_ACCESO` de la auditoría: "Verificó el historial").

### 19.2 El dominio (`@/lib/dominio/expedientes/integridad`)

```ts
interface ResultadoIntegridad {
  numero: string; integra: boolean; movimientos: number;
  hashFinal: string | null;      // el hash guardado del último movimiento
  huella: string | null;         // sus primeros LARGO_HUELLA (16) caracteres: lo impreso
  secuenciaRota: number | null; motivo: MotivoRotura | null;
}
```

| Función | Permiso | Qué hace |
|---|---|---|
| `expedientes.verificarIntegridad(usuario, numero, { ip? })` | El de ver la ficha (`ver_expediente`) | `f_verificar_cadena` del expediente. Registra `verificar_historial` con `detalle: { alcance: "expediente", integra, movimientos, hash_final, secuencia_rota, motivo }`. Una cadena rota es un resultado, no un error. Errores: `no_encontrado` |
| `expedientes.verificarIntegridadTodos(usuario, { ip? })` | `administrar` (admin) | Todos los expedientes: `ResumenIntegridad` (`expedientes`, `integros`, `movimientos`, `rotos[]`, `verificadoEn`). Registra `verificar_historial` sin expediente, con `alcance: "todos"`, `origen: "admin"` y los rotos (hasta 50) |
| `verificarCadenas(lector)` | — | Lo mismo sin permisos ni registro (una consulta, fuera de `conActor()`: puede tardar más que su límite) |
| `verificarIntegridadNocturna(deps)` | — | La del script nocturno: como `verificarIntegridadTodos`, firmada por SISTEMA, con `origen: "nocturna"` |

`datosCaratula()` y `datosHistorial()` suman `integridad: ResultadoIntegridad`
(la huella al emitir y si la cadena estaba íntegra), y `datosHistorial()`,
`tramos` (19.3).

**`npm run historial:verificar`** (`scripts/verificar-historial.ts`; en el
paquete, `scripts/verificar-historial.mjs`, sin tsx): verifica todos los
expedientes con `DATABASE_URL` y lo registra como SISTEMA. Una línea JSON
(`historial.verificado`, o `historial.roto` con el número, el movimiento y el
motivo de cada roto). Sale con 0 si todo está íntegro, 1 si hay alguno roto y
2 si no pudo verificar. Con `-- --sin-registro` no escribe en la auditoría. En
producción lo dispara el timer `cementeria-historial` a las 03:30
(docs/despliegue.md); en Vercel, `GET /api/cron/historial` (Vercel Cron, 06:30
UTC, con `CRON_SECRET`; 500 si hay alguno roto; docs/despliegue-vercel.md). `npm run db:verificar-restauracion` suma el control
`cadena`.

### 19.3 Agrupación por paso (`./tramos.ts`)

`ficha.tramos` (y `hoja.tramos` del historial impreso): el historial partido
en **tramos**, lo que pasó mientras el papel estuvo en un paso y un área.

```ts
interface TramoHistorial {
  orden: number;                          // 1, 2, 3…
  paso: { clave, nombre } | null; area: { codigo, nombre } | null;
  desde: Date; desdePrecision; hasta: Date | null; hastaPrecision;  // hasta null: sigue ahí
  actual: boolean;                        // el último, con el expediente activo
  diasHabiles: number | null;             // f_dias_habiles_entre(desde, hasta u hoy), días de Tucumán
  movimientos: string[];                  // ids, en el orden de `historial`
}
```

Abre un tramo el alta, cada pase y cada devolución, y un cambio de estado que
lleva el papel a otra área o paso (el regreso del papel, desarchivar). Lo
revertido no abre tramo (queda tachado en el tramo en que se registró) y vale
la fecha corregida. El último tramo de un expediente concluido, archivado o
anulado termina con ese cambio de estado. `agruparEnTramos()` es pura (tests
en `tramos.test.ts`); `contarDiasHabiles()` hace una sola consulta.

### 19.4 Las pantallas

- **Ficha, bloque Historial** (`historial-filtrable.tsx`, componente de
  cliente; los movimientos llegan armados del servidor con `ItemMovimiento` y
  su menú "Corregir"): filtra en el navegador, sin recargar. Atajos **Todo** y
  **Solo lo importante** (pases y devoluciones, con el alta y las
  recepciones, y estados) y un botón por tipo (Pases y devoluciones,
  Subtareas, Documentos, Adjuntos, Ediciones, Estados, Notas, Correcciones,
  con su cantidad; solo los que hay), todos con `aria-pressed`; **Paso** (un
  `<select>` con los pasos por los que pasó) y **Agrupar por** Paso (título
  del tramo, "Del … al … · N días hábiles" o "Desde el … · N días hábiles
  hasta hoy", y "Está acá" en el actual) o Día. Un historial de más de 15
  movimientos (`HISTORIAL_LARGO`) abre en "Solo lo importante". "Se ven N de
  M movimientos" va en una región viva (`aria-live`, sin `role="status"`: el
  `status` de la ficha es el aviso de la última acción, y las pruebas lo
  buscan así). Lo filtrado queda en la página con
  `hidden`: los enlaces "Corrige…" y "Corregido por…" siguen funcionando, y el
  movimiento al que apunta la dirección (`#mov-…`) se muestra aunque el filtro
  lo oculte. La lógica pura (categorías, atajos, títulos de tramo, texto de la
  integridad) está en `@/lib/presentacion/historial`.
- Cada movimiento sigue con su fecha efectiva (y la original tachada si se
  corrigió), tipo, área de quien lo cargó, precisión ("fecha sin hora"),
  fuente, autor, y lo revertido o corregido tachado y enlazado. La fecha de
  registro aparece cuando no es la misma que se ve como efectiva ("Cargado el
  … por J. Pérez"); si coincide, "Cargado por J. Pérez".
- **"Verificar integridad"** (botón en el título del bloque,
  `verificar-integridad.tsx`; Server Action `verificarIntegridad` →
  `procesarIntegridad` de `@/lib/presentacion/acciones`): muestra "Historial
  íntegro: N movimientos." con el hash del último (la huella resaltada), o "La
  cadena del historial está rota: el movimiento N …", en una región viva
  (`aria-live`).
- **Imprimibles**: el historial va agrupado por tramo (títulos `h2`, con los
  días hábiles) y los dos llevan al pie la **huella** ("Huella del historial:
  `3fa2b9c01d4e5f67` (hash del movimiento 23, el último registrado al
  emitir)"; con la cadena rota, el aviso). Los filtros no salen en papel.

## 20. Métricas de gestión (`@/lib/dominio/metricas`, 26/10/2026)

El panel (15.6) dice qué hay que mirar hoy; las métricas dicen cómo viene
funcionando el circuito: tiempos antes y con el sistema, volumen, carga y
cuellos de botella. Pantalla `/panel/metricas` (Dirección y admin, permiso
nuevo `ver_metricas`); dominio en `src/lib/dominio/metricas/`, sin cambios de
esquema ni de reglas de negocio. Como los demás servicios recibe sus
dependencias: la app usa `metricas` de `@/lib/dominio/metricas/servidor`; los
tests, `crearServicioMetricas({ leer, escribir, ahora?, papel? })` (`escribir`
solo registra la exportación).

| Función | Qué hace |
|---|---|
| `metricas(usuario, filtros?)` | `Metricas` (20.3). Los filtros que falten van por defecto. `PermisoDenegado` si no es Dirección ni admin; `ErrorDominio` `validacion` con un período inválido (al revés, en el futuro, de más de 3 años, o más de 26 semanas por semana), con `errores[0].ruta` (`desde`, `hasta`, `agrupar`) |
| `exportarCsv(usuario, filtros, tabla, { ip? })` | Una tabla como CSV (`;`, CRLF, UTF-8 con BOM, como el del buscador): `{ nombreArchivo: "metricas-<tabla>-AAAA-MM-DD.csv", tipo, contenido, filas }`. Calcula y registra `exportar` en `auditoria.accesos` en la misma transacción (`detalle: { formato, origen: "metricas", tabla, filtros, filas }`). Exige `ver_metricas` y `exportar_csv` |

`tabla` es una de `TABLAS_METRICAS`: `punta-a-punta`, `pasos`, `recepcion`,
`flujo`, `devoluciones`, `motivos`, `carga`, `dim`, `linea-base` y `papel`
(`tablaCsv(m, tabla)`, puro, arma encabezados y filas; decimales con coma).

### 20.1 Filtros

`FiltrosMetricas`: `desde`, `hasta` (`YYYY-MM-DD` de Tucumán, inclusive),
`tipoTramiteId?`, `plantillaCodigo?` (todas sus versiones, como el buscador),
`cementerioId?`, `historicos` (`excluir` | `incluir`) y `agrupar` (`mes` |
`semana`). Por defecto: el mes en curso y los 5 anteriores enteros
(`filtrosPorDefecto(hoy)`), por mes y `historicos: "excluir"`. En la URL
(`@/lib/presentacion/metricas`): `desde`, `hasta`, `tramite`, `plantilla`,
`cementerio`, `agrupar=semana`, `historicos=incluir`.

### 20.2 Cómo se mide

Todo sale de `movimientos` y `expedientes`:

- **El recorrido** (`recorrido.ts`, puro): los movimientos de cada expediente
  **como cuentan hoy** (`movimientosVigentes()` de la reconstrucción: sin los
  revertidos y con la fecha efectiva corregida), en orden de `secuencia`, con
  el mismo efecto que les da `reconstruccion.ts`. Arma **estadías** (llegada
  al paso por alta, pase, devolución, desarchivar o reabrir; salida por pase,
  devolución, concluir, archivar o anular), la recepción de cada una, el plazo
  al salir de un paso con plazo, los **eventos** de estado y los intervalos en
  trámite.
- **Días hábiles**: `f_dias_habiles_entre(día de la llegada, día de la
  salida)` de la base (los feriados del plazo DIM y la bandeja; el mismo día
  es 0), siempre con la fecha efectiva. El cálculo va en dos pasadas: la
  primera junta todos los pares, la base los responde en una consulta
  (`unnest`) y la segunda arma las métricas. El vencimiento DIM, con
  `f_sumar_dias_habiles`.
- **Con el sistema**: los expedientes dados de alta en el sistema; con
  `historicos: "incluir"`, también los de carga histórica terminada. Las
  cargas históricas **abiertas** no se miden nunca (como en el panel).
- **Antes del sistema (línea de base)**: las estadías que salieron con un
  movimiento de la transcripción (`carga_historica`) y los expedientes cuya
  conclusión se transcribió. No se filtran por período (son de antes), sí por
  trámite, plantilla y cementerio. Una estadía que llegó por la
  transcripción y salió con el sistema es "mixta" y no entra en la
  comparación.
- **Período**: una estadía entra si **salió** en el período; un concluido, si
  se concluyó en el período; un ingreso, por su fecha de inicio.
- **Estadísticas** (`estadisticas.ts`, puro): n, **mediana**, promedio con un
  decimal, **percentil 90 por rango más cercano** (`ordenados[ceil(0,9·n) − 1]`:
  siempre un caso real) y total. Con menos de `MUESTRA_MINIMA` (10) casos la
  pantalla dice "muestra chica".

### 20.3 Lo que devuelve (`Metricas`)

| Campo | Qué es |
|---|---|
| `resumen` | Ingresados (y `busquedaIngresados`), concluidos, punta a punta con sistema y antes, en trámite hoy (y `busquedaEnTramiteHoy`), demorados hoy, devoluciones / salidas / `tasaDevolucion`, `cuelloMediana` (el paso con mayor mediana; desempata el acumulado) y `cuelloAcumulado`, fichas reemplazadas |
| `puntaAPunta` | `total`, `porTipo` y `porPlantilla`: `FilaTiempos { conSistema, antes }` (días hábiles de la fecha de inicio a la conclusión) |
| `pasos` | `FilaPaso` por paso y área (un paso `$CEMENTERIO` da una fila por cementerio): `tiempos`, `superaronAlerta` (`dias_alerta` del paso), `devoluciones` y `tasaDevolucion` (sobre las salidas del paso), `hoy` y `antes` |
| `recepcion` | Por área interna: `confirmadas` (días hasta "Confirmar recepción", las confirmadas en el período), `implicitas` (se confirmó al operar: no tiene fecha propia y no se promedia) y `sinConfirmarHoy` |
| `flujo` | Por mes o semana: ingresados, concluidos, archivados, anulados y `stockFinal` (en trámite al cierre, o ahora si el corte es hoy) |
| `devoluciones` | `rutas` (de qué área y paso a cuál) y `motivos`, agrupados por los atajos del diálogo (`grupoDeMotivo`: el motivo empieza con "Falta firma", "Error en boleta" o "Falta documentación", sin acentos ni mayúsculas; lo demás, "Otros") |
| `carga` | Por área: `hoy` (y `busquedaHoy`), `promedioPeriodo` (expedientes presentes por día corrido del período), `demoradosHoy` (como el panel) y `tiempos` |
| `dim` | Los pasos con plazo: cumplido en término (`DIM_PLAN_INICIADO` antes del vencimiento), cumplido vencido, vencido sin cumplir, volvió antes de vencer sin plan, en curso y sin notificación; `demora`: días desde la notificación hasta que el papel volvió de la DIM |
| `lineaBase` | `puntaAPunta` y `pasos` con `antes` y `conSistema`, `expedientes` (cargas históricas), `minimo` y `muestraChica` |
| `papel` | `fichasReemplazadas` (altas en el sistema del período), `anotaciones`, `hojasEstimadas`, `acumuladoSistema`, `cargasHistoricas` y `parametros` |

**Enlaces a la búsqueda.** Un número trae `busqueda` (`FiltrosBusqueda`) solo
si la búsqueda trae **exactamente** esos expedientes: ingresados por fecha de
inicio (`desde`, `hasta`, anulados incluidos, `historica=0`) y en trámite hoy,
total y por área. La búsqueda no distingue una carga histórica ya terminada:
si con `historicos: "excluir"` hay alguna en ese conteo, el número va sin
enlace. Los tiempos no tienen equivalente.

**Papel** (`papel.ts`). Fichas reemplazadas: un dato. Hojas: una estimación,
`max(1, ⌈anotaciones ÷ anotacionesPorHoja⌉)` por expediente, con las
anotaciones de su historial (alta, pases, devoluciones y cambios de estado
vigentes) y `PARAMETROS_PAPEL.anotacionesPorHoja = 12`, un **supuesto** sin
medir (falta una ficha real); se cambia ahí o con `papel` en las
dependencias, y la pantalla muestra la fórmula con el valor que tenga.

### 20.4 La pantalla y el CSV

| Ruta | Qué llama |
|---|---|
| `/panel/metricas?desde=&hasta=&tramite=&plantilla=&cementerio=&agrupar=&historicos=` | `metricas` y `opcionesBusqueda`. Resumen con 8 cifras (cada una con su comparación contra la línea de base o su contexto) y las secciones Punta a punta, Por paso y área, Flujo, Recepción, Plazo DIM, Devoluciones, Carga por área, Línea de base y Papel, cada una con su gráfico (docs/diseno.md, "Gráficos"), su tabla y "Exportar CSV". Un período inválido muestra el error. Imprimible |
| `GET /panel/metricas/exportar?tabla=<tabla>&<los mismos filtros>` | `exportarCsv` (`responderExportacionMetricas` de `@/lib/presentacion/metricas`): 200 `text/csv` attachment, 401 sin sesión, 403 sin permiso, 404 con una tabla que no existe, 422 con un período inválido |

Acceso: el ítem **Métricas** de la barra lateral (Dirección y admin, ícono
`ChartColumnIncreasing`), el acceso rápido y el botón "Métricas de gestión"
del panel. Leer las métricas no registra accesos (son agregados, sin datos
personales); exportarlas sí.

Probado en `src/lib/dominio/metricas/*.test.ts` (cálculos puros con un
calendario de prueba), `src/lib/presentacion/{graficos,metricas}.test.ts`,
`tests/integracion/metricas.test.ts` (con fechas conocidas de 1999, un
feriado, una reversión y una carga histórica de 1998) y
`tests/e2e/metricas.spec.ts`.

### 20.5 Pendientes

- `anotacionesPorHoja` con una ficha de papel real.
- La línea de base depende de cuántas fichas se transcriban con su recorrido
  completo (hasta la conclusión, para el punta a punta).
- Con la semilla el cálculo tarda unos 120 ms; con años de historia y un
  período largo, si hace falta, cachear el resultado por día.

## 21. Avisos en el sistema (`@/lib/dominio/avisos`, 26/10/2026)

Avisos dentro de la aplicación: la **campana** del encabezado con el contador
de no leídos y `/avisos`. Sin correo ni WhatsApp por ahora; el diseño queda
listo para sumarlos (21.6). Sin cambios de reglas de negocio ni de permisos:
los avisos se agregan a lo que ya pasa (un pase, una devolución, un plazo que
se vence), no deciden nada.

| Módulo | Qué tiene |
|---|---|
| `@/lib/dominio/avisos/servidor` | `avisos` (el servicio, ya conectado) y todo lo de abajo. `server-only` |
| `@/lib/dominio/avisos/tipos` | Puro: `TIPOS_AVISO`, `PRIORIDAD_DE`, `ETIQUETA_TIPO_AVISO`, `TIPOS_DESACTIVABLES`, `CANALES_AVISO`, las claves y el texto de cada aviso |
| `@/lib/dominio/avisos/eventos` | `avisarLlegada()` y `avisarCierre()`: los llama el dominio de expedientes con su `tx` |
| `@/lib/dominio/avisos/tiempo` | `generarAvisosPorTiempo()`, `generarSiHaceFalta()` y `avisosPorTiempo()` (la regla, pura) |
| `@/lib/dominio/avisos/consultas` | Lo que ve cada usuario: contador, resumen, lista, marcar, preferencias |
| `@/lib/presentacion/avisos` | Puro: nombre accesible de la campana, "hace cuánto", tonos, filtros de `/avisos` en la URL |

### 21.1 Qué se avisa y a quién

Destinatarios: los usuarios **activos** con rol **operador** del área que
corresponde. Nunca el admin ni Dirección (no operan), ni SISTEMA, ni un
inactivo, ni **quien hizo la acción** (no se avisa a sí mismo).

| Tipo (`tipo`) | Cuándo | A quién | Prioridad |
|---|---|---|---|
| `llego` "Llegó un expediente" | Un pase llega a un área | El área de destino; si el paso es externo (la DIM, un cementerio), la custodia | normal |
| `devuelto` "Te devolvieron un expediente" | Una devolución, con el motivo | El área de destino (externo: la custodia) | **alta** |
| `plazo_por_vencer` "Plazo DIM por vencer" | Plazo empezado y sin cumplir con 5 días hábiles o menos (`DIAS_PLAZO_POR_VENCER`) | La custodia (Tributario) | normal |
| `plazo_vencido` "Plazo DIM vencido" | `faltan < 0` | La custodia | **alta** |
| `sin_confirmar` "Enviado sin confirmar" | `recibido_en` nulo y más de 2 días hábiles en el área (`DIAS_SIN_CONFIRMAR`, como el panel) | El área que lo envió (`area_usuario_id` del pase o la devolución) | normal |
| `demorado` "Demorado" | `dias_en_area >= dias_alerta` del paso (como la bandeja) | El área responsable | normal |
| `cerrado` "Concluido o archivado" | Concluir, archivar y archivar sin concluir (también "archivar y abrir vinculado") | Mesa de Entradas; cada usuario lo puede apagar | baja |

- Una devolución genera **solo** `devuelto` (no además `llego`): es la misma
  llegada, con más información.
- Desarchivar, reabrir, la recepción, la transcripción histórica y las
  correcciones no avisan. Un pase revertido conserva su aviso (fue lo que
  pasó; la ficha muestra la reversión).
- Los días hábiles los cuenta la base (`f_dias_habiles_entre`,
  `f_sumar_dias_habiles`): los feriados cuentan. Con la carga histórica
  abierta, o fuera de los estados activos, no hay avisos por tiempo.
- **Sin datos personales**: título y texto llevan número, trámite (la
  plantilla), paso, áreas y, en una devolución, el motivo (recortado a 280
  caracteres; ya está en el historial y en la bandeja). Nunca titular, DNI ni
  contacto. El enlace es la ficha (`/expedientes/CEM-…`, ruta relativa: un
  CHECK lo exige).

### 21.2 Los avisos por evento (en la transacción del movimiento)

`darPase` (pase.ts), `devolver` (devolucion.ts) y `concluir`, `archivar` y
`archivarSinConcluir` (estados.ts) llaman a `avisarLlegada(tx, …)` o
`avisarCierre(tx, …)` **con su `tx`**, después de insertar el movimiento y
actualizar la proyección: si algo falla, se deshacen los dos. No hay pase sin
aviso ni aviso sin pase, y la pantalla no crea avisos. La idempotencia es la
de la acción (un comando repetido devuelve lo de la primera vez sin llegar
acá) y además la clave única: `llego:<movimiento>`, `devuelto:<movimiento>`,
`cerrado:<movimiento>`, insertadas con `createMany({ skipDuplicates })`.

### 21.3 Los avisos por tiempo

`avisos.generarPorTiempo({ ahora? })` (`generarAvisosPorTiempo`): una
consulta sobre los expedientes en trabajo (estados activos, sin carga
histórica abierta) con días en el área, alerta del paso, plazo (`sqlPlazo`,
el mismo LATERAL de la bandeja y el panel) y el envío que espera
confirmación; la regla pura (`avisosPorTiempo`) decide; los destinatarios son
los operadores activos de cada área. Firmada por SISTEMA. **Idempotente**:
las claves no son por día sino por situación, así que correrla dos veces, o
todos los días, no repite nada:

| Tipo | Clave |
|---|---|
| Plazo | `plazo_por_vencer:<expediente>:<plazo_desde>` y `plazo_vencido:…` (si se vuelve a notificar, es otro plazo) |
| Sin confirmar | `sin_confirmar:<movimiento del envío>` |
| Demorado | `demorado:<expediente>:<paso>:<en_area_desde>`: uno por estadía en el paso, no uno por día. Si vuelve al mismo paso después, es otra estadía. Corregir la fecha de la llegada (2.13(b)) cambia la clave: puede quedar un segundo aviso para la misma estadía |

Devuelve `{ dia, creados, porTipo, expedientes }` y anota la corrida del día
en `avisos_corridas`.

**Cuándo corre** (decidido el 26/10/2026):

1. La **tarea programada**, todos los días a las 6:00 de Tucumán: `npm run
   avisos:generar` (`scripts/generar-avisos.ts`; en el paquete,
   `scripts/generar-avisos.mjs`), timer `cementeria-avisos`
   (docs/despliegue.md); en Vercel, `GET /api/cron/avisos` (Vercel Cron, 09:00
   UTC; docs/despliegue-vercel.md). Las dos llaman a `tareaAvisos()` de
   `@/lib/tareas/programadas`. Una línea JSON (`avisos.generados` con lo creado por
   tipo); sale con 2 si no pudo. `-- --fecha AAAA-MM-DD` genera como si fuera
   ese día (para probar).
2. Si ese día no corrió (el servidor estuvo apagado, el timer falló, o en
   desarrollo), **la primera pantalla que carga un operador** la corre: el
   layout llama a `avisos.generarSiHaceFalta()` antes de contar los no
   leídos (la bandeja, que es el inicio de los operadores, pasa por ahí).
   Barata: si ya corrió, es una lectura por clave primaria de
   `avisos_corridas`. Acotada: reserva el día con `INSERT … ON CONFLICT DO
   NOTHING` en la misma transacción (dos cargas a la vez no la corren dos
   veces), con `statement_timeout` de 10 s; si falla, se registra
   (`avisos.generacion_en_carga_fallo`) y la pantalla se muestra igual.
3. La **semilla** la corre al final (21.7).

Una vez por día alcanza: las tres reglas son en días hábiles.

### 21.4 El modelo (migración `20261026180000_avisos`)

| Tabla | Columnas |
|---|---|
| `avisos` | `id` (identity ALWAYS), `usuario_id` (destinatario), `tipo`, `prioridad` (`baja`, `normal`, `alta`), `expediente_id`, `movimiento_id` (el pase, la devolución, el cierre o el envío sin confirmar; nulo en plazo y demora), `titulo` (hasta 160), `texto` (hasta 600), `enlace` (ruta relativa), `clave` (única por usuario), `creado_en`, `leido_en` (nulo = no leído) |
| `avisos_preferencias` | `(usuario_id, tipo, canal)` PK, `activo`, `actualizado_en`. Solo lo que se apartó de lo de siempre: sin fila = activo |
| `avisos_corridas` | `dia` PK, `corrido_en`, `avisos` (lo creado ese día por la generación) |

Índices: `avisos_no_leidos_idx` (`usuario_id, creado_en DESC` **WHERE
`leido_en IS NULL`**: el contador del encabezado en cada pantalla),
`avisos_usuario_id_creado_en_idx` (la lista) y `avisos_usuario_id_clave_key`
(no duplicar). CHECKs de tipo, prioridad, canal (`sistema`), largos y enlace
(`^/[A-Za-z0-9]`: nunca `//host` ni un esquema).

**Privilegios de `cementeria_app`**: SELECT e INSERT en las tres; UPDATE
solo de `avisos.leido_en`, `avisos_preferencias.activo, actualizado_en` y
`avisos_corridas.corrido_en, avisos`. Sin DELETE. Sin triggers ni auditoría
propia (un aviso no cambia el expediente).

**Retención**: los avisos **leídos hace más de 90 días** se pueden purgar
(`DIAS_RETENCION_MINIMA`); los no leídos y los leídos recientes, nunca. Lo
que pasó está en el historial (`movimientos`), que no se toca. La purga la
hace el admin del sistema a mano con la credencial de deploy (la app no puede
borrar): `npm run avisos:purgar` (`scripts/purgar-avisos.ts`, con
`MIGRATE_DATABASE_URL`) cuenta lo que borraría; `-- --confirmar` borra;
`-- --dias N` (90 o más) cambia la antigüedad. En el servidor, ver
docs/despliegue.md, "Avisos".

### 21.5 Lo que ve cada usuario (`avisos`)

Siempre los **propios**: cada consulta y cada UPDATE filtra por el
`usuario_id` de la sesión; un id de otro no cambia nada. Para quien no recibe
avisos (`recibeAvisos(usuario)`: operador activo con área) todo da 0 y vacío.

```ts
interface AvisoVista {
  id: string; tipo: TipoAviso; prioridad: "baja" | "normal" | "alta";
  titulo: string; texto: string; enlace: string; numero: string;
  creadoEn: string; leidoEn: string | null;   // ISO 8601: serializable (va al navegador)
}
```

| Función | Qué hace |
|---|---|
| `avisos.contarNoLeidos(usuario)` | El número de la campana (índice parcial) |
| `avisos.resumen(usuario, limite = 8)` | `{ noLeidos, ultimos: AvisoVista[] }`: la campana |
| `avisos.listar(usuario, { soloNoLeidos?, tipo?, pagina? })` | `/avisos`: `{ filas, total, pagina, paginas, noLeidos }`, de a 25 (`AVISOS_POR_PAGINA`), del más nuevo al más viejo; una página fuera de rango va a la última |
| `avisos.marcarLeidos(usuario, ids)` / `marcarNoLeidos(usuario, ids)` | Devuelve cuántos cambiaron. Ids como texto; lo que no es un entero positivo se descarta (hasta 200) |
| `avisos.marcarTodosLeidos(usuario)` | "Marcar todos como leídos" |
| `avisos.preferencias(usuario)` / `cambiarPreferencia(usuario, tipo, activo)` | Hoy solo `cerrado` (`TIPOS_DESACTIVABLES`); otro tipo devuelve `false`. Rige para los avisos que se creen desde ese momento |
| `avisos.generarPorTiempo({ ahora? })` / `generarSiHaceFalta()` | 21.3 |

Las pantallas:

| Ruta | Qué llama |
|---|---|
| Encabezado (`(app)/layout.tsx`) | `generarSiHaceFalta()` y `resumen()` para los operadores: la campana (`campana-avisos.tsx`, docs/diseno.md, "Campana de avisos") |
| `GET /api/avisos/resumen` | `resumen()` en JSON (`Cache-Control: private, no-store`; 401 sin sesión). El refresco de la campana: al cambiar de pantalla y cada 60 s con la pestaña visible. **Fuera del matcher de `src/proxy.ts`**: si pasara por el proxy, la pregunta automática renovaría la sesión y los 60 minutos de inactividad no vencerían nunca; la ruta verifica la sesión sin renovarla |
| `/avisos?estado=no_leidos&tipo=&pagina=` | `listar()` y, para Mesa de Entradas, `preferencias()`. Filtros en la URL (`leerFiltrosAvisos`, `rutaAvisos`) |
| Server Actions (`(app)/avisos/acciones.ts`) | `accionAbrirAviso(id)` (al abrir un aviso, sin `refresh()`: la campana ya lo muestra leído y sigue una navegación), `accionMarcarTodos()` (con `refresh()`), `accionMarcarAviso(id, leido)` y `accionPreferencia(tipo, form)` (formularios de `/avisos`, con `refresh()`) |

El layout no se vuelve a dibujar en una navegación del lado del cliente
(Partial Rendering de Next): el contador sale del servidor en cada carga y en
la respuesta de toda Server Action con `refresh()`, y entre medio lo trae el
refresco liviano.

### 21.6 Canales (para después)

`avisos` es la bandeja del canal **sistema** y la fuente de verdad. Para sumar
correo o WhatsApp (como el canal sistema/email/migue de Tramita Capital):

1. el canal en `CANALES_AVISO` y en el CHECK de `avisos_preferencias.canal`;
2. una tabla de envíos (`aviso_id`, `canal`, `estado`, `intentos`,
   `enviado_en`, `error`) que llene un proceso aparte (otro timer o una cola)
   leyendo los avisos nuevos y las preferencias de cada usuario por canal;
3. el texto corto de cada canal a partir de `titulo`, `texto` y `enlace` (con
   `APP_URL`), sin datos personales también ahí.

Los generadores (21.2 y 21.3) no cambian: crean la fila en `avisos` y nada
más. Las preferencias ya tienen el canal en la clave. A diferencia de Tramita
Capital (una tabla `notificaciones` con una fila por canal, y el envío en el
mismo request con `after()`), acá el envío por otros canales va aparte y
fuera de la transacción: un correo que tarda o falla no frena ni deshace un
pase, y el contador y la clave única quedan del canal sistema.

### 21.7 Semilla y pruebas

La semilla crea los avisos sola: los escenarios mueven los expedientes con
el dominio (cada pase, devolución y cierre crea los suyos) y al final corre la
generación por tiempo (`prisma/seed.ts`). Con una base recién reseteada, cada
área ve sus avisos al entrar (README, "Semilla").

Probado en `src/lib/dominio/avisos/{tipos,tiempo}.test.ts` (claves, textos
sin datos personales, la regla de cada aviso por tiempo),
`src/lib/presentacion/avisos.test.ts`, `src/proxy.test.ts` (el refresco fuera
del matcher), `tests/integracion/avisos.test.ts` (destinatarios correctos de
cada evento y nadie más, inactivos, custodia en la DIM, plazo por vencer y
vencido, sin confirmar y demorado una sola vez, idempotencia, feriados, una
corrida por día, marcar solo los propios, preferencia, privilegios y CHECKs)
y `tests/e2e/circuito.spec.ts` (Liquidación devuelve a Cómputo, la campana
de Cómputo dice "1 sin leer", el aviso lleva a la ficha).

### 21.8 Pendientes

- Correo y WhatsApp (21.6).
- Marcar leídos solos los avisos que dejaron de aplicar (el "sin confirmar"
  de un expediente que ya se confirmó, el "llegó" de un pase revertido). Hoy
  quedan hasta que la persona los lee.
- Un ítem "Avisos" en la barra lateral: hoy se llega por la campana ("Ver
  todos los avisos"); `navegacion.tsx` y `iconos-modulos.ts` estaban en
  cambio por las métricas.

## 22. Ingreso con usuario y contraseña (27/10/2026)

Decisión del 27/10/2026: el ingreso con Cidituc queda **en pausa** y se entra
con un **login propio**, CUIL (o correo) y contraseña. El código de Cidituc no
se borró: con `CIDITUC_HABILITADO=1` el botón "Ingresar con Cidituc" vuelve a
aparecer en /login, debajo del formulario, y `/auth/ingresar` y
`/auth/callback` funcionan como antes. Nada de la autorización cambió: el
ingreso emite la MISMA sesión (`cem_sesion`, `sesion_version`,
`getUsuarioActual()`, sección 6 de la propuesta) y los permisos son los de
siempre. Sin dependencias nuevas: `node:crypto`.

| Módulo | Qué tiene |
|---|---|
| `@/lib/auth/clave` | `hashearClave`, `verificarClave`, `leerHash`, `generarClaveTemporal`, `problemasDeClave`, `REGLAS_CLAVE`, `PARAMETROS_ACTUALES`. Puro (solo node:crypto) |
| `@/lib/auth/limite-intentos` | `siguienteFallo`, `estaBloqueado` (por usuario) y `LimitePorIp` (por IP, en memoria). Puro, con el reloj inyectado |
| `@/lib/auth/ingreso-clave` | `ingresarConClave`, `cambiarClave`, `interpretarIdentificador`, `mensajeDeRechazo`. Recibe sus dependencias (`DependenciasClave`: lectura, `conActor`, reloj, límite por IP) |
| `@/lib/auth/emitir` | `dejarSesion` (la cookie desde una Server Action), `sesionDeLaCookie`, `ipDelRequest`. `server-only` |
| `@/lib/auth/sesion` | Además de lo de siempre: `getSesionActual()` (también con contraseña temporal), `RUTA_CAMBIAR_CLAVE`, `dependenciasClave` |

### 22.1 El modelo (migración `20261027180000_login_propio`)

Cinco columnas en `usuarios`; ninguna tabla nueva (la defensa RLS de
`*_rls_defensa` no necesita nada más, y `cementeria_app` ya tenía UPDATE
sobre la tabla).

| Columna | Qué es |
|---|---|
| `clave_hash` | `scrypt$N$r$p$<sal>$<hash>` (sal de 16 bytes y hash de 32, en base64url). NULL: sin contraseña (no ingresa por el formulario hasta un blanqueo). CHECK del formato: una contraseña en texto no se puede guardar. SISTEMA no puede tener |
| `debe_cambiar_clave` | La contraseña es temporal (alta, blanqueo, admin inicial) |
| `clave_cambiada_en` | Cuándo cambió `clave_hash` por última vez (un rehash al ingresar no cuenta) |
| `intentos_fallidos` | Fallos seguidos; al quinto vuelve a 0 y se bloquea |
| `bloqueado_hasta` | Bloqueado por intentos fallidos hasta esa hora |

El trigger `auditar_cambio` de usuarios guarda ahora `id, cuil, area_id, rol,
activo, debe_cambiar_clave`: un blanqueo (no → sí) y el primer cambio (sí → no)
quedan en `auditoria.cambios` con su autor y motivo. **Nunca** el hash ni el
contador (`tests/integracion/auditoria.test.ts`). `auditoria.accesos` suma
cuatro acciones: `bloqueo` (el usuario bloqueado, firmado por SISTEMA),
`desbloqueo` y `blanqueo_clave` (el admin que lo hizo; el usuario afectado va
en `detalle.usuario_id`) y `cambio_clave` (el propio usuario).

### 22.2 El hash

scrypt de `node:crypto` con **N = 2^15, r = 8, p = 3** (una de las
combinaciones equivalentes que recomienda OWASP; 32 MiB y unos 160 ms por
cálculo). La contraseña se normaliza a NFC antes de calcular. Los parámetros
van en el propio valor: para subir el costo se cambia `PARAMETROS_ACTUALES` y
cada hash viejo se sigue verificando con los suyos y se rehace con los nuevos
en el próximo ingreso correcto (`verificarClave` devuelve `rehacer: true`).
La comparación es en tiempo constante (`timingSafeEqual`), y sin usuario o
sin hash se calcula igual contra un **señuelo**: el tiempo de respuesta no dice
si el CUIL existe. La copia en JavaScript para el paquete SQL
(`scripts/supabase/lib.mjs`, `hashClave`) da hashes que esto verifica
(`scripts/supabase/lib.test.ts`).

### 22.3 Ingreso (`ingresarConClave`, /login)

1. Si la IP llegó al tope (30 fallos en 15 minutos), se rechaza sin buscar a
   nadie ni escribir en la base (`limite_ip`, el único con otro mensaje). El
   límite por IP vive **en la memoria del proceso**: es por instancia y un
   reinicio lo borra (alcanza con una instancia detrás de nginx; con varias,
   tendría que ir a la base).
2. "CUIL o correo": un CUIL de 11 dígitos con o sin guiones, puntos o
   espacios, o un correo (sin importar mayúsculas). El correo no es único en
   la base: si lo comparten dos usuarios, no se elige ninguno (por eso el alta
   rechaza un correo repetido).
3. Se calcula scrypt **siempre**. Se rechaza, con el **mismo mensaje**
   ("CUIL, correo o contraseña incorrectos"), si: no existe, es inactivo o
   SISTEMA, está bloqueado (aunque la contraseña sea la correcta), no tiene
   contraseña, o la contraseña no es. El motivo real queda en
   `auditoria.accesos` (`ingreso_rechazado`, firmado por SISTEMA, con
   `detalle.motivo`; del identificador, solo el tipo y, si es un CUIL válido,
   el CUIL: nunca la contraseña ni un texto que podría serlo).
4. Una contraseña incorrecta de un usuario existente suma un fallo con su fila
   bloqueada (`FOR UPDATE`); al quinto seguido, `bloqueado_hasta = ahora + 15
   min`, el contador vuelve a 0 y queda `bloqueo` en la auditoría.
5. Correcta: `ultimo_ingreso`, contador en 0, sin bloqueo, el hash rehecho si
   hace falta y `ingreso` en la auditoría (`via: "clave"`), todo firmado por el
   usuario. La condición del UPDATE repite lo decidido (activo, mismo hash, sin
   bloqueo): si cambió en el medio, no entra (`carrera`).

La Server Action (`src/app/login/acciones.ts`) emite la sesión con
`dejarSesion()` y redirige al destino (`?volver=`) o al inicio del rol; con
`debe_cambiar_clave`, a `/cambiar-clave` (con el destino). **CSRF**: Next 16
compara `Origin` con `Host` o `X-Forwarded-Host` y deja pasar un POST sin
`Origin` (node_modules/next/dist/docs/01-app/02-guides/server-actions.md,
"Security"); además, `envioDelMismoSitio()` (src/lib/auth/red.ts) exige
`Origin` igual a `Host` (no a X-Forwarded-Host, que detrás de nginx escribe
el cliente) y `Sec-Fetch-Site` `same-origin` si vienen. La cookie sigue
siendo httpOnly, SameSite=Lax y, en producción, `__Host-`.

### 22.4 Cambio de contraseña (`cambiarClave`, /cambiar-clave)

- **Obligatorio** mientras `debe_cambiar_clave`: `getUsuarioActual()` no
  devuelve a ese usuario y `exigirUsuario()` lo manda a /cambiar-clave, así que
  todas las pantallas, Server Actions y Route Handlers quedan cerrados sin
  tocarlos (las API responden 401). Lo único que puede hacer es cambiarla o
  Salir. /cambiar-clave y la salida usan `getSesionActual()`.
- **Voluntario**: el botón de la llave del encabezado (junto a Salir).
- Pide la actual (o la temporal) y la nueva dos veces. La actual incorrecta
  cuenta como un fallo (el mismo contador y bloqueo del ingreso).
- **Política** (`problemasDeClave`, la lista `REGLAS_CLAVE` se muestra en la
  pantalla): 12 caracteres o más (y hasta 128), que no sea el CUIL ni contenga
  el apellido (sin importar mayúsculas ni tildes; las partículas "de", "la"…
  no cuentan), que no sea una clave común ni una palabra común con números o
  signos ("Password2026!", "Cementeria123"; la lista `CLAVES_COMUNES` incluye
  la contraseña de desarrollo de la semilla), al menos 5 caracteres distintos,
  y distinta de la actual.
- Al cambiarla: hash nuevo, `debe_cambiar_clave = false`, `clave_cambiada_en`,
  sin fallos ni bloqueo y `sesion_version + 1` (**se cierran todas sus
  sesiones**); esta PC recibe la sesión de nuevo con la versión nueva y el
  mismo inicio (no estira las 10 horas). `cambio_clave` en la auditoría.

### 22.5 Administración (`/admin/usuarios`)

- **Alta**: genera una contraseña temporal (`generarClaveTemporal`: cuatro
  grupos de cuatro, minúsculas y dígitos sin los ambiguos i, l, o, 0, 1; unos
  79 bits) y marca `debe_cambiar_clave`. La pantalla la muestra **una sola
  vez** con "Copiar" y el aviso de que no se vuelve a ver; en la base queda el
  hash. No se manda por correo (no hay correo todavía).
- **Blanquear contraseña** (con confirmación y motivo obligatorio): temporal
  nueva (una vez), `debe_cambiar_clave`, `sesion_version + 1` (cierra sus
  sesiones) y desbloquea. No la propia (esa se cambia en /cambiar-clave).
- **Desbloquear**: aparece solo si está bloqueado; contador en 0 y sin bloqueo.
- La lista muestra, en Estado, "Contraseña temporal", "Sin contraseña" y
  "Bloqueado hasta …". `FilaUsuarioAdmin` trae `conClave`,
  `debeCambiarClave` y `bloqueadoHasta`; el hash no sale del dominio.

### 22.6 Semillas y Supabase

- **Desarrollo** (`npm run db:seed`, con ficticios): los usuarios ficticios y
  el admin de desarrollo tienen la contraseña `CLAVE_DESARROLLO`
  (prisma/semilla/usuarios.ts, en el README), sin cambio obligatorio.
- **Producción** (`--sin-ficticios`): el admin inicial nace con una contraseña
  temporal y `debe_cambiar_clave`; prisma/seed.ts la imprime una sola vez y la
  escribe en `.local/clave-admin-inicial.txt` (o
  `ADMIN_INICIAL_CLAVE_ARCHIVO`), que no se versiona. Si el admin ya existía
  con contraseña, no se toca; si existía sin (una base anterior), recibe una.
- **Paquete SQL de Supabase** (`npm run supabase:sql`): `.local/35_admin_inicial.sql`
  lleva el **hash** de la temporal (nunca la contraseña), que está solo en
  `supabase/sql/.local/clave-admin-inicial.txt`. Ver docs/despliegue.md, 18.12.

### 22.7 Pruebas

Unitarias: `src/lib/auth/clave.test.ts` (hash y verificación, formato
versionado, rehash, señuelo, NFC, temporales, política),
`limite-intentos.test.ts` (bloqueo y límite por IP con reloj inyectado),
`ingreso-clave.test.ts` (ingreso, rechazos, bloqueo, tiempo del inexistente,
cambio), `red.test.ts` (`envioDelMismoSitio`), `sesion.test.ts` (el cierre
con contraseña temporal) y `scripts/supabase/lib.test.ts` (los hashes del
script los verifica la app). Integración: `tests/integracion/login.test.ts`
(ingreso correcto, incorrecto, inexistente e inactivo con el mismo mensaje,
bloqueo y desbloqueo, cambio obligatorio, blanqueo que cierra sesiones,
auditoría sin contraseñas, admin inicial de producción). Punta a punta:
`tests/e2e/login.spec.ts` (alta con temporal, ingreso por el formulario,
cambio obligatorio y bandeja; la contraseña de desarrollo y el mensaje único).

### 22.8 Pendientes

- Correo: mandar la temporal o un enlace de recuperación cuando haya un
  servicio de correo (hoy el admin la entrega en mano).
- El límite por IP en la base si algún día hay más de una instancia.
- Volver a Cidituc: `CIDITUC_HABILITADO=1` y decidir si las dos formas
  conviven (el botón ya aparece debajo del formulario).

## 23. Modo prueba: "Ver como…" (27/10/2026)

Pedido: probar todas las pantallas y roles con el propio CUIL, sin un usuario
por área. Decisión: un **selector de perfil de prueba**, activado por
configuración, con vuelta a Administrador y auditado. **Sin migraciones ni
cambios de esquema** y sin tocar permisos ni reglas de negocio: el modo prueba
solo cambia el área y el rol de la fila del propio usuario, y todo lo demás lo
decide el código de siempre a partir de esa fila.

| Módulo | Qué tiene |
|---|---|
| `@/lib/entorno` | `perfilesPrueba` (el conjunto de CUILs de `PERFILES_PRUEBA_CUILS`, ya validado) y `leerPerfilesPrueba()` |
| `@/lib/dominio/admin/perfil-prueba` | `crearServicioPerfilPrueba(deps)`, `perfilesDisponibles`, `opcionesPerfilPrueba`, `cambiarPerfilDePrueba`, `perfilesDesdeAreas`, `perfilActualDe`, `motivoCambio`, `cuilHabilitado`, `ModoPruebaInexistente`, `PerfilPruebaDenegado`. Recibe sus dependencias (`leer`, `escribir` = `conActor`, `cuils`) |
| `@/lib/dominio/admin/servidor` | `perfilPrueba`: el servicio conectado, con `cuils: () => entorno().perfilesPrueba` |
| `@/lib/presentacion/acciones-perfil-prueba` | `procesarCambioPerfilPrueba(servicio, usuario, { clave })`: la lógica de la Server Action, sin Next |
| `@/lib/presentacion/perfil-prueba` | Textos del selector y de la franja. Puro (lo usan los Client Components) |
| `src/app/(app)/perfil-prueba-acciones.ts` | `accionCambiarPerfilPrueba(clave)`: la Server Action |
| `src/app/(app)/perfil-prueba.tsx` | `SelectorPerfilPrueba` y `FranjaPerfilPrueba` (docs/diseno.md, "Modo prueba") |

### 23.1 Configuración

`PERFILES_PRUEBA_CUILS`: CUILs separados por coma, con o sin guiones (también
puntos o espacios), cada uno con su dígito verificador (`cuilValido`).
`entorno.ts` la valida con el resto: un valor inválido es `EntornoInvalido` y
la app no arranca (el mensaje nombra la variable y cuántos fallan, nunca los
números). **Vacía o ausente, el modo prueba no existe**: ni el selector en la
pantalla ni la acción en el servidor (responde 404 con `notFound()`). **Está
permitida en producción** (se prueba en Vercel), pero
`validarEntornoAlIniciar()` deja `log.warn` `entorno.modo_prueba_activo` con la
cantidad de CUILs y si es producción (nunca los números), y `entorno.validado`
suma `perfilesPrueba: <cantidad>`.

### 23.2 Perfiles

`perfilesDisponibles()`: una entrada por **área interna activa**, en su orden
(`areas.orden`): Mesa de Entradas, Cómputo, Liquidación, Asesoría Legal,
Administrativo y Departamento Tributario / Notificación con rol **operador**,
Dirección con rol **lectura** (como en 2.4), y al final **Administrador** (rol
admin, sin área). La clave de cada perfil es `area:<CODIGO>` o `admin`; la DIM
y los cementerios (áreas externas) no son perfiles. El perfil actual
(`perfilActualDe`) sale del rol y el área: un admin es "Administrador" aunque
tenga área; un rol que no coincide con su área (lectura en Liquidación) no
marca ninguno.

### 23.3 `cambiarPerfilDePrueba(deps, usuario, destino)`

1. Sin CUILs: `ModoPruebaInexistente` (la acción hace `notFound()` antes).
2. Lee **de la base** el CUIL y `activo` del usuario de la sesión
   (`usuario.id`): si no está en la lista o está inactivo,
   `PerfilPruebaDenegado` (la pantalla: "No podés usar el modo prueba…",
   código `permiso`). Del navegador llega solo la clave del perfil, nunca un
   CUIL.
3. El destino tiene que ser uno de `perfilesDisponibles()`; si no,
   `validacion`.
4. En `conActor(usuario.id, "Modo prueba: ver como <perfil>")`: relee y
   bloquea su fila (`SELECT … FOR UPDATE`) y **vuelve a comprobar el CUIL** en
   la misma transacción; si ya tiene ese perfil, `repetido` sin escribir; si
   deja Administrador y no queda otro administrador activo, **se permite
   igual** y el motivo pasa a "Modo prueba: ver como Cómputo (sin otro
   administrador activo mientras dure)" (con `set_config` de `app.motivo`
   dentro de la transacción); actualiza **solo `area_id` y `rol` de su propia
   fila**.
5. Devuelve `{ perfil, destino, repetido, sinOtroAdmin }`; `destino` es
   `inicioPara()`: `/bandeja` para operadores, `/panel` para Dirección y el
   admin.

- **Auditoría**: el trigger `auditar_cambio` de `usuarios` (columnas `id,
  cuil, area_id, rol, activo, debe_cambiar_clave`) deja en
  `auditoria.cambios` cada cambio con `antes`, `despues`, el autor (el mismo
  usuario) y el motivo. Se ve en Administración → Auditoría → Cambios. La
  Server Action además deja `perfil_prueba.cambio` en el log (id y destino,
  sin CUIL) y `perfil_prueba.sin_otro_admin` como advertencia.
- **No incrementa `sesion_version`**: la sesión sigue. `getUsuarioActual()`
  relee área y rol en cada request, así que el perfil nuevo rige en el request
  siguiente, igual que un cambio desde la administración.
- **CHECK y triggers**: los de siempre. El admin va sin área
  (`usuarios_area_check` exige área a los demás) y las áreas son internas y
  activas (`usuarios_area_interna`); si una carrera los violara,
  `conErroresLegibles` lo devuelve como `validacion`.

### 23.4 Por qué no pasa por las reglas de la administración de usuarios

`cambiarAccesoUsuario` (17.2) no deja cambiarse el rol a uno mismo ni quitarle
el rol al último administrador, y **no cambió**. El modo prueba es otro
camino, explícito y separado, y es aceptable porque:

- solo existe con `PERFILES_PRUEBA_CUILS` y solo para esos CUILs, comprobados
  en el servidor en cada llamada contra el CUIL guardado en la base; la lista
  la controla **quien despliega**, no la pantalla (nadie se agrega a sí
  mismo);
- **siempre se puede volver**: "Administrador" está en la lista desde
  cualquier perfil y la franja tiene "Volver a Administrador", también si era
  el único admin;
- todo queda auditado con su motivo, y quedarse sin otro admin queda dicho en
  el motivo y en el log;
- lo que se hace en otro perfil es real y lleva su firma (un pase como
  Liquidación queda con `area_usuario_id` de Liquidación y el usuario de
  prueba como autor): es para probar sobre datos de prueba.

**Riesgo que queda**: borrar la variable con alguien en otro perfil. El
selector desaparece y esa persona queda como Liquidación (si era el único
admin, sin administrador). Por eso, antes de borrarla, volver a
Administrador; si ya pasó, volver a ponerla, volver y borrarla otra vez.

### 23.5 Avisos, bandejas y recorridos

Nada se cachea por perfil: no hay `"use cache"` ni `unstable_cache`
(`cacheComponents: false`) y el layout lee el usuario de la base en cada
request. Después de cambiar, el selector hace una **carga completa** del
inicio del perfil (`window.location.assign`, no `router.push`), así el Router
Cache del cliente arranca vacío y el layout se dibuja entero con el perfil
nuevo: el menú (`navegacionPara`), el contador "Por confirmar" (solo con
bandeja), la campana (solo operadores, `recibeAvisos`), la bandeja del área
nueva y el perfil de los recorridos (`perfilDe`, que cambia sus textos). Los
avisos son **del usuario** (`avisos.usuario_id`), no del área: los que
recibió como Liquidación siguen en su campana si pasa a Cómputo (es el mismo
usuario), y como Dirección o Administrador la campana no aparece. Lo
recordado de los recorridos (localStorage) también es por usuario, no por
perfil.

### 23.6 Pruebas

Unitarias: `src/lib/entorno-perfiles-prueba.test.ts` (lectura de la variable,
con y sin guiones, inválida sin mostrar valores, producción, la advertencia al
arrancar con la cantidad), `src/lib/dominio/admin/perfil-prueba.test.ts`
(perfiles, perfil actual, motivo y autorización con dependencias falsas: sin
CUILs no existe, CUIL no listado o inactivo denegado sin escribir, el CUIL
releído en la transacción, destinos inválidos, sin otro admin) y
`src/lib/presentacion/perfil-prueba.test.ts` (textos). Integración:
`tests/integracion/perfil-prueba.test.ts`. Punta a punta:
`tests/e2e/perfil-prueba.spec.ts`.
