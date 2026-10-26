import { expect, test } from "@playwright/test";
import {
  abrirFicha,
  abrirPestana,
  accion,
  confirmarRecepcion,
  darDeAlta,
  darPase,
  datoDeLaFicha,
  dialogo,
  entrarComo,
  esperarAviso,
  filaDeBandeja,
  hoyEnTucuman,
  nuevaSesion,
  PNG_CHICO,
} from "./ayudas";

// El circuito de la propuesta (sección 6, "Tests": alta → pase → recepción →
// devolución → conclusión), con la renovación de contado de 7 pasos (4(a)):
// cada área entra con su usuario, en su propia sesión, y hace lo suyo desde la
// ficha y la bandeja.

test("una renovación recorre los 7 pasos con una devolución, se concluye y se archiva con caja", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const motivoDevolucion = "Falta el N° de registro en la constancia de Cómputo";

  // 1. Mesa de Entradas: alta sin documentos, "Faltan 4" y el pase a Cómputo.
  await entrarComo(page, "mesa");
  const numero = await darDeAlta(page);
  await expect(datoDeLaFicha(page, "Paso actual")).toHaveText("1 de 7: Mesa de Entradas");
  await page.getByRole("button", { name: "Dar pase · Faltan 4" }).click();
  const faltan = dialogo(page, "Faltan 4 cosas para avanzar");
  await expect(faltan).toBeVisible();
  await expect(faltan.getByRole("listitem")).toHaveCount(4);
  // El "Cerrar" del pie recibe el foco al abrir (la X del encabezado es "Cerrar ventana").
  const cerrar = faltan.getByRole("button", { name: "Cerrar", exact: true });
  await expect(cerrar).toBeFocused();
  await cerrar.click();
  await expect(faltan).toBeHidden();
  await darPase(page, "2 de 7: Cómputo: alta");
  await expect(datoDeLaFicha(page, "Área actual")).toHaveText("Cómputo");

  // 2. Cómputo: lo ve en Por confirmar, confirma, tilda, adjunta un PNG y da el pase.
  const computo = await nuevaSesion(browser, "computo");
  await abrirPestana(computo.page, "Por confirmar");
  const fila = filaDeBandeja(computo.page, numero);
  await expect(fila).toContainText("Sin confirmar");
  await fila.getByRole("button", { name: `Confirmar la recepción de ${numero}` }).click();
  await expect(computo.page.getByRole("status").filter({ hasText: /recepci/i })).toBeVisible();
  await expect(filaDeBandeja(computo.page, numero)).toHaveCount(0);

  await abrirFicha(computo.page, numero);
  await computo.page.getByRole("button", { name: accion("Tildar", "Trámite grabado en el sistema de Cómputo") }).click();
  const tildar = dialogo(computo.page, "Tildar subtarea");
  await tildar.getByRole("textbox", { name: "Dato" }).fill("REG-4471");
  await tildar.getByRole("button", { name: "Tildar" }).click();
  await expect(tildar).toBeHidden();
  await expect(computo.page.getByText("Trámite grabado en el sistema de Cómputo: REG-4471")).toBeVisible();

  await computo.page.getByRole("button", { name: "Adjuntar archivo suelto" }).click();
  const adjuntar = dialogo(computo.page, "Adjuntar archivo");
  await adjuntar.getByLabel("Archivo").setInputFiles({ name: "constancia-computo.png", mimeType: "image/png", buffer: PNG_CHICO });
  await adjuntar.getByRole("button", { name: "Subir" }).click();
  await expect(adjuntar).toBeHidden();
  await esperarAviso(computo.page, /Se adjuntó constancia-computo/);
  const adjuntos = computo.page.getByRole("region", { name: "Adjuntos" });
  await expect(adjuntos.getByText(/constancia-computo/).first()).toBeVisible();

  await darPase(computo.page, "3 de 7: Liquidación y boleta");

  // 3. Liquidación confirma y lo devuelve a Cómputo con motivo.
  const liquidacion = await nuevaSesion(browser, "liquidacion");
  await abrirFicha(liquidacion.page, numero);
  await confirmarRecepcion(liquidacion.page);
  await liquidacion.page.getByRole("button", { name: "Devolver", exact: true }).click();
  const devolver = dialogo(liquidacion.page, "Devolver");
  await devolver.getByLabel("Devolver al paso").selectOption({ label: "2. Cómputo: alta" });
  await devolver.getByRole("textbox", { name: "Motivo" }).fill(motivoDevolucion);
  await devolver.getByRole("button", { name: "Devolver", exact: true }).click();
  await expect(devolver).toBeHidden();
  await expect(datoDeLaFicha(liquidacion.page, "Paso actual")).toHaveText("2 de 7: Cómputo: alta");

  // 4. Cómputo lo ve devuelto, en rojo y con el motivo, y lo reenvía directo a Liquidación.
  await abrirPestana(computo.page, "Por confirmar");
  const devuelto = filaDeBandeja(computo.page, numero);
  await expect(devuelto.getByText(`Devuelto por Liquidación: ${motivoDevolucion}`)).toBeVisible();
  // El rojo de la fila (y de la etiqueta) es el que distingue un devuelto en la bandeja.
  await expect(devuelto).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\)).+/);
  await devuelto.getByRole("button", { name: `Confirmar la recepción de ${numero}` }).click();
  await expect(filaDeBandeja(computo.page, numero)).toHaveCount(0);

  await abrirFicha(computo.page, numero);
  // Nada que rehacer: el pase sale sin "Faltan" y propone volver al paso que lo devolvió.
  await computo.page.getByRole("button", { name: "Dar pase", exact: true }).click();
  const reenvio = dialogo(computo.page, "Dar pase");
  const destino = reenvio.getByRole("radio", { name: /^3\. Liquidación y boleta/ });
  await expect(destino).toBeChecked();
  await expect(reenvio.getByText("Es el paso que lo devolvió.")).toBeVisible();
  await reenvio.getByRole("button", { name: "Dar pase", exact: true }).click();
  await expect(reenvio).toBeHidden();
  await expect(datoDeLaFicha(computo.page, "Paso actual")).toHaveText("3 de 7: Liquidación y boleta");

  // 5. Liquidación: resuelve lo suyo (boleta, pago con fecha, documentos) y pasa a Legal.
  await abrirFicha(liquidacion.page, numero);
  await confirmarRecepcion(liquidacion.page);
  await darPase(liquidacion.page, "4 de 7: Asesoría Legal");

  // 6. Asesoría Legal: dictamen y pase.
  const legal = await nuevaSesion(browser, "legal");
  await abrirFicha(legal.page, numero);
  await confirmarRecepcion(legal.page);
  await darPase(legal.page, "5 de 7: Administrativo: resolución y título");

  // 7. Administrativo: resolución y título.
  const administrativo = await nuevaSesion(browser, "administrativo");
  await abrirFicha(administrativo.page, numero);
  await confirmarRecepcion(administrativo.page);
  await darPase(administrativo.page, "6 de 7: Cómputo: final");

  // 8. Cómputo final: completa el período de la concesión (se pide al salir de este paso) y pasa a la entrega.
  await abrirFicha(computo.page, numero);
  await confirmarRecepcion(computo.page);
  await computo.page.getByRole("link", { name: "Editar" }).click();
  await computo.page.getByLabel("Inicio de la concesión").fill("2026-11-01");
  await computo.page.getByLabel("Vencimiento de la concesión").fill("2031-10-31");
  await computo.page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(computo.page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
  await darPase(computo.page, "7 de 7: Administrativo: entrega");

  // 9. Administrativo: entrega del título, Concluir ("Falta 1") y Archivar con caja.
  await abrirFicha(administrativo.page, numero);
  await confirmarRecepcion(administrativo.page);
  await administrativo.page.getByRole("button", { name: /^Concluir/ }).click();
  const concluir = dialogo(administrativo.page, "Falta 1 cosa para concluir");
  await expect(concluir).toBeVisible();
  await concluir.getByRole("button", { name: /^(Tildar|Completar el dato)/ }).click();
  const entrega = dialogo(administrativo.page, "Tildar subtarea");
  await entrega.getByLabel("Fecha").fill(hoyEnTucuman());
  await entrega.getByRole("button", { name: "Tildar" }).click();
  const formulario = dialogo(administrativo.page, "Concluir");
  await formulario.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(formulario).toBeHidden();
  await expect(administrativo.page.getByRole("heading", { level: 1, name: numero }).locator("xpath=..")).toContainText("Concluido");

  await administrativo.page.getByRole("button", { name: "Archivar", exact: true }).click();
  const archivar = dialogo(administrativo.page, "Archivar");
  await archivar.getByRole("textbox", { name: "Ubicación en el archivo (caja o estante)" }).fill("Caja 12, estante B");
  await archivar.getByRole("button", { name: "Archivar", exact: true }).click();
  await expect(archivar).toBeHidden();
  await expect(administrativo.page.getByRole("heading", { level: 1, name: numero }).locator("xpath=..")).toContainText("Archivado");
  await expect(datoDeLaFicha(administrativo.page, "Ubicación en el archivo")).toHaveText("Caja 12, estante B");

  // El historial cuenta el recorrido entero, devolución incluida.
  const historial = administrativo.page.getByRole("region", { name: "Historial" });
  await expect(historial).toContainText(motivoDevolucion);

  for (const s of [computo, liquidacion, legal, administrativo]) await s.context.close();
});

// Avisos (26/10/2026). Va en este archivo, después del circuito, y no en uno
// propio: es el único otro que le manda expedientes a Cómputo, y las pruebas de
// un mismo archivo corren en orden. Así el contador de la campana de Cómputo
// cuenta solo lo de esta prueba.
test("avisos: Liquidación devuelve a Cómputo y Cómputo ve la campana con 1 aviso, lo abre y va a la ficha", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const motivo = "Error en boleta: falta el concepto de conservación del período";

  // Un expediente nuevo hasta Liquidación.
  await entrarComo(page, "mesa");
  const numero = await darDeAlta(page);
  await darPase(page, "2 de 7: Cómputo: alta");
  const computo = await nuevaSesion(browser, "computo");
  await abrirFicha(computo.page, numero);
  await darPase(computo.page, "3 de 7: Liquidación y boleta");

  // Cómputo deja la campana en cero (la semilla y el pase de Mesa le dejaron avisos).
  const campana = computo.page.getByRole("button", { name: /^Avisos, / });
  await campana.click();
  await expect(campana).toHaveAttribute("aria-expanded", "true");
  const panel = computo.page.getByRole("region", { name: /^Avisos/ });
  await expect(panel.getByRole("heading", { level: 2, name: /^Avisos/ })).toBeFocused();
  await panel.getByRole("button", { name: "Marcar todos como leídos" }).click();
  await expect(computo.page.getByRole("button", { name: "Avisos, ninguno sin leer" })).toBeVisible();
  // Escape cierra el panel y devuelve el foco a la campana.
  await computo.page.keyboard.press("Escape");
  await expect(campana).toHaveAttribute("aria-expanded", "false");
  await expect(campana).toBeFocused();

  // Liquidación lo devuelve a Cómputo con el motivo.
  const liquidacion = await nuevaSesion(browser, "liquidacion");
  await abrirFicha(liquidacion.page, numero);
  await confirmarRecepcion(liquidacion.page);
  await liquidacion.page.getByRole("button", { name: "Devolver", exact: true }).click();
  const devolver = dialogo(liquidacion.page, "Devolver");
  await devolver.getByLabel("Devolver al paso").selectOption({ label: "2. Cómputo: alta" });
  await devolver.getByRole("textbox", { name: "Motivo" }).fill(motivo);
  await devolver.getByRole("button", { name: "Devolver", exact: true }).click();
  await expect(devolver).toBeHidden();

  // Cómputo entra a su bandeja: la campana dice 1 sin leer.
  await computo.page.goto("/bandeja");
  const conUno = computo.page.getByRole("button", { name: "Avisos, 1 sin leer" });
  await expect(conUno).toBeVisible();
  await conUno.click();
  const aviso = panel.getByRole("link", { name: new RegExp(`Te devolvieron ${numero}`) });
  await expect(aviso).toContainText(`Liquidación lo devolvió a Cómputo: alta: ${motivo}`);
  // Prioridad alta: la franja roja y la insignia (el color no va solo).
  await expect(aviso).toContainText("Prioridad alta");

  // Lo abre: va a la ficha y el aviso queda leído.
  await aviso.click();
  await expect(computo.page).toHaveURL(new RegExp(`/expedientes/${numero}$`));
  await expect(computo.page.getByRole("heading", { level: 1, name: numero })).toBeVisible();
  await expect(computo.page.getByRole("button", { name: "Avisos, ninguno sin leer" })).toBeVisible();
  await computo.page.reload();
  await expect(computo.page.getByRole("button", { name: "Avisos, ninguno sin leer" })).toBeVisible();

  for (const s of [computo, liquidacion]) await s.context.close();
});
