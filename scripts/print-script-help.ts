import fs from "fs/promises";
import path from "path";

type PackageJson = {
  scripts?: Record<string, string>;
  scriptDescriptions?: Record<string, string>;
};

const packageJsonPath = path.join(process.cwd(), "package.json");
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as PackageJson;
const scripts = packageJson.scripts ?? {};
const descriptions = packageJson.scriptDescriptions ?? {};
const scriptNames = Object.keys(scripts);
const longestName = Math.max(...scriptNames.map((name) => name.length));

console.log("Available npm scripts:\n");

for (const name of scriptNames) {
  const description = descriptions[name] ?? "No description provided.";
  console.log(`  ${name.padEnd(longestName)}  ${description}`);
}

const missingDescriptions = scriptNames.filter((name) => !descriptions[name]);
if (missingDescriptions.length > 0) {
  console.log(`\nMissing descriptions: ${missingDescriptions.join(", ")}`);
  process.exitCode = 1;
}
