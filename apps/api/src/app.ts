import fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "./config.js";
import { createRepository } from "./store/index.js";
import { registerRoutes } from "./routes.js";

export async function buildApp(config: AppConfig): Promise<ReturnType<typeof fastify>> {
  const app = fastify({ logger: true });
  const { repo, close } = await createRepository(config);

  app.register(cookie);
  app.register(formbody);
  app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });

  const webRoot = resolve(process.cwd(), config.webDistDir);
  if (existsSync(webRoot)) {
    app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/"
    });
  }

  app.get("/", async (_request, reply) => {
    if (existsSync(webRoot)) {
      return reply.sendFile("index.html");
    }
    reply.type("text/plain").send("Service Levels application API");
  });

  await registerRoutes(app, repo, config);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/") || request.url === "/healthz") {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    if (existsSync(webRoot)) {
      return reply.sendFile("index.html");
    }
    reply.code(404).send({ error: "Not found" });
  });

  app.addHook("onClose", async () => {
    await close();
  });

  return app;
}
