import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

/**
 * ManifestManager
 * Gestiona el registro persistente de archivos descargados por el bot.
 * Permite mantener la idempotencia incluso después de que rsync mueve
 * y elimina los archivos del directorio local (--remove-source-files).
 */
export default class ManifestManager {
  constructor(manifestPath = null) {
    const baseDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    this.filePath = manifestPath || process.env.MANIFEST_PATH || join(baseDir, '.rpa-ctg', 'download_manifest.json');
    this.downloadedFiles = new Set();
    this.isLoaded = false;
  }

  /**
   * Carga el manifiesto desde disco a memoria.
   */
  load() {
    if (this.isLoaded) return;

    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.downloadedFiles = new Set(list);
          console.log(`[ManifestManager] Manifiesto cargado con ${this.downloadedFiles.size} registros.`);
        }
      } else {
        console.log(`[ManifestManager] No existe manifiesto previo. Se creará en: ${this.filePath}`);
      }
    } catch (err) {
      console.warn(`[ManifestManager] Advertencia al leer manifiesto (${err.message}). Iniciando set vacío.`);
      this.downloadedFiles = new Set();
    }

    this.isLoaded = true;
  }

  /**
   * Verifica si un archivo ya fue registrado como descargado.
   * @param {string} relativePath - Ruta relativa en formato 'idPaciente/nombreArchivo.pdf'
   * @returns {boolean}
   */
  has(relativePath) {
    if (!this.isLoaded) this.load();
    const normalized = relativePath.replace(/\\/g, '/');
    return this.downloadedFiles.has(normalized);
  }

  /**
   * Registra un nuevo archivo en el manifiesto y persiste a disco atómicamente.
   * @param {string} relativePath - Ruta relativa en formato 'idPaciente/nombreArchivo.pdf'
   */
  record(relativePath) {
    if (!this.isLoaded) this.load();
    const normalized = relativePath.replace(/\\/g, '/');
    if (!this.downloadedFiles.has(normalized)) {
      this.downloadedFiles.add(normalized);
      this.#save();
    }
  }

  /**
   * Escanea opcionalmente un directorio existente (por ejemplo el montaje SMB remoto)
   * para rellenar el manifiesto con archivos históricos si aún no están registrados.
   * @param {string} dirPath - Directorio a escanear
   */
  indexExistingDirectory(dirPath) {
    if (!dirPath || !existsSync(dirPath)) return;
    try {
      let count = 0;
      const scan = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            scan(full);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            const rel = full.replace(dirPath, '').replace(/^[\\\/]/, '').replace(/\\/g, '/');
            if (!this.downloadedFiles.has(rel)) {
              this.downloadedFiles.add(rel);
              count++;
            }
          }
        }
      };
      scan(dirPath);
      if (count > 0) {
        console.log(`[ManifestManager] Indexados ${count} archivos preexistentes desde ${dirPath}`);
        this.#save();
      }
    } catch (err) {
      console.warn(`[ManifestManager] No se pudo escanear directorio ${dirPath}: ${err.message}`);
    }
  }

  #save() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      const payload = JSON.stringify(Array.from(this.downloadedFiles), null, 2);
      writeFileSync(tempPath, payload, 'utf-8');
      renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error(`[ManifestManager] Error al guardar manifiesto: ${err.message}`);
    }
  }
}
