#!/usr/bin/env bash
# Instala una versión de CementerIA en el servidor (docs/despliegue.md,
# "Primer despliegue" y "Actualizaciones"). Lo corre el responsable con sudo:
#
#   sudo bash desplegar.sh <cementeria-VERSIÓN.tar.gz> [--instancia produccion|staging] [--sin-migraciones]
#   sudo bash desplegar.sh --volver [--instancia produccion|staging]
#
# Pasos (propuesta, sección 6, "Despliegue sin npm en el servidor"):
#   1. controla el sha256 (si está el .sha256 al lado) y que el paquete sea para Linux;
#   2. lo descomprime en <base>/releases/<versión>, de root y de solo lectura
#      para el servicio;
#   3. corre `prisma migrate deploy` con el rol cementeria_deploy. La clave se
#      pide por teclado, vive solo en el entorno de ese proceso y no se escribe
#      en ningún archivo (sección 2: su credencial no queda en el servidor);
#   4. apunta <base>/actual a la versión nueva (el enlace anterior queda en
#      <base>/anterior), reinicia el servicio y espera /api/salud 200;
#   5. deja las últimas 5 versiones y borra las demás.
#
# --volver apunta `actual` a `anterior` y reinicia: es el rollback del CÓDIGO.
# Las migraciones no se deshacen (Prisma no tiene "down"); ver docs/despliegue.md,
# "Rollback".

set -Eeuo pipefail
umask 022

info() { printf '» %s\n' "$*"; }
error() { printf 'ERROR: %s\n' "$*" >&2; }
trap 'codigo=$?; error "falló en la línea $LINENO (código $codigo): $BASH_COMMAND"; exit $codigo' ERR

instancia=produccion
migrar=1
volver=0
tarball=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instancia) instancia=${2:?--instancia necesita un valor}; shift 2 ;;
    --sin-migraciones) migrar=0; shift ;;
    --volver) volver=1; shift ;;
    -*) error "opción desconocida: $1"; exit 2 ;;
    *) tarball=$1; shift ;;
  esac
done

case "$instancia" in
  produccion) servicio=cementeria; puerto=3010 ;;
  staging) servicio=cementeria-staging; puerto=3011 ;;
  *) error "--instancia tiene que ser produccion o staging"; exit 2 ;;
esac
base=/opt/$servicio
entorno=/etc/$servicio/cementeria.env
usuario=$servicio

[[ $EUID -eq 0 ]] || { error "correr con sudo"; exit 1; }

esperar_salud() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$puerto/api/salud" >/dev/null 2>&1; then
      info "/api/salud responde 200: $(curl -sS --max-time 3 "http://127.0.0.1:$puerto/api/salud")"
      return 0
    fi
    sleep 1
  done
  error "/api/salud no respondió 200 en 30 s. Mirar: journalctl -u $servicio -n 50"
  return 1
}

if [[ $volver -eq 1 ]]; then
  [[ -L "$base/anterior" ]] || { error "no hay versión anterior en $base/anterior"; exit 1; }
  destino=$(readlink "$base/anterior")
  actual=$(readlink "$base/actual")
  info "volviendo de $(basename "$actual") a $(basename "$destino")"
  ln -sfn "$destino" "$base/actual.nuevo" && mv -Tf "$base/actual.nuevo" "$base/actual"
  ln -sfn "$actual" "$base/anterior.nuevo" && mv -Tf "$base/anterior.nuevo" "$base/anterior"
  systemctl restart "$servicio"
  esperar_salud
  info "listo: corriendo $(basename "$destino")"
  exit 0
fi

[[ -n "$tarball" && -f "$tarball" ]] || { error "falta el paquete (.tar.gz)"; exit 2; }
[[ -f "$entorno" ]] || { error "falta $entorno (docs/despliegue.md, \"Variables de entorno\")"; exit 1; }
id "$usuario" >/dev/null 2>&1 || { error "no existe el usuario $usuario"; exit 1; }
command -v node >/dev/null || { error "falta node"; exit 1; }

# --- 1. Controles del paquete ---------------------------------------------------

if [[ -f "$tarball.sha256" ]]; then
  (cd "$(dirname "$tarball")" && sha256sum --check --quiet "$(basename "$tarball").sha256")
  info "sha256 verificado"
else
  info "sin $tarball.sha256: no se verifica la integridad"
fi
# El nombre de la carpeta de adentro es el del archivo (lo arma npm run
# empaquetar). Listar el tar con `| head` cortaría el pipe y, con pipefail,
# daría error.
nombre=$(basename "$tarball" .tar.gz)
[[ "$nombre" =~ ^cementeria-[0-9A-Za-z.-]+$ ]] || { error "el paquete no tiene la forma esperada ($nombre)"; exit 1; }
releases="$base/releases"
nueva="$releases/$nombre"
[[ ! -e "$nueva" ]] || { error "$nueva ya existe (¿la misma versión?). Para reinstalarla, borrarla primero."; exit 1; }

# --- 2. Descomprimir ----------------------------------------------------------------

install -d -o root -g root -m 0755 "$base" "$releases"
info "descomprimiendo en $nueva"
tar -xzf "$tarball" -C "$releases" --no-same-owner --no-same-permissions
[[ -f "$nueva/server.js" ]] || { error "el paquete no trae $nombre/server.js"; exit 1; }
# El código es de root y el servicio solo lo lee: si la app quedara
# comprometida, no puede modificarse a sí misma.
chown -R root:root "$nueva"
chmod -R u=rwX,go=rX "$nueva"
destino_paquete=$(grep -o '"destino": *"[^"]*"' "$nueva/paquete.json" | cut -d'"' -f4)
if [[ "$destino_paquete" != "linux-x64" ]]; then
  rm -rf -- "$nueva"
  error "el paquete es para $destino_paquete, no para este servidor (npm run empaquetar sin --destino local)"
  exit 1
fi
motor=$(grep -o '"motorMigraciones": *"[^"]*"' "$nueva/paquete.json" | cut -d'"' -f4)
chmod 0755 "$nueva/node_modules/@prisma/engines/$motor"
# La caché de Next va fuera del código (CacheDirectory= de la unidad).
rm -rf -- "$nueva/.next/cache"
ln -s "/var/cache/$servicio" "$nueva/.next/cache"
info "versión $(cat "$nueva/VERSION")"

# --- 3. Migraciones con cementeria_deploy ---------------------------------------

if [[ $migrar -eq 1 ]]; then
  # Host, puerto y base salen de DATABASE_URL; usuario y clave son los de deploy.
  url_app=$(grep -E '^DATABASE_URL=' "$entorno" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
  [[ -n "$url_app" ]] || { error "no hay DATABASE_URL en $entorno"; exit 1; }
  read -rsp "Clave de cementeria_deploy (no se muestra ni se guarda): " clave
  echo
  # La URL se arma en node leyendo de la entrada estándar: la clave no pasa por
  # la línea de comandos (que ve cualquiera con ps).
  MIGRATE_DATABASE_URL=$(printf '%s\n%s' "$url_app" "$clave" | node -e '
    const [app, clave] = require("fs").readFileSync(0, "utf8").split("\n");
    const u = new URL(app);
    // Supabase (docs/despliegue.md, "Base en Supabase"): por el pooler el usuario
    // es <rol>.<ref> y las migraciones van por el Session pooler (5432), nunca
    // por el Transaction pooler (6543).
    const ref = decodeURIComponent(u.username).split(".").slice(1).join(".");
    u.username = ref ? "cementeria_deploy." + ref : "cementeria_deploy";
    if (/\.pooler\.supabase\.com$/i.test(u.hostname) && u.port === "6543") u.port = "5432";
    u.password = encodeURIComponent(clave);
    process.stdout.write(u.toString());
  ')
  unset clave
  export MIGRATE_DATABASE_URL
  # Supabase: el certificado raíz para que el motor de migraciones verifique al
  # servidor (deploy/prisma.config.mjs). Tiene que poder leerlo nobody (0644).
  ca_db=$(grep -E '^DATABASE_CA_FILE=' "$entorno" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
  if [[ -n "$ca_db" ]]; then export DATABASE_CA_FILE="$ca_db"; fi
  info "prisma migrate deploy"
  # Como `nobody`: ni root ni el usuario del servicio corren la CLI con la
  # credencial de deploy. Lee el paquete (es legible por todos) y nada más.
  # Sin --login, runuser conserva el entorno (salvo HOME, USER y SHELL).
  (cd "$nueva" && runuser -u nobody -- \
    env HOME=/tmp CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    node node_modules/prisma/build/index.js migrate deploy)
  unset MIGRATE_DATABASE_URL DATABASE_CA_FILE
else
  info "sin migraciones (--sin-migraciones)"
fi

# --- 4. Cambio de versión ------------------------------------------------------------

anterior=""
if [[ -L "$base/actual" ]]; then
  anterior=$(readlink "$base/actual")
  ln -sfn "$anterior" "$base/anterior.nuevo" && mv -Tf "$base/anterior.nuevo" "$base/anterior"
fi
ln -sfn "$nueva" "$base/actual.nuevo" && mv -Tf "$base/actual.nuevo" "$base/actual"
info "reiniciando $servicio"
systemctl restart "$servicio"
if ! esperar_salud; then
  [[ -n "$anterior" ]] && error "para volver a la versión anterior: sudo bash $0 --volver --instancia $instancia"
  exit 1
fi

# --- 5. Limpieza: las últimas 5 versiones --------------------------------------------

mapfile -t viejas < <(ls -1dt "$releases"/cementeria-* | tail -n +6)
for v in "${viejas[@]}"; do
  [[ "$v" == "$(readlink "$base/actual")" || "$v" == "$(readlink "$base/anterior" 2>/dev/null || true)" ]] && continue
  rm -rf -- "$v"
  info "borrada la versión vieja $(basename "$v")"
done

info "listo: $instancia corre $(cat "$base/actual/VERSION")"
