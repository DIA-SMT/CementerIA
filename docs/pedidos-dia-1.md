# Pedidos del día 1

> **Semana 1 del plan de CementerIA.** 19/10/2026. Dirección de Inteligencia Artificial (SMT).
> Fuente: `docs/propuesta-mvp.md`, confirmada el 19/10/2026: sección 6 ("Autenticación", punto 9; "Hosting"; "Backups"; "Ley 25.326"; "Plan tentativo") y sección 8 (riesgo "Camino crítico con Sistemas y el derivador", preguntas 6 y 10).
> Hay un pedido por destinatario: **A. Área de Sistemas**, **B. Equipo del derivador de Cidituc** y **C. Asesoría Legal**. Cada uno está escrito para copiarlo en una nota o en un correo. La última sección, "Seguimiento interno", no se envía.

## Antes de enviar

### Lo que hay que completar

Todo lo que aparece entre `<…>` se reemplaza antes de enviar. Si un dato no se sabe todavía, se deja el texto entre `<…>` y se aclara que está pendiente.

| Marcador | Qué va | Quién lo define |
|---|---|---|
| `<DOMINIO_PROD>` | Dominio definitivo de producción. La propuesta da como ejemplo `cementerios.smt.gob.ar` (pregunta 6), pero no está decidido | Dirección de IA con Sistemas |
| `<DOMINIO_STAGING>` | Dominio definitivo de staging | Dirección de IA con Sistemas |
| `<RESPONSABLE_DIA>` | Nombre, cargo y contacto de quien lleva CementerIA en la Dirección de IA | Dirección de IA |
| `<FECHA_SEMANA_N>` | Fecha de inicio de la semana N del plan (ver la tabla siguiente) | Dirección de IA |
| `<IP_VM_PROD>`, `<IP_VM_STAGING>` | Direcciones IP de las VM | Sistemas |
| `<PUERTO_STAGING>` | Puerto local de la instancia de staging, si comparte VM con producción (producción usa 3010) | Sistemas y Dirección de IA |
| `<SERVIDOR_BACKUP>` | Servidor de backup que asigne Sistemas | Sistemas |
| `<CUSTODIO_CLAVE_RESTIC>` | Quién custodia la clave de cifrado de los backups, fuera del servidor de backup | A definir (la propuesta no lo dice) |
| `<RESPONSABLE_ARCHIVO>`, `<OFICINA_DERECHOS>` | Responsable de la base y oficina donde se ejercen los derechos (art. 22) | Asesoría Legal (pregunta 10) |

### Semanas del plan que se citan

| Semana | Qué pasa | Qué la bloquea |
|---|---|---|
| 1 | Scaffold, migraciones, semilla, login con Cidituc y login simulado; estos pedidos; taller de validación de plantillas | — |
| 5 | **Staging y producción listos** | VM, base, roles, firewall de salida, DNS y certificado, claves del derivador, logs de la base, backups |
| 6–7 | **Piloto** con Mesa de Entradas y Cómputo: en producción y con datos reales solo si el acto del art. 22 está publicado; si no, como simulacro en staging con casos ficticios | Acto del art. 22 publicado; backups andando |
| 8 | Capacitación por área y corte de la ficha para cada trámite con plantilla validada | — |

Con un solo desarrollador la construcción lleva 8 semanas, así que "semana 5" pasa a ser la semana 8 y el piloto pasa a las semanas 9 y 10. Las fechas se corren en consecuencia.

### Orden de envío

1. Los **nombres** de los dominios (A4) se acuerdan primero, porque el pedido al derivador (B) los necesita.
2. Los pedidos A, B y C salen el mismo día. Ninguno espera respuesta de otro, salvo B, que espera los nombres de dominio.

---

## A. Área de Sistemas

**Para:** Área de Sistemas
**Asunto:** CementerIA (Dirección de Cementerios): pedidos de infraestructura

*Texto para copiar, desde acá hasta el final de la sección A:*

Desde la Dirección de Inteligencia Artificial estamos desarrollando **CementerIA**, una aplicación web interna para la Dirección de Cementerios. Reemplaza la ficha de papel con la que hoy se sigue el recorrido de los expedientes entre áreas. El expediente de papel sigue siendo el oficial, y la aplicación no se conecta con Cómputo, con el sistema municipal de expedientes ni con la DIM.

Como va a manejar datos personales de concesionarios y solicitantes (Ley 25.326), se despliega en servidores municipales, con el mismo esquema de operación que DIM360: Ubuntu, nginx, systemd y PostgreSQL 15.

Les pedimos lo que sigue. En cada punto indicamos qué necesitamos, por qué, para cuándo y cómo verificamos juntos que quedó hecho. El responsable por la Dirección de IA es `<RESPONSABLE_DIA>`.

### A1. Máquinas virtuales para producción y staging

**Qué**
- Una VM con **Ubuntu 24.04 LTS** para producción y otra para staging. Si les resulta más cómodo, puede ser una sola VM con dos instancias separadas (`cementeria` y `cementeria-staging`), cada una con su base, su directorio de adjuntos, su puerto y su dominio.
- **Node.js 24 LTS** instalado. Solo hace falta el runtime: en el servidor no se instala nada con npm, porque la aplicación llega compilada.
- **nginx** adelante, con el certificado TLS municipal, reenviando a `127.0.0.1:3010` (staging: `127.0.0.1:<PUERTO_STAGING>`). Lo que nginx tiene que cumplir está en A4.
- Usuario de sistema **`cementeria`** y el directorio **`/var/lib/cementeria/adjuntos`**, de ese usuario y fuera del webroot. Ahí se guardan las copias digitales de documentos (PDF, JPG y PNG de hasta 10 MB).
- Unidades de **systemd**: `cementeria.service` (`User=cementeria`, `Restart=always`, `Environment=TZ=America/Argentina/Tucuman`) y los timers `cementeria-backup.timer` y `cementeria-adjuntos-tmp.timer`. Las escribimos nosotros; necesitamos permiso para instalarlas, o que las instalen ustedes.
- **Acceso SSH** para `<RESPONSABLE_DIA>`, para desplegar: copiar el paquete, correr `prisma migrate deploy` y reiniciar el servicio con `systemctl restart cementeria`.
- **Dimensionamiento:** `<A COMPLETAR con Sistemas: CPU, RAM, disco del sistema y disco para adjuntos>`. Como referencia, lo que tiene DIM360. El disco de adjuntos depende del volumen de expedientes, que todavía no conocemos.

**Por qué**
- Por los datos personales, la aplicación se aloja en servidores municipales.
- Staging va separado para probar con datos ficticios. Además, si el acto de creación del archivo (art. 22 de la Ley 25.326) no está publicado a tiempo, el piloto se hace en staging, como simulacro.

**Para cuándo**
- Antes del `<FECHA_SEMANA_5>`, cuando staging y producción tienen que estar listos.
- La VM de staging, en lo posible antes, para probar desde ahí la salida a Cidituc (A3).

**Cómo se verifica**
- En cada VM: `lsb_release -d` muestra Ubuntu 24.04; `node --version` muestra v24.x; `nginx -v` responde; `id cementeria` muestra el usuario; `ls -ld /var/lib/cementeria/adjuntos` muestra el directorio a nombre de `cementeria`.
- Después del primer despliegue: `systemctl status cementeria` lo muestra activo y `curl -sS https://<DOMINIO_PROD>/api/salud`, desde una PC municipal y sin `-k`, responde 200.

### A2. PostgreSQL 15: base, extensiones y roles

**Qué**
- La base **`cementeria`** en el PostgreSQL 15 municipal, con dueño `cementeria_owner` (ver más abajo).
- Las extensiones **`unaccent`** y **`pg_trgm`**, que vienen en el paquete contrib. Pueden crearlas ustedes. Si no, las crea la primera migración: en PostgreSQL 15 las dos son extensiones confiables y el dueño de la base puede crearlas, siempre que contrib esté instalado.
- La zona horaria de la base: `ALTER DATABASE cementeria SET timezone = 'America/Argentina/Tucuman';`.
- **Tres roles.** Les pasamos el script `scripts/roles.sql` del repositorio, que los crea:
  - `cementeria_owner`, **NOLOGIN**: dueño de la base y de todos sus objetos.
  - `cementeria_deploy`, **LOGIN, NOINHERIT**, miembro de `cementeria_owner` y con `ALTER ROLE cementeria_deploy SET role = 'cementeria_owner';`. Con este rol corren las migraciones. Así, todo lo que crean, incluida la tabla `_prisma_migrations`, queda a nombre de `cementeria_owner`. Su credencial **no queda guardada en el servidor**: la usa `<RESPONSABLE_DIA>` en cada despliegue. Les pedimos que se la entreguen por un canal seguro.
  - `cementeria_app`, **LOGIN**: el rol con el que corre la aplicación. Los permisos sobre las tablas los otorgan las migraciones. Sobre el historial y la auditoría, ese rol solo puede leer e insertar.
  - Ninguno de los tres es SUPERUSER, y ninguno tiene CREATEROLE, CREATEDB, REPLICATION ni BYPASSRLS.
- **Conexiones:** `cementeria_app` y `cementeria_deploy` solo pueden conectarse desde la VM de producción (`pg_hba.conf`).
- **Superusuario:** lo conserva Sistemas. Necesitamos saber qué equipo o qué cargo lo tiene (no hace falta el nombre de la persona). Es el único que puede alterar el historial, y lo dejamos documentado como riesgo residual.
- **Staging:** necesita su propia base en **otra instancia de PostgreSQL 15** (otro cluster), por ejemplo dentro de la VM de staging. No puede ser otra base del mismo cluster de producción. Los roles son globales del cluster y las migraciones otorgan permisos a esos nombres fijos: si staging y producción compartieran cluster, compartirían también las credenciales, y la de staging abriría la base de producción.
- **Plan B**, si la base municipal se demora: PostgreSQL 15 en la misma VM de producción. En ese caso el superusuario lo tiene quien administre la VM, y lo que se pide en A6 aplica igual.

**Por qué**
- El historial de pases tiene que ser inalterable para la aplicación. Eso se apoya en dos cosas:
  - privilegios mínimos: la aplicación no es dueña de las tablas, así que no puede modificar ni desactivar los triggers;
  - triggers que rechazan cualquier modificación o borrado del historial.
- `unaccent` y `pg_trgm` permiten buscar sin importar tildes ni mayúsculas: "gonzalez" encuentra "GONZÁLEZ".

**Para cuándo**
- Saber quién tiene el superusuario: en la semana 1.
- La base y los roles: antes del `<FECHA_SEMANA_5>`.

**Cómo se verifica** (lo corre `<RESPONSABLE_DIA>`)
- Conectado como `cementeria_app`:
  - `SELECT version();` devuelve 15.x;
  - `SELECT extname FROM pg_extension;` incluye `unaccent` y `pg_trgm`;
  - `SHOW timezone;` devuelve `America/Argentina/Tucuman`.
- Conectado como `cementeria_deploy`: `SELECT current_user;` devuelve `cementeria_owner`.
- `SELECT rolname, rolsuper, rolinherit, rolcanlogin, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname LIKE 'cementeria%';` muestra que ninguno es superusuario y que `cementeria_deploy` tiene `rolinherit = false`.
- `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'cementeria';` devuelve `cementeria_owner`.
- Después de la primera migración pasa el test que exige que todas las tablas de los esquemas `public` y `auditoria` sean de `cementeria_owner`.

### A3. Firewall: salida desde las VM hacia Cidituc

**Qué**
- Permitir las conexiones HTTPS **salientes** desde las VM de producción y staging (`<IP_VM_PROD>`, `<IP_VM_STAGING>`) hacia el host del backend de Cidituc, que hoy es **`estadisticas.smt.gob.ar`, puerto TCP 5000**. En la aplicación es la variable `CIDITUC_API_URL`: si el host cambia, la regla tiene que acompañarlo.
- Que las VM resuelvan ese nombre por DNS.

**Por qué**
- El ingreso es con Cidituc, por el endpoint de empleados municipales.
- La redirección al derivador (`cidituc.smt.gob.ar`) la hace el navegador de la persona. La validación del token, en cambio, la hace **el servidor**: es una conexión HTTPS saliente de la VM al backend de Cidituc.
- Sin esta regla nadie puede ingresar, aunque se haya autenticado bien en Cidituc.

**Para cuándo**
- Antes del `<FECHA_SEMANA_5>`.
- Conviene abrirla apenas exista la VM de staging, porque es la falla más difícil de diagnosticar.

**Cómo se verifica**
1. **Sistemas**, desde cada VM: `nc -vz estadisticas.smt.gob.ar 5000` informa que la conexión se estableció.
2. **Dirección de IA**, desde cada VM: un `node -e` que usa `getDeCidituc`, el mismo transporte HTTPS de la aplicación. Ese transporte agrega el certificado intermedio de Sectigo, que el servidor de Cidituc no envía. Se pide `GET /usuarios/authStatusIA` con un token inválido a propósito, y el resultado esperado es **401**. Los otros resultados posibles:
   - 404: la URL apunta a un host que no sirve ese endpoint;
   - sin respuesta: el firewall sigue cerrado;
   - `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: falta el intermedio. Es un problema de la aplicación, no del firewall.

Hay dos pruebas que no sirven:
- `curl -k`, porque saltea la verificación del certificado y oculta justo la falla que hay que ver;
- probar desde una PC con Windows, porque Windows completa la cadena de certificados por su cuenta y da verde aunque el servidor Linux falle.

### A4. DNS y certificado TLS

**Qué**
- Registros DNS para **`<DOMINIO_PROD>`** y **`<DOMINIO_STAGING>`**, que apunten a las VM o al nginx de Sistemas que esté adelante.
- Certificado TLS municipal para los dos dominios, servido con la **cadena completa**: el certificado del sitio y el intermedio.
- Si el nginx de adelante lo administra Sistemas, necesitamos estas cosas:
  1. que **no registre la query string de `/auth/callback`**, porque esa URL trae el token de Cidituc;
  2. `client_max_body_size 12m` **solo** en la ruta de subida de adjuntos (`/api/expedientes/<número>/adjuntos`);
  3. que reenvíe a `127.0.0.1:3010` (staging: `<PUERTO_STAGING>`);
  4. dos encabezados en esa `location`:
     - `proxy_set_header Host $host;`: la aplicación compara el `Origin` de cada POST (por ejemplo, Salir) con `Host`, y con la configuración por defecto de nginx le llegaría `127.0.0.1:3010` y el POST se rechazaría con 403;
     - `proxy_set_header X-Real-IP $remote_addr;`: es la IP que se guarda en el registro de accesos. Si nginx no la pisa, la aplicación cae en `X-Forwarded-For`, que el cliente puede escribir;
  5. un `server` **`default_server`** que corte con `return 444;` todo pedido cuyo `Host` no sea `<DOMINIO_PROD>` (o `<DOMINIO_STAGING>` en su VM). Con `$host`, nginx reenvía el `Host` que manda el cliente, y la aplicación lo usa para decidir dónde ofrece el ingreso de prueba de staging. Que otro `Host` no llegue a la aplicación es lo que hace confiable ese dato.
- `X-Forwarded-Host` no hace falta: la aplicación no lo usa. Si lo agregan, que sea con `$host`, nunca reenviando el que manda el cliente.

**Por qué**
- El derivador de Cidituc devuelve a cada persona a una URL fija por aplicación. Por eso los dominios tienen que ser los definitivos antes de pedir el registro en el derivador (pedido B).
- Con la cadena completa evitamos en nuestro sitio la falla de certificado que hoy tiene el backend de Cidituc.

**Para cuándo**
- **Los nombres de los dominios, en la semana 1**, porque los necesita el equipo del derivador.
- Los registros DNS y los certificados, antes del `<FECHA_SEMANA_5>`.

**Cómo se verifica**
- Desde una PC de la red municipal, `nslookup <DOMINIO_PROD>` y `nslookup <DOMINIO_STAGING>` resuelven a la IP esperada.
- `openssl s_client -showcerts -connect <DOMINIO_PROD>:443 -servername <DOMINIO_PROD> </dev/null | grep -c "BEGIN CERTIFICATE"` da **2 o más**, es decir, la cadena completa. Lo mismo para staging.
- Con la aplicación desplegada, `curl -sS https://<DOMINIO_PROD>/api/salud` responde 200, sin `-k`.
- Después de un ingreso de prueba, el log de acceso de nginx muestra `/auth/callback` sin el parámetro `auth=`.
- Con la aplicación desplegada, desde una PC de la red: ingresar y apretar **Salir** vuelve a `/login` (un 303, no un 403), y en `auditoria.accesos` la fila de esa `salida` tiene en `ip` la IP de la PC, no `127.0.0.1`.
- `curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: otro.ejemplo' https://<DOMINIO_PROD>/login` no devuelve 200 (444 cierra la conexión sin respuesta).

### A5. Acceso solo desde la red municipal

**Qué:** que `<DOMINIO_PROD>` y `<DOMINIO_STAGING>` respondan solo desde la red municipal. Está pendiente de confirmar con la Dirección de Cementerios en el taller de la semana 1 que todas las oficinas que van a usar la herramienta estén en esa red.

**Por qué:** es una herramienta interna, con datos personales y sin usuarios externos. La DIM y los cementerios no tienen usuarios: el papel viaja, la herramienta no.

**Para cuándo:** antes del `<FECHA_SEMANA_5>`.

**Cómo se verifica:** desde una PC municipal el sitio abre; desde un celular con datos móviles, no.

### A6. Registro de cambios en la base: `log_statement = 'ddl'` y pgaudit

**Qué**
- `log_statement = 'ddl'` en el servidor PostgreSQL.
- **pgaudit**, cargado en `shared_preload_libraries` y configurado para auditar las sesiones de **todos los roles salvo `cementeria_app`** sobre la base `cementeria`, incluidos los superusuarios y `cementeria_deploy`. Una forma de hacerlo:
  ```sql
  ALTER DATABASE cementeria SET pgaudit.log = '<clases a acordar: como mínimo ddl, write y role>';
  ALTER ROLE cementeria_app IN DATABASE cementeria SET pgaudit.log = 'none';
  ```
- **No** pedimos `log_statement = 'mod'` ni que se registren parámetros (`pgaudit.log_parameter = off`). Los dos volcarían al log los datos personales de cada inserción que hace la aplicación.
- Que nos digan dónde quedan esos logs, quién puede leerlos y cuánto tiempo se conservan.

**Por qué**
- La aplicación no puede modificar el historial, pero un superusuario de PostgreSQL sí.
- Este registro es lo que vuelve detectable una alteración. Saltear los triggers exige DDL (`ALTER TABLE … DISABLE TRIGGER`), y tocar las tablas exige una sesión de un rol distinto del de la aplicación. Las dos cosas quedan en el log.

**Para cuándo:** antes del `<FECHA_SEMANA_5>` y, en cualquier caso, antes del primer dato real.

**Cómo se verifica** (en producción, antes del primer dato real)
1. La primera `prisma migrate deploy` aparece en el log con el usuario `cementeria_deploy`.
2. Un ingreso a la aplicación, que actualiza la tabla `usuarios` con `cementeria_app`, **no** aparece en el log de pgaudit.

### A7. Backups

**Qué**
- **Destino** en el servidor de backup de Sistemas (`<SERVIDOR_BACKUP>`) para un repositorio **restic**, con conectividad desde la VM de producción por el protocolo que ofrezcan (SFTP, servidor REST de restic u otro).
- **Espacio:** `<A COMPLETAR>`, según la retención.
- **Retención propuesta:** 30 copias diarias y 12 mensuales. Está pendiente de definir con Asesoría Legal (pedido C).
- **Qué se respalda:**
  - el `pg_dump -Fc` de la base, todas las noches a las 02:00;
  - **después del dump**, los adjuntos de `/var/lib/cementeria/adjuntos`.

  Lo dispara `cementeria-backup.timer` desde la VM. Si tienen una ventana de backup propia, coordinamos el horario.
- **Cifrado:** restic cifra los datos, y la clave **no** queda en el servidor de backup. La custodia `<CUSTODIO_CLAVE_RESTIC>`.
- **Credencial para el `pg_dump` nocturno:** la propuesta no define con qué rol de base corre el dump desde la VM, así que hay que acordarlo con ustedes. Hay dos opciones:
  - un rol de solo lectura, por ejemplo `cementeria_backup`, miembro de `pg_read_all_data`, cuya credencial queda en la VM;
  - que el dump lo haga Sistemas.
- **Prueba mensual de restauración:** necesitamos dónde levantar una instancia **efímera y aislada** (`cementeria-restore`), en otro cluster, sin exposición por nginx y con acceso solo para el responsable, que se destruye al terminar.
  - Primero se corre `scripts/roles.sql` y después se restaura el dump completo.
  - Que se haga con datos reales depende de la respuesta de Asesoría Legal.

**Por qué**
- Con el dump y los adjuntos se recupera todo. Como los adjuntos solo se agregan, respaldarlos después del dump cubre todo lo que el dump referencia.
- Comparar contra los backups también sirve para detectar una alteración del historial.
- El cifrado y la custodia de la clave fuera del servidor de backup protegen los datos personales.

**Para cuándo**
- Configurado antes del `<FECHA_SEMANA_5>`.
- Andando antes del primer dato real en producción (piloto, `<FECHA_SEMANA_6>`).

**Cómo se verifica**
- `restic snapshots` muestra la copia de cada noche y `restic check` termina sin errores.
- La primera prueba de restauración pasa la verificación `db:verificar-restauracion`, que controla:
  - los conteos de filas;
  - que las tablas sean de `cementeria_owner`;
  - que los triggers estén en `ENABLE ALWAYS`;
  - que una muestra de adjuntos exista y coincida con su sha256.

  La prueba queda registrada en la auditoría de la aplicación.

### A8. Archivado continuo con pgBackRest (si lo ofrecen)

**Qué:** archivado continuo de WAL con pgBackRest para la base `cementeria`, como en DIM360.

**Por qué:** baja la pérdida máxima de datos ante una falla (RPO) de 24 horas, con un dump por noche, a minutos.

**Para cuándo:** no bloquea ninguna semana. Si no lo ofrecen, el RPO queda en 24 horas y así se documenta.

**Cómo se verifica:** `pgbackrest info` muestra la configuración (stanza) de la base con WAL archivado reciente.

Quedamos a disposición para coordinar cualquiera de estos puntos.
`<RESPONSABLE_DIA>`, Dirección de Inteligencia Artificial.

*Fin del texto para copiar.*

---

## B. Equipo del derivador de Cidituc

**Para:** equipo que mantiene el derivador (`cidituc.smt.gob.ar`, repositorio `derivador`)
**Asunto:** Registro de CementerIA en el derivador: claves `cementeria` y `cementeria-staging`

*Texto para copiar, desde acá hasta el final de la sección B:*

Necesitamos registrar en el derivador dos aplicaciones nuevas: la versión de producción y la de staging de **CementerIA**, la herramienta interna de seguimiento de expedientes de la Dirección de Cementerios. Ingresan empleados municipales, y el token lo validamos contra `/usuarios/authStatusIA`. El responsable por la Dirección de IA es `<RESPONSABLE_DIA>`.

### B1. Alta de las claves `cementeria` y `cementeria-staging`

**Qué.** En `src/components/Login/Login.jsx` hay dos mapas, y hay que agregar las dos claves en **los dos**:

```js
// APPS_EXTERNAS
["cementeria", { nombre: "CementerIA", callbackUrl: import.meta.env.VITE_APP_CEMENTERIA_CALLBACK_URL }],
["cementeria-staging", { nombre: "CementerIA (staging)", callbackUrl: import.meta.env.VITE_APP_CEMENTERIA_STAGING_CALLBACK_URL }],

// RESPALDO_CALLBACK
["cementeria", "https://<DOMINIO_PROD>/auth/callback"],
["cementeria-staging", "https://<DOMINIO_STAGING>/auth/callback"],
```

- **La ruta de regreso de CementerIA es `/auth/callback`**, no `/auth/cidituc/callback` como en UrbanIA, ELCOP y El Sanmiguelino. No hay que copiarla de las otras entradas.
- Los nombres de las variables `VITE_*` y los nombres visibles son una sugerencia que sigue el patrón del archivo. Los definen ustedes.
- El derivador ya reenvía el parámetro `state`, y CementerIA lo exige. El flujo no hay que tocarlo.
- No hace falta ninguna entrada para `localhost`: en desarrollo usamos el derivador local.
- Si más adelante cambia alguno de los dos dominios, la entrada de `RESPALDO_CALLBACK` se cambia **en el mismo despliegue** que la mudanza.

**Por qué**
- **`RESPALDO_CALLBACK` no es opcional.** Vite incorpora las variables `VITE_*` al compilar, y el `.env.production` del derivador no las define. Por eso el bundle desplegado sale con `callbackUrl: void 0` para todas las aplicaciones, y en los hechos el regreso lo decide el respaldo. Sin la entrada en ese mapa, el ingreso se corta con "Falta configurar el regreso hacia CementerIA" cuando la persona ya se autenticó.
- **Un dominio desactualizado en el respaldo da un síntoma engañoso.** Falla el primer intento ("la solicitud venció o no coincide") y el segundo entra, pero en el sitio equivocado. Le pasó a UrbanIA entre el 10 y el 19 de agosto de 2026.
- Pedimos dos claves para que staging use el ingreso real sin tocar producción.

**Para cuándo**
- Desplegado en `cidituc.smt.gob.ar` antes del `<FECHA_SEMANA_5>`.
- Lo pedimos el primer día porque depende del ciclo de despliegue del derivador.
- Si `cementeria-staging` se demora, staging funciona con un ingreso simulado y una lista blanca de usuarios ficticios. Producción no tiene alternativa: sin la clave `cementeria` nadie puede ingresar.

**Cómo se verifica**

La verificación se hace sobre el bundle **desplegado**, no sobre el repositorio, porque ya pasó que un cambio estuviera mergeado y el sitio siguiera sirviendo el bundle viejo.

```bash
BUNDLE=$(curl -s https://cidituc.smt.gob.ar/ | grep -oE '/assets/index-[^"]+\.js' | head -1)
curl -s "https://cidituc.smt.gob.ar$BUNDLE" | grep -oE 'https://[a-z0-9.-]+/auth/(cidituc/)?callback' | sort -u
```

- Tienen que aparecer `https://<DOMINIO_PROD>/auth/callback` y `https://<DOMINIO_STAGING>/auth/callback`.
- Que el bundle muestre `callbackUrl: void 0` es lo esperado y no indica un error. Lo que tiene que estar es el dominio dentro del respaldo.

Con la aplicación ya desplegada en staging, la Dirección de IA prueba el flujo completo:
1. `https://<DOMINIO_STAGING>/login` redirige a `https://cidituc.smt.gob.ar/#/login?next=cementeria-staging&state=…`. El `#` es obligatorio: sin él, el derivador manda a `ciudaddigital`.
2. Con la cookie y el `state` que dejó el paso 1, se llama al callback con un token inventado. Tiene que terminar en el error de token inválido de la aplicación, no en "Cidituc no está disponible". Eso confirma que el servidor llega al backend sin que nadie preste su cuenta.
3. Un integrante de la Dirección de IA dado de alta en staging ingresa con su cuenta de empleado y vuelve a `https://<DOMINIO_STAGING>/auth/callback`.
4. Alguien ingresa con una cuenta de **vecino** (Ciudadano Digital, sin cuenta de empleado). El backend tiene que rechazar ese token en `/usuarios/authStatusIA` con 401, y la aplicación lo tiene que mostrar como token inválido, no como "sin alta". Es la prueba de que el endpoint de empleados no acepta tokens de ciudadanos; los tests de la aplicación solo simulan esa respuesta.

Gracias.
`<RESPONSABLE_DIA>`, Dirección de Inteligencia Artificial.

*Fin del texto para copiar.*

---

## C. Asesoría Legal

**Para:** Asesoría Legal
**Asunto:** CementerIA: acto de creación del archivo de datos personales (art. 22, Ley 25.326) y consultas

*Texto para copiar, desde acá hasta el final de la sección C:*

La Dirección de Inteligencia Artificial está desarrollando para la Dirección de Cementerios **CementerIA**, una aplicación web interna que reemplaza la ficha de papel con la que hoy se sigue el recorrido de los expedientes entre áreas. El expediente de papel sigue siendo el oficial.

La aplicación registra datos personales de:
- titulares de concesiones;
- solicitantes;
- personas fallecidas mencionadas en los trámites;
- los empleados municipales que la usan.

Se aloja en servidores municipales y no cede datos a terceros.

Adjuntamos un **borrador técnico** (`docs/borrador-tecnico-art22.md`) con la finalidad, los usos, las personas alcanzadas, los datos por categoría, la forma de obtención, las cesiones, las medidas de seguridad y los plazos de conservación propuestos. Es un insumo técnico para la redacción del acto, no un texto normativo. El responsable por la Dirección de IA es `<RESPONSABLE_DIA>`.

### C1. Proyecto del acto de creación del archivo (art. 22)

**Qué**
- El proyecto de disposición general que crea el archivo, para su firma y publicación en el boletín oficial que corresponda. Según el art. 22 tiene que indicar:
  - la finalidad y los usos;
  - las personas alcanzadas;
  - la estructura y los datos;
  - las cesiones;
  - el responsable;
  - la oficina ante la que se ejercen los derechos de acceso, rectificación y supresión.
- Definir también quién impulsa el acto y quién figura como responsable de la base (`<RESPONSABLE_ARCHIVO>`, `<OFICINA_DERECHOS>`).

**Por qué**
- El art. 22 exige que la creación de un archivo de datos de un organismo público se haga por una disposición general publicada.
- Lo que está decidido es que **no se cargan datos reales en producción hasta que el acto esté publicado**.

**Para cuándo**
- Publicado antes del `<FECHA_SEMANA_6>`, cuando empieza el piloto.
- Si no está publicado para entonces, el piloto se hace como simulacro, con casos ficticios, y el uso con datos reales se posterga hasta la publicación.

**Cómo se verifica**
- Número y fecha de publicación del acto, con una copia agregada a la documentación del proyecto.
- Comparamos el texto publicado con lo que hace la herramienta. Si no coinciden, se ajusta la herramienta o se modifica el acto antes de cargar datos reales.

### C2. Consultas sobre datos personales

Pedimos respuesta por escrito a estas preguntas:

1. ¿Quién impulsa el acto de creación del archivo y quién figura como responsable de la base?
2. Lo decidido es no pasar a producción con datos reales hasta que el acto esté publicado. ¿Están de acuerdo, o hace falta algo más antes?
3. ¿Cuánto tiempo se conservan estos registros?
   - **Registros de acceso** (quién abrió cada ficha, quién vio datos completos y por qué, vistas y descargas de documentos, impresiones, exportaciones): proponemos 24 meses.
   - **Copias digitales de documentos:** no tenemos propuesta.
   - **Backups:** proponemos 30 copias diarias y 12 mensuales.
   - **Expedientes, personas e historial:** la herramienta no los borra, y no tenemos propuesta de plazo. Ver el punto 10 del borrador técnico.
4. Cuando se suprimen los datos de una persona, la supresión no alcanza a los backups hasta que vence su retención: con la retención propuesta, alrededor de 12 meses. ¿Lo aceptan, documentado así?
5. ¿Aceptan que la prueba mensual de restauración de backups se haga con datos reales en una instancia efímera aislada, sin exposición a la red, con acceso solo del responsable, que se destruye al terminar cada prueba?
6. ¿Hace falta inscribir la base ante la Agencia de Acceso a la Información Pública (AAIP)?

**Para cuándo:** antes del `<FECHA_SEMANA_5>`, porque las retenciones se configuran en los backups y en la aplicación cuando se deja producción lista.

**Cómo se verifica:** respuestas por escrito, que se incorporan a la propuesta y al borrador técnico.

### C3. Consulta adicional: cómputo del plazo de 30 días hábiles de la DIM

**Qué.** En la renovación con plan de pagos, el concesionario tiene 30 días hábiles para iniciar la forma de pago ante la DIM. La herramienta cuenta así:
- desde el día hábil siguiente a la notificación;
- sin contar sábados, domingos, feriados ni asuetos.

Queremos saber si ese criterio es correcto y si las ferias administrativas suspenden el plazo. La herramienta solo avisa, no cambia el estado del expediente.

**Por qué:** la propuesta deja el criterio de cómputo a confirmar con Asesoría Legal.

**Para cuándo:** antes de la semana 4 del plan (`<FECHA_SEMANA_4>`), cuando se construyen el plazo de la DIM y los feriados.

**Cómo se verifica:** respuesta por escrito, que se agrega a la configuración de la plantilla.

Quedamos a disposición para una reunión de trabajo.
`<RESPONSABLE_DIA>`, Dirección de Inteligencia Artificial.

*Fin del texto para copiar.*

---

## Seguimiento interno (no se envía)

| # | Pedido | Destinatario | Bloquea | Plan B si se demora | Enviado | Respondido | Verificado |
|---|---|---|---|---|---|---|---|
| A1 | VM de producción y de staging | Sistemas | Semana 5 | — | ☐ | ☐ | ☐ |
| A2 | PostgreSQL 15, extensiones, roles, superusuario | Sistemas | Semana 5 (superusuario: semana 1) | PostgreSQL 15 en la misma VM | ☐ | ☐ | ☐ |
| A3 | Firewall de salida a `estadisticas.smt.gob.ar:5000` | Sistemas | Semana 5 | Staging: login simulado con lista blanca. Producción: ninguno | ☐ | ☐ | ☐ |
| A4 | Nombres de dominio; DNS y certificado | Sistemas | Nombres: semana 1 (los necesita B1). DNS y certificado: semana 5 | — | ☐ | ☐ | ☐ |
| A5 | Acceso solo desde la red municipal | Sistemas | Semana 5 | — | ☐ | ☐ | ☐ |
| A6 | `log_statement = 'ddl'` y pgaudit | Sistemas | Primer dato real | — | ☐ | ☐ | ☐ |
| A7 | restic, retención, clave, rol del dump, instancia de restauración | Sistemas | Primer dato real (semana 6) | — | ☐ | ☐ | ☐ |
| A8 | pgBackRest | Sistemas | No bloquea | RPO de 24 h | ☐ | ☐ | ☐ |
| B1 | Claves `cementeria` y `cementeria-staging` | Derivador | Semana 5 | Staging: `/dev/login` con `AUTH_DEV_LOGIN_STAGING`. Producción: ninguno | ☐ | ☐ | ☐ |
| C1 | Acto del art. 22 | Asesoría Legal | Piloto con datos reales (semana 6) | Piloto como simulacro en staging | ☐ | ☐ | ☐ |
| C2 | Consultas de la pregunta 10 | Asesoría Legal | Semana 5 (retenciones) | Retenciones propuestas, marcadas como provisorias | ☐ | ☐ | ☐ |
| C3 | Cómputo del plazo de la DIM | Asesoría Legal | Semana 4 | Criterio de la propuesta, marcado como a confirmar | ☐ | ☐ | ☐ |

**Puntos que la propuesta no define y que surgieron al armar estos pedidos** (los tiene que resolver quien decide el diseño):
- Con qué rol de base corre el `pg_dump` nocturno (A7).
- Dimensionamiento de las VM y espacio de backup: depende del volumen de expedientes (pregunta 1).
- Quién custodia la clave de restic.
- La pregunta 6 menciona una "base de auditoría separada", pero el modelo (sección 2.10) usa el esquema `auditoria` dentro de la misma base. No se pidió a Sistemas. Si la idea era mandar los logs de pgaudit a otro destino, hay que pedirlo aparte.
- Staging necesita otro cluster de PostgreSQL, no otra base del mismo cluster (A2). Es una consecuencia de que las migraciones otorguen permisos a nombres de rol fijos.
- La sección 6 pide que "un test verifica que un token de ciudadano recibe 401". El test automático (`src/lib/auth/cidituc/validar.test.ts`) solo comprueba que un 401 se traduce en `token_invalido`: que el backend de verdad rechace a un vecino se verifica a mano, en el paso 4 de B1, y su resultado se anota acá. Hasta entonces ese punto de la semana 1 **no está cumplido**.
