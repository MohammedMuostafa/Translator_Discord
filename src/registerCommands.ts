import { commands } from './commands.js';
import { env } from './config.js';

export async function registerGlobalCommands(applicationId: string, botToken: string): Promise<void> {
  const activeCommands = env.ENABLE_GUILD_VOICE_AI
    ? commands
    : commands.filter((command) => command.name !== 'voicechat');

  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(activeCommands),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord command registration failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const registered = (await response.json()) as Array<{ id: string; name: string; type: number }>;
  console.log(`Registered ${registered.length} global commands: ${registered.map((item) => item.name).join(', ')}`);
  if (!env.ENABLE_GUILD_VOICE_AI) {
    console.log('Guild Voice AI command is disabled. Set ENABLE_GUILD_VOICE_AI=true after enabling Guild Install.');
  }
}
