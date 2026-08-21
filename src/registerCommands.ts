import { commands } from './commands.js';

export async function registerGlobalCommands(applicationId: string, botToken: string): Promise<void> {
  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'PUT',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord command registration failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const registered = (await response.json()) as Array<{ id: string; name: string; type: number }>;
  console.log(`Registered ${registered.length} global commands: ${registered.map((item) => item.name).join(', ')}`);
}
