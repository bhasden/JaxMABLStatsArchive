import fs from "fs/promises";
import path from "path";

async function readNumericDirectories(root: string) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function listRawSeasonIds(dataDir: string) {
  const ids = new Set<number>();
  for (const seasonId of await readNumericDirectories(path.join(dataDir, "raw"))) {
    ids.add(seasonId);
  }
  for (const seasonId of await readNumericDirectories(dataDir)) {
    ids.add(seasonId);
  }
  return Array.from(ids).sort((left, right) => left - right);
}
