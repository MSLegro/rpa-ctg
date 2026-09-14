#!/usr/bin/env bash
# ==============================================================================
# install.sh — Script de instalación y aprovisionamiento para Debian
# ==============================================================================
# Despliega los servicios de sincronización resiliente, watchers y watchdog
# para el bot RPA CTG.
# ==============================================================================

set -o errexit
set -o nounset
set -o pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "❌ Este script debe ejecutarse como root (o con sudo)." >&2
    exit 1
fi

BASE_DIR="${1:-${RPA_DIR:-/home/rpatic/Documentos/projects/rpa-ctg}}"
USER_NAME="rpatic"

echo "================================================================="
echo "⚙️  Iniciando instalación del entorno de resiliencia RPA CTG"
echo "================================================================="

# 1. Instalar paquetes de sistema requeridos
echo "📦 1/5 Verificando e instalando dependencias APT..."
apt-get update -qq
apt-get install -y -qq cifs-utils rsync inotify-tools curl netcat-openbsd

# 2. Creación de directorios y permisos
echo "📁 2/5 Creando directorios del sistema..."
mkdir -p /mnt/Monitoreo_Fetal
mkdir -p /home/rpatic/Monitoreo_Fetal_local
mkdir -p /home/rpatic/.rpa-ctg
mkdir -p /var/log/rpa-ctg

chown -R ${USER_NAME}:${USER_NAME} /home/rpatic/Monitoreo_Fetal_local
chown -R ${USER_NAME}:${USER_NAME} /home/rpatic/.rpa-ctg
chown -R ${USER_NAME}:${USER_NAME} /var/log/rpa-ctg
chmod -R 775 /var/log/rpa-ctg

# 3. Permisos de ejecución a scripts
echo "🔑 3/5 Configurando permisos de scripts..."
chmod +x ${BASE_DIR}/infrastructure/sync/sync-ctg.sh
chmod +x ${BASE_DIR}/infrastructure/sync/sync-ctg-watcher.sh
chmod +x ${BASE_DIR}/infrastructure/watchdog/watchdog-ctg.sh

# 4. Instalación de Unidades Systemd
echo "🚀 4/5 Registrando unidades systemd..."
cp ${BASE_DIR}/infrastructure/systemd/*.service /etc/systemd/system/
cp ${BASE_DIR}/infrastructure/systemd/*.timer /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now ctg-sync-watcher.service
systemctl enable --now ctg-sync-sweep.timer
systemctl enable --now ctg-watchdog.timer

# 5. Resumen de estado
echo "✅ 5/5 Verificando estado de los servicios..."
echo "--- ctg-sync-watcher ---"
systemctl is-active ctg-sync-watcher.service || true
echo "--- ctg-sync-sweep.timer ---"
systemctl is-active ctg-sync-sweep.timer || true
echo "--- ctg-watchdog.timer ---"
systemctl is-active ctg-watchdog.timer || true

echo "================================================================="
echo "🎉 ¡Instalación completada con éxito!"
echo "================================================================="
echo "📌 Pasos finales del administrador:"
echo " 1. Configurar credenciales SMB en /etc/cifs-credentials-ctg (chmod 600)"
echo " 2. Añadir la entrada en /etc/fstab según 'infrastructure/cifs/fstab-entry.example'"
echo " 3. Ejecutar 'mount -a' o reiniciar el demonio systemd-automount"
echo " 4. Configurar WEBHOOK_URL en ${BASE_DIR}/.env si se desean alertas"
echo "================================================================="
