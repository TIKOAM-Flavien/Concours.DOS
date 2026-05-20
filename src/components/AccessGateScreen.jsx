// Defense-in-depth fallback screen rendered when the signed link is missing,
// invalid, or expired. Minimal, brand-less — the prod server already returns
// a 403 before this code runs; this is the last line of defense if a stale
// HTML is served from cache.

export default function AccessGateScreen({ status, title, message }) {
  const isChecking = status === "checking";
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f6f7fb",
        color: "#182033",
        fontFamily: "Arial, sans-serif",
        padding: "2rem",
      }}
    >
      <main
        style={{
          maxWidth: 540,
          width: "100%",
          padding: "2rem",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 14px 30px rgba(16, 24, 40, 0.1)",
          textAlign: "left",
        }}
      >
        <h1 style={{ margin: "0 0 0.75rem", fontSize: "1.4rem" }}>
          {isChecking ? "Verification en cours" : title}
        </h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          {isChecking ? "Controle du lien securise en cours." : message}
        </p>
      </main>
    </div>
  );
}
