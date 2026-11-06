import { resolveProviders } from '@chameleon/ai';
import { createDb } from '@chameleon/db';
import { createAiService } from './ai/service';
import { createApp } from './app';
import { ConfigError, loadConfig, type AppConfig } from './config';
import { createLogger } from './logging';

function readConfig(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  const config = readConfig();
  const logger = createLogger(config);
  const db = createDb({ connectionString: config.DATABASE_URL });
  const ai = createAiService({
    mode: config.AI_PROVIDER,
    providers: resolveProviders(process.env),
    limits: {
      totalDailyRequests: config.AI_DAILY_REQUESTS_TOTAL,
      totalDailyTokens: config.AI_DAILY_TOKEN_LIMIT_PER_USER,
    },
  });
  logger.info(
    { mode: config.AI_PROVIDER, providers: ai.providers().map((provider) => provider.id) },
    'ai configured',
  );
  const app = createApp({ config, logger, db, ai });
  const server = app.listen(config.API_PORT, '127.0.0.1', () => {
    logger.info({ port: config.API_PORT }, 'api listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    const forced = setTimeout(() => process.exit(1), 10_000);
    forced.unref();
    server.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
