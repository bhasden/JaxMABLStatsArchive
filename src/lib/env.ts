import path from "path";
import { config as loadDotenv } from "dotenv";

let loaded = false;

export function loadArchiveEnv(rootDir = process.cwd()) {
  if (loaded) {
    return;
  }

  loadDotenv({ path: path.join(rootDir, ".env") });
  loadDotenv({ path: path.join(rootDir, ".env.local"), override: true });

  loaded = true;
}
