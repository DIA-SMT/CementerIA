# Borrador técnico para el acto de creación del archivo de CementerIA (art. 22, Ley 25.326)

> **Esto es un insumo técnico, no un texto normativo.** Lo escribe la Dirección de Inteligencia Artificial para que Asesoría Legal redacte el acto de creación del archivo. Describe qué datos guarda la herramienta, cómo los obtiene, quién los ve y cómo los protege, según el diseño confirmado el 19/10/2026 (`docs/propuesta-mvp.md`).
> La redacción, la forma jurídica, las citas normativas y todo lo marcado **"a definir"** corresponden a Asesoría Legal. Si algo de lo descripto no se puede sostener jurídicamente, se cambia la herramienta antes de cargar datos reales.
> Los ejemplos de este documento son ficticios.

## Datos a completar

| Marcador | Qué va | Quién lo define |
|---|---|---|
| `<NOMBRE_ARCHIVO>` | Nombre oficial del archivo. Propuesta: "CementerIA – Seguimiento de expedientes de la Dirección de Cementerios" | Asesoría Legal |
| `<RESPONSABLE_ARCHIVO>` | Órgano responsable del archivo y su dependencia jerárquica | Asesoría Legal (pregunta 10) |
| `<OFICINA_DERECHOS>` | Oficina, domicilio, horario y correo donde se ejercen los derechos de acceso, rectificación y supresión | Asesoría Legal (pregunta 10) |
| `<NORMA_DE_CREACION>` | Tipo de acto y boletín donde se publica | Asesoría Legal |

## 1. Identificación del archivo

- **Nombre:** `<NOMBRE_ARCHIVO>`.
- **Norma de creación:** `<NORMA_DE_CREACION>`.
- **Organismo:** Municipalidad de San Miguel de Tucumán.
- **Área que lo usa:** Dirección de Cementerios, con sus áreas internas: Mesa de Entradas, Cómputo, Liquidación, Legal, Administrativo, Departamento Tributario / Notificación y la Dirección.
- **Área que lo desarrolla y opera:** Dirección de Inteligencia Artificial.
- **Infraestructura:** servidores del Área de Sistemas de la Municipalidad.
- **Responsable del archivo:** `<RESPONSABLE_ARCHIVO>` (a definir).
- **Soporte:** informatizado. Es una aplicación web interna, accesible solo para empleados dados de alta.

## 2. Finalidad

Registrar y seguir el recorrido interno de los expedientes de los trámites de la Dirección de Cementerios:
- en qué área está cada expediente y desde cuándo;
- qué tareas se cumplieron;
- qué documentación se presentó;
- quién registró cada paso.

Reemplaza la **ficha de papel** en la que hoy se anotan los pases entre áreas.

Hoy cubre cuatro trámites: renovación de concesión de contado, renovación de concesión con plan de pagos, renovación "sin perjuicio de tercero" y nueva concesión de un monumento caducado. Se pueden agregar otros sin cambiar la herramienta, por ejemplo transferencias, caducidades, cinerario común, inhumaciones, exhumaciones y traslados de restos. Si el acto tiene que nombrar los trámites, conviene que lo haga de forma genérica ("trámites de la Dirección de Cementerios") para no tener que modificarlo cada vez que se agregue uno.

**Lo que la herramienta no hace**, y el acto puede dejar explícito:
- No reemplaza al expediente de papel, que sigue siendo el oficial.
- No calcula importes ni liquida: registra qué conceptos se cobran, sin montos.
- No decide ni cambia por su cuenta el estado de un trámite. Por ejemplo, cuando vence el plazo ante la DIM, solo muestra un aviso.
- No se conecta con otros sistemas: ni con Cómputo, ni con el sistema municipal de expedientes, ni con la DIM.

## 3. Usos

1. Dar de alta el expediente en Mesa de Entradas, con los datos del trámite y de las personas declaradas.
2. Registrar los pases entre áreas, la recepción en cada área, las devoluciones (siempre con motivo), las tareas cumplidas y la documentación presentada.
3. Ubicar un expediente y saber qué le falta para avanzar.
4. Buscar expedientes por número interno, número de expediente municipal, padrón, ubicación en el cementerio, apellido y nombre, o DNI de las personas del trámite.
5. Avisar las demoras de cada área y el vencimiento del plazo de 30 días hábiles para iniciar la forma de pago ante la DIM.
6. Contactar a la persona de contacto del trámite: el empleado ve el teléfono o el correo, o abre un mensaje de WhatsApp desde su equipo.
7. Imprimir la carátula del expediente, sin teléfono ni domicilio, y el historial de pases. Las dos se agregan al expediente de papel.
8. Obtener estadísticas internas (cantidades y tiempos por área y por trámite) y exportar listados **sin datos de contacto**. Esto último solo lo pueden hacer la Dirección y el administrador.
9. Controlar el uso: registrar quién consultó qué y guardar los cambios de configuración.
10. Pasar a la herramienta, desde la ficha de papel, los expedientes iniciados antes de que existiera (carga histórica).

**Usos excluidos**, para que el acto los descarte si Asesoría Legal lo considera conveniente:
- cruzar estos datos con otras bases o padrones;
- enviar mensajes automáticos;
- usar los datos con un fin distinto del seguimiento del trámite;
- cederlos a terceros.

## 4. Personas alcanzadas

| Grupo | Quiénes son | Cómo aparecen |
|---|---|---|
| Titulares de concesiones | Concesionarios de un monumento o espacio en los cementerios municipales (Oeste, Norte y Jardín Norte) | Uno por trámite. Pueden estar vivos o fallecidos: en la renovación "sin perjuicio de tercero" suponemos que el titular falleció, algo que se confirma en el taller con la Dirección |
| Solicitantes | Quien inicia o gestiona el trámite: un familiar, un apoderado u otra persona | Con su vínculo con el titular ("hijo", "cónyuge", "apoderado") |
| Personas fallecidas | Personas cuyos restos se inhuman, están en el monumento o se trasladan | En la nueva concesión y en trámites futuros como inhumación, exhumación, traslado o cinerario |
| Cesionarios y otros roles | Personas que intervienen en trámites que se agreguen después, por ejemplo una transferencia | Según lo defina cada trámite |
| Empleados municipales | Usuarios de la herramienta en la Dirección de Cementerios y el administrador | Con su área y su rol |

**No hay un registro general de personas.** Cada expediente tiene su propia lista. Si la misma persona interviene en dos trámites, figura dos veces, una en cada uno. Es intencional: así se evita armar un padrón cruzado.

**Carácter obligatorio u optativo de los datos** (la forma de expresarlo frente a la persona la define Asesoría Legal):
- Para cada trámite, la Dirección pide al concesionario los datos y documentos que ese trámite fija. Hoy son:
  - el formulario de inicio;
  - una fotocopia del DNI;
  - una fotocopia de una boleta de servicio, para verificar el domicilio;
  - según el trámite, actas de defunción, actas que acrediten el vínculo y la constancia para inhumar.
- En la herramienta:
  - el apellido y los nombres de cada persona declarada son obligatorios;
  - el DNI, el teléfono, el correo, el domicilio, el vínculo y la fecha de defunción se registran cuando se tienen;
  - en los trámites que inicia el concesionario, una de las personas tiene que quedar marcada como contacto.
- De los empleados se registran los datos necesarios para darles acceso. Vienen de Cidituc, el sistema de identidad municipal.

## 5. Datos que se registran

### 5.1 Por categoría

| Categoría | Datos | Quién los ve |
|---|---|---|
| **A. Datos del trámite** | Número interno (formato ficticio: CEM-2026-00042), número de expediente municipal, fecha de inicio, tipo de trámite y forma de pago, cementerio, tipo de monumento, ubicación en el cementerio (por ejemplo sección, cuadro, lote y número), padrón, observaciones, datos propios de cada trámite (período de la concesión, número de resolución y de expediente de caducidad), estado y área actual | Todos los usuarios |
| **B. Identificación de las personas** | Apellido, nombres, DNI, papel en el trámite (titular, solicitante, difunto, cesionario), vínculo con el titular, si falleció y la fecha de defunción | Todos los usuarios |
| **C. Contacto** | Teléfono (y si usa WhatsApp), correo electrónico, domicilio; cuál de las personas es el contacto | **Completos**, solo el área que tiene el expediente, las áreas por las que pasó, Mesa de Entradas, la Dirección y el administrador. **El resto** los ve ocultos y, para verlos, tiene que escribir un motivo, que queda registrado |
| **D. Documentación** | Qué documentos se presentaron, cuáles no corresponden y por qué. Opcionalmente, una copia digital (PDF o foto) de algunos, como el comprobante de pago o el informe técnico | La constancia de presentación, todos los usuarios. Las copias digitales, los mismos que ven el contacto completo |
| **E. Recorrido del expediente** | Cada pase, recepción, devolución (con motivo), tarea cumplida (a veces con el número de boleta, dictamen, resolución o título, o con una fecha), cambio de estado, nota y corrección. De cada uno se guardan la fecha en que ocurrió, la fecha en que se registró, el empleado que lo registró y su área | Todos los usuarios |
| **F. Empleados usuarios** | CUIL, identificador de Cidituc, apellido, nombre, correo, área, rol, si está activo, fecha del último ingreso | El administrador. El nombre del autor de cada paso lo ven todos en el historial |
| **G. Control de accesos** | Ingresos, salidas e intentos rechazados; qué ficha abrió cada empleado; quién pidió ver datos completos y con qué motivo; quién vio o descargó cada copia digital; impresiones; exportaciones; dirección IP; fecha y hora | El administrador |
| **H. Cambios de configuración** | Altas y cambios de usuarios (área, rol, alta y baja), de trámites, de catálogos y de feriados, con el antes y el después y el autor | El administrador |

**Datos que no se registran:**
- **importes:** la liquidación la hace otra área en sus sistemas;
- **contraseñas:** el ingreso es con Cidituc, y la herramienta no guarda el comprobante de ingreso (token);
- **la causa de muerte:** por defecto, las actas de defunción y las de vínculo **no se escanean**, porque el acta puede incluir la causa de muerte, que es un dato de salud. Solo se registra que se presentaron. Es una configuración de cada trámite, no un impedimento técnico: ver el límite 6 de la sección 8;
- **datos de otros sistemas.**

### 5.2 Estructura básica

- **Un registro por expediente**, con los datos del trámite y el lugar donde está.
- **Para cada expediente, la lista de personas declaradas en ese trámite.** Cuando se corrige el dato de una persona, se guarda una versión nueva y la anterior queda como "no vigente". Así se puede reconstruir qué se sabía en cada momento.
- **Para cada expediente, un historial de movimientos al que solo se le pueden agregar asientos.** No se puede modificar ni borrar, y eso lo impide la propia base de datos, no solo la aplicación. Los errores se corrigen agregando un asiento de corrección. El historial no copia los datos personales: solo señala a qué persona del expediente se refiere.
- **Un registro de accesos y un registro de cambios de configuración**, aparte y también solo de agregado.
- **Las copias digitales de documentos** son archivos en el disco del servidor municipal, fuera del sitio web. Solo se abren a través de la herramienta y con control de permisos.
- **Tablas auxiliares sin datos personales:** áreas, cementerios y su forma de ubicación, tipos de monumento, tipos de trámite, recorridos de cada trámite y feriados.

## 6. Forma de obtención y actualización

| Origen | Qué datos | Cómo |
|---|---|---|
| El concesionario o el solicitante | Identificación, contacto, vínculo y documentación | Lo declara y lo presenta en Mesa de Entradas al iniciar el trámite (formulario de inicio y documentos). Mesa lo carga en el alta |
| Áreas de la Dirección de Cementerios | Constancia de Cómputos (datos personales y catastrales), estado de cuenta, resoluciones, títulos, notificaciones | Cada área registra que el documento existe y, a veces, su número o su fecha |
| Fichas de papel existentes | Recorrido de expedientes iniciados antes de la herramienta | Mesa de Entradas los transcribe indicando la fuente (por ejemplo, "ficha papel") y puede adjuntar una foto de la ficha |
| Cidituc (sistema de identidad municipal) | Apellido, nombre, correo, CUIL e identificador del empleado | Al ingresar. El alta, el área y el rol los asigna el administrador |

- **No se obtienen datos de otras bases.** No hay conexión con Cómputo, con el sistema municipal de expedientes ni con la DIM.
- **Actualización:**
  - El contacto y las observaciones los corrigen Mesa de Entradas o el área que tiene el expediente.
  - Los datos identificatorios (personas, DNI, ubicación, padrón, número municipal y fecha de inicio) los corrigen Mesa de Entradas, o Cómputo cuando tiene el expediente.
  - El administrador puede corregir todo.
  - Cada corrección deja constancia de quién la hizo y cuándo. Después del primer pase, también del motivo.

## 7. Cesiones, transferencias e interconexiones

**Ninguna.** No se ceden datos a terceros ni a otros organismos, y la herramienta no se conecta con otros sistemas.

Acceden solo empleados de la Dirección de Cementerios dados de alta y el administrador. La DIM y los cementerios no tienen acceso: el expediente de papel viaja, la herramienta no.

**Situaciones que, según el diseño, no son cesiones**, pero que conviene que Asesoría Legal evalúe para contemplarlas o descartarlas en el acto:

1. **Validación de identidad de los empleados contra Cidituc**, que es municipal. La herramienta envía el comprobante de ingreso y recibe el nombre, el CUIL y el correo del empleado. No envía datos de concesionarios.
2. **Backups cifrados** en el servidor de backup del Área de Sistemas, que es municipal.
3. **Botón de WhatsApp.** Abre en el equipo del empleado una conversación con el número de contacto, y el mensaje solo lleva el número interno del expediente y el área. El número de teléfono llega a WhatsApp cuando el empleado decide usar el botón.
4. **Exportación de listados** (CSV) sin teléfono, correo ni domicilio. Solo la pueden hacer la Dirección y el administrador, y queda registrada.
5. **Impresiones** (carátula e historial) que se agregan al expediente de papel. La carátula no lleva teléfono ni domicilio.

## 8. Responsable y oficina para ejercer derechos

- **Responsable del archivo:** `<RESPONSABLE_ARCHIVO>`, con su dependencia jerárquica (a definir).
- **Oficina para ejercer los derechos de acceso, rectificación y supresión:** `<OFICINA_DERECHOS>` (a definir).

**Cómo responde la herramienta a cada derecho:**

| Derecho | Qué permite hacer la herramienta |
|---|---|
| Acceso | El administrador encuentra todos los expedientes en los que figura la persona (búsqueda por DNI o por apellido y nombre) y ve los datos registrados de esa persona en cada uno |
| Rectificación | Se edita el dato. Se guarda una versión nueva de la persona y queda la constancia de la anterior |
| Supresión | El administrador, con motivo, borra los datos personales de esa persona en ese expediente: apellido, nombres, DNI, teléfono, correo, domicilio y vínculo. Cada versión registrada de la persona (una por cada vez que se corrigieron sus datos) se suprime con una operación propia: el administrador repite la supresión en cada versión. Se conservan su papel en el trámite, si falleció y la fecha de defunción, si el teléfono era de WhatsApp (sí o no, sin el número) y la constancia de la supresión. Las copias digitales de documentos de esa persona se pueden borrar del disco; queda el nombre del archivo, su tamaño y su huella digital |

**Límites que hay que conocer:**
1. **Backups.** Conservan los datos suprimidos hasta que vence su retención: con la retención propuesta, alrededor de 12 meses. Recién entonces la supresión alcanza todas las copias (pregunta 10).
2. **Texto libre en el historial.** Las notas, observaciones y motivos los escribe el empleado. Como el historial no se puede modificar ni borrar, un dato personal escrito ahí no se puede suprimir: una corrección lo marca como corregido, pero el texto original se conserva. Asesoría Legal tiene que evaluar este punto.
3. **Fecha de defunción.** La supresión, tal como está diseñada, conserva la fecha de defunción y la marca de fallecido. Si Asesoría Legal considera que también hay que borrarlas, se ajusta la herramienta antes de cargar datos reales.
4. **Empleados.** Sus datos no se borran cuando se dan de baja (quedan inactivos), porque identifican al autor de cada asiento del historial.
5. **Papel.** El expediente de papel y la ficha de papel quedan fuera del alcance de la herramienta.
6. **Actas y causa de muerte.** Que las actas no se escaneen es lo que viene configurado en cada trámite ("adjunto: no"), y el administrador lo puede cambiar en una versión nueva del trámite. Además, nada impide técnicamente que un empleado adjunte una imagen que muestre el acta (por ejemplo, la foto de la ficha de papel en la carga histórica) o escriba la causa en una observación. Si se quiere que sea una garantía y no solo una configuración por defecto, hay que decidirlo y construir el bloqueo; si no, el acto no debería presentarlo como garantía.

## 9. Medidas de seguridad

**Acceso**
- Solo ingresan empleados con identidad validada por Cidituc **y** dados de alta por el administrador, con un área y un rol: operador, lectura o administrador.
- Lo que cada uno puede hacer y ver se controla en el servidor en cada operación. Desactivar a un usuario le corta el acceso en su siguiente operación.
- La sesión se cierra tras 60 minutos sin uso y, como máximo, 10 horas después del ingreso (a confirmar con la Dirección de Cementerios). Salir cierra todas las sesiones de ese usuario.
- El comprobante de ingreso de Cidituc no se guarda ni se registra en ningún log.
- Las conexiones al sitio van cifradas (HTTPS) y, si se confirma, solo se acepta acceso desde la red municipal.

**Minimización**
- Los datos de contacto y las copias digitales los ven completos solo las áreas que trabajan el expediente. El resto los ve ocultos y tiene que dar un motivo para verlos, que queda registrado.
- Los listados exportados y la carátula impresa no llevan teléfono ni domicilio. Los listados tampoco llevan correo.
- Por defecto, las actas de defunción y de vínculo no se escanean (ver el límite 6 de la sección 8).
- No hay un padrón general de personas.

**Registro y control**
- Quedan registrados:
  - los ingresos;
  - las aperturas de ficha;
  - los pedidos de datos completos, con su motivo;
  - las vistas y descargas de copias digitales;
  - las impresiones;
  - las exportaciones.
- Se registran los cambios de usuarios, permisos y configuración, con el antes y el después.
- Las copias digitales se ven dentro de la herramienta. Descargarlas es una acción aparte, que queda registrada, para que no queden copias en las computadoras compartidas.

**Integridad del historial**
- La base de datos impide modificar o borrar el historial, incluso ante un error de la aplicación.
- El único que puede alterarlo es un administrador del servidor de base de datos (superusuario), que es del Área de Sistemas. Para que una alteración así se detecte, se pide a Sistemas que registre los cambios de estructura y las sesiones de cualquier usuario distinto de la aplicación, y se compara contra los backups.
- No se registran en los logs del servidor de base las operaciones normales de la aplicación, para no volcar datos personales.

**Infraestructura**
- La herramienta corre en servidores municipales. No se usan servicios de nube.
- Las copias digitales se guardan fuera del sitio web, con permisos de solo lectura para el usuario del servicio, y se abren solo a través de la herramienta.

**Backups**
- Copia diaria de la base y de las copias digitales, **cifrada**, en el servidor de backup de Sistemas.
- La clave de cifrado se custodia fuera de ese servidor.
- Una vez por mes se prueba que los backups se puedan restaurar, en una instancia aislada y sin acceso desde la red, que se destruye al terminar. Hacerlo con datos reales depende de la respuesta de Asesoría Legal.

**Desarrollo y pruebas:** en los entornos de desarrollo y de prueba (staging) solo hay datos ficticios.

## 10. Plazos de conservación propuestos

| Qué | Plazo propuesto | Estado |
|---|---|---|
| Expedientes, personas e historial | Sin propuesta. La herramienta no prevé borrarlos, igual que la ficha de papel que reemplaza | **A definir** por Asesoría Legal; puede alinearse con el plazo de conservación del expediente de papel |
| Copias digitales de documentos | Sin propuesta | **A definir** (pregunta 10) |
| Registro de accesos | 24 meses | Propuesto, a confirmar |
| Registro de cambios de configuración | Sin propuesta | **A definir** |
| Backups | 30 copias diarias y 12 mensuales: los datos suprimidos desaparecen de todas las copias en alrededor de 12 meses | Propuesto, a confirmar |
| Logs del servidor de base de datos | Los define el Área de Sistemas | A informar por Sistemas |
| Datos de empleados | Mientras existan asientos del historial a su nombre. La baja los deja inactivos | Consecuencia del diseño |
| Instancia de prueba de restauración | Se destruye al terminar cada prueba mensual | Diseño |

## Anexo: relación con los contenidos que pide el art. 22

Correspondencia orientativa. Hay que verificarla contra el texto vigente.

| Contenido del acto | Dónde está en este borrador |
|---|---|
| Características y finalidad del archivo | Secciones 1 y 2 |
| Personas de las que se obtienen datos y carácter obligatorio u optativo | Sección 4 |
| Procedimiento de obtención y actualización | Sección 6 |
| Estructura básica y naturaleza de los datos | Sección 5 |
| Cesiones, transferencias o interconexiones | Sección 7 |
| Órgano responsable y dependencia | Sección 8 |
| Oficina para ejercer los derechos | Sección 8 |
| Medidas de seguridad y conservación (complemento) | Secciones 9 y 10 |
