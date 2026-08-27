import { handleStudioRequest } from "./app";
import { cleanupCmsAnalyticsRetention } from "./analytics-repository";

export default {
  fetch(request, env, ctx): Promise<Response> {
    return handleStudioRequest(request, env, ctx);
  },
  scheduled(controller, env): Promise<void> {
    return cleanupCmsAnalyticsRetention(env.CMS_DB, new Date(controller.scheduledTime));
  }
} satisfies ExportedHandler<Env>;
