export default function StatusBanner({ tone = "info", title, children }) {
  if (!title && !children) return null;

  return (
    <section className={`status-banner status-banner--${tone}`}>
      <div className="status-banner__title">{title}</div>
      <div className="status-banner__content">{children}</div>
    </section>
  );
}
