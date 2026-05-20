import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FORBIDDEN_PUBLIC_KEYS = [
  "VITE_CLIENT_PORTAL_LINK_SECRET",
  "VITE_POWER_AUTOMATE_SEND_INVITATIONS_URL",
  "VITE_POWER_AUTOMATE_SEND_REMINDERS_URL",
];

function parseEnvFile(path) {
  if (!existsSync(path)) return new Map();

  const out = new Map();
  const source = readFileSync(path, "utf8");
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    out.set(match[1], match[2].trim());
  }

  return out;
}

function main() {
  const rootDir = process.cwd();
  const envSources = [
    { label: "process.env", values: new Map(Object.entries(process.env)) },
    { label: ".env", values: parseEnvFile(resolve(rootDir, ".env")) },
    { label: ".env.local", values: parseEnvFile(resolve(rootDir, ".env.local")) },
  ];

  const findings = [];

  for (const source of envSources) {
    for (const key of FORBIDDEN_PUBLIC_KEYS) {
      if (source.values.has(key)) {
        findings.push(`${source.label}: ${key}`);
      }
    }
  }

  if (!findings.length) return;

  console.error("Sensitive variables must not use the VITE_ prefix anymore.");
  console.error("Move them to server-only names before building:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  console.error("");
  console.error("Expected server-only names:");
  console.error("- PORTAL_LINK_SECRET");
  console.error("- POWER_AUTOMATE_SEND_INVITATIONS_URL");
  console.error("- POWER_AUTOMATE_SEND_REMINDERS_URL");
  process.exit(1);
}

main();
