import { ArrowRight, KeyRound, Mail, Sparkles } from "lucide-react";
import { useState } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient";

type LoginScreenProps = {
  error?: string;
  message?: string;
  onEnter: (email: string, password: string) => void;
  onCreateAccount: (email: string, password: string, displayName: string) => void;
  onResetPassword: (email: string) => void;
  onGoogle: () => void;
};

type AuthMode = "signin" | "signup" | "reset";

export function LoginScreen({ error, message, onEnter, onCreateAccount, onResetPassword, onGoogle }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState(isSupabaseConfigured ? "" : "knox@noxfilms.studio");
  const [password, setPassword] = useState(isSupabaseConfigured ? "" : "noxstudio");
  const [displayName, setDisplayName] = useState("Knox");

  const title = mode === "signin" ? "Enter Studio" : mode === "signup" ? "Create Studio Access" : "Reset Access";
  const subtitle =
    mode === "signin"
      ? "Continue to the production command center."
      : mode === "signup"
        ? "Create a Supabase-backed creator account."
        : "Send a password reset link to your email.";

  const submit = () => {
    if (mode === "signup") {
      onCreateAccount(email, password, displayName);
      return;
    }
    if (mode === "reset") {
      onResetPassword(email);
      return;
    }
    onEnter(email, password);
  };

  return (
    <div className="login-screen">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-brand">
        <span className="brand-mark login-mark">NX</span>
        <div>
          <h1>NOX Studio</h1>
          <p>Private AI Film Studio</p>
        </div>
      </div>

      <section className="login-card">
        <div className="login-card-head">
          <Sparkles size={22} />
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="auth-mode-tabs" aria-label="Auth mode">
          <button className={mode === "signin" ? "is-active" : ""} type="button" onClick={() => setMode("signin")}>
            Sign In
          </button>
          <button className={mode === "signup" ? "is-active" : ""} type="button" onClick={() => setMode("signup")}>
            Create
          </button>
          <button className={mode === "reset" ? "is-active" : ""} type="button" onClick={() => setMode("reset")}>
            Reset
          </button>
        </div>
        {mode === "signup" ? (
          <label>
            <span>Creator name</span>
            <div className="input-with-icon">
              <Sparkles size={17} />
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
          </label>
        ) : null}
        <label>
          <span>Email</span>
          <div className="input-with-icon">
            <Mail size={17} />
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </label>
        {mode !== "reset" ? (
          <label>
            <span>Password</span>
            <div className="input-with-icon">
              <KeyRound size={17} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
          </label>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}
        <button className="primary-button wide-button" onClick={submit} type="button">
          {mode === "signin" ? "Enter Studio" : mode === "signup" ? "Create Account" : "Send Reset Email"}
          <ArrowRight size={18} />
        </button>
        {mode !== "reset" ? (
          <button className="ghost-button wide-button" onClick={onGoogle} type="button">
            Continue with Google
          </button>
        ) : null}
        <p className="login-mode">
          {isSupabaseConfigured ? "Supabase auth enabled." : "Local demo auth active until Supabase env vars are set."}
        </p>
      </section>
    </div>
  );
}
