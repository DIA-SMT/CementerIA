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
usuario y contraseña, porque el ingreso es solo con Cidituc).

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

## Capturas

En `docs/capturas/rediseno/` (base efímera con la semilla y `next start`, como
el arnés e2e; 1440 × 900, 768 × 1024 y 390 × 844; las de la etapa responsive,
también en 1280 × 720). Las de página completa se sacan con la ventana del alto
del documento, para que lo fijo (la barra de acciones, la barra lateral) quede
en su lugar.

En el repositorio se versionan solo cuatro de referencia, en 1440 (en la etapa
responsive se regeneraron `panel-direccion-1440.png`, `ficha-1440.png` y
`nuevo-formulario-error-1440.png`, por la barra lateral nueva; el ingreso no
cambió):
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
