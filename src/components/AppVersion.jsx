import { appVersion } from "../config/appVersion.js";

export default function AppVersion({ className = "" }) {
  if (!appVersion) return null;

  return (
    <span
      className={["app-version", className].filter(Boolean).join(" ")}
      title="Version de l'application"
    >
      v{appVersion}
    </span>
  );
}
