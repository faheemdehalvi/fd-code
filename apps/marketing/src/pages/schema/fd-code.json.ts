import type { APIRoute } from "astro";

import { buildFDCodeProjectFileJsonSchema } from "@fdcode/shared/fdCodeProjectFile";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildFDCodeProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
