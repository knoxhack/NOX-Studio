import electron from "electron";
const { app } = electron;
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getReleasesRoot, resolveNoxMediaUrl } from "./media-store.mjs";

function slugify(value) {
  return String(value || "release")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "release";
}

function sanitizePlatform(platform) {
  return String(platform || "platform").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export async function createLocalReleasePackage({ project, publishKit, platform, finalExportAsset, posterAsset, thumbnailAsset, scenes, brandKit }) {
  if (!project) throw new Error("Project is required.");
  if (!finalExportAsset) throw new Error("Final export video is required.");

  const root = getReleasesRoot();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `${sanitizePlatform(platform)}-${timestamp}`;
  const packagePath = resolve(join(root, slugify(project.title), folderName));
  await mkdir(packagePath, { recursive: true });

  // Copy final MP4
  const finalVideoSource = await resolveNoxMediaUrl(finalExportAsset.fileUrl);
  if (!finalVideoSource || !existsSync(finalVideoSource)) {
    throw new Error("Final export video file not found on disk.");
  }
  const finalVideoName = `${slugify(project.title)}-final.mp4`;
  const finalVideoPath = join(packagePath, finalVideoName);
  await copyFile(finalVideoSource, finalVideoPath);

  // Optional poster/thumbnail
  const copiedFiles = [finalVideoName];
  if (posterAsset?.fileUrl) {
    const source = await resolveNoxMediaUrl(posterAsset.fileUrl);
    if (source && existsSync(source)) {
      const ext = source.split(".").pop() || "png";
      const name = `poster.${ext}`;
      await copyFile(source, join(packagePath, name));
      copiedFiles.push(name);
    }
  }
  if (thumbnailAsset?.fileUrl) {
    const source = await resolveNoxMediaUrl(thumbnailAsset.fileUrl);
    if (source && existsSync(source)) {
      const ext = source.split(".").pop() || "png";
      const name = `thumbnail.${ext}`;
      await copyFile(source, join(packagePath, name));
      copiedFiles.push(name);
    }
  }

  const metadata = buildMetadataJson({ project, publishKit, platform, finalVideoName, scenes, brandKit });
  const description = buildDescription({ project, publishKit, platform });
  const hashtags = buildHashtags(publishKit);
  const captions = buildCaptions(scenes);
  const checklist = buildChecklist({ project, publishKit, platform, finalVideoName });

  await writeFile(join(packagePath, "metadata.json"), JSON.stringify(metadata, null, 2));
  await writeFile(join(packagePath, "description.txt"), description);
  await writeFile(join(packagePath, "hashtags.txt"), hashtags);
  await writeFile(join(packagePath, "captions.txt"), captions);
  await writeFile(join(packagePath, "checklist.md"), checklist);

  copiedFiles.push("metadata.json", "description.txt", "hashtags.txt", "captions.txt", "checklist.md");

  return {
    id: randomUUID(),
    packagePath,
    platform,
    files: copiedFiles,
    metadata,
  };
}

function buildMetadataJson({ project, publishKit, platform, finalVideoName, scenes, brandKit }) {
  return {
    schemaVersion: 1,
    platform,
    project: {
      id: project.id,
      title: project.title,
      type: project.type,
      format: project.format,
      runtime: project.runtime,
      genre: project.genre,
      tone: project.tone,
      language: project.language,
      logline: project.logline,
      synopsis: project.synopsis,
    },
    release: {
      title: platform === "YouTube" ? publishKit?.youtubeTitle : publishKit?.tiktokTitle,
      caption: publishKit?.caption,
      hookLine: publishKit?.hookLine,
      pinnedComment: publishKit?.pinnedComment,
      description: publishKit?.description,
      tags: publishKit?.tags,
      hashtags: publishKit?.hashtags,
      chapters: publishKit?.chapters,
      runtime: publishKit?.runtime,
    },
    finalVideo: finalVideoName,
    sceneCount: scenes?.length || 0,
    sceneTitles: scenes?.map((s) => `${s.number}. ${s.title}`) || [],
    brandKit: brandKit
      ? {
          studioName: brandKit.studioName,
          creatorName: brandKit.creatorName,
          defaultStyle: brandKit.defaultStyle,
          colors: brandKit.colors,
        }
      : undefined,
    exportedAt: new Date().toISOString(),
    uploadStatus: "Ready to Upload",
  };
}

function buildDescription({ project, publishKit, platform }) {
  const title = platform === "YouTube" ? publishKit?.youtubeTitle : publishKit?.tiktokTitle;
  const lines = [
    title || project.title,
    "",
    publishKit?.description || project.synopsis || "",
    "",
    "Hashtags:",
    buildHashtags(publishKit),
  ];
  return lines.join("\n").trim();
}

function buildHashtags(publishKit) {
  const tags = publishKit?.hashtags || [];
  return tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
}

function buildCaptions(scenes) {
  if (!scenes?.length) return "";
  return scenes
    .map((scene, index) => {
      const start = formatTimestamp(index * scene.durationSeconds);
      return `${index + 1}\n${start} --> ${formatTimestamp((index + 1) * scene.durationSeconds)}\n${scene.title}\n`;
    })
    .join("\n");
}

function formatTimestamp(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildChecklist({ project, publishKit, platform, finalVideoName }) {
  const lines = [
    `# Release Checklist: ${project.title}`,
    "",
    `- [ ] Final video reviewed: ${finalVideoName}`,
    `- [ ] Platform selected: ${platform}`,
    `- [ ] Title/caption finalized`,
    `- [ ] Description and hashtags copied`,
    `- [ ] Thumbnail/poster attached (if available)`,
    `- [ ] Captions uploaded or burned in`,
    `- [ ] Tags and chapters set`,
    `- [ ] Scheduled or published manually on ${platform}`,
    "",
    `Exported from NOX Studio at ${new Date().toISOString()}`,
  ];
  return lines.join("\n");
}
