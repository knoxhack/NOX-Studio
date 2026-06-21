import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";
import { isDesktop, desktopFiles } from "./desktopBridge";
import type { StudioAsset } from "../types";

export type UploadTarget = "Video" | "Image" | "Audio" | "Poster" | "Prompt Export" | "Final Export" | "Brand File";

const bucketByType: Record<UploadTarget, string> = {
  Video: "nox-videos",
  Image: "nox-images",
  Audio: "nox-audio",
  Poster: "nox-images",
  "Prompt Export": "nox-exports",
  "Final Export": "nox-exports",
  "Brand File": "nox-brand",
};

export async function uploadStudioFile({
  workspaceId,
  projectId,
  sceneId,
  characterId,
  brandFile,
  file,
  type,
}: {
  workspaceId: string;
  projectId?: string;
  sceneId?: string;
  characterId?: string;
  brandFile?: boolean;
  file?: File;
  type: UploadTarget;
}) {
  const bucket = bucketByType[type];

  if (isDesktop()) {
    const result = await desktopFiles.importUserFile({
      workspaceId,
      projectId,
      sceneId,
      characterId,
      brandFile,
      type: type as StudioAsset["type"],
    });
    if (result.canceled) {
      return {
        mode: "desktop" as const,
        bucket,
        path: "",
        publicUrl: "",
        error: "Canceled",
      };
    }
    const asset = result.asset!;
    return {
      mode: "desktop" as const,
      bucket,
      path: asset.storagePath,
      publicUrl: asset.url,
      filePath: asset.filePath,
      mimeType: asset.mimeType,
      filename: asset.filename,
      error: "",
    };
  }

  const objectName = makeStorageObjectName(file?.name || "upload");
  const path = characterId
    ? [workspaceId, "characters", characterId, objectName].join("/")
    : brandFile
      ? [workspaceId, "brand", objectName].join("/")
    : [workspaceId, projectId, sceneId, objectName].filter(Boolean).join("/");

  const supabase = await getSupabaseClient();
  if (!isSupabaseConfigured || !supabase) {
    return {
      mode: "local" as const,
      bucket,
      path,
      publicUrl: file && typeof URL !== "undefined" ? URL.createObjectURL(file) : "",
      error: "",
    };
  }

  if (!file) {
    return {
      mode: "supabase" as const,
      bucket,
      path,
      publicUrl: "",
      error: "No file provided.",
    };
  }

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });

  if (error) {
    return {
      mode: "supabase" as const,
      bucket,
      path,
      publicUrl: "",
      error: error.message,
    };
  }

  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);

  return {
    mode: "supabase" as const,
    bucket,
    path,
    publicUrl: data?.signedUrl ?? "",
    error: "",
  };
}

function makeStorageObjectName(filename: string) {
  const rawName = filename.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim() || "upload";
  const dotIndex = rawName.lastIndexOf(".");
  const stem = dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
  const extension = dotIndex > 0 ? rawName.slice(dotIndex).toLowerCase() : "";
  const safeStem = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "upload";
  const safeExtension = extension.replace(/[^a-z0-9.]/g, "").slice(0, 24);
  return `${makeStoragePathId()}-${safeStem}${safeExtension}`;
}

function makeStoragePathId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
