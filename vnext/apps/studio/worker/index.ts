import { handleStudioRequest } from "./app";

export { PublicationCoordinator } from "./publication-coordinator";

export default {
  fetch(request, env): Promise<Response> {
    return handleStudioRequest(request, env);
  }
} satisfies ExportedHandler<Env>;
