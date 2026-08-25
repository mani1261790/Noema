import { handleStudioRequest } from "./app";
import { cleanupCmsAnalyticsRetention } from "./analytics-repository";
import {
  consumeDiscordMilestoneNotifications,
  recoverPendingDiscordMilestoneNotifications,
  type CmsDiscordQueueMessage
} from "./discord-milestone-notifications";

export default {
  fetch(request, env): Promise<Response> {
    return handleStudioRequest(request, env);
  },
  queue(batch, env): Promise<void> {
    return consumeDiscordMilestoneNotifications(batch, env);
  },
  async scheduled(controller, env): Promise<void> {
    const now = new Date(controller.scheduledTime);
    await cleanupCmsAnalyticsRetention(env.CMS_DB, now);
    await recoverPendingDiscordMilestoneNotifications(
      env.CMS_DB,
      env.DISCORD_NOTIFICATIONS,
      now
    );
  }
} satisfies ExportedHandler<Env, CmsDiscordQueueMessage>;
