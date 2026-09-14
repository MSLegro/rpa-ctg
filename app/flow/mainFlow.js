import BrowserManager from '../../infrastructure/Playwright/Browser/Browser.manage.js';
import loginFlow from "./loginFlow.js";
import adminPacientFlow from './adminPacientFlow.js';

function printHeader(title) {
  const line = '='.repeat(78);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}`);
}

export default async function mainFlow(profilePath) {
  const startTime = Date.now();
  const isWindows = process.platform === 'win32';
  const baseUrl = process.env.APP_BASE_URL || 'https://172.16.1.75';
  const browserChannel = process.env.BROWSER_CHANNEL || 'chrome';
  const isHeadless = process.env.HEADLESS !== 'false';
  const maxPages = process.env.MAX_PAGES ? `${process.env.MAX_PAGES} páginas` : 'Sin límite (Early Stopping)';
  const earlyStopPages = process.env.MAX_CONSECUTIVE_SKIPPED_PAGES || '2';
  const concurrency = process.env.CONCURRENT_DOWNLOADS || '3';

  // 1. LOG DE ESTADO INICIAL (CONDICIONES DE ARRANQUE)
  printHeader('RPA CTG — ESTADO INICIAL DE EJECUCIÓN');
  console.log(`• Fecha / Hora:           ${new Date().toLocaleString()}`);
  console.log(`• Plataforma OS:          ${process.platform} (${isWindows ? 'Desarrollo / Windows' : 'Producción / Debian'})`);
  console.log(`• Node.js:                ${process.version} (PID: ${process.pid})`);
  console.log(`• URL Plataforma:         ${baseUrl}`);
  console.log(`• Modo Navegador:         Canal: ${browserChannel} | Headless: ${isHeadless}`);
  console.log(`• Perfil Navegador:       ${profilePath}`);
  console.log(`• Concurrencia Descargas: ${concurrency} simultáneas`);
  console.log(`• Límite Páginas:         ${maxPages}`);
  console.log(`• Parada Temprana:        ${earlyStopPages} páginas consecutivas sin novedades`);
  console.log('='.repeat(78) + '\n');

  const browser = new BrowserManager(profilePath);
  let report = null;
  let status = 'EXITOSO';
  let failureReason = null;

  try {
    console.log('[mainFlow] Iniciando browser...');
    await browser.start();
    const page = await browser.newPage();

    console.log('[mainFlow] Ejecutando login...');
    await loginFlow(page);

    console.log('[mainFlow] Ejecutando admin pacientes...');
    report = await adminPacientFlow(page);
  } catch (error) {
    status = 'FALLIDO';
    failureReason = error.message;
    console.error(`[mainFlow] Error fatal durante la ejecución: ${error.message}`);
    throw error;
  } finally {
    console.log('[mainFlow] Cerrando browser...');
    await browser.close();

    // 2. REPORTE FINAL DE RESULTADOS Y MÉTRICAS
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

    printHeader('RPA CTG — REPORTE FINAL DE RESULTADOS');
    console.log(`• Estado Final:           ${status === 'EXITOSO' ? '✅ COMPLETADO EXITOSAMENTE' : '❌ TERMINÓ CON ERRORES'}`);
    if (failureReason) {
      console.log(`• Causa de Falla:         ${failureReason}`);
    }
    console.log(`• Duración Total:         ${durationSec}s`);
    if (report) {
      console.log(`• Páginas Procesadas:     ${report.pagesProcessed}`);
      console.log(`• PDFs Nuevos Descargados:${report.downloaded}`);
      console.log(`• PDFs Saltados (Previos):${report.skipped}`);
      console.log(`• Errores en Descarga:    ${report.errors}`);
      console.log(`• Parada Temprana:        ${report.earlyStopped ? `Sí (${report.earlyStopReason})` : 'No (Fin del archivo)'}`);
      console.log(`• Registros en Manifiesto:${report.manifestCount} estudios indexados`);
      console.log(`• Directorio Destino:     ${report.localOutputDir}`);
      if (report.remoteOutputDir) {
        console.log(`• Directorio Compartido:  ${report.remoteOutputDir}`);
      }
    }
    console.log('='.repeat(78) + '\n');
  }
}