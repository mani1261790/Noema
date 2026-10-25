import { dispatchReaderPush } from "./push";
import { handleStudioRequest } from "./app";
import { cleanupCmsAnalyticsRetention } from "./analytics-repository";

export default {
  fetch(request, env, ctx): Promise<Response> {
    return handleStudioRequest(request, env, ctx);
  },
  scheduled(controller, env): Promise<void> {
    return controller.cron === "17 3 * * *"
      ? cleanupCmsAnalyticsRetention(env.CMS_DB, new Date(controller.scheduledTime))
      : dispatchReaderPush(env);
  }
} satisfies ExportedHandler<Env>;
