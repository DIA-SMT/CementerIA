// Lo que el globalSetup le pasa a los tests (con `provide` / `inject`).

export interface BaseIntegracion {
  /** cementeria_app: el rol con el que corre la aplicación. */
  urlApp: string;
  /** cementeria_deploy, que al conectarse toma el rol cementeria_owner. */
  urlDeploy: string;
  /** Superusuario `postgres` del clúster efímero, sobre la base cementeria. */
  urlSuperusuario: string;
  puerto: number;
}

declare module "vitest" {
  export interface ProvidedContext {
    baseIntegracion: BaseIntegracion;
  }
}
