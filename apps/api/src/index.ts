import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

async function main(): Promise<void> {
  try {
    const app = await buildApp(config);
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
