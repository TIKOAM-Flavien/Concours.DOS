export default function StatusBanner({ tone = "info", title, children }) {
  if (!title && !children) return null;

  const safeTone = ["info", "success", "warning", "error"].includes(tone)
    ? tone
    : "info";
  const isInterruptive = safeTone === "error" || safeTone === "warning";

  return (
    <section
      className={`status-banner status-banner--${safeTone}`}
      role={isInterruptive ? "alert" : "status"}
      aria-live={isInterruptive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {title ? <div className="status-banner__title">{title}</div> : null}
      {children ? <div className="status-banner__content">{children}</div> : null}
    </section>
  );
}
