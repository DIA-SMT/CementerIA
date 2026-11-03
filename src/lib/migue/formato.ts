/**
 * El formato de las respuestas de Migue: el poco markdown que escriben los
 * modelos aunque se les pida texto simple (**negrita**, listas con guiones,
 * algún título). Se lee a una estructura y el chat la dibuja con elementos de
 * React: nunca se inserta HTML, así que lo que escriba el modelo no puede
 * meter etiquetas ni scripts. Lo que no se reconoce queda como texto, sin los
 * asteriscos sueltos. Pura: se prueba con lo que escribe el modelo de verdad.
 */

export type Trozo = { tipo: "texto" | "negrita" | "cursiva"; texto: string };

export type Bloque =
  | { tipo: "parrafo"; lineas: Trozo[][] }
  | { tipo: "lista"; ordenada: boolean; items: Trozo[][] }
  | { tipo: "titulo"; trozos: Trozo[] };

const VINETA = /^\s*[-*•·]\s+(.*)$/;
const NUMERO = /^\s*\d{1,2}[.)]\s+(.*)$/;
const TITULO = /^\s*#{1,6}\s+(.*)$/;
const CITA = /^\s*>\s?/;
/** Una línea que es solo una raya (---, ***): separador, no se muestra. */
const RAYA = /^\s*([-*_])(\s*\1){2,}\s*$/;

/**
 * Negrita (**x**, __x__), cursiva (*x*, _x_) y código (`x`, como texto). Los
 * guiones bajos solo cuentan como cursiva entre espacios o signos, así no se
 * rompe un identificador como carga_historica.
 */
const MARCAS = /\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*|__(?=\S)([^_\n]+?)(?<=\S)__|\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*|(?<![\p{L}\p{N}])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}])|`([^`\n]+)`/gu;

/** Los trozos de una línea. */
export function trozosDe(linea: string): Trozo[] {
  const trozos: Trozo[] = [];
  const agregar = (tipo: Trozo["tipo"], texto: string) => {
    // Lo que quedó suelto de una marca sin cerrar («**Plantillas:» sin el par) no se muestra.
    const limpio = tipo === "texto" ? texto.replace(/\*{2,}|_{2,}/g, "") : texto;
    if (limpio === "") return;
    const ultimo = trozos.at(-1);
    if (ultimo && ultimo.tipo === tipo) ultimo.texto += limpio;
    else trozos.push({ tipo, texto: limpio });
  };
  let desde = 0;
  for (const m of linea.matchAll(MARCAS)) {
    agregar("texto", linea.slice(desde, m.index));
    if (m[1] !== undefined || m[2] !== undefined) agregar("negrita", m[1] ?? m[2]);
    else if (m[3] !== undefined || m[4] !== undefined) agregar("cursiva", m[3] ?? m[4]);
    else agregar("texto", m[5]);
    desde = m.index + m[0].length;
  }
  agregar("texto", linea.slice(desde));
  return trozos;
}

/** Los bloques de una respuesta: párrafos (con sus saltos de línea), listas y títulos. */
export function bloquesDe(texto: string): Bloque[] {
  const bloques: Bloque[] = [];
  // Lo cambia también `cerrar()`; TypeScript no lo sigue en la clausura, de ahí los `as` de abajo.
  let actual: Bloque | null = null;
  let separada = false;
  const cerrar = () => {
    if (actual) bloques.push(actual);
    actual = null;
    separada = false;
  };

  for (const cruda of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const linea = cruda.replace(CITA, "");
    if (linea.trim() === "" || RAYA.test(linea)) {
      // Una lista con renglones en blanco entre los ítems sigue siendo una
      // lista (así las escriben los modelos): se cierra si lo que sigue no es un ítem.
      const abierta = actual as Bloque | null;
      if (abierta?.tipo === "lista" && linea.trim() === "") separada = true;
      else cerrar();
      continue;
    }
    if (separada) {
      separada = false;
      const abierta = actual as Bloque | null;
      const sigue = abierta?.tipo === "lista" && (abierta.ordenada ? NUMERO : VINETA).test(linea);
      if (!sigue) cerrar();
    }
    const titulo = TITULO.exec(linea);
    if (titulo) {
      cerrar();
      bloques.push({ tipo: "titulo", trozos: trozosDe(titulo[1].trim()) });
      continue;
    }
    const vineta: RegExpExecArray | null = VINETA.exec(linea);
    const numero: RegExpExecArray | null = vineta ? null : NUMERO.exec(linea);
    const item: RegExpExecArray | null = vineta ?? numero;
    if (item) {
      const ordenada: boolean = numero !== null;
      const lista = actual as Bloque | null;
      if (lista?.tipo === "lista" && lista.ordenada === ordenada) lista.items.push(trozosDe(item[1].trim()));
      else {
        cerrar();
        actual = { tipo: "lista", ordenada, items: [trozosDe(item[1].trim())] };
      }
      continue;
    }
    const previo = actual as Bloque | null;
    // Una línea con sangría debajo de un ítem es la continuación de ese ítem.
    if (previo?.tipo === "lista" && /^\s+\S/.test(linea)) {
      const ultimo = previo.items[previo.items.length - 1];
      previo.items[previo.items.length - 1] = [...ultimo, { tipo: "texto", texto: " " }, ...trozosDe(linea.trim())];
      continue;
    }
    if (previo?.tipo === "parrafo") previo.lineas.push(trozosDe(linea.trim()));
    else {
      cerrar();
      actual = { tipo: "parrafo", lineas: [trozosDe(linea.trim())] };
    }
  }
  cerrar();
  return bloques;
}
