import { Fragment } from "react";
import { bloquesDe, type Trozo } from "@/lib/migue/formato";

/**
 * Una respuesta de Migue con su formato: negritas, cursivas, listas y
 * títulos (src/lib/migue/formato.ts). Todo con elementos de React: el texto
 * del modelo nunca se inserta como HTML.
 */

function Trozos({ trozos }: { trozos: Trozo[] }) {
  return trozos.map((t, i) =>
    t.tipo === "negrita" ? (
      <strong key={i} className="font-semibold">
        {t.texto}
      </strong>
    ) : t.tipo === "cursiva" ? (
      <em key={i}>{t.texto}</em>
    ) : (
      <Fragment key={i}>{t.texto}</Fragment>
    ),
  );
}

export function TextoMigue({ texto }: { texto: string }) {
  return (
    <div className="space-y-2">
      {bloquesDe(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          return (
            <p key={i} className="font-semibold">
              <Trozos trozos={b.trozos} />
            </p>
          );
        }
        if (b.tipo === "lista") {
          const Lista = b.ordenada ? "ol" : "ul";
          return (
            <Lista key={i} className={`space-y-1 pl-5 ${b.ordenada ? "list-decimal" : "list-disc"}`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Trozos trozos={item} />
                </li>
              ))}
            </Lista>
          );
        }
        return (
          <p key={i}>
            {b.lineas.map((linea, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                <Trozos trozos={linea} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
