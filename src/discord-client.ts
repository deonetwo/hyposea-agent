import { Client, GatewayIntentBits, Partials, RateLimitData } from 'discord.js';
import { AppConfig } from './config.js';

let discordClient: Client | null = null;

export async function initDiscordClient(config: AppConfig): Promise<Client> {
  if (discordClient && discordClient.isReady()) return discordClient;
  if (!config.discordToken) {
    throw new Error('DISCORD_BOT_TOKEN is not configured in process.env or .env file.');
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.User]
  });

  discordClient.rest.on('rateLimited', (rateLimitData: RateLimitData) => {
    console.error(`[Discord] ⚠️ REST Rate limit! Route: ${rateLimitData.route}`);
  });

  return new Promise((resolve, reject) => {
    if (!discordClient) return reject(new Error('Discord client failed to allocate.'));
    discordClient.once('ready', (readyClient) => {
      console.error(`[Discord] Bot connected as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
      resolve(readyClient);
    });
    discordClient.on('error', (err) => console.error('[Discord] Client network error:', err.message));
    discordClient.on('warn', (warning) => console.error('[Discord] Client warning:', warning));
    discordClient.login(config.discordToken).catch((err) => {
      console.error('[Discord] Authentication failed:', err.message);
      reject(err);
    });
  });
}

export function getClient(): Client {
  if (!discordClient || !discordClient.isReady()) {
    throw new Error('Discord client is not ready.');
  }
  return discordClient;
}
