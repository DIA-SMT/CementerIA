// Sitio público (28/10/2026; docs/api-dominio.md, sección 25): lo que la
// semilla carga del contenido de la página pública.
//
// - PRODUCCIÓN (siempre, también con --sin-ficticios): solo las preguntas
//   frecuentes que son verdad por cómo funciona el sistema y por los
//   procedimientos de docs/fuentes. Todo lo demás (domicilios, horarios,
//   recorridos, novedades, contacto) arranca VACÍO: lo carga la Dirección
//   desde /admin/sitio-publico, y la página sabe qué mostrar sin eso.
// - DESARROLLO (con ficticios): contenido de ejemplo para ver todas las
//   secciones. FICTICIO y marcado como tal: los domicilios y los teléfonos
//   dicen "(dato de prueba)" y los enlaces de mapa no llevan a ningún lado
//   real (una búsqueda de Google Maps del nombre).
//
// IDEMPOTENTE, como el resto de la semilla: cada cosa se busca por su clave
// natural (la pregunta, el cementerio, el nombre del recorrido, el título de
// la novedad) y lo que ya existe no se toca, aunque la Dirección lo haya
// cambiado. Las fechas de los recorridos se cargan solo al crear el recorrido
// (relativas al día en que corre la semilla), así una segunda corrida no
// agrega fechas.

import { conActorEn } from "../../src/lib/db/actor";
import type { Cliente, Transaccion } from "../../src/lib/db/crear-cliente";
import { fechaParaDb, hoyEnTucuman, interpretarDatetimeLocal, sumarDias } from "../../src/lib/fechas";

/** Id del usuario técnico SISTEMA. */
const SISTEMA = 1;

export interface PreguntaSemilla {
  pregunta: string;
  respuesta: string;
  orden: number;
}

/**
 * Las preguntas frecuentes de producción. Cada respuesta sale del diseño del
 * sistema o de docs/fuentes:
 * - el código de consulta lo regenera Mesa de Entradas y el anterior deja de
 *   servir (README, "Página pública y consulta");
 * - la consulta es orientativa: el expediente oficial es el de papel (ídem);
 * - las tasas se pagan con la boleta de Liquidación en Rapipago, Pago Fácil o
 *   Banco Macro, y se trae la copia del pago (docs/fuentes/README.md,
 *   "Procedimiento de inhumación", (A) punto 2).
 */
export const PREGUNTAS_FRECUENTES: readonly PreguntaSemilla[] = [
  {
    pregunta: "Perdí el código de consulta, ¿qué hago?",
    respuesta: "Pedí uno nuevo en Mesa de Entradas de la Dirección de Cementerios. Desde ese momento, el código anterior deja de funcionar.",
    orden: 10,
  },
  {
    pregunta: "¿La consulta en línea reemplaza al expediente?",
    respuesta: "No. La consulta en línea es información orientativa sobre en qué anda tu trámite: el expediente oficial es el de papel.",
    orden: 20,
  },
  {
    pregunta: "¿Dónde pago las tasas?",
    respuesta:
      "Con la boleta que te entrega Liquidación, en Rapipago, Pago Fácil o Banco Macro. Después traés una copia del pago a Mesa de Entradas para sumarla al expediente.",
    orden: 30,
  },
];

/**
 * Las preguntas de producción, dentro de la transacción de la semilla (como
 * SISTEMA). Una pregunta que ya existe (el mismo texto, sin importar
 * mayúsculas) no se toca. Devuelve cuántas creó.
 */
export async function sembrarPreguntasFrecuentes(tx: Transaccion): Promise<number> {
  let creadas = 0;
  for (const p of PREGUNTAS_FRECUENTES) {
    const existe = await tx.sitioPregunta.findFirst({ where: { pregunta: { equals: p.pregunta, mode: "insensitive" } }, select: { id: true } });
    if (existe) continue;
    await tx.sitioPregunta.create({ data: { pregunta: p.pregunta, respuesta: p.respuesta, orden: p.orden, activa: true } });
    creadas += 1;
  }
  return creadas;
}

// ---------------------------------------------------------------------------
// Desarrollo: contenido de ejemplo (ficticio)
// ---------------------------------------------------------------------------

const PRUEBA = "(dato de prueba)";

/** Un enlace de mapa que pasa la validación y no apunta a un lugar real: la búsqueda del nombre. */
function mapaDePrueba(nombre: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nombre} San Miguel de Tucumán`)}`;
}

/** Los datos públicos de ejemplo de cada cementerio de la semilla (por código). */
export const CEMENTERIOS_SITIO_DESARROLLO = [
  {
    codigo: "OESTE",
    nombre: "Cementerio del Oeste",
    domicilio: `Av. Ficticia 1000, San Miguel de Tucumán ${PRUEBA}`,
    descripcion: "El cementerio más antiguo de la ciudad, con avenidas de mausoleos y capillas de valor histórico. Texto de ejemplo de la semilla de desarrollo.",
    queTiene: "Mausoleos, capillas, sotanitos, sepulturas y nichos",
    horarioSemana: "De 7 a 18 (ejemplo)",
    horarioFinDeSemana: "De 8 a 17 (ejemplo)",
    horarioEspecial: "2 de noviembre: de 7 a 19 (ejemplo)",
    foto: "avenida-azul",
  },
  {
    codigo: "NORTE",
    nombre: "Cementerio del Norte",
    domicilio: `Calle de Prueba 200, San Miguel de Tucumán ${PRUEBA}`,
    descripcion: "Texto de ejemplo de la semilla de desarrollo: acá va lo que la Dirección quiera contar del cementerio.",
    queTiene: "Panteones, nichos y sepulturas",
    horarioSemana: "De 7 a 18 (ejemplo)",
    horarioFinDeSemana: "De 8 a 13 (ejemplo)",
    horarioEspecial: null,
    foto: "ingreso-paseo-sereno",
  },
  {
    codigo: "JARDIN_NORTE",
    nombre: "Cementerio Jardín Norte",
    domicilio: `Ruta Imaginaria km 3, Tucumán ${PRUEBA}`,
    descripcion: null,
    queTiene: "Sepulturas en parque",
    horarioSemana: "De 8 a 18 (ejemplo)",
    horarioFinDeSemana: null,
    horarioEspecial: null,
    foto: "parque-memorial",
  },
] as const;

export const RECORRIDOS_DESARROLLO = [
  {
    nombre: "Recorrido histórico guiado (ejemplo)",
    descripcion:
      "Visita guiada de ejemplo por los mausoleos y monumentos más antiguos. Ficha cargada por la semilla de desarrollo: la de verdad la carga la Dirección.",
    cementerio: "OESTE",
    diasHora: "Sábados a las 10 (ejemplo)",
    duracion: "1 hora y media",
    puntoEncuentro: `Portón principal ${PRUEBA}`,
    cupo: "25 personas",
    inscripcion: "Escribinos al correo de Mesa de Entradas con tu nombre y la fecha elegida (ejemplo).",
    inscripcionUrl: null,
    foto: "avenida-azul",
    orden: 10,
    /** Días desde la semilla y hora (Tucumán) de sus fechas. */
    fechas: [
      { dias: 3, hora: "10:00", nota: null },
      { dias: 10, hora: "10:00", nota: "Edición especial (ejemplo)" },
    ],
  },
  {
    nombre: "Recorrido para escuelas (ejemplo)",
    descripcion: "Recorrido de ejemplo pensado para grupos escolares, con reserva previa.",
    cementerio: "NORTE",
    diasHora: "Martes y jueves a las 9 (ejemplo)",
    duracion: "1 hora",
    puntoEncuentro: null,
    cupo: "Un curso por visita",
    inscripcion: null,
    inscripcionUrl: null,
    foto: "ingreso-paseo-sereno",
    orden: 20,
    fechas: [{ dias: 6, hora: "09:00", nota: "Con reserva previa" }],
  },
] as const;

export const NOVEDAD_DESARROLLO = {
  titulo: "Horario especial por el Día de los Fieles Difuntos (ejemplo)",
  texto: "Novedad de ejemplo de la semilla de desarrollo: acá la Dirección publica horarios especiales, cortes por mantenimiento o fechas nuevas de recorridos.",
} as const;

export const CONTACTO_DESARROLLO = {
  domicilio: `Calle Ficticia 100, San Miguel de Tucumán ${PRUEBA}`,
  horario: "Lunes a viernes de 7 a 13 (ejemplo)",
  telefono: `0381 400-0000 ${PRUEBA}`,
  correo: "mesa.entradas@ejemplo.invalid",
  mapaUrl: mapaDePrueba("Dirección de Cementerios"),
} as const;

export interface ResumenSitioDesarrollo {
  cementerios: number;
  recorridos: number;
  fechas: number;
  novedades: number;
  contacto: number;
}

/**
 * El contenido de ejemplo de desarrollo, en una transacción como SISTEMA. Lo
 * llama prisma/seed.ts con ficticios (nunca en producción). `ahora` fija el
 * día de la semilla (las pruebas lo pasan).
 */
export async function sembrarSitioDesarrollo(cliente: Cliente, ahora: Date = new Date()): Promise<ResumenSitioDesarrollo> {
  const hoy = hoyEnTucuman(ahora);
  return conActorEn(cliente, SISTEMA, "Semilla de desarrollo: sitio público de ejemplo", async (tx) => {
    const r: ResumenSitioDesarrollo = { cementerios: 0, recorridos: 0, fechas: 0, novedades: 0, contacto: 0 };
    const cementerios = new Map((await tx.cementerio.findMany({ select: { id: true, codigo: true } })).map((c) => [c.codigo, c.id]));

    for (const c of CEMENTERIOS_SITIO_DESARROLLO) {
      const id = cementerios.get(c.codigo);
      if (id === undefined || (await tx.sitioCementerio.findUnique({ where: { cementerioId: id } }))) continue;
      await tx.sitioCementerio.create({
        data: {
          cementerioId: id,
          visible: true,
          domicilio: c.domicilio,
          mapaUrl: mapaDePrueba(c.nombre),
          descripcion: c.descripcion,
          queTiene: c.queTiene,
          horarioSemana: c.horarioSemana,
          horarioFinDeSemana: c.horarioFinDeSemana,
          horarioEspecial: c.horarioEspecial,
          foto: c.foto,
        },
      });
      r.cementerios += 1;
    }

    for (const rec of RECORRIDOS_DESARROLLO) {
      if (await tx.sitioRecorrido.findFirst({ where: { nombre: rec.nombre } })) continue;
      const { cementerio, fechas, ...datos } = rec;
      const creado = await tx.sitioRecorrido.create({ data: { ...datos, cementerioId: cementerios.get(cementerio) ?? null, activo: true } });
      r.recorridos += 1;
      for (const f of fechas) {
        await tx.sitioRecorridoFecha.create({
          data: { recorridoId: creado.id, fecha: interpretarDatetimeLocal(`${sumarDias(hoy, f.dias)}T${f.hora}`), nota: f.nota },
        });
        r.fechas += 1;
      }
    }

    if (!(await tx.sitioNovedad.findFirst({ where: { titulo: NOVEDAD_DESARROLLO.titulo } }))) {
      await tx.sitioNovedad.create({
        data: { ...NOVEDAD_DESARROLLO, desde: fechaParaDb(sumarDias(hoy, -1)), hasta: fechaParaDb(sumarDias(hoy, 14)), activa: true },
      });
      r.novedades += 1;
    }

    if (!(await tx.sitioContacto.findUnique({ where: { id: 1 } }))) {
      await tx.sitioContacto.create({ data: { id: 1, ...CONTACTO_DESARROLLO } });
      r.contacto += 1;
    }
    return r;
  });
}
