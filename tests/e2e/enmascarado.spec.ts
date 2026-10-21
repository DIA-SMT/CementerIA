import { expect, test } from "@playwright/test";
import { abrirFicha, darDeAlta, datosAlta, entrarComo, nuevaSesion } from "./ayudas";

// Decisión 13: quien no trabaja el expediente ve el contacto enmascarado y lo
// pide con "Ver datos completos" y un motivo, que queda en auditoria.accesos.

test("un área por la que no pasó el expediente ve el contacto enmascarado y «Ver datos completos» con motivo lo muestra", async ({ page, browser }) => {
  await entrarComo(page, "mesa");
  const d = datosAlta({ telefono: "0381 000-4321", domicilio: "Calle Ficticia 742" });
  const numero = await darDeAlta(page, d);

  // Asesoría Legal no lo tuvo nunca.
  const legal = await nuevaSesion(browser, "legal");
  await abrirFicha(legal.page, numero);
  const personas = legal.page.getByRole("region", { name: "Personas" });
  await expect(personas).toContainText("El teléfono, el correo y el domicilio se ven enmascarados porque tu área no trabaja este expediente.");
  await expect(personas).toContainText(d.apellido);
  await expect(personas.getByText("Enmascarado", { exact: true })).toBeVisible();
  await expect(personas).not.toContainText("0381 000-4321");
  await expect(personas).not.toContainText(d.email);
  await expect(personas).not.toContainText("Calle Ficticia 742");

  await personas.getByRole("button", { name: "Ver datos completos" }).click();
  const motivo = personas.getByRole("textbox", { name: "Motivo" });
  await expect(motivo).toBeFocused();

  // Sin un motivo de verdad, no.
  await motivo.fill("porque sí");
  await personas.getByRole("button", { name: "Ver datos", exact: true }).click();
  await expect(motivo).toHaveAccessibleDescription(/Escribí el motivo \(10 caracteres o más\)/);

  await motivo.fill("El titular llamó para saber en qué estado está el trámite");
  await personas.getByRole("button", { name: "Ver datos", exact: true }).click();
  const completos = personas.getByRole("region", { name: "Datos completos (tu consulta quedó registrada)" });
  await expect(completos).toBeVisible();
  await expect(completos).toContainText("0381 000-4321");
  await expect(completos).toContainText(d.email);
  await expect(completos).toContainText("Calle Ficticia 742");

  // Mesa de Entradas, que lo trabaja, lo ve completo sin pedir nada.
  const mesa = page.getByRole("region", { name: "Personas" });
  await expect(mesa).toContainText("0381 000-4321");
  await expect(mesa.getByRole("button", { name: "Ver datos completos" })).toHaveCount(0);

  await legal.context.close();
});
