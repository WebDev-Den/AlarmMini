import { loadConfig } from './config.js';
import { createService } from './service.js';
import { createHttpServer } from './http.js';

try {
  const config = loadConfig();
  const service = createService(config);
  const server = createHttpServer(service, config);
  server.listen(config.port, config.host, () => {
    console.info(`AlarmMini HTTP listening on ${config.host}:${config.port}`);
    service.start();
  });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections();
    await service.stop();
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  server.on('error', error => {
    console.error('HTTP server error', error.code || 'HTTP_ERROR');
    process.exitCode = 1;
    void stop();
  });
} catch (error) {
  console.error('Cannot start AlarmMini:', error.code || error.message);
  process.exitCode = 1;
}
