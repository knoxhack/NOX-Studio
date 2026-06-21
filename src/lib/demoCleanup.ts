import type {
  CharacterProfile,
  FactionEntry,
  GenerationJob,
  LocationEntry,
  PublishKit,
  SceneCard,
  StudioAsset,
  StudioState,
  TimelineItem,
  WorldEntry,
} from "../types";
import { getAll, remove, STORES, type StoreName } from "./localDatabase";

const demoProjectIds = new Set(["neon-shadows", "ashfall-signal", "error-404"]);
const demoSceneIds = new Set(["scene-01", "scene-02", "scene-03", "scene-04", "scene-05", "scene-06"]);
const demoAssetIds = new Set(["asset-01", "asset-02", "asset-03", "asset-04"]);
const demoCharacterIds = new Set(["kael", "mara"]);
const demoWorldIds = new Set(["nox-city"]);
const demoLocationIds = new Set(["location-blackout-district", "location-underground-market", "location-flooded-subway"]);
const demoFactionIds = new Set(["faction-drone-police", "faction-black-signal-cult", "faction-market-runners"]);
const demoJobIds = new Set(["job-01", "job-02", "job-03", "job-04"]);
const demoPublishKitIds = new Set(["publish-neon-shadows"]);
const demoTimelineItemIds = new Set(["timeline-scene-01", "timeline-scene-04", "timeline-music", "timeline-subtitles"]);

export function cleanupSeededDemoData(state: StudioState): StudioState {
  const projects = state.projects.filter((project) => !demoProjectIds.has(project.id));
  const scenes = state.scenes.filter((scene) => !isDemoScene(scene));
  const assets = state.assets.filter((asset) => !isDemoAsset(asset));
  const characters = state.characters.filter((character) => !demoCharacterIds.has(character.id));
  const worlds = state.worlds.filter((world) => !demoWorldIds.has(world.id));
  const locations = state.locations.filter((location) => !isDemoLocation(location));
  const factions = state.factions.filter((faction) => !isDemoFaction(faction));
  const generationJobs = state.generationJobs.filter((job) => !isDemoJob(job));
  const publishKits = state.publishKits.filter((kit) => !isDemoPublishKit(kit));
  const timelineItems = state.timelineItems.filter((item) => !isDemoTimelineItem(item));

  return {
    ...state,
    projects,
    scenes,
    assets,
    characters,
    worlds,
    locations,
    factions,
    generationJobs,
    publishKits,
    timelineItems,
  };
}

export async function cleanupSeededLocalDatabase(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;

  try {
    await Promise.all([
      removeKnownIds(STORES.projects, demoProjectIds),
      removeKnownIds(STORES.scenes, demoSceneIds),
      removeKnownIds(STORES.assets, demoAssetIds),
      removeKnownIds(STORES.characters, demoCharacterIds),
      removeKnownIds(STORES.worlds, demoWorldIds),
      removeKnownIds(STORES.locations, demoLocationIds),
      removeKnownIds(STORES.factions, demoFactionIds),
      removeKnownIds(STORES.generationJobs, demoJobIds),
      removeKnownIds(STORES.publishKits, demoPublishKitIds),
      removeKnownIds(STORES.timelineItems, demoTimelineItemIds),
      removeRelatedRecords(STORES.scenes, isDemoScene),
      removeRelatedRecords(STORES.assets, isDemoAsset),
      removeRelatedRecords(STORES.locations, isDemoLocation),
      removeRelatedRecords(STORES.factions, isDemoFaction),
      removeRelatedRecords(STORES.generationJobs, isDemoJob),
      removeRelatedRecords(STORES.publishKits, isDemoPublishKit),
      removeRelatedRecords(STORES.timelineItems, isDemoTimelineItem),
    ]);
  } catch {
    // Cleanup is best-effort; state normalization also filters seeded records.
  }
}

function isDemoScene(scene: Pick<SceneCard, "id" | "projectId">) {
  return demoSceneIds.has(scene.id) || demoProjectIds.has(scene.projectId);
}

function isDemoAsset(asset: Pick<StudioAsset, "id" | "projectId" | "sceneId">) {
  return (
    demoAssetIds.has(asset.id) ||
    Boolean(asset.projectId && demoProjectIds.has(asset.projectId)) ||
    Boolean(asset.sceneId && demoSceneIds.has(asset.sceneId))
  );
}

function isDemoLocation(location: Pick<LocationEntry, "id" | "worldId">) {
  return demoLocationIds.has(location.id) || Boolean(location.worldId && demoWorldIds.has(location.worldId));
}

function isDemoFaction(faction: Pick<FactionEntry, "id" | "worldId">) {
  return demoFactionIds.has(faction.id) || Boolean(faction.worldId && demoWorldIds.has(faction.worldId));
}

function isDemoJob(job: Pick<GenerationJob, "id" | "projectId" | "sceneId">) {
  return (
    demoJobIds.has(job.id) ||
    Boolean(job.projectId && demoProjectIds.has(job.projectId)) ||
    Boolean(job.sceneId && demoSceneIds.has(job.sceneId))
  );
}

function isDemoPublishKit(kit: Pick<PublishKit, "id" | "projectId">) {
  return demoPublishKitIds.has(kit.id) || demoProjectIds.has(kit.projectId);
}

function isDemoTimelineItem(item: Pick<TimelineItem, "id" | "projectId" | "sceneId" | "assetId">) {
  return (
    demoTimelineItemIds.has(item.id) ||
    demoProjectIds.has(item.projectId) ||
    Boolean(item.sceneId && demoSceneIds.has(item.sceneId)) ||
    Boolean(item.assetId && demoAssetIds.has(item.assetId))
  );
}

async function removeKnownIds(storeName: StoreName, ids: Set<string>) {
  await Promise.all([...ids].map((id) => remove(storeName, id).catch(() => undefined)));
}

async function removeRelatedRecords<T extends { id: string }>(storeName: StoreName, predicate: (record: T) => boolean) {
  const records = await getAll<T>(storeName);
  const matchingIds = records.filter(predicate).map((record) => record.id);
  await Promise.all(matchingIds.map((id) => remove(storeName, id).catch(() => undefined)));
}
