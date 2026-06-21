import type { User } from "@supabase/supabase-js";
import type { StudioUser } from "../types";
import { getById, put, STORES } from "./localDatabase";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

const LOCAL_USER_ID = "user-local";

export type SignInResult =
  | { ok: true; user: StudioUser; mode: "supabase" | "local" }
  | { ok: false; message: string };

export type SignUpResult =
  | { ok: true; user?: StudioUser; mode: "supabase" | "local"; message: string }
  | { ok: false; message: string };

export type PasswordResetResult = { ok: true; message: string } | { ok: false; message: string };

async function loadLocalUser(): Promise<StudioUser | undefined> {
  try {
    const user = await getById<StudioUser & { id: string }>(STORES.users, LOCAL_USER_ID);
    if (user) {
      const { id: _id, ...rest } = user;
      return rest as StudioUser;
    }
  } catch {
    // IndexedDB unavailable or empty.
  }
  return undefined;
}

async function saveLocalUser(user: StudioUser): Promise<void> {
  try {
    await put(STORES.users, { ...user, id: LOCAL_USER_ID });
  } catch {
    // Ignore persistence failures.
  }
}

export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    const user: StudioUser = {
      id: LOCAL_USER_ID,
      email,
      name: email.split("@")[0] || "NOX Creator",
    };
    await saveLocalUser(user);
    return { ok: true, mode: "local", user };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? "Supabase sign-in failed." };
  }

  return { ok: true, mode: "supabase", user: mapSupabaseUser(data.user, email) };
}

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<SignUpResult> {
  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    const user: StudioUser = {
      id: LOCAL_USER_ID,
      email,
      name: displayName.trim() || email.split("@")[0] || "NOX Creator",
    };
    await saveLocalUser(user);
    return { ok: true, mode: "local", message: "Local account created.", user };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: displayName.trim(),
        full_name: displayName.trim(),
      },
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) return { ok: false, message: error.message };

  if (data.user && data.session) {
    return {
      ok: true,
      mode: "supabase",
      message: "Account created and signed in.",
      user: mapSupabaseUser(data.user, email),
    };
  }

  return {
    ok: true,
    mode: "supabase",
    message: "Account created. Check your email to confirm access before signing in.",
  };
}

export async function sendPasswordReset(email: string): Promise<PasswordResetResult> {
  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return { ok: true, message: "Local accounts do not require a password reset." };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  return error ? { ok: false, message: error.message } : { ok: true, message: "Password reset email sent." };
}

export async function getCurrentStudioUser(): Promise<SignInResult> {
  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    const saved = await loadLocalUser();
    if (saved) {
      return { ok: true, mode: "local", user: saved };
    }
    return { ok: false, message: "No local session found. Sign in to continue." };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { ok: false, message: error?.message ?? "No active Supabase session." };
  }

  return { ok: true, mode: "supabase", user: mapSupabaseUser(data.user) };
}

export type GoogleSignInResult = { ok: true } | { ok: false; message: string };

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, message: "Google sign-in requires Supabase env vars." };
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });

  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const client = await getSupabaseClient();
    await client?.auth.signOut();
  }
}

function mapSupabaseUser(user: User, fallbackEmail = ""): StudioUser {
  const email = user.email ?? fallbackEmail;
  return {
    id: user.id,
    email,
    name: user.user_metadata.name ?? user.user_metadata.full_name ?? email.split("@")[0] ?? "NOX Creator",
  };
}
