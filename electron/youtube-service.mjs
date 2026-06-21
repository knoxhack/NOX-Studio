import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import electron from "electron";
import { resolveNoxMediaUrl } from "./media-store.mjs";
const { app, safeStorage, shell } = electron;

const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const TOKEN_FILE = "youtube-tokens.enc";

function getSecretsDir() {
  return join(app.getPath("userData"), "secrets");
}

async function getTokenPath() {
  const dir = getSecretsDir();
  await mkdir(dir, { recursive: true });
  return join(dir, TOKEN_FILE);
}

async function saveTokens(tokens) {
  const path = await getTokenPath();
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
  await writeFile(path, encrypted);
}

async function loadTokens() {
  try {
    const path = await getTokenPath();
    const encrypted = await readFile(path);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

export async function getYouTubeAuthStatus() {
  const tokens = await loadTokens();
  return {
    connected: Boolean(tokens?.refresh_token),
    expiresAt: tokens?.expires_at,
  };
}

export async function startYouTubeDeviceAuth({ clientId, clientSecret }) {
  const response = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: YOUTUBE_SCOPES.join(" "),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google device code request failed.");
  }

  if (data.verification_url && data.user_code) {
    try {
      await shell.openExternal(data.verification_url);
    } catch {
      // Ignore open errors.
    }
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    expiresIn: data.expires_in,
    interval: data.interval,
    clientId,
    clientSecret,
  };
}

export async function pollYouTubeDeviceToken({ deviceCode, clientId, clientSecret }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const data = await response.json();
  if (data.error === "authorization_pending") {
    return { status: "pending" };
  }
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    client_id: clientId,
    client_secret: clientSecret,
  };
  await saveTokens(tokens);
  return { status: "connected" };
}

async function refreshAccessToken() {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) throw new Error("YouTube is not connected.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: tokens.client_id,
      client_secret: tokens.client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Token refresh failed.");
  }

  const updated = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  await saveTokens(updated);
  return updated.access_token;
}

async function getYouTubeAccessToken() {
  const tokens = await loadTokens();
  if (!tokens) throw new Error("YouTube is not connected.");
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60_000) {
    return tokens.access_token;
  }
  return refreshAccessToken();
}

export async function disconnectYouTube() {
  const tokens = await loadTokens();
  if (tokens?.access_token) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.access_token }),
      });
    } catch {
      // Ignore revoke errors.
    }
  }
  const path = await getTokenPath();
  await writeFile(path, "");
  return { disconnected: true };
}

export async function uploadYouTubeVideo({ title, description, tags = [], categoryId = "22", privacyStatus = "private", videoPath, videoUrl }) {
  const accessToken = await getYouTubeAccessToken();

  let resolvedPath = videoPath;
  if (!resolvedPath && videoUrl?.startsWith("nox-media://")) {
    resolvedPath = await resolveNoxMediaUrl(videoUrl);
  }
  if (!resolvedPath || !existsSync(resolvedPath)) {
    throw new Error("Video file not found. Render a Final Export first.");
  }
  videoPath = resolvedPath;

  const metadata = {
    snippet: {
      title,
      description,
      tags,
      categoryId,
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };

  const initResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String((await import("node:fs")).statSync(videoPath).size),
    },
    body: JSON.stringify(metadata),
  });

  if (!initResponse.ok) {
    const text = await initResponse.text().catch(() => "");
    throw new Error(`YouTube upload initialization failed (${initResponse.status}): ${text}`);
  }

  const uploadUrl = initResponse.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL.");

  const { readFile } = await import("node:fs/promises");
  const videoBuffer = await readFile(videoPath);

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBuffer.length),
    },
    body: videoBuffer,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    throw new Error(`YouTube upload failed (${uploadResponse.status}): ${text}`);
  }

  const data = await uploadResponse.json();
  return {
    videoId: data.id,
    url: `https://youtu.be/${data.id}`,
    status: data.status?.uploadStatus,
  };
}
