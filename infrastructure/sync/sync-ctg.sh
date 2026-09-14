#!/usr/bin/env bash
# ==============================================================================
# sync-ctg.sh — Sincronizador resiliente de archivos CTG hacia SMB Windows
# ==============================================================================
# Autor: Arquitectura RPA / Automatizaciones
# Entorno: Debian Linux (usuario rpatic)
# ==============================================================================

set -o errexit
set -o nounset
set -o pipefail

# Rutas principales (ajustables vía variables de entorno)
SRC_DIR="${OUTPUT_DIR_LOCAL:-/home/rpatic/Monitoreo_Fetal_local}"
DEST_DIR="${OUTPUT_DIR_REMOTE:-/mnt/Monitoreo_Fetal}"
LOG_FILE="${SYNC_LOG_FILE:-/var/log/rpa-ctg/sync.log}"
LOCK_FILE="/tmp/rpa-ctg-sync.lock"

# Asegurar directorios de log
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$SRC_DIR"

log_msg() {
    local level="$1"
    local msg="$2"
    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "{\"timestamp\": \"$timestamp\", \"level\": \"$level\", \"service\": \"sync-ctg\", \"message\": \"$msg\"}" | tee -a "$LOG_FILE"
}

# 1. Control de concurrencia: Evitar solapamiento de ejecuciones
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    log_msg "INFO" "Sincronización en curso por otro proceso. Abortando ejecución concurrente."
    exit 0
fi

# 2. Verificar existencia de archivos en el origen local (excluyendo temporales)
PENDING_COUNT=$(find "$SRC_DIR" -type f -name "*.pdf" ! -name "*.tmp*" | wc -l)
if [ "$PENDING_COUNT" -eq 0 ]; then
    # No hay nada que transferir
    exit 0
fi

log_msg "INFO" "Iniciando ciclo de sincronización. Archivos pendientes en origen: $PENDING_COUNT"

# 3. Comprobación del Punto de Montaje SMB
# Forzar acceso para despertar x-systemd.automount
timeout 5 stat "$DEST_DIR" >/dev/null 2>&1 || true

if ! mountpoint -q "$DEST_DIR"; then
    log_msg "WARN" "El destino '$DEST_DIR' no está montado como filesystem. El servidor Windows puede estar inaccesible o apagado. Sincronización diferida."
    exit 0
fi

# 4. Prueba Canary de Escritura Rápida en Destino (evita bloqueos si CIFS está stale)
CANARY_FILE="$DEST_DIR/.canary_sync_$$"
if ! timeout 5 touch "$CANARY_FILE" >/dev/null 2>&1; then
    log_msg "ERROR" "Fallo en la prueba de escritura activa sobre '$DEST_DIR'. Recurso SMB no responde. Sincronización suspendida."
    exit 0
fi
rm -f "$CANARY_FILE" || true

# 5. Ejecutar Rsync con Verificación de Integridad por Checksum
# -a: modo archivo (recursivo, preserva atributos)
# -v: salida detallada
# --checksum: valida hash de contenido byte a byte antes de dar por válido
# --remove-source-files: BORRA del origen SOLO cuando la copia destino se verificó
# --prune-empty-dirs: no transfiere ni deja carpetas vacías
# --exclude: ignora temporales en escritura (.tmp*)
# --timeout=30: aborta sockets congelados tras 30 segundos de inactividad
START_TIME=$(date +%s)

RSYNC_OUT=$(mktemp)
if rsync -av \
    --checksum \
    --remove-source-files \
    --prune-empty-dirs \
    --exclude="*.tmp*" \
    --timeout=30 \
    "$SRC_DIR/" "$DEST_DIR/" > "$RSYNC_OUT" 2>&1; then
    
    ELAPSED=$(( $(date +%s) - START_TIME ))
    TRANSFERRED=$(grep -c "\.pdf$" "$RSYNC_OUT" || true)
    log_msg "INFO" "Sincronización completada exitosamente en ${ELAPSED}s. Archivos transferidos: $TRANSFERRED"
    
    # 6. Limpieza de directorios locales de pacientes vacíos
    find "$SRC_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
else
    RSYNC_ERR=$(head -n 5 "$RSYNC_OUT" | tr '\n' ' ')
    log_msg "ERROR" "Falla durante rsync hacia Windows: $RSYNC_ERR"
fi

rm -f "$RSYNC_OUT"
exit 0
