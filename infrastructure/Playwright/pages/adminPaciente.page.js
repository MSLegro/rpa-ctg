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
   * Descarga todos los PDFs de las páginas del paginador.
   * Con early-stopping: se detiene si encuentra N páginas consecutivas sin novedades.
   * @param {string} outputDir - Directorio local donde guardar los PDFs
   * @param {Object} options - Opciones adicionales (ej. remoteDir, fullScan)
   */
  async downloadAllPdfs(outputDir, options = {}) {
    mkdirSync(outputDir, { recursive: true });

    // Inicializar el gestor de manifiesto local
    this.manifest = new ManifestManager();
    this.manifest.load();

    // Sincronizar manifiesto con archivos preexistentes en disco local (ej. ./ArchivoCTG)
    this.manifest.indexExistingDirectory(outputDir);

    // Si el directorio remoto está accesible, indexar archivos preexistentes
    if (options.remoteDir && existsSync(options.remoteDir)) {
      console.log(`[AdminPaciente] Sincronizando manifiesto con directorio compartido: ${options.remoteDir}`);
      this.manifest.indexExistingDirectory(options.remoteDir);
    }

    const maxConsecutiveSkippedPages = Number(process.env.MAX_CONSECUTIVE_SKIPPED_PAGES || 2);
    const maxPages = Number(process.env.MAX_PAGES || options.maxPages || 0);
    const isFullScan = Boolean(options.fullScan || process.env.FULL_SCAN === 'true');
    const concurrency = Number(process.env.CONCURRENT_DOWNLOADS || 3);

    console.log(`[AdminPaciente] Configuración: Concurrencia=${concurrency}, EarlyStopping=${!isFullScan ? `${maxConsecutiveSkippedPages} páginas` : 'desactivado'}${maxPages > 0 ? `, Límite MAX_PAGES=${maxPages}` : ''}`);

    let currentPage = 1;
    let totalDownloaded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let consecutiveSkippedPages = 0;
    let earlyStopped = false;
    let earlyStopReason = null;

    while (true) {
      console.log(`\n[AdminPaciente] === Página ${currentPage} ===`);

      const { downloaded, skipped, errors, totalRows } = await this.#downloadCurrentPage(outputDir, { ...options, concurrency });
      totalDownloaded += downloaded;
      totalSkipped += skipped;
      totalErrors += (errors || 0);

      // Límite de páginas para desarrollo/pruebas locales
      if (maxPages > 0 && currentPage >= maxPages) {
        earlyStopped = true;
        earlyStopReason = `Límite de prueba MAX_PAGES=${maxPages} alcanzado`;
        console.log(`[AdminPaciente] 🛑 ${earlyStopReason}.`);
        break;
      }

      // Optimización de Early Stopping:
      // Si todos los archivos de esta página ya existen y no es un full-scan, acumulamos contador
      if (!isFullScan && totalRows > 0 && downloaded === 0) {
        consecutiveSkippedPages++;
        console.log(`[AdminPaciente] Página sin novedades (${consecutiveSkippedPages}/${maxConsecutiveSkippedPages})`);
        if (consecutiveSkippedPages >= maxConsecutiveSkippedPages) {
          earlyStopped = true;
          earlyStopReason = `Early Stopping (${maxConsecutiveSkippedPages} páginas consecutivas sin novedades)`;
          console.log(`[AdminPaciente] 🛑 Parada temprana: Se alcanzaron ${maxConsecutiveSkippedPages} páginas consecutivas sin archivos nuevos. Fin del ciclo incremental.`);
          break;
        }
      } else if (downloaded > 0) {
        consecutiveSkippedPages = 0;
      }

      // Intentar ir a la siguiente página
      const hasNext = await this.#goToNextPage();
      if (!hasNext) {
        console.log(`\n[AdminPaciente] No hay más páginas`);
        break;
      }

      currentPage++;
    }

    console.log(`\n[AdminPaciente] Descarga completa: ${totalDownloaded} nuevos, ${totalSkipped} ya existentes, ${totalErrors} errores (Páginas procesadas: ${currentPage})`);

    return {
      pagesProcessed: currentPage,
      downloaded: totalDownloaded,
      skipped: totalSkipped,
      errors: totalErrors,
      earlyStopped,
      earlyStopReason,
      manifestCount: this.manifest ? this.manifest.downloadedFiles.size : 0,
      localOutputDir: outputDir,
      remoteOutputDir: options.remoteDir || null
    };
  }

  /**
   * Descarga los PDFs de la página actual de la tabla en lote y con concurrencia controlada.
   * @param {string} outputDir - Directorio de salida
   * @param {Object} options - Opciones (ej. remoteDir, concurrency)
   * @returns {{ downloaded: number, skipped: number, totalRows: number }}
   */
  async #downloadCurrentPage(outputDir, options = {}) {
    let downloaded = 0;
    let skipped = 0;
    let errors = 0;
    const concurrency = options.concurrency || 3;
    const baseUrl = process.env.APP_BASE_URL || 'https://172.16.1.75';

    const frame = this.page.frameLocator(this.iframeLocator);

    // 1. EXTRACCIÓN EN UN SOLO VIAJE CDP:
    // En lugar de hacer cientos de llamadas por websocket fila por fila,
    // extraemos la metadata de toda la tabla en un solo frame.evaluate() en ~5ms.
    const rawRows = await frame.locator(this.tableSelector).evaluate((table) => {
      if (!table) return [];
      const trs = Array.from(table.querySelectorAll('tbody tr'));
      return trs.map(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 7) return null;
        const link = tr.querySelector('a[title*="versión de impresión (PDF)"]');
        return {
          rawDate: (cells[1]?.innerText || '').trim(),
          rawId: (cells[6]?.innerText || '').trim(),
          href: link ? link.getAttribute('href') : null
        };
      }).filter(Boolean);
    }).catch((err) => {
      console.warn(`[AdminPaciente] Error extrayendo filas de tabla: ${err.message}`);
      return [];
    });

    const validRows = [];
    for (const r of rawRows) {
      if (r.rawDate === 'Inicio' || r.rawId === 'No. de ID' || !r.rawId || !r.href) {
        continue;
      }

      const idText = sanitizeForFilename(r.rawId);
      const sanitizedDate = sanitizeForFilename(r.rawDate.replace(/[\/\s:]/g, '-'));
      const relPath = `${idText}/${sanitizedDate}.pdf`;
      const outputPath = join(outputDir, idText, `${sanitizedDate}.pdf`);

      // Validación de Idempotencia
      const existsInManifest = this.manifest && this.manifest.has(relPath);
      const existsInLocal = existsSync(outputPath);
      let existsInRemote = false;
      if (options.remoteDir) {
        try {
          existsInRemote = existsSync(join(options.remoteDir, relPath));
        } catch {
          existsInRemote = false;
        }
      }

      if (existsInManifest || existsInLocal || existsInRemote) {
        if (this.manifest && !existsInManifest) {
          this.manifest.record(relPath);
        }
        skipped++;
      } else {
        const resolvedPdfUrl = r.href.startsWith('http')
          ? r.href
          : `${baseUrl.replace(/\/+$/, '')}${r.href.startsWith('/') ? '' : '/'}${r.href}`;

        validRows.push({
          idText,
          sanitizedDate,
          relPath,
          outputPath,
          pdfUrl: resolvedPdfUrl
        });
      }
    }

    if (skipped > 0) {
      console.log(`  ⏭️  Saltados en esta página (ya existentes): ${skipped}`);
    }

    if (validRows.length === 0) {
      return { downloaded: 0, skipped, totalRows: rawRows.length };
    }

    console.log(`  ⬇️  Descargando ${validRows.length} archivo(s) nuevos con concurrencia de ${concurrency}...`);

    // 2. DESCARGAS CONCURRENTES CONTROLADAS:
    // Descarga directa a Buffer sin overhead de Base64 ni memory leak en el browser
    const downloadFile = async (item) => {
      let buffer = null;

      try {
        // Intento 1: API de Request de Playwright (streaming directo a Buffer compartiendo sesión)
        const response = await this.page.context().request.get(item.pdfUrl, { timeout: 30000 });
        if (response.ok()) {
          buffer = await response.body();
        } else {
          throw new Error(`HTTP ${response.status()}`);
        }
      } catch (reqErr) {
        // Fallback: Evaluación en contexto de navegador con fetch
        const base64 = await this.page.evaluate(async (url) => {
          const res = await fetch(url, { credentials: 'include' });
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        }, item.pdfUrl);
        buffer = Buffer.from(base64.split(',')[1], 'base64');
      }

      // ESCRITURA ATÓMICA (.tmp -> renameSync)
      mkdirSync(dirname(item.outputPath), { recursive: true });
      const tempPath = `${item.outputPath}.tmp.${Date.now()}`;
      writeFileSync(tempPath, buffer);
      renameSync(tempPath, item.outputPath);

      if (this.manifest) {
        this.manifest.record(item.relPath);
      }

      console.log(`  ✅ Guardado: ${item.relPath}`);
      downloaded++;
    };

    // Pool de concurrencia simple sin dependencias externas
    const executing = [];
    for (const item of validRows) {
      const p = downloadFile(item).catch(err => {
        errors++;
        console.error(`  ❌ Error descargando ${item.relPath}: ${err.message}`);
      });
      executing.push(p);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        // Filtrar promesas resueltas
        for (let idx = executing.length - 1; idx >= 0; idx--) {
          const status = await Promise.race([executing[idx], 'PENDING']);
          if (status !== 'PENDING') {
            executing.splice(idx, 1);
          }
        }
      }
    }
    await Promise.all(executing);

    return { downloaded, skipped, errors, totalRows: rawRows.length };
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
