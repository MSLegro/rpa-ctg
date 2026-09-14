import { fileURLToPath } from 'url';
import { dirname } from 'path';
import AdminPaciente from "../../infrastructure/Playwright/pages/adminPaciente.page.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async function adminPacientFlow(page) {
  const adminPacientPage = new AdminPaciente(page)

  // Ir a admin pacientes (actualiza this.page internamente)
  await adminPacientPage.goAdminPacientes()

  // Click en CTG Archive (navega en la misma página, espera la tabla)
  await adminPacientPage.clickArchiveButton()

  // Directorio de output seguro en disco local ext4
  const localOutputDir = process.env.OUTPUT_DIR || process.env.OUTPUT_DIR_LOCAL || (
    process.platform === 'win32' ? 'Z:\\' : `${process.env.HOME}/Monitoreo_Fetal_local`
  );

  // Directorio remoto de destino (para verificación de idempotencia histórica si está montado)
  const remoteOutputDir = process.env.OUTPUT_DIR_REMOTE || (
    process.platform === 'win32' ? 'Z:\\' : '/mnt/Monitoreo_Fetal'
  );

  console.log(`[adminPacientFlow] Directorio de guardado local: ${localOutputDir}`);

  // Descargar todos los PDFs (con paginación, escritura atómica y doble idempotencia)
  await adminPacientPage.downloadAllPdfs(localOutputDir, { remoteDir: remoteOutputDir });

  return adminPacientPage.page;
}
