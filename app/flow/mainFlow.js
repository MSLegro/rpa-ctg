import BrowserManager from '../../infrastructure/Playwright/Browser/Browser.manage.js'
import loginFlow from "./loginFlow.js";
import adminPacientFlow from './adminPacientFlow.js';

export default async function mainFlow(profilePath) {
  const browser = new BrowserManager(profilePath)

  try {
    console.log('[mainFlow] Iniciando browser...');
    await browser.start()
    const page = await browser.newPage()

    console.log('[mainFlow] Ejecutando login...');
    await loginFlow(page)

    console.log('[mainFlow] Ejecutando admin pacientes...');
    await adminPacientFlow(page)

    console.log('[mainFlow] Flujo completado exitosamente');
  } catch (error) {
    console.error(`[mainFlow] Error: ${error.message}`);
    throw error;
  } finally {
    console.log('[mainFlow] Cerrando browser...');
    await browser.close();
  }
}