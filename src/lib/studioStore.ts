import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { initialStudioState } from "../data/studioData";
import { cleanupSeededDemoData, cleanupSeededLocalDatabase } from "./demoCleanup";
import { getStudioRepository } from "./studioRepository";
import type { StudioState } from "../types";

const STORAGE_KEY = "nox-studio-state-v3";

function isStudioState(value: unknown): value is StudioState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<StudioState>;
  return (
    typeof state.schemaVersion === "number" &&
    Boolean(state.user) &&
    Boolean(state.workspace) &&
    Array.isArray(state.projects) &&
    Array.isArray(state.scenes) &&
    Array.isArray(state.assets) &&
    Array.isArray(state.characters) &&
    Array.isArray(state.worlds) &&
    Array.isArray(state.generationJobs) &&
    Array.isArray(state.publishKits) &&
    Array.isArray(state.timelineItems)
  );
}

function normalizeStudioState(state: StudioState): StudioState {
  const merged = {
    ...initialStudioState,
    ...state,
  };
  const projects = Array.isArray(merged.projects) ? merged.projects : initialStudioState.projects;
  const scenes = Array.isArray(merged.scenes) ? merged.scenes : initialStudioState.scenes;
  const assets = Array.isArray(merged.assets) ? merged.assets : initialStudioState.assets;
  const characters = Array.isArray(merged.characters) ? merged.characters : initialStudioState.characters;
  const worlds = Array.isArray(merged.worlds) ? merged.worlds : initialStudioState.worlds;
  const generationJobs = Array.isArray(merged.generationJobs) ? merged.generationJobs : initialStudioState.generationJobs;
  const publishKits = Array.isArray(merged.publishKits) ? merged.publishKits : initialStudioState.publishKits;
  const timelineItems = Array.isArray(merged.timelineItems) ? merged.timelineItems : initialStudioState.timelineItems;

  return cleanupSeededDemoData({
    ...merged,
    schemaVersion: initialStudioState.schemaVersion,
    projects,
    scenes,
    assets,
    characters: normalizeCharacterReferences(characters, assets),
    worlds,
    locations: Array.isArray(merged.locations) ? merged.locations : deriveLocationsFromWorlds(worlds),
    factions: Array.isArray(merged.factions) ? merged.factions : deriveFactionsFromWorlds(worlds),
    generationJobs,
    publishKits,
    timelineItems,
    providers: normalizeProviders(merged.providers),
  });
}

function normalizeProviders(providers: StudioState["providers"]) {
  const savedProviders = new Map((providers ?? []).map((provider) => [provider.id, provider]));
  return initialStudioState.providers.map((provider) => ({ ...provider, ...(savedProviders.get(provider.id) ?? {}) }));
}

function normalizeCharacterReferences(characters: StudioState["characters"], assets: StudioState["assets"]) {
  return characters.map((character) => {
    if (!character.referenceImageUrl?.startsWith("blob:")) return character;
    const referenceAsset =
      assets.find((asset) => asset.characterId === character.id && asset.tags.includes("character-reference")) ??
      assets.find((asset) => asset.characterId === character.id && asset.type === "Image");
    return {
      ...character,
      referenceImageUrl: referenceAsset?.storagePath ?? undefined,
    };
  });
}

function deriveLocationsFromWorlds(worlds: StudioState["worlds"]) {
  return worlds.flatMap((world) =>
    (world.locations ?? []).map((location, index) => ({
      id: `${world.id}-location-${index}`,
      workspaceId: world.workspaceId,
      worldId: world.id,
      name: location,
      description: `Location continuity record for ${world.name}.`,
      visualRules: world.visualRules ?? [],
      timelineNotes: world.timeline ?? [],
    })),
  );
}

function deriveFactionsFromWorlds(worlds: StudioState["worlds"]) {
  return worlds.flatMap((world) =>
    (world.factions ?? []).map((faction, index) => ({
      id: `${world.id}-faction-${index}`,
      workspaceId: world.workspaceId,
      worldId: world.id,
      name: faction,
      description: `Faction continuity record for ${world.name}.`,
      visualRules: world.visualRules ?? [],
      negativeRules: [],
      timelineNotes: world.timeline ?? [],
    })),
  );
}

function loadStudioState(): StudioState {
  if (typeof window === "undefined") return initialStudioState;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialStudioState;
    const parsed = JSON.parse(saved) as unknown;
    if (isStudioState(parsed)) return normalizeStudioState(parsed);
  } catch {
    return initialStudioState;
  }

  return initialStudioState;
}

async function loadIndexedDBState(workspaceId: string): Promise<Partial<StudioState> | undefined> {
  try {
    const repository = getStudioRepository();
    const result = await repository.loadWorkspaceState(workspaceId);
    if ("error" in result) return undefined;
    return result.data;
  } catch {
    return undefined;
  }
}

export function usePersistentStudioState() {
  const [state, setRawState] = useState<StudioState>(() => loadStudioState());
  const hydratedFromDB = useRef(false);
  const setState = useCallback((value: SetStateAction<StudioState>) => {
    setRawState((current) => {
      const nextState = typeof value === "function" ? (value as (current: StudioState) => StudioState)(current) : value;
      return normalizeStudioState(nextState);
    });
  }, []);

  useEffect(() => {
    void cleanupSeededLocalDatabase();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (hydratedFromDB.current || !state.workspace?.id) return;
    hydratedFromDB.current = true;

    void loadIndexedDBState(state.workspace.id).then((loaded) => {
      if (!loaded) return;
      setState((current) =>
        normalizeStudioState({
          ...current,
          schemaVersion: initialStudioState.schemaVersion,
          user: loaded.user ?? current.user,
          workspace: loaded.workspace ?? current.workspace,
          projects: loaded.projects ?? current.projects,
          scenes: loaded.scenes ?? current.scenes,
          assets: loaded.assets ?? current.assets,
          characters: loaded.characters ?? current.characters,
          worlds: loaded.worlds ?? current.worlds,
          locations: loaded.locations ?? current.locations,
          factions: loaded.factions ?? current.factions,
          generationJobs: loaded.generationJobs ?? current.generationJobs,
          publishKits: loaded.publishKits ?? current.publishKits,
          timelineItems: loaded.timelineItems ?? current.timelineItems,
          providers: loaded.providers ?? current.providers,
          brandKit: loaded.brandKit ?? current.brandKit,
        }),
      );
    });
  }, [state.workspace?.id]);

  const api = useMemo(
    () => ({
      reset: () => setState(initialStudioState),
      setState,
    }),
    [],
  );

  return { state, ...api };
}

export function nowLabel(date = new Date()) {
  try {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

export function makeId(_prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function downloadTextFile(filename: string, text: string, mimeType = "text/plain") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
