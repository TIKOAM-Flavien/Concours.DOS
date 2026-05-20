import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFiles } from "./app/env.js";
import { startServer } from "./startServer.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(rootDir, [".env", ".env.local"]);

await startServer();
