module.exports = {
  apps: [{
    name: 'rpa-ctg',
    script: './app/main.js',
    interpreter: 'node',
    node_args: '--env-file=.env',

    // Ejecutar diariamente a las 8:00 AM
    cron_restart: '0 * * * *',

    // No mantener el proceso vivo entre ejecuciones
    autorestart: false,

    // Logs
    output: './logs/rpa-ctg-out.log',
    error: './logs/rpa-ctg-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',

    // Variables de entorno para producción
    env_production: {
      NODE_ENV: 'production',
      HEADLESS: 'true',
      BROWSER_CHANNEL: 'chrome',
      // OUTPUT_DIR: '/mnt/archivo-ctg',
    },

    // Variables para desarrollo local
    env: {
      NODE_ENV: 'development',
      HEADLESS: 'false',
      BROWSER_CHANNEL: 'chrome',
    }
  }]
}
