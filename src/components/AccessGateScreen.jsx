// Defense-in-depth fallback screen rendered when the signed link is missing,
// invalid, or expired. Minimal, brand-less — the prod server already returns
// a 403 before this code runs; this is the last line of defense if a stale
// HTML is served from cache.

export default function AccessGateScreen({ status, title, message }) {
  const isChecking = status === "checking";
  const isBlocked = status === "blocked";
  const tone = isChecking ? "checking" : isBlocked ? "blocked" : "ready";

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg, #f6f7fb 0%, #eef0f6 100%)",
        color: "#182033",
        fontFamily:
          'Aptos, "Segoe UI", Tahoma, Arial, sans-serif',
        padding: "2rem",
      }}
    >
      <main
        style={{
          maxWidth: 480,
          width: "100%",
          padding: "2rem 2.25rem",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 14px 40px rgba(16, 24, 40, 0.12)",
          textAlign: "left",
          border: "1px solid rgba(16, 24, 40, 0.06)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            marginBottom: "0.75rem",
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: tone === "checking" ? "#5a4628" : tone === "blocked" ? "#a23838" : "#3a3e57",
            background:
              tone === "checking"
                ? "rgba(220, 173, 89, 0.18)"
                : tone === "blocked"
                  ? "rgba(196, 60, 60, 0.12)"
                  : "rgba(58, 62, 87, 0.08)",
          }}
        >
          {isChecking ? (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid currentColor",
                borderRightColor: "transparent",
                animation: "agw-spin 0.7s linear infinite",
              }}
            />
          ) : null}
          {isChecking ? "Verification" : isBlocked ? "Acces refuse" : "Information"}
        </div>
        <h1 style={{ margin: "0 0 0.75rem", fontSize: "1.4rem", lineHeight: 1.25 }}>
          {isChecking ? "Verification en cours" : title}
        </h1>
        <p style={{ margin: 0, lineHeight: 1.55, color: "#3a3e57" }}>
          {isChecking ? "Controle du lien securise en cours." : message}
        </p>
        <style>
          {`@keyframes agw-spin { to { transform: rotate(360deg); } }`}
        </style>
      </main>
    </div>
  );
}
