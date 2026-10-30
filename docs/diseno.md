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

## Kit institucional (30/10/2026)

El usuario aprobó un kit visual: un moodboard (sitio público, ingreso y
panel), el logo oficial de la Municipalidad, 12 imágenes conceptuales
generadas con IA y la paleta `#006BFF`, `#32B2F6`, `#F4D900`, `#0F2F5D`,
`#F4F7FB` y blanco. Se aplicó en cinco fases (rama `rediseno-kit-visual`),
sin cambios de base, rutas, autenticación, permisos, acciones ni tipos.

| Fase | Qué |
|---|---|
| A | Paleta del kit en los tokens, tokens de movimiento, logo oficial (`MarcaMunicipal`, `LogoMunicipal`, `Wordmark`), imágenes en `public/assets/cementeria/` (adiós `public/imagenes/`) |
| B | Sitio público como el moodboard: barra y pie azules con el logo, hero 16:9, accesos, patrimonio, trámites, seguimiento en pasos, cementerios y cierre; bandas con foto en las internas |
| C | Ingreso dividido 55/45 con el logo sobre la foto; en el celular, el formulario primero |
| D | Banner de bienvenida del panel, íconos en los conteos, encabezados de pantalla con el antetítulo del sitio |
| E | Estados, responsive, accesibilidad, contraste medido y estas notas |

**Lo que no se tomó del moodboard**, y por qué (los textos y cifras del
moodboard son de ejemplo):

- Las cifras (124, 28, 56, 8): el panel muestra solo los números del dominio,
  con el estilo nuevo; el banner de bienvenida no tiene ninguna.
- "CUIL o correo electrónico", "Recordarme" y "¿Olvidaste tu contraseña?": el
  campo sigue como estaba ("CUIL o correo", que es lo que acepta hoy el
  ingreso propio) y no hay "recordarme" ni recuperación por correo (el
  blanqueo lo hace un administrador, y la ayuda lo dice).
- Los trámites "Solicitud de nicho" y "Traslado" y los menús "Documentación",
  "Reportes" y "Configuración": no existen. Los trámites y cementerios salen de
  la base; la barra lateral y los accesos son los de `navegacionPara()`.
- "Gestión transparente", "Patrimonio histórico", "Atención cercana" y los
  textos que afirman hechos: el bloque de patrimonio dice solo qué hay en el
  sitio ("cuándo visitarlos, los recorridos guiados que publica la Dirección
  y cómo hacer cada trámite").
- La barra lateral blanca del moodboard: queda azul institucional, porque el
  logo oficial tiene el texto blanco y va solo sobre azul.
- "Gestión / Patrimonio / Comunidad" sobre la foto del panel: el banner dice
  "Hola, <nombre>", la Dirección y la fecha.

### Marca y logo

- `public/assets/cementeria/logo-municipal.png`, 910 × 297 (el kit decía 900
  × 298; el archivo mide eso), el aportado por el usuario, sin redibujar ni
  recolorear. `alt="Ciudad San Miguel de Tucumán"`.
- **Solo sobre azul u oscuro**: la barra pública, el panel de la foto del
  ingreso (y la franja azul del celular), la barra lateral y el pie. En una
  superficie clara, `LogoMunicipal variante="clara"` lo pone dentro de un
  bloque azul institucional (`/sin-acceso`, la 404, `/dev/login`).
- Proporción siempre: el alto define el ancho. En la barra lateral contraída
  se achica entero a 56 px de ancho (no se recorta).
- **Wordmark** (`Wordmark`): "Cementer" + "IA" como texto HTML; "IA" en
  `celeste` sobre azul (5,57:1) y en `primario` sobre blanco (4,62:1, texto
  grande). Es el `h1` del inicio ("CementerIA Dirección de Cementerios") y
  del ingreso ("CementerIA").

### Movimiento

Tokens en `@theme`: `--ease-salida` (`cubic-bezier(0.2, 0, 0, 1)`),
`--duracion-corta` 140 ms, `--duracion-media` 200 ms, `--duracion-larga` 240
ms y la animación `aparecer` (opacidad de 0 a 1 y 8 px de desplazamiento
vertical, 240 ms). Se usan:

- `motion-safe:animate-aparecer`: el texto del hero (escalonado de a 60 ms),
  el encabezado de las internas, la tarjeta del ingreso y el saludo del panel.
  Solo al cargar: nada aparece al desplazarse (las capturas y las mediciones
  de contraste ven todo).
- `.tarjeta-enlace` (sitio público): sube 2 px y gana sombra al pasar o
  enfocar; su `.flecha` se corre 2 px. Las tarjetas de conteo del panel y los
  accesos del banner, igual (1 a 2 px).
- Solo `transform`, `opacity`, sombras y colores: nada cambia el layout.
- `prefers-reduced-motion: reduce`: la regla global deja animaciones y
  transiciones en 0,01 ms y las tarjetas no suben. El ícono que gira en
  "Ingresando…" queda quieto.

### Contraste (resumen; WCAG 2.1 AA)

Pares de color (fórmula de luminancia de WCAG; las superficies translúcidas,
compuestas sobre lo peor que puede haber detrás):

| Texto / elemento | Fondo | Contraste | Mínimo | Dónde |
|---|---|---|---|---|
| blanco | `primario` #006BFF | 4,62 | 4,5 | Botones primarios (app y sitio) |
| `primario` #006BFF | blanco · `fondo` | 4,62 · 4,30 | 3 | Anillo de foco |
| `primario-oscuro` #0B53CC | blanco · `fondo` · #E8F2FF | 6,72 · 6,26 · 5,95 | 4,5 | Enlaces, antetítulos de pantalla |
| `celeste` #32B2F6 | `institucional` #0F2F5D | 5,57 | 4,5 | "IA" del wordmark, foco en la barra lateral |
| `institucional` #0F2F5D | `amarillo` #F4D900 | 9,32 | 4,5 | "Consultar mi trámite", pastilla "por vencer" |
| `amarillo` #F4D900 | blanco | 1,42 | — | **Nunca como texto**: filetes y rellenos |
| `institucional-texto` #C7D6EB | #0F2F5D · `pub-pie` #0B2447 | 8,99 · 10,49 | 4,5 | Barra lateral, barra pública, pie |
| blanco | `pub-banda` #0F2F5D · #0D2546 (oscuro) | 13,25 · 15,33 | 4,5 | Banda del seguimiento |
| `pub-texto` | `pub-seccion` · `pub-fondo` | 14,10 · 13,12 (claro); 15,24 · 16,23 (oscuro) | 4,5 | Secciones del sitio |
| `pub-texto-secundario` | `pub-seccion` · `pub-fondo` | 7,53 · 7,00 (claro); 9,11 · 10,46 (oscuro) | 4,5 | Bajadas y ayudas |
| `pub-enlace` | `pub-fondo` · `pub-superficie` | 6,26 · 6,72 (claro); 10,94 · 9,53 (oscuro) | 4,5 | Enlaces y antetítulos del sitio |
| `pub-foco` | `pub-superficie` | 4,62 (claro); 8,76 (oscuro) | 3 | Foco en el sitio |
| `pub-borde-control` | `pub-superficie` | 3,64 (claro); 5,26 (oscuro) | 3 | Campos de la consulta |
| blanco | `pub-velo` sobre una foto **blanca** | 7,18 (claro); 12,56 (oscuro) | 4,5 | Hero y bandas de las internas, peor caso teórico |
| `institucional-texto` | `pub-velo` sobre una foto blanca | 4,87 (claro); 8,52 (oscuro) | 4,5 | "Imagen ilustrativa…", migas |
| `pub-texto-secundario` · `pub-enlace` | `pub-velo-cierre` (claro sobre foto negra) | 5,08 · 4,54 | 4,5 | Cierre del inicio |
| `pub-texto-secundario` · `pub-enlace` | `pub-velo-cierre` (oscuro sobre foto blanca) | 7,62 · 7,97 | 4,5 | Cierre del inicio |
| `texto-secundario` #5F6878 | `fondo` · #E8F2FF | 5,23 · 4,97 | 4,5 | App |

Los pares del sitio los vuelve a medir `tests/e2e/sitio-publico-tema.spec.ts`
en los dos modos (incluidos el velo, la banda, la barra, el pie y el
amarillo).

**Texto sobre las fotos reales**, medido en el navegador (build de
producción, Chromium): cada texto se vuelve transparente (y los bordes) y se
toma el píxel de fondo más desfavorable detrás de su caja (el más claro para
texto claro); el peor por grupo y ancho. El 4,62 del hero es el botón
"Consultá tu trámite" (blanco sobre `primario`); el resto del hero da más.

| Texto | Claro 390 · 768 · 1440 | Oscuro 390 · 768 · 1440 |
|---|---|---|
| Hero del inicio (antetítulo, h1, bajada, botones, aclaración) | 4,62 · 4,62 · 4,62 | 4,62 · 4,62 · 4,62 |
| Cierre del inicio (velo claro) | 5,92 · 5,43 · 5,87 | 7,58 · 7,58 · 7,58 |
| Banda de /cementerios | 5,02 · 5,07 · 5,24 | 8,75 · 8,75 · 8,99 |
| Banda de /horarios | 4,85 · 4,85 · 5,31 | 8,50 · 8,50 · 9,10 |
| Banda de /recorridos | 4,85 · 4,91 · 4,94 | 8,50 · 8,54 · 8,62 |
| Banda de /tramites | 4,86 · 4,85 · 4,86 | 8,50 · 8,50 · 8,50 |
| Banda de /consulta | 5,02 · 4,85 · 4,89 | 8,77 · 8,50 · 8,56 |
| Banda de /contacto | 5,00 · 5,82 · 5,64 | 8,62 · 9,67 · 9,49 |
| Ingreso: panel de la foto (solo escritorio) | — · — · 5,27 | (sin modo oscuro) |
| Banner del panel | 5,91 · 5,14 · 5,15 | (sin modo oscuro) |

En las bandas, el peor es siempre el separador "›" y la página actual de las
migas (`institucional-texto` y blanco); los títulos dan más de 6. Si se
cambia una foto o un velo, volver a medir.

### Accesibilidad y responsive

- Un solo `h1` por página; las imágenes decorativas con `alt=""` y las de
  contenido (cementerios, recorridos) con "foto ilustrativa" en el `alt`; el
  logo con su nombre.
- Foco visible: blanco sobre la barra, las bandas y la foto (más de 6:1 contra
  el velo), `pub-foco` en el sitio, `primario` en la app, con el filete del
  color de la superficie en el sitio público.
- Sin desplazamiento lateral en 390, 768, 720 (1440 al 200 % de zoom) y 1440
  en las siete páginas públicas, el ingreso, el panel, la bandeja, el alta, la
  búsqueda, la ficha y /admin/sitio-publico (medido con `scrollWidth`); los
  e2e lo vuelven a medir en 375 en el sitio y en 390 en el ingreso.
- Los recorridos guiados siguen apuntando a sus anclas: ninguna
  `data-recorrido` se quitó (el banner del panel conserva `panel-accesos`).

## Tokens

En `src/app/globals.css`, dentro de `@theme`: cada `--color-x` es una clase de
Tailwind (`bg-x`, `text-x`, `border-x`, `ring-x`…).

| Token | Valor | Uso |
|---|---|---|
| `institucional` | `#0F2F5D` | Barra lateral, números destacados, títulos de marca |
| `institucional-hover` | `#163B70` | Hover en la barra lateral |
| `institucional-activo` | `#1A4683` | Ítem activo de la barra lateral |
| `institucional-texto` | `#C7D6EB` | Texto secundario sobre el azul institucional |
| `primario` | `#006BFF` (kit; antes `#0F68FF`) | Botón primario, anillo de foco, acentos |
| `primario-oscuro` | `#0B53CC` | Hover del primario, enlaces, texto azul sobre fondos tintados |
| `celeste` | `#32B2F6` (kit; antes `#38B2F6`) | Decorativo; como texto, ícono o foco solo sobre el azul institucional; la "IA" del wordmark sobre azul |
| `superficie-azul` | `#E8F2FF` | Fondos tintados, hover de botones secundarios |
| `amarillo` | `#F4D900` (kit; antes `#F4C400`) | Acento municipal: barra del ítem activo, filetes, pastilla "por vencer", botón de la banda del seguimiento (con texto `institucional`). **Nunca texto sobre blanco** |
| `fondo` | `#F4F7FB` | Fondo de la aplicación, encabezado de tablas |
| `superficie` | `#FFFFFF` | Tarjetas, encabezado, controles |
| `texto` | `#172B4D` | Texto principal |
| `texto-secundario` | `#5F6878` | Texto secundario (ajustado, ver abajo) |
| `borde` | `#DCE3EC` | Bordes decorativos de tarjetas y tablas |
| `borde-control` | `#7C8798` | Borde de inputs, selects y botones secundarios |
| `exito` / `-fondo` / `-borde` / `-solido` | `#166534` / `#EAF7EE` / `#9FD3B1` / `#15803D` | Concluido, en término |
| `advertencia` / `-fondo` / `-borde` | `#8A4B00` / `#FFF4D6` / `#F4D900` | Espera de pago, por vencer, avisos |
| `error` / `-fondo` / `-borde` | `#B42318` / `#FDECEC` / `#F2B8B5` | Anulado, vencido, errores |
| `error-hover` | `#912018` | Hover del botón rojo (`CLASE_BOTON_PELIGRO`); agregado en la segunda etapa |
| `info` / `-fondo` / `-borde` | `#0B53CC` / `#E8F2FF` / `#B5D3FF` | En trámite, avisos informativos |

Radios: `rounded-control` 8 px (controles y botones), `rounded-tarjeta` 12 px,
`rounded-panel` 16 px (portada, diálogos). Sombras: `shadow-tarjeta` y
`shadow-elevada` (hover y diálogos), teñidas del azul institucional.

**Ajustes respecto de la paleta del paquete:**

- `#6B7280` (gris de texto) da 4,4993:1 sobre el fondo `#F4F7FB` (no llega a
  4,5) y 4,28:1 sobre `#E8F2FF`. Se oscureció a **`#5F6878`**.
- Desde el kit institucional (30/10/2026) la paleta es la del kit: `#006BFF`,
  `#32B2F6`, `#F4D900`, `#0F2F5D`, `#F4F7FB` y blanco. Las cifras de abajo
  son las de la paleta nueva (sección "Kit institucional").
- `#006BFF` llega a AA sobre blanco (4,62) y con texto blanco encima (4,62),
  pero no sobre el fondo (4,30) ni sobre `#E8F2FF`. Para enlaces y texto
  azul se usa **`#0B53CC`** (`primario-oscuro`), que llega en todos. La
  única excepción es la "IA" del wordmark sobre blanco (4,62, texto grande).
- El amarillo `#F4D900` sobre blanco da 1,42: solo como relleno o filete, y
  con texto `institucional` encima (9,32).
- El celeste `#32B2F6` sobre blanco da 2,38: solo sobre el azul institucional (5,57).
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
| blanco | `primario` #006BFF | 4,62 | 4,5 | Botón primario |
| `primario` #006BFF | blanco | 4,62 | 4,5 / 3 | Anillo de foco, íconos, "IA" del wordmark (grande) |
| `primario` #006BFF | `fondo` #F4F7FB | 4,30 | 3 | Anillo de foco sobre el fondo (no se usa como texto ahí) |
| `primario-oscuro` #0B53CC | blanco | 6,72 | 4,5 | Enlaces |
| `primario-oscuro` #0B53CC | #E8F2FF | 5,95 | 4,5 | Hover de botón secundario, chip "En trámite" |
| blanco | `primario-oscuro` #0B53CC | 6,72 | 4,5 | Hover del botón primario |
| `institucional` #0F2F5D | blanco | 13,25 | 4,5 | Números del panel, marca, accesos rápidos |
| blanco | `institucional` #0F2F5D | 13,25 | 4,5 | Barra lateral |
| `institucional-texto` #C7D6EB | `institucional` #0F2F5D | 8,99 | 4,5 | Ítems y textos de la barra |
| `institucional-texto` #C7D6EB | `institucional-hover` #163B70 | 7,52 | 4,5 | Ítem en hover (pasa a blanco: 11,09) |
| blanco | `institucional-activo` #1A4683 | 9,34 | 4,5 | Ítem activo |
| `celeste` #32B2F6 | `institucional` #0F2F5D | 5,57 | 3 / 4,5 | Anillo de foco en la barra; "IA" del wordmark |
| `celeste` #32B2F6 | `institucional-activo` #1A4683 | 3,93 | 3 | Ícono del ítem activo |
| `amarillo` #F4D900 | `institucional` #0F2F5D | 9,32 | 3 | Barra del ítem activo (no es texto) |
| `institucional` #0F2F5D | `amarillo` #F4D900 | 9,32 | 4,5 | Pastilla "Plazos DIM por vencer", "Consultar mi trámite" |
| ~~`amarillo`~~ #F4D900 | blanco | 1,42 | — | **Nunca como texto** |
| ~~`celeste`~~ #32B2F6 | blanco | 2,38 | — | **Nunca como texto ni ícono sobre blanco** |
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

**Texto sobre fotos.** (Medición de la primera etapa, con las fotos y velos de
entonces; la vigente, desde el 30/10/2026, está en "Kit institucional".) Medido en la app (Chromium, el píxel de fondo más claro
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

`src/components/marca-municipal.tsx`: `LogoMunicipal`, `Wordmark` y
`MarcaMunicipal`. Desde el 30/10/2026 hay **logo oficial**
(`public/assets/cementeria/logo-municipal.png`): ver "Kit institucional",
"Marca y logo". Antes había un monograma "SMT" provisorio, que ya no existe.

## Imágenes

En `public/assets/cementeria/` (antes `public/imagenes/`, que ya no existe):
las 12 del kit, **conceptuales generadas con IA** (`manifest.json` del kit:
`conceptual_generated_not_actual_site_photo`), no fotos de cementerios de
Tucumán. La procedencia de cada una está en
`public/assets/cementeria/LEEME.md`. Se usan con `<img>` común (nginx tiene
cerrado `/_next/image`), `srcset`/`sizes` cuando hay versión de 960 px,
`width` y `height`, `decoding="async"`, `loading="eager"` y
`fetchpriority="high"` **solo** en la imagen principal de cada pantalla y
`loading="lazy"` en las demás. Donde se ven como foto, dicen "Imagen
ilustrativa generada con IA" (hero, patrimonio, panel de la foto del
ingreso) o "foto ilustrativa" en el `alt` (cementerios y recorridos).

| Archivo | Peso (original / 960) | Uso |
|---|---|---|
| `hero-landing` | 229 KB / 69 KB | Hero del inicio (prioridad alta); banda de /consulta; foto "panoramica" de la administración. Es la misma panorámica que la vieja `landing-panoramica-1916.webp`, que se quitó |
| `login-patrimonio` | 274 KB / 92 KB | Ingreso y /cambiar-clave (solo escritorio: en el celular no se descarga); banda de /contacto; foto "ingreso-paseo-sereno" |
| `hero-dashboard` | 101 KB / 38 KB | Banner de bienvenida del panel (prioridad alta); banda de /tramites; foto "avenida-memorial" |
| `banner-patrimonio` | 223 KB / 92 KB | Patrimonio del inicio; banda de /cementerios; banda de Administración; vacío de la búsqueda; foto "avenida-azul" |
| `feature-ambiental` | 441 KB / 107 KB | Banda de /horarios; vacío de "Por confirmar"; la 404; foto "parque-memorial". Pesa más de 300 KB: su 960 se generó con sharp (calidad 72) |
| `feature-recorridos` | 159 KB | Banda de /recorridos (bajo el velo parejo: el mapa dibujado no se lee) |
| `fondo-suave` | 97 KB | Cierre del inicio, bajo el velo claro |
| `hero-alternativo`, `feature-expedientes`, `feature-gestion`, `feature-ubicaciones`, `banner-tramites` | 220–255 KB | **Sin uso**: traen interfaces y mapas dibujados encima (paneles, "Expedientes", pines) que podrían leerse como pantallas o ubicaciones reales. Quedan en el repositorio por si la Dirección los quiere para algo puramente decorativo |

Las versiones de 960 de `hero-landing`, `login-patrimonio`, `hero-dashboard`
y `banner-patrimonio` son las que el repositorio ya tenía de esas mismas
imágenes (se movieron y renombraron, no son bytes nuevos).

Las fotos que elige la Dirección para cada cementerio y recorrido
(`sitio_cementerios.foto`, `sitio_recorridos.foto`) son una lista cerrada con
un CHECK en la base (`FOTOS_SITIO`, en `src/lib/dominio/sitio/validacion.ts`).
Sus claves no cambiaron (`panoramica`, `avenida-azul`, `avenida-memorial`,
`ingreso-paseo-sereno`, `parque-memorial`): ahora apuntan a los archivos del
kit. Sumar las nuevas a esa lista necesita una migración que amplíe el CHECK:
**no se hizo** (pendiente si la Dirección lo pide).

## Pantallas de la primera etapa

(El ingreso y la portada del panel cambiaron con el kit institucional del
30/10/2026: ver esa sección.)

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
  (blanco encima, 4,62:1). En papel, la insignia va con borde y sin relleno.
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
  principal en `primario` (4,62:1), la segunda (o lo destacado, como el cuello
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
  un anillo blanco de 3 px y otro `primario` de 2 px (4,62:1 contra el blanco).
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

### Sistema visual (kit institucional, 30/10/2026)

Hasta el 30/10/2026 el sitio tenía un fondo fijo con la foto, vidrio
esmerilado y halos ("armonía + tech"). Con el kit pasó al moodboard
aprobado: superficies lisas, la foto solo donde hay velo y piezas reales en
el DOM (nada de paneles dibujados sobre las fotos).

- **Barra** (`BarraPublica`, `sticky`, `pub-barra`, 72 px): el logo oficial
  y, al lado, el wordmark y "Dirección de Cementerios" (en el celular y entre
  1280 y 1535 px solo para lectores de pantalla, para que entren los
  enlaces); las seis páginas (la actual con fondo y el subrayado amarillo;
  "Consultá tu trámite" destacada), el botón del modo e "Ingreso del
  personal" en blanco. Por debajo de `xl`, el menú `<details>` de siempre.
- **Inicio**, en este orden:
  1. **Hero** 16:9 en escritorio (hasta el alto de la ventana) y del alto del
     contenido en el celular: `hero-landing` bajo `.velo-hero` (parejo en el
     celular; sólido en la mitad izquierda y más liviano a la derecha en
     escritorio), "Municipalidad de San Miguel de Tucumán", el `h1`
     ("CementerIA" y "Dirección de Cementerios"), el filete amarillo, la
     bajada, "Consultá tu trámite" (primario) y "Ver trámites" (borde blanco)
     y "Imagen ilustrativa generada con IA."
  2. **Accesos** (`nav` "Accesos rápidos"): las seis páginas en tarjetas
     opacas que se apoyan en el borde del hero (ícono en un círculo
     `primario`; "Consultá tu trámite" en azul con el ícono amarillo).
  3. **Novedades** vigentes (si hay).
  4. **Patrimonio** (`pub-seccion`): texto genérico, los próximos
     recorridos (hasta tres; si no hay, "Recorridos históricos") y
     `banner-patrimonio` con su aclaración.
  5. **Trámites**: hasta cuatro de las plantillas publicadas (de la base) y
     "Ver todos los trámites". Sin datos, no sale.
  6. **Seguimiento** (`pub-banda`): "Consultá tu trámite", los tres pasos
     (`PASOS_CONSULTA`, los mismos de /consulta) y "Consultar mi trámite" en
     amarillo.
  7. **Cementerios** (`pub-seccion`): hasta tres del catálogo con la foto que
     eligió la Dirección (o la franja institucional), el domicilio y "Ver
     todos los cementerios".
  8. **Cierre**: `fondo-suave` bajo `pub-velo-cierre`, Mesa de Entradas con
     lo cargado (domicilio, horario, teléfono) y "Contacto y preguntas
     frecuentes".
- **Páginas internas** (`PaginaInterna`): una banda con la foto de la página
  (`FOTO_BANDA` en `publico.tsx`, la imagen principal) bajo `.velo-banda`,
  con las migas, el `h1`, el filete y la bajada en blanco; el contenido sobre
  `pub-fondo` (tarjetas `pub-superficie`); "También te puede servir" sobre
  `pub-seccion`. El contenido de cada página no cambió (`landing.tsx`).
- **Pie** (`pub-pie`): el logo, el wordmark, la Dirección y la
  Municipalidad, las seis páginas, la DIA e "Ingreso del personal".
- **Contenedor**: `max-w-6xl`, 16 → 24 px de margen; secciones de 56 → 80 px.

### Tokens del sitio público (claro / oscuro)

Propios del sitio (`pub-*`, en el `@theme` de `globals.css`), con
`light-dark()` según el `color-scheme` de `.sitio-publico`. La app interna no
los usa.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `pub-fondo` | #F4F7FB | #07111F | Fondo de la página y de las secciones alternas |
| `pub-seccion` | #FFFFFF | #0B182C | Secciones blancas del inicio, invitaciones |
| `pub-superficie` | #FFFFFF | #0F1F38 | Tarjetas y campos |
| `pub-texto` / `-secundario` | #172B4D / #4A5568 | #E8EEF7 / #B3C2D6 | Texto |
| `pub-titulo` | #0F2F5D | #FFFFFF | Títulos |
| `pub-enlace` | #0B53CC | #8ECBFF | Enlaces, íconos y antetítulos |
| `pub-borde` / `-control` | #D5DEEA / #7C8798 | #8EB6E8 al 22 % / #7F93B0 | Bordes |
| `pub-foco` | #006BFF | #5CC8FF | Anillo de foco |
| `pub-tinte` / `pub-chip` | #EEF3FA / #E8F2FF | #16294A / celeste al 14 % | Cabecera de tabla, cajitas |
| `pub-barra` | #0F2F5D | #08142A | Barra y su menú |
| `pub-banda` | #0F2F5D | #0D2546 | Banda del seguimiento, acceso destacado |
| `pub-pie` | #0B2447 | #040A16 | Pie |
| `pub-velo` | #0F2F5D al 80 % | #050D1C al 84 % | Velo de las fotos donde hay texto |
| `pub-velo-suave` | #0F2F5D al 30 % | #050D1C al 45 % | Derecha del hero en escritorio (sin texto) |
| `pub-velo-cierre` | #F4F7FB al 86 % | #07111F al 88 % | Velo del cierre (texto oscuro en claro) |
| `pub-advertencia`, `pub-error*`, `pub-info-borde` | como antes | como antes | Novedades y consulta |

### Modo oscuro

Sin cambios de comportamiento: por defecto el del sistema; el botón de la
barra (`BotonTema`) alterna y lo guarda en `localStorage`
(`cementeria.sitio-publico.tema`, con `try/catch`) y vuelve a "sistema" si lo
elegido coincide; `ScriptTema` pone `data-tema` en el contenedor antes de
pintar (sin parpadeo; patrón "Preventing flash before hydration" de Next 16).
En oscuro cambian las superficies y los textos; el velo de las fotos es azul
noche y más denso; la barra y el pie, casi negros; el amarillo y los botones
`primario` son los mismos. La app interna, `/login` y el comprobante no
tienen modo oscuro. Lo prueba `tests/e2e/sitio-publico-tema.spec.ts`.


### Las páginas

Estructura y contenido de cada página (28/10/2026). Desde el kit institucional
(30/10/2026), la barra, el inicio, el encabezado de las internas y el pie
son los de "Sistema visual (kit institucional)" (arriba): lo que sigue vale
para el contenido de cada página, que no cambió; lo que dice de vidrio, halo
o fondo fijo es de la versión anterior.

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

Una imagen principal por página (hero o banda) con `fetchpriority="high"`;
las demás perezosas. En el celular, `srcset` con la versión de 960 px donde
la hay. Sin fondo fijo, sin `backdrop-filter` ni desenfoques: lo que antes
costaba cuadros al desplazar (docs de la versión del 28/10) ya no está.
`overflow-x: clip` en el contenedor (los anillos decorativos de la banda).

### Contraste del sitio público

En "Kit institucional", "Contraste (resumen)": los pares de tokens en los dos
modos y el texto sobre las fotos reales en 390, 768 y 1440.

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

**Kit institucional (30/10/2026)**: las cuatro de referencia se regeneraron con
el diseño nuevo (build de producción con `NODE_ENV=test` y el login simulado,
contra la base local con la semilla; el formulario con errores, apretando
"Guardar" vacío: no crea nada). Las del resto del kit (inicio en 1440 claro y
oscuro y en 390, cementerios, consulta, ingreso en 1440 y 390, panel, bandeja,
nuevo expediente y ficha) quedaron fuera del repositorio, en la carpeta de
trabajo de la sesión. Las demás de esta tabla son de antes del kit: muestran
la paleta y la marca viejas.

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

- **Fotos reales**: las imágenes del kit son conceptuales (generadas con IA).
  Cuando la Dirección tenga fotos oficiales autorizadas, reemplazarlas (y, si
  se quieren nuevas opciones para cementerios y recorridos, ampliar el CHECK
  de `foto` con una migración: ver "Imágenes").
- **Imágenes del kit sin uso**: `hero-alternativo`, `feature-expedientes`,
  `feature-gestion`, `feature-ubicaciones` y `banner-tramites` traen
  interfaces y mapas dibujados; no se usan para no confundirlas con pantallas
  o ubicaciones reales.
- **Barra lateral contraída**: el logo entero achicado a 56 px de ancho se lee
  poco (no se recorta para no alterar la marca).
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
