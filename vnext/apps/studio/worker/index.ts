import { handleStudioRequest } from "./app";
import { cleanupCmsAnalyticsRetention } from "./analytics-repository";

export default {
  fetch(request, env): Promise<Response> {
    return handleStudioRequest(request, env);
  },
  scheduled(controller, env): Promise<void> {
    return cleanupCmsAnalyticsRetention(env.CMS_DB, new Date(controller.scheduledTime));
  }
} satisfies ExportedHandler<Env>;
