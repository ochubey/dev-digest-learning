import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';
import { seed } from './db/seed.js';
import { resetDemoProject } from './db/demo-reset.js';

/** Production/dev entrypoint. `pnpm dev` runs `tsx watch src/server.ts`. */
async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });

  // Dev only: make sure the demo workspace/project exists on every start (idempotent).
  // Opt out with SEED_ON_BOOT=0.
  if (config.nodeEnv === 'development' && process.env.SEED_ON_BOOT !== '0') {
    try {
      await seed(app.container.db, { demoContext: config.projectDocsSource === 'fixture' });
      app.log.info('demo data seeded');
      // Then return the demo repo (acme/payments-api) to a clean, un-analysed state on EVERY
      // restart: no Intent, no agent runs, no real reviews. Other repos are never touched.
      // Opt out with RESET_DEMO_ON_BOOT=0.
      if (process.env.RESET_DEMO_ON_BOOT !== '0') {
        const { pulls } = await resetDemoProject(app.container.db);
        app.log.info(`demo project reset to its clean seeded state (${pulls} PRs)`);
      }
    } catch (err) {
      app.log.warn({ err }, 'seed/reset on boot failed — run `pnpm db:migrate` first?');
    }
  }

  // Graceful shutdown: on SIGTERM/SIGINT close the server, which runs the
  // onClose hooks (drains in-flight requests/SSE, closes the postgres pool).
  // Guarded so a second signal during shutdown doesn't double-close.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      app.log.info(`${signal} received — shutting down`);
      try {
        await app.close();
        process.exit(0);
      } catch (err) {
        app.log.error(err, 'error during shutdown');
        process.exit(1);
      }
    });
  }

  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    app.log.info(`DevDigest API listening on http://localhost:${config.apiPort}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
