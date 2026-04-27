import LoginPage from "../../infrastructure/Playwright/pages/Login.page.js";

export default async function loginFlow(page) {
  const username = process.env.USERNAMEPAGE
  const password = process.env.PASSWORDPAGE

  if (!username || !password) {
    throw new Error('Faltan credenciales: verifica USERNAMEPAGE y PASSWORDPAGE en .env');
  }

  const loginPage = new LoginPage(page)
  await loginPage.login({ username, password })
}