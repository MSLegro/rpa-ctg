import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export default class AdminPaciente {
  // La tabla vive dentro de un iframe
  iframeLocator = '#_dmwFrame';
  tableSelector = 'table[id*="SortableTable"]';

  // Selectores del paginador ExtJS (se prueban en orden)
  nextPageSelectors = [
    'img[title="Página siguiente"]',
    'a[title="Página siguiente"]',
    'img[title*="Next"]',
    'img[alt*="Next"]',
    'img[title*="Siguiente"]',
    'img[alt*="Siguiente"]',
    'a[title*="Next"]',
    'a[title*="Siguiente"]',
    '.x-tbar-page-next',
    '.x-paging-toolbar button[title*="Next"]',
    '.x-paging-toolbar button[title*="Siguiente"]',
  ];

  constructor(page) {
    this.page = page;
  }

  async goAdminPacientes() {
    console.log('[AdminPaciente] Buscando botón de admin pacientes...');

    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 10000 }),
      this.page.locator('#dataMgmtBtn').click()
    ]);

    await newPage.waitForLoadState();

    // Actualizar this.page a la nueva página
    this.page = newPage;

    console.log('[AdminPaciente] Nueva página abierta:', this.page.url());

    return this.page;
  }

  async clickArchiveButton() {
    console.log('[AdminPaciente] Click en botón CTG Archive...');

    await this.page.locator('#ctgArchiveBtn').click();

    // Esperar a que el iframe recargue con el contenido del archive
    const frame = this.page.frameLocator(this.iframeLocator);
    await frame.locator(this.tableSelector).waitFor({ timeout: 15000 });
    console.log('[AdminPaciente] CTG Archive loaded en iframe');
  }

  /**
   * Descarga todos los PDFs de TODAS las páginas del paginador.
   * Nombra cada archivo como: {ID}_{fecha}.pdf
   * Idempotente: saltea archivos que ya existen.
   * @param {string} outputDir - Directorio donde guardar los PDFs
   */
  async downloadAllPdfs(outputDir) {
    mkdirSync(outputDir, { recursive: true });

    let currentPage = 1;
    let totalDownloaded = 0;
    let totalSkipped = 0;

    while (true) {
      console.log(`\n[AdminPaciente] === Página ${currentPage} ===`);

      const { downloaded, skipped } = await this.#downloadCurrentPage(outputDir);
      totalDownloaded += downloaded;
      totalSkipped += skipped;

      // Intentar ir a la siguiente página
      const hasNext = await this.#goToNextPage();
      if (!hasNext) {
        console.log(`\n[AdminPaciente] No hay más páginas`);
        break;
      }

      currentPage++;
    }

    console.log(`\n[AdminPaciente] Descarga completa: ${totalDownloaded} nuevos, ${totalSkipped} ya existentes`);
  }

  /**
   * Descarga los PDFs de la página actual de la tabla.
   * @returns {{ downloaded: number, skipped: number }}
   */
  async #downloadCurrentPage(outputDir) {
    let downloaded = 0;
    let skipped = 0;

    const frame = this.page.frameLocator(this.iframeLocator);
    const rows = frame.locator(`${this.tableSelector} tbody tr`);
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const cells = row.locator('td');

      // Extraer fecha (col 2) e ID (col 7)
      const dateText = (await cells.nth(1).innerText()).trim();
      const idText = (await cells.nth(6).innerText()).trim();

      // Saltar la fila del header
      if (dateText === 'Inicio' || idText === 'No. de ID' || idText === '') {
        continue;
      }

      // Sanitizar fecha: "24/04/26 10:35 AM" → "24-04-26-10-35-AM"
      const sanitizedDate = dateText.replace(/[\/\s:]/g, '-');
      const outputPath = join(outputDir, idText, `${sanitizedDate}.pdf`);

      // Idempotencia: si ya existe, saltar
      if (existsSync(outputPath)) {
        console.log(`  ⏭️  Ya existe: ${idText}/${sanitizedDate}.pdf`);
        skipped++;
        continue;
      }

      console.log(`  ⬇️  Descargando: ${idText}/${sanitizedDate}.pdf`);

      // Obtener la URL del link PDF
      const pdfLink = row.locator('a[title*="versión de impresión (PDF)"]');
      const href = await pdfLink.getAttribute('href');
      const pdfUrl = `https://172.16.1.75${href}`;

      // Descargar el PDF como base64 desde el contexto del browser
      const base64 = await this.page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'include' });
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }, pdfUrl);

      const buffer = Buffer.from(base64.split(',')[1], 'base64');
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, buffer);

      console.log(`  ✅ Guardado: ${idText}/${sanitizedDate}.pdf`);
      downloaded++;
    }

    return { downloaded, skipped };
  }

  /**
   * Intenta ir a la siguiente página del paginador.
   * @returns {boolean} true si pudo avanzar, false si no hay más páginas
   */
  async #goToNextPage() {
    const frame = this.page.frameLocator(this.iframeLocator);

    // Probar cada selector hasta encontrar el botón "next"
    for (const selector of this.nextPageSelectors) {
      const btn = frame.locator(selector);
      const isVisible = await btn.isVisible().catch(() => false);

      if (isVisible) {
        // Verificar que no esté disabled
        const isDisabled = await btn.getAttribute('disabled').catch(() => null) !== null;
        const isOpacityDisabled = await btn.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.opacity === '0.5' || style.opacity === '0.3';
        }).catch(() => false);

        if (isDisabled || isOpacityDisabled) {
          console.log('[AdminPaciente] Botón "Siguiente" deshabilitado — última página');
          return false;
        }

        console.log(`[AdminPaciente] Click en "Siguiente" (selector: ${selector})`);
        await btn.click();

        // Esperar a que la tabla se recargue en el iframe
        await frame.locator(this.tableSelector).waitFor({ timeout: 10000 });
        // Pequeña pausa para asegurar que el contenido esté listo
        await this.page.waitForTimeout(500);

        return true;
      }
    }

    // Ningún selector encontró el botón — asumimos última página
    console.log('[AdminPaciente] No se encontró botón "Siguiente" — última página');
    return false;
  }
}
