import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import type { LobbyRepository } from './lobby/types.js';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (process.env.NODE_ENV === 'production' && process.env.KORTSPIL_APP_SERVICE_AUTH_ENABLED !== 'true') {
  throw new Error('KORTSPIL_APP_SERVICE_AUTH_ENABLED must be true in production.');
}
if (process.env.NODE_ENV === 'production') {
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    throw new Error('PUBLIC_APP_URL must be configured with HTTPS in production.');
  }
  let parsedPublicAppUrl: URL;
  try {
    parsedPublicAppUrl = new URL(publicAppUrl);
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute HTTPS URL in production.');
  }
  if (parsedPublicAppUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must be configured with HTTPS in production.');
  }
}

if (connectionString) {
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    enableLiveMetrics: false,
  });
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('APPLICATIONINSIGHTS_CONNECTION_STRING is required in production.');
}

try {
  const { buildApp } = await import('./app.js');
  let lobbyRepository: LobbyRepository;
  let closeRepository: (() => Promise<void>) | undefined;
  if (process.env.NODE_ENV === 'production') {
    const { createSqlPool, SqlLobbyRepository } = await import('./lobby/sql-repository.js');
    const pool = await createSqlPool();
    lobbyRepository = new SqlLobbyRepository(pool);
    closeRepository = () => pool.close();
  } else {
    const { MemoryLobbyRepository } = await import('./lobby/memory-repository.js');
    lobbyRepository = new MemoryLobbyRepository();
  }

  const app = await buildApp({ lobbyRepository });
  if (closeRepository) app.addHook('onClose', closeRepository);
  const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ host, port });
} catch (error) {
  console.error('Failed to start Kortspil API.', error);
  process.exitCode = 1;
}
