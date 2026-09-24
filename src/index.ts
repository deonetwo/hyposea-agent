import { loadConfig, maskSecret } from './config.js';
import { initDiscordClient, getClient } from './discord-client.js';
import { initMainframeBridge } from './mainframe.js';

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Process Guard] ⚠️ Intercepted unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[Process Guard] ⚠️ Intercepted uncaught exception:', err.message, err.stack);
});

async function main() {
  const config = loadConfig();

  console.error('=============================================================');
  console.error('     HYPOSEA AGENT — DISCORD <-> AGY MAINFRAME BRIDGE        ');
  console.error('=============================================================');
  console.error(`  Mainframe Channel:  #${config.mainframeChannel}`);
  console.error(`  Mainframe Prefix:   ${config.mainframePrefix}`);
  console.error(`  AGY Binary:         ${config.agyBinPath}`);
  console.error(`  Discord Bot Token:  ${maskSecret(config.discordToken)}`);
  console.error('=============================================================');

  if (!config.discordToken) {
    console.error('\n❌ FATAL: DISCORD_BOT_TOKEN is missing!');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.error(`\n[Agent] Received ${signal}. Terminating gracefully...`);
    try {
      await getClient().destroy();
    } catch { /* not connected */ }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const client = await initDiscordClient(config);
    initMainframeBridge(client, config);
  } catch (err: any) {
    console.error('[Fatal Error] Failed to initialize agent:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
