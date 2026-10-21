#!/usr/bin/env bash
# Backup nocturno de CementerIA (docs/propuesta-mvp.md, sección 6, "Backups";
# docs/pedidos-dia-1.md, A7; docs/despliegue.md, "Backups").
#
# Lo corre cementeria-backup.service (timer de las 02:00) como el usuario
# cementeria-backup, con la configuración de /etc/cementeria/backup.env:
#
#   1. pg_dump -Fc de la base a BACKUP_DIR, y control de que el dump se lee;
#   2. DESPUÉS del dump, un snapshot de restic (cifrado, al servidor de backup
#      de Sistemas) con el dump y la carpeta de adjuntos. Como los adjuntos
#      solo se agregan, los que se copian después del dump cubren todo lo que
#      el dump referencia;
#   3. la retención: RETENCION_DIARIAS copias diarias y RETENCION_MENSUALES
#      mensuales (30 y 12 por defecto, a confirmar con Asesoría Legal);
#   4. borra el dump local: los datos personales quedan solo en restic.
#
# Todo lo que escribe va a journald (journalctl -u cementeria-backup), con la
# prioridad al principio de la línea (<6> info, <3> error). Ante cualquier
# falla sale con código distinto de 0 y la unidad queda "failed"
# (systemctl --failed lo muestra).
#
# Variables (las secretas, marcadas):
#   PGHOST, PGPORT, PGUSER        conexión de libpq para pg_dump
#   PGPASSWORD (secreta)          o PGPASSFILE con un .pgpass 0600
#   PGDATABASE                    por defecto cementeria
#   RESTIC_REPOSITORY             p. ej. sftp:cementeria@<SERVIDOR_BACKUP>:/backups/cementeria
#   RESTIC_PASSWORD (secreta)     o RESTIC_PASSWORD_FILE; la clave de cifrado
#                                 (su custodia está fuera del servidor de backup)
#   BACKUP_DIR                    dónde queda el dump mientras se sube
#                                 (por defecto /var/backups/cementeria)
#   ADJUNTOS_DIR                  por defecto /var/lib/cementeria/adjuntos
#   RETENCION_DIARIAS             por defecto 30
#   RETENCION_MENSUALES           por defecto 12
#   RETENCION_EN_ESTE_SERVIDOR    1 (por defecto): `restic forget --prune` acá.
#                                 0 si el repositorio es append-only y la
#                                 retención la aplica Sistemas del otro lado.
#   BACKUP_ETIQUETA               etiqueta de los snapshots (por defecto cementeria)

# Sin -E: el trap ERR no se hereda en las $(...) y cada falla se informa una sola vez.
set -euo pipefail
umask 077

info() { printf '<6>backup: %s\n' "$*"; }
error() { printf '<3>backup: %s\n' "$*" >&2; }

# Cualquier comando que falle corta el script (set -e) y deja dicho dónde.
trap 'codigo=$?; error "falló en la línea $LINENO (código $codigo): $BASH_COMMAND"; exit $codigo' ERR

PGDATABASE=${PGDATABASE:-cementeria}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/cementeria}
ADJUNTOS_DIR=${ADJUNTOS_DIR:-/var/lib/cementeria/adjuntos}
RETENCION_DIARIAS=${RETENCION_DIARIAS:-30}
RETENCION_MENSUALES=${RETENCION_MENSUALES:-12}
RETENCION_EN_ESTE_SERVIDOR=${RETENCION_EN_ESTE_SERVIDOR:-1}
BACKUP_ETIQUETA=${BACKUP_ETIQUETA:-cementeria}
export PGDATABASE

# --- Controles previos ------------------------------------------------------

for comando in pg_dump pg_restore restic flock sha256sum; do
  if ! command -v "$comando" >/dev/null; then
    error "falta el comando $comando (ver docs/despliegue.md, \"Requisitos del servidor\")"
    exit 1
  fi
done
for n in "$RETENCION_DIARIAS" "$RETENCION_MENSUALES"; do
  if ! [[ "$n" =~ ^[1-9][0-9]*$ ]]; then
    error "RETENCION_DIARIAS y RETENCION_MENSUALES tienen que ser enteros de 1 o más"
    exit 1
  fi
done
if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
  error "falta RESTIC_REPOSITORY"
  exit 1
fi
if [[ -z "${RESTIC_PASSWORD:-}" && -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
  error "falta RESTIC_PASSWORD o RESTIC_PASSWORD_FILE"
  exit 1
fi
if [[ ! -d "$ADJUNTOS_DIR" || ! -r "$ADJUNTOS_DIR" || ! -x "$ADJUNTOS_DIR" ]]; then
  error "no se puede leer la carpeta de adjuntos $ADJUNTOS_DIR (¿el usuario está en el grupo cementeria?)"
  exit 1
fi
if [[ ! -d "$BACKUP_DIR" || ! -w "$BACKUP_DIR" ]]; then
  error "no se puede escribir en $BACKUP_DIR"
  exit 1
fi

# Dos corridas a la vez (el timer y una a mano) se pisarían el dump.
exec 9>"$BACKUP_DIR/.lock"
if ! flock -n 9; then
  error "hay otro backup en curso"
  exit 1
fi

DUMP="$BACKUP_DIR/cementeria.dump"
INFO="$BACKUP_DIR/cementeria.dump.info"
PARCIAL="$DUMP.parcial"

# Si algo falla, que no quede un dump a medias (ni uno entero: tiene datos
# personales y su lugar es restic).
limpiar() { rm -f -- "$PARCIAL" "$DUMP" "$INFO"; }
trap limpiar EXIT

# --- 1. Dump ----------------------------------------------------------------

info "pg_dump de $PGDATABASE en ${PGHOST:-socket local}"
inicio=$(date +%s)
# --lock-wait-timeout: si una migración tiene tomada una tabla, mejor fallar
# (y enterarse) que esperar indefinidamente.
pg_dump --format=custom --no-password --lock-wait-timeout=120s --file="$PARCIAL" "$PGDATABASE"
mv -f -- "$PARCIAL" "$DUMP"

# Un dump truncado no se puede listar. Y uno sin datos no sirve.
tablas=$(pg_restore --list "$DUMP" | grep -c ' TABLE DATA ' || true)
if [[ "$tablas" -lt 1 ]]; then
  error "el dump no tiene datos de ninguna tabla"
  exit 1
fi
bytes=$(stat -c %s -- "$DUMP")
suma=$(sha256sum -- "$DUMP" | cut -d' ' -f1)
{
  echo "fecha=$(date --iso-8601=seconds)"
  echo "base=$PGDATABASE"
  echo "pg_dump=$(pg_dump --version)"
  echo "tablas_con_datos=$tablas"
  echo "bytes=$bytes"
  echo "sha256=$suma"
} >"$INFO"
info "dump listo: $tablas tablas, $bytes bytes, $(($(date +%s) - inicio)) s"

# --- 2. Snapshot: el dump y, después, los adjuntos ---------------------------

# tmp/ son subidas en curso o restos que el barrido diario borra: no se respaldan.
info "restic backup a $RESTIC_REPOSITORY"
salida=$(restic backup --json --tag "$BACKUP_ETIQUETA" \
  --exclude "$ADJUNTOS_DIR/tmp" \
  -- "$DUMP" "$INFO" "$ADJUNTOS_DIR")
snapshot=$(printf '%s\n' "$salida" | grep '"message_type":"summary"' | grep -o '"snapshot_id":"[0-9a-f]*"' | cut -d'"' -f4 || true)
if [[ -z "$snapshot" ]]; then
  error "restic no informó el snapshot creado"
  exit 1
fi
info "snapshot $snapshot creado"

# --- 3. Retención -----------------------------------------------------------

if [[ "$RETENCION_EN_ESTE_SERVIDOR" == "1" ]]; then
  info "retención: $RETENCION_DIARIAS diarias y $RETENCION_MENSUALES mensuales"
  restic forget --tag "$BACKUP_ETIQUETA" --group-by host,tags \
    --keep-daily "$RETENCION_DIARIAS" --keep-monthly "$RETENCION_MENSUALES" --prune
else
  info "retención a cargo del servidor de backup (RETENCION_EN_ESTE_SERVIDOR=0)"
fi

# --- 4. Fin -----------------------------------------------------------------

# El trap EXIT borra el dump local.
info "backup terminado en $(($(date +%s) - inicio)) s (snapshot $snapshot)"
