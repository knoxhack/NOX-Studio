import type { PostgrestError } from "@supabase/supabase-js";
import { initialStudioState } from "../data/studioData";
import type {
  BrandKit,
  CharacterProfile,
  FactionEntry,
  GenerationJob,
  LocationEntry,
  ProductionPackage,
  Project,
  Provider,
  PublishKit,
  SceneBeat,
  SceneCard,
  StudioAsset,
  StudioState,
  StudioUser,
  TimelineItem,
  Workspace,
  WorldEntry,
} from "../types";
import { makeId } from "./studioStore";
import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

type DbRow = Record<string, any>;

export type RepositoryResult<T> = { data: T; error?: never } | { data?: never; error: string };

export type StudioRepository = {
  mode: "local" | "supabase";
  ensureWorkspaceForUser(user: StudioUser): Promise<RepositoryResult<Workspace>>;
  loadWorkspaceState(workspaceId: string): Promise<RepositoryResult<Partial<StudioState>>>;
  saveProductionPackage(productionPackage: ProductionPackage): Promise<RepositoryResult<ProductionPackage>>;
  createProject(project: Project): Promise<RepositoryResult<Project>>;
  updateProject(project: Project): Promise<RepositoryResult<Project>>;
  deleteProject(projectId: string): Promise<RepositoryResult<{ id: string }>>;
  upsertScene(scene: SceneCard): Promise<RepositoryResult<SceneCard>>;
  deleteScene(sceneId: string): Promise<RepositoryResult<{ id: string }>>;
  createAsset(asset: StudioAsset): Promise<RepositoryResult<StudioAsset>>;
  updateAsset(asset: StudioAsset): Promise<RepositoryResult<StudioAsset>>;
  deleteAsset(assetId: string): Promise<RepositoryResult<{ id: string }>>;
  upsertCharacter(character: CharacterProfile): Promise<RepositoryResult<CharacterProfile>>;
  deleteCharacter(characterId: string): Promise<RepositoryResult<{ id: string }>>;
  upsertWorld(world: WorldEntry): Promise<RepositoryResult<WorldEntry>>;
  deleteWorld(worldId: string): Promise<RepositoryResult<{ id: string }>>;
  upsertLocation(location: LocationEntry): Promise<RepositoryResult<LocationEntry>>;
  deleteLocation(locationId: string): Promise<RepositoryResult<{ id: string }>>;
  upsertFaction(faction: FactionEntry): Promise<RepositoryResult<FactionEntry>>;
  deleteFaction(factionId: string): Promise<RepositoryResult<{ id: string }>>;
  createGenerationJob(job: GenerationJob): Promise<RepositoryResult<GenerationJob>>;
  upsertGenerationJob(job: GenerationJob): Promise<RepositoryResult<GenerationJob>>;
  upsertPublishKit(kit: PublishKit): Promise<RepositoryResult<PublishKit>>;
  upsertTimelineItem(item: TimelineItem): Promise<RepositoryResult<TimelineItem>>;
  upsertBrandKit(brandKit: BrandKit, workspaceId: string): Promise<RepositoryResult<BrandKit>>;
  upsertProvider(provider: Provider, workspaceId: string): Promise<RepositoryResult<Provider>>;
};

export function getStudioRepository(): StudioRepository {
  return isSupabaseConfigured ? supabaseStudioRepository : localStudioRepository;
}

import { getAll, getById, put, remove, STORES, type StoreName } from "./localDatabase";

const localStudioRepository: StudioRepository = {
  mode: "local",
  async ensureWorkspaceForUser(user) {
    const existing = await getWorkspaceByOwnerId(user.id);
    if (existing) return { data: existing };

    const workspace: Workspace = {
      id: initialStudioState.workspace.id,
      name: initialStudioState.workspace.name,
      ownerId: user.id,
      plan: "Studio",
    };
    await put(STORES.workspaces, workspace);
    await put(STORES.users, { ...user, workspaceId: workspace.id });
    await put(STORES.brandKit, { ...initialStudioState.brandKit, id: workspace.id, workspaceId: workspace.id });
    for (const provider of initialStudioState.providers) {
      await put(STORES.providers, { ...provider, workspaceId: workspace.id });
    }
    return { data: workspace };
  },
  async loadWorkspaceState(workspaceId) {
    const [workspace, projects, scenes, assets, characters, worlds, locations, factions, jobs, kits, timeline, brandKit, providers] = await Promise.all([
      getById<Workspace>(STORES.workspaces, workspaceId),
      getAllByWorkspaceId<Project>(STORES.projects, workspaceId),
      getAllByWorkspaceId<SceneCard>(STORES.scenes, workspaceId),
      getAllByWorkspaceId<StudioAsset>(STORES.assets, workspaceId),
      getAllByWorkspaceId<CharacterProfile>(STORES.characters, workspaceId),
      getAllByWorkspaceId<WorldEntry>(STORES.worlds, workspaceId),
      getAllByWorkspaceId<LocationEntry>(STORES.locations, workspaceId),
      getAllByWorkspaceId<FactionEntry>(STORES.factions, workspaceId),
      getAllByWorkspaceId<GenerationJob>(STORES.generationJobs, workspaceId),
      getAll<PublishKit>(STORES.publishKits),
      getAll<TimelineItem>(STORES.timelineItems),
      getById<BrandKit & { id: string; workspaceId: string }>(STORES.brandKit, workspaceId),
      getAllByWorkspaceId<Provider>(STORES.providers, workspaceId),
    ]);

    if (!workspace) return { data: {} };

    const workspaceProjectIds = new Set(projects.map((p) => p.id));
    return {
      data: {
        workspace,
        projects: projects.length ? projects : undefined,
        scenes: scenes.length ? scenes.filter((s) => workspaceProjectIds.has(s.projectId)) : undefined,
        assets: assets.length ? assets.filter((a) => a.workspaceId === workspaceId || workspaceProjectIds.has(a.projectId ?? "")) : undefined,
        characters: characters.length ? characters.filter((c) => c.workspaceId === workspaceId) : undefined,
        worlds: worlds.length ? worlds.filter((w) => w.workspaceId === workspaceId) : undefined,
        locations: locations.length ? locations.filter((l) => l.workspaceId === workspaceId) : undefined,
        factions: factions.length ? factions.filter((f) => f.workspaceId === workspaceId) : undefined,
        generationJobs: jobs.length ? jobs.filter((j) => j.workspaceId === workspaceId) : undefined,
        publishKits: kits.length ? kits.filter((k) => workspaceProjectIds.has(k.projectId)) : undefined,
        timelineItems: timeline.length ? timeline.filter((t) => workspaceProjectIds.has(t.projectId)) : undefined,
        brandKit: brandKit ? { ...initialStudioState.brandKit, ...stripId(brandKit) } : undefined,
        providers: providers.length ? mergeProviders(providers) : undefined,
      },
    };
  },
  async saveProductionPackage(productionPackage) {
    await put(STORES.projects, productionPackage.project);
    for (const character of productionPackage.characters) {
      await put(STORES.characters, character);
    }
    for (const world of productionPackage.worlds) {
      await put(STORES.worlds, world);
    }
    for (const location of productionPackage.locations) {
      await put(STORES.locations, location);
    }
    for (const faction of productionPackage.factions) {
      await put(STORES.factions, faction);
    }
    for (const scene of productionPackage.scenes) {
      await put(STORES.scenes, scene);
    }
    await put(STORES.publishKits, productionPackage.publishKit);
    for (const item of productionPackage.timelineItems) {
      await put(STORES.timelineItems, item);
    }
    for (const job of productionPackage.generationJobs) {
      await put(STORES.generationJobs, job);
    }
    return { data: productionPackage };
  },
  async createProject(project) {
    await put(STORES.projects, project);
    return { data: project };
  },
  async updateProject(project) {
    await put(STORES.projects, project);
    return { data: project };
  },
  async deleteProject(projectId) {
    await remove(STORES.projects, projectId);
    const scenes = await getAll<SceneCard>(STORES.scenes);
    for (const scene of scenes.filter((s) => s.projectId === projectId)) {
      await remove(STORES.scenes, scene.id);
    }
    return { data: { id: projectId } };
  },
  async upsertScene(scene) {
    await put(STORES.scenes, scene);
    return { data: scene };
  },
  async deleteScene(sceneId) {
    await remove(STORES.scenes, sceneId);
    return { data: { id: sceneId } };
  },
  async createAsset(asset) {
    await put(STORES.assets, asset);
    return { data: asset };
  },
  async updateAsset(asset) {
    await put(STORES.assets, asset);
    return { data: asset };
  },
  async deleteAsset(assetId) {
    await remove(STORES.assets, assetId);
    return { data: { id: assetId } };
  },
  async upsertCharacter(character) {
    await put(STORES.characters, character);
    return { data: character };
  },
  async deleteCharacter(characterId) {
    await remove(STORES.characters, characterId);
    return { data: { id: characterId } };
  },
  async upsertWorld(world) {
    await put(STORES.worlds, world);
    return { data: world };
  },
  async deleteWorld(worldId) {
    await remove(STORES.worlds, worldId);
    return { data: { id: worldId } };
  },
  async upsertLocation(location) {
    await put(STORES.locations, location);
    return { data: location };
  },
  async deleteLocation(locationId) {
    await remove(STORES.locations, locationId);
    return { data: { id: locationId } };
  },
  async upsertFaction(faction) {
    await put(STORES.factions, faction);
    return { data: faction };
  },
  async deleteFaction(factionId) {
    await remove(STORES.factions, factionId);
    return { data: { id: factionId } };
  },
  async createGenerationJob(job) {
    await put(STORES.generationJobs, job);
    return { data: job };
  },
  async upsertGenerationJob(job) {
    await put(STORES.generationJobs, job);
    return { data: job };
  },
  async upsertPublishKit(kit) {
    await put(STORES.publishKits, kit);
    return { data: kit };
  },
  async upsertTimelineItem(item) {
    await put(STORES.timelineItems, item);
    return { data: item };
  },
  async upsertBrandKit(brandKit, workspaceId) {
    await put(STORES.brandKit, { ...brandKit, id: workspaceId, workspaceId });
    return { data: brandKit };
  },
  async upsertProvider(provider, workspaceId) {
    await put(STORES.providers, { ...provider, workspaceId });
    return { data: provider };
  },
};

function stripId<T extends { id?: string; workspaceId?: string }>(value: T): Omit<T, "id" | "workspaceId"> {
  const { id: _id, workspaceId: _workspaceId, ...rest } = value;
  return rest;
}

async function getWorkspaceByOwnerId(ownerId: string): Promise<Workspace | undefined> {
  const all = await getAll<Workspace>(STORES.workspaces);
  return all.find((workspace) => workspace.ownerId === ownerId);
}

async function getAllByWorkspaceId<T>(storeName: StoreName, workspaceId: string): Promise<T[]> {
  const all = await getAll<T>(storeName);
  return all.filter((item: any) => item.workspaceId === workspaceId);
}

function mergeProviders(savedProviders: Provider[]) {
  const savedById = new Map(savedProviders.map((p) => [p.id, p]));
  return initialStudioState.providers.map((provider) => savedById.get(provider.id) ?? provider);
}

const supabaseStudioRepository: StudioRepository = {
  mode: "supabase",
  async ensureWorkspaceForUser(user) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      display_name: user.name,
    });
    if (profileError) return { error: profileError.message };

    const existing = await supabase
      .from("workspaces")
      .select("id,name,owner_id,plan")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing.error) return { error: existing.error.message };
    if (existing.data) {
      const workspace = rowToWorkspace(existing.data);
      if (workspace.ownerId === user.id) {
        const memberError = await ensureWorkspaceMembership(supabase, workspace.id, user.id, "owner");
        if (memberError) return { error: memberError };
      }
      return { data: workspace };
    }

    const workspace: Workspace = {
      id: makeId("workspace"),
      name: "NOX Films",
      ownerId: user.id,
      plan: "Studio",
    };

    const { error: workspaceError } = await supabase.from("workspaces").insert({
      id: workspace.id,
      name: workspace.name,
      owner_id: workspace.ownerId,
      plan: workspace.plan,
    });
    if (workspaceError) return { error: workspaceError.message };

    const memberError = await ensureWorkspaceMembership(supabase, workspace.id, user.id, "owner");
    if (memberError) return { error: memberError };

    const brandKitSeed = await supabase.from("brand_kits").upsert(brandKitToRow(initialStudioState.brandKit, workspace.id));
    if (brandKitSeed.error) return { error: brandKitSeed.error.message };
    const providerSettingsError = await seedProviderSettings(supabase, workspace.id);
    if (providerSettingsError) return { error: providerSettingsError };
    return { data: workspace };
  },
  async loadWorkspaceState(workspaceId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };

    const [
      workspaceResult,
      projectsResult,
      charactersResult,
      worldsResult,
      locationsResult,
      factionsResult,
      assetsResult,
      jobsResult,
      brandKitResult,
      providersResult,
    ] =
      await Promise.all([
        supabase.from("workspaces").select("id,name,owner_id,plan").eq("id", workspaceId).maybeSingle(),
        supabase.from("projects").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("characters").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("worlds").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("locations").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("factions").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        supabase.from("assets").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        supabase.from("generation_jobs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        supabase.from("brand_kits").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        supabase.from("provider_settings").select("*").eq("workspace_id", workspaceId).order("provider_id", { ascending: true }),
      ]);

    const baseError = firstError([
      workspaceResult.error,
      projectsResult.error,
      charactersResult.error,
      worldsResult.error,
      locationsResult.error,
      factionsResult.error,
      assetsResult.error,
      jobsResult.error,
      brandKitResult.error,
      providersResult.error,
    ]);
    if (baseError) return { error: baseError };

    const defaultSeedError = await backfillWorkspaceDefaults(supabase, workspaceId, brandKitResult.data, providersResult.data ?? []);
    if (defaultSeedError) return { error: defaultSeedError };

    const projectIds = (projectsResult.data ?? []).map((project) => project.id);
    const sceneResult = projectIds.length
      ? await supabase.from("scenes").select("*").in("project_id", projectIds).order("scene_number", { ascending: true })
      : { data: [], error: null };
    if (sceneResult.error) return { error: sceneResult.error.message };

    const sceneIds = (sceneResult.data ?? []).map((scene) => scene.id);
    const [beatsResult, kitsResult, timelineResult] = await Promise.all([
      sceneIds.length
        ? supabase.from("scene_beats").select("*").in("scene_id", sceneIds).order("beat_number", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("publish_kits").select("*").in("project_id", projectIds).order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? supabase.from("timeline_items").select("*").in("project_id", projectIds).order("order_index", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const relatedError = firstError([beatsResult.error, kitsResult.error, timelineResult.error]);
    if (relatedError) return { error: relatedError };

    const beatsByScene = groupBy(beatsResult.data ?? [], "scene_id");
    const scenes = (sceneResult.data ?? []).map((scene) => rowToScene(scene, beatsByScene.get(scene.id) ?? []));
    const projects = (projectsResult.data ?? []).map((project) => rowToProject(project, scenes));

    return {
      data: {
        workspace: workspaceResult.data ? rowToWorkspace(workspaceResult.data) : undefined,
        projects,
        scenes,
        assets: (assetsResult.data ?? []).map(rowToAsset),
        characters: (charactersResult.data ?? []).map(rowToCharacter),
        worlds: (worldsResult.data ?? []).map(rowToWorld),
        locations: (locationsResult.data ?? []).map(rowToLocation),
        factions: (factionsResult.data ?? []).map(rowToFaction),
        generationJobs: (jobsResult.data ?? []).map(rowToGenerationJob),
        publishKits: (kitsResult.data ?? []).map(rowToPublishKit),
        timelineItems: (timelineResult.data ?? []).map(rowToTimelineItem),
        brandKit: brandKitResult.data ? rowToBrandKit(brandKitResult.data) : initialStudioState.brandKit,
        providers: mergeProviderSettings(providersResult.data ?? []),
      },
    };
  },
  async saveProductionPackage(productionPackage) {
    const project = await this.createProject(productionPackage.project);
    if (project.error) return { error: project.error };

    for (const character of productionPackage.characters) {
      const result = await this.upsertCharacter(character);
      if (result.error) return { error: result.error };
    }

    for (const world of productionPackage.worlds) {
      const result = await this.upsertWorld(world);
      if (result.error) return { error: result.error };
    }

    for (const location of productionPackage.locations) {
      const result = await this.upsertLocation(location);
      if (result.error) return { error: result.error };
    }

    for (const faction of productionPackage.factions) {
      const result = await this.upsertFaction(faction);
      if (result.error) return { error: result.error };
    }

    for (const scene of productionPackage.scenes) {
      const result = await this.upsertScene(scene);
      if (result.error) return { error: result.error };
    }

    const kit = await this.upsertPublishKit(productionPackage.publishKit);
    if (kit.error) return { error: kit.error };

    for (const item of productionPackage.timelineItems) {
      const result = await this.upsertTimelineItem(item);
      if (result.error) return { error: result.error };
    }

    for (const job of productionPackage.generationJobs) {
      const result = await this.createGenerationJob(job);
      if (result.error) return { error: result.error };
    }

    return { data: productionPackage };
  },
  async createProject(project) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("projects").insert(projectToRow(project));
    return error ? { error: error.message } : { data: project };
  },
  async updateProject(project) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("projects").update(projectToRow(project)).eq("id", project.id);
    return error ? { error: error.message } : { data: project };
  },
  async deleteProject(projectId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const assetCleanup = await deleteLinkedAssets(supabase, "project_id", projectId);
    if (assetCleanup.error) return { error: assetCleanup.error };
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    return error ? { error: error.message } : { data: { id: projectId } };
  },
  async upsertScene(scene) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };

    const { error } = await supabase.from("scenes").upsert(sceneToRow(scene));
    if (error) return { error: error.message };

    const deleteBeats = await supabase.from("scene_beats").delete().eq("scene_id", scene.id);
    if (deleteBeats.error) return { error: deleteBeats.error.message };

    if (scene.beats.length) {
      const { error: beatsError } = await supabase.from("scene_beats").insert(scene.beats.map((beat, index) => beatToRow(beat, scene.id, index)));
      if (beatsError) return { error: beatsError.message };
    }

    return { data: scene };
  },
  async deleteScene(sceneId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const assetCleanup = await deleteLinkedAssets(supabase, "scene_id", sceneId);
    if (assetCleanup.error) return { error: assetCleanup.error };
    const timelineCleanup = await supabase.from("timeline_items").delete().eq("scene_id", sceneId);
    if (timelineCleanup.error) return { error: timelineCleanup.error.message };
    const { error } = await supabase.from("scenes").delete().eq("id", sceneId);
    return error ? { error: error.message } : { data: { id: sceneId } };
  },
  async createAsset(asset) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("assets").insert(assetToRow(asset));
    return error ? { error: error.message } : { data: asset };
  },
  async updateAsset(asset) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("assets").update(assetToRow(asset)).eq("id", asset.id);
    return error ? { error: error.message } : { data: asset };
  },
  async deleteAsset(assetId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    return deleteAssetRows(supabase, "id", assetId);
  },
  async upsertCharacter(character) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("characters").upsert(characterToRow(character));
    return error ? { error: error.message } : { data: character };
  },
  async deleteCharacter(characterId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("characters").delete().eq("id", characterId);
    return error ? { error: error.message } : { data: { id: characterId } };
  },
  async upsertWorld(world) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("worlds").upsert(worldToRow(world));
    return error ? { error: error.message } : { data: world };
  },
  async deleteWorld(worldId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("worlds").delete().eq("id", worldId);
    return error ? { error: error.message } : { data: { id: worldId } };
  },
  async upsertLocation(location) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("locations").upsert(locationToRow(location));
    return error ? { error: error.message } : { data: location };
  },
  async deleteLocation(locationId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("locations").delete().eq("id", locationId);
    return error ? { error: error.message } : { data: { id: locationId } };
  },
  async upsertFaction(faction) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("factions").upsert(factionToRow(faction));
    return error ? { error: error.message } : { data: faction };
  },
  async deleteFaction(factionId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("factions").delete().eq("id", factionId);
    return error ? { error: error.message } : { data: { id: factionId } };
  },
  async createGenerationJob(job) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("generation_jobs").insert(generationJobToRow(job));
    return error ? { error: error.message } : { data: job };
  },
  async upsertGenerationJob(job) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("generation_jobs").upsert(generationJobToRow(job));
    return error ? { error: error.message } : { data: job };
  },
  async upsertPublishKit(kit) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("publish_kits").upsert(publishKitToRow(kit), { onConflict: "project_id" });
    return error ? { error: error.message } : { data: kit };
  },
  async upsertTimelineItem(item) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("timeline_items").upsert(timelineItemToRow(item));
    return error ? { error: error.message } : { data: item };
  },
  async upsertBrandKit(brandKit, workspaceId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("brand_kits").upsert(brandKitToRow(brandKit, workspaceId), { onConflict: "workspace_id" });
    return error ? { error: error.message } : { data: brandKit };
  },
  async upsertProvider(provider, workspaceId) {
    const supabase = await getSupabaseClient();
    if (!supabase) return { error: "Supabase is not configured." };
    const { error } = await supabase.from("provider_settings").upsert(providerToRow(provider, workspaceId), { onConflict: "workspace_id,provider_id" });
    return error ? { error: error.message } : { data: provider };
  },
};

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof getSupabaseClient>>>;

async function ensureWorkspaceMembership(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: "owner" | "member",
) {
  const { error } = await supabase.from("workspace_members").upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      role,
    },
    { onConflict: "workspace_id,user_id" },
  );
  return error?.message;
}

async function seedProviderSettings(supabase: SupabaseClient, workspaceId: string) {
  const { error } = await supabase
    .from("provider_settings")
    .upsert(initialStudioState.providers.map((provider) => providerToRow(provider, workspaceId)), { onConflict: "workspace_id,provider_id" });
  return error?.message;
}

async function backfillWorkspaceDefaults(
  supabase: SupabaseClient,
  workspaceId: string,
  brandKitRow: DbRow | null,
  providerRows: DbRow[],
) {
  if (!brandKitRow) {
    const { error } = await supabase.from("brand_kits").upsert(brandKitToRow(initialStudioState.brandKit, workspaceId), { onConflict: "workspace_id" });
    if (error) return error.message;
  }

  const savedProviderIds = new Set(providerRows.map((row) => asText(row.provider_id)));
  const missingProviders = initialStudioState.providers.filter((provider) => !savedProviderIds.has(provider.id));
  if (!missingProviders.length) return undefined;

  const { error } = await supabase
    .from("provider_settings")
    .upsert(missingProviders.map((provider) => providerToRow(provider, workspaceId)), { onConflict: "workspace_id,provider_id" });
  return error?.message;
}

const assetStorageBuckets: Record<string, string> = {
  Video: "nox-videos",
  Image: "nox-images",
  Audio: "nox-audio",
  Poster: "nox-images",
  "Prompt Export": "nox-exports",
  "Final Export": "nox-exports",
  "Brand File": "nox-brand",
};

async function deleteLinkedAssets(
  supabase: SupabaseClient,
  column: "project_id" | "scene_id",
  id: string,
): Promise<RepositoryResult<{ id: string }>> {
  return deleteAssetRows(supabase, column, id);
}

async function deleteAssetRows(
  supabase: SupabaseClient,
  column: "id" | "project_id" | "scene_id",
  id: string,
): Promise<RepositoryResult<{ id: string }>> {
  const assets = await supabase.from("assets").select("type, metadata").eq(column, id);
  if (assets.error) return { error: assets.error.message };

  const pathsByBucket = new Map<string, string[]>();
  for (const asset of assets.data ?? []) {
    const metadata = asObject(asset.metadata);
    const storagePath = asText(metadata.storagePath);
    const bucket = assetStorageBuckets[asText(asset.type)];
    if (!storagePath || !bucket) continue;
    pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), storagePath]);
  }

  for (const [bucket, paths] of pathsByBucket) {
    await supabase.storage.from(bucket).remove(paths);
  }

  const deleted = await supabase.from("assets").delete().eq(column, id);
  return deleted.error ? { error: deleted.error.message } : { data: { id } };
}

function rowToWorkspace(row: DbRow): Workspace {
  return {
    id: asText(row.id),
    name: asText(row.name, "NOX Films"),
    ownerId: asText(row.owner_id),
    plan: asPlan(row.plan),
  };
}

function rowToProject(row: DbRow, scenes: SceneCard[]): Project {
  const metadata = asObject(row.metadata);
  const projectScenes = scenes.filter((scene) => scene.projectId === row.id);
  const generatedScenes = projectScenes.filter((scene) =>
    ["Video Uploaded", "Approved", "Added to Timeline", "Rendered", "Published"].includes(scene.status),
  ).length;

  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    title: asText(row.title, "Untitled NOX Film"),
    type: asText(row.type, "Shortfilm"),
    format: asText(row.format, "9:16 vertical"),
    runtime: asText(metadata.runtime, `${asNumber(row.duration_seconds, 60)} seconds`),
    sceneCount: asNumber(row.scene_count, Math.max(projectScenes.length, 1)),
    generatedScenes,
    status: asText(row.status, "Idea") as Project["status"],
    nextStep: asText(metadata.nextStep, generatedScenes < projectScenes.length ? `Generate Scene ${generatedScenes + 1}` : "Open NOX Cut"),
    genre: asText(row.genre, "Sci-fi"),
    tone: asText(row.tone, "Cinematic"),
    world: asText(row.world_name, ""),
    mainCharacters: asTextArray(metadata.mainCharacters),
    idea: asText(row.idea),
    aiTarget: asText(row.ai_target, "Manual Copy Mode"),
    language: asObject(row.language) as Project["language"],
    logline: asText(row.logline),
    synopsis: asText(row.synopsis),
    releaseStatus: asText(row.release_status, "Studio Draft") as Project["releaseStatus"],
    updatedAt: formatDate(row.updated_at),
    posterTone: asText(metadata.posterTone, "cyan") as Project["posterTone"],
  };
}

function rowToScene(row: DbRow, beatRows: DbRow[]): SceneCard {
  const metadata = asObject(row.metadata);
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    number: asNumber(row.scene_number, 1),
    title: asText(row.title, "UNTITLED SCENE"),
    purpose: asText(row.purpose),
    durationSeconds: asNumber(row.duration_seconds, 10),
    output: asText(row.output, "One generated video"),
    format: asText(row.format, "9:16 vertical cinematic"),
    location: asText(row.location),
    characters: asTextArray(row.characters),
    mood: asText(row.mood),
    visualStyle: asText(row.visual_style),
    summary: asText(row.summary),
    beats: beatRows.map(rowToBeat),
    dialogue: asText(row.dialogue),
    audio: asText(row.audio_notes),
    fullPrompt: asText(row.full_prompt),
    promptProvider: asText(metadata.promptProvider, undefined),
    promptCopiedAt: asText(metadata.promptCopiedAt, undefined),
    externalProvider: asText(metadata.externalProvider, undefined),
    negativePrompt: asText(row.negative_prompt),
    continuityRules: asTextArray(row.continuity_rules),
    status: asText(row.status, "Draft") as SceneCard["status"],
    uploadedAsset: asText(metadata.uploadedAsset, undefined),
    approvedAssetId: asText(row.approved_asset_id, undefined),
  };
}

function rowToBeat(row: DbRow): SceneBeat {
  return {
    id: asText(row.id),
    range: `${asNumber(row.start_second)}-${asNumber(row.end_second, 10)}s`,
    title: asText(row.title),
    description: asText(row.description),
    camera: asText(row.camera_direction),
    audio: asText(row.audio),
  };
}

function rowToAsset(row: DbRow): StudioAsset {
  const metadata = asObject(row.metadata);
  const providerResponse = asObject(metadata.providerResponse);
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    projectId: asText(row.project_id, undefined),
    sceneId: asText(row.scene_id, undefined),
    characterId: asText(row.character_id, undefined),
    filename: asText(row.filename),
    type: asText(row.type, "Video") as StudioAsset["type"],
    fileUrl: asText(row.file_url, undefined),
    storagePath: asText(metadata.storagePath, undefined),
    mimeType: asText(row.mime_type, undefined),
    attachedTo: asText(metadata.attachedTo, asText(row.filename)),
    status: asText(row.status, "Stored") as StudioAsset["status"],
    provider: asText(row.provider, "Uploaded"),
    duration: row.duration_seconds ? `${row.duration_seconds}s` : undefined,
    promptId: asText(row.prompt_id, undefined),
    promptUsed: asText(metadata.promptUsed, undefined),
    externalJobId: asText(metadata.externalJobId, undefined),
    providerModel: asText(metadata.providerModel, undefined),
    providerResponse: Object.keys(providerResponse).length ? providerResponse : undefined,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    notes: asText(row.notes),
    tags: asTextArray(row.tags),
    createdAt: formatDate(row.created_at),
  };
}

function rowToCharacter(row: DbRow): CharacterProfile {
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    name: asText(row.name),
    alias: asText(row.alias),
    role: asText(row.role),
    personality: asText(row.personality),
    backstory: asText(row.backstory),
    voice: asText(row.voice_style),
    accent: asText(row.accent),
    wardrobeRules: asTextArray(row.wardrobe_rules),
    visualIdentity: asText(row.visual_identity),
    referenceImageUrl: asText(row.reference_image_url, undefined),
    promptIdentity: asText(row.prompt_identity),
    negativeRules: asTextArray(row.negative_rules),
    appearsIn: asTextArray(row.appears_in),
  };
}

function rowToWorld(row: DbRow): WorldEntry {
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    name: asText(row.name),
    description: asText(row.description),
    tone: asText(row.tone),
    locations: asTextArray(row.locations),
    visualRules: asTextArray(row.visual_rules),
    technology: asTextArray(row.technology),
    factions: asTextArray(row.factions),
    recurringSymbols: asTextArray(row.recurring_symbols),
    timeline: asTextArray(row.timeline),
  };
}

function rowToLocation(row: DbRow): LocationEntry {
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    worldId: asText(row.world_id, undefined),
    name: asText(row.name),
    description: asText(row.description),
    visualRules: asTextArray(row.visual_rules),
    timelineNotes: asTextArray(row.timeline_notes),
  };
}

function rowToFaction(row: DbRow): FactionEntry {
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    worldId: asText(row.world_id, undefined),
    name: asText(row.name),
    description: asText(row.description),
    visualRules: asTextArray(row.visual_rules),
    negativeRules: asTextArray(row.negative_rules),
    timelineNotes: asTextArray(row.timeline_notes),
  };
}

function rowToGenerationJob(row: DbRow): GenerationJob {
  const outputPayload = asObject(row.output_payload);
  const providerResponse = asObject(outputPayload.response);
  return {
    id: asText(row.id),
    workspaceId: asText(row.workspace_id),
    projectId: asText(row.project_id, undefined),
    sceneId: asText(row.scene_id, undefined),
    task: asText(row.job_type, "Generation job"),
    project: asText(row.output_payload?.project, "NOX Project"),
    provider: asText(row.provider, "Manual Mode"),
    status: asText(row.status, "Queued") as GenerationJob["status"],
    cost: formatJobCost(row),
    costActual: row.cost_actual === null || row.cost_actual === undefined ? undefined : Number(row.cost_actual),
    costCurrency: asText(row.cost_currency, undefined),
    usageMetadata: asObject(row.usage_metadata),
    providerJobId: asText(outputPayload.externalJobId, asText(outputPayload.providerJobId, undefined)),
    providerResponse: Object.keys(providerResponse).length ? providerResponse : undefined,
    inputPayload: payloadToText(row.input_payload),
    outputPayload: row.output_payload ? payloadToText(row.output_payload) : undefined,
    errorMessage: asText(row.error_message, undefined),
    retryCount: asNumber(row.retry_count, 0),
    maxRetries: asNumber(row.max_retries, 2),
    logs: asTextArray(row.logs),
    priority: asNumber(row.priority, 0),
    runAfter: formatOptionalDate(row.run_after),
    lockedAt: formatOptionalDate(row.locked_at),
    lockedBy: asText(row.locked_by, undefined),
    startedAt: formatOptionalDate(row.started_at),
    completedAt: formatOptionalDate(row.completed_at),
    createdAt: formatDate(row.created_at),
  };
}

function rowToPublishKit(row: DbRow): PublishKit {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    tiktokTitle: asText(row.tiktok_title),
    caption: asText(row.caption),
    hashtags: asTextArray(row.hashtags),
    hookLine: asText(row.hook_line),
    pinnedComment: asText(row.pinned_comment),
    youtubeTitle: asText(row.youtube_title),
    description: asText(row.description),
    tags: asTextArray(row.tags),
    chapters: asTextArray(row.chapters),
    noxFilmsRow: asText(row.nox_films_row),
    runtime: asText(row.runtime),
    genre: asText(row.genre),
    releaseStatus: asText(row.release_status, "Studio Draft") as PublishKit["releaseStatus"],
    thumbnailPrompt: asText(row.thumbnail_prompt),
    posterPrompt: asText(row.poster_prompt),
    updatedAt: formatDate(row.updated_at),
  };
}

function rowToTimelineItem(row: DbRow): TimelineItem {
  return {
    id: asText(row.id),
    projectId: asText(row.project_id),
    sceneId: asText(row.scene_id, undefined),
    assetId: asText(row.asset_id, undefined),
    trackType: asText(row.track_type, "video") as TimelineItem["trackType"],
    label: asText(row.label),
    startTime: asNumber(row.start_time),
    endTime: asNumber(row.end_time),
    orderIndex: asNumber(row.order_index),
    transitionIn: asText(row.transition_in, "None"),
    transitionOut: asText(row.transition_out, "None"),
    textOverlay: asText(row.text_overlay, undefined),
    subtitleText: asText(row.subtitle_text, undefined),
    trimStartNote: asText(row.trim_start_note, undefined),
    trimEndNote: asText(row.trim_end_note, undefined),
    editorNotes: asText(row.editor_notes, undefined),
  };
}

function rowToBrandKit(row: DbRow): BrandKit {
  return {
    studioName: asText(row.studio_name, "NOX Films"),
    creatorName: asText(row.creator_name, "NOX Studio"),
    introText: asText(row.intro_text, "A NOX Films Original"),
    outroText: asText(row.outro_text, "Watch more on NOX Films"),
    watermarkAssetId: asText(row.watermark_asset_id, undefined),
    defaultStyle: asText(row.default_style, "Futuristic cyberglass cinematic"),
    defaultExport: asText(row.default_export, "9:16 TikTok + 16:9 YouTube"),
    subtitleStyle: asText(row.subtitle_style, "Bold white cinematic subtitles with shadow"),
    colors: asTextArray(row.default_colors),
    hashtags: asTextArray(row.default_hashtags),
  };
}

function rowToProvider(row: DbRow): Provider {
  return {
    id: asText(row.provider_id),
    name: asText(row.name),
    supportedTasks: asText(row.supported_tasks),
    speed: asText(row.speed),
    quality: asText(row.quality),
    enabled: Boolean(row.enabled),
    mode: asText(row.mode, "Manual") as Provider["mode"],
    apiEndpoint: asText(row.api_endpoint, undefined),
    secretName: asText(row.secret_name, undefined),
    webhookEnabled: Boolean(row.webhook_enabled),
    connectionStatus: asText(row.connection_status, "Not configured") as Provider["connectionStatus"],
    config: asObject(row.config),
  };
}

function mergeProviderSettings(rows: DbRow[]) {
  const savedProviders = new Map(rows.map((row) => [asText(row.provider_id), rowToProvider(row)]));
  return initialStudioState.providers.map((provider) => savedProviders.get(provider.id) ?? provider);
}

function projectToRow(project: Project) {
  return {
    id: project.id,
    workspace_id: project.workspaceId,
    type: project.type,
    title: project.title,
    slug: project.id,
    idea: project.idea,
    logline: project.logline,
    synopsis: project.synopsis,
    status: project.status,
    release_status: project.releaseStatus,
    format: project.format,
    duration_seconds: project.sceneCount * 10,
    scene_count: project.sceneCount,
    genre: project.genre,
    tone: project.tone,
    world_name: project.world,
    ai_target: project.aiTarget,
    language: project.language,
    metadata: {
      nextStep: project.nextStep,
      posterTone: project.posterTone,
      runtime: project.runtime,
      mainCharacters: project.mainCharacters,
    },
    updated_at: new Date().toISOString(),
  };
}

function sceneToRow(scene: SceneCard) {
  return {
    id: scene.id,
    project_id: scene.projectId,
    scene_number: scene.number,
    title: scene.title,
    purpose: scene.purpose,
    duration_seconds: scene.durationSeconds,
    output: scene.output,
    format: scene.format,
    location: scene.location,
    characters: scene.characters,
    mood: scene.mood,
    visual_style: scene.visualStyle,
    summary: scene.summary,
    full_prompt: scene.fullPrompt,
    negative_prompt: scene.negativePrompt,
    dialogue: scene.dialogue,
    audio_notes: scene.audio,
    continuity_rules: scene.continuityRules,
    status: scene.status,
    approved_asset_id: scene.approvedAssetId,
    metadata: {
      uploadedAsset: scene.uploadedAsset,
      promptProvider: scene.promptProvider,
      promptCopiedAt: scene.promptCopiedAt,
      externalProvider: scene.externalProvider,
    },
    updated_at: new Date().toISOString(),
  };
}

function beatToRow(beat: SceneBeat, sceneId: string, index: number) {
  const [start, end] = beat.range.replace(/s/g, "").split("-").map((value) => Number(value.trim()));
  return {
    id: beat.id,
    scene_id: sceneId,
    beat_number: index + 1,
    start_second: Number.isFinite(start) ? start : index === 0 ? 0 : index === 1 ? 3 : 7,
    end_second: Number.isFinite(end) ? end : index === 0 ? 3 : index === 1 ? 7 : 10,
    title: beat.title,
    description: beat.description,
    camera_direction: beat.camera,
    action: beat.description,
    audio: beat.audio,
  };
}

function assetToRow(asset: StudioAsset) {
  return {
    id: asset.id,
    workspace_id: asset.workspaceId,
    project_id: asset.projectId,
    scene_id: asset.sceneId,
    character_id: asset.characterId,
    type: asset.type,
    file_url: asset.fileUrl ?? "",
    mime_type: asset.mimeType ?? "",
    filename: asset.filename,
    status: asset.status,
    provider: asset.provider,
    notes: asset.notes,
    tags: asset.tags,
    duration_seconds: asset.duration ? Number(asset.duration.replace(/\D/g, "")) || null : null,
    prompt_id: asset.promptId,
    metadata: {
      attachedTo: asset.attachedTo,
      storagePath: asset.storagePath,
      promptUsed: asset.promptUsed,
      externalJobId: asset.externalJobId,
      providerModel: asset.providerModel,
      providerResponse: asset.providerResponse,
      width: asset.width,
      height: asset.height,
    },
  };
}

function characterToRow(character: CharacterProfile) {
  return {
    id: character.id,
    workspace_id: character.workspaceId,
    name: character.name,
    alias: character.alias,
    role: character.role,
    personality: character.personality,
    backstory: character.backstory,
    visual_identity: character.visualIdentity,
    reference_image_url: character.referenceImageUrl,
    voice_style: character.voice,
    accent: character.accent,
    wardrobe_rules: character.wardrobeRules,
    prompt_identity: character.promptIdentity,
    negative_rules: character.negativeRules,
    appears_in: character.appearsIn,
    updated_at: new Date().toISOString(),
  };
}

function worldToRow(world: WorldEntry) {
  return {
    id: world.id,
    workspace_id: world.workspaceId,
    name: world.name,
    description: world.description,
    tone: world.tone,
    locations: world.locations,
    visual_rules: world.visualRules,
    technology: world.technology,
    factions: world.factions,
    recurring_symbols: world.recurringSymbols,
    timeline: world.timeline,
    updated_at: new Date().toISOString(),
  };
}

function locationToRow(location: LocationEntry) {
  return {
    id: location.id,
    workspace_id: location.workspaceId,
    world_id: location.worldId,
    name: location.name,
    description: location.description,
    visual_rules: location.visualRules,
    timeline_notes: location.timelineNotes,
    updated_at: new Date().toISOString(),
  };
}

function factionToRow(faction: FactionEntry) {
  return {
    id: faction.id,
    workspace_id: faction.workspaceId,
    world_id: faction.worldId,
    name: faction.name,
    description: faction.description,
    visual_rules: faction.visualRules,
    negative_rules: faction.negativeRules,
    timeline_notes: faction.timelineNotes,
    updated_at: new Date().toISOString(),
  };
}

function generationJobToRow(job: GenerationJob) {
  return {
    id: job.id,
    workspace_id: job.workspaceId,
    project_id: job.projectId,
    scene_id: job.sceneId,
    job_type: job.task,
    provider: job.provider,
    status: job.status,
    input_payload: { text: job.inputPayload },
    output_payload: {
      text: job.outputPayload ?? "",
      project: job.project,
      externalJobId: job.providerJobId,
      providerJobId: job.providerJobId,
      response: job.providerResponse,
    },
    error_message: job.errorMessage ?? "",
    cost_estimate: parseCost(job.cost),
    cost_actual: job.costActual ?? null,
    cost_currency: job.costCurrency ?? "USD",
    usage_metadata: job.usageMetadata ?? {},
    retry_count: job.retryCount ?? 0,
    max_retries: job.maxRetries ?? 2,
    logs: job.logs ?? [],
    priority: job.priority ?? 0,
    run_after: dateOrNow(job.runAfter),
    locked_at: dateOrNull(job.lockedAt),
    locked_by: job.lockedBy ?? null,
    started_at: dateOrNull(job.startedAt),
    completed_at: dateOrNull(job.completedAt),
  };
}

function publishKitToRow(kit: PublishKit) {
  return {
    id: kit.id,
    project_id: kit.projectId,
    tiktok_title: kit.tiktokTitle,
    caption: kit.caption,
    hashtags: kit.hashtags,
    hook_line: kit.hookLine,
    pinned_comment: kit.pinnedComment,
    youtube_title: kit.youtubeTitle,
    description: kit.description,
    tags: kit.tags,
    chapters: kit.chapters,
    nox_films_row: kit.noxFilmsRow,
    runtime: kit.runtime,
    genre: kit.genre,
    thumbnail_prompt: kit.thumbnailPrompt,
    poster_prompt: kit.posterPrompt,
    release_status: kit.releaseStatus,
    updated_at: new Date().toISOString(),
  };
}

function timelineItemToRow(item: TimelineItem) {
  return {
    id: item.id,
    project_id: item.projectId,
    asset_id: item.assetId,
    scene_id: item.sceneId,
    track_type: item.trackType,
    label: item.label,
    start_time: item.startTime,
    end_time: item.endTime,
    order_index: item.orderIndex,
    transition_in: item.transitionIn,
    transition_out: item.transitionOut,
    text_overlay: item.textOverlay,
    subtitle_text: item.subtitleText,
    trim_start_note: item.trimStartNote,
    trim_end_note: item.trimEndNote,
    editor_notes: item.editorNotes,
  };
}

function brandKitToRow(brandKit: BrandKit, workspaceId: string) {
  return {
    workspace_id: workspaceId,
    studio_name: brandKit.studioName,
    creator_name: brandKit.creatorName,
    intro_text: brandKit.introText,
    outro_text: brandKit.outroText,
    watermark_asset_id: brandKit.watermarkAssetId ?? null,
    default_style: brandKit.defaultStyle,
    default_export: brandKit.defaultExport,
    subtitle_style: brandKit.subtitleStyle,
    default_colors: brandKit.colors,
    default_hashtags: brandKit.hashtags,
  };
}

function providerToRow(provider: Provider, workspaceId: string) {
  return {
    workspace_id: workspaceId,
    provider_id: provider.id,
    name: provider.name,
    supported_tasks: provider.supportedTasks,
    speed: provider.speed,
    quality: provider.quality,
    enabled: provider.enabled,
    mode: provider.mode,
    api_endpoint: provider.apiEndpoint ?? "",
    secret_name: provider.secretName ?? "",
    webhook_enabled: provider.webhookEnabled ?? false,
    connection_status: provider.connectionStatus ?? "Not configured",
    config: provider.config ?? {},
    updated_at: new Date().toISOString(),
  };
}

function firstError(errors: Array<PostgrestError | null>) {
  return errors.find(Boolean)?.message;
}

function groupBy(rows: DbRow[], key: string) {
  return rows.reduce((map, row) => {
    const value = row[key];
    const list = map.get(value) ?? [];
    list.push(row);
    map.set(value, list);
    return map;
  }, new Map<string, DbRow[]>());
}

function asText(value: unknown, fallback = "") {
  return typeof value === "string" && value.length ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asTextArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asPlan(value: unknown): Workspace["plan"] {
  return value === "Creator" || value === "Studio" || value === "Pro" ? value : "Creator";
}

function payloadToText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const object = asObject(value);
  if (typeof object.text === "string") return object.text;
  return JSON.stringify(value, null, 2);
}

function parseCost(cost: string) {
  const value = Number(cost.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function formatJobCost(row: DbRow) {
  if (row.cost_actual !== null && row.cost_actual !== undefined) {
    const currency = asText(row.cost_currency, "USD");
    return `${currency} ${Number(row.cost_actual).toFixed(2)} actual`;
  }
  if (row.cost_estimate !== null && row.cost_estimate !== undefined) {
    return `$${Number(row.cost_estimate).toFixed(2)} est`;
  }
  return "$0 est";
}

function dateOrNull(value: string | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function dateOrNow(value: string | undefined) {
  return dateOrNull(value) ?? new Date().toISOString();
}

function formatOptionalDate(value: unknown) {
  if (!value || typeof value !== "string") return undefined;
  return value;
}

function formatDate(value: unknown) {
  if (!value || typeof value !== "string") return "Just now";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
