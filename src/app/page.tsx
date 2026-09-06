const futureSections = ["Tasks", "Team", "Calendar", "Reports"];

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          M
        </div>
        <div>
          <p className="eyebrow">Marketing workspace</p>
          <h1>Good work starts with a clear next step.</h1>
        </div>
      </header>

      <section className="hero-card" aria-labelledby="foundation-title">
        <span className="status-pill">Sprint 0 foundation</span>
        <h2 id="foundation-title">Your team task hub is taking shape.</h2>
        <p>
          Telegram group, private bot, and Mini App workflows will share one secure set of task rules and one activity history.
        </p>
        <div className="foundation-grid">
          <article>
            <span className="metric">3</span>
            <span className="metric-label">connected interfaces</span>
          </article>
          <article>
            <span className="metric">1</span>
            <span className="metric-label">source of truth</span>
          </article>
        </div>
      </section>

      <nav className="section-preview" aria-label="Planned application sections">
        {futureSections.map((section) => (
          <span key={section}>{section}</span>
        ))}
      </nav>

      <p className="footnote">No tasks yet. Task creation arrives in Sprint 2.</p>
    </main>
  );
}
