import { useState } from "react";
import { ArrowRight, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { api } from "../api";
import type { AuthSession } from "../contracts";
import { errorMessage } from "../utils/helpers";

interface LoginProps {
  onLogin: (session: AuthSession) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      onLogin(await api.login(email, password));
    } catch (reason) {
      setError(errorMessage(reason, "Unable to sign in"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-center-shell">
      <div className="login-card-centered">
        <div className="login-header-centered">
          <div className="brand-mark large">W</div>
          <span className="eyebrow blue">
            <Sparkles size={14} /> TalentScreen Apply
          </span>
          <h1>Sign in to TalentScreen</h1>
          <p>Your next opportunity, one click closer. Enter your credentials to continue.</p>
        </div>

        <form className="login-form-centered" onSubmit={submit}>
          <label>
            Email address
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="candidate@whiteboxlearning.com"
              required
            />
          </label>

          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
            />
          </label>

          {error && (
            <div className="error-banner">
              <XCircle size={16} />
              {error}
            </div>
          )}

          <button className="primary-button login-button" disabled={loading}>
            {loading ? "Signing in…" : <>Sign in <ArrowRight size={17} /></>}
          </button>

          <div className="trust-row-centered">
            <ShieldCheck size={16} />
            <span>Resume files remain stored securely in isolated local storage.</span>
          </div>

          {api.useMock && <p className="demo-note">Demo mode is enabled.</p>}
        </form>
      </div>
    </main>
  );
}
