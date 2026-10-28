# Sistema visual de CementerIA

Rediseño visual (octubre de 2026), en dos etapas. La primera: tokens,
componentes base, ingreso, barra lateral y encabezado, y panel. La segunda:
encabezado compacto en el celular, nuevo expediente y edición, bandeja,
búsqueda, ficha con sus diálogos, transcripción, administración y la página de
"No encontrada". Después, una etapa de responsive (sección "Barra lateral
desplegable y responsive"): barra lateral que se contrae a íconos y tablas que
entran sin desplazamiento en notebook y pasan a tarjetas en tablet y celular.
Sin cambios de lógica, rutas, Server Actions, permisos,
validaciones, nombres de campos ni textos que usen las pruebas.

Criterio: institucional, sobrio y claro, con densidad de trabajo
administrativo. La referencia fue el moodboard del paquete visual (no se copia
como mockup: solo los módulos que existen, sin logo inventado y sin campos de
usuario y contraseña, porque el ingreso era solo con Cidituc; desde el
27/10/2026 el ingreso es con usuario y contraseña propios: ver "Ingreso con
usuario y contraseña").

## Tokens

En `src/app/globals.css`, dentro de `@theme`: cada `--color-x` es una clase de
Tailwind (`bg-x`, `text-x`, `border-x`, `ring-x`…).

| Token | Valor | Uso |
|---|---|---|
| `institucional` | `#0F2F5D` | Barra lateral, números destacados, títulos de marca |
| `institucional-hover` | `#163B70` | Hover en la barra lateral |
| `institucional-activo` | `#1A4683` | Ítem activo de la barra lateral |
| `institucional-texto` | `#C7D6EB` | Texto secundario sobre el azul institucional |
| `primario` | `#0F68FF` | Botón primario, anillo de foco, acentos |
| `primario-oscuro` | `#0B53CC` | Hover del primario, enlaces, texto azul sobre fondos tintados |
| `celeste` | `#38B2F6` | Decorativo; como texto, ícono o foco solo sobre el azul institucional |
| `superficie-azul` | `#E8F2FF` | Fondos tintados, hover de botones secundarios |
| `amarillo` | `#F4C400` | Acento municipal: barra del ítem activo, filete de la portada, pastilla "por vencer". **Nunca texto sobre blanco** |
| `fondo` | `#F4F7FB` | Fondo de la aplicación, encabezado de tablas |
| `superficie` | `#FFFFFF` | Tarjetas, encabezado, controles |
| `texto` | `#172B4D` | Texto principal |
| `texto-secundario` | `#5F6878` | Texto secundario (ajustado, ver abajo) |
| `borde` | `#DCE3EC` | Bordes decorativos de tarjetas y tablas |
| `borde-control` | `#7C8798` | Borde de inputs, selects y botones secundarios |
| `exito` / `-fondo` / `-borde` / `-solido` | `#166534` / `#EAF7EE` / `#9FD3B1` / `#15803D` | Concluido, en término |
| `advertencia` / `-fondo` / `-borde` | `#8A4B00` / `#FFF4D6` / `#F4C400` | Espera de pago, por vencer, avisos |
| `error` / `-fondo` / `-borde` | `#B42318` / `#FDECEC` / `#F2B8B5` | Anulado, vencido, errores |
| `error-hover` | `#912018` | Hover del botón rojo (`CLASE_BOTON_PELIGRO`); agregado en la segunda etapa |
| `info` / `-fondo` / `-borde` | `#0B53CC` / `#E8F2FF` / `#B5D3FF` | En trámite, avisos informativos |

Radios: `rounded-control` 8 px (controles y botones), `rounded-tarjeta` 12 px,
`rounded-panel` 16 px (portada, diálogos). Sombras: `shadow-tarjeta` y
`shadow-elevada` (hover y diálogos), teñidas del azul institucional.

**Ajustes respecto de la paleta del paquete:**

- `#6B7280` (gris de texto) da 4,4993:1 sobre el fondo `#F4F7FB` (no llega a
  4,5) y 4,28:1 sobre `#E8F2FF`. Se oscureció a **`#5F6878`**.
- `#0F68FF` llega a AA sobre blanco (4,73) y con texto blanco encima (4,73),
  pero no sobre el fondo (4,40) ni sobre `#E8F2FF` (4,18). Para enlaces y
  texto azul se usa **`#0B53CC`** (`primario-oscuro`), que llega en todos.
- El amarillo `#F4C400` sobre blanco da 1,65: solo como relleno o filete, y
  con texto `institucional` encima (8,04).
- El celeste `#38B2F6` sobre blanco da 2,37: solo sobre el azul institucional.
- Los bordes de control necesitan 3:1 (WCAG 1.4.11): `#DCE3EC` da 1,29, así
  que los controles usan `#7C8798` (3,64). `#DCE3EC` queda para bordes
  decorativos de tarjetas, que no son la única señal de nada.

## Contrastes (WCAG 2.1)

Calculados con la fórmula de luminancia relativa de WCAG. AA pide 4,5:1 para
texto normal y 3:1 para texto grande (≥ 24 px, o ≥ 18,7 px en negrita),
íconos y bordes de controles.

| Texto / elemento | Fondo | Contraste | Requisito | Dónde |
|---|---|---|---|---|
| `texto` #172B4D | blanco | 14,10 | 4,5 | Texto general |
| `texto` #172B4D | `fondo` #F4F7FB | 13,12 | 4,5 | Texto sobre el fondo |
| `texto` #172B4D | `superficie-azul` #E8F2FF | 12,47 | 4,5 | Selección, hover |
| `texto-secundario` #5F6878 | blanco | 5,62 | 4,5 | Ayudas, subtítulos |
| `texto-secundario` #5F6878 | `fondo` #F4F7FB | 5,23 | 4,5 | Encabezado de tablas, subtítulos |
| `texto-secundario` #5F6878 | `superficie-azul` #E8F2FF | 4,97 | 4,5 | Hover de filas |
| ~~#6B7280~~ (original) | `fondo` #F4F7FB | 4,4993 | 4,5 | **No llega**: reemplazado |
| ~~#6B7280~~ (original) | #E8F2FF | 4,28 | 4,5 | **No llega**: reemplazado |
| blanco | `primario` #0F68FF | 4,73 | 4,5 | Botón primario |
| `primario` #0F68FF | blanco | 4,73 | 4,5 / 3 | Anillo de foco, íconos |
| ~~`primario` #0F68FF~~ | `fondo` / #E8F2FF | 4,40 / 4,18 | 4,5 | **No se usa como texto ahí** |
| `primario-oscuro` #0B53CC | blanco | 6,72 | 4,5 | Enlaces |
| `primario-oscuro` #0B53CC | #E8F2FF | 5,95 | 4,5 | Hover de botón secundario, chip "En trámite" |
| blanco | `primario-oscuro` #0B53CC | 6,72 | 4,5 | Hover del botón primario |
| `institucional` #0F2F5D | blanco | 13,25 | 4,5 | Números del panel, marca, accesos rápidos |
| blanco | `institucional` #0F2F5D | 13,25 | 4,5 | Barra lateral |
| `institucional-texto` #C7D6EB | `institucional` #0F2F5D | 8,99 | 4,5 | Ítems y textos de la barra |
| `institucional-texto` #C7D6EB | `institucional-hover` #163B70 | 7,52 | 4,5 | Ítem en hover (pasa a blanco: 11,09) |
| blanco | `institucional-activo` #1A4683 | 9,34 | 4,5 | Ítem activo |
| `celeste` #38B2F6 | `institucional` #0F2F5D | 5,59 | 3 | Anillo de foco en la barra |
| `celeste` #38B2F6 | `institucional-activo` #1A4683 | 3,94 | 3 | Ícono del ítem activo |
| `amarillo` #F4C400 | `institucional` #0F2F5D | 8,04 | 3 | Barra del ítem activo (no es texto) |
| `institucional` #0F2F5D | `amarillo` #F4C400 | 8,04 | 4,5 | Pastilla "Plazos DIM por vencer" |
| ~~`amarillo`~~ #F4C400 | blanco | 1,65 | — | **Nunca como texto** |
| ~~`celeste`~~ #38B2F6 | blanco | 2,37 | — | **Nunca como texto ni ícono sobre blanco** |
| `exito` #166534 | `exito-fondo` #EAF7EE | 6,46 | 4,5 | Chip "Concluido", "En término" |
| `advertencia` #8A4B00 | `advertencia-fondo` #FFF4D6 | 6,21 | 4,5 | Avisos, "Espera de pago", "Por vencer", Por confirmar > 0 |
| `error` #B42318 | `error-fondo` #FDECEC | 5,76 | 4,5 | Errores, "Anulado", "Vencido" |
| `error` #B42318 | blanco | 6,57 | 4,5 | Mensajes de error de campo, "demorado" |
| blanco | `error` #B42318 | 6,57 | 4,5 | Pastilla "Plazos DIM vencidos" |
| `info` #0B53CC | `info-fondo` #E8F2FF | 5,95 | 4,5 | Aviso "Saliste de CementerIA" |
| `borde-control` #7C8798 | blanco | 3,64 | 3 | Borde de controles |
| `texto-secundario` #5F6878 | #EEF5FF (degradado del ingreso) | 5,12 | 4,5 | Aviso de la Ley 25.326 en el ingreso |
| blanco | `error-hover` #912018 | 8,66 | 4,5 | Hover del botón rojo |
| blanco | `error` #B42318 | 6,57 | 4,5 | Botón rojo, contador "N datos" del resumen de errores |
| `advertencia` #8A4B00 | blanco | 6,80 | 4,5 / 3 | Borde y texto del botón ámbar ("Dar pase · Faltan N") |
| `advertencia` #8A4B00 | `amarillo` 25 % sobre blanco | 5,95 | 4,5 | Hover del botón ámbar |
| `error` #B42318 | `superficie-azul` #E8F2FF | 5,82 | 4,5 | Ítem delicado del menú "Corregir" en hover |
| `texto-secundario` #5F6878 | `advertencia-fondo` / `error-fondo` / `exito-fondo` | 5,13 / 4,92 / 5,09 | 4,5 | Ayudas dentro de avisos y del panel "Qué falta" |
| `texto-secundario` #5F6878 | `fondo` al 60–70 % sobre blanco | 5,33–5,37 | 4,5 | Ubicación, documentación y personas del alta y la ficha |
| `texto-secundario` #5F6878 | `superficie-azul` al 60 % | 5,21 | 4,5 | Paso actual del recorrido |
| `primario-oscuro` #0B53CC | `advertencia-fondo` / `error-fondo` | 6,14 / 5,89 | 4,5 | Enlaces dentro de avisos |
| `institucional` #0F2F5D | `superficie-azul` al 60 % | 12,30 | 4,5 | Nombre del paso actual |
| blanco | `exito-solido` #15803D | 5,02 | 3 | Tilde de los pasos cumplidos del recorrido (ícono) |
| `exito` #166534 | blanco | 7,13 | 3 | Tilde de subtarea hecha (ícono) |
| `borde-control` #7C8798 | `fondo` #F4F7FB | 3,38 | 3 | Círculo de los pasos pendientes del recorrido |
| blanco | `texto` #172B4D | 14,10 | 4,5 | Globos (tooltips) de la barra lateral contraída |
| `institucional-texto` #C7D6EB | `institucional` #0F2F5D | 8,99 | 3 | Ícono del botón "Contraer menú" / "Expandir menú" |

**Texto sobre fotos.** Medido en la app (Chromium, el píxel de fondo más claro
detrás de cada línea, con el texto oculto: el peor caso), en 390, 768, 1024 y
1440 px de ancho:

| Texto (blanco) | Peor contraste |
|---|---|
| Ingreso, "Municipalidad de San Miguel de Tucumán" | 5,52 (1440) · 7,19 (1024) |
| Ingreso, "Seguimiento de expedientes…" (grande) | 5,77 (1440) · 7,02 (1024) |
| Portada del panel, "CementerIA" | 8,84 a 10,61 |
| Portada del panel, "Dirección de Cementerios" | 8,57 a 10,45 |
| Portada del panel, "Municipalidad…" (11 px) | 7,14 a 9,99 |

El velo del ingreso es `from-institucional/90 via-institucional/55
to-primario/25` (de abajo hacia arriba); el de la portada,
`from-institucional/95 via-institucional/90 to-institucional/75` en celular y
tablet (el texto ocupa todo el ancho) y `via-institucional/80
to-institucional/35` en escritorio. Si se cambia una foto o un velo, volver a
medir.

## Tipografía

Inter variable, autoalojada con `@fontsource-variable/inter` (importada en
`src/app/layout.tsx`; Next sirve los `.woff2` desde `/_next/static`). Sin
`next/font/google`: el build no sale a internet. Solo se descarga el subconjunto
latino (`unicode-range`).

Escala: títulos de pantalla `text-2xl`/`text-xl` semibold; títulos de bloque
`titulo-seccion` (15 px semibold); texto `text-sm`; ayudas y metadatos
`text-xs`. Números con `tabular-nums`.

## Componentes y clases

- **`src/components/formulario.tsx`**: `CLASE_CONTROL` (40 px de alto, radio
  8 px, borde `borde-control`, foco con anillo `primario` de 2 px separado
  2 px, `aria-invalid` en rojo), `CLASE_BOTON_PRIMARIO`,
  `CLASE_BOTON_SECUNDARIO` (40 px), `CLASE_CASILLA`, `CLASE_ENLACE` y
  `CLASE_FOCO` (solo el anillo, para lo que no es control). `Seccion` es una
  tarjeta con la `legend` adentro.
- **Ojo al sumar clases**: Tailwind 4 ordena las utilidades por nombre (orden
  natural), no por el orden del string. `${CLASE_BOTON_SECUNDARIO} py-1` **no**
  achica el botón (`py-1` va antes que `py-2`); `bg-red-800` sobre el primario
  sí gana (`bg-r…` va después de `bg-p…`). Por eso cada variante es una
  clase entera y no una suma: en la segunda etapa se reemplazaron todos los
  `${CLASE_BOTON_SECUNDARIO} px-2 py-1` (y `py-1`, `py-0.5 text-xs`,
  `text-red-800`, `border-amber-500 bg-amber-50…`, `bg-red-800`) por las
  variantes de abajo. No quedan sumas sobre los botones.
- **Variantes de botón** (segunda etapa, en `formulario.tsx`):
  `CLASE_BOTON_COMPACTO` (32 px, 13 px de texto: acciones de filas y listas;
  32 px sigue sobre el mínimo de 24 px de WCAG 2.5.8),
  `CLASE_BOTON_COMPACTO_PRIMARIO` (Confirmar en la bandeja),
  `CLASE_BOTON_COMPACTO_PELIGRO` (Quitar, Suprimir datos, Desactivar),
  `CLASE_BOTON_ADVERTENCIA` (40 px ámbar: "Dar pase · Faltan N", "Concluir ·
  Faltan N"), `CLASE_BOTON_SECUNDARIO_PELIGRO` (Anular, Descartar borrador…) y
  `CLASE_BOTON_PELIGRO` (el botón rojo que confirma: anular, revertir, purgar,
  suprimir, descartar, retirar, quitar, desactivar). `Pie` de los diálogos de la
  ficha y `DialogoConfirmar` de administración aceptan `peligro`.
- **`globals.css`**: `tarjeta` (utilidad: radio 12 px, borde, sombra ligera),
  `titulo-seccion`, `insignia` (pastilla de estado; el color lo dan
  `COLOR_ESTADO`, `CLASE_SEMAFORO` o las clases semánticas con `ring-1
  ring-inset`) y `tabla-datos` (componente: encabezado tintado en mayúsculas
  chicas, separadores y hover de fila). Un `:focus-visible` base da el anillo
  azul a todo lo que no trae el suyo. Con `prefers-reduced-motion: reduce` se
  apagan transiciones y animaciones.
- **`src/components/dialogo.tsx`**, **`etiquetas.tsx`**, **`aviso-error.tsx`**,
  **`en-construccion.tsx`** y las clases de `src/lib/presentacion/textos.ts`
  (`COLOR_ESTADO`) y `estados.ts` (`CLASE_SEMAFORO`) usan los tokens.
- **Contenedor de las tablas**: `tarjeta relative @container overflow-x-auto`.
  El `relative` sigue haciendo falta: sin eso, los `sr-only` (posición
  absoluta) de las celdas se ubicaban respecto de la página y la ensanchaban en
  el celular (la bandeja daba 874 px de ancho en 390). Desde la etapa
  responsive ninguna tabla se desplaza de costado en los anchos medidos: el
  `overflow-x-auto` queda solo como red de seguridad (ver "Tablas y
  tarjetas").
- **`src/components/iconos-modulos.ts`**: el ícono de lucide de cada módulo,
  compartido por la barra lateral y los accesos rápidos.

Agregados en la segunda etapa:

- **`Seccion`** acepta `numero` (el orden del bloque en un círculo
  decorativo, `aria-hidden`: el nombre del grupo sigue siendo el título) y una
  `descripcion` con nodos.
- **`src/components/aviso.tsx`** (`Aviso`): panel informativo en línea con
  tono `info`, `exito`, `advertencia`, `error` o `neutro`, ícono y título
  opcionales. No pone `role`: quien lo usa decide si es `status`, `alert` o
  texto fijo.
- **`src/components/encabezado-pagina.tsx`** (`EncabezadoPagina`): "volver"
  opcional, antetítulo chico, h1 de 24 px, bajada y acciones a la derecha (abajo
  en el celular).
- **`src/components/estado-vacio.tsx`** (`EstadoVacio`): ícono, frase y ayuda;
  con `imagen` (`parque-memorial` o `avenida-azul`) la foto ocupa el 40 %
  derecho bajo un velo blanco y nunca queda texto encima (desde `sm`; en el
  celular no se muestra).
- **`src/components/pestanas.ts`** (`clasePestana`): las pestañas de la
  bandeja, administración, auditoría, catálogos y el editor de plantillas
  (subrayado azul de 2 px en la actual).
- **`.tabla-datos`** trae ahora el relleno de las celdas (8 × 12 px, 16 px en
  los bordes de la tarjeta, alineadas arriba) y encabezados sin cortes: las
  tablas no repiten `px-3 py-2` (si una celda lo pone, gana).
- **Barra de acciones fija** (`.barra-acciones`, en el formulario de alta y
  edición): `html:has(.barra-acciones)` reserva 5,5 rem de `scroll-padding`
  abajo para que el campo con foco nunca quede tapado (WCAG 2.4.11).
- **`src/app/(app)/buscador-global.tsx`**: la búsqueda del encabezado; en el
  celular, detrás del botón "Buscador" (disclosure como el menú).

## Marca

`src/components/marca-municipal.tsx` (`MarcaMunicipal` y `LogoMunicipal`).
**No hay logo oficial**: se muestra un monograma "SMT" con borde punteado,
claramente provisorio (no es un escudo ni un isotipo). Para poner el oficial:

1. Copiar el archivo de Comunicación a `public/imagenes/marca/` (SVG si lo
   hay; si no, PNG o WebP de al menos 160 px de alto), y si existe una versión
   para fondo oscuro, también.
2. Completar `LOGO_OFICIAL` en ese archivo (`claro`, `oscuro` y
   `proporcion`).

La barra lateral, el ingreso, `/sin-acceso` y `/dev/login` lo toman de ahí.

## Pantallas de la primera etapa

- **Ingreso (`/login`)**: dividido en escritorio (foto con velo azul a la
  izquierda, 57 % del ancho; panel sobre degradado azul muy claro a la
  derecha); en tablet y celular la foto queda como franja de 96 a 144 px sin
  texto. Solo "Ingresar con Cidituc", los mensajes de `?error=`, el aviso de
  salida, el login simulado donde corresponde y el aviso de uso interno y Ley
  25.326. `/sin-acceso` y `/dev/login` con la misma marca y tarjetas.
  (Desde el 27/10/2026, el formulario propio: ver "Ingreso con usuario y
  contraseña".)
- **Cáscara (`src/app/(app)/layout.tsx` y `navegacion.tsx`)**: barra lateral
  azul institucional en escritorio (desde la etapa responsive, desplegable a
  una franja de íconos: ver "Barra lateral desplegable y responsive"; sticky, con íconos y el ítem activo con
  fondo más claro y barra amarilla); en tablet y celular, franja con la marca y
  el botón "Menú" (`aria-expanded`, `aria-controls`; Escape cierra y devuelve
  el foco; se cierra al navegar). Encabezado blanco con la búsqueda global, el
  contador "Por confirmar" (ámbar si hay), nombre, área, iniciales y Salir.
  Solo los módulos de `navegacionPara()`. Barra y encabezado llevan
  `print:hidden`: los imprimibles salen como antes.
- **Panel (`/panel`)**: portada panorámica compacta con la foto de la avenida,
  la marca y los accesos rápidos a los módulos del rol (los de la barra menos
  el panel; para el admin, las secciones de Administración). Debajo, el panel
  de siempre con tarjetas y tablas del sistema nuevo. Todos los números son los
  del dominio. La portada no sale en el papel.

## Imágenes

En `public/imagenes/`, WebP en dos anchos (1600 y 960 px), convertidas una sola
vez con sharp desde los PNG de 1672×941 del paquete (el moodboard no se
publica: es solo referencia). Se usan con `<img>` común, `srcset`/`sizes`,
`alt=""` (son decorativas) y `decoding="async"`: nginx tiene cerrado
`/_next/image`.

| Archivo | Peso (1600 / 960) | Uso |
|---|---|---|
| `ingreso-paseo-sereno-*.webp` | 198 KB / 92 KB (calidad 78) | Ingreso (`loading="eager"`, `fetchpriority="high"`) |
| `panel-avenida-memorial-*.webp` | 79 KB / 38 KB | Portada del panel |
| `avenida-azul-*.webp` | 182 KB / 92 KB | Banda de Administración (bajo el velo de la portada) y estado vacío de la búsqueda |
| `parque-memorial-*.webp` | 273 KB / 118 KB (calidad 70) | Estado vacío de "Por confirmar" en la bandeja y franja de "No encontrada" |

Las dos que quedaban preparadas se usan desde la segunda etapa, siempre como
decorado (`alt=""`), en el ancho de 960 salvo la banda de Administración (con
`srcset`) y nunca con texto encima, salvo la banda, que lleva el mismo velo
`from-institucional/95 via-institucional/90 to-institucional/75` medido para
la portada del panel en celular y tablet (texto blanco ≥ 7:1). En los estados
vacíos la foto ocupa el 40 % derecho bajo un velo blanco y el texto queda a la
izquierda, sobre blanco.

## Pantallas de la segunda etapa

- **Encabezado en el celular**: una sola fila de 57 px (antes, unos 170 px
  apilados): botón "Buscador" (`aria-expanded`/`aria-controls`; al abrirse el
  foco va a la caja, Escape la cierra y devuelve el foco, se cierra al navegar;
  el formulario sigue al botón en el DOM), "Por confirmar" con ícono y número
  (el texto queda `sr-only`), nombre y área truncados, y Salir solo con ícono
  (nombre accesible "Salir"). Desde `sm` vuelve al encabezado de siempre.
- **Nuevo expediente y edición** (`/expedientes/nuevo`, `_formulario/`,
  `/editar`): `EncabezadoPagina` con los dos pasos del alta ("Trámite y
  cementerio" → "Datos del expediente", `aria-current="step"`; en el celular se
  lee solo el actual). Paso 1 en una tarjeta numerada, con íconos de trámite y
  cementerio, asterisco en los obligatorios, ayuda y Cancelar. El formulario va
  por bloques numerados: 1. Información del trámite (tipo, plantilla y
  cementerio como indicadores con ícono; forma de pago como opciones-pastilla),
  2. Monumento y ubicación (los campos del cementerio en un recuadro
  "Ubicación · cementerio", padrón y N° municipal), 3. Personas, 4. Datos del
  trámite, 5. Documentación recibida con el alta (Dirección y Concesionario en
  dos columnas, con "N de M" marcados), 6. Observaciones y fecha de inicio (y 7.
  Motivo del cambio en la edición, cuando hace falta). La numeración cuenta solo
  los bloques que se muestran. Resumen de errores con los tokens de error,
  filete rojo y contador ("2 datos"); los campos con error, en rojo
  (`aria-invalid`). La barra de acciones queda fija al pie: "Guardar e imprimir
  carátula" (primario y primero: Enter en un campo sigue enviando con él),
  "Guardar" (secundario), Cancelar y, si hay errores, "N datos para corregir",
  que vuelve al resumen. Nombres, ids, validaciones, payloads y orden de
  tabulación sin cambios.
- **Bandeja**: pestañas con `clasePestana` (en el celular se desplazan de
  costado, con un desvanecido a la derecha), bajada con ícono, tabla
  `tabla-datos` en tarjeta. Devueltos: fila `error-fondo` y franja roja a la
  izquierda; vencidos en Plazos, igual y más claro; demorados en rojo con un
  reloj; semáforo y "Sin confirmar" como insignias. La confirmación en lote es
  una barra que se tiñe de azul al elegir; Confirmar (compacto primario), Dar
  pase rápido, Transcribir y Abrir con los compactos. El pase rápido muestra "de
  → a". Estados vacíos por pestaña (`EstadoVacio`; "Por confirmar" con
  `parque-memorial`).
- **Búsqueda** (`/expedientes`): caja única con ícono y ayuda; los filtros, en
  la misma tarjeta, en un `details` con contador y los estados como
  opciones-pastilla. Resultados en `tabla-datos`, "Coincide por" como
  insignias, Exportar CSV en las acciones del encabezado. Sin resultados:
  `EstadoVacio` con `avenida-azul` y sugerencias (la frase "No se encontraron
  expedientes con esos datos." sigue en la línea del conteo, la región viva).
- **Ficha**: cabecera en tarjeta con antetítulo (expediente y tipo de
  trámite), número, estado y situaciones como insignias (en el mismo contenedor
  que el h1) y los datos, con "Paso actual" y "Área actual" destacados.
  Acciones agrupadas al pie de la cabecera: las del paso (`role="group"`,
  "Acciones del paso") y las de estado ("Estado del expediente"; Anular en
  rojo), y aparte una fila de compactos (Editar, imprimir, transcribir,
  WhatsApp). "Qué falta" en `advertencia` (o `exito` si no falta nada).
  Recorrido como línea de pasos: cumplidos con tilde verde, el actual en azul
  con la insignia "Paso actual", pendientes en gris; subtareas con casillas
  dibujadas. Documentación con insignias de estado y los botones en la fila de
  la ayuda. Historial con un punto por tipo (pase azul, devolución roja, el
  resto institucional; gris si se revirtió). Diálogos: los pies van en rojo
  para lo irreversible; el menú "Corregir", con tokens.
- **Transcripción**: cabecera en tarjeta con "Volver a la ficha", estado e
  insignia "Carga histórica"; secciones con `titulo-seccion`; Quitar en rojo
  compacto; "Terminar" en rojo cuando corresponde.
- **Administración**: banda azul con `avenida-azul` y el menú de secciones
  como pastillas (la actual en blanco; foco blanco sobre el azul). Inicio con
  las secciones como tarjetas y lo pendiente en un aviso ámbar. Tablas
  `tabla-datos`, pestañas con `clasePestana`, botones compactos,
  confirmaciones destructivas en rojo.
- **No encontrada**: la tarjeta de `/sin-acceso` con una franja de
  `parque-memorial` y "Ir al inicio" como botón.
- **Microinteracciones**: hover de tarjetas enlazadas (borde azul y sombra
  elevada), flecha que se corre 2 px, pestañas y filas con transiciones de 120
  a 150 ms. La regla global de `prefers-reduced-motion` (`globals.css`) las
  deja en 0,01 ms. Ojo: `transition-colors` también anima el color del anillo
  de foco (150 ms desde el color del texto); con movimiento reducido es
  instantáneo.
- **Imprimibles**: sin cambios. La barra, el encabezado (con el buscador), las
  acciones de la ficha y la banda de Administración llevan `print:hidden`; los
  puntos del historial no salen en papel.

## Barra lateral desplegable y responsive

Pedido: en una notebook (ventana de unos 1280 × 720) la bandeja no entraba: la
columna de acciones quedaba cortada, Titular, Trámite y Paso se partían en 4 o
5 renglones y la barra lateral fija de 256 px le quitaba espacio.

### Barra lateral desplegable

- **Escritorio (desde 1024 px)**: arriba de los módulos, junto al rótulo
  "Módulos", un botón de ícono "Contraer menú" / "Expandir menú"
  (`aria-expanded`, `aria-controls` apuntando a la barra; el nombre accesible
  va en `sr-only`). Contraída, la barra mide 72 px (`w-18`): cada ítem muestra
  solo su ícono, conserva su nombre (el texto queda `sr-only`, no `hidden`) y
  el activo sigue con el fondo `institucional-activo` y la barra amarilla. La
  marca queda en el monograma "SMT" (el texto de la marca, `sr-only`: el enlace
  al inicio conserva su nombre). El rótulo "Módulos" y el aviso de la Ley
  25.326 se ocultan.
- **Globos** (tooltips): con la barra contraída, el nombre de cada ítem aparece
  a la derecha al pasar el mouse y al enfocar con el teclado; el botón de
  contraer lo muestra siempre. Blanco sobre `texto` (14,10:1). Van adentro del
  enlace (`aria-hidden`: el nombre ya está), así se puede pasar el mouse por
  encima sin que desaparezcan, y Escape los oculta hasta pasar a otro ítem
  (WCAG 1.4.13).
- **Preferencia**: cookie `cementeria_barra` (`expandida` o `colapsada`, un
  año, `SameSite=Lax`, `Secure` en https; `src/lib/presentacion/barra-lateral.ts`).
  No es localStorage: el layout la lee en el servidor (`await cookies()`, que en
  Next 16 es asíncrona) y la manda a `BarraLateral`, que la pone en
  `data-barra`. La primera pintura ya sale como la dejó la persona, sin
  parpadeo, en esa pantalla, en las demás y al recargar.
- **Sin preferencia** (`data-barra="auto"`): contraída entre 1024 y 1279 px y
  expandida desde 1280. Lo resuelve el CSS, así que tampoco parpadea; el
  `aria-expanded` se corrige al hidratar (`useSyncExternalStore` con
  `matchMedia`). Por qué 1280: con la barra expandida a 1280 el contenido tiene
  960 px y las tablas entran (ver abajo); por debajo, cada píxel cuenta. A
  1280 justos (la notebook del pedido, si el navegador ocupa toda la pantalla)
  arranca expandida, y si la ventana es un poco más angosta, contraída.
- **Variante `barra-colapsada:`** (`globals.css`, `@custom-variant`): aplica
  desde `lg` cuando `data-barra="colapsada"`, o con `"auto"` entre 64rem y
  80rem. Se usa como cualquier variante: `barra-colapsada:w-18`,
  `barra-colapsada:sr-only`.
- **Transición** de 200 ms del ancho; con `prefers-reduced-motion` la regla
  global la deja instantánea.
- **Tablet y celular**: sin cambios de comportamiento: franja con la marca y el
  botón "Menú" (disclosure). La preferencia de escritorio no se aplica ahí (la
  variante empieza en `lg`), la lista siempre muestra los nombres y el botón de
  contraer no existe en esos anchos (`hidden lg:flex`).

### Breakpoints

| Ancho de ventana | Barra | Contenido (con `px-8`) |
|---|---|---|
| < 768 (celular) | Franja con "Menú" | ancho − 32 |
| 768–1023 (tablet) | Franja con "Menú" | ancho − 32 |
| 1024–1279 | Contraída por defecto (72 px) | 888 a 1144 |
| ≥ 1280 | Expandida por defecto (256 px) | 960 (1280) · 1046 (1366) · 1120 (1440) |

Las tablas no miran el ancho de la ventana sino el de su contenedor
(**container queries** de Tailwind 4: `@container` en el contenedor y
`@4xl:`, `@2xl:` en los hijos), porque el espacio depende de si la barra está
contraída. Umbrales usados: `@2xl` (42rem, 672 px: tarjetas en dos columnas),
`@4xl` (56rem, 896 px: tabla de la bandeja y la búsqueda), `@5xl` (64rem,
1024 px: el panel pasa a dos columnas).

### Tablas y tarjetas

Dos patrones, elegidos pantalla por pantalla:

1. **Tabla o tarjetas** (bandeja y búsqueda, las más usadas): dos vistas del
   mismo dato. Desde 56rem de contenedor, tabla `table-fixed` con anchos por
   `colgroup` (número 9,5rem, días 8rem, etiquetas 9,5rem, acciones 9,75rem;
   Titular, Trámite y Paso se reparten el resto), textos en hasta dos renglones
   (`line-clamp-2`) o uno (`truncate`) con el texto completo en `title` (y
   entero en el DOM: el lector de pantalla lo lee completo), N° municipal
   debajo del número interno en la bandeja y acciones apiladas en botones
   compactos que no se parten (`whitespace-nowrap`). Debajo de 56rem, una
   tarjeta por expediente (`ul` con el mismo nombre que la tabla): número y
   titular arriba, una lista de definición con trámite, paso, días en el área,
   vencimiento y N° municipal, las etiquetas en fila y las acciones al pie;
   devueltos y vencidos con la franja roja. **La vista que no corresponde queda
   con `display: none`** (`hidden @4xl:block` / `@4xl:hidden`): nunca hay dos
   botones con el mismo nombre accesibles a la vez, y las pruebas (que corren
   a 1280) siguen encontrando la fila (`row`) y sus botones.
2. **Tabla apilable** (panel, administración y transcripción):
   `tabla-apilable` (apila por debajo de 48rem), `tabla-apilable-amplia`
   (56rem) o `tabla-apilable-compacta` (30rem), con `@container` en el
   contenedor y `data-etiqueta` en cada celda. Angosta, cada fila es un bloque
   separado (como una tarjeta), el encabezado de la fila va primero (`order:
   -1`) y cada celda muestra su rótulo a la izquierda (contenido generado, que
   también se lee). Un solo DOM: los botones con diálogos y estado
   (Usuarios, Catálogos, Feriados, la grilla de transcripción) no se duplican.
   Las reglas van fuera de las capas para ganarle a las utilidades de las
   celdas y solo en `@media screen`: en el papel las tablas salen como tablas.

Pantalla por pantalla:

- **Bandeja**: tabla desde 56rem (1280 con la barra expandida ya es tabla, sin
  desplazamiento y con las acciones enteras); tarjetas en 1024 con la barra
  expandida, tablet y celular (dos columnas desde 672 px de contenedor).
- **Búsqueda**: igual que la bandeja; "Coincide por" y el estado pueden pasar a
  dos renglones.
- **Panel**: la matriz apila por área por debajo de 56rem (cada tipo de trámite
  con su número enlazado); demorados, sin confirmar y cargas históricas por
  debajo de 48rem; plazos y movimientos (tres columnas) por debajo de 30rem.
  Los bloques de a dos (plazos, diferidos y correcciones) van lado a lado solo
  desde 64rem de contenedor (antes, desde `lg`, quedaban de 338 px en 1024).
  Las pastillas de estado pueden partirse ("Espera de pago en la DIM").
- **Administración**: Usuarios y Áreas, apilables amplias (siete columnas con
  acciones); auditoría (accesos y cambios), plantillas, tipos de monumento y
  de trámite y feriados, apilables.
- **Transcripción**: la grilla es tabla desde 56rem (sin desplazarse en 1280
  con la barra expandida: el mínimo bajó de 960 a 896 px) y debajo cada fila
  es una tarjeta con el rótulo de cada control. Los controles, sus nombres y
  la navegación con el teclado no cambian.
- **Ficha, alta, edición y diálogos**: no hubo que tocarlos: miden sin
  desborde en todos los anchos y los botones no se parten (la barra de
  acciones del formulario es `sticky`, no depende del ancho de la barra
  lateral).

### Mediciones

`scrollWidth` contra `clientWidth` del documento, y botones y enlaces de las
tablas visibles dentro de la ventana, con el arnés de e2e (base efímera con la
semilla y sus escenarios en todas las áreas), en 1280 × 720, 1366 × 768,
1024 × 768, 768 × 1024 y 390 × 844, con la barra expandida y contraída (en
tablet y celular la barra es la franja): bandeja (Liquidación y Mesa, en sus
pestañas), búsqueda con resultados (por texto y por número), panel, ficha,
alta, Usuarios, Auditoría (accesos y cambios), Plantillas, Catálogos y
transcripción. 128 de 128 sin desborde y sin acciones cortadas. Lo único que
se desplaza de costado son las pestañas de la bandeja en el celular, a
propósito (con el desvanecido).

## Historial de la ficha (26/10/2026)

Filtros y agrupación del bloque Historial (`historial-filtrable.tsx`) y
"Verificar integridad" (`verificar-integridad.tsx`). Sin tokens nuevos:

- **Filtros** en una caja `rounded-control border-borde bg-fondo/70`, con
  rótulos `text-xs` en mayúsculas `texto-secundario` (5,23:1 sobre el fondo).
  Cada opción es una **pastilla** (`rounded-full`, 32 px de alto como
  `CLASE_BOTON_COMPACTO`, foco con `CLASE_FOCO`) con `aria-pressed`: apretada,
  borde y texto `primario-oscuro` sobre `superficie-azul` (5,95:1) y una tilde
  (la señal no es solo el color); suelta, borde `borde-control` (3,64:1) sobre
  blanco. La cantidad de cada tipo va en `texto-secundario`. El paso es un
  `<select>` con `CLASE_CONTROL`. "Se ven N de M movimientos" en una región
  viva (`aria-live`; el `role="status"` de la ficha queda para el aviso de la
  última acción).
- **Grupos**: título del tramo `text-sm font-semibold text-institucional` con
  filete `border-borde`, el detalle (fechas y días hábiles) en
  `texto-secundario` con `tabular-nums` e insignia "Está acá" en `primario`
  (blanco encima, 4,73:1). En papel, la insignia va con borde y sin relleno.
- **Verificar integridad**: botón compacto en el título del bloque; el
  resultado ocupa la fila de abajo, en `exito` sobre `exito-fondo` (6,46:1) o
  `error` sobre `error-fondo` (5,76:1), con ícono de escudo y el hash en
  monoespaciada (la huella en negrita).
- **Imprimibles**: el historial va agrupado por tramo (`h2` por tramo) y los
  dos llevan la huella al pie, en monoespaciada. Los filtros y el botón son
  `print:hidden`.

## Gráficos (métricas de gestión, 26/10/2026)

`/panel/metricas` es la primera pantalla con gráficos. Sin librerías (ni de
gráficos ni de JavaScript en el navegador): HTML y CSS hechos a mano en
`src/app/(app)/panel/metricas/graficos.tsx`, Server Components. La escala está
en `src/lib/presentacion/graficos.ts` (pura, con tests).

- **Formas**: barras horizontales para comparar categorías con nombres largos
  (tiempo por paso, punta a punta por trámite, motivos, carga por área, antes y
  con el sistema) y columnas para el tiempo (flujo por mes o semana y el stock
  al cierre). Nunca dos ejes: dos medidas distintas van en dos gráficos.
- **Escala**: arranca en 0 (son magnitudes) y termina en un tope redondo (1, 2
  o 5 × 10ⁿ) con hasta 4 intervalos y marcas enteras (`escala()`); la barra
  ocupa `valor ÷ tope` del largo (`porcentajeDe()`, nunca se sale). Sin datos,
  de 0 a 1.
- **Marcas**: barras de 14 px y columnas de hasta 24 px, con la punta
  redondeada (4 px) y la base recta; líneas de la grilla de 1 px en `borde`
  (decorativas) y el eje en `borde-control`. Una barra con valor mayor que 0
  tiene siempre un mínimo visible.
- **Colores** (relleno, WCAG 1.4.11 pide 3:1 contra el blanco): la serie
  principal en `primario` (4,73:1), la segunda (o lo destacado, como el cuello
  de botella) en `institucional` (13,25:1) y la línea de base ("antes del
  sistema") en gris `borde-control` (3,64:1). El validador de paletas marca a
  `institucional` como muy oscuro y poco saturado para una paleta categórica;
  se acepta porque con `primario` se distingue de sobra (ΔE 29,7 en visión
  normal y 30,1 con deuteranopía) y nunca es la única señal. Al imprimir se
  conservan (`print-color-adjust: exact`).
- **Rótulos**: el valor va escrito en la punta de cada barra (y sobre cada
  columna si hay 16 o menos), en `texto` (nunca del color de la serie), en un
  margen reservado a la derecha para que no se corte. Las etiquetas de las
  barras van a la izquierda (13 rem) y, en un contenedor de menos de 36 rem,
  arriba de la barra (container query `@xl`). En el eje de las columnas, si hay
  más de 8 períodos los rótulos se saltean (`saltoDeRotulos()`). Leyenda solo
  con dos series o más. Lo destacado lleva además un texto ("Cuello de
  botella": blanco sobre `institucional`, 13,25:1).
- **Accesibilidad**: cada gráfico es un `figure` con un `role="img"` y un texto
  alternativo que dice qué muestra y el dato principal ("Mediana de días
  hábiles en cada paso. El cuello de botella es …"); los números van en la
  **tabla** que sigue (apilable), que es la fuente de verdad y lo que baja
  "Exportar CSV". Cada barra tiene su globo (`title`) con el dato completo.
- **Cifras clave** (`Cifra`, en `piezas.tsx`): rótulo `texto-secundario`, valor
  24 px `institucional`, y debajo la comparación con la línea de base o el
  contexto; la mejora en `exito` y el empeoramiento en `error`, siempre con el
  texto que lo dice ("−8 días hábiles (−40 %) respecto de antes del sistema").
  Con búsqueda equivalente, la tarjeta entera es el enlace. "Muestra chica" en
  `advertencia` sobre blanco (6,80:1).
- **Responsive**: la pantalla es `@container`; las secciones de a dos y los
  gráficos lado a lado desde 56 rem de contenedor (`@4xl`); las tablas son
  apilables (`tabla-apilable`, `-amplia` para la de pasos, `-compacta` para las
  de tres columnas). Medido (scrollWidth = clientWidth) en 1440, 1280, 1024,
  768 y 390, con la barra expandida y contraída, y por semana en 390: 11 de 11
  sin desborde y ningún botón, enlace, tabla o gráfico fuera de la ventana.

## Campana de avisos (26/10/2026)

`src/app/(app)/campana-avisos.tsx` (Client Component), en el encabezado, a la
izquierda del nombre; solo para quien recibe avisos (operadores con área).
`/avisos` es la lista completa. Sin tokens nuevos. Ver docs/api-dominio.md,
sección 21.

- **Botón**: 40 × 40 px como el resto del encabezado (`rounded-control`,
  borde `borde-control`, hover y abierto en `superficie-azul` con
  `primario-oscuro`, foco con `CLASE_FOCO`), ícono `Bell` y, si hay no leídos,
  el número en una pastilla blanco sobre `institucional` (13,25:1; "99+" desde
  100). El número es decorativo (`aria-hidden`): el nombre accesible es "Avisos,
  3 sin leer" o "Avisos, ninguno sin leer". Cuando el refresco trae avisos
  nuevos, una región `aria-live="polite"` (sin `role="status"`, para no
  mezclarse con el aviso de la última acción de la ficha) dice "Avisos nuevos:
  N sin leer".
- **Panel**: patrón disclosure (`aria-expanded`, `aria-controls`), no un
  menú: adentro hay enlaces y un botón. Tarjeta blanca `rounded-tarjeta` con
  `shadow-elevada`, 26 rem de ancho anclada a la derecha de la campana desde
  `sm`; en el celular, del ancho del encabezado (menos 8 px por lado) y debajo
  de él (la fila del encabezado es `relative`), así el encabezado sigue siendo
  una sola fila. Al abrirse el foco va al título del panel ("Avisos · 3 sin
  leer", `tabIndex=-1`); Escape lo cierra y devuelve el foco a la campana; se
  cierra al hacer clic afuera, al salir con Tab y al cambiar de pantalla. Arriba,
  "Marcar todos como leídos" (`CLASE_BOTON_COMPACTO`); al pie, "Ver todos los
  avisos" (`CLASE_ENLACE` sobre `fondo` al 60 %: 6,43:1). La lista se desplaza
  sola (hasta 26 rem o el 65 % de la ventana).
- **Cada aviso**: un enlace a la ficha con el ícono del tipo en un círculo
  (`IconoAviso`, `src/components/icono-aviso.tsx`: `Inbox` llegó, `Undo2`
  devuelto, `Hourglass` por vencer, `CalendarX2` vencido, `SendHorizontal` sin
  confirmar, `Clock` demorado, `Archive` concluido o archivado), el título (una
  línea), el texto (dos, `line-clamp-2`; entero en el DOM) y "hace cuánto"
  (`<time datetime>`). Sin leer: fondo `superficie-azul` al 40 % (texto 13,46:1,
  secundario 5,36:1), título en negrita, un punto `primario` decorativo y "Sin
  leer:" para lectores de pantalla. El foco va por dentro (`-outline-offset-2`)
  para que no lo corte el desplazamiento de la lista.
- **Tonos** (`TONO_TIPO_AVISO`, `src/lib/presentacion/avisos.ts`): los de
  **prioridad alta** (devuelto y plazo vencido) en `error`: ícono `error`
  sobre `error-fondo` (5,76:1), franja roja de 4 px a la izquierda (`border-error`,
  6,57:1 contra el blanco) y la insignia "Prioridad alta" (el color nunca va
  solo). Plazo por vencer, sin confirmar y demorado en `advertencia` (6,21:1);
  llegó en `info` (5,95:1); concluido o archivado, neutro (`texto-secundario`
  sobre `fondo`, 5,23:1).
- **`/avisos`**: `EncabezadoPagina` con "Marcar todos como leídos"
  (secundario); filtros en una tarjeta: "Todos" / "No leídos" como pastillas
  enlazadas con `aria-current` y una tilde (como los filtros del historial) y el
  tipo en un `<select>` con "Filtrar" (formulario GET, anda sin JavaScript);
  la cuenta en una región viva; la lista en una tarjeta, una fila por aviso con
  el mismo ícono, tono y franja que el panel, insignias "Prioridad alta" y "Sin
  leer", y "Marcar como leído" / "Marcar como no leído" (compacto, con el
  título en el nombre accesible). En el celular el botón baja debajo del texto.
  Paginado de a 25 con Anterior y Siguiente. Mesa de Entradas tiene además
  "Preferencias" (la casilla de "Concluido o archivado").

## Ingreso con usuario y contraseña (27/10/2026)

El ingreso con Cidituc quedó en pausa; `/login` conserva la foto, el panel, la
marca y el aviso de la Ley 25.326, y en la tarjeta "Ingresar" pone el
formulario (`src/app/login/formulario-ingreso.tsx`):

- **CUIL o correo** (`autocomplete="username"`, con la ayuda "con o sin
  guiones") y **Contraseña** (`current-password`) con un botón **Mostrar /
  Ocultar** dentro del campo, a la derecha (`aria-pressed`, `aria-controls` y
  "la contraseña" para lectores de pantalla). Botón primario "Ingresar" a todo
  el ancho, de 44 px, como el de Cidituc.
- El error es un solo aviso rojo (`role="alert"`) arriba de los campos, con el
  mismo texto para cualquier rechazo; los dos campos quedan `aria-invalid` y
  describen el error; el CUIL se conserva, la contraseña se borra y recibe el
  foco.
- Debajo, en gris, el bloqueo (5 intentos, 15 minutos) y a quién pedir un
  blanqueo. El botón de Cidituc (solo con `CIDITUC_HABILITADO=1`) va debajo,
  secundario, separado por "o"; el login simulado, al pie, como antes.
- La foto es un componente compartido (`src/components/foto-ingreso.tsx`).

`/cambiar-clave` usa el mismo diseño (foto y panel): título "Cambiar
contraseña" con el nombre, un aviso ámbar "Tu contraseña es temporal" cuando es
obligatorio, los tres campos con `Campo` (la nueva describe las reglas con
`aria-describedby`), la casilla "Mostrar las contraseñas", las reglas en un
recuadro gris y, al pie, "Volver sin cambiarla" (si no es obligatorio) y
"Salir". En el encabezado de la app, un botón de ícono con la llave
("Cambiar contraseña" para lectores de pantalla) junto a Salir.

En `/admin/usuarios`, la contraseña temporal se muestra en un diálogo propio:
aviso ámbar "Copiala ahora: no se vuelve a mostrar", la contraseña grande en
monoespaciada (`select-all`), "Copiar" (con el resultado en `role="status"`)
y "Listo, ya la copié". La columna Estado suma "Contraseña temporal", "Sin
contraseña" y "Bloqueado hasta …" (en ámbar); las acciones, "Blanquear
contraseña" y, si está bloqueado, "Desbloquear".

`login-1440.png` (en Capturas) se regeneró con el formulario.

## Recorridos guiados (27/10/2026)

Para el piloto: personas de cada área que usan el sistema por primera vez.
Cada pantalla tiene un recorrido corto que resalta cada parte y la explica en
lenguaje de mostrador. Componente propio, sin dependencias (nada de driver.js,
shepherd, intro.js ni react-joyride), sin cambios en la base y sin tokens
nuevos.

### Cómo se ve y cómo se usa

- **Nunca se abre solo.** La primera vez que alguien entra a una pantalla
  aparece una **invitación**: una tarjeta chica abajo a la derecha (en el
  celular, abajo y a lo ancho, con 12 px de margen), con "¿Querés un recorrido
  de esta pantalla?", el nombre de la pantalla y **Empezar** (compacto
  primario), **Ahora no** (compacto) y **No volver a mostrar** (enlace). Es un
  `aside` (región complementaria) al final de la página: no es un diálogo, no
  toma el foco, no bloquea y no anuncia nada. Mientras está, `globals.css`
  reserva 12 rem al pie de `main` y en el `scroll-padding-bottom` (WCAG
  2.4.11: lo que se lleva a la vista o recibe el foco queda por encima de la
  tarjeta); en el alta, la tarjeta se apoya arriba de la barra de acciones fija
  (mide su alto con un `ResizeObserver`) y el espacio va antes de la barra.
  Borde `info-borde`, ícono `Compass` en un círculo `superficie-azul`.
- La **bienvenida** general (el menú y cómo contraerlo, el buscador, "Por
  confirmar", la campana y el "?") se ofrece **una sola vez**, en la primera
  pantalla después del primer ingreso, con "Empezar" y "Ahora no" (cualquier
  respuesta la cierra). Una sola invitación por vista: si se contestó la
  bienvenida (o se abrió un recorrido con el "?"), la siguiente espera a la
  próxima pantalla.
- El botón **"?"** (`CircleHelp`, 40 × 40 como los demás del encabezado,
  nombre accesible "Recorrido de esta pantalla" y `title`) está siempre, a la
  izquierda de la campana; en el celular, en la misma fila del encabezado
  compacto. Abre el recorrido de la pantalla a la vista (en una pantalla sin
  recorrido propio, como la edición o un imprimible, la bienvenida). En
  `/cambiar-clave` (fuera de la cáscara) va junto al título de la tarjeta y la
  invitación va en el flujo de la página, debajo de la tarjeta.
- **El recorrido**: una capa transparente tapa la página (no deja hacer clic;
  un clic devuelve el foco al globo); el elemento del paso queda **recortado**
  sobre un velo `institucional` al 45 % (la sombra de 200vmax del recorte) con
  un anillo blanco de 3 px y otro `primario` de 2 px (4,73:1 contra el blanco).
  El **globo** (22 rem, `rounded-panel`, `shadow-elevada`) va debajo del
  elemento, o arriba, a la derecha o a la izquierda, según el lugar; con un
  elemento más alto que la ventana (una sección entera) se resalta su parte de
  arriba y el globo va al pie. Un paso sin elemento (la presentación de la
  bienvenida) vela toda la página y centra el globo. En el **celular** (menos
  de 40 rem) el globo es una **hoja inferior** a lo ancho (`rounded-t-panel`,
  con el margen seguro de abajo) y el elemento se lleva por encima de ella.
- **Contenido del globo**: el nombre de la pantalla y "Paso N de M"
  (`texto-secundario`, 5,62:1), una barra de avance decorativa (`primario` sobre
  `fondo`), el título (h2, 16 px semibold) y el texto (14 px, `texto`); al pie,
  "Salir del recorrido" (enlace), "Anterior" (compacto, desde el paso 2) y
  "Siguiente" / "Terminar" (compacto primario). En el último paso, además,
  "Reiniciar los recorridos de todas las pantallas".
- **Teclado y lector de pantalla**: el globo es `role="dialog"` con
  `aria-modal="true"`, `aria-labelledby` (el título) y `aria-describedby` (el
  texto), y mientras dura el resto de la página queda `inert` (el lector de
  pantalla no sale del globo aunque no respete `aria-modal`; al salir se le
  saca antes de devolver el foco). Al abrirse el foco entra al globo; Tab y Mayús+Tab dan la vuelta
  adentro; → y Enter (fuera de un botón) avanzan, ← retrocede, Escape sale (en
  captura: no cierra otra cosa). Cada paso nuevo se anuncia en una región
  `aria-live="polite"` ("Paso 2 de 6. Título. Texto"). Al terminar o salir, el
  foco vuelve al botón que lo abrió (el "?") o, si ya no está (el "Empezar" de
  la invitación), al elemento resaltado si se puede enfocar, o al "?".
- **Movimiento**: el recorte se desliza (200 ms) de un elemento al otro; la
  página se desplaza hasta el elemento sin animación (un desplazamiento suave
  interrumpido al pasar pasos rápido dejaba el elemento fuera de lugar). Con
  `prefers-reduced-motion` la regla global deja las transiciones en 0,01 ms. Se reubica al
  desplazarse (también dentro de contenedores), al cambiar el tamaño y si el
  globo cambia de alto (sin estado de React: escribe la posición en el estilo).
- **Impresión**: la invitación, el "?" y el recorrido llevan `print:hidden`, y
  la reserva de lugar de la invitación es solo `@media screen`.

### Qué se recuerda

En el navegador (`localStorage`), nunca en la base: clave
`cementeria:recorrido:<id del usuario>:<pantalla>:v<versión>` con `visto`
(empezó el recorrido, desde la invitación o desde el "?"), `descartado` ("No
volver a mostrar") o `pospuesto:AAAA-MM-DD` ("Ahora no": vuelve a invitar otro
día). Todo envuelto en `try/catch`: si no hay almacenamiento (modo privado
estricto, bloqueado por política) funciona igual y vuelve a invitar. Es por
usuario: en una computadora compartida del mostrador, cada uno tiene lo suyo.
**Versionado**: al cambiar el contenido de un recorrido se sube su `version`
y, como la clave la incluye, se vuelve a invitar a todos en esa pantalla.
**"Reiniciar los recorridos"** (en `/avisos`, para todos los roles, y en el
último paso de cada recorrido) borra las claves de ese usuario: cada pantalla y
la bienvenida vuelven a invitar.

### Por rol

Cada paso apunta a un elemento con un atributo estable,
`data-recorrido="<ancla>"`. Al empezar, el motor arma la lista de pasos: un
paso cuyo elemento **no existe o no se ve** (`display: none`, dentro de un
`<details>` cerrado, de 0 × 0) se saltea solo, así "Dar pase" no aparece para
Dirección, la barra lateral no aparece en el celular (aparece el botón "Menú")
ni "Plazos" para quien no tiene expedientes en la DIM. Con varias anclas
(`ancla: ["bandeja-lote", "bandeja-confirmar", …]`) usa la primera que se ve
(la bandeja tiene tabla y tarjetas: solo una se ve en cada ancho). Los textos
pueden cambiar por perfil: `mesa` (Mesa de Entradas; si no tiene texto propio
usa el de `operador`), `operador`, `direccion` (el rol de lectura) y `admin`,
con `todos` como comodín; un perfil sin texto no ve el paso.

| Recorrido (`id`) | Pantalla | Pasos | Para quién |
|---|---|---|---|
| `bienvenida` | La primera, una vez (y el "?" donde no hay otro) | 7 | Todos (Por confirmar y avisos, solo operadores) |
| `bandeja` | `/bandeja` | 8 | Operadores (Plazos: Tributario y Mesa; Carga histórica: Mesa) |
| `ficha` | `/expedientes/[numero]` | 8 | Todos (Qué falta y Dar pase según el permiso) |
| `expediente-nuevo` | `/expedientes/nuevo`, primer paso | 4 | Mesa y admin |
| `expediente-formulario` | `/expedientes/nuevo`, formulario | 6 | Mesa y admin |
| `busqueda` | `/expedientes` | 6 | Todos (Exportar y Nuevo según el permiso) |
| `transcripcion` | `/expedientes/[numero]/transcribir` | 6 | Mesa |
| `panel` | `/panel` | 7 | Todos |
| `metricas` | `/panel/metricas` | 5 | Dirección y admin |
| `avisos` | `/avisos` (con la campana) | 6 | Operadores; Preferencias, Mesa; Dirección y admin ven solo "Reiniciar" |
| `cambiar-clave` | `/cambiar-clave` | 5 | Todos |
| `admin-inicio` | `/admin` | 4 | Admin |
| `admin-plantillas` | `/admin/plantillas` | 4 | Admin |
| `admin-editor` | `/admin/plantillas/[codigo]/v/[version]` | 6 | Admin |
| `admin-usuarios` | `/admin/usuarios` | 5 | Admin |
| `admin-catalogos` | `/admin/catalogos` | 4 | Admin |
| `admin-auditoria` | `/admin/auditoria` | 4 | Admin |

### Archivos

- `src/lib/presentacion/recorridos/motor.ts`: lo puro (perfiles, textos por
  perfil, qué pasos se muestran, lo recordado, la invitación). Con tests.
- `src/lib/presentacion/recorridos/contenido.ts`: los recorridos. Con tests
  (de 4 a 8 pasos, ids únicos, anclas válidas, textos por rol).
- `src/components/recorrido/`: `proveedor.tsx` (`ProveedorRecorridos`, en la
  cáscara y en `/cambiar-clave`, y `PantallaConRecorrido`, la marca de cada
  página), `invitacion.tsx`, `globo.tsx` (el recorrido en curso),
  `botones.tsx` (el "?" y "Reiniciar los recorridos"), `estado.ts` (pantalla a
  la vista y almacén, para `useSyncExternalStore`: en el servidor no se invita,
  sin diferencias de hidratación) y `dom.ts` (buscar el ancla, si se ve).

### Cómo agregar un paso o un recorrido

**Un paso** en una pantalla que ya tiene recorrido:

1. Poner `data-recorrido="<pantalla>-<cosa>"` en el elemento (un nombre
   simple: minúsculas, números, `-` y `_`). Que sea el elemento que se ve: no
   uno `sr-only` ni uno dentro de un `<details>` cerrado. Si el elemento está
   en una tabla y en sus tarjetas (bandeja, búsqueda), ponerlo en los dos: se
   toma el que se ve. Componentes que ya lo aceptan: `Seccion` y el `Bloque` de
   la ficha (`recorrido="…"`).
2. Agregar el paso en `contenido.ts`, en su lugar: `id` único, `ancla`,
   `titulo` y `texto` (uno para todos o `{ operador, mesa, direccion, admin,
   todos }`). Corto: título de hasta 60 caracteres, texto de hasta 280 (lo
   controla el test), en castellano llano, sin jerga técnica.
3. **Subir la `version`** del recorrido, para que se vuelva a invitar.
4. `npm test` (el contenido tiene sus reglas: de 4 a 8 pasos).

**Un recorrido** para una pantalla nueva:

1. Escribirlo en `contenido.ts` (de 4 a 8 pasos, `version: 1`) y sumarlo a
   `RECORRIDOS` con su id.
2. En la página, `<PantallaConRecorrido id="<id>" />` (de
   `@/components/recorrido/proveedor`; no dibuja nada). Si la página cambia de
   etapa en la misma ruta (como el alta), el id puede depender de la etapa.
3. Las anclas en los elementos, como arriba.
4. Si la pantalla está fuera de la cáscara, envolverla en
   `<ProveedorRecorridos usuarioId perfil bienvenida={false} invitacionEnLinea>`
   y poner el `<BotonRecorrido />` y `<InvitacionRecorrido enLinea />` donde
   correspondan (como `/cambiar-clave`).

## Modo prueba: "Ver como…" (27/10/2026)

Solo existe con `PERFILES_PRUEBA_CUILS` y solo para esos CUILs (README, "Modo
prueba"; docs/api-dominio.md, sección 23). Sirve para recorrer cada perfil con
un mismo usuario. Sin tokens nuevos ni dependencias:
`src/app/(app)/perfil-prueba.tsx` (`SelectorPerfilPrueba` y
`FranjaPerfilPrueba`), textos en `src/lib/presentacion/perfil-prueba.ts`.

- **Selector** (encabezado, a la izquierda del "?"): botón de 40 × 40 como
  los demás, en **ámbar** para que se distinga de los controles de siempre
  (borde `advertencia`, ícono `FlaskConical` en `advertencia` sobre
  `advertencia-fondo`, 6,21:1; abierto, `superficie-azul` con
  `primario-oscuro`, como la campana). Sin texto visible: su nombre accesible
  es "Ver como… (modo prueba, ahora Liquidación)" y tiene `title`; desde `lg`
  suma una flecha (`ChevronDown`) que dice que abre un menú. Con "Por
  confirmar" y la campana, el texto "Ver como…" escrito no entraba.
- **Menú** (patrón *menu button*): el botón lleva `aria-haspopup="menu"`,
  `aria-expanded` y `aria-controls`; el menú es `role="menu"` con el título
  "Ver como…" (`aria-labelledby`) y una línea gris ("Modo prueba: cambia el
  área y el rol de tu propio usuario. Queda en la auditoría."). Una opción por
  perfil (`menuitemradio`): el nombre del área (o "Administrador") y debajo el
  rol ("Operador", "Solo lectura", "Administrador del sistema"); el actual con
  `aria-checked="true"`, una tilde, fondo `superficie-azul` al 60 % y "· el de
  ahora". Al abrirse, el foco va al perfil actual (foco itinerante:
  `tabIndex` 0 solo en la opción activa); ↑ ↓ (dan la vuelta), Inicio y Fin
  recorren; Enter o Espacio eligen; Escape cierra y devuelve el foco al botón;
  Tab o un clic afuera lo cierran. ↓ o ↑ sobre el botón también lo abren. La
  tarjeta es como el panel de la campana (`rounded-tarjeta`, `shadow-elevada`,
  20 rem anclada a la derecha desde `sm`; en el celular, a lo ancho del
  encabezado y debajo de él). Mientras cambia, las opciones quedan
  deshabilitadas y abajo dice "Cambiando de perfil…" (`role="status"`); un
  error va en rojo (`role="alert"`) y el menú queda abierto.
- **Después de elegir**: carga completa del inicio del perfil (la bandeja o el
  panel), así el menú, "Por confirmar", la campana y los recorridos salen ya
  con el perfil nuevo.
- **Franja** (debajo del encabezado, arriba del contenido, a todo el ancho de
  la columna; no toca la barra lateral): mientras el perfil no es
  Administrador. `advertencia-fondo` con borde inferior `advertencia-borde` y
  texto `advertencia` (6,21:1), como "Por confirmar": ícono `FlaskConical`,
  "**Modo prueba:** estás viendo como **Liquidación**" (Dirección: "Dirección
  (solo lectura)"), un punto medio y **Volver a Administrador**
  (`CLASE_BOTON_COMPACTO`, ícono `Undo2`; "Volviendo…" mientras tanto). Es una
  región con nombre ("Modo prueba", `section` con `aria-label`): no toma el
  foco ni se anuncia. En el celular el botón baja a la línea siguiente.
- **Celular y anchos medianos**: con el selector, el nombre y el área del
  encabezado se ocultan por debajo de `xl` (1280 px) y el texto de "Por
  confirmar" aparece recién desde `lg` (antes, ícono y número): sin eso, entre
  `sm` y `xl` el nombre se montaba sobre la llave. En 390 px el encabezado
  sigue siendo una fila de 57 px (buscador, "Por confirmar", selector, "?",
  campana, llave y Salir) y el menú se abre a lo ancho, debajo
  (`tests/e2e/perfil-prueba.spec.ts` lo mide). Para quien no está en la lista
  no cambia nada.
- **Impresión**: el encabezado (con el selector) ya era `print:hidden`; la
  franja también lo es. Los imprimibles salen igual que siempre.


## Página pública (28/10/2026)

Una página por sección, en `src/app/(publico)/` (grupo de rutas con su
layout): `/` (el inicio), `/cementerios`, `/horarios`, `/recorridos`,
`/tramites`, `/consulta` (y `/consulta/[numero]`) y `/contacto`. Hasta el
28/10/2026 era una sola página larga con anclas (`#cementerios`, `#visitas`,
…); ya no hay anclas. Desde el sitio público ([api-dominio.md](api-dominio.md),
sección 25) replica el **boceto aprobado** por el usuario (estructura,
jerarquía y estética), con el contenido que carga la Dirección desde
/admin/sitio-publico. El mismo 28/10/2026, a pedido del usuario ("el fondo se
corta", más orden y contraste, modo oscuro), pasó al **sistema visual de
abajo**: fondo completo y fijo, vidrio esmerilado y modo oscuro. Las piezas
compartidas (el fondo fijo, la barra, el encabezado de las páginas internas
con las migas, el panel de lectura, las invitaciones del pie, el pie, "Saltar
al contenido", el antetítulo en pastilla y el wordmark) están en
`src/components/publico.tsx`; el botón y el script del modo, en
`src/components/tema-publico.tsx`; el contenido de cada página, en
`src/components/landing.tsx`; las páginas, sus títulos, bajadas y textos de
acceso, en `PAGINAS_PUBLICAS` (`src/lib/presentacion/sitio-publico.ts`).
Server Components: el único JavaScript es el del formulario de consulta y el
del botón del modo. Del boceto **no** pasan a la app la marca amarilla
"Boceto", las píldoras "A completar" ni las tres recomendaciones "A validar"
de los horarios.

### Sistema visual: "armonía + tech"

Sobrio e institucional, con la paleta de siempre (`institucional` #0F2F5D,
`primario` #0F68FF, `celeste` #38B2F6, blanco, `fondo` #F4F7FB y el acento
`amarillo` #F4C400) y un detalle técnico discreto: nada de neón ni gradientes
chillones.

- **Fondo completo y fijo** (`FondoPublico`, en el layout, igual en todas las
  páginas): una capa `position: fixed` detrás de todo (`.fondo-publico`,
  `z-index: -1` dentro del contenedor `isolate` del sitio) con
  `landing-panoramica-{960,1916}.webp` (`srcset`, `sizes="100vw"`, `alt=""`,
  `fetchpriority="high"`, `object-fit: cover`, `object-position: 50% 60%`), el
  **velo** (`.velo-publico`) y la **trama** (`.trama-publica`). El contenido
  se desplaza encima y la foto queda quieta; ya no termina a mitad de los
  accesos. **No** es `background-attachment: fixed` (iOS no lo respeta y
  repinta en cada desplazamiento): la capa se compone una vez. Alto `100lvh`
  (con `100vh` de respaldo): en el celular no cambia de tamaño cuando aparece
  o se esconde la barra del navegador. Sin parallax ni animación (nada que
  apagar con `prefers-reduced-motion`), sin `will-change` (no hizo falta) y
  sin desenfoque sobre la foto entera. Al imprimir, no sale.
- **Velo:** un tinte parejo en toda la capa, más denso hacia el centro y
  abajo. En claro (desde el 28/10/2026, variante "B" elegida por el usuario:
  la elipse blanca de antes lavaba la foto), **azul institucional** #0F2F5D
  de 55 a 64 % hacia abajo (55 → 57 → 64 %; el 55 % de arriba es el token
  `pub-velo`) y una elipse detrás del centro (30 → 15 → 0 %, 70 × 60 % en
  50 % 42 %): la foto se ve con color y nitidez, más liviana que en oscuro, y
  el texto que va directo encima es claro (`pub-sobre-foto-*`). **No se
  aclara hacia abajo:** el fondo es fijo y cualquier texto directo sobre la
  foto cae, según el desplazamiento, en cualquier punto del velo. En oscuro,
  azul noche (#050D1C) de 66 a 90 % hacia abajo, y una elipse algo más oscura
  detrás del centro.
- **Trama:** una grilla de 48 px con líneas de 1 px en #8ECBFF al 12 % (claro,
  sobre el velo azul) o `celeste` al 9 % (oscuro), con una máscara que la
  deja solo arriba y se apaga hacia el centro.
- **Vidrio esmerilado** (`.vidrio`, `.vidrio-azul`, en `globals.css`):
  translúcido (`pub-vidrio`: blanco al 84 % en claro, azul noche al 66 % en
  oscuro), `backdrop-filter: blur(12px) saturate(1.3)`, borde de 1 px claro
  (`pub-vidrio-borde`), un **filete con brillo** (un degradé en `::before`,
  blanco arriba a la izquierda y celeste abajo a la derecha, enmascarado al
  borde), un brillo interior de 1 px arriba y la sombra suave `shadow-pub`.
  `.vidrio-azul` es el azul institucional (al 92 % en claro; #16408A al 86 %
  en oscuro) con texto blanco: la tarjeta destacada "Consultá tu trámite" y la
  banda de la consulta. **Sin `backdrop-filter`** (`@supports not`), opacos
  (`pub-vidrio-opaco`). Se usa para lo chico sobre la foto: la barra, los
  accesos, las novedades, las fechas y las invitaciones (claros en claro;
  sobre el velo azul, el borde blanco y la sombra los despegan).
  `.vidrio-foto` es el de las **pastillas y los botones chicos sobre la foto**
  (los antetítulos, las migas, "Horarios de visita" del hero, "Explorá el
  sitio" y "Ver todos los recorridos"): en claro, azul institucional al 62 %
  (`pub-vidrio-foto`, borde blanco al 22 % y el filete con brillo más tenue, opaco #1D3D69) con el texto claro
  (`pub-sobre-foto-*`), del color del velo; en oscuro, igual que `.vidrio`.
  Se eligió el vidrio azul y no uno blanco más opaco: uno blanco sobre el velo
  azul le ganaba al botón primario y cortaba el tono de la foto.
- **Panel de lectura** (`.panel-lectura`): el contenido de las internas,
  casi opaco (`pub-panel`: #F8FAFD al 96 % en claro; #081222 al 94 % en
  oscuro), radio de 16 px, sin desenfoque (no hace falta y no cuesta). Dentro,
  tarjetas opacas (`pub-superficie`, borde `pub-borde`).
- **Halo** (`.halo-publico`, token `pub-halo`): una mancha difusa
  (`blur(48px)`, azul institucional al 38 % en claro, sin brillo blanco; azul
  noche al 32 % en oscuro) detrás del texto que va directo sobre la foto: el
  hero, el `h2` de cada sección del inicio y el encabezado de las internas. El contenido se desplaza sobre una foto fija, así que lo
  que queda detrás cambia al bajar: el halo asegura el contraste en cualquier
  posición (medido abajo).
- **Antetítulo en pastilla** (`ChipPublico`): `.vidrio-foto` con el texto
  `pub-sobre-foto-titulo`, `rounded-full`, el punto
  `celeste` con un anillo y mayúsculas espaciadas (0,12 → 0,16 em, 11 → 12
  px, negrita). Dentro del panel, el antetítulo va sin pastilla
  (`.antetitulo-publico`, `pub-enlace`).
- **Monoespaciada** (`font-mono`, cifras tabulares): los números de
  expediente (el campo y el resultado de la consulta), las fechas del
  resultado y el día de las cajitas de fechas.
- **Línea celeste:** un filete de 1 px (`celeste` al 70 %, que se apaga hacia
  los costados) cierra el hero.
- **Foco:** anillo de 2 px separado 2 px (`pub-foco`: `primario` en claro,
  #5CC8FF en oscuro; `celeste` sobre la barra y el vidrio azul) y, por dentro,
  un filete del color de la superficie (blanco en claro, #050D1C en oscuro)
  con `box-shadow`: así contrasta 3:1 aunque detrás quede una parte oscura (o
  clara) de la foto. Fuera de las capas, para ganarle a la sombra del vidrio
  mientras hay foco. Lo que va directo sobre la foto (los botones del hero,
  "Explorá el sitio", "Ver todos los recorridos", las migas) lleva el foco
  `pub-sobre-foto-foco` (blanco en claro, #5CC8FF en oscuro: sobre el velo
  azul ni el `primario` ni el celeste llegaban a 3:1 en las partes claras
  de la foto).
- **Anchos de lectura:** bajadas en 56–62 ch, los `h2` en 60 ch, novedades y
  respuestas del acordeón en 70–75 ch. Contenedor de 72 rem (`max-w-6xl`) con
  16 → 24 px de margen. Ritmo vertical del inicio: 56 px entre secciones en
  celular y 80 px desde `sm`; cada sección con el mismo encabezado
  (`EncabezadoSeccion`: pastilla, `h2` de 24 → 30 px y, a la derecha, su
  enlace).
- **Contenedor del sitio:** `.sitio-publico` (en el layout) con
  `overflow-x: clip` (los halos no generan desplazamiento lateral; `clip` no
  crea contenedor de desplazamiento y la barra sigue fija).

### Tokens del sitio público (claro / oscuro)

Propios del sitio (`pub-*`, en el `@theme` de `globals.css`): la app interna
no los usa y no cambia. Cada uno lleva sus dos valores con `light-dark()`,
que resuelve según el `color-scheme` de `.sitio-publico`.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `pub-fondo` | #F4F7FB | #07111F | Debajo de la foto mientras carga; fondo del `body` |
| `pub-texto` | #172B4D | #E8EEF7 | Texto |
| `pub-texto-secundario` | #4A5568 | #B3C2D6 | Texto secundario (más oscuro que el `texto-secundario` de la app: va sobre vidrio) |
| `pub-titulo` | #0F2F5D | #FFFFFF | Títulos |
| `pub-enlace` | #0B53CC | #8ECBFF | Enlaces, íconos y antetítulos |
| `pub-borde` | #D5DEEA | #8EB6E8 al 22 % | Bordes de tarjetas y tablas |
| `pub-borde-control` | #7C8798 | #7F93B0 | Borde de los campos (3:1, WCAG 1.4.11) |
| `pub-foco` | #0F68FF | #5CC8FF | Anillo de foco |
| `pub-superficie` | #FFFFFF | #0F1F38 | Tarjetas dentro del panel, campos |
| `pub-tinte` | #EEF3FA | #16294A | Cabecera de tabla |
| `pub-chip` | #E8F2FF | `celeste` al 14 % | Chips, cajitas de ícono, resultado de la consulta |
| `pub-panel` | #F8FAFD al 96 % | #081222 al 94 % | Panel de lectura |
| `pub-vidrio` / `-opaco` | blanco al 84 % / #F8FAFD | #0A182E al 66 % / #0C1A31 | Vidrio / sin `backdrop-filter` |
| `pub-vidrio-borde` | blanco al 80 % | #8EB6E8 al 20 % | Borde del vidrio y del panel |
| `pub-azul` | #0F2F5D al 92 % | #16408A al 86 % | Vidrio azul (destacada, banda) |
| `pub-barra` / `-solida` | #0F2F5D al 86 % / #0F2F5D | #050D1C al 82 % / #08142A | Barra / menú desplegado del celular |
| `pub-pie` | #0F2F5D al 95 % | #040A16 al 95 % | Pie |
| `pub-advertencia` | #8A4B00 | `amarillo` #F4C400 | Megáfono de las novedades |
| `pub-error` / `-fondo` / `-borde` | #B42318 / #FDECEC / #F2B8B5 | #FFB4AB / #B42318 al 20 % / #FFB4AB al 40 % | Error de la consulta |
| `pub-info-borde` | #B5D3FF | #8ECBFF al 32 % | Borde del resultado de la consulta |
| `pub-sobre-foto-titulo` | #FFFFFF | #FFFFFF | Texto directo sobre la foto: `h1` del hero y de las internas, `h2` de sección; texto de las pastillas y del botón secundario del hero |
| `pub-sobre-foto-texto` | #E6EEF9 | #E8EEF7 | Bajadas sobre la foto, la página actual de las migas, "Explorá el sitio" |
| `pub-sobre-foto-secundario` | #C7D6EB | #B3C2D6 | El separador de las migas |
| `pub-sobre-foto-enlace` | #A9DCFF | #8ECBFF | "Inicio" en las migas, íconos y borde al pasar en `.vidrio-foto` |
| `pub-sobre-foto-foco` | #FFFFFF | #5CC8FF | Foco de lo que va sobre la foto |
| `pub-vidrio-foto` / `-opaco` / `-borde` | #0F2F5D al 62 % / #1D3D69 / blanco al 22 % | como `pub-vidrio` | Vidrio de las pastillas y los botones chicos sobre la foto |
| `pub-velo` | #0F2F5D al 55 % | #050D1C al 66 % | El punto más liviano del velo (arriba) |
| `pub-halo` | #0F2F5D al 38 % | #050D1C al 32 % | El halo |

El `amarillo` (filetes, cajitas de los pasos, "Consultar mi trámite", el
subrayado de la página actual) y el `primario` de los botones son los mismos
en los dos modos. Los `pub-sobre-foto-*` dan en oscuro lo mismo que
`pub-titulo`, `pub-texto`, `pub-texto-secundario`, `pub-enlace` y
`pub-foco`: el modo oscuro no cambió con el velo azul del claro.

### Modo oscuro

- **Elección:** por defecto, el del sistema (`prefers-color-scheme`): sin nada
  elegido, `.sitio-publico` no lleva `data-tema` y tiene `color-scheme: light
  dark`. El **botón de la barra** (`BotonTema`, luna en claro y sol en oscuro,
  por CSS con la variante `pub-oscuro:`; `aria-label="Modo oscuro"` y
  `aria-pressed`) alterna y lo guarda en `localStorage`
  (`cementeria.sitio-publico.tema`, con `try/catch`). Si lo elegido coincide
  con el sistema, se borra lo guardado y el sitio vuelve a seguir al sistema.
  Sin `localStorage`, alterna igual mientras dure la página.
- **Sin parpadeo:** `ScriptTema`, el primer hijo del contenedor en el layout,
  es un `<script>` en línea que lee lo guardado y pone `data-tema` en el
  contenedor mientras el navegador lee el HTML, antes de pintar. Es el patrón
  de la guía de Next 16 ("Preventing flash before hydration"): `text/plain` en
  el cliente (React no lo vuelve a ejecutar ni avisa) y
  `suppressHydrationWarning` en el contenedor. Va en el contenedor del layout
  público y **no** en `<html>`/`<head>`: el layout raíz es el de la app
  interna (que no tiene modo oscuro), y en desarrollo React vuelve a poner los
  atributos de `<html>` al remontar. `html:has(.sitio-publico[data-tema])`
  lleva el `color-scheme` a la barra de desplazamiento y al fondo del `body`.
  Al llegar al sitio desde la app (navegación del cliente, sin script), el
  botón aplica lo guardado en un `useLayoutEffect`. Ni nginx ni
  `next.config.ts` ponen `script-src` en la CSP: no hace falta nonce (si algún
  día se agrega, el script necesita uno).
- **En oscuro:** el velo azul noche más profundo, el vidrio oscuro
  translúcido, el texto claro, la barra y el pie casi negros, el `amarillo`
  conservado. Los formularios de la consulta (campos con `pub-*`, no
  `CLASE_CONTROL`), la tabla de horarios, el acordeón de preguntas y las migas
  andan en los dos modos.
- **No cambian:** la app interna, `/login` y el comprobante imprimible (es de
  la app). Lo prueba `tests/e2e/sitio-publico-tema.spec.ts`.

### Las páginas

- **Layout (`src/app/(publico)/layout.tsx`):** el contenedor `.sitio-publico`
  con el script del modo, el fondo fijo, "Saltar al contenido", la página y
  el pie; el `title.template` ("Recorridos históricos · Cementerios de San
  Miguel de Tucumán") y `noindex, nofollow`. La barra **no** va en el layout:
  un layout no recibe la ruta ni se vuelve a renderizar al navegar. La pone
  cada página con su ruta (`BarraPublica actual=…`, o `PaginaInterna`), así la
  página actual sale del servidor, sin `usePathname`.
- **Barra fija** (`sticky`, vidrio azul `pub-barra` con `backdrop-blur`,
  borde inferior blanco al 10 %): el wordmark "CementerIA" con el filete
  `amarillo` y "Dirección de Cementerios · SMT" (`institucional-texto`), que
  lleva al inicio; un enlace por página (Cementerios, Horarios de visita,
  Recorridos, Trámites, **Consultá tu trámite**, Contacto), el botón del modo
  e "Ingreso del personal" (borde blanco). La **página actual** lleva
  `aria-current="page"`, texto blanco en negrita, fondo `white/12` y el
  **subrayado amarillo**; "Consultá tu trámite" va siempre destacada (blanca,
  semibold, fondo `white/10`). Por debajo de `xl` (1280 px), el botón del modo
  y un **menú `<details>`/`<summary>`** ("Menú") con "Inicio", las mismas
  páginas (la actual con fondo y un filete amarillo a la izquierda) y el
  ingreso: abre sin JavaScript y se cierra al cambiar de página. Foco celeste.
- **Inicio (`/`)**, en este orden:
  1. **Hero de alto completo** (`min-height: calc(100svh - 4rem)`, el contenido
     centrado): la pastilla "Municipalidad de San Miguel de Tucumán",
     **"Cementerios de San Miguel de Tucumán"** (el único `h1`,
     `pub-sobre-foto-titulo`, 34 → 60 px, extra negrita, `text-balance`), el
     filete amarillo, la bajada (`pub-sobre-foto-texto`, 16 → 19 px, 56 ch) y
     dos llamados: **"Consultá tu trámite"** (primario, con la lupa, a
     `/consulta`; en claro, con un filete blanco al 45 % para despegarse del
     velo azul) y **"Horarios de visita"** (`.vidrio-foto`, a `/horarios`),
     todo sobre el halo. Abajo, el **indicador** "Explorá el sitio" (una
     pastilla `.vidrio-foto` con la flecha, enlace a `#accesos`; sin
     animación) y la línea celeste.
  2. **Accesos** (`nav` "Accesos rápidos", `#accesos`): pastilla "Secciones",
     `h2` "Todo lo que necesitás, en un lugar" y seis tarjetas de vidrio (1 →
     2 → 3 columnas), una por página, con el ícono en una cajita `pub-chip`,
     título, texto corto (de `PAGINAS_PUBLICAS`) y una flecha. **"Consultá tu
     trámite" en vidrio azul** con el ícono y la flecha en `amarillo`.
  3. **Novedades** (solo si hay vigentes): pastilla "Avisos vigentes", `h2`
     "Novedades" y una franja de vidrio por novedad con el borde izquierdo
     `amarillo` de 4 px y el megáfono (`pub-advertencia`).
  4. **Próximos recorridos** (solo si hay fechas): pastilla "Patrimonio",
     `h2`, "Ver todos los recorridos" (`.vidrio-foto`) y hasta **tres** fechas en
     vidrio (la cajita `institucional` con el día en monoespaciada y el mes en
     `amarillo`).
  5. **Banda de la consulta:** vidrio azul dentro del contenedor (20 px de
     radio; a todo el ancho se pegaría al pie), con dos anillos celestes
     decorativos (desde `sm`: en el celular cruzaban el texto), antetítulo
     celeste claro (#8FD6FB), `h2` blanco, una línea de texto y **"Consultar mi
     trámite"** (`amarillo` con texto `institucional`).
  6. **Pie.**
- **Páginas internas** (`PaginaInterna`):
  - **Encabezado, sobre el fondo fijo:** centrado y sobre el halo, las **migas
    de pan** en una pastilla de `.vidrio-foto` (`nav aria-label="Migas de pan"`,
    "Inicio › Recorridos"; la última con `aria-current="page"`, sin enlace),
    el `h1` con el título de la página (28 → 40 px, extra negrita,
    `pub-sobre-foto-titulo`, `text-balance`), el filete amarillo y la bajada
    (`pub-sobre-foto-texto`, 62 ch). Es el único `h1`: el contenido empieza en `h2`.
  - **Panel de lectura** con el contenido (16 → 32 → 40 px de relleno).
  - **Al pie, "También te puede servir":** la pastilla y un `nav` con dos
    tarjetas de vidrio a otras páginas (ícono, título, texto y flecha),
    **distintas en cada página** (`INVITACIONES`): Cementerios → Horarios y
    Recorridos; Horarios → Cementerios y Contacto; Recorridos → Horarios y
    Cementerios; Trámites → "¿Ya iniciaste un trámite? Consultalo" y Contacto;
    Consulta → Trámites y Contacto; Contacto → Consulta y Trámites.
  - **Cementerios:** la bajada dice cuántos son ("Tres cementerios
    municipales: dónde están, qué tienen y cómo llegar.", y "Las fotos son
    ilustrativas." si hay alguna); tarjetas con la foto 16:9 (si se eligió;
    si no, una franja `institucional` con el filete), nombre (`h2`),
    descripción, Domicilio · Visitas (lunes a viernes) · Tiene (solo lo
    cargado), "Cómo llegar" (primario, a otra pestaña) y "Horarios" (a
    `/horarios`).
  - **Horarios de visita:** arriba, las novedades vigentes (con el `h2` solo
    para lectores); desde `md`, la tabla (cabecera `pub-tinte`, versalitas
    `pub-titulo`, el cementerio como `th` de fila; lo que falta, "—" con "Sin
    informar" para lectores); en celular, **una tarjeta por cementerio**: nunca
    scroll lateral. Sin horarios, "Consultá los horarios en Mesa de
    Entradas." con el contacto.
  - **Recorridos históricos:** el primero, ficha destacada (foto a la
    izquierda desde 900 px, chip con el cementerio, datos, "Cómo inscribirse",
    "Consultas" a `/contacto`); los demás, fichas debajo; "Próximas fechas" y
    "Grupos, escuelas e instituciones" con el contacto, los dos `h2`.
  - **Trámites y requisitos:** de las plantillas publicadas, en tarjetas de
    dos columnas con viñetas `pub-enlace`; la consulta, en la invitación del
    pie.
  - **Consultá tu trámite** (`src/app/(publico)/consulta/`): en el panel, dos
    columnas desde 900 px: antetítulo, `h2` "Cómo funciona" y los 3 pasos
    (tarjetas con el número en monoespaciada en un círculo `amarillo`); a la
    derecha, la tarjeta con el **formulario de siempre** ("Datos del
    comprobante", `h2` que lo nombra; el resultado también va en `h2`, con el
    número y las fechas en monoespaciada) y la nota de privacidad con el
    escudo.
  - **Contacto:** la tarjeta de Mesa de Entradas (`h2`; lo cargado; teléfono
    con `tel:` y correo con `mailto:`; "Cómo llegar") y, si hay, "Preguntas
    frecuentes" (`h2`) con el acordeón de `<details>` (la primera abierta,
    `+`/`−` en `pub-enlace`).
- **Pie** (de todas): `pub-pie`, "CementerIA", la Dirección y la
  Municipalidad, "Desarrollado por la Dirección de Inteligencia Artificial ·
  Ingreso del personal".
- **Responsive:** desde 360 px sin desplazamiento lateral (lo prueban
  `tests/e2e/sitio-publico.spec.ts` en 375 px en las siete páginas, con el menú
  abierto; `tests/e2e/sitio-publico-tema.spec.ts`, en los dos modos; y
  `tests/e2e/consulta-publica.spec.ts` con un resultado).
- **El comprobante** (`?hoja=comprobante`, de la app, sin modo oscuro): la
  misma hoja que la carátula (blanco, `slate`, sin fondos al imprimir), media
  A4 con línea de corte punteada: encabezado, "Comprobante de inicio de
  trámite", la tabla (número, trámite, cementerio, fecha de inicio), el QR a
  la derecha, el **código** en un recuadro con 36 px monoespaciada y
  espaciado, la dirección de la consulta (`/consulta`) y el pie.
- **/admin/sitio-publico:** como Catálogos: la banda de Administración (para
  Dirección, "Administración del sitio público" con solo esa sección), `h1`,
  "Ver la página pública" (secundario, a otra pestaña, `/?vista=publica`) y, al
  lado, la página donde se ve la pestaña abierta ("Ver «Recorridos
  históricos»"; Contacto y Preguntas, a `/contacto`; Novedades, solo el
  inicio), pestañas en la URL, tablas apilables con "Modificar", diálogos
  (ancho en Cementerios y Recorridos) y "Quitar" en rojo con confirmación.

### Rendimiento

Una sola imagen (la del fondo, en todas las páginas, la misma URL: queda en
caché), sin `will-change` y sin desenfoque sobre la foto entera: solo los
elementos chicos de vidrio y la barra. Medido desplazando el inicio y
`/recorridos` cuadro a cuadro (`requestAnimationFrame`, 12 px por cuadro) en
Chromium: **con la GPU** (D3D11), 1440 px y 375 px con la CPU 4× más lenta, la
mediana y el p95 en 16,7 ms (60 cuadros por segundo), salvo uno o dos cuadros
al empezar (la primera decodificación). Con el renderizado por software del
modo sin pantalla, en 1440 px el inicio pierde un cuadro de cada cinco
(33 ms) por el `backdrop-filter`; sin el desenfoque no pierde ninguno: si en
las PC de la oficina se nota, bajar a `blur(8px)` o quitarlo de los accesos
(el vidrio tiene respaldo opaco).

### Contraste (WCAG 2.1 AA, los dos modos)

**Tokens contra sus superficies** (las translúcidas compuestas sobre lo peor
que puede haber detrás: negro en claro, blanco en oscuro; los
`pub-sobre-foto-*`, que son claros, sobre una foto **blanca** con el punto más
liviano del velo, `pub-velo`, y encima el halo o el vidrio de la foto). Lo
vuelve a medir `tests/e2e/sitio-publico-tema.spec.ts`.

| Par | Claro | Oscuro | Mínimo |
|---|---|---|---|
| `pub-texto` / `pub-superficie` · `pub-panel` | 14,10 · 12,35 | 14,14 · 14,00 | 4,5 |
| `pub-texto-secundario` / superficie · panel · `pub-tinte` | 7,53 · 6,59 · 6,75 | 9,11 · 9,02 · 8,00 | 4,5 |
| `pub-titulo` / panel · tinte | 11,61 · 11,88 | 16,32 · 14,48 | 4,5 |
| `pub-enlace` / superficie · panel · `pub-chip` | 6,72 · 5,89 · 5,95 | 9,53 · 9,43 · 7,41 | 4,5 |
| `pub-error` / `pub-error-fondo` | 5,76 | 8,99 | 4,5 |
| blanco / `primario` (botones) | 4,73 | 4,73 | 4,5 |
| `pub-borde-control` / superficie | 3,64 | 5,26 | 3 |
| `pub-foco` / superficie · panel | 4,73 · 4,14 | 8,76 · 8,68 | 3 |
| `pub-sobre-foto-titulo` / velo · velo + halo | 3,40 · 5,60 | 6,39 · 9,64 | 3 · 4,5 |
| `pub-sobre-foto-texto` / velo + halo (bajadas) | 4,79 | 8,27 | 4,5 |
| `pub-sobre-foto-titulo` · `-texto` / `pub-vidrio-foto` | 7,87 · 6,73 | 13,25 · 11,36 | 4,5 |
| `pub-sobre-foto-secundario` · `-enlace` / `pub-vidrio-foto` | 5,34 · 5,39 | 7,32 · 7,66 | 4,5 |
| `pub-sobre-foto-foco` / velo | 3,40 | 3,40 | 3 |

**Texto sobre la foto y sobre el vidrio**, medido como antes, con el texto
transparente: el píxel de fondo **más oscuro** (texto oscuro, claro) o **más
claro** (texto claro, oscuro) detrás de cada línea. Como el fondo es fijo, lo
que queda detrás cambia al desplazar: se midió cada página bajando de a un
tercio de la ventana (360 × 780, 768 × 1024 y 1440 × 900) y se guardó el peor
de cada línea (2116 mediciones, todo el texto visible de las siete páginas y
la consulta con resultado). El peor por grupo:

| Texto | Claro 360 | Claro 768 | Claro 1440 | Oscuro 360 | Oscuro 768 | Oscuro 1440 |
|---|---|---|---|---|---|---|
| Barra: enlaces y bajada de la marca | 5,90 | 5,90 | 5,90 | 9,18 | 9,08 | 9,39 |
| Hero: antetítulo (pastilla `.vidrio-foto`) | 10,25 | 10,38 | 10,42 | 16,10 | 16,31 | 16,33 |
| Hero: título `h1` | 6,06 | 6,47 | 6,36 | 11,94 | 11,53 | 11,16 |
| Hero: bajada | 5,53 | 5,54 | 5,77 | 9,97 | 10,16 | 10,62 |
| Hero: "Horarios de visita" (`.vidrio-foto`) e indicador | 7,94 | 8,00 | 8,00 | 13,36 | 13,36 | 13,36 |
| Inicio: pastillas de sección | 9,79 | 9,64 | 9,63 | 15,77 | 15,23 | 15,23 |
| Inicio: `h2` de sección (sobre el halo) | 5,21 | 4,99 | 5,18 | 9,81 | 9,58 | 9,84 |
| Inicio: tarjetas de vidrio (accesos, novedad, fechas) | 5,26 | 5,49 | 5,01 | 6,77 | 6,66 | 6,85 |
| Banda de la consulta (vidrio azul) | 7,74 | 6,26 | 7,76 | 6,34 | 5,43 | 6,63 |
| Internas: migas (pastilla `.vidrio-foto`) | 7,09 | 7,18 | 7,18 | 9,23 | 9,32 | 9,32 |
| Internas: título `h1` | 6,13 | 6,47 | 6,46 | 11,24 | 11,56 | 11,81 |
| Internas: bajada | 4,74 | 5,19 | 5,28 | 9,31 | 9,74 | 10,00 |
| Internas: "También te puede servir" | 9,10 | 9,77 | 9,75 | 15,58 | 16,52 | 16,49 |
| Pie | 8,53 | 8,53 | 8,53 | 13,33 | 13,36 | 13,36 |
| El peor de todo el texto de cada página interna | 4,73 | 4,73 | 4,73 | 4,73 | 4,73 | 4,73 |

Medido el 28/10/2026 con el velo azul del modo claro (el oscuro no cambió:
sus valores son los de antes, con las décimas del barrido). El 4,73 de la
última fila es siempre el blanco sobre el `primario` de los botones ("Cómo
llegar", "Consultar"), igual en los dos modos; lo demás del panel queda en
4,84 o más en claro (las bajadas de /tramites y /consulta en 360 px y el chip
del cementerio de /recorridos, 4,90; con el velo blanco de antes era 5,90: el
panel es casi opaco y detrás ahora hay azul) y 7,45 o más en oscuro.

**Foco sobre la foto** (el anillo contra los píxeles de 1 a 4 px por fuera,
con el texto transparente, en tres posiciones de desplazamiento; 360, 768 y
1440): en claro, con el anillo blanco, de 4,45 ("Ver todos los recorridos")
a 6,80 ("Consultá tu trámite"), y 3,39 el de "Inicio" en las migas (el anillo
cae sobre el filete de la pastilla); en oscuro, de 5,12 a 7,05, y 3,22 el de
las migas. Con el celeste #5CC8FF en claro, "Explorá el sitio" y "Ver todos
los recorridos" quedaban en 2,4–2,6 sobre la parte del empedrado: por eso el
foco sobre la foto es blanco en claro. Con el filete con brillo de 50 % de la
pastilla, el de las migas daba 2,24: bajó a 30 % (y el borde, de 30 a 22 %).
Las tarjetas de vidrio claras pasaron de blanco al 76 a 84 % en claro: sobre el
velo azul, el texto secundario de la tarjeta de Contacto quedaba en 4,43. Se corrigió en el
camino: el antetítulo `celeste` de la banda (4,39 en 1440 y 3,97 en 360, en
claro) pasó a #8FD6FB; los anillos celestes de la banda cruzaban el texto en
el celular (4,29) y ahora van desde `sm` y más tenues; el vidrio azul subió de
90 a 92 % (claro) y de 80 a 86 % (oscuro). Los `h2` de sección del inicio no
tenían halo en la primera versión: sobre la foto fija dependían de la
posición; ahora llevan el halo y la pastilla. Si se cambia la foto, el velo,
el halo, el vidrio o un token, volver a medir (el script de medición está
descripto arriba: captura, texto transparente, peor píxel por línea).

## Capturas

En `docs/capturas/rediseno/` (base efímera con la semilla y `next start`, como
el arnés e2e; 1440 × 900, 768 × 1024 y 390 × 844; las de la etapa responsive,
también en 1280 × 720). Las de página completa se sacan con la ventana del alto
del documento, para que lo fijo (la barra de acciones, la barra lateral) quede
en su lugar.

En el repositorio se versionan solo cuatro de referencia, en 1440 (en la etapa
responsive se regeneraron `panel-direccion-1440.png`, `ficha-1440.png` y
`nuevo-formulario-error-1440.png`, por la barra lateral nueva; el ingreso no
cambió; el 27/10/2026 se regeneró `login-1440.png` con el formulario del login
propio):
`login-1440.png`, `panel-direccion-1440.png`, `nuevo-formulario-error-1440.png`
y `ficha-1440.png`. Las demás pesan unos 16 MB, están en `.gitignore` y se
regeneran con el arnés de e2e cuando hacen falta.

| Pantalla | Archivos |
|---|---|
| Nuevo expediente, paso 1 | `nuevo-paso1-{1440,768,390}.png` |
| Nuevo expediente con un error de validación (sección "Z") | `nuevo-formulario-error-{1440,768,390}.png` |
| Bandeja (pestañas, En mi área) | `bandeja-pestanas-{1440,768,390}.png`, `bandeja-pestanas-completa-390.png` |
| Bandeja vacía ("Por confirmar") | `bandeja-por-confirmar-{1440,768,390}.png`, `bandeja-por-confirmar-vacia-*.png` |
| Búsqueda | `busqueda-resultados-*`, `busqueda-coincide-*` (con "Coincide por"), `busqueda-vacia-*` (1440 y 390) |
| Ficha | `ficha-{1440,768,390}.png`, `ficha-faltan-*` ("Faltan N"), `ficha-pase-*` (diálogo "Dar pase") |
| Transcripción | `transcripcion-{1440,390}.png` |
| Administración | `admin-inicio-*`, `admin-plantillas-*`, `admin-editor-*`, `admin-usuarios-*`, `admin-auditoria-*`, `admin-catalogos-*` (1440 y 390) |
| Foco con teclado | `foco-teclado-alta-1440.png`, `foco-teclado-alta-barra-1440.png`, `foco-teclado-dialogo-1440.png`, `foco-teclado-buscador-390.png` |
| Imprimibles (medio `print`) | `imprimir-caratula-medio-print.png`, `imprimir-historial-medio-print.png` |
| No encontrada | `no-encontrada-{1440,768,390}.png` |
| Etapa responsive: bandeja de Liquidación (En mi área) en 1280 × 720 | `bandeja-liquidacion-1280-expandida.png`, `bandeja-liquidacion-1280-colapsada.png` |
| Etapa responsive: bandeja en tablet y celular (tarjetas) | `bandeja-liquidacion-768.png`, `bandeja-liquidacion-390.png` |
| Etapa responsive: búsqueda, panel y ficha en 1280 | `busqueda-resultados-1280.png`, `panel-direccion-1280.png`, `ficha-1280.png` |
| Etapa responsive: globo de la barra contraída (foco con teclado) | `barra-colapsada-globo-1280.png` |
| Métricas de gestión, como Dirección (página completa) | `metricas-direccion-{1440,1280,390}.png` |
| Recorridos guiados (27/10/2026; 1280 × 720 y 390 × 844, Mesa de Entradas) | `recorrido-invitacion-*` (la bienvenida ofrecida), `recorrido-bandeja-*` y `recorrido-bandeja-dias-*` (en curso), `recorrido-ficha-*` ("Dar pase o devolver" en 1280, "Qué falta para avanzar" en 390) y `recorrido-ficha-historial-*`, `recorrido-bienvenida-1280.png` y `recorrido-bienvenida-contraer-1280.png` (Cómputo) |

Las de la primera etapa siguen ahí (las de `bandeja-mesa-*` se reemplazaron
por `bandeja-pestanas-*`, y `ficha-*` por las nuevas). En las capturas de
página completa del formulario la barra de acciones se ve en su lugar, al pie.

## Pendientes

- **Logo oficial** cuando lo entregue Comunicación (ver "Marca").
- **Imprimibles**: siguen con Inter; revisar si conviene otra fuente para el
  papel.
- **Grilla de transcripción en 1280 con la barra expandida**: entra sin
  desplazarse, pero Observación y Motivo quedan angostos (unos 90 px); con la
  barra contraída o desde 1366 tienen lugar. Si molesta, contraer la barra.
- **Tablas apiladas en Safari**: en Chrome y Edge la tabla apilada conserva
  su semántica de tabla (medido con el árbol de accesibilidad); Safari puede
  anunciarla como texto. El rótulo de cada celda se lee igual.
- **Tab al final de un diálogo**: Chrome lleva el foco a la interfaz del
  navegador antes de volver al diálogo (es el `<dialog>` nativo, no el
  rediseño).
- **Banda de Administración**: usa el velo de la portada; si se cambia la foto
  o el velo, volver a medir el texto blanco.
- **Encabezado entre 640 y unos 700 px**: con "Por confirmar" y la campana, el
  "?" se monta sobre "Por confirmar" (ya pasaba antes del modo prueba: el
  buscador no se achica más). Con el selector del modo prueba pasa lo mismo
  con el matraz. Desde 768 px y en el celular entra todo en una fila.
- **Recorridos guiados**: revisar los textos con las áreas en el piloto (subir
  la `version` de lo que cambie). En el celular, con el "?" en la fila del
  encabezado, el nombre de un operador con campana queda en una o dos letras
  (ya estaba truncado). La edición de un expediente y los imprimibles no tienen
  recorrido propio (el "?" muestra la bienvenida).
