import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mainFlow from "./flow/mainFlow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Profile path: variable de entorno o default
const profilePath = process.env.BROWSER_PROFILE || join(__dirname, '..', 'profile');

mainFlow(profilePath)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  });
