#!/usr/bin/env bash
# Prueba mensual de restauración de CementerIA (docs/propuesta-mvp.md, sección
# 6, "Backups"; docs/pedidos-dia-1.md, A7; docs/despliegue.md, "Prueba mensual
# de restauración").
#
#   bash restaurar-prueba.sh [--snapshot <id>|latest] [--muestra N] [--salida <json>] [--conservar]
#
# Levanta la instancia efímera y aislada `cementeria-restore` y la destruye al
# terminar, pase lo que pase:
#
#   1. restic restore del snapshot (el dump y los adjuntos) a una carpeta temporal;
#   2. un clúster PostgreSQL 15 NUEVO en esa carpeta, sin TCP (solo un socket
#      Unix en una carpeta 0700): nadie más que este usuario puede conectarse,
#      y no hay nada que exponer por nginx;
#   3. scripts/roles.sql ANTES de restaurar (pg_dump no incluye los roles);
#   4. la base `cementeria` con dueño cementeria_owner y la zona de Tucumán,
#      y pg_restore COMPLETO (nunca --data-only: los triggers se crean después
#      de los datos);
#   5. scripts/verificar-restauracion.mjs: conteos contra el dump, dueños,
#      triggers ENABLE ALWAYS, migraciones, historial y sha256 de una muestra
#      de adjuntos;
#   6. borra todo (clúster, dump y adjuntos restaurados).
#
# Corre como un usuario sin privilegios (initdb no corre como root) que tenga
# la clave de restic. Con datos reales, solo si Asesoría Legal lo aprobó
# (pedido C2, pregunta 5) y en una máquina con disco cifrado: lo que se borra
# al final no se sobrescribe.
#
# El resultado (--salida) no tiene datos personales y se registra en
# producción con:
#   sudo node /opt/cementeria/actual/scripts/verificar-restauracion.mjs registrar \
#     --resultado <json> --cuil <CUIL del responsable> --env-file /etc/cementeria/cementeria.env
#
# Variables:
#   RESTIC_REPOSITORY, RESTIC_PASSWORD o RESTIC_PASSWORD_FILE (secreta)
#   PG_BIN        binarios del servidor PostgreSQL 15 (por defecto /usr/lib/postgresql/15/bin)
#   PAQUETE       paquete de CementerIA con scripts/ y prisma/ (por defecto, la carpeta padre de este script)
#   NODE          node 24 (por defecto, el del PATH)
#   BACKUP_DIR    dónde estaba el dump en producción (por defecto /var/backups/cementeria)
#   ADJUNTOS_DIR  dónde estaban los adjuntos en producción (por defecto /var/lib/cementeria/adjuntos)
#   TMPDIR        dónde se arma la instancia (por defecto /var/tmp): tiene que
#                 tener lugar para el dump, la base restaurada y los adjuntos

set -Eeuo pipefail
umask 077

info() { printf '%s restaurar-prueba: %s\n' "$(date +%H:%M:%S)" "$*"; }
error() { printf '%s restaurar-prueba: ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
trap 'codigo=$?; error "falló en la línea $LINENO (código $codigo): $BASH_COMMAND"; exit $codigo' ERR

snapshot=latest
muestra=50
salida="resultado-restauracion-$(date +%Y%m%d-%H%M).json"
conservar=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) snapshot=${2:?--snapshot necesita un valor}; shift 2 ;;
    --muestra) muestra=${2:?--muestra necesita un valor}; shift 2 ;;
    --salida) salida=${2:?--salida necesita un valor}; shift 2 ;;
    # Para mirar algo que falló: deja la carpeta (y el clúster detenido).
    --conservar) conservar=1; shift ;;
    *) error "opción desconocida: $1"; exit 2 ;;
  esac
done

if [[ $EUID -eq 0 ]]; then
  error "no correr como root (initdb no lo permite y no hace falta)"
  exit 1
fi

PG_BIN=${PG_BIN:-/usr/lib/postgresql/15/bin}
PAQUETE=${PAQUETE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
NODE=${NODE:-node}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/cementeria}
ADJUNTOS_DIR=${ADJUNTOS_DIR:-/var/lib/cementeria/adjuntos}

for ejecutable in "$PG_BIN/initdb" "$PG_BIN/pg_ctl" "$PG_BIN/psql" "$PG_BIN/pg_restore"; do
  if [[ ! -x "$ejecutable" ]]; then
    # psql y pg_restore pueden venir del cliente del sistema (postgresql-client).
    alternativo=$(command -v "$(basename "$ejecutable")" || true)
    if [[ "$(basename "$ejecutable")" =~ ^(psql|pg_restore)$ && -n "$alternativo" ]]; then continue; fi
    error "falta $ejecutable (PG_BIN apunta a los binarios de PostgreSQL 15)"
    exit 1
  fi
done
psql_bin=$([[ -x "$PG_BIN/psql" ]] && echo "$PG_BIN/psql" || command -v psql)
pg_restore_bin=$([[ -x "$PG_BIN/pg_restore" ]] && echo "$PG_BIN/pg_restore" || command -v pg_restore)
for archivo in "$PAQUETE/scripts/roles.sql" "$PAQUETE/scripts/verificar-restauracion.mjs" "$PAQUETE/prisma/migrations"; do
  [[ -e "$archivo" ]] || { error "falta $archivo (PAQUETE=$PAQUETE)"; exit 1; }
done
command -v restic >/dev/null || { error "falta restic"; exit 1; }
"$NODE" --version >/dev/null || { error "falta node (NODE=$NODE)"; exit 1; }

DIR=$(mktemp -d "${TMPDIR:-/var/tmp}/cementeria-restore.XXXXXX")
DATOS="$DIR/pgdata"
SOCKET="$DIR/socket"
RESTAURADO="$DIR/restic"
mkdir -m 0700 "$SOCKET" "$RESTAURADO"

destruir() {
  local codigo=$?
  if [[ -f "$DATOS/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" stop -D "$DATOS" -m fast -w >/dev/null 2>&1 || true
  fi
  if [[ $conservar -eq 1 ]]; then
    info "se conserva $DIR (--conservar): borrarlo a mano al terminar"
  else
    rm -rf -- "$DIR"
    info "instancia destruida ($DIR)"
  fi
  exit $codigo
}
trap destruir EXIT

# --- 1. restic restore --------------------------------------------------------

info "restaurando el snapshot $snapshot de $RESTIC_REPOSITORY en $RESTAURADO"
restic restore "$snapshot" --target "$RESTAURADO" \
  --include "$BACKUP_DIR/cementeria.dump" --include "$BACKUP_DIR/cementeria.dump.info" --include "$ADJUNTOS_DIR"
id_snapshot=$(restic snapshots --json "$snapshot" | grep -o '"short_id":"[0-9a-f]*"' | head -1 | cut -d'"' -f4 || true)
DUMP="$RESTAURADO$BACKUP_DIR/cementeria.dump"
ADJUNTOS="$RESTAURADO$ADJUNTOS_DIR"
[[ -f "$DUMP" ]] || { error "el snapshot no tiene $BACKUP_DIR/cementeria.dump"; exit 1; }
[[ -d "$ADJUNTOS" ]] || { error "el snapshot no tiene $ADJUNTOS_DIR"; exit 1; }
if [[ -f "$DUMP.info" ]]; then
  esperado=$(grep '^sha256=' "$DUMP.info" | cut -d= -f2)
  if [[ -n "$esperado" && "$(sha256sum -- "$DUMP" | cut -d' ' -f1)" != "$esperado" ]]; then
    error "el sha256 del dump no coincide con el que anotó backup.sh"
    exit 1
  fi
  info "dump del $(grep '^fecha=' "$DUMP.info" | cut -d= -f2), sha256 verificado"
fi

# --- 2. Clúster efímero, sin TCP ----------------------------------------------

info "creando el clúster en $DATOS"
"$PG_BIN/initdb" --pgdata="$DATOS" --username=postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >"$DIR/initdb.log"
"$PG_BIN/pg_ctl" start -D "$DATOS" -l "$DIR/postgres.log" -w -t 60 \
  -o "-c listen_addresses='' -c unix_socket_directories='$SOCKET' -c port=5432 -c log_statement=ddl"
# trust es seguro acá solo porque el único acceso es el socket en una carpeta
# 0700 de este usuario: listen_addresses='' no abre ningún puerto.

export PGHOST="$SOCKET" PGPORT=5432 PGUSER=postgres
unset PGPASSWORD PGPASSFILE PGSERVICE
psql_() { "$psql_bin" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"; }

# --- 3. Roles, antes que nada -------------------------------------------------

info "scripts/roles.sql"
psql_ -d postgres -f "$PAQUETE/scripts/roles.sql" >/dev/null

# --- 4. Base y pg_restore completo --------------------------------------------

info "creando la base cementeria y restaurando el dump"
psql_ -d postgres <<'SQL'
CREATE DATABASE cementeria OWNER cementeria_owner ENCODING 'UTF8' TEMPLATE template0;
ALTER DATABASE cementeria SET timezone TO 'America/Argentina/Tucuman';
REVOKE ALL ON DATABASE cementeria FROM PUBLIC;
GRANT CONNECT ON DATABASE cementeria TO cementeria_app, cementeria_deploy;
SQL
# Como superusuario y sin --no-owner: los dueños del dump (cementeria_owner)
# se conservan, y eso es justamente lo que se verifica después.
"$pg_restore_bin" --dbname=cementeria --exit-on-error --no-password "$DUMP"

# --- 5. Verificación -----------------------------------------------------------

info "verificando"
# Con `|| resultado=$?` una verificación que falla no dispara el trap ERR: se
# informa abajo y la instancia se destruye igual.
resultado=0
PGDATABASE=cementeria "$NODE" "$PAQUETE/scripts/verificar-restauracion.mjs" verificar \
  --dump "$DUMP" --pg-restore "$pg_restore_bin" --adjuntos "$ADJUNTOS" \
  --migraciones "$PAQUETE/prisma/migrations" --muestra "$muestra" \
  ${id_snapshot:+--snapshot "$id_snapshot"} --salida "$salida" || resultado=$?

if [[ $resultado -eq 0 ]]; then
  info "restauración VERIFICADA. Registrarla en producción (ver el encabezado de este script). Resultado: $salida"
else
  error "la verificación FALLÓ (código $resultado). Detalle: $salida"
fi
exit $resultado
