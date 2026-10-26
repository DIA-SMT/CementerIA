# Pruebas de punta a punta (Playwright)

Recorren la aplicación en Chromium como lo haría cada área: entran por el login
simulado, cargan, dan pases, confirman, devuelven, buscan y administran.

```bash
npm run test:e2e
```

La primera vez, además de `npm install`, hace falta el navegador:

```bash
npx playwright install chromium
```

No usa la base de desarrollo ni el puerto 3000, y no hace falta tener nada
levantado (`npm run db:local` ni `npm run dev`).

## Qué hace el arnés

`global-setup.ts`, una vez por corrida:

1. Levanta un PostgreSQL 15 efímero en `%TEMP%/cementeria-e2e-XXXX` y un
   puerto libre, con roles, migraciones y extensiones. Es el mismo módulo que
   la batería de integración (`tests/integracion/base-efimera.ts`).
2. Carga la semilla (`prisma/seed.ts`): áreas, cementerios, las 4 plantillas,
   el admin ficticio (`20000000001`), un usuario ficticio por área, los 30
   expedientes ficticios y los escenarios (`prisma/semilla/escenarios.ts`:
   expedientes en cada bandeja, la DIM y los estados; sus adjuntos van a la
   misma carpeta temporal que los de la app). Las pruebas no cuentan filas
   globales ni buscan DNI de 9 dígitos, así que los escenarios no las tocan.
3. Corre `next build` y arranca `next start` en otro puerto libre, en
   `127.0.0.1`, con `NODE_ENV=test`, `TZ=America/Argentina/Tucuman` y un
   entorno propio: base efímera, `SESSION_SECRET` aleatorio,
   `AUTH_DEV_LOGIN=1`, Cidituc apagado y los adjuntos en la carpeta temporal.
   Las variables de quien corre las pruebas que la app lee (`DATABASE_URL`,
   `APP_URL`, `AUTH_DEV_LOGIN_STAGING`…) se sacan del entorno.
4. Espera a que `GET /api/salud` responda 200 y deja la URL en
   `E2E_BASE_URL`, que es el `baseURL` de las pruebas.
5. Al terminar detiene la app y PostgreSQL y borra la carpeta.

Los logs de la semilla, del build y de la app quedan en esa carpeta mientras
corre; si la app no arranca, el error trae las últimas líneas.

**Por qué `next start` con `NODE_ENV=test`.** Es el build de producción (el
que recomienda la guía de Next, `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`),
pero:

- con `NODE_ENV=test` Next **no lee `.env.local`** (ni
  `.env.development.local`): la app no puede terminar apuntando a la base o
  a la configuración de desarrollo;
- el login simulado se habilita sin tocar la protección de producción:
  `src/lib/entorno.ts` prohíbe `AUTH_DEV_LOGIN` con `NODE_ENV=production`
  (y `src/lib/arranque.ts` termina el proceso), y `/dev/login` sigue dando
  404 en producción. Con `test` la regla no aplica, igual que en desarrollo;
- Next elige el runtime de desarrollo de React solo con
  `NODE_ENV=development`: con `test` corre el de producción.

`next build` tarda unos segundos con la caché de Turbopack. Para iterar sobre
una prueba sin volver a compilar (cuando no se tocó la app):

```bash
E2E_SIN_BUILD=1 npx playwright test tests/e2e/circuito.spec.ts
```

**Por qué no el `webServer` de Playwright.** Playwright lo arranca antes del
`globalSetup` (todavía no habría base) y en Windows lo termina con
`taskkill /T /F`, sin apagado ordenado: el PostgreSQL efímero quedaría
huérfano. Acá todo el ciclo está en el `globalSetup` y su teardown.

Si una corrida se corta con Ctrl+C antes del teardown, puede quedar un
`node.exe` (la app) y un `postgres.exe` escuchando en puertos altos, y la
carpeta `cementeria-e2e-*` en `%TEMP%`. No molestan a otras corridas; se
cierran desde el Administrador de tareas y se borra la carpeta.

## Configuración (`playwright.config.ts`)

- Solo Chromium, `locale` `es-AR` y zona horaria de Tucumán.
- 3 workers (2 en CI); las pruebas de un mismo archivo van en orden. Sin
  reintentos: una prueba que falla a veces es un defecto.
- Sin esperas fijas: todo con las aserciones con espera de Playwright
  (`expect(...).toBeVisible()`, `toHaveURL`, `toHaveText`…).
- Trazas y capturas solo de las que fallan, en `test-results/`; el reporte
  HTML en `playwright-report/` (`npx playwright show-report`). Los dos están
  en `.gitignore`.

## Cómo escribir una prueba

Archivo `tests/e2e/<tema>.spec.ts`. Reglas:

- **Selectores por rol y texto accesible** (`getByRole`, `getByLabel`), nunca
  por clases ni estructura. Si no se encuentra un control por su nombre,
  probablemente tampoco lo encuentre quien usa un lector de pantalla.
- **Independientes y sin orden:** cada prueba crea lo que necesita (un
  expediente nuevo, una plantilla con código único) con datos ficticios únicos
  (`datosAlta()`, `letrasUnicas()`, `dniUnico()`), y no compara cantidades
  globales: las otras pruebas escriben en la misma base al mismo tiempo.
- **Nada que cambie lo que ven las demás:** no publicar plantillas, no cerrar
  años de feriados, no desactivar usuarios de la semilla.
- **Sin `waitForTimeout`.**

Ayudas en `ayudas.ts`:

| Ayuda | Para qué |
|---|---|
| `entrarComo(page, quien)` | Entra por `/dev/login` ("Entrar como…") como el usuario ficticio del área y espera su inicio (bandeja, o panel para Dirección y el admin). `quien`: `mesa`, `computo`, `liquidacion`, `legal`, `administrativo`, `tributario`, `direccion`, `admin` |
| `nuevaSesion(browser, quien)` | Un contexto de navegador nuevo (otras cookies) ya ingresado: `{ context, page }`. Para que cada área trabaje en su sesión, o dos personas del mismo área a la vez. Cerrarlo con `context.close()` |
| `USUARIOS` | Cómo se ve cada usuario en `/dev/login` ("Cómputo, Prueba") |
| `datosAlta(cambios?)` | Datos ficticios de un alta con apellido (`FICTICIO XXXXXX`), DNI (9…), teléfono (0381 000-…), correo (`@ejemplo.test`), padrón, N° municipal y lote únicos, en la sección C |
| `abrirAltaRenovacionOeste(page)` | `/expedientes/nuevo` con "Renovación, pago de contado" y el Cementerio del Oeste elegidos |
| `completarAlta(page, datos)` | Completa el formulario (monumento, ubicación, padrón, N° municipal, titular como contacto y los documentos de `datos.documentos`) sin guardar |
| `darDeAlta(page, datos?)` | Todo lo anterior y "Guardar": devuelve el número interno con la ficha abierta. La página tiene que estar con la sesión de Mesa de Entradas |
| `grupoTitular(page)` | El grupo de campos del titular en el formulario |
| `abrirFicha(page, numero)`, `numeroDeLaFicha(page)` | Ir a la ficha y esperar su título; leer el número de la ficha abierta |
| `datoDeLaFicha(page, "Paso actual")` | El valor de un dato del encabezado de la ficha ("Paso actual", "Área actual", "Ubicación en el archivo"…) |
| `dialogo(page, nombre?)` | El diálogo abierto (por su título) |
| `accion("Tildar", "Carátula impresa…")` | El nombre accesible de los botones "Acción: objeto" de la ficha (el objeto va en texto para lectores de pantalla) |
| `esperarAviso(page, texto)` | El aviso de lo último que se hizo (`role="status"`) |
| `confirmarRecepcion(page)` | "Confirmar recepción" desde la ficha |
| `resolverFaltantes(page, "Dar pase" \| "Concluir")` | Con un diálogo "Faltan N" abierto, resuelve cada ítem con su acceso directo (tilda, con la fecha de hoy si la pide; marca documentos como presentados) y espera que la lista baje, hasta llegar al formulario |
| `darPase(page, pasoNuevo, destino?)` | "Dar pase" (resolviendo lo que falte) al destino preseleccionado o a `destino`, y espera que la ficha muestre `pasoNuevo` ("3 de 7: Liquidación y boleta"). Los campos del trámite que se piden para avanzar no se resuelven acá: van por "Editar" |
| `abrirPestana(page, "Por confirmar")`, `filaDeBandeja(page, numero)` | Una pestaña de la bandeja y la fila de un expediente |
| `hoyEnTucuman()`, `conPuntos(dni)`, `dniUnico()`, `letrasUnicas(n)` | Fechas y datos ficticios |
| `PNG_CHICO` | Un PNG válido de 1×1 para `setInputFiles` (los adjuntos se controlan por magic bytes) |

## Qué cubre cada archivo

| Archivo | Qué prueba |
|---|---|
| `alta.spec.ts` | Alta desde Mesa de Entradas de una renovación de contado en el Oeste: error de campo (sección fuera de la A a la H) con `aria-invalid`, mensaje enlazado y resumen con foco que lleva al campo; corregido, "Guardar e imprimir carátula" abre la carátula con el número, el N° municipal, el titular y el QR, y la ficha queda con la sección normalizada. 26/10/2026: la carátula lleva la huella del historial, "Verificar integridad" de la ficha dice "Historial íntegro: 1 movimiento." con la misma huella, y los filtros del historial (botones con `aria-pressed`) filtran sin recargar |
| `circuito.spec.ts` | El circuito completo de 7 pasos: Mesa resuelve "Faltan 4" y da el pase a Cómputo; Cómputo lo confirma desde Por confirmar, tilda con dato, adjunta un PNG y da el pase; Liquidación lo devuelve con motivo; Cómputo lo ve en rojo con "Devuelto por Liquidación: motivo" y lo reenvía directo; Liquidación, Legal y Administrativo resuelven lo suyo; Cómputo completa el período de la concesión (Editar) y pasa a la entrega; Administrativo concluye ("Falta 1") y archiva con caja. Después (26/10/2026), los avisos: Cómputo deja su campana en cero ("Marcar todos como leídos"; el panel recibe el foco y Escape lo cierra y devuelve el foco), Liquidación le devuelve un expediente y la campana dice "Avisos, 1 sin leer"; el aviso trae el motivo y "Prioridad alta", y abrirlo lleva a la ficha y lo deja leído. Va en este archivo porque es el único otro que le manda expedientes a Cómputo: las pruebas de un mismo archivo corren en orden y el contador no se mezcla |
| `conflicto.spec.ts` | Dos sesiones de Mesa de Entradas sobre el mismo expediente: la segunda, con la ficha vieja, recibe "Otro usuario modificó el expediente; recargá", recarga y su acción sale |
| `busqueda.spec.ts` | Buscador del encabezado: DNI con puntos (abre la ficha directo), N° interno corto ("31/2026") y apellido sin acentos ni eñe; un DNI inexistente no encuentra nada |
| `enmascarado.spec.ts` | Asesoría Legal, que nunca tuvo el expediente, ve teléfono, correo y domicilio enmascarados; "Ver datos completos" rechaza un motivo corto y con uno válido los muestra; Mesa de Entradas los ve sin pedir |
| `panel.spec.ts` | Como Dirección: el conteo "En trámite" lleva a la búsqueda con ese estado y la celda Mesa de Entradas × Renovación de la matriz, a la búsqueda con el área y el tipo de trámite (con el expediente que creó la prueba entre los resultados) |
| `metricas.spec.ts` | Métricas de gestión: se abren desde el panel y quedan marcadas en la barra; las secciones con su gráfico (texto alternativo) y su tabla; "En trámite hoy" lleva a la búsqueda; el CSV de una tabla baja; los filtros (por semana, con la carga histórica) quedan en la URL; un alta nueva suma en el flujo del mes; un operador no ve el ítem, es redirigido y el CSV le da 403 |
| `admin.spec.ts` | El admin crea un borrador de plantilla con código único, "Validar" muestra el error en la pestaña Pasos (con su contador) y el enlace del error lleva a ella; "Descartar borrador…" con confirmación lo borra. No publica nada |
| `accesibilidad.spec.ts` | Los diálogos de la ficha ("Faltan N", tildar, documento, nota) y "Nueva plantilla" reciben el foco al abrirse, se cierran con Escape y devuelven el foco al botón que los abrió |
