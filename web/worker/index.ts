import { Container, getContainer } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";

interface Env {
  ADS_RIGHT_API: DurableObjectNamespace<AdsRightContainer>;
  ASSETS: Fetcher;
  OPENROUTER_API_KEY?: string;
}

/** Stateless FastAPI runtime. Workflow sessions remain in the browser. */
export class AdsRightContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "15m";
  enableInternet = false;
  interceptHttps = true;
  envVars: Record<string, string> = {
    OPENROUTER_API_KEY: "cloudflare-worker-egress",
    OPENROUTER_API_BASE: "https://openrouter.ai",
    OPENROUTER_DECISION_MODEL: "openai/gpt-6-luna-decisions",
    OPENROUTER_REPORT_MODEL: "openai/gpt-6-luna",
    OPENROUTER_IMAGE_MODEL: "openai/gpt-image-2.5-sunburst",
    UPLOAD_DIR: "/tmp/ads-right/session",
  };

  constructor(ctx: DurableObject<Env>["ctx"], env: Env) {
    super(ctx, env);
  }
}

AdsRightContainer.outboundByHost = {
  "openrouter.ai": async (request, env) => {
    const url = new URL(request.url);
    const allowedPaths = new Set([
      "/api/alpha/decisions",
      "/api/v1/responses",
      "/api/v1/images",
    ]);
    if (request.method !== "POST" || !allowedPaths.has(url.pathname)) {
      return new Response("OpenRouter egress is restricted to the configured workflow endpoints.", { status: 403 });
    }
    const authorizedRequest = new Request(request);
    authorizedRequest.headers.set("Authorization", "Bearer " + ((env as Env).OPENROUTER_API_KEY ?? ""));
    return fetch(authorizedRequest);
  },
};

function containerFor(env: Env) {
  return getContainer(env.ADS_RIGHT_API as unknown as DurableObjectNamespace<Container<Env>>, "ads-right-api");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const response = await containerFor(env).fetch(request);
    if (url.pathname !== "/api/health" || request.method !== "GET" || !response.ok) return response;

    const health = await response.json<Record<string, unknown>>();
    return Response.json({
      ...health,
      ai_provider: "openrouter",
      ai_configured: Boolean(env.OPENROUTER_API_KEY?.trim()),
    });
  },
};
