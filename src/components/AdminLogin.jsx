import { useState } from "react";

import AppVersion from "./AppVersion";
import { portalEnv } from "../config/env";

export default function AdminLogin({ onSuccess, error: externalError = "" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Connexion refusee.");
      }
      onSuccess(body);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const displayError = error || externalError;

  return (
    <div className="admin-login-shell">
      <div className="admin-login-card">
        <header className="admin-login-card__head">
          <span className="portal-brand">{portalEnv.brandName}</span>
          <h1 className="admin-login-card__title">Connexion administration</h1>
          <p className="admin-login-card__copy">
            Acces reserve aux administrateurs du portail concours.
          </p>
        </header>

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label className="admin-login-field">
            <span>Identifiant</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          <label className="admin-login-field">
            <span>Mot de passe</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {displayError ? <p className="admin-login-form__error">{displayError}</p> : null}

          <button type="submit" className="btn btn--primary admin-login-form__submit" disabled={submitting}>
            {submitting ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <footer className="admin-login-card__foot">
          <AppVersion className="app-version--inline" />
        </footer>
      </div>
    </div>
  );
}
