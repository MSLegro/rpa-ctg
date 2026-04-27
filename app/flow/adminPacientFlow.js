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

  // Directorio de output: variable de entorno o default según SO
  const outputDir = process.env.OUTPUT_DIR || (
    process.platform === 'win32' ? 'Z:\\' : '/mnt/Monitoreo_Fetal'
  );

  // Descargar todos los PDFs (con paginación e idempotencia)
  await adminPacientPage.downloadAllPdfs(outputDir);

  return adminPacientPage.page;
}
