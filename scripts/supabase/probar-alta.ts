// Alta de prueba que NO deja datos (scripts/supabase/preparar.mjs, paso de
// verificación): da de alta un expediente ficticio con el dominio real, como
// el admin inicial y con el rol de la app (DATABASE_URL), comprueba la cadena
// de hash de su historial con f_verificar_cadena DENTRO de la misma
// transacción y la deshace tirando un error a propósito. La numeración
// (max + 1 con pg_advisory_xact_lock) se deshace con ella: no quedan huecos.
//
// Escribe una línea JSON con el resultado y sale con 0 si todo dio bien.

import { randomUUID } from "node:crypto";
import { conActorEn } from "../../src/lib/db/actor";
import { crearCliente } from "../../src/lib/db/crear-cliente";
import { crearServicioExpedientes } from "../../src/lib/dominio/expedientes";
import { esRol } from "../../src/lib/dominio/permisos";
import { hoyEnTucuman } from "../../src/lib/fechas";

class Deshacer extends Error {
  constructor(readonly resultado: Record<string, unknown>) {
    super("deshacer el alta de prueba");
  }
}

async function main(): Promise<number> {
  const cliente = crearCliente();
  try {
    const contar = async () => ({
      expedientes: await cliente.expediente.count(),
      movimientos: await cliente.movimiento.count(),
      personas: await cliente.expedientePersona.count(),
    });
    const [{ zona }] = await cliente.$queryRaw<{ zona: string }[]>`SELECT current_setting('TimeZone') AS zona`;
    const antes = await contar();

    const fila = await cliente.usuario.findFirst({
      where: { rol: "admin", activo: true, id: { not: 1 } },
      orderBy: { id: "asc" },
      select: { id: true, rol: true, activo: true, area: { select: { id: true, codigo: true } } },
    });
    if (!fila || !esRol(fila.rol)) throw new Error("No hay un admin activo (ADMIN_INICIAL_CUIL): ¿corrió la semilla?");
    const admin = { id: fila.id, rol: fila.rol, activo: fila.activo, area: fila.area };
    const plantilla = await cliente.plantilla.findFirst({ where: { codigo: "RENOV_CONTADO", estado: "publicada" }, select: { id: true } });
    const cementerio = await cliente.cementerio.findUnique({ where: { codigo: "OESTE" }, select: { id: true } });
    if (!plantilla || !cementerio) throw new Error("Falta la plantilla RENOV_CONTADO publicada o el cementerio OESTE: ¿corrió la semilla?");

    const servicio = crearServicioExpedientes({
      leer: cliente,
      escribir: (usuarioId, motivo, fn) =>
        conActorEn(cliente, usuarioId, motivo, async (tx) => {
          const r = (await fn(tx)) as { id: string; numero: string };
          const [v] = await tx.$queryRaw<{ integra: boolean; movimientos: number; hash_final: string | null }[]>`
            SELECT integra, movimientos, hash_final FROM public.f_verificar_cadena(${BigInt(r.id)})`;
          throw new Deshacer({ numero: r.numero, ...v });
        }),
    });

    let resultado: Record<string, unknown> | null = null;
    try {
      await servicio.alta(
        admin,
        {
          plantillaId: plantilla.id,
          cementerioId: cementerio.id,
          tipoMonumento: "SEPULTURA",
          ubicacion: { seccion: "A", lote: "999999" },
          padron: "PRUEBA-PREPARAR",
          personas: [
            {
              rol: "titular",
              apellido: "FICTICIO PREPARAR",
              nombres: "Prueba Que Se Deshace",
              dni: "99999999",
              telefono: "0381 000-0000",
              domicilio: "Calle Ficticia 1",
            },
          ],
          fechaInicio: hoyEnTucuman(),
        },
        randomUUID(),
      );
    } catch (e) {
      if (!(e instanceof Deshacer)) throw e;
      resultado = e.resultado;
    }
    const despues = await contar();
    const sinRastros = JSON.stringify(antes) === JSON.stringify(despues);
    const ok = Boolean(resultado && resultado.integra === true && Number(resultado.movimientos) >= 1 && sinRastros && zona === "UTC");
    console.log(JSON.stringify({ ok, zona_de_la_sesion: zona, alta: resultado, sin_rastros: sinRastros, conteos: despues }));
    return ok ? 0 : 1;
  } finally {
    await cliente.$disconnect();
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    process.exit(2);
  });
