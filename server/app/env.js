import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFiles(rootDir, fileNames, shellEnvKeys = process.env) {
  const keys = shellEnvKeys instanceof Set ? shellEnvKeys : new Set(Object.keys(shellEnvKeys));

  for (const fileName of fileNames) {
    const path = resolve(rootDir, fileName);
    if (!existsSync(path)) continue;

    const source = readFileSync(path, "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      if (keys.has(key)) continue;

      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value.replace(/\\n/g, "\n");
    }
  }
}
