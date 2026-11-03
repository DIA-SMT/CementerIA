import type { Recorrido } from "./motor";

/**
 * Los recorridos guiados, uno por pantalla, y la bienvenida general
 * (docs/diseno.md, "Recorridos guiados"). Texto de mostrador: corto, en
 * castellano llano, sin jerga. Cada paso apunta a un elemento con
 * `data-recorrido="<ancla>"`; si el elemento no está o no se ve (otro rol,
 * otro ancho, otra pestaña), el paso se saltea solo.
 *
 * Al cambiar el contenido de un recorrido, subir su `version`: se vuelve a
 * invitar a todos en esa pantalla.
 */

export const BIENVENIDA: Recorrido = {
  id: "bienvenida",
  nombre: "Bienvenida",
  // 3 (03/11/2026): cómo se mueve un expediente, qué le toca a cada uno, los días hábiles y Migue.
  version: 3,
  pasos: [
    {
      id: "hola",
      titulo: "Te damos la bienvenida a CementerIA",
      texto:
        "CementerIA reemplaza la ficha de papel de los pases. El papel sigue viajando entre las áreas, pero cada movimiento queda registrado: quién lo tuvo, desde cuándo y qué se hizo. Así se sabe siempre dónde está un expediente y qué le falta.",
    },
    {
      id: "circuito",
      titulo: "Cómo se mueve un expediente",
      texto:
        "Mesa de Entradas lo da de alta e imprime la carátula. Cada área lo recibe (confirma que tiene el papel), hace lo suyo y le da pase a la siguiente, o lo devuelve con el motivo si algo está mal. En el último paso se concluye y después se archiva en una caja.",
    },
    {
      id: "tu-trabajo",
      titulo: "Lo que te toca a vos",
      texto: {
        mesa: "Das de alta lo que llega al mostrador, imprimís la carátula y el comprobante con el código de consulta, y das el primer pase. También pasás al sistema las fichas viejas de papel y archivás lo que vuelve concluido.",
        operador:
          "Todos los días: confirmá lo que te llega cuando tengas el papel, hacé las subtareas y marcá los documentos de tu paso, y dale pase al área siguiente. Si algo está mal, devolvelo con el motivo. Atendé primero lo demorado y lo devuelto.",
        direccion:
          "Mirás todo el circuito sin tocar nada: cuántos expedientes tiene cada área, cuáles se demoran, qué plazos de la DIM vencen y cómo evolucionan los tiempos. Podés abrir cualquier expediente, pero no das pases ni lo modificás.",
        admin:
          "Te ocupás de la configuración: las plantillas de cada trámite, los usuarios, los catálogos (áreas, cementerios, feriados) y el sitio público. Los expedientes los trabajan las áreas. Cada cambio queda registrado en Auditoría.",
      },
    },
    {
      id: "dias",
      titulo: "Los días se cuentan hábiles",
      texto:
        "Las demoras y los plazos cuentan días hábiles: sin fines de semana ni feriados. Cada paso tiene un límite; si un expediente lo pasa, sale demorado, en rojo. Un pase que nadie confirma en 2 días hábiles también queda marcado.",
    },
    {
      id: "modulos",
      ancla: ["barra-modulos", "menu-celular"],
      titulo: "Los módulos",
      texto: {
        operador:
          "En el menú tenés la Bandeja (el trabajo de tu área, por pestañas), Buscar (cualquier expediente, aunque no sea de tu área) y el Panel (cómo está todo el circuito). El botón de abajo achica el menú a íconos.",
        mesa: "En el menú tenés la Bandeja, Nuevo expediente para el alta del mostrador, Buscar y el Panel. Las fichas viejas de papel que se están pasando al sistema están en la Bandeja, pestaña Carga histórica.",
        direccion:
          "En el menú tenés el Panel con el estado de todo el circuito, las Métricas de gestión con tiempos y tendencias, Buscar para abrir cualquier expediente y el Sitio público.",
        admin: "En el menú tenés el Panel, las Métricas, Buscar y Administración: plantillas, usuarios, catálogos, auditoría y sitio público.",
      },
    },
    {
      id: "buscador",
      ancla: "buscador-global",
      titulo: "Buscar desde cualquier pantalla",
      texto:
        "Escribí un N° de expediente (CEM-2026-42 o 42/2026), un DNI, un CUIT, un padrón o un apellido y apretá Enter. Con un número de expediente completo abre la ficha directo; si no, muestra todo lo que coincide.",
    },
    {
      id: "por-confirmar",
      ancla: "por-confirmar",
      titulo: "Lo que llegó a tu área",
      texto: {
        operador:
          "Cuántos expedientes le mandaron a tu área y nadie confirmó todavía. Si hay, se pone amarillo: tocalo para verlos. Confirmá cuando tengas el papel en la mano; hasta entonces sigue figurando en el área que lo mandó.",
      },
    },
    {
      id: "avisos",
      ancla: "campana-avisos",
      titulo: "Los avisos",
      texto: {
        operador:
          "La campana te avisa cuando llega un expediente, cuando te devuelven uno o cuando un plazo está por vencer o venció. El número es lo que no leíste; tocá un aviso para abrir el expediente.",
      },
    },
    {
      id: "migue",
      ancla: "migue",
      titulo: "Migue, el asistente",
      texto:
        "Migue contesta las dudas de la pantalla en la que estás y te busca datos: «¿dónde está el 42/2026?», «¿qué tengo demorado?». Solo consulta, no cambia nada. Si te tapa algo, arrastralo a otro lugar.",
    },
    {
      id: "ayuda",
      ancla: "boton-recorrido",
      titulo: "¿Dudas? Tocá el signo de pregunta",
      texto: "En cada pantalla, este botón te muestra para qué sirve cada parte. Lo podés usar las veces que quieras.",
    },
  ],
};

const BANDEJA: Recorrido = {
  id: "bandeja",
  nombre: "Bandeja",
  // 2 (03/11/2026): más detalle en cada parte y la carga histórica.
  version: 2,
  pasos: [
    {
      id: "pestanas",
      ancla: "bandeja-pestanas",
      titulo: "Tu bandeja, por pestañas",
      texto:
        "Por confirmar: lo que le mandaron a tu área y todavía no recibieron. En mi área: lo que ya tienen y hay que trabajar. Afuera: lo que siguen ustedes pero está en la DIM o en un cementerio. El número dice cuántos hay en cada una.",
    },
    {
      id: "confirmar",
      ancla: ["bandeja-lote", "bandeja-confirmar", "bandeja-pestana-por_confirmar"],
      titulo: "Confirmar la recepción",
      texto:
        "Cuando tengas el papel en la mano, confirmá que lo recibiste: con Confirmar, de a uno, o marcando varios y tocando Confirmar seleccionados. Queda anotado quién y cuándo. Hasta que lo confirmás, sigue figurando en el área que lo mandó.",
    },
    {
      id: "pase-rapido",
      ancla: "bandeja-pase-rapido",
      titulo: "Dar pase rápido",
      texto:
        "Si no falta nada y hay un solo destino posible, aparece este botón: manda el expediente al paso siguiente sin abrir la ficha. Para elegir otra fecha o dejar una observación, abrí la ficha.",
    },
    {
      id: "dias",
      ancla: ["bandeja-demorado", "bandeja-dias"],
      titulo: "Días en el área",
      texto:
        "Son días hábiles desde que llegó a tu área (en una ficha de papel, desde que se terminó de cargar). Cada paso tiene su límite: si lo pasa, se pone en rojo con un relojito y dice demorado. Atendé esos primero.",
    },
    {
      id: "devuelto",
      ancla: "bandeja-devuelto",
      titulo: "Devueltos, en rojo",
      texto:
        "Si otra área te devuelve un expediente, la fila se pinta de rojo y dice quién lo devolvió y por qué. Corregí lo que dice el motivo y volvé a darle pase.",
    },
    {
      id: "plazos",
      ancla: "bandeja-pestana-plazos",
      titulo: "Plazos de la DIM",
      texto:
        "Los que esperan el pago en la DIM, con su vencimiento: en ámbar si faltan 5 días hábiles o menos, en rojo si ya venció. Si vence sin pago, Mesa de Entradas puede archivarlo y abrir uno nuevo vinculado.",
    },
    {
      id: "carga-historica",
      ancla: "bandeja-pestana-carga_historica",
      titulo: "Carga histórica",
      texto:
        "Las fichas de papel de antes del sistema que se están pasando. Mientras la carga está abierta no se dan pases ni se archiva: se copia el papel y al final se toca Terminar carga histórica. Desde ahí sigue como cualquier otro.",
    },
    {
      id: "abrir",
      ancla: "bandeja-abrir",
      titulo: "Abrir la ficha",
      texto: "Con Abrir (o tocando el número) ves la ficha completa: qué falta para avanzar, los documentos, el historial y los botones para dar el pase o devolverlo.",
    },
  ],
};

const FICHA: Recorrido = {
  id: "ficha",
  nombre: "Ficha del expediente",
  // 2 (03/11/2026): más detalle, y el código de consulta.
  version: 2,
  pasos: [
    {
      id: "cabecera",
      ancla: "ficha-cabecera",
      titulo: "El expediente",
      texto:
        "Arriba están el número, el estado (En trámite, Espera de pago en la DIM, Concluido, Archivado o Anulado) y las alertas: Devuelto, Sin confirmar recepción, Plazo por vencer, Carga histórica abierta…",
    },
    {
      id: "paso-area",
      ancla: "ficha-paso-area",
      titulo: "En qué paso está y quién lo tiene",
      texto:
        "Paso actual: en qué parte del trámite va. Área actual: quién tiene el papel ahora y desde cuándo. Si dice Sin confirmar la recepción, el papel salió del área anterior y nadie avisó todavía que llegó.",
    },
    {
      id: "codigo",
      ancla: "ficha-codigo-consulta",
      titulo: "El código de consulta",
      texto:
        "Va en el comprobante que se le da a la persona: con el número y este código sigue el trámite desde la página pública, sin venir a preguntar. Si lo pierde o lo conoce alguien que no debe, Mesa de Entradas lo cambia por otro.",
    },
    {
      id: "faltan",
      ancla: "ficha-faltan",
      titulo: "Qué falta para avanzar",
      texto: {
        operador:
          "Lo que tu área tiene que resolver antes de dar el pase: subtareas, documentos y datos del trámite. Cada renglón tiene su botón para resolverlo ahí mismo. Cuando no falta nada, ya se puede dar el pase.",
        todos: "Lo que el área que lo tiene debe resolver antes de dar el pase al paso siguiente: subtareas, documentos y datos del trámite.",
      },
    },
    {
      id: "acciones",
      ancla: "ficha-acciones-paso",
      titulo: "Dar pase o devolver",
      texto:
        "Dar pase lo manda al paso siguiente. Si todavía falta algo, el botón se pone ámbar y dice Faltan N: al tocarlo te muestra qué. Devolver lo manda a un paso anterior, siempre con el motivo, que le llega como aviso al área.",
    },
    {
      id: "recorrido",
      ancla: "ficha-recorrido",
      titulo: "Los pasos del trámite",
      texto: {
        operador: "Todos los pasos, en orden: en verde los cumplidos y en azul el actual. Las subtareas del paso actual se tildan acá.",
        todos: "Todos los pasos, en orden: en verde los cumplidos y en azul el actual, con sus subtareas.",
      },
    },
    {
      id: "documentacion",
      ancla: "ficha-documentacion",
      titulo: "Documentación y adjuntos",
      texto: {
        operador: "Marcá lo que presentaron y adjuntá la foto o el PDF. Más abajo, en Adjuntos, están todos los archivos del expediente.",
        todos: "Qué documentos se presentaron y cuáles faltan. Más abajo, en Adjuntos, están los archivos del expediente.",
      },
    },
    {
      id: "historial",
      ancla: "ficha-historial",
      titulo: "El historial",
      texto:
        "Todo lo que pasó, en orden, con quién y cuándo; lo copiado del papel dice de dónde salió. Nada se borra: un error se corrige con un movimiento nuevo. Podés filtrar por tipo o por paso, y Verificar integridad comprueba que nadie lo haya alterado.",
    },
    {
      id: "imprimir",
      ancla: "ficha-imprimir",
      titulo: "Imprimir la carátula",
      texto: "La carátula va en la tapa de la carpeta. Trae un código QR que abre esta ficha desde el celular.",
    },
  ],
};

const NUEVO: Recorrido = {
  id: "expediente-nuevo",
  nombre: "Nuevo expediente",
  version: 1,
  pasos: [
    {
      id: "pasos",
      ancla: "nuevo-pasos",
      titulo: "El alta, en dos pasos",
      texto: "Primero elegís el trámite y el cementerio. Con eso se arma el formulario con lo que hace falta para ese caso.",
    },
    {
      id: "tramite",
      ancla: "nuevo-tramite",
      titulo: "Tipo de trámite",
      texto: "Elegí qué se viene a hacer: renovación, transferencia… Cada trámite tiene sus pasos, sus documentos y sus datos.",
    },
    {
      id: "cementerio",
      ancla: "nuevo-cementerio",
      titulo: "Cementerio",
      texto: "Cada cementerio ubica distinto (sección, lote, galería, fila…): el formulario te va a pedir los datos de ubicación de ese cementerio.",
    },
    {
      id: "continuar",
      ancla: "nuevo-continuar",
      titulo: "Continuar",
      texto: "Con Continuar pasás al formulario. Si te equivocaste, desde ahí podés volver a cambiar el trámite o el cementerio.",
    },
  ],
};

const FORMULARIO: Recorrido = {
  id: "expediente-formulario",
  nombre: "Formulario del expediente",
  // 2 (03/11/2026): la fecha de inicio y las fichas de papel; el contacto opcional en esas.
  version: 2,
  pasos: [
    {
      id: "tramite",
      ancla: "form-tramite",
      titulo: "Lo que elegiste",
      texto: "El trámite y el cementerio que elegiste. Algunos trámites piden además la forma de pago.",
    },
    {
      id: "ubicacion",
      ancla: "form-monumento",
      titulo: "Monumento y ubicación",
      texto:
        "Los datos de ubicación son los de ese cementerio. Abajo van el padrón y el N° municipal. Si ya hay otro expediente en el mismo lugar o con el mismo padrón, te avisa antes de guardar.",
    },
    {
      id: "personas",
      ancla: "form-personas",
      titulo: "Las personas",
      texto:
        "El titular y, si el trámite lo pide, las demás personas. Cada una puede ser persona física (con DNI) o jurídica (con CUIT y razón social). Marcá cuál es el contacto, con teléfono o correo; en una ficha de papel vieja es opcional.",
    },
    {
      id: "extras",
      ancla: "form-extras",
      titulo: "Datos del trámite",
      texto: "Los datos propios de este trámite. En el alta no son obligatorios; algunos se piden más adelante para poder avanzar.",
    },
    {
      id: "documentos",
      ancla: "form-documentos",
      titulo: "Documentación recibida",
      texto: "Marcá lo que te entregan hoy en el mostrador. Lo que no marques queda pendiente y se puede marcar después en la ficha.",
    },
    {
      id: "inicio",
      ancla: "form-inicio",
      titulo: "Fecha de inicio y fichas de papel",
      texto: {
        mesa: "Si el trámite empezó hace unos días, poné la fecha real (hasta 30 días atrás). Si es una ficha vieja de papel, marcá Expediente iniciado antes del sistema: acepta fechas desde 1950, pide la fuente y después se transcriben sus pases.",
      },
    },
    {
      id: "guardar",
      ancla: "form-guardar",
      titulo: "Guardar",
      texto:
        "Guardar e imprimir carátula guarda el expediente y abre la carátula para imprimirla. Guardar solo guarda y te lleva a la ficha. Si falta algo, te marca en rojo qué corregir.",
    },
  ],
};

const BUSQUEDA: Recorrido = {
  id: "busqueda",
  nombre: "Buscar expedientes",
  // 2 (03/11/2026): el filtro de los cargados del papel.
  version: 2,
  pasos: [
    {
      id: "caja",
      ancla: "busqueda-caja",
      titulo: "Una sola caja para todo",
      texto:
        "Escribí el N° interno (CEM-2026-42 o 42/2026), el N° municipal, el padrón, un DNI, un CUIT o un apellido, y apretá Enter. No importan los puntos, los guiones ni los acentos.",
    },
    {
      id: "filtros",
      ancla: "busqueda-filtros",
      titulo: "Filtros",
      texto:
        "Para acotar: estado, tipo de trámite, plantilla, área, fechas y cementerio, o solo los cargados del papel. El número al lado dice cuántos filtros estás usando. Desde el Panel, cada número abre esta lista ya filtrada.",
    },
    {
      id: "resultados",
      ancla: "busqueda-resultados",
      titulo: "Los resultados",
      texto: "Cuántos encontró. Sin escribir nada, se ven los más recientes. Tocá el número de un expediente para abrir su ficha.",
    },
    {
      id: "coincide",
      ancla: "busqueda-coincide",
      titulo: "Coincide por",
      texto: "Cuando buscás un número, te dice en qué dato lo encontró: DNI, padrón, N° municipal…",
    },
    {
      id: "exportar",
      ancla: "busqueda-exportar",
      titulo: "Exportar",
      texto: "Baja los resultados en una planilla (CSV), con los mismos filtros. Queda registrado quién la bajó.",
    },
    {
      id: "nuevo",
      ancla: "busqueda-nuevo",
      titulo: "Nuevo expediente",
      texto: "Si no lo encontrás y hay que iniciarlo, desde acá vas directo al alta.",
    },
  ],
};

const TRANSCRIPCION: Recorrido = {
  id: "transcripcion",
  nombre: "Transcribir la ficha de papel",
  // 2 (03/11/2026): más detalle; "Cómo terminó" no ofrece anulado; el reloj desde el fin de la carga.
  version: 2,
  pasos: [
    {
      id: "cabecera",
      ancla: "transcripcion-cabecera",
      titulo: "Pasar el papel al sistema",
      texto:
        "Para los expedientes que empezaron antes del sistema: copiás lo que dice la ficha de papel, tal cual y con sus fechas, para que el historial quede completo. Mientras la carga está abierta no se dan pases ni se archiva.",
    },
    {
      id: "pases",
      ancla: "transcripcion-grilla",
      titulo: "Los pases de la ficha",
      texto:
        "Una fila por pase: la fecha, el paso al que llegó el papel y la fuente. Si vuelve a un paso anterior es una devolución y lleva motivo. Enter baja a la fila siguiente (en la última, agrega otra); Registrar guarda todas juntas.",
    },
    {
      id: "subtareas",
      ancla: "transcripcion-subtareas",
      titulo: "Las subtareas",
      texto:
        "Tildá lo que el papel dice que ya se hizo, con la fecha que figura ahí. Si el papel no dice cuándo, dejá la fecha vacía: se toma el día en que llegó a ese paso.",
    },
    {
      id: "final",
      ancla: "transcripcion-estado",
      titulo: "Cómo terminó",
      texto:
        "Si según el papel el trámite ya terminó, registralo acá con su fecha: concluido (solo desde el último paso) o archivado, con la caja. Si se archivó sin concluir, pide el motivo. Si sigue en trámite, no toques nada acá.",
    },
    {
      id: "foto",
      ancla: "transcripcion-foto",
      titulo: "La foto de la ficha",
      texto: "Subí una foto o un PDF de la ficha de papel. Queda como adjunto del expediente.",
    },
    {
      id: "terminar",
      ancla: "transcripcion-terminar",
      titulo: "Terminar la carga",
      texto:
        "Cuando copiaste todo, tocá Terminar carga histórica. Desde ahí sigue el circuito como cualquier otro, y la demora y los plazos empiezan a contar ese día, no desde la fecha vieja del papel. Queda con la etiqueta Del papel.",
    },
  ],
};

const PANEL: Recorrido = {
  id: "panel",
  nombre: "Panel",
  // 2 (03/11/2026): qué es demorado y sin confirmar, y qué hacer con eso.
  version: 2,
  pasos: [
    {
      id: "accesos",
      ancla: "panel-accesos",
      titulo: "Accesos rápidos",
      texto: "Los módulos que usás, a un toque.",
    },
    {
      id: "filtros",
      ancla: "panel-filtros",
      titulo: "Filtrar el panel",
      texto: "Mirá todo junto o solo un tipo de trámite o un cementerio. Aplicar actualiza los números.",
    },
    {
      id: "estados",
      ancla: "panel-estados",
      titulo: "Expedientes por estado",
      texto:
        "Cuántos hay en trámite, esperando el pago en la DIM, concluidos y archivados. Tocá un número para ver la lista en la búsqueda, ya filtrada; desde ahí se abre cada ficha.",
    },
    {
      id: "matriz",
      ancla: "panel-matriz",
      titulo: "Dónde están",
      texto: "Los que están en trámite, por área y por tipo de trámite: muestra dónde se acumula el trabajo. Cada número lleva a la lista de esos expedientes.",
    },
    {
      id: "plazos",
      ancla: "panel-vencidos",
      titulo: "Plazos de la DIM",
      texto: "Lo que venció en la DIM (en rojo) y lo que está por vencer (en ámbar). Conviene mirarlo todos los días.",
    },
    {
      id: "demorados",
      ancla: "panel-demorados",
      titulo: "Demorados y sin confirmar",
      texto:
        "Demorados: los que pasaron el límite de días hábiles de su paso, con el área que los tiene. Sin confirmar: pases que nadie recibió en 2 días hábiles; puede ser un papel que se quedó en el camino. Conviene preguntarle al área.",
    },
    {
      id: "imprimir",
      ancla: "panel-imprimir",
      titulo: "Imprimir o ver métricas",
      texto: {
        direccion: "Imprimí el panel para una reunión, o abrí las Métricas de gestión para ver tiempos y tendencias.",
        admin: "Imprimí el panel para una reunión, o abrí las Métricas de gestión para ver tiempos y tendencias.",
        todos: "Imprimí el panel tal como se ve, con los filtros que elegiste.",
      },
    },
  ],
};

const METRICAS: Recorrido = {
  id: "metricas",
  nombre: "Métricas de gestión",
  version: 1,
  pasos: [
    {
      id: "filtros",
      ancla: "metricas-filtros",
      titulo: "El período",
      texto: "Elegí desde y hasta, si querés verlo por mes o por semana y si contás los expedientes de carga histórica.",
    },
    {
      id: "resumen",
      ancla: "metricas-resumen",
      titulo: "Las cifras clave",
      texto: "Lo principal de un vistazo. Cuando hay datos de antes del sistema, te dice si mejoró (en verde) o empeoró (en rojo).",
    },
    {
      id: "pasos",
      ancla: "metricas-pasos",
      titulo: "Tiempo por paso",
      texto: "Cuántos días hábiles tarda cada paso. El cuello de botella aparece marcado: es donde más se demora.",
    },
    {
      id: "graficos",
      ancla: "metricas-flujo",
      titulo: "Gráficos y tablas",
      texto: "Cada gráfico tiene debajo su tabla con los números exactos. La tabla es la que vale.",
    },
    {
      id: "csv",
      ancla: "metricas-csv",
      titulo: "Bajar los datos",
      texto: "Cada tabla se baja en una planilla (CSV) con los filtros que elegiste.",
    },
  ],
};

const AVISOS: Recorrido = {
  id: "avisos",
  nombre: "Avisos",
  version: 1,
  pasos: [
    {
      id: "campana",
      ancla: "campana-avisos",
      titulo: "La campana",
      texto: "Desde cualquier pantalla, la campana muestra los últimos avisos y cuántos no leíste. Se actualiza sola cada minuto.",
    },
    {
      id: "filtros",
      ancla: "avisos-filtros",
      titulo: "Filtrar",
      texto: "Mirá todos o solo los que no leíste, y elegí un tipo: llegó, devuelto, plazo por vencer…",
    },
    {
      id: "lista",
      ancla: "avisos-lista",
      titulo: "Cada aviso",
      texto: "Tocalo para abrir la ficha del expediente: queda leído. Los que dicen Prioridad alta (devueltos y plazos vencidos) van en rojo.",
    },
    {
      id: "marcar",
      ancla: "avisos-marcar-todos",
      titulo: "Marcar todos como leídos",
      texto: "Para empezar de cero. Cada aviso también se puede marcar como leído o no leído de a uno.",
    },
    {
      id: "preferencias",
      ancla: "avisos-preferencias",
      titulo: "Preferencias",
      texto: { mesa: "Si no querés enterarte de cada expediente concluido o archivado, apagalo acá." },
    },
    {
      id: "recorridos",
      ancla: "avisos-recorridos",
      titulo: "Volver a ver los recorridos",
      texto: "Si querés que cada pantalla te vuelva a ofrecer su recorrido, tocá Reiniciar los recorridos.",
    },
  ],
};

const CAMBIAR_CLAVE: Recorrido = {
  id: "cambiar-clave",
  nombre: "Cambiar contraseña",
  version: 1,
  pasos: [
    {
      id: "actual",
      ancla: "clave-actual",
      titulo: "La que tenés ahora",
      texto: "Primero, la contraseña con la que entraste. Si es la primera vez, es la temporal que te dio el administrador.",
    },
    {
      id: "nueva",
      ancla: "clave-nueva",
      titulo: "La nueva, dos veces",
      texto: "Escribí la nueva y repetila abajo, para estar seguros de que no hay un error de tipeo.",
    },
    {
      id: "reglas",
      ancla: "clave-reglas",
      titulo: "Qué tiene que cumplir",
      texto: "Si a la nueva le falta algo de esta lista, te lo marca al lado del campo. Conviene una frase fácil de recordar para vos y difícil de adivinar.",
    },
    {
      id: "mostrar",
      ancla: "clave-mostrar",
      titulo: "Ver lo que escribiste",
      texto: "Marcá esta casilla para ver las contraseñas en lugar de puntitos. Fijate que nadie esté mirando la pantalla.",
    },
    {
      id: "guardar",
      ancla: "clave-guardar",
      titulo: "Listo",
      texto: "Al cambiarla se cierran tus sesiones en las otras computadoras. La contraseña es personal: no se la pases a nadie.",
    },
  ],
};

const ADMIN_INICIO: Recorrido = {
  id: "admin-inicio",
  nombre: "Administración",
  version: 2,
  pasos: [
    {
      id: "menu",
      ancla: "admin-menu",
      titulo: "Las secciones",
      texto: "Plantillas, Usuarios, Catálogos, Auditoría y Sitio público. Este menú está arriba en todas las pantallas de administración.",
    },
    {
      id: "pendiente",
      ancla: "admin-pendiente",
      titulo: "Lo pendiente",
      texto: "Borradores de plantilla sin publicar y años de feriados sin cerrar. Cada renglón lleva a donde se resuelve.",
    },
    {
      id: "tarjetas",
      ancla: "admin-secciones",
      titulo: "Qué hay en cada una",
      texto: "Una tarjeta por sección, con lo que se hace ahí.",
    },
    {
      id: "registro",
      titulo: "Todo queda registrado",
      texto: "Cada cambio de configuración guarda quién lo hizo, cuándo y por qué. Se consulta en Auditoría.",
    },
  ],
};

const ADMIN_PLANTILLAS: Recorrido = {
  id: "admin-plantillas",
  nombre: "Plantillas de trámite",
  version: 1,
  pasos: [
    {
      id: "que-son",
      ancla: "plantillas-encabezado",
      titulo: "Qué es una plantilla",
      texto: "Define un trámite: sus pasos y áreas, los documentos, las subtareas y los datos que se piden. Las altas nuevas usan la versión publicada.",
    },
    {
      id: "tabla",
      ancla: "plantillas-tabla",
      titulo: "Versiones",
      texto: "Cada trámite tiene como máximo una versión publicada y un borrador. Los expedientes en curso siguen con la versión con la que empezaron.",
    },
    {
      id: "acciones",
      ancla: "plantillas-acciones",
      titulo: "Editar y retirar",
      texto: "Editar abre el borrador (o crea uno a partir de la publicada). Retirar saca la plantilla del alta sin tocar lo que ya está en curso.",
    },
    {
      id: "nueva",
      ancla: "plantillas-nueva",
      titulo: "Nueva plantilla",
      texto: "Para un trámite nuevo: código, tipo de trámite y nombre. Nace como borrador y se publica cuando pasa la validación.",
    },
  ],
};

const ADMIN_EDITOR: Recorrido = {
  id: "admin-editor",
  nombre: "Editor de plantilla",
  version: 1,
  pasos: [
    {
      id: "cabecera",
      ancla: "editor-cabecera",
      titulo: "Versión y estado",
      texto: "Un borrador se puede cambiar. Una versión publicada o retirada se ve congelada: para cambiarla se hace un borrador nuevo.",
    },
    {
      id: "acciones",
      ancla: "editor-acciones",
      titulo: "Guardar, validar y publicar",
      texto: "Guardá seguido (también con Ctrl+S). Validar revisa que la plantilla esté completa; Publicar la pone en uso para las altas nuevas.",
    },
    {
      id: "errores",
      ancla: "editor-errores",
      titulo: "Errores para corregir",
      texto: "Lo que hay que arreglar antes de publicar. Cada error te lleva a su lugar.",
    },
    {
      id: "pestanas",
      ancla: "editor-pestanas",
      titulo: "Las partes de la plantilla",
      texto: "General, personas, pasos, documentos y lo demás, cada una en su pestaña. Con las flechas cambiás de pestaña; un número rojo marca errores.",
    },
    {
      id: "panel",
      ancla: "editor-panel",
      titulo: "Acá se edita",
      texto: "Los campos de la pestaña elegida. Los cambios no se aplican hasta que guardás.",
    },
    {
      id: "versiones",
      ancla: "editor-versiones",
      titulo: "Otras versiones",
      texto: "Las versiones anteriores de esta plantilla, para consultar cómo era.",
    },
  ],
};

const ADMIN_USUARIOS: Recorrido = {
  id: "admin-usuarios",
  nombre: "Usuarios",
  version: 1,
  pasos: [
    {
      id: "alta",
      ancla: "usuarios-alta",
      titulo: "Alta de usuario",
      texto:
        "Con el CUIL, el nombre, el área y el rol. El sistema da una contraseña temporal que se ve una sola vez: copiala y pasásela a la persona, que la cambia al entrar.",
    },
    {
      id: "tabla",
      ancla: "usuarios-tabla",
      titulo: "Quiénes entran",
      texto: "Todos los usuarios, con su área, su rol y la fecha del último ingreso.",
    },
    {
      id: "estado",
      ancla: "usuarios-estado",
      titulo: "El estado",
      texto: "Activo o inactivo, y si tiene la contraseña temporal o está bloqueado por intentos fallidos.",
    },
    {
      id: "blanquear",
      ancla: "usuarios-blanquear",
      titulo: "Blanquear la contraseña",
      texto: "Si alguien se la olvidó, generás otra temporal. Se pide el motivo y queda registrado.",
    },
    {
      id: "acciones",
      ancla: "usuarios-acciones",
      titulo: "Área, rol y desactivar",
      texto: "Cambiá el área o el rol, o desactivá a quien ya no trabaja acá: deja de entrar en el momento. Nada se borra.",
    },
  ],
};

const ADMIN_CATALOGOS: Recorrido = {
  id: "admin-catalogos",
  nombre: "Catálogos",
  version: 1,
  pasos: [
    {
      id: "pestanas",
      ancla: "catalogos-pestanas",
      titulo: "Las listas del sistema",
      texto: "Áreas, cementerios con su forma de ubicar, tipos de monumento, tipos de trámite y feriados: lo que usan el alta y los plazos.",
    },
    {
      id: "contenido",
      ancla: "catalogos-contenido",
      titulo: "Agregar y modificar",
      texto: "Cada fila se modifica con su botón. Lo que ya se usó no se borra: se desactiva, así los expedientes viejos lo siguen mostrando.",
    },
    {
      id: "feriados",
      ancla: "catalogos-pestana-feriados",
      titulo: "Feriados",
      texto: "Los plazos cuentan días hábiles: cargá los feriados de cada año, también los asuetos que se decreten.",
    },
    {
      id: "cerrar",
      ancla: "feriados-estado",
      titulo: "Cerrar el año",
      texto: "Cuando estén cargados todos los feriados del año, cerralo: los vencimientos dejan de ser provisorios.",
    },
  ],
};

const ADMIN_AUDITORIA: Recorrido = {
  id: "admin-auditoria",
  nombre: "Auditoría",
  version: 1,
  pasos: [
    {
      id: "vistas",
      ancla: "auditoria-vistas",
      titulo: "Dos registros",
      texto: "Accesos: quién abrió o imprimió cada expediente y quién pidió ver datos completos. Cambios de configuración: plantillas, usuarios y catálogos.",
    },
    {
      id: "filtros",
      ancla: "auditoria-filtros",
      titulo: "Filtrar",
      texto: "Por usuario, por tipo y por fechas. Filtrar aplica; Limpiar vuelve a mostrar todo.",
    },
    {
      id: "exportar",
      ancla: "auditoria-exportar",
      titulo: "Exportar",
      texto: "Baja lo filtrado en una planilla (CSV), por ejemplo para un pedido de informe.",
    },
    {
      id: "tabla",
      ancla: "auditoria-tabla",
      titulo: "El detalle",
      texto: "Un renglón por registro, del más nuevo al más viejo. Nadie, ni el administrador, puede borrarlos.",
    },
  ],
};

const ADMIN_SITIO_PUBLICO: Recorrido = {
  id: "admin-sitio-publico",
  nombre: "Sitio público",
  // 2 (30/10/2026): la pestaña Fotos.
  version: 2,
  pasos: [
    {
      id: "pestanas",
      ancla: "sitio-pestanas",
      titulo: "Lo que ve cualquier persona",
      texto: "Cementerios con sus horarios, recorridos con sus fechas, novedades, el contacto de Mesa de Entradas, las preguntas frecuentes y las fotos propias.",
    },
    {
      id: "contenido",
      ancla: "sitio-contenido",
      titulo: "Cargar y corregir",
      texto: "Cada fila se modifica con su botón. Lo que queda vacío no aparece en la página, y lo que no querés mostrar se desactiva.",
    },
    {
      id: "ver",
      ancla: "sitio-ver",
      titulo: "Mirá cómo queda",
      texto: "Abren en otra pestaña la página donde se ve esta parte y el inicio, igual que los ve el público. Después de guardar, recargala.",
    },
    {
      id: "registro",
      titulo: "Texto simple y registrado",
      texto: "Se muestra tal cual se escribe, sin formatos. Cada cambio guarda quién lo hizo y cuándo, como el resto de la configuración.",
    },
  ],
};

/** Los recorridos de cada pantalla, por id (el que pone cada página con `<PantallaConRecorrido id=… />`). */
export const RECORRIDOS = {
  bandeja: BANDEJA,
  ficha: FICHA,
  "expediente-nuevo": NUEVO,
  "expediente-formulario": FORMULARIO,
  busqueda: BUSQUEDA,
  transcripcion: TRANSCRIPCION,
  panel: PANEL,
  metricas: METRICAS,
  avisos: AVISOS,
  "cambiar-clave": CAMBIAR_CLAVE,
  "admin-inicio": ADMIN_INICIO,
  "admin-plantillas": ADMIN_PLANTILLAS,
  "admin-editor": ADMIN_EDITOR,
  "admin-usuarios": ADMIN_USUARIOS,
  "admin-catalogos": ADMIN_CATALOGOS,
  "admin-auditoria": ADMIN_AUDITORIA,
  "admin-sitio-publico": ADMIN_SITIO_PUBLICO,
} as const satisfies Record<string, Recorrido>;

export type IdPantallaRecorrido = keyof typeof RECORRIDOS;

/** El recorrido de una pantalla; sin pantalla (o una sin recorrido propio), la bienvenida. */
export function recorridoDePantalla(id: string | null): Recorrido {
  return id !== null && Object.hasOwn(RECORRIDOS, id) ? RECORRIDOS[id as IdPantallaRecorrido] : BIENVENIDA;
}
