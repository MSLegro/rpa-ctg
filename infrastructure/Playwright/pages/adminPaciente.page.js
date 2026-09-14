import { mkdirSync, writeFileSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import ManifestManager from '../../storage/ManifestManager.js';

// Caracteres inválidos en nombres de archivo de Windows: se reemplazan por "_"
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const HAS_INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/;

function sanitizeForFilename(text) {
  return text.replace(INVALID_FILENAME_CHARS, '_').trim();
}

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
   * Idempotente: saltea archivos que ya existen o están en el manifiesto local.
   * @param {string} outputDir - Directorio local donde guardar los PDFs
   * @param {Object} options - Opciones adicionales (ej. remoteDir)
   */
  async downloadAllPdfs(outputDir, options = {}) {
    mkdirSync(outputDir, { recursive: true });

    // Inicializar el gestor de manifiesto local
    this.manifest = new ManifestManager();
    this.manifest.load();

    // Si el directorio remoto está accesible, indexar archivos preexistentes
    if (options.remoteDir && existsSync(options.remoteDir)) {
      console.log(`[AdminPaciente] Sincronizando manifiesto con directorio remoto: ${options.remoteDir}`);
      this.manifest.indexExistingDirectory(options.remoteDir);
    }

    let currentPage = 1;
    let totalDownloaded = 0;
    let totalSkipped = 0;

    while (true) {
      console.log(`\n[AdminPaciente] === Página ${currentPage} ===`);

      const { downloaded, skipped } = await this.#downloadCurrentPage(outputDir, options);
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
   * Descarga los PDFs de la página actual de la tabla con escritura atómica.
   * @param {string} outputDir - Directorio de salida
   * @param {Object} options - Opciones (ej. remoteDir)
   * @returns {{ downloaded: number, skipped: number }}
   */
  async #downloadCurrentPage(outputDir, options = {}) {
    let downloaded = 0;
    let skipped = 0;

    const frame = this.page.frameLocator(this.iframeLocator);
    const rows = frame.locator(`${this.tableSelector} tbody tr`);
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      try {
        const row = rows.nth(i);
        const cells = row.locator('td');

        // Extraer fecha (col 2) e ID (col 7)
        const rawDate = (await cells.nth(1).innerText()).trim();
        const rawId = (await cells.nth(6).innerText()).trim();

        // Saltar la fila del header
        if (rawDate === 'Inicio' || rawId === 'No. de ID' || rawId === '') {
          continue;
        }

        // Detectar datos sucios para diagnóstico
        if (HAS_INVALID_FILENAME_CHARS.test(rawId) || HAS_INVALID_FILENAME_CHARS.test(rawDate)) {
          console.log(`  ⚠️  Datos con caracteres especiales: id="${rawId}" fecha="${rawDate}"`);
        }

        // Sanitizar fecha: "24/04/26 10:35 AM" → "24-04-26-10-35-AM"
        const idText = sanitizeForFilename(rawId);
        const sanitizedDate = sanitizeForFilename(rawDate.replace(/[\/\s:]/g, '-'));
        const relPath = `${idText}/${sanitizedDate}.pdf`;
        const outputPath = join(outputDir, idText, `${sanitizedDate}.pdf`);

        // Doble Idempotencia:
        // 1. Manifiesto persistente local (en ext4)
        // 2. Archivo físico existente en local
        // 3. Archivo físico existente en remoto (si está montado)
        const existsInManifest = this.manifest && this.manifest.has(relPath);
        const existsInLocal = existsSync(outputPath);
        let existsInRemote = false;
        if (options.remoteDir) {
          try {
            existsInRemote = existsSync(join(options.remoteDir, relPath));
          } catch (e) {
            // Ignorar errores de I/O en remoto para no bloquear el bot
            existsInRemote = false;
          }
        }

        if (existsInManifest || existsInLocal || existsInRemote) {
          console.log(`  ⏭️  Ya existe: ${relPath} (manifest=${existsInManifest}, local=${existsInLocal}, remote=${existsInRemote})`);
          if (this.manifest && !existsInManifest) {
            this.manifest.record(relPath);
          }
          skipped++;
          continue;
        }

        console.log(`  ⬇️  Descargando: ${relPath}`);

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

        // ESCRITURA ATÓMICA: Guardar primero en .tmp y luego renombrar.
        // Esto evita que inotifywait o rsync capturen archivos incompletos.
        const tempPath = `${outputPath}.tmp.${Date.now()}`;
        writeFileSync(tempPath, buffer);
        renameSync(tempPath, outputPath);

        // Registrar en el manifiesto
        if (this.manifest) {
          this.manifest.record(relPath);
        }

        console.log(`  ✅ Guardado atómicamente: ${relPath}`);
        downloaded++;
      } catch (error) {
        console.error(`  ❌ Error en fila ${i + 1}: ${error.message}`);
        continue;
      }
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
