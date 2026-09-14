#!/usr/bin/env bash
# ==============================================================================
# watchdog-ctg.sh — Observabilidad y Detección de Represamiento en RPA CTG
# ==============================================================================
# Detecta archivos PDF en local que no han podido sincronizarse al SMB
# por más de X minutos, diagnostica la causa y emite alertas vía Webhook.
# ==============================================================================

set -o errexit
set -o nounset
set -o pipefail

SRC_DIR="${OUTPUT_DIR_LOCAL:-/home/rpatic/Monitoreo_Fetal_local}"
DEST_DIR="${OUTPUT_DIR_REMOTE:-/mnt/Monitoreo_Fetal}"
THRESHOLD_MINUTES="${WATCHDOG_THRESHOLD_MINUTES:-20}"
LOG_FILE="${WATCHDOG_LOG_FILE:-/var/log/rpa-ctg/watchdog.log}"
WEBHOOK_URL="${WEBHOOK_URL:-}"

mkdir -p "$(dirname "$LOG_FILE")"

log_event() {
    local level="$1"
    local json_payload="$2"
    local timestamp
    timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    echo "{\"timestamp\": \"$timestamp\", \"level\": \"$level\", \"service\": \"watchdog-ctg\", \"data\": $json_payload}" | tee -a "$LOG_FILE"
}

# 1. Buscar archivos con antigüedad superior al umbral
STALLED_FILES=()
while IFS= read -r line; do
    [ -n "$line" ] && STALLED_FILES+=("$line")
done < <(find "$SRC_DIR" -type f -name "*.pdf" ! -name "*.tmp*" -mmin +"$THRESHOLD_MINUTES" 2>/dev/null || true)

STALLED_COUNT=${#STALLED_FILES[@]}

# Espacio en disco local disponible
DISK_FREE=$(df -h "$SRC_DIR" | awk 'NR==2 {print $4}')

# 2. Si no hay archivos represados, emitir estado saludable
if [ "$STALLED_COUNT" -eq 0 ]; then
    log_event "INFO" "{\"status\": \"HEALTHY\", \"stalled_count\": 0, \"disk_free\": \"$DISK_FREE\"}"
    exit 0
fi

# 3. Diagnóstico de Causa Raíz
DIAGNOSTIC_REASON="UNKNOWN"
IS_MOUNTED=false
SMB_PORT_OPEN=false

# Verificar si el punto de montaje responde
if mountpoint -q "$DEST_DIR"; then
    IS_MOUNTED=true
else
    DIAGNOSTIC_REASON="CIFS_NOT_MOUNTED"
fi

# Intentar extraer host de Windows desde fstab o variable
WINDOWS_HOST=$(awk '/Monitoreo_Fetal/ {print $1}' /etc/fstab 2>/dev/null | sed -E 's|^//([^/]+)/.*|\1|' || echo "")
if [ -n "$WINDOWS_HOST" ] && command -v nc >/dev/null 2>&1; then
    if nc -z -w 3 "$WINDOWS_HOST" 445 >/dev/null 2>&1; then
        SMB_PORT_OPEN=true
    else
        DIAGNOSTIC_REASON="WINDOWS_PORT_445_UNREACHABLE"
    fi
fi

if [ "$IS_MOUNTED" = true ] && [ "$DIAGNOSTIC_REASON" = "UNKNOWN" ]; then
    DIAGNOSTIC_REASON="SYNC_ENGINE_BLOCKED_OR_SLOW"
fi

# Registrar alerta en log estructurado
ALERT_JSON=$(cat <<EOF
{
  "status": "ALERT_BACKLOG_DETECTED",
  "stalled_count": $STALLED_COUNT,
  "threshold_minutes": $THRESHOLD_MINUTES,
  "diagnostic_reason": "$DIAGNOSTIC_REASON",
  "is_mounted": $IS_MOUNTED,
  "smb_port_open": $SMB_PORT_OPEN,
  "disk_free": "$DISK_FREE",
  "sample_file": "${STALLED_FILES[0]:-none}"
}
EOF
)

log_event "CRITICAL" "$ALERT_JSON"

# 4. Notificación vía Webhook (Slack / Teams / Discord / genérico)
if [ -n "$WEBHOOK_URL" ]; then
    NOTIFICATION_PAYLOAD=$(cat <<EOF
{
  "text": "🚨 *ALERTA RPA CTG: Archivos represados en servidor Debian*",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🚨 Alerta: Falla en Sincronización RPA CTG" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Archivos represados:* ${STALLED_COUNT}" },
        { "type": "mrkdwn", "text": "*Tiempo sin subir:* > ${THRESHOLD_MINUTES} min" },
        { "type": "mrkdwn", "text": "*Causa probable:* \`${DIAGNOSTIC_REASON}\`" },
        { "type": "mrkdwn", "text": "*Montaje SMB activo:* ${IS_MOUNTED}" },
        { "type": "mrkdwn", "text": "*Espacio libre Debian:* ${DISK_FREE}" }
      ]
    }
  ]
}
EOF
)

    curl -s -X POST -H "Content-Type: application/json" \
        -d "$NOTIFICATION_PAYLOAD" \
        --max-time 10 \
        "$WEBHOOK_URL" >/dev/null 2>&1 || true
fi

exit 0
