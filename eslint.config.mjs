import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Toda escritura pasa por conActor() (src/lib/db/transaccion.ts). En
 * movimientos, expedientes, expediente_personas y la configuración auditada
 * (catálogos, plantillas, feriados y el acceso de usuarios) los triggers
 * exigen el actor y una escritura suelta falla en la base. En
 * auditoria.accesos y en las columnas de ingreso de usuarios (nombre, email,
 * ultimo_ingreso, cidituc_id, sesion_version) no hay trigger: ahí solo frena
 * esta regla. Así que la regla marca el error antes, al escribir el código.
 *
 * Se detecta por el nombre: `prisma` es el cliente global de src/lib/db/cliente.ts.
 * Dentro de conActor el cliente se llama `tx` (u otro nombre), así que
 * `tx.expediente.update(…)` pasa y `prisma.expediente.update(…)` no. Escribir
 * con `$executeRaw`, con un `$queryRaw` que modifica o abrir un `$transaction`
 * propio sobre el global también queda prohibido: saltearían el actor. Para
 * que el nombre no se pueda esquivar, tampoco se renombra el cliente (import
 * con alias o namespace, `const db = prisma`, desestructurarlo).
 *
 * Es una regla por nombre, no un análisis de flujo: pasar `prisma` como
 * argumento a otra función no se detecta. Por eso las dependencias que lo
 * reciben se tipan solo con las lecturas que usan (ver DependenciasIngreso).
 */
const ESCRITURAS =
  "/^(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)$/";
const MENSAJE_ESCRITURA =
  "Las escrituras van dentro de conActor(usuarioId, motivo, async (tx) => …) de @/lib/db/transaccion, usando `tx`.";
const MENSAJE_CRUDO =
  "Con el cliente global no se escribe SQL ni se abren transacciones: usá conActor() de @/lib/db/transaccion.";

const MENSAJE_ALIAS =
  "El cliente global se usa con su nombre, `prisma` (la regla de escrituras lo detecta por el nombre). Para escribir, conActor().";

// Sentencias que modifican, en el texto de un $queryRaw`…`.
const SQL_QUE_ESCRIBE = String.raw`/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE|ALTER|DROP|CREATE|GRANT|REVOKE|SET|COPY|CALL)\b/i`;

const reglaEscrituras = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `CallExpression[callee.type='MemberExpression'][callee.property.name=${ESCRITURAS}][callee.object.type='MemberExpression'][callee.object.object.name='prisma']`,
      message: MENSAJE_ESCRITURA,
    },
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.object.name='prisma'][callee.property.name=/^\\$(executeRaw|executeRawUnsafe|queryRawUnsafe|transaction)$/]",
      message: MENSAJE_CRUDO,
    },
    {
      selector:
        "TaggedTemplateExpression[tag.type='MemberExpression'][tag.object.name='prisma'][tag.property.name='$executeRaw']",
      message: MENSAJE_CRUDO,
    },
    {
      selector: `TaggedTemplateExpression[tag.type='MemberExpression'][tag.object.name='prisma'][tag.property.name=/^\\$queryRaw/] TemplateElement[value.raw=${SQL_QUE_ESCRIBE}]`,
      message: MENSAJE_CRUDO,
    },
    {
      selector: "ImportSpecifier[imported.name='prisma'][local.name!='prisma']",
      message: MENSAJE_ALIAS,
    },
    {
      selector: String.raw`ImportDeclaration[source.value=/lib\/db\/cliente$/] > ImportNamespaceSpecifier`,
      message: MENSAJE_ALIAS,
    },
    {
      selector: "VariableDeclarator[init.type='Identifier'][init.name='prisma']",
      message: MENSAJE_ALIAS,
    },
    {
      selector: "AssignmentExpression[right.type='Identifier'][right.name='prisma']",
      message: MENSAJE_ALIAS,
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**"],
    rules: reglaEscrituras,
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cliente generado por `prisma generate`.
    "src/generated/**",
    // Base de datos y archivos locales.
    ".local/**",
    ".data/**",
  ]),
]);

export default eslintConfig;
