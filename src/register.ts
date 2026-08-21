import 'dotenv/config';
import { registerGlobalCommands } from './registerCommands.js';

const applicationId = process.env.DISCORD_APP_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

if (!applicationId) {
  console.error('Missing DISCORD_APP_ID.');
  process.exit(1);
}

if (!botToken) {
  console.error('Missing DISCORD_BOT_TOKEN.');
  process.exit(1);
}

try {
  await registerGlobalCommands(applicationId, botToken);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
