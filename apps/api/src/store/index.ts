import type { AppConfig } from "../config.js";
import { MemoryStore } from "./memory-store.js";
import { PostgresStore } from "./postgres-store.js";
import type { StatusRepository } from "./types.js";

export type RepositoryBundle = {
  repo: StatusRepository;
  close: () => Promise<void>;
};

export async function createRepository(config: AppConfig): Promise<RepositoryBundle> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return {
      repo: new MemoryStore(config),
      close: async () => undefined
    };
  }

  const repo = new PostgresStore(config, databaseUrl);
  await repo.init();
  return {
    repo,
    close: () => repo.close()
  };
}

