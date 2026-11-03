import { BIENVENIDA, RECORRIDOS, recorridoDePantalla, type IdPantallaRecorrido } from "@/lib/presentacion/recorridos/contenido";
import { textoPara, type Perfil, type Recorrido } from "@/lib/presentacion/recorridos/motor";

/**
 * Lo que Migue sabe de cómo se usa el sistema: las dudas de cada pantalla, con
 * su respuesta ya escrita (docs/api-dominio.md, 26.7). Como la ayuda del panel
 * de El Sanmiguelino (ayuda-panel.ts), sirve dos veces y por eso vive en un
 * solo lugar:
 *
 * 1. **Las preguntas de cada pantalla** del chat del sistema: se contestan en
 *    el navegador con este texto, sin modelo. No cuestan nada y no pueden
 *    inventar.
 * 2. **La guía que lee el modelo** cuando alguien escribe una pregunta libre, y
 *    la herramienta `como_se_hace`. Es todo lo que sabe del sistema.
 *
 * **No hay un texto propio**: cada respuesta ES el texto de un paso del
 * recorrido guiado de esa pantalla (src/lib/presentacion/recorridos/contenido.ts),
 * con el de cada perfil (`textoPara`). Así lo que dice Migue y lo que muestra
 * el "?" no se pueden contradecir: si cambia un botón, se cambia el recorrido
 * y Migue lo dice igual. Acá solo se escribe cómo lo preguntaría la gente.
 *
 * Sin `server-only`: el chat necesita las preguntas. No hay nada secreto.
 */

/** [cómo se pregunta, id del paso del recorrido de esa pantalla]. */
type Pregunta = readonly [pregunta: string, paso: string];

const PREGUNTAS: Partial<Record<IdPantallaRecorrido | "bienvenida", readonly Pregunta[]>> = {
  bienvenida: [
    ["¿Cómo se mueve un expediente?", "circuito"],
    ["¿Qué me toca hacer a mí?", "tu-trabajo"],
    ["¿Cómo se cuentan los días?", "dias"],
    ["¿Cómo busco un expediente?", "buscador"],
    ["¿Qué es «Por confirmar»?", "por-confirmar"],
  ],
  bandeja: [
    ["¿Cómo confirmo que recibí un expediente?", "confirmar"],
    ["¿Qué es «Dar pase rápido»?", "pase-rapido"],
    ["¿Por qué un expediente sale demorado?", "dias"],
    ["¿Qué hay en cada pestaña?", "pestanas"],
    ["¿Qué quiere decir una fila en rojo?", "devuelto"],
  ],
  ficha: [
    ["¿Qué falta para dar el pase?", "faltan"],
    ["¿Cómo doy el pase o lo devuelvo?", "acciones"],
    ["¿Dónde veo en qué paso está?", "paso-area"],
    ["¿Para qué es el código de consulta?", "codigo"],
    ["¿Cómo marco la documentación?", "documentacion"],
    ["¿Qué es «Verificar integridad»?", "historial"],
  ],
  "expediente-nuevo": [
    ["¿Cómo doy de alta un expediente?", "pasos"],
    ["¿Qué trámite elijo?", "tramite"],
    ["¿Qué pasa después de elegir el cementerio?", "continuar"],
  ],
  "expediente-formulario": [
    ["¿Cómo cargo las personas?", "personas"],
    ["¿Qué documentación marco?", "documentos"],
    ["¿Cómo guardo e imprimo la carátula?", "guardar"],
    ["¿Qué va en la ubicación?", "ubicacion"],
  ],
  busqueda: [
    ["¿Qué puedo escribir en la búsqueda?", "caja"],
    ["¿Cómo filtro los resultados?", "filtros"],
    ["¿Qué quiere decir «Coincide por»?", "coincide"],
    ["¿Cómo exporto la lista?", "exportar"],
  ],
  transcripcion: [
    ["¿Cómo paso una ficha de papel al sistema?", "cabecera"],
    ["¿Cómo cargo los pases de la ficha?", "pases"],
    ["¿Y si el papel no dice la fecha de una subtarea?", "subtareas"],
    ["¿Cómo termino la carga histórica?", "terminar"],
  ],
  panel: [
    ["¿Qué muestran los números por estado?", "estados"],
    ["¿Dónde veo los vencidos de la DIM?", "plazos"],
    ["¿Qué son los demorados y sin confirmar?", "demorados"],
    ["¿Cómo filtro el panel?", "filtros"],
  ],
  metricas: [
    ["¿Cómo elijo el período?", "filtros"],
    ["¿Qué son las cifras clave?", "resumen"],
    ["¿Cómo bajo los datos?", "csv"],
  ],
  avisos: [
    ["¿Qué avisos me llegan?", "campana"],
    ["¿Cómo marco todo como leído?", "marcar"],
    ["¿Cómo vuelvo a ver los recorridos?", "recorridos"],
  ],
};

/** La pregunta escrita a partir del título del paso, para las pantallas sin preguntas propias. */
function preguntaDelTitulo(titulo: string): string {
  return `¿Qué es «${titulo.replace(/[.:]$/, "")}»?`;
}

export interface PreguntaDePantalla {
  pregunta: string;
  respuesta: string;
}

export interface AyudaDePantalla {
  /** El id de la pantalla (el de su recorrido guiado), o "bienvenida". */
  id: string;
  nombre: string;
  preguntas: PreguntaDePantalla[];
}

/** Máximo de preguntas que se ofrecen por pantalla. */
const MAXIMO_PREGUNTAS = 5;

/**
 * Las preguntas de la pantalla a la vista, para ese perfil. Una pregunta cuyo
 * paso no le corresponde al perfil (Mesa de Entradas tiene pasos que los demás
 * no ven) no se ofrece. Una pantalla sin recorrido propio ofrece las de la
 * bienvenida.
 */
export function ayudaDePantalla(id: string | null, perfil: Perfil): AyudaDePantalla {
  const recorrido = recorridoDePantalla(id);
  const propias = PREGUNTAS[recorrido.id as keyof typeof PREGUNTAS];
  const preguntas: PreguntaDePantalla[] = [];
  const lista: readonly Pregunta[] = propias ?? recorrido.pasos.map((p) => [preguntaDelTitulo(textoPara(p.titulo, perfil) ?? p.id), p.id] as const);
  for (const [pregunta, pasoId] of lista) {
    const paso = recorrido.pasos.find((p) => p.id === pasoId);
    const respuesta = paso ? textoPara(paso.texto, perfil) : null;
    if (respuesta) preguntas.push({ pregunta, respuesta });
    if (preguntas.length >= MAXIMO_PREGUNTAS) break;
  }
  return { id: recorrido.id, nombre: recorrido.id === BIENVENIDA.id ? "Inicio" : recorrido.nombre, preguntas };
}

/** Si es el id de una pantalla conocida (para validar lo que llega del navegador). */
export function esPantalla(valor: unknown): valor is IdPantallaRecorrido | "bienvenida" {
  return typeof valor === "string" && (valor === BIENVENIDA.id || Object.hasOwn(RECORRIDOS, valor));
}

export interface EntradaDeGuia {
  pantalla: string;
  titulo: string;
  texto: string;
}

/** Todos los pasos de todos los recorridos, con el texto del perfil (los que no le tocan, afuera). */
export function entradasDeLaGuia(perfil: Perfil): EntradaDeGuia[] {
  const recorridos: Recorrido[] = [BIENVENIDA, ...Object.values(RECORRIDOS)];
  const entradas: EntradaDeGuia[] = [];
  for (const r of recorridos) {
    for (const p of r.pasos) {
      const texto = textoPara(p.texto, perfil);
      const titulo = textoPara(p.titulo, perfil);
      if (texto && titulo) entradas.push({ pantalla: r.id === BIENVENIDA.id ? "Inicio" : r.nombre, titulo, texto });
    }
  }
  return entradas;
}

/** La guía en texto, para el prompt del modelo: una sección por pantalla. */
export function guiaDelSistema(perfil: Perfil): string {
  const porPantalla = new Map<string, EntradaDeGuia[]>();
  for (const e of entradasDeLaGuia(perfil)) porPantalla.set(e.pantalla, [...(porPantalla.get(e.pantalla) ?? []), e]);
  return [...porPantalla.entries()].map(([pantalla, es]) => `## ${pantalla}\n${es.map((e) => `- ${e.titulo}: ${e.texto}`).join("\n")}`).join("\n\n");
}

/** Minúsculas y sin tildes: todo lo que decide un camino mira esta versión. */
export function simplificar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const VACIAS = new Set(
  "el la los las un una unos unas de del al a en y o que se su sus por para con sobre es son como mas hay este esta estos estas donde cuando quien cual cuales me te le nos lo mi tu hago hacer puedo cosa".split(" "),
);

/** Las palabras que cuentan para buscar (sin tildes, de 3 letras o más, sin las vacías). */
export function palabras(texto: string): string[] {
  return simplificar(texto)
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 2 && !VACIAS.has(p));
}

/** Dos palabras "son la misma" si una empieza con la otra y tienen 4 letras o más (pase / pases, confirmo / confirmar). */
export function parecidas(a: string, b: string): boolean {
  if (a === b) return true;
  const raiz = (p: string) => p.slice(0, Math.max(4, p.length - 2));
  return a.length >= 4 && b.length >= 4 && (raiz(a) === raiz(b) || a.startsWith(raiz(b)) || b.startsWith(raiz(a)));
}

/**
 * La herramienta `como_se_hace` y el respaldo sin modelo: las entradas de la
 * guía que más palabras comparten con el tema (el título pesa el doble).
 */
export function buscarEnLaGuia(tema: string, perfil: Perfil, maximo = 3): EntradaDeGuia[] {
  const buscadas = palabras(tema);
  if (buscadas.length === 0) return [];
  return entradasDeLaGuia(perfil)
    .map((e) => {
      const enTitulo = palabras(e.titulo);
      const enTexto = palabras(`${e.pantalla} ${e.texto}`);
      const puntaje = buscadas.reduce(
        (t, b) => t + (enTitulo.some((p) => parecidas(p, b)) ? 2 : enTexto.some((p) => parecidas(p, b)) ? 1 : 0),
        0,
      );
      return { e, puntaje };
    })
    .filter((x) => x.puntaje >= Math.min(2, buscadas.length))
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, maximo)
    .map((x) => x.e);
}
