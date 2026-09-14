export default class LoginPage {
  constructor(page) {
    this.page = page;
  }

  async login({ username, password }) {
    const baseUrl = process.env.APP_BASE_URL || 'https://172.16.1.75';
    const loginUrl = `${baseUrl.replace(/\/+$/, '')}/logout.do`;

    console.log(`[LoginPage] Navegando a ${loginUrl}...`);
    await this.page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('[LoginPage] Completando credenciales...');
    await this.page.fill('#loginUsernameInput', username);
    await this.page.fill('#loginPasswordInput', password);

    console.log('[LoginPage] Enviando formulario...');
    await this.page.locator('#loginSubmitButton').click();

    // Esperar a que la navegación post-login complete
    await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

    // Validación explícita de éxito de login
    const isLoginSuccessful = await this.page.locator('#dataMgmtBtn').waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!isLoginSuccessful) {
      const errorText = await this.page.locator('.error, .alert, #loginError, [class*="error"]')
        .first()
        .innerText()
        .catch(() => 'Credenciales rechazadas o timeout esperando menú principal');
      throw new Error(`[LoginPage] Falla de autenticación: ${errorText}`);
    }

    console.log('[LoginPage] Login verificado exitosamente');
  }
}
