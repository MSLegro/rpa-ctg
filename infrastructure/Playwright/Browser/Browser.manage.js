import { chromium } from 'playwright';

export default class BrowserManager {
  #context;
  #browserErrors = [];

  constructor(profilePath, options = {}) {
    this.profilePath = profilePath;
    this.options = options;
  }

  async start() {
    const isHeadless = true;
    const browserChannel = process.env.BROWSER_CHANNEL || 'chrome';

    console.log(`[BrowserManager] Lanzando ${browserChannel} (headless: ${isHeadless})`);

    this.#context = await chromium.launchPersistentContext(
      this.profilePath,
      {
        channel: browserChannel,
        ignoreHTTPSErrors: true,
        headless: isHeadless,
        slowMo: isHeadless ? 0 : 80,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        ...this.options
      }
    );
    console.log('[BrowserManager] Browser iniciado correctamente');

    // Captura errores en TODAS las páginas del context
    this.#context.on('page', page => {
      this.#attachConsoleListeners(page);
    });
  }

  async newPage() {
    if (!this.#context) {
      throw new Error('BrowserManager not started');
    }

    const page = await this.#context.newPage();
    this.#attachConsoleListeners(page);

    return page;
  }

  #attachConsoleListeners(page) {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        this.#browserErrors.push({
          text: msg.text(),
          location: msg.location()
        });
      }
    });

    page.on('pageerror', error => {
      this.#browserErrors.push({
        text: error.message,
        stack: error.stack
      });
    });
  }

  getBrowserErrors() {
    return this.#browserErrors;
  }

  clearBrowserErrors() {
    this.#browserErrors = [];
  }

  async assertNoBrowserErrors() {
    if (this.#browserErrors.length > 0) {
      console.error('Errores detectados en navegador:');
      console.error(this.#browserErrors);
      throw new Error('Errores en consola del navegador');
    }
  }

  async close() {
    if (this.#context) {
      console.log('[BrowserManager] Cerrando browser...');
      await this.#context.close();
      this.#context = null;
      console.log('[BrowserManager] Browser cerrado');
    }
  }
}
