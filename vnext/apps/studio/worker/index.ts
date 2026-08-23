import { handleStudioRequest } from "./app";
import { runDiscordActivityLog } from "./discord-activity-log";

export default {
  fetch(request, env): Promise<Response> {
    return handleStudioRequest(request, env);
  },
  scheduled(controller, env, ctx): void {
    ctx.waitUntil(runDiscordActivityLog(
      controller.cron,
      env,
      new Date(controller.scheduledTime)
    ));
  }
} satisfies ExportedHandler<Env>;
