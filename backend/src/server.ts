import { createApiRouter } from "./api/router.js";
import { createApp } from "./app.js";
import {
  createEmailVerificationServiceFromEnv,
  createGitHubLinkServiceFromEnv,
} from "./auth/index.js";
import { ProjectNotificationWorker, startProjectNotifications } from "./projects/notifications.js";
import { loadConfig } from "./config/index.js";
import { getDbPool } from "./db/index.js";
import { createDefaultSyncCoordinator, startSyncScheduler } from "./sync/index.js";

try {
  const config = loadConfig();
  const coordinator = createDefaultSyncCoordinator(config);
  const emailVerification = createEmailVerificationServiceFromEnv();
  const githubLink = createGitHubLinkServiceFromEnv();
  const notifications=new ProjectNotificationWorker();
  const notificationScheduler=startProjectNotifications(notifications);
  const apiRouter = createApiRouter({
    notifyProjects:()=>notifications.runOnce(),
    getSyncStatus: () => coordinator.getSyncStatus(),
    emailVerification,
    githubLink,
  });
  const scheduler = startSyncScheduler(coordinator, config.ingestionCronSchedule);
  const server = createApp({ apiRouter }).listen(config.port, () => {
    console.info(`LeadBoard backend listening on port ${config.port}`);
  });

  server.on("error", () => {
    console.error("Backend failed to listen; check PORT and port availability.");
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    server.close(() => {
      void Promise.all([scheduler.stop(),notificationScheduler.stop()])
        .then(() => getDbPool().end())
        .finally(() => {
          clearTimeout(timer);
          process.exit(0);
        });
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  // loadConfig emits field names only, never the original input or Zod error.
  console.error(error instanceof Error ? error.message : "Invalid configuration");
  process.exitCode = 1;
}
