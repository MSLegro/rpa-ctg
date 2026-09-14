#!/usr/bin/env bash
# ==============================================================================
# sync-ctg-watcher.sh — Demonio reactivo inotifywait con Debounce
# ==============================================================================
# Escucha eventos de kernel (close_write, moved_to) en el directorio local
# y dispara sync-ctg.sh con agregación por ráfagas (evita tormentas de procesos).
# ==============================================================================

set -o errexit
set -o nounset
set -o pipefail

SRC_DIR="${OUTPUT_DIR_LOCAL:-/home/rpatic/Monitoreo_Fetal_local}"
SYNC_SCRIPT="${SYNC_SCRIPT_PATH:-/home/rpatic/Documentos/projects/rpa-ctg/infrastructure/sync/sync-ctg.sh}"
DEBOUNCE_SECONDS=7

# Verificar dependencias
if ! command -v inotifywait >/dev/null 2>&1; then
    echo "ERROR: inotifywait no está instalado. Ejecute: apt-get install inotify-tools" >&2
    exit 1
fi

mkdir -p "$SRC_DIR"

echo "[sync-ctg-watcher] Iniciando observador inotify en '$SRC_DIR' con debounce de ${DEBOUNCE_SECONDS}s..."

# inotifywait escuchando recursivamente (-r), en modo monitor continuo (-m)
# Filtra únicamente archivos terminados en .pdf y eventos de escritura terminada o archivo movido/renombrado
inotifywait -m -r -e close_write,moved_to --include '.*\.pdf$' --format '%w%f' "$SRC_DIR" | while read -r FILE; do
    echo "[sync-ctg-watcher] Evento detectado en: $FILE"
    
    # Ventana de Debounce: leer y descartar eventos que ocurran en los siguientes X segundos
    while read -t "$DEBOUNCE_SECONDS" -r MORE_FILES; do
        echo "[sync-ctg-watcher] Ráfaga activa: agrupando evento en $MORE_FILES"
    done
    
    echo "[sync-ctg-watcher] Periodo de calma alcanzado. Disparando sincronización..."
    /usr/bin/env bash "$SYNC_SCRIPT" || true
done
