const envVersion = String(import.meta.env.VITE_APP_VERSION || "").trim();

export const appVersion =
  typeof __APP_VERSION__ !== "undefined" && String(__APP_VERSION__).trim()
    ? String(__APP_VERSION__).trim()
    : envVersion || "dev";
