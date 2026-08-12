# FICHA TÉCNICA DE DESARROLLO

**Aplicable a:** Big Data · Desarrollo · Aplicaciones y RPA ·
Infraestructura y Seguridad.

---

## 1. IDENTIFICACIÓN DEL DESARROLLO

- **Nombre del desarrollo:** RPA CTG — Automatización de Descarga de Archivos de Cardiotocografía

- **Dependencia:** RPA / Desarrollo

- **Líder técnico:** PENDIENTE DE DEFINIR

- **Líder funcional:** PENDIENTE DE DEFINIR

---

## 2. OBJETIVO / DESCRIPCIÓN FUNCIONAL

Automatización robótica de procesos (RPA) que descarga archivos PDF de
cardiotocografía (CTG) desde el sistema de monitoreo fetal institucional
accesible vía web interna. El robot inicia sesión en la plataforma,
navega al módulo de administración de pacientes, accede al archivo CTG y
descarga todos los PDFs disponibles desde una tabla paginada, organizándolos
en carpetas por número de identificación del paciente.

**Área beneficiada:** Monitoreo Fetal / Obstetricia.

**Valor generado:** Elimina la descarga manual repetitiva de estudios CTG,
asegura la persistencia local de los archivos para consulta offline y
evita la pérdida de datos ante indisponibilidad del sistema web.

---

## 3. TECNOLOGÍAS Y HERRAMIENTAS

| **Categoría**               | **Herramienta / Tecnología**  | **Versión / Observación**                                         |
|-----------------------------|-------------------------------|-------------------------------------------------------------------|
| **Motor de base de datos**  | No aplica                     | El sistema no utiliza base de datos propia. Los PDFs se almacenan en sistema de archivos. |
| **Lenguaje / Framework**    | Node.js (JavaScript, ESM)     | Node.js ≥ 20.6 (requiere flag `--env-file`). Módulos ES (`"type": "module"`). |
| **Plataforma / Capa**       | RPA — Playwright (Browser Automation) | Playwright ^1.59.1. Browser channel: Google Chrome. Navegación headless. |
| **Gestor de procesos**      | PM2                           | Programación vía cron (`0 * * * *` — ejecución cada hora). Logs a `logs/`. |
| **Infraestructura**         | On-premise                    | Ejecución en servidor local (Linux) o estación de trabajo (Windows). Red interna 172.16.x.x. |
| **Otros**                   | Sistema de archivos de red    | Output a `Z:\` (Windows/SMB) o `~/Monitoreo_Fetal` (Linux montaje). |

---

## 4. MODELO DE DATOS / ARQUITECTURA TÉCNICA

| **Componente / Tabla**               | **Rol en el modelo** | **Descripción** |
|--------------------------------------|----------------------|-----------------|
| `app/main.js`                        | Punto de entrada     | Inicializa el flujo principal con la ruta del perfil del navegador. |
| `app/flow/mainFlow.js`               | Orquestador          | Coordina el ciclo de vida completo: browser → login → admin pacientes → cierre. |
| `app/flow/loginFlow.js`              | Flujo de autenticación | Ejecuta el inicio de sesión contra `https://172.16.1.75/logout.do` usando credenciales del `.env`. |
| `app/flow/adminPacientFlow.js`       | Flujo de negocio     | Navega a la sección Admin Pacientes, accede al CTG Archive y dispara la descarga de PDFs. |
| `infrastructure/Playwright/Browser/Browser.manage.js` | Infraestructura — Browser | Gestiona el ciclo de vida del navegador Chromium con contexto persistente (`launchPersistentContext`). Captura errores de consola. |
| `infrastructure/Playwright/pages/Login.page.js` | Page Object — Login | Selectores y lógica de interacción con el formulario de login. |
| `infrastructure/Playwright/pages/adminPaciente.page.js` | Page Object — Admin | Navegación al módulo de pacientes, interacción con el iframe de la tabla CTG, paginación, y descarga de PDFs con idempotencia. |
| Tabla `SortableTable` (iframe `#_dmwFrame`) | Fuente de datos    | Tabla HTML paginada dentro de un iframe que lista los registros CTG con columnas: fecha de inicio, número de ID, y link de descarga PDF. |
| `ecosystem.config.cjs`               | Configuración PM2   | Define el schedule horario, variables de entorno de producción, y rutas de logs. |
| `.env`                                | Configuración local | Credenciales de acceso y flags de comportamiento del browser (headless, channel, output dir). |
| `ArchivoCTG/`                         | Output local/test   | Directorio local de salida para pruebas. En producción se usa `Z:\` o `~/Monitoreo_Fetal`. |
| `profile/`                            | Perfil del browser  | Datos persistentes del navegador (cookies, sesión) para evitar re-autenticación innecesaria. |

---

## 5. CAMPOS / ENTIDADES / SALIDAS DEL DESARROLLO

### 5.1. Campos / Entidades / Salidas del Desarrollo

| **Campo / Entidad**       | **Tipo**   | **Origen**                         | **Descripción** |
|---------------------------|-----------|------------------------------------|-----------------|
| `idText` (No. de ID)      | VARCHAR   | Tabla HTML (columna 7, índice 6)   | Número de identificación del paciente. Se usa como nombre de subcarpeta de salida. |
| `dateText` (Inicio)       | VARCHAR   | Tabla HTML (columna 2, índice 1)   | Fecha y hora de inicio del estudio CTG. Se sanitiza y se usa como nombre del archivo PDF. |
| `pdfUrl`                  | URL       | Tabla HTML — atributo `href` del link PDF | URL relativa al PDF. Se resuelve contra `https://172.16.1.75`. |
| `sanitizedDate`           | CALCULADO | Lógica interna                     | Fecha sanitizada: `24/04/26 10:35 AM` → `24-04-26-10-35-AM`. |
| `outputPath`              | CALCULADO | Lógica interna                     | Ruta final del archivo: `{outputDir}/{idText}/{sanitizedDate}.pdf`. |
| Archivo PDF descargado    | BLOB/PDF  | Sistema web (descarga base64 vía `fetch`) | Archivo binario del estudio CTG guardado en sistema de archivos. |

### 5.2. Entradas / Salidas e Integraciones

| **Tipo**        | **Nombre**                                       | **Descripción**                                                                 | **Origen / Destino** |
|-----------------|--------------------------------------------------|---------------------------------------------------------------------------------|----------------------|
| **Entrada**     | Aplicación Web de Monitoreo Fetal                | Sistema institucional accesible vía HTTPS en red interna que expone el módulo CTG Archive. | `https://172.16.1.75` |
| **Entrada**     | Credenciales de acceso                           | Usuario y contraseña para autenticación en el sistema web.                      | Variables de entorno `.env` (`USERNAMEPAGE`, `PASSWORDPAGE`) |
| **Salida**      | Archivos PDF de estudios CTG                     | PDFs descargados y organizados por ID de paciente con timestamp en el nombre.    | `Z:\{id}\{fecha}.pdf` (Windows) o `~/Monitoreo_Fetal/{id}/{fecha}.pdf` (Linux) |
| **Integración** | Sistema de archivos de red (SMB / montaje Linux) | El output se escribe en una ruta que puede ser un disco de red mapeado (`Z:\`) o un punto de montaje local. | Filesystem local o de red |

---

## 6. IMPLEMENTACIÓN TÉCNICA

- **Descripción general del funcionamiento:**  
  Robot RPA basado en navegador que automatiza la descarga masiva de archivos PDF de
  cardiotocografía desde un sistema web institucional. Utiliza Playwright para controlar
  una instancia de Google Chrome en modo headless, con un perfil persistente que mantiene
  la sesión entre ejecuciones. Se ejecuta como un proceso Node.js orquestado por PM2
  con schedule horario. El flujo sigue el patrón Page Object Model, separando la lógica
  de navegación (flows) de los selectores de página (page objects).

- **Flujo de ejecución:**

  1. **Arranque:** PM2 dispara `app/main.js` cada hora. Se resuelve la ruta del perfil del navegador (`profile/` o variable `BROWSER_PROFILE`).
  2. **Inicio del navegador:** `BrowserManager` lanza una instancia persistente de Chromium usando el canal Chrome del sistema, con flags para evitar detección de automatización (`--disable-blink-features=AutomationControlled`), ignorar errores HTTPS (certificados auto-firmados de red interna), y modo headless.
  3. **Login:** `LoginPage` navega a `https://172.16.1.75/logout.do`, completa los campos `#loginUsernameInput` y `#loginPasswordInput`, y hace clic en `#loginSubmitButton`. Espera a que la página post-login termine de cargar.
  4. **Navegación a Admin Pacientes:** `AdminPaciente.goAdminPacientes()` hace clic en `#dataMgmtBtn`, lo que abre una nueva ventana/pestaña. El robot captura esa nueva página y actualiza su contexto.
  5. **Acceso a CTG Archive:** `clickArchiveButton()` hace clic en `#ctgArchiveBtn` y espera a que la tabla `SortableTable` se cargue dentro del iframe `#_dmwFrame`.
  6. **Descarga de PDFs (con paginación):**
     - Itera sobre cada fila de la tabla del iframe.
     - Extrae `dateText` (columna 2) e `idText` (columna 7).
     - Sanitiza la fecha al formato `DD-MM-YY-HH-MM-AM-PM`.
     - Verifica idempotencia: si el archivo ya existe en disco, lo saltea.
     - Si no existe, obtiene la URL del PDF desde el atributo `href` del link con título `"versión de impresión (PDF)"`, resuelve la URL absoluta, y descarga el contenido vía `fetch` dentro del contexto del navegador. El binario se obtiene como base64 y se escribe a disco.
     - Al terminar la página actual, busca el botón "Siguiente" del paginador ExtJS probando 11 selectores distintos. Si está deshabilitado u opaco, termina. Si no, hace clic y repite.
  7. **Cierre:** El navegador se cierra y el proceso Node.js termina con código 0 (éxito) o 1 (error).

+--------------------------------------------------------------------------------------------------+
| **Código / Consulta / Script / Flujo principal (fragmento o referencia)**                        |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
| **Repositorio:** PENDIENTE DE DEFINIR                                                            |
|                                                                                                  |
| **Rama principal:** `main`                                                                       |
|                                                                                                  |
| **Archivo principal:** `app/main.js`                                                             |
|                                                                                                  |
| **Comando de ejecución:**                                                                        |
| ```bash                                                                                          |
| # Desarrollo local                                                                               |
| npm run dev                                                                                      |
|                                                                                                  |
| # Producción (vía PM2)                                                                           |
| npm run pm2:start                                                                                |
| ```                                                                                              |
|                                                                                                  |
| **Scripts npm relevantes:**                                                                      |
| - `dev`: `node --env-file=.env ./app/main.js`                                                    |
| - `pm2:start`: `pm2 start ecosystem.config.js --env production`                                  |
| - `pm2:stop`: `pm2 stop rpa-ctg`                                                                 |
| - `pm2:logs`: `pm2 logs rpa-ctg`                                                                 |
| - `pm2:status`: `pm2 status rpa-ctg`                                                             |
|                                                                                                  |
| **Principales módulos:**                                                                         |
| - `app/main.js` → entry point                                                                    |
| - `app/flow/mainFlow.js` → orquestador de flujos                                                 |
| - `app/flow/loginFlow.js` → flujo de autenticación                                               |
| - `app/flow/adminPacientFlow.js` → flujo de negocio CTG                                          |
| - `infrastructure/Playwright/Browser/Browser.manage.js` → gestión de ciclo de vida del browser   |
| - `infrastructure/Playwright/pages/Login.page.js` → page object de login                         |
| - `infrastructure/Playwright/pages/adminPaciente.page.js` → page object de admin + descarga PDFs |
| - `ecosystem.config.cjs` → configuración de PM2 (schedule, env, logs)                            |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+

---

## 7. SEGURIDAD

- **Autenticación:**  
  El robot se autentica contra el sistema web diligenciando un formulario de login
  (`#loginUsernameInput` / `#loginPasswordInput`). Las credenciales se toman de las
  variables de entorno `USERNAMEPAGE` y `PASSWORDPAGE` definidas en el archivo `.env`.
  El perfil persistente del navegador (`profile/`) mantiene cookies de sesión entre
  ejecuciones, lo que puede reducir la necesidad de re-autenticación.

- **Control de acceso:**  
  PENDIENTE DE DEFINIR — No se han identificado roles o niveles de acceso en el código.
  El robot opera con un único usuario predefinido.

- **Manejo de datos sensible:**  
  **SÍ.** El sistema maneja datos sensibles de salud (estudios de cardiotocografía fetal
  identificados por número de documento del paciente). Estos datos se almacenan en:
  - Archivo `.env` (credenciales en texto plano — **riesgo identificado**).
  - Sistema de archivos local o de red (PDFs con datos clínicos).
  - Perfil del navegador (`profile/`) que contiene cookies de sesión.

- **Cifrado de la información:**  
  - **En tránsito:** HTTPS (el sistema web institucional opera sobre `https://172.16.1.75`).
    Sin embargo, se utiliza `ignoreHTTPSErrors: true` porque el certificado es auto-firmado
    (red interna), lo que deshabilita la validación de certificados.
  - **En reposo:** No se implementa cifrado de los PDFs descargados ni de las credenciales
    en el archivo `.env`. Los archivos residen en un sistema de archivos cuya seguridad
    depende del control de acceso al servidor/estación donde se ejecuta el robot.
  - **Perfil del navegador:** Las cookies de sesión se almacenan sin cifrar en `profile/`.

---

## 8. OPERACIÓN Y MANTENIMIENTO

- **Tipo de ejecución:**  
  Automática programada. El proceso es lanzado por PM2 según el cron definido en
  `ecosystem.config.cjs`. El flag `autorestart: false` asegura que el proceso solo
  se ejecute cuando el cron lo dispara y no se reinicie al finalizar.

- **Frecuencia de ejecución:**  
  Cada hora (`cron_restart: '0 * * * *'`). El robot descarga incrementalmente —
  solo archivos nuevos que no existan ya en disco (idempotencia).

- **Monitoreo:**  
  - Logs de PM2 en `logs/rpa-ctg-out.log` (stdout) y `logs/rpa-ctg-error.log` (stderr).
  - El `BrowserManager` captura errores de consola del navegador y errores de página no
    capturados, accesibles vía `getBrowserErrors()` (aunque actualmente no se persisten).
  - Comando `npm run pm2:status` para verificar el estado del proceso.
  - Cada paso del flujo emite logs con prefijo `[Componente]` para trazabilidad.

- **Alertas:**  
  PENDIENTE DE DEFINIR — El código actual no implementa mecanismos de notificación
  (correo, webhook, mensajería). Las fallas quedan registradas en los logs de PM2
  pero no se emiten alertas proactivas.

- **Contacto de soporte:**  
  PENDIENTE DE DEFINIR

---

## 9. NOTAS TÉCNICAS Y DECISIONES DE DISEÑO

+--------------------------------------------------------------------------------------------------+
| **NOTAS TÉCNICAS Y DECISIONES DE DISEÑO**                                                        |
+==================================================================================================+
| **Decisiones arquitectónicas:**                                                                  |
|                                                                                                  |
| - **Patrón Hexagonal / Clean Architecture simplificado:** El código separa `app/` (capa de       |
|   aplicación — flujos de negocio) de `infrastructure/` (detalles técnicos — browser, page        |
|   objects). Esto facilita testear los flujos con un browser mock y cambiar la tecnología de      |
|   automatización si fuera necesario.                                                             |
|                                                                                                  |
| - **Persistent Context vs Browser Context:** Se eligió `chromium.launchPersistentContext` con un |
|   directorio de perfil (`profile/`) en lugar de un contexto efímero. Esto mantiene cookies y      |
|   sesión entre ejecuciones, evitando re-autenticación innecesaria y reduciendo la carga sobre    |
|   el sistema web.                                                                                |
|                                                                                                  |
| - **Idempotencia en descargas:** Antes de descargar un PDF se verifica `existsSync(outputPath)`. |
|   Esto hace que las ejecuciones subsecuentes sean incrementales y no re-descarguen archivos ya    |
|   existentes, incluso si el proceso se interrumpe y reinicia.                                    |
|                                                                                                  |
| - **Descarga vía `fetch` en contexto del browser:** En lugar de usar el sistema de descargas de  |
|   Playwright (que requiere configuración de directorio de descargas), se usa `page.evaluate()`   |
|   con `fetch` para obtener el binario como base64. Esto da control total sobre la ruta de        |
|   destino y evita depender del comportamiento de descargas del navegador.                        |
|                                                                                                  |
| - **Múltiples selectores para paginación ExtJS:** La tabla CTG usa un paginador ExtJS cuyo       |
|   marcado HTML puede variar. Se implementó una estrategia de fallback con 11 selectores          |
|   distintos (imágenes, links, selectores de clase) para robustecer la navegación entre páginas.  |
|                                                                                                  |
| **Restricciones técnicas conocidas:**                                                             |
|                                                                                                  |
| - **Dependencia de Google Chrome instalado:** El código usa `channel: 'chrome'`, lo que requiere |
|   que Google Chrome esté instalado en el sistema operativo. No usa el Chromium empaquetado de    |
|   Playwright. Cambiar a `channel: undefined` usaría el binario de Playwright.                    |
|                                                                                                  |
| - **Red interna únicamente:** La URL `https://172.16.1.75` es una IP privada (rango 172.16.x.x).|
|   El robot solo funciona desde una máquina con acceso a esa red. Esto es intencional (sistema    |
|   institucional interno) pero limita la portabilidad.                                            |
|                                                                                                  |
| - **Certificado auto-firmado:** `ignoreHTTPSErrors: true` desactiva toda validación SSL. Esto es |
|   necesario para la IP interna con certificado propio, pero es un riesgo de seguridad si la      |
|   máquina se conectara a redes no confiables.                                                    |
|                                                                                                  |
| - **Node.js ≥ 20.6 requerido:** El flag `--env-file=.env` solo está disponible desde Node 20.6.  |
|   El proyecto no funcionará en versiones anteriores.                                             |
|                                                                                                  |
| - **Headless hardcodeado:** En `BrowserManager.start()`, `isHeadless` está fijado a `true`. No   |
|   se respeta la variable de entorno `HEADLESS` definida en `ecosystem.config.cjs`. Esto es un    |
|   **bug o deuda técnica** — el `ecosystem.config.cjs` configura `HEADLESS: 'true'`/`'false'`     |
|   pero el código nunca lo lee.                                                                   |
|                                                                                                  |
| **Dependencias externas o de otras áreas TIC:**                                                  |
|                                                                                                  |
| - **Sistema de Monitoreo Fetal Institucional:** El robot depende totalmente de la disponibilidad |
|   y estructura HTML del sistema web en `172.16.1.75`. Cualquier cambio en los selectores CSS,    |
|   la estructura de la tabla, o el flujo de navegación romperá el robot.                          |
|                                                                                                  |
| - **Sistema de archivos de red:** El output en producción depende de `Z:\` (Windows) o            |
|   `~/Monitoreo_Fetal` (Linux). Si el montaje de red no está disponible, las descargas fallarán.  |
|                                                                                                  |
| **Alertas, pendientes o deuda técnica identificada:**                                            |
|                                                                                                  |
| - ⚠️ **Credenciales en texto plano:** `.env` contiene usuario y contraseña sin cifrar. En un     |
|   entorno institucional esto debe manejarse con un gestor de secretos (HashiCorp Vault,          |
|   Azure Key Vault, variables de entorno del sistema, etc.).                                      |
|                                                                                                  |
| - ⚠️ **Bug: `HEADLESS` env var ignorada:** El `BrowserManager` tiene `isHeadless = true`         |
|   hardcodeado. La variable `HEADLESS` en `ecosystem.config.cjs` no tiene efecto.                 |
|                                                                                                  |
| - ⚠️ **Sin alertas ni monitoreo proactivo:** Si el robot falla (login expirado, cambio en HTML,  |
|   red caída), no hay notificación. Solo logs en archivos que requieren revisión manual.          |
|                                                                                                  |
| - ⚠️ **Sin reintentos:** Si una descarga individual falla, el proceso continúa con la siguiente  |
|   fila pero no se registra la falla ni se reintenta el archivo perdido.                          |
|                                                                                                  |
| - ⚠️ **Sin pruebas automatizadas:** No se encontraron tests unitarios ni de integración en el    |
|   repositorio.                                                                                   |
|                                                                                                  |
| - 🔲 **Posible mejora:** Extraer la URL base (`https://172.16.1.75`) a una variable de entorno   |
|   para facilitar cambios de ambiente (desarrollo/staging/producción).                            |
|                                                                                                  |
| **Frecuencia de actualización o mantenimiento requerido:**                                       |
|                                                                                                  |
| - **Mantenimiento reactivo:** Cada vez que el sistema web institucional cambie su interfaz        |
|   (selectores CSS, estructura del DOM, flujo de navegación), los page objects deberán            |
|   actualizarse.                                                                                  |
|                                                                                                  |
| - **Rotación de credenciales:** Cuando la contraseña del usuario institucional se actualice,      |
|   debe modificarse el `.env` y reiniciarse el proceso PM2.                                       |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+

*Nota: Documento de uso interno — Dirección TIC*

*Para consultas sobre este formato, contactar al área de Big Data y
Gestión del Conocimiento.*

---

## 10. CONTROL DE CAMBIOS

| **FECHA**   | **DESCRIPCIÓN DEL CAMBIO** | **VERSIÓN** | **PARTICIPANTES** | **FECHA** | **DESCRIPCIÓN DEL CAMBIO** | **VERSIÓN** | **PARTICIPANTES** |
|-------------|---------------------------|-------------|-------------------|-----------|---------------------------|-------------|-------------------|
| 30/05/2026  | Emisión inicial del documento — generación automática desde análisis de código fuente | 01 | Sistema (análisis automatizado de repositorio) | | | | |

+------------------------+---------------------+----------------------+
| **ELABORADO POR:**     | **REVISADO POR:**   | **APROBADO POR:**    |
|                        |                     |                      |
| PENDIENTE DE DEFINIR   | PENDIENTE DE DEFINIR| PENDIENTE DE DEFINIR |
+------------------------+---------------------+----------------------+
