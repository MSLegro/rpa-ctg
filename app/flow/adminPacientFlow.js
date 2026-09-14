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

  // Detección de plataforma y directorio local seguro
  const isWindows = process.platform === 'win32';
  const defaultDir = isWindows ? join(process.cwd(), 'ArchivoCTG') : `${process.env.HOME}/Monitoreo_Fetal_local`;

  // En Windows: si no se define OUTPUT_DIR y OUTPUT_DIR_LOCAL tiene ruta Linux (/home/...), usar ./ArchivoCTG
  const localOutputDir = process.env.OUTPUT_DIR || (
    isWindows
      ? (process.env.OUTPUT_DIR_LOCAL && !process.env.OUTPUT_DIR_LOCAL.startsWith('/home/') ? process.env.OUTPUT_DIR_LOCAL : defaultDir)
      : (process.env.OUTPUT_DIR_LOCAL || defaultDir)
  );

  // Directorio remoto de destino (opcional para chequear si ya fue transferido)
  const remoteOutputDir = process.env.OUTPUT_DIR_REMOTE || (
    isWindows ? null : '/mnt/Monitoreo_Fetal'
  );

  console.log(`[adminPacientFlow] Directorio de guardado local: ${localOutputDir}`);

  // Descargar todos los PDFs (con paginación, escritura atómica y doble idempotencia)
  await adminPacientPage.downloadAllPdfs(localOutputDir, { remoteDir: remoteOutputDir });

  return adminPacientPage.page;
}
