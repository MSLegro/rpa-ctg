export default class LoginPage {
  constructor(page) {
    this.page = page;
  }

  async login({ username, password }) {
    const URL = 'https://172.16.1.75/logout.do';

    console.log(`[LoginPage] Navegando a ${URL}...`);
    await this.page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('[LoginPage] Completando credenciales...');
    await this.page.fill('#loginUsernameInput', username);
    await this.page.fill('#loginPasswordInput', password);

    console.log('[LoginPage] Enviando formulario...');
    await this.page.locator('#loginSubmitButton').click();

    // Esperar a que la navegación post-login complete
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      // networkidle puede timeout si hay polling, no es fatal
    });

    console.log('[LoginPage] Login exitoso');
  }
}
