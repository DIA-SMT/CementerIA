// Feriados y días no laborables 2026 y 2027 (docs/propuesta-mvp.md, 2.9 y 3.6).
//
// Los días hábiles (alertas de la bandeja y plazo de 30 días de la DIM) saltean
// sábados, domingos y TODAS las filas de esta tabla, de cualquier ámbito. Por
// eso se cargan también los días no laborables en que la Municipalidad no
// atiende, y los que caen en fin de semana (no cambian la cuenta, pero el admin
// revisa la lista completa antes de "Cerrar año").
//
// Los dos años quedan SIN cerrar en feriados_anios: falta lo que tiene que
// confirmar la Dirección (taller, Parte 5: asuetos, ferias, día del trabajador
// municipal) y, para 2027, los días con fines turísticos y el traslado del 20 de
// noviembre, que la Nación todavía no fijó. Mientras un año está abierto, el
// panel marca sus vencimientos como provisorios.
//
// Normativa (verificada el 19/10/2026 en el Boletín Oficial y la prensa):
// - Ley 27.399: feriados inamovibles y trasladables. Art. 6: un trasladable que
//   cae martes o miércoles pasa al lunes anterior; jueves o viernes, al lunes
//   siguiente.
// - Decreto 614/2025: un trasladable que cae sábado o domingo PUEDE pasar al
//   viernes anterior o al lunes siguiente, si lo dispone la Jefatura de Gabinete
//   (autoridad de aplicación). No es automático.
// - Resolución JGM 164/2025 (BO 26/12/2025): días no laborables con fines
//   turísticos de 2026 (Ley 27.399, art. 7).
// - Decreto 1103/2026 (DNU, BO 28/09/2026): feriado nacional del lunes
//   09/11/2026 por la visita del Papa León XIV. El 10 y el 11 son solo para
//   CABA, Córdoba y Buenos Aires: no alcanzan a Tucumán. El decreto no lo
//   condiciona a que la visita se haga; si lo derogan, el admin lo quita.
//
// "a confirmar" en la descripción: el admin lo verifica antes de cerrar el año.

export type AmbitoFeriado = "nacional" | "provincial" | "municipal" | "asueto" | "feria";

export interface FeriadoSemilla {
  /** YYYY-MM-DD */
  fecha: string;
  descripcion: string;
  ambito: AmbitoFeriado;
  norma: string | null;
}

export const ANIOS_FERIADOS = [2026, 2027] as const;

const LEY = "Ley 27.399";
const TRASLADO = "Ley 27.399, art. 6";
const TURISTICO_2026 = "Resolución JGM 164/2025 (Ley 27.399, art. 7)";

// El 24/09 fue feriado provincial en 2026 y la Municipalidad no atendió al
// público; las fuentes no coinciden en el número de la ley provincial. San
// Miguel Arcángel (29/09) es el patrono de la ciudad, pero no encontramos norma
// de asueto: es un candidato. Los dos van a la pregunta F-1 del taller.
const BATALLA = "Batalla de Tucumán (feriado provincial; a confirmar la norma)";
const PATRONO = "San Miguel Arcángel, patrono de la ciudad (asueto municipal; a confirmar)";

export const FERIADOS: readonly FeriadoSemilla[] = [
  // --- 2026 ---------------------------------------------------------------
  { fecha: "2026-01-01", descripcion: "Año Nuevo", ambito: "nacional", norma: LEY },
  { fecha: "2026-02-16", descripcion: "Carnaval", ambito: "nacional", norma: LEY },
  { fecha: "2026-02-17", descripcion: "Carnaval", ambito: "nacional", norma: LEY },
  {
    fecha: "2026-03-23",
    descripcion: "Día no laborable con fines turísticos (a confirmar adhesión de la Municipalidad)",
    ambito: "nacional",
    norma: TURISTICO_2026,
  },
  { fecha: "2026-03-24", descripcion: "Día Nacional de la Memoria por la Verdad y la Justicia", ambito: "nacional", norma: LEY },
  {
    fecha: "2026-04-02",
    descripcion: "Día del Veterano y de los Caídos en la Guerra de Malvinas (coincide con Jueves Santo)",
    ambito: "nacional",
    norma: LEY,
  },
  { fecha: "2026-04-03", descripcion: "Viernes Santo", ambito: "nacional", norma: LEY },
  { fecha: "2026-05-01", descripcion: "Día del Trabajador", ambito: "nacional", norma: LEY },
  { fecha: "2026-05-25", descripcion: "Día de la Revolución de Mayo", ambito: "nacional", norma: LEY },
  {
    fecha: "2026-06-15",
    descripcion: "Paso a la Inmortalidad del General Martín Miguel de Güemes (trasladado del miércoles 17/06)",
    ambito: "nacional",
    norma: TRASLADO,
  },
  { fecha: "2026-06-20", descripcion: "Paso a la Inmortalidad del General Manuel Belgrano (sábado)", ambito: "nacional", norma: LEY },
  { fecha: "2026-07-09", descripcion: "Día de la Independencia", ambito: "nacional", norma: LEY },
  {
    fecha: "2026-07-10",
    descripcion: "Día no laborable con fines turísticos (a confirmar adhesión de la Municipalidad)",
    ambito: "nacional",
    norma: TURISTICO_2026,
  },
  { fecha: "2026-08-17", descripcion: "Paso a la Inmortalidad del General José de San Martín", ambito: "nacional", norma: LEY },
  { fecha: "2026-09-24", descripcion: BATALLA, ambito: "provincial", norma: null },
  { fecha: "2026-09-29", descripcion: PATRONO, ambito: "municipal", norma: null },
  { fecha: "2026-10-12", descripcion: "Día del Respeto a la Diversidad Cultural", ambito: "nacional", norma: LEY },
  {
    fecha: "2026-11-09",
    descripcion: "Feriado nacional por la visita del Papa León XIV",
    ambito: "nacional",
    norma: "Decreto 1103/2026 (DNU), art. 2",
  },
  {
    fecha: "2026-11-23",
    descripcion: "Día de la Soberanía Nacional (trasladado del viernes 20/11)",
    ambito: "nacional",
    norma: TRASLADO,
  },
  {
    fecha: "2026-12-07",
    descripcion: "Día no laborable con fines turísticos (a confirmar adhesión de la Municipalidad)",
    ambito: "nacional",
    norma: TURISTICO_2026,
  },
  { fecha: "2026-12-08", descripcion: "Día de la Inmaculada Concepción de María", ambito: "nacional", norma: LEY },
  { fecha: "2026-12-25", descripcion: "Navidad", ambito: "nacional", norma: LEY },

  // --- 2027 ---------------------------------------------------------------
  // Pascua: 28/03/2027. Faltan los días con fines turísticos, que todavía no
  // se publicaron.
  { fecha: "2027-01-01", descripcion: "Año Nuevo", ambito: "nacional", norma: LEY },
  { fecha: "2027-02-08", descripcion: "Carnaval", ambito: "nacional", norma: LEY },
  { fecha: "2027-02-09", descripcion: "Carnaval", ambito: "nacional", norma: LEY },
  { fecha: "2027-03-24", descripcion: "Día Nacional de la Memoria por la Verdad y la Justicia", ambito: "nacional", norma: LEY },
  {
    fecha: "2027-03-25",
    descripcion: "Jueves Santo (día no laborable; a confirmar que la Municipalidad no atiende)",
    ambito: "nacional",
    norma: LEY,
  },
  { fecha: "2027-03-26", descripcion: "Viernes Santo", ambito: "nacional", norma: LEY },
  { fecha: "2027-04-02", descripcion: "Día del Veterano y de los Caídos en la Guerra de Malvinas", ambito: "nacional", norma: LEY },
  { fecha: "2027-05-01", descripcion: "Día del Trabajador (sábado)", ambito: "nacional", norma: LEY },
  { fecha: "2027-05-25", descripcion: "Día de la Revolución de Mayo", ambito: "nacional", norma: LEY },
  { fecha: "2027-06-20", descripcion: "Paso a la Inmortalidad del General Manuel Belgrano (domingo)", ambito: "nacional", norma: LEY },
  {
    fecha: "2027-06-21",
    descripcion: "Paso a la Inmortalidad del General Martín Miguel de Güemes (trasladado del jueves 17/06)",
    ambito: "nacional",
    norma: TRASLADO,
  },
  { fecha: "2027-07-09", descripcion: "Día de la Independencia", ambito: "nacional", norma: LEY },
  {
    fecha: "2027-08-16",
    descripcion: "Paso a la Inmortalidad del General José de San Martín (trasladado del martes 17/08)",
    ambito: "nacional",
    norma: TRASLADO,
  },
  { fecha: "2027-09-24", descripcion: BATALLA, ambito: "provincial", norma: null },
  { fecha: "2027-09-29", descripcion: PATRONO, ambito: "municipal", norma: null },
  {
    fecha: "2027-10-11",
    descripcion: "Día del Respeto a la Diversidad Cultural (trasladado del martes 12/10)",
    ambito: "nacional",
    norma: TRASLADO,
  },
  {
    fecha: "2027-11-20",
    descripcion:
      "Día de la Soberanía Nacional (cae sábado; a confirmar si la Jefatura de Gabinete lo pasa al viernes 19 o al lunes 22)",
    ambito: "nacional",
    norma: "Ley 27.399; Decreto 614/2025",
  },
  { fecha: "2027-12-08", descripcion: "Día de la Inmaculada Concepción de María", ambito: "nacional", norma: LEY },
  { fecha: "2027-12-25", descripcion: "Navidad (sábado)", ambito: "nacional", norma: LEY },
];
