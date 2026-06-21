import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { getCurrentStudioUser, sendPasswordReset, signInWithEmail, signInWithGoogle, signOut, signUpWithEmail } from "./lib/auth";
import {
  exportEditPlan,
  exportProjectJson,
  exportProjectMarkdown,
  exportProjectText,
  exportReleaseBundleJson,
  createReleaseOperationPlan,
  formatScenePrompt,
  generatePublishKit,
  promptProviderOptions,
  runContinuityCheck,
  type ReleasePlatform,
} from "./lib/noxCore";
import { generateConceptPackage, generateScenePrompt, runRemoteGenerationJob } from "./lib/generationGateway";
import { runGenerationJob } from "./lib/generationJobRunner";
import { createRenderManifest, exportRenderManifestJson, summarizeRenderReadiness } from "./lib/renderEngine";
import { downloadTextFile, makeId, nowLabel, usePersistentStudioState } from "./lib/studioStore";
import { getStudioRepository, type RepositoryResult } from "./lib/studioRepository";
import { uploadStudioFile } from "./lib/storage";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import {
  getFocusedGenerationJobs,
  getGenerationMode,
  getProjectWorkflowState,
  getSceneVideoState,
  isRenderGenerationJob,
  isSceneVideoGenerationJob as isWorkflowSceneVideoGenerationJob,
} from "./lib/workflowState";
import { AnalyticsScreen } from "./screens/AnalyticsScreen";
import { CommandCenter } from "./screens/CommandCenter";
import { CreateWizard } from "./screens/CreateWizard";
import { LoginScreen } from "./screens/LoginScreen";
import { NoxCut } from "./screens/NoxCut";
import { ProjectLibrary } from "./screens/ProjectLibrary";
import { PublishKitScreen } from "./screens/PublishKitScreen";
import { SceneComposer } from "./screens/SceneComposer";
import { ScriptRoom } from "./screens/ScriptRoom";
import { SettingsScreen } from "./screens/SettingsScreen";
import { VaultHub } from "./screens/VaultHub";
import type {
  CharacterProfile,
  BrandKit,
  FactionEntry,
  GenerationJob,
  LocationEntry,
  Project,
  Provider,
  PublishKit,
  SceneCard,
  SceneStatus,
  StudioAsset,
  StudioState,
  StudioUser,
  TimelineItem,
  ViewKey,
  Workspace,
  WorldEntry,
} from "./types";

const releasePlatforms: ReleasePlatform[] = ["TikTok", "YouTube", "NOX Films"];

function App() {
  const { state, setState } = usePersistentStudioState();
  const repository = useMemo(() => getStudioRepository(), []);
  const [signedIn, setSignedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [activeView, setActiveView] = useState<ViewKey>("command");
  const [selectedProjectId, setSelectedProjectId] = useState(state.projects[0]?.id ?? "");
  const [selectedSceneId, setSelectedSceneId] = useState(state.scenes[0]?.id ?? "");
  const [toast, setToast] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginMessage, setLoginMessage] = useState("");

  const activeProject = useMemo(
    () => state.projects.find((project) => project.id === selectedProjectId) ?? state.projects[0],
    [selectedProjectId, state.projects],
  );

  const activePublishKit = useMemo(
    () => state.publishKits.find((kit) => kit.projectId === activeProject?.id),
    [activeProject?.id, state.publishKits],
  );

  const releaseOperationPlans = useMemo(
    () => (activeProject ? releasePlatforms.map((platform) => createReleaseOperationPlan(state, activeProject.id, platform)) : []),
    [activeProject, state],
  );

  const projectScenes = useMemo(
    () =>
      state.scenes
        .filter((scene) => scene.projectId === activeProject?.id)
        .sort((a, b) => a.number - b.number),
    [activeProject?.id, state.scenes],
  );

  const selectedScene = useMemo(
    () => projectScenes.find((scene) => scene.id === selectedSceneId) ?? projectScenes[0] ?? state.scenes[0],
    [projectScenes, selectedSceneId, state.scenes],
  );

  const selectedContinuityReport = useMemo(
    () => (selectedScene ? runContinuityCheck(selectedScene, state.characters, state.worlds, state.locations, state.factions) : undefined),
    [selectedScene, state.characters, state.factions, state.locations, state.worlds],
  );

  const generationMode = useMemo(() => getGenerationMode(state), [state]);
  const selectedSceneVideoState = useMemo(
    () => (selectedScene ? getSceneVideoState(state, selectedScene.id) : undefined),
    [selectedScene, state],
  );
  const selectedSceneJobs = useMemo(
    () => (selectedScene ? getFocusedGenerationJobs(state, activeProject?.id, selectedScene.id).filter(isWorkflowSceneVideoGenerationJob) : []),
    [activeProject?.id, selectedScene, state],
  );
  const activeRenderJob = useMemo(
    () => (activeProject ? state.generationJobs.find((job) => job.projectId === activeProject.id && isRenderGenerationJob(job)) : undefined),
    [activeProject, state.generationJobs],
  );
  const activeFinalExportAsset = useMemo(
    () => state.assets.find((asset) => asset.projectId === activeProject?.id && asset.type === "Final Export"),
    [activeProject?.id, state.assets],
  );

  useEffect(() => {
    document.querySelector(".workspace")?.scrollTo({ top: 0, left: 0 });
  }, [activeView]);

  useEffect(() => {
    if (!activeProject && state.projects[0]) {
      setSelectedProjectId(state.projects[0].id);
    }
  }, [activeProject, state.projects]);

  useEffect(() => {
    if (!projectScenes.some((scene) => scene.id === selectedSceneId) && projectScenes[0]) {
      setSelectedSceneId(projectScenes[0].id);
    }
  }, [projectScenes, selectedSceneId]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const persistRepository = async <T,>(operation: Promise<RepositoryResult<T>>, label: string) => {
    const result = await operation;
    if (result.error) notify(`${label} ${repository.mode === "supabase" ? "Supabase" : "local"} save failed: ${result.error}`);
  };

  const persistBrandWatermarkAsset = async (asset: StudioAsset, brandKit: BrandKit, workspaceId: string) => {
    const assetResult = await repository.createAsset(asset);
    if (assetResult.error) {
      notify(`Brand watermark asset Supabase save failed: ${assetResult.error}`);
      return;
    }

    const brandKitResult = await repository.upsertBrandKit(brandKit, workspaceId);
    if (brandKitResult.error) notify(`Brand Kit watermark Supabase save failed: ${brandKitResult.error}`);
  };

  const applyWorkspaceState = (
    user: StudioUser,
    workspace: Workspace,
    loadedState: Partial<StudioState>,
  ) => {
    setState((current) => {
      const nextState: StudioState = {
        ...current,
        user,
        workspace,
        projects: loadedState.projects ?? current.projects,
        scenes: loadedState.scenes ?? current.scenes,
        assets: loadedState.assets ?? current.assets,
        characters: loadedState.characters ?? current.characters,
        worlds: loadedState.worlds ?? current.worlds,
        locations: loadedState.locations ?? current.locations,
        factions: loadedState.factions ?? current.factions,
        generationJobs: loadedState.generationJobs ?? current.generationJobs,
        publishKits: loadedState.publishKits ?? current.publishKits,
        timelineItems: loadedState.timelineItems ?? current.timelineItems,
        brandKit: loadedState.brandKit ?? current.brandKit,
        providers: loadedState.providers ?? current.providers,
      };

      const firstProject = nextState.projects[0];
      const firstScene = firstProject
        ? nextState.scenes.find((scene) => scene.projectId === firstProject.id)
        : nextState.scenes[0];
      queueMicrotask(() => {
        setSelectedProjectId(firstProject?.id ?? "");
        setSelectedSceneId(firstScene?.id ?? "");
        setActiveView(firstProject ? "command" : "create");
      });
      return nextState;
    });
  };

  const bootstrapWorkspace = async (user: StudioUser) => {
    const workspace = await repository.ensureWorkspaceForUser(user);
    if ("error" in workspace) {
      setLoginError(workspace.error ?? "Workspace setup failed.");
      return false;
    }

    const loadedState = await repository.loadWorkspaceState(workspace.data.id);
    if ("error" in loadedState) {
      setLoginError(loadedState.error ?? "Workspace load failed.");
      return false;
    }

    applyWorkspaceState(user, workspace.data, loadedState.data);
    return true;
  };

  useEffect(() => {
    let cancelled = false;

    async function bootSession() {
      const user = await getCurrentStudioUser();
      if (cancelled) return;

      if (!user.ok) {
        setSignedIn(false);
        setBooting(false);
        return;
      }

      const booted = await bootstrapWorkspace(user.user);
      if (cancelled) return;
      setSignedIn(booted);
      setBooting(false);
    }

    void bootSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEmailSignIn = async (email: string, password: string) => {
    const result = await signInWithEmail(email, password);
    if (!result.ok) {
      setLoginError(result.message);
      setLoginMessage("");
      return;
    }

    setState((current) => ({ ...current, user: result.user }));
    const booted = await bootstrapWorkspace(result.user);
    if (!booted) return;
    setLoginError("");
    setLoginMessage("");
    setSignedIn(true);
    notify(result.mode === "supabase" ? "Signed in with Supabase." : "Signed in with local demo auth.");
  };

  const handleEmailSignUp = async (email: string, password: string, displayName: string) => {
    const result = await signUpWithEmail(email, password, displayName);
    if (!result.ok) {
      setLoginError(result.message);
      setLoginMessage("");
      return;
    }

    setLoginError("");
    if (!result.user) {
      setLoginMessage(result.message);
      return;
    }

    const signedUpUser = result.user;
    setState((current) => ({ ...current, user: signedUpUser }));
    const booted = await bootstrapWorkspace(signedUpUser);
    if (!booted) return;
    setLoginMessage("");
    setSignedIn(true);
    notify(result.message);
  };

  const handlePasswordReset = async (email: string) => {
    const result = await sendPasswordReset(email);
    if (!result.ok) {
      setLoginError(result.message);
      setLoginMessage("");
      return;
    }

    setLoginError("");
    setLoginMessage(result.message);
  };

  const handleGoogleSignIn = async () => {
    const result = await signInWithGoogle();
    if (!result.ok) {
      setLoginError(result.message);
      setLoginMessage("");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setSignedIn(false);
  };

  const copyText = async (text: string, label: string) => {
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    };

    try {
      await navigator.clipboard.writeText(text);
      notify(`${label} copied to clipboard.`);
      return true;
    } catch {
      if (fallbackCopy()) {
        notify(`${label} copied to clipboard.`);
        return true;
      }
    }

    notify(`${label} is ready, but clipboard access was blocked.`);
    return false;
  };

  const updateSceneProvider = (sceneId: string, provider: string) => {
    const target = state.scenes.find((scene) => scene.id === sceneId);
    if (!target || target.externalProvider === provider) return;
    const nextScene = { ...target, externalProvider: provider };
    replaceScenes((scene) => (scene.id === sceneId ? nextScene : scene));
    void persistRepository(repository.upsertScene(nextScene), "Scene external provider");
  };

  const copyScenePrompt = async (sceneId: string, providerOverride?: string, label = "Scene prompt") => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const copied = await copyText(scene.fullPrompt, label);

    const provider = providerOverride ?? scene.externalProvider ?? scene.promptProvider ?? activeProject?.aiTarget ?? "Manual Copy Mode";
    const nextScene = {
      ...scene,
      promptCopiedAt: nowLabel(),
      externalProvider: provider,
    };
    const job = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      task: "Manual prompt copied",
      project: activeProject?.title ?? "Project",
      provider: `${provider} / Manual Copy`,
      status: "Completed" as const,
      cost: "External",
      inputPayload: scene.fullPrompt,
      outputPayload: copied
        ? "Prompt copied for external video generation."
        : "Prompt copy attempted; clipboard access was blocked.",
      createdAt: nowLabel(),
    };

    setState((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === sceneId ? nextScene : item)),
      generationJobs: [job, ...current.generationJobs],
    }));
    void persistRepository(repository.upsertScene(nextScene), "Prompt copied scene state");
    void persistRepository(repository.createGenerationJob(job), "Prompt copied job");
  };

  const replaceScenes = (updater: (scene: SceneCard) => SceneCard) => {
    setState((current) => ({
      ...current,
      scenes: current.scenes.map(updater),
    }));
  };

  const updateProjectProgress = (projectId: string, scenes: SceneCard[]) => {
    const currentProject = state.projects.find((project) => project.id === projectId);
    if (!currentProject) return;
    const nextProject = deriveProjectProgress(currentProject, scenes);

    setState((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === projectId ? nextProject : project)),
    }));
    void persistRepository(repository.updateProject(nextProject), "Project progress");
  };

  const updateSceneStatus = (sceneId: string, status: SceneStatus) => {
    const target = state.scenes.find((scene) => scene.id === sceneId);
    if (!target) return;
    const sceneVideoAssets = state.assets.filter((asset) => asset.sceneId === sceneId && asset.type === "Video");
    const approvedSceneAsset = state.assets.find(
      (asset) => asset.sceneId === sceneId && asset.type === "Video" && asset.status === "Approved",
    );
    const linkedApprovedAsset =
      (target.approvedAssetId ? state.assets.find((asset) => asset.id === target.approvedAssetId && asset.type === "Video" && asset.status === "Approved") : undefined) ??
      approvedSceneAsset;

    if (status === "Approved") {
      const assetToApprove = linkedApprovedAsset ?? sceneVideoAssets.find((asset) => asset.status !== "Rejected") ?? sceneVideoAssets[0];
      if (!assetToApprove) {
        notify("Upload a generated scene video before approving this Scene Card.");
        return;
      }
      if (assetToApprove.status !== "Approved") {
        updateAssetStatus(assetToApprove.id, "Approved");
        return;
      }
    }

    if (status === "Added to Timeline" && !linkedApprovedAsset) {
      notify("Approve an uploaded scene video before sending this Scene Card to NOX Cut.");
      return;
    }

    const nextScene = { ...target, status, approvedAssetId: approvedSceneAsset?.id ?? target.approvedAssetId };

    replaceScenes((scene) => (scene.id === sceneId ? nextScene : scene));
    void persistRepository(repository.upsertScene(nextScene), "Scene status");

    if (status === "Added to Timeline") {
      setState((current) => {
        const approvedAsset =
          current.assets.find((asset) => asset.id === nextScene.approvedAssetId) ??
          current.assets.find((asset) => asset.sceneId === sceneId && asset.type === "Video" && asset.status === "Approved");
        if (!approvedAsset) return current;
        const timelineItem = buildApprovedAssetTimelineItem(approvedAsset, nextScene, current.timelineItems);
        void persistRepository(repository.upsertTimelineItem(timelineItem), "Timeline item");
        return {
          ...current,
          timelineItems: current.timelineItems.some((item) => item.id === timelineItem.id)
            ? current.timelineItems.map((item) => (item.id === timelineItem.id ? timelineItem : item))
            : [...current.timelineItems, timelineItem],
        };
      });
    }

    const updatedScenes = state.scenes.map((scene) => (scene.id === sceneId ? { ...scene, status } : scene));
    updateProjectProgress(target.projectId, updatedScenes.filter((scene) => scene.projectId === target.projectId));
    notify(`Scene updated to ${status}.`);
  };

  const attachVideo = async (sceneId: string, file: File) => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const upload = await uploadStudioFile({
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      file,
      type: "Video",
    });

    if (upload.error) {
      notify(`Scene video upload failed: ${upload.error}`);
      return;
    }
    const provider = scene.externalProvider ?? scene.promptProvider ?? activeProject?.aiTarget ?? "Manual Mode";

    const asset: StudioAsset = {
      id: makeId("asset"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      filename: file.name,
      type: "Video",
      fileUrl: upload.publicUrl,
      storagePath: upload.path,
      mimeType: file.type,
      attachedTo: `${activeProject?.title ?? "Project"} / Scene ${String(scene.number).padStart(2, "0")}`,
      status: "Needs Review",
      provider: upload.mode === "supabase" ? `${provider} / Supabase Storage / ${upload.bucket}` : `${provider} / Local preview`,
      duration: "10s",
      promptId: scene.id,
      promptUsed: scene.fullPrompt,
      notes:
        upload.mode === "supabase"
          ? `Stored at ${upload.path}. Prompt copied: ${scene.promptCopiedAt ?? "not recorded"}.`
          : `Local preview path: ${upload.path}. Prompt copied: ${scene.promptCopiedAt ?? "not recorded"}.`,
      tags: ["scene-video", "manual-upload", provider.toLowerCase().replace(/\s+/g, "-")],
      createdAt: nowLabel(),
    };
    const job = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      task: "Manual scene video upload",
      project: activeProject?.title ?? "Project",
      provider,
      status: "Needs Review" as const,
      cost: "External",
      inputPayload: file.name,
      outputPayload: `Video attached to Scene Card from ${provider}.`,
      createdAt: nowLabel(),
    };
    const nextScene = {
      ...scene,
      uploadedAsset: file.name,
      approvedAssetId: undefined,
      status: "Video Uploaded" as const,
      externalProvider: provider,
    };
    setState((current) => ({
      ...current,
      assets: [asset, ...current.assets],
      scenes: current.scenes.map((item) => (item.id === sceneId ? nextScene : item)),
      generationJobs: [job, ...current.generationJobs],
    }));
    const nextScenes = state.scenes.map((item) => (item.id === sceneId ? nextScene : item));
    void persistRepository(repository.createAsset(asset), "Scene video asset");
    void persistRepository(repository.upsertScene(nextScene), "Scene video attachment");
    void persistRepository(repository.createGenerationJob(job), "Manual upload job");
    updateProjectProgress(scene.projectId, nextScenes.filter((item) => item.projectId === scene.projectId));
    notify(`${file.name} attached to Scene Card.`);
  };

  const createProject = async (input: {
    title: string;
    idea: string;
    type: string;
    format: string;
    length: string;
    genre: string;
    tone: string;
    target: string;
    language: Project["language"];
  }) => {
    const result = await generateConceptPackage({ ...input, workspaceId: state.workspace.id, brandKit: state.brandKit });
    const productionPackage = result.data;
    setState((current) => ({
      ...current,
      projects: [productionPackage.project, ...current.projects],
      scenes: [...productionPackage.scenes, ...current.scenes],
      characters: [...productionPackage.characters, ...current.characters],
      worlds: [...productionPackage.worlds, ...current.worlds],
      locations: [...productionPackage.locations, ...current.locations],
      factions: [...productionPackage.factions, ...current.factions],
      publishKits: [productionPackage.publishKit, ...current.publishKits],
      timelineItems: [...productionPackage.timelineItems, ...current.timelineItems],
      generationJobs: [...productionPackage.generationJobs, ...current.generationJobs],
    }));
    setSelectedProjectId(productionPackage.project.id);
    setSelectedSceneId(productionPackage.scenes[0]?.id ?? "");
    setActiveView("scene");
    void persistRepository(repository.saveProductionPackage(productionPackage), "Production package");
    if (result.error) notify(`Generation API unavailable; local NOX Core used. ${result.error}`);
    else notify(`${productionPackage.project.title} production package created via ${result.mode === "supabase" ? "Supabase Function" : "local NOX Core"}.`);
  };

  const getScenePromptContext = (scene: SceneCard) => {
    const characterRules = state.characters
      .filter((character) => scene.characters.includes(character.name))
      .flatMap((character) => [
        `${character.name}: ${character.promptIdentity}`,
        ...character.wardrobeRules.map((rule) => `${character.name} wardrobe: ${rule}`),
        ...character.negativeRules.map((rule) => `${character.name} avoid: ${rule}`),
      ]);
    const worldRules = state.worlds
      .filter((world) => world.name === activeProject?.world || scene.location.includes(world.name))
      .flatMap((world) => [
        `${world.name}: ${world.description}`,
        ...world.visualRules,
        ...world.recurringSymbols.map((symbol) => `Recurring symbol: ${symbol}`),
      ]);
    const locationRules = state.locations
      .filter(
        (location) =>
          scene.location.includes(location.name) ||
          Boolean(location.worldId && state.worlds.some((world) => world.id === location.worldId && world.name === activeProject?.world)),
      )
      .flatMap((location) => [
        `Location ${location.name}: ${location.description}`,
        ...location.visualRules.map((rule) => `${location.name} visual rule: ${rule}`),
        ...location.timelineNotes.map((note) => `${location.name} timeline: ${note}`),
      ]);
    const factionRules = state.factions
      .filter(
        (faction) =>
          scene.fullPrompt.includes(faction.name) ||
          scene.summary.includes(faction.name) ||
          Boolean(faction.worldId && state.worlds.some((world) => world.id === faction.worldId && world.name === activeProject?.world)),
      )
      .flatMap((faction) => [
        `Faction ${faction.name}: ${faction.description}`,
        ...faction.visualRules.map((rule) => `${faction.name} visual rule: ${rule}`),
        ...faction.negativeRules.map((rule) => `${faction.name} avoid: ${rule}`),
      ]);

    return {
      characterRules,
      worldRules: [...worldRules, ...locationRules, ...factionRules],
      language: activeProject?.language,
    };
  };

  const regeneratePrompt = async (sceneId: string, providerOverride?: string) => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const provider = providerOverride ?? scene.promptProvider ?? activeProject?.aiTarget ?? "Universal Prompt";
    const result = await generateScenePrompt({
      scene,
      provider,
      workspaceId: state.workspace.id,
      context: getScenePromptContext(scene),
      action: "regenerate",
    });
    const nextScene = { ...result.data, externalProvider: provider };
    const job = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      task: "Scene prompt regeneration",
      project: activeProject?.title ?? "Project",
      provider: `${nextScene.promptProvider ?? provider} / ${result.mode === "supabase" ? "Supabase Function" : "Local Engine"}`,
      status: "Completed" as const,
      cost: "$0 local",
      inputPayload: scene.summary,
      outputPayload: `${nextScene.promptProvider ?? provider} scene prompt generated.`,
      createdAt: nowLabel(),
    };
    setState((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === sceneId ? nextScene : item)),
      generationJobs: [job, ...current.generationJobs],
    }));
    void persistRepository(repository.upsertScene(nextScene), "Regenerated scene prompt");
    void persistRepository(repository.createGenerationJob(job), "Prompt regeneration job");
    if (result.error) notify(`Prompt API unavailable; local engine used. ${result.error}`);
    else notify(`${nextScene.promptProvider ?? provider} scene prompt regenerated via ${result.mode === "supabase" ? "Supabase Function" : "local engine"}.`);
  };

  const polishPrompt = async (sceneId: string, providerOverride: string) => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const provider = providerOverride || scene.promptProvider || activeProject?.aiTarget || "Universal Prompt";
    const result = await generateScenePrompt({
      scene,
      provider,
      workspaceId: state.workspace.id,
      context: getScenePromptContext(scene),
      action: "polish",
    });
    const nextScene = { ...result.data, externalProvider: provider };
    const job = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      task: "Scene prompt polish",
      project: activeProject?.title ?? "Project",
      provider: `${nextScene.promptProvider ?? provider} / ${result.mode === "supabase" ? "Supabase Function" : "Local Engine"}`,
      status: "Completed" as const,
      cost: "$0 local",
      inputPayload: scene.fullPrompt,
      outputPayload: `${nextScene.promptProvider ?? provider} polish pass generated.`,
      createdAt: nowLabel(),
    };

    setState((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === sceneId ? nextScene : item)),
      generationJobs: [job, ...current.generationJobs],
    }));
    void persistRepository(repository.upsertScene(nextScene), "Polished scene prompt");
    void persistRepository(repository.createGenerationJob(job), "Prompt polish job");
    if (result.error) notify(`Prompt API unavailable; local engine used. ${result.error}`);
    else notify(`${nextScene.promptProvider ?? provider} prompt polished via ${result.mode === "supabase" ? "Supabase Function" : "local engine"}.`);
  };

  const queueVideoGeneration = (sceneId: string) => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const openJob = state.generationJobs.find(
      (job) => job.sceneId === sceneId && isWorkflowSceneVideoGenerationJob(job) && ["Queued", "Running"].includes(job.status),
    );
    if (openJob) {
      notify(`Scene ${String(scene.number).padStart(2, "0")} already has an open clip job.`);
      return;
    }

    const mode = getGenerationMode(state);
    if (!mode.canRunVideo) {
      void copyScenePrompt(sceneId, scene.externalProvider ?? scene.promptProvider ?? activeProject?.aiTarget ?? "Manual Copy Mode", "Scene video prompt");
      notify("Prompt is ready. Upload the generated clip when finished.");
      return;
    }

    const provider = mode.id === "browser-supabase-ready" ? "Grok / Hosted Worker" : "Grok";
    const nextScene = { ...scene, status: "Generating Video" as const, externalProvider: provider };
    const job = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId,
      task: `Scene ${String(scene.number).padStart(2, "0")} video generation`,
      project: activeProject?.title ?? "Project",
      provider,
      status: "Queued" as const,
      cost: "Grok video",
      inputPayload: scene.fullPrompt || formatScenePrompt(scene, provider, { language: activeProject?.language }),
      outputPayload:
        mode.id === "browser-supabase-ready"
          ? "Queued for hosted Grok video generation."
          : "Queued for Grok desktop video generation.",
      retryCount: 0,
      maxRetries: 3,
      priority: 100 - scene.number,
      runAfter: new Date().toISOString(),
      usageMetadata: {
        route: "grok-video",
        generationMode: mode.id,
        assetType: "Video",
        model: "grok-imagine-video",
        promptSnapshot: scene.fullPrompt,
      },
      logs: [`${new Date().toISOString()} - Queued: ${provider} clip generation requested.`],
      createdAt: nowLabel(),
    };
    setState((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === sceneId ? nextScene : item)),
      generationJobs: [job, ...current.generationJobs],
    }));
    const nextScenes = state.scenes.map((item) => (item.id === sceneId ? nextScene : item));
    void persistRepository(repository.upsertScene(nextScene), "Video queue scene state");
    void persistRepository(repository.createGenerationJob(job), "Video generation job");
    updateProjectProgress(scene.projectId, nextScenes.filter((item) => item.projectId === scene.projectId));
    notify(`Scene ${String(scene.number).padStart(2, "0")} clip queued for Grok generation.`);
  };

  const queueAllMissingVideos = () => {
    if (!activeProject) return;
    const mode = getGenerationMode(state);
    if (!mode.canRunVideo) {
      notify("Prompt handoff mode is active. Set up Grok or upload clips manually from Scene Composer.");
      return;
    }

    const openVideoJobSceneIds = new Set(
      state.generationJobs
        .filter((job) => job.projectId === activeProject.id && isWorkflowSceneVideoGenerationJob(job) && ["Queued", "Running"].includes(job.status))
        .map((job) => job.sceneId)
        .filter(Boolean),
    );
    const sceneIdsWithVideo = new Set(
      state.assets
        .filter((asset) => asset.projectId === activeProject.id && asset.sceneId && asset.type === "Video" && asset.status !== "Rejected")
        .map((asset) => asset.sceneId),
    );
    const scenesToQueue = projectScenes.filter((scene) => !sceneIdsWithVideo.has(scene.id) && !openVideoJobSceneIds.has(scene.id));

    if (!scenesToQueue.length) {
      notify("All Scene Cards already have video assets or open Grok video jobs.");
      return;
    }

    const timestamp = new Date().toISOString();
    const provider = mode.id === "browser-supabase-ready" ? "Grok / Hosted Worker" : "Grok";
    const nextScenes = scenesToQueue.map((scene) => ({ ...scene, status: "Generating Video" as const, externalProvider: provider }));
    const nextSceneById = new Map(nextScenes.map((scene) => [scene.id, scene]));
    const jobs: GenerationJob[] = nextScenes.map((scene, index) => ({
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: scene.projectId,
      sceneId: scene.id,
      task: `Scene ${String(scene.number).padStart(2, "0")} video generation`,
      project: activeProject.title,
      provider,
      status: "Queued",
      cost: "Grok video",
      inputPayload: scene.fullPrompt || formatScenePrompt(scene, provider, { language: activeProject.language }),
      outputPayload: mode.id === "browser-supabase-ready" ? "Queued for hosted Grok video generation." : "Queued for Grok desktop video generation.",
      retryCount: 0,
      maxRetries: 3,
      priority: 100 - index,
      runAfter: timestamp,
      usageMetadata: {
        route: "grok-video",
        generationMode: mode.id,
        assetType: "Video",
        model: "grok-imagine-video",
        promptSnapshot: scene.fullPrompt,
      },
      logs: [`${timestamp} - Queued: ${provider} video generation requested from batch operator.`],
      createdAt: nowLabel(),
    }));
    const allProjectScenes = projectScenes.map((scene) => nextSceneById.get(scene.id) ?? scene);
    const nextProject = deriveProjectProgress(activeProject, allProjectScenes);

    setState((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => nextSceneById.get(scene.id) ?? scene),
      generationJobs: [...jobs, ...current.generationJobs],
      projects: current.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }));
    nextScenes.forEach((scene) => void persistRepository(repository.upsertScene(scene), "Batch Grok video scene"));
    jobs.forEach((job) => void persistRepository(repository.createGenerationJob(job), "Batch Grok video job"));
    void persistRepository(repository.updateProject(nextProject), "Batch Grok video progress");
    notify(`${jobs.length} Grok video job${jobs.length === 1 ? "" : "s"} queued for this film.`);
  };

  const queuePublishMediaJobs = () => {
    if (!activeProject || !activePublishKit) {
      notify("Generate a Publish Kit before queuing Grok media assets.");
      return;
    }

    const openJobKeys = new Set(
      state.generationJobs
        .filter((job) => job.projectId === activeProject.id && ["Queued", "Running"].includes(job.status))
        .map((job) => `${job.task}:${job.sceneId ?? ""}`),
    );
    const timestamp = new Date().toISOString();
    const baseJobs: Array<{ task: string; prompt: string; assetKind: string; assetType: StudioAsset["type"]; priority: number }> = [
      {
        task: "Poster image generation",
        prompt: activePublishKit.posterPrompt,
        assetKind: "poster",
        assetType: "Poster",
        priority: 70,
      },
      {
        task: "Thumbnail image generation",
        prompt: activePublishKit.thumbnailPrompt,
        assetKind: "thumbnail",
        assetType: "Image",
        priority: 68,
      },
      {
        task: "Brand visual generation",
        prompt: `${state.brandKit.studioName} brand visual, ${state.brandKit.defaultStyle}, ${state.brandKit.colors.join(", ")}, ${state.brandKit.defaultExport}.`,
        assetKind: "brand-visual",
        assetType: "Brand File",
        priority: 62,
      },
    ];
    const characterJobs = state.characters
      .filter((character) => activeProject.mainCharacters.includes(character.name) && !character.referenceImageUrl)
      .map((character, index) => ({
        task: `${character.name} reference image generation`,
        prompt: `${character.name} character reference, ${character.visualIdentity}. ${character.promptIdentity}. Wardrobe: ${character.wardrobeRules.join(", ")}.`,
        assetKind: "reference-image",
        assetType: "Image" as const,
        priority: 60 - index,
      }));
    const jobs = [...baseJobs, ...characterJobs]
      .filter((item) => item.prompt.trim() && !openJobKeys.has(`${item.task}:`))
      .map<GenerationJob>((item) => ({
        id: makeId("job"),
        workspaceId: state.workspace.id,
        projectId: activeProject.id,
        task: item.task,
        project: activeProject.title,
        provider: "Grok",
        status: "Queued",
        cost: "Grok image",
        inputPayload: item.prompt,
        outputPayload: `Queued for Grok image generation as ${item.assetKind}.`,
        retryCount: 0,
        maxRetries: 3,
        priority: item.priority,
        runAfter: timestamp,
        usageMetadata: {
          route: "grok-image",
          assetType: item.assetType,
          assetKind: item.assetKind,
          model: "grok-imagine-image-quality",
          promptSnapshot: item.prompt,
        },
        logs: [`${timestamp} - Queued: Grok ${item.assetKind} generation requested from Publish Kit.`],
        createdAt: nowLabel(),
      }));

    if (!jobs.length) {
      notify("No new Grok media jobs to queue.");
      return;
    }

    setState((current) => ({ ...current, generationJobs: [...jobs, ...current.generationJobs] }));
    jobs.forEach((job) => void persistRepository(repository.createGenerationJob(job), "Batch Grok media job"));
    notify(`${jobs.length} Grok media job${jobs.length === 1 ? "" : "s"} queued.`);
  };

  const generateCurrentPublishKit = () => {
    if (!activeProject) return;
    const kit = generatePublishKit(activeProject, projectScenes, state.brandKit);
    const nextProject: Project = { ...activeProject, status: "Publish Kit Ready", nextStep: "Export release package", updatedAt: nowLabel() };
    setState((current) => ({
      ...current,
      publishKits: [kit, ...current.publishKits.filter((item) => item.projectId !== activeProject.id)],
      projects: current.projects.map((project) => (project.id === activeProject.id ? nextProject : project)),
    }));
    void persistRepository(repository.upsertPublishKit(kit), "Publish Kit");
    void persistRepository(repository.updateProject(nextProject), "Publish project status");
    notify("Publish Kit generated.");
  };

  const updatePublishKit = (kit: PublishKit) => {
    const nextKit = { ...kit, updatedAt: nowLabel() };
    const project = state.projects.find((item) => item.id === kit.projectId);
    const nextProject = project && project.releaseStatus !== kit.releaseStatus
      ? { ...project, releaseStatus: kit.releaseStatus, updatedAt: nowLabel() }
      : undefined;

    setState((current) => ({
      ...current,
      publishKits: [nextKit, ...current.publishKits.filter((item) => item.projectId !== kit.projectId)],
      projects: nextProject ? current.projects.map((item) => (item.id === nextProject.id ? nextProject : item)) : current.projects,
    }));
    void persistRepository(repository.upsertPublishKit(nextKit), "Publish Kit edit");
    if (nextProject) void persistRepository(repository.updateProject(nextProject), "Project release status");
    notify("Publish Kit saved.");
  };

  const downloadAndArchiveExport = async ({
    filename,
    text,
    mimeType,
    attachedTo,
    tags,
    successMessage,
  }: {
    filename: string;
    text: string;
    mimeType: string;
    attachedTo: string;
    tags: string[];
    successMessage: string;
  }) => {
    if (!activeProject) return;
    downloadTextFile(filename, text, mimeType);
    const exportJob: GenerationJob = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: activeProject.id,
      task: `Archive export ${filename}`,
      project: activeProject.title,
      provider: "NOX Export Worker",
      status: "Running",
      cost: "Local worker",
      inputPayload: `${mimeType} export queued for Asset Vault archive.`,
      outputPayload: `Archiving ${filename}.`,
      retryCount: 0,
      maxRetries: 2,
      logs: [`${new Date().toISOString()} - Running: export download created; Storage archive started.`],
      startedAt: new Date().toISOString(),
      createdAt: nowLabel(),
    };
    setState((current) => ({ ...current, generationJobs: [exportJob, ...current.generationJobs] }));
    void persistRepository(repository.createGenerationJob(exportJob), "Export archive job");

    const file = new File([text], filename, { type: mimeType });
    const upload = await uploadStudioFile({
      workspaceId: state.workspace.id,
      projectId: activeProject.id,
      file,
      type: "Final Export",
    });

    if (upload.error) {
      const failedJob = withGenerationJobStatus(exportJob, "Failed", `Vault archive failed: ${upload.error}`);
      setState((current) => ({
        ...current,
        generationJobs: current.generationJobs.map((job) => (job.id === exportJob.id ? failedJob : job)),
      }));
      void persistRepository(repository.upsertGenerationJob(failedJob), "Export archive job failed");
      notify(`${successMessage} Vault archive failed: ${upload.error}`);
      return;
    }

    const asset: StudioAsset = {
      id: makeId("asset"),
      workspaceId: state.workspace.id,
      projectId: activeProject.id,
      filename,
      type: "Final Export",
      fileUrl: upload.publicUrl,
      storagePath: upload.path,
      mimeType,
      attachedTo,
      status: "Stored",
      provider: upload.mode === "supabase" ? `Supabase Storage / ${upload.bucket}` : "Local metadata",
      notes: upload.mode === "supabase" ? `Export stored at ${upload.path}` : `Local export metadata path: ${upload.path}`,
      tags,
      createdAt: nowLabel(),
    };

    const completedJob = withGenerationJobStatus(exportJob, "Completed", `${filename} saved to Asset Vault at ${upload.path}.`);
    setState((current) => ({
      ...current,
      assets: [asset, ...current.assets],
      generationJobs: current.generationJobs.map((job) => (job.id === exportJob.id ? completedJob : job)),
    }));
    void persistRepository(repository.createAsset(asset), "Export asset");
    void persistRepository(repository.upsertGenerationJob(completedJob), "Export archive job completed");
    notify(`${successMessage} Saved to Asset Vault.`);
  };

  const exportCurrentProject = (format: "markdown" | "json" | "txt") => {
    if (!activeProject) return;
    if (format === "markdown") {
      void downloadAndArchiveExport({
        filename: `${activeProject.id}-production-package.md`,
        text: exportProjectMarkdown(state, activeProject.id),
        mimeType: "text/markdown",
        attachedTo: `${activeProject.title} / Publish Kit`,
        tags: ["export", "publish-kit", "markdown", "production-package"],
        successMessage: "Markdown production package exported.",
      });
      return;
    }
    if (format === "txt") {
      void downloadAndArchiveExport({
        filename: `${activeProject.id}-production-package.txt`,
        text: exportProjectText(state, activeProject.id),
        mimeType: "text/plain",
        attachedTo: `${activeProject.title} / Publish Kit`,
        tags: ["export", "publish-kit", "txt", "production-package"],
        successMessage: "TXT production package exported.",
      });
      return;
    }
    void downloadAndArchiveExport({
      filename: `${activeProject.id}-production-package.json`,
      text: exportProjectJson(state, activeProject.id),
      mimeType: "application/json",
      attachedTo: `${activeProject.title} / Publish Kit`,
      tags: ["export", "publish-kit", "json", "production-package"],
      successMessage: "JSON production package exported.",
    });
  };

  const exportReleaseBundle = (platform: ReleasePlatform) => {
    if (!activeProject) return;
    const platformSlug = platform.toLowerCase().replace(/\s+/g, "-");
    void downloadAndArchiveExport({
      filename: `${activeProject.id}-${platformSlug}-release-bundle.json`,
      text: exportReleaseBundleJson(state, activeProject.id, platform),
      mimeType: "application/json",
      attachedTo: `${activeProject.title} / ${platform} Release Bundle`,
      tags: ["export", "release-bundle", platformSlug, "publish-kit", "json"],
      successMessage: `${platform} release bundle exported.`,
    });
  };

  const queueReleaseOperation = (platform: ReleasePlatform) => {
    if (!activeProject) return;
    const plan = createReleaseOperationPlan(state, activeProject.id, platform);
    const platformSlug = platform.toLowerCase().replace(/\s+/g, "-");
    const job: GenerationJob = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: activeProject.id,
      task: `${platform} release operation`,
      project: activeProject.title,
      provider: `${platform} Publishing`,
      status: "Queued",
      cost: "Manual",
      inputPayload: JSON.stringify(plan, null, 2),
      outputPayload: plan.ready
        ? `${platform} release package is ready for scheduling/posting.`
        : `${platform} release package queued with ${plan.blockers.length} readiness blocker${plan.blockers.length === 1 ? "" : "s"}.`,
      retryCount: 0,
      maxRetries: 2,
      priority: plan.ready ? 80 : 35,
      runAfter: new Date().toISOString(),
      usageMetadata: {
        route: "publish-handoff",
        platform,
        uploadMode: "export-package",
        uploadId: "",
        finalUrl: "",
        scheduledFor: plan.schedule.recommendedWindow,
      },
      logs: [`${new Date().toISOString()} - Queued: ${platform} release operation created from Publish Kit.`],
      createdAt: nowLabel(),
    };
    const projectStatus: Project["releaseStatus"] = plan.ready ? "Scheduled" : "NOX Films Draft";
    const nextProject = { ...activeProject, releaseStatus: projectStatus, updatedAt: nowLabel() };
    const nextPublishKit = activePublishKit ? { ...activePublishKit, releaseStatus: projectStatus, updatedAt: nowLabel() } : undefined;

    setState((current) => ({
      ...current,
      generationJobs: [job, ...current.generationJobs],
      projects: current.projects.map((project) => (project.id === activeProject.id ? nextProject : project)),
      publishKits: nextPublishKit ? current.publishKits.map((kit) => (kit.id === nextPublishKit.id ? nextPublishKit : kit)) : current.publishKits,
    }));
    void persistRepository(repository.createGenerationJob(job), "Release operation job");
    void persistRepository(repository.updateProject(nextProject), "Project release operation status");
    if (nextPublishKit) void persistRepository(repository.upsertPublishKit(nextPublishKit), "Publish Kit release operation status");
    notify(`${platform} release operation queued.`);
  };

  const exportCurrentEditPlan = () => {
    if (!activeProject) return;
    void downloadAndArchiveExport({
      filename: `${activeProject.id}-edit-plan.txt`,
      text: exportEditPlan(state, activeProject.id),
      mimeType: "text/plain",
      attachedTo: `${activeProject.title} / NOX Cut`,
      tags: ["export", "nox-cut", "txt", "edit-plan"],
      successMessage: "NOX Cut edit plan exported.",
    });
  };

  const exportRenderManifestFile = () => {
    if (!activeProject) return;
    const manifest = createRenderManifest(state, activeProject.id);
    void downloadAndArchiveExport({
      filename: `${activeProject.id}-render-manifest.json`,
      text: exportRenderManifestJson(state, activeProject.id),
      mimeType: "application/json",
      attachedTo: `${activeProject.title} / Render Engine V1`,
      tags: ["export", "render-engine", "ffmpeg-manifest", "json"],
      successMessage: manifest.readiness.ready
        ? "Render manifest exported for MP4 assembly."
        : `Render manifest exported with ${manifest.readiness.blockers.length} blocker${manifest.readiness.blockers.length === 1 ? "" : "s"}.`,
    });
  };

  const queueRenderJob = () => {
    if (!activeProject) return;
    const manifest = createRenderManifest(state, activeProject.id);
    const job: GenerationJob = {
      id: makeId("job"),
      workspaceId: state.workspace.id,
      projectId: activeProject.id,
      task: "Render Engine V1 MP4 assembly",
      project: activeProject.title,
      provider: "NOX Render Engine / FFmpeg",
      status: manifest.readiness.ready ? "Queued" : "Needs Review",
      cost: "Local worker",
      inputPayload: exportRenderManifestJson(state, activeProject.id),
      outputPayload: `${summarizeRenderReadiness(manifest)} Run scripts/render-nox-cut.mjs with the exported manifest on a renderer machine.`,
      errorMessage: manifest.readiness.ready ? "" : manifest.readiness.blockers.join("\n"),
      retryCount: 0,
      maxRetries: 3,
      usageMetadata: {
        route: "render-worker",
        outputFilename: manifest.outputFilename,
        uploadBucket: "nox-exports",
        ready: manifest.readiness.ready,
        blockerCount: manifest.readiness.blockers.length,
      },
      logs: [
        `${new Date().toISOString()} - ${manifest.readiness.ready ? "Queued" : "Needs Review"}: render manifest preflight ${manifest.readiness.ready ? "passed" : "found blockers"}.`,
      ],
      createdAt: nowLabel(),
    };
    setState((current) => ({ ...current, generationJobs: [job, ...current.generationJobs] }));
    void persistRepository(repository.createGenerationJob(job), "Render Engine job");
    notify(manifest.readiness.ready ? "Render Engine job queued." : "Render preflight saved with blockers.");
  };

  const generateFullShortFilm = () => {
    if (!activeProject) return;
    const workflow = getProjectWorkflowState(state, activeProject.id);
    if (!workflow) return;

    if (!workflow.sceneCount) {
      notify("Create Scene Cards before generating the full short film.");
      setActiveView("create");
      return;
    }

    if (workflow.finalExportAsset) {
      notify("Final MP4 is ready. Open Publish to package it.");
      setActiveView("publish");
      return;
    }

    if (workflow.missingClipCount) {
      queueAllMissingVideos();
      return;
    }

    if (workflow.queuedClipCount || workflow.runningClipCount) {
      notify("Clip generation is still active. Open the queue to run or monitor jobs.");
      setActiveView("vault");
      return;
    }

    if (workflow.reviewClipCount) {
      notify("Review and approve generated clips before rendering the full short film.");
      setActiveView("scene");
      return;
    }

    if (workflow.renderJob?.status === "Queued") {
      void runQueuedGenerationJob(workflow.renderJob.id);
      return;
    }

    if (workflow.renderState.ready) {
      queueRenderJob();
      return;
    }

    notify(workflow.renderState.blockers[0] ?? "NOX Cut is not ready to render yet.");
  };

  const persistTimelineItems = (items: TimelineItem[]) => {
    items.forEach((item) => {
      void persistRepository(repository.upsertTimelineItem(item), "Timeline item");
    });
  };

  const rebuildVideoTimeline = (projectId: string, scenes: SceneCard[], existingItems = state.timelineItems) => {
    return scenes.map<TimelineItem>((scene, index) => {
      const existing = existingItems.find((item) => item.sceneId === scene.id && item.trackType === "video");
      return {
        id: existing?.id ?? makeId("timeline"),
        projectId,
        sceneId: scene.id,
        assetId: existing?.assetId,
        trackType: "video",
        label: `SCENE ${String(index + 1).padStart(2, "0")} - ${scene.title}`,
        startTime: index * 10,
        endTime: index * 10 + 10,
        orderIndex: index,
        transitionIn: existing?.transitionIn ?? (index === 0 ? "Blackout Cut" : "Cyberglass Swipe"),
        transitionOut: existing?.transitionOut ?? (index === scenes.length - 1 ? "Neon Pulse Zoom" : "Signal Glitch"),
        trimStartNote: existing?.trimStartNote,
        trimEndNote: existing?.trimEndNote,
        editorNotes: existing?.editorNotes,
      };
    });
  };

  const moveSceneInCut = (sceneId: string, direction: "up" | "down") => {
    if (!activeProject) return;
    const ordered = [...projectScenes];
    const index = ordered.findIndex((scene) => scene.id === sceneId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;

    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    const renumberedScenes = ordered.map((scene, sceneIndex) => ({ ...scene, number: sceneIndex + 1 }));
    const renumberedById = new Map(renumberedScenes.map((scene) => [scene.id, scene]));
    const rebuiltTimeline = rebuildVideoTimeline(activeProject.id, renumberedScenes);

    setState((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => renumberedById.get(scene.id) ?? scene),
      timelineItems: [
        ...current.timelineItems.filter((item) => !(item.projectId === activeProject.id && item.trackType === "video")),
        ...rebuiltTimeline,
      ],
    }));
    renumberedScenes.forEach((scene) => {
      void persistRepository(repository.upsertScene(scene), "Scene order");
    });
    persistTimelineItems(rebuiltTimeline);
    notify("Scene order updated.");
  };

  const addTimelineUtility = (trackType: "audio" | "subtitle" | "overlay" | "title") => {
    if (!activeProject) return;
    const runtime = Math.max(projectScenes.length * 10, 10);
    const watermarkAsset = state.brandKit.watermarkAssetId
      ? state.assets.find((asset) => asset.id === state.brandKit.watermarkAssetId)
      : undefined;
    const config = {
      audio: {
        label: "Music Track - nox_intro_bass_loop.wav",
        transitionIn: "Fade In",
        transitionOut: "Fade Out",
        subtitleText: undefined,
        textOverlay: undefined,
      },
      subtitle: {
        label: "Spanish cinematic subtitles",
        transitionIn: "None",
        transitionOut: "None",
        subtitleText: "Bold white cinematic subtitles with shadow.",
        textOverlay: undefined,
      },
      overlay: {
        label: watermarkAsset ? `Watermark - ${watermarkAsset.filename}` : `${state.brandKit.studioName} watermark`,
        transitionIn: "Fade In",
        transitionOut: "Fade Out",
        subtitleText: undefined,
        textOverlay: watermarkAsset
          ? `${state.brandKit.studioName} watermark asset: ${watermarkAsset.filename}`
          : `${state.brandKit.studioName} watermark, bottom-right safe zone.`,
      },
      title: {
        label: `${activeProject.title} title card`,
        transitionIn: "Blackout Cut",
        transitionOut: "Signal Glitch",
        subtitleText: undefined,
        textOverlay: activeProject.title,
      },
    }[trackType];
    const item: TimelineItem = {
      id: makeId("timeline"),
      projectId: activeProject.id,
      assetId: trackType === "overlay" ? watermarkAsset?.id : undefined,
      trackType,
      label: config.label,
      startTime: trackType === "title" ? 0 : 0,
      endTime: trackType === "title" ? 3 : runtime,
      orderIndex: state.timelineItems.filter((entry) => entry.projectId === activeProject.id && entry.trackType === trackType).length,
      transitionIn: config.transitionIn,
      transitionOut: config.transitionOut,
      subtitleText: config.subtitleText,
      textOverlay: config.textOverlay,
      editorNotes:
        trackType === "audio"
          ? "Duck under dialogue and keep music bed below spoken lines."
          : trackType === "subtitle"
            ? "Use Brand Kit subtitle style and keep safe-zone readable."
            : trackType === "overlay"
              ? watermarkAsset
                ? `Use approved Brand Kit watermark asset (${watermarkAsset.filename}) inside the bottom-right safe zone.`
                : "Keep watermark inside bottom-right safe zone."
              : "Use as opening brand/title card before Scene 01.",
    };
    setState((current) => ({ ...current, timelineItems: [...current.timelineItems, item] }));
    void persistRepository(repository.upsertTimelineItem(item), "Timeline utility");
    notify(`${config.label} added to NOX Cut.`);
  };

  const updateTimelineClip = (
    sceneId: string,
    patch: Partial<Pick<TimelineItem, "transitionOut" | "trimStartNote" | "trimEndNote" | "editorNotes">>,
  ) => {
    if (!activeProject) return;
    const scene = projectScenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const existing = state.timelineItems.find((item) => item.sceneId === sceneId && item.trackType === "video");
    const approvedAsset =
      state.assets.find((asset) => asset.id === scene.approvedAssetId) ??
      state.assets.find((asset) => asset.sceneId === sceneId && asset.type === "Video" && asset.status === "Approved");
    const orderIndex = Math.max(scene.number - 1, 0);
    const item: TimelineItem = {
      id: existing?.id ?? makeId("timeline"),
      projectId: activeProject.id,
      sceneId,
      assetId: existing?.assetId ?? approvedAsset?.id,
      trackType: "video",
      label: existing?.label ?? `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`,
      startTime: existing?.startTime ?? orderIndex * 10,
      endTime: existing?.endTime ?? orderIndex * 10 + 10,
      orderIndex: existing?.orderIndex ?? orderIndex,
      transitionIn: existing?.transitionIn ?? (orderIndex === 0 ? "Blackout Cut" : "Cyberglass Swipe"),
      transitionOut: existing?.transitionOut ?? "Signal Glitch",
      trimStartNote: existing?.trimStartNote ?? "Start on first clean usable frame.",
      trimEndNote: existing?.trimEndNote ?? "End before provider reset or unwanted extra motion.",
      editorNotes: existing?.editorNotes ?? (approvedAsset ? `Source approved asset: ${approvedAsset.filename}` : "Needs approved source asset before final assembly."),
      ...patch,
    };
    setState((current) => ({
      ...current,
      timelineItems: existing
        ? current.timelineItems.map((entry) => (entry.id === item.id ? item : entry))
        : [...current.timelineItems, item],
    }));
    void persistRepository(repository.upsertTimelineItem(item), "Timeline clip");
    notify("Timeline clip updated.");
  };

  const addVaultAsset = async (file: File) => {
    const type: StudioAsset["type"] = file.type.startsWith("video/")
      ? "Video"
      : file.type.startsWith("audio/")
        ? "Audio"
        : file.type.startsWith("image/")
          ? "Image"
          : "Prompt Export";
    const linkedScene = type === "Video" ? selectedScene : undefined;
    const upload = await uploadStudioFile({
      workspaceId: state.workspace.id,
      projectId: linkedScene?.projectId ?? activeProject?.id,
      sceneId: linkedScene?.id,
      file,
      type,
    });

    if (upload.error) {
      notify(`Upload failed: ${upload.error}`);
      return;
    }

    const linkedProvider = linkedScene?.externalProvider ?? linkedScene?.promptProvider ?? activeProject?.aiTarget ?? "Manual Mode";
    const asset: StudioAsset = {
      id: makeId("asset"),
      workspaceId: state.workspace.id,
      projectId: linkedScene?.projectId ?? activeProject?.id,
      sceneId: linkedScene?.id,
      filename: file.name,
      type,
      fileUrl: upload.publicUrl,
      storagePath: upload.path,
      mimeType: file.type,
      attachedTo:
        linkedScene
          ? `${activeProject?.title ?? "Project"} / Scene ${String(linkedScene.number).padStart(2, "0")}`
          : activeProject?.title ?? "Workspace",
      status: linkedScene ? "Needs Review" : "Stored",
      provider:
        linkedScene
          ? `${linkedProvider} / ${upload.mode === "supabase" ? `Supabase Storage / ${upload.bucket}` : "Local metadata"}`
          : upload.mode === "supabase"
            ? `Supabase Storage / ${upload.bucket}`
            : "Local metadata",
      duration: linkedScene ? `${linkedScene.durationSeconds}s` : undefined,
      promptId: linkedScene?.id,
      promptUsed: linkedScene?.fullPrompt,
      notes:
        upload.mode === "supabase"
          ? `Stored at ${upload.path}${linkedScene ? `. Prompt copied: ${linkedScene.promptCopiedAt ?? "not recorded"}.` : ""}`
          : `Local V1 metadata path: ${upload.path}${linkedScene ? `. Prompt copied: ${linkedScene.promptCopiedAt ?? "not recorded"}.` : ""}`,
      tags:
        linkedScene
          ? [
              "uploaded",
              "scene-video",
              "manual-upload",
              `scene-${String(linkedScene.number).padStart(2, "0")}`,
              linkedProvider.toLowerCase().replace(/\s+/g, "-"),
            ]
          : ["uploaded"],
      createdAt: nowLabel(),
    };

    const vaultVideoJob: GenerationJob | undefined = linkedScene
      ? {
          id: makeId("job"),
          workspaceId: state.workspace.id,
          projectId: linkedScene.projectId,
          sceneId: linkedScene.id,
          task: "Vault scene video upload",
          project: activeProject?.title ?? "Project",
          provider: linkedProvider,
          status: "Needs Review",
          cost: "External",
          inputPayload: file.name,
          outputPayload: `Video attached to Scene Card from Asset Vault upload via ${linkedProvider}.`,
          createdAt: nowLabel(),
        }
      : undefined;
    const nextScene: SceneCard | undefined = linkedScene
      ? {
          ...linkedScene,
          uploadedAsset: file.name,
          approvedAssetId: undefined,
          status: "Video Uploaded",
          externalProvider: linkedProvider,
        }
      : undefined;

    setState((current) => ({
      ...current,
      assets: [asset, ...current.assets],
      scenes: nextScene ? current.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : current.scenes,
      generationJobs: vaultVideoJob ? [vaultVideoJob, ...current.generationJobs] : current.generationJobs,
    }));
    const nextScenes = nextScene ? state.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : state.scenes;
    void persistRepository(repository.createAsset(asset), "Vault asset");
    if (nextScene) {
      void persistRepository(repository.upsertScene(nextScene), "Vault scene video attachment");
      if (vaultVideoJob) void persistRepository(repository.createGenerationJob(vaultVideoJob), "Vault video upload job");
      updateProjectProgress(nextScene.projectId, nextScenes.filter((scene) => scene.projectId === nextScene.projectId));
    }
    notify(nextScene ? `${file.name} added to Asset Vault and attached to Scene Card.` : `${file.name} added to Asset Vault.`);
  };

  const uploadBrandWatermark = async (file: File) => {
    const upload = await uploadStudioFile({
      workspaceId: state.workspace.id,
      file,
      type: "Brand File",
      brandFile: true,
    });

    if (upload.error) {
      notify(`Watermark upload failed: ${upload.error}`);
      return;
    }

    const asset: StudioAsset = {
      id: makeId("asset"),
      workspaceId: state.workspace.id,
      filename: file.name,
      type: "Brand File",
      fileUrl: upload.publicUrl,
      storagePath: upload.path,
      mimeType: file.type,
      attachedTo: `${state.brandKit.studioName} Brand Kit / Watermark`,
      status: "Approved",
      provider: upload.mode === "supabase" ? `Supabase Storage / ${upload.bucket}` : "Local metadata",
      notes: upload.mode === "supabase" ? `Brand watermark stored at ${upload.path}` : `Local Brand Kit watermark path: ${upload.path}`,
      tags: ["brand-kit", "watermark", "nox-brand"],
      createdAt: nowLabel(),
    };
    const stablePreviewUrl = upload.publicUrl.startsWith("blob:") ? undefined : upload.publicUrl;
    const nextBrandKit: BrandKit = {
      ...state.brandKit,
      watermarkAssetId: asset.id,
      watermarkAssetUrl: stablePreviewUrl,
      watermarkStoragePath: upload.path,
      watermarkFilename: file.name,
    };

    setState((current) => ({
      ...current,
      brandKit: nextBrandKit,
      assets: [asset, ...current.assets],
    }));
    void persistBrandWatermarkAsset(asset, nextBrandKit, state.workspace.id);
    notify(`${file.name} saved as Brand Kit watermark.`);
  };

  const updateAssetStatus = (assetId: string, status: StudioAsset["status"]) => {
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) return;
    const nextAsset = { ...asset, status };
    const linkedScene = asset.sceneId ? state.scenes.find((scene) => scene.id === asset.sceneId) : undefined;
    const nextSceneStatus = asset.type === "Video" ? sceneStatusForAssetStatus(status) : undefined;
    const nextScene =
      linkedScene && nextSceneStatus
        ? {
            ...linkedScene,
            status: nextSceneStatus,
            uploadedAsset:
              status === "Rejected" && linkedScene.uploadedAsset === asset.filename
                ? undefined
                : status === "Approved" || status === "Needs Review"
                  ? asset.filename
                  : linkedScene.uploadedAsset,
            approvedAssetId:
              status === "Approved"
                ? asset.id
                : status === "Rejected" || linkedScene.approvedAssetId === asset.id
                  ? undefined
                  : linkedScene.approvedAssetId,
            externalProvider: asset.provider || linkedScene.externalProvider,
          }
        : undefined;
    const nextTimelineItem =
      nextScene && status === "Approved" ? buildApprovedAssetTimelineItem(nextAsset, nextScene, state.timelineItems) : undefined;
    const nextJobStatus = asset.type === "Video" ? jobStatusForAssetStatus(status) : undefined;
    const relatedJobs = nextJobStatus
      ? state.generationJobs
          .filter((job) => job.sceneId === asset.sceneId && isSceneVideoGenerationJob(job))
          .map((job) => withGenerationJobStatus(job, nextJobStatus, `Linked asset ${asset.filename} marked ${status}.`))
      : [];
    const relatedJobIds = new Set(relatedJobs.map((job) => job.id));
    setState((current) => ({
      ...current,
      assets: current.assets.map((item) => (item.id === assetId ? nextAsset : item)),
      scenes: nextScene ? current.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : current.scenes,
      generationJobs: relatedJobs.length
        ? current.generationJobs.map((job) => relatedJobIds.has(job.id) ? relatedJobs.find((item) => item.id === job.id) ?? job : job)
        : current.generationJobs,
      timelineItems: nextTimelineItem
        ? current.timelineItems.some((item) => item.id === nextTimelineItem.id)
          ? current.timelineItems.map((item) => (item.id === nextTimelineItem.id ? nextTimelineItem : item))
          : [...current.timelineItems, nextTimelineItem]
        : current.timelineItems,
    }));
    void persistRepository(repository.updateAsset(nextAsset), "Asset status");
    if (nextScene) {
      void persistRepository(repository.upsertScene(nextScene), "Scene asset review status");
      const nextScenes = state.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene));
      updateProjectProgress(nextScene.projectId, nextScenes.filter((scene) => scene.projectId === nextScene.projectId));
    }
    if (nextTimelineItem) {
      void persistRepository(repository.upsertTimelineItem(nextTimelineItem), "Timeline asset review link");
    }
    relatedJobs.forEach((job) => {
      void persistRepository(repository.upsertGenerationJob(job), "Generation job asset review status");
    });
    notify(`${asset.filename} marked ${status}${nextTimelineItem ? " and linked to NOX Cut." : "."}`);
  };

  const deleteAsset = (assetId: string) => {
    const asset = state.assets.find((item) => item.id === assetId);
    if (!asset) return;

    const linkedScene = asset.sceneId ? state.scenes.find((scene) => scene.id === asset.sceneId) : undefined;
    const linkedTimelineItems = state.timelineItems
      .filter((item) => item.assetId === assetId)
      .map((item) => ({
        ...item,
        assetId: undefined,
        editorNotes: appendAssetDeletedNote(item.editorNotes, asset.filename),
      }));
    const linkedTimelineIds = new Set(linkedTimelineItems.map((item) => item.id));
    const hasReplacementVideo = state.assets.some(
      (item) => item.id !== asset.id && item.sceneId === asset.sceneId && item.type === "Video" && item.status === "Approved",
    );
    const shouldClearSceneVideo =
      asset.type === "Video" &&
      linkedScene &&
      !hasReplacementVideo &&
      (linkedScene.uploadedAsset === asset.filename || linkedTimelineItems.some((item) => item.sceneId === linkedScene.id));
    const nextScene = shouldClearSceneVideo
      ? { ...linkedScene, uploadedAsset: undefined, approvedAssetId: undefined, status: "Needs Redo" as const }
      : linkedScene?.approvedAssetId === asset.id
        ? { ...linkedScene, approvedAssetId: undefined }
        : undefined;

    setState((current) => ({
      ...current,
      assets: current.assets.filter((item) => item.id !== assetId),
      scenes: nextScene ? current.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : current.scenes,
      timelineItems: linkedTimelineItems.length
        ? current.timelineItems.map((item) => linkedTimelineIds.has(item.id) ? linkedTimelineItems.find((updated) => updated.id === item.id) ?? item : item)
        : current.timelineItems,
    }));

    void persistRepository(repository.deleteAsset(assetId), "Asset delete");
    if (nextScene) {
      void persistRepository(repository.upsertScene(nextScene), "Scene deleted asset state");
      const nextScenes = state.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene));
      updateProjectProgress(nextScene.projectId, nextScenes.filter((scene) => scene.projectId === nextScene.projectId));
    }
    linkedTimelineItems.forEach((item) => {
      void persistRepository(repository.upsertTimelineItem(item), "Timeline deleted asset link");
    });
    notify(`${asset.filename} deleted from Asset Vault.`);
  };

  const runQueuedGenerationJob = async (jobId: string) => {
    const job = state.generationJobs.find((item) => item.id === jobId);
    if (!job) return;
    const runningJob = withGenerationJobStatus(job, "Running", "Generation runner started.");
    setState((current) => ({
      ...current,
      generationJobs: current.generationJobs.map((item) => (item.id === jobId ? runningJob : item)),
    }));
    void persistRepository(repository.upsertGenerationJob(runningJob), "Generation job runner start");

    const linkedScene = runningJob.sceneId ? state.scenes.find((scene) => scene.id === runningJob.sceneId) : undefined;
    const promptContext = linkedScene ? getScenePromptContext(linkedScene) : undefined;
    const remoteResult = isSupabaseConfigured ? await runRemoteGenerationJob({ jobId, context: promptContext }) : undefined;
    const result =
      remoteResult?.data?.job
        ? {
            job: remoteResult.data.job,
            scene: remoteResult.data.scene,
            message: remoteResult.data.message ?? "Generation job completed by the Supabase Edge processor.",
          }
        : await runGenerationJob({
            job: remoteResult?.error
              ? {
                  ...runningJob,
                  logs: appendGenerationJobLog(runningJob, `Supabase Edge processor fallback: ${remoteResult.error}`),
                }
              : runningJob,
            state,
            promptContext,
          });
    const nextSceneStatus =
      linkedScene && isSceneVideoGenerationJob(result.job) ? sceneStatusForGenerationJob(result.job.status, linkedScene) : undefined;
    const nextScene = result.scene ?? (linkedScene && nextSceneStatus ? { ...linkedScene, status: nextSceneStatus } : undefined);

    setState((current) => ({
      ...current,
      generationJobs: current.generationJobs.map((item) => (item.id === jobId ? result.job : item)),
      assets: result.asset && !current.assets.some((asset) => asset.id === result.asset?.id) ? [result.asset, ...current.assets] : current.assets,
      scenes: nextScene ? current.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : current.scenes,
    }));
    void persistRepository(repository.upsertGenerationJob(result.job), "Generation job runner result");
    if (nextScene) {
      void persistRepository(repository.upsertScene(nextScene), "Generation job runner scene result");
      const nextScenes = state.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene));
      updateProjectProgress(nextScene.projectId, nextScenes.filter((scene) => scene.projectId === nextScene.projectId));
    }
    notify(result.message);
  };

  const updateGenerationJobStatus = (jobId: string, status: GenerationJob["status"]) => {
    const job = state.generationJobs.find((item) => item.id === jobId);
    if (!job) return;
    if (status === "Running") {
      void runQueuedGenerationJob(jobId);
      return;
    }
    const nextJob = withGenerationJobStatus(job, status, `Manual queue review marked ${status}.`);
    const linkedScene = job.sceneId ? state.scenes.find((scene) => scene.id === job.sceneId) : undefined;
    const nextSceneStatus = linkedScene && isSceneVideoGenerationJob(job) ? sceneStatusForGenerationJob(status, linkedScene) : undefined;
    const nextScene = linkedScene && nextSceneStatus ? { ...linkedScene, status: nextSceneStatus } : undefined;
    setState((current) => ({
      ...current,
      generationJobs: current.generationJobs.map((item) => (item.id === jobId ? nextJob : item)),
      scenes: nextScene ? current.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene)) : current.scenes,
    }));
    void persistRepository(repository.upsertGenerationJob(nextJob), "Generation job");
    if (nextScene) {
      void persistRepository(repository.upsertScene(nextScene), "Generation job scene status");
      const nextScenes = state.scenes.map((scene) => (scene.id === nextScene.id ? nextScene : scene));
      updateProjectProgress(nextScene.projectId, nextScenes.filter((scene) => scene.projectId === nextScene.projectId));
    }
    notify(`${job.task} marked ${status}.`);
  };

  const retryGenerationJob = (jobId: string) => {
    const job = state.generationJobs.find((item) => item.id === jobId);
    if (!job) return;
    const retryCount = job.retryCount ?? 0;
    const maxRetries = job.maxRetries ?? 2;
    if (retryCount >= maxRetries) {
      notify(`${job.task} reached its retry limit.`);
      return;
    }
    const nextJob = withGenerationJobRetry(job);
    setState((current) => ({
      ...current,
      generationJobs: current.generationJobs.map((item) => (item.id === jobId ? nextJob : item)),
    }));
    void persistRepository(repository.upsertGenerationJob(nextJob), "Generation job retry");
    notify(`${job.task} retry queued.`);
  };

  const retryFailedGenerationJobs = () => {
    const failedJobs = state.generationJobs.filter(
      (job) => job.status === "Failed" && (!activeProject || job.projectId === activeProject.id) && (job.retryCount ?? 0) < (job.maxRetries ?? 2),
    );
    if (!failedJobs.length) {
      notify("No failed jobs are eligible for retry.");
      return;
    }
    const failedJobIds = new Set(failedJobs.map((job) => job.id));
    const nextJobs = failedJobs.map(withGenerationJobRetry);
    const nextJobById = new Map(nextJobs.map((job) => [job.id, job]));
    setState((current) => ({
      ...current,
      generationJobs: current.generationJobs.map((job) => (failedJobIds.has(job.id) ? nextJobById.get(job.id) ?? job : job)),
    }));
    nextJobs.forEach((job) => void persistRepository(repository.upsertGenerationJob(job), "Batch generation job retry"));
    notify(`${nextJobs.length} failed job${nextJobs.length === 1 ? "" : "s"} queued for retry.`);
  };

  const approvePassingGeneratedAssets = () => {
    if (!activeProject) return;
    const reviewAssets = state.assets.filter(
      (asset) => asset.projectId === activeProject.id && asset.sceneId && asset.type === "Video" && asset.status === "Needs Review",
    );
    const approvedAssets: StudioAsset[] = [];
    const nextScenes: SceneCard[] = [];
    const nextTimelineItems: TimelineItem[] = [];
    const nextJobs: GenerationJob[] = [];

    for (const asset of reviewAssets) {
      const scene = state.scenes.find((item) => item.id === asset.sceneId);
      if (!scene) continue;
      const report = runContinuityCheck(scene, state.characters, state.worlds, state.locations, state.factions);
      if (report.status !== "Pass") continue;
      const nextAsset: StudioAsset = {
        ...asset,
        status: "Approved",
        notes: `${asset.notes} Continuity auto-approval passed: ${report.summary}`,
      };
      const nextScene: SceneCard = {
        ...scene,
        status: "Approved",
        uploadedAsset: asset.filename,
        approvedAssetId: asset.id,
      };
      approvedAssets.push(nextAsset);
      nextScenes.push(nextScene);
      nextTimelineItems.push(buildApprovedAssetTimelineItem(nextAsset, nextScene, state.timelineItems));
      state.generationJobs
        .filter((job) => job.sceneId === scene.id && isSceneVideoGenerationJob(job))
        .forEach((job) => nextJobs.push(withGenerationJobStatus(job, "Approved", `Continuity passed; linked asset ${asset.filename} approved.`)));
    }

    if (!approvedAssets.length) {
      notify("No review video assets passed continuity for batch approval.");
      return;
    }

    const assetById = new Map(approvedAssets.map((asset) => [asset.id, asset]));
    const sceneById = new Map(nextScenes.map((scene) => [scene.id, scene]));
    const timelineById = new Map(nextTimelineItems.map((item) => [item.id, item]));
    const jobById = new Map(nextJobs.map((job) => [job.id, job]));
    const existingTimelineIds = new Set(state.timelineItems.map((item) => item.id));
    const projectScenesAfterApproval = projectScenes.map((scene) => sceneById.get(scene.id) ?? scene);
    const nextProject = deriveProjectProgress(activeProject, projectScenesAfterApproval);

    setState((current) => ({
      ...current,
      assets: current.assets.map((asset) => assetById.get(asset.id) ?? asset),
      scenes: current.scenes.map((scene) => sceneById.get(scene.id) ?? scene),
      timelineItems: [
        ...current.timelineItems.map((item) => timelineById.get(item.id) ?? item),
        ...nextTimelineItems.filter((item) => !existingTimelineIds.has(item.id)),
      ],
      generationJobs: current.generationJobs.map((job) => jobById.get(job.id) ?? job),
      projects: current.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    }));
    approvedAssets.forEach((asset) => void persistRepository(repository.updateAsset(asset), "Batch approved asset"));
    nextScenes.forEach((scene) => void persistRepository(repository.upsertScene(scene), "Batch approved scene"));
    nextTimelineItems.forEach((item) => void persistRepository(repository.upsertTimelineItem(item), "Batch approval timeline"));
    nextJobs.forEach((job) => void persistRepository(repository.upsertGenerationJob(job), "Batch approved generation job"));
    void persistRepository(repository.updateProject(nextProject), "Batch approval project progress");
    notify(`${approvedAssets.length} video asset${approvedAssets.length === 1 ? "" : "s"} approved and linked to NOX Cut.`);
  };

  const uploadCharacterReference = async (character: CharacterProfile, file: File) => {
    const characterId = character.id || makeId("character");
    const nextCharacterBase = { ...character, id: characterId, workspaceId: state.workspace.id };
    const upload = await uploadStudioFile({
      workspaceId: state.workspace.id,
      characterId,
      file,
      type: "Image",
    });

    if (upload.error) {
      notify(`Character reference upload failed: ${upload.error}`);
      return;
    }

    const referencePointer = upload.path;
    const nextCharacter = { ...nextCharacterBase, referenceImageUrl: referencePointer };
    const asset: StudioAsset = {
      id: makeId("asset"),
      workspaceId: state.workspace.id,
      characterId,
      filename: file.name,
      type: "Image",
      fileUrl: upload.publicUrl,
      storagePath: upload.path,
      mimeType: file.type,
      attachedTo: `${nextCharacter.name || "Character"} / Reference Image`,
      status: "Approved",
      provider: upload.mode === "supabase" ? `Supabase Storage / ${upload.bucket}` : "Local reference preview",
      notes:
        upload.mode === "supabase"
          ? `Stored at ${upload.path}. Used by continuity prompts as the face/reference source.`
          : `Local preview path: ${upload.path}. Used by continuity prompts as the face/reference source.`,
      tags: ["character-reference", "continuity", slugForTag(nextCharacter.name || "character")],
      createdAt: nowLabel(),
    };

    setState((current) => {
      const exists = current.characters.some((item) => item.id === nextCharacter.id);
      return {
        ...current,
        characters: exists
          ? current.characters.map((item) => (item.id === nextCharacter.id ? nextCharacter : item))
          : [nextCharacter, ...current.characters],
        assets: [asset, ...current.assets],
      };
    });
    void persistRepository(repository.upsertCharacter(nextCharacter), "Character reference");
    void persistRepository(repository.createAsset(asset), "Character reference asset");
    notify(`${nextCharacter.name || "Character"} reference image saved to Asset Vault.`);
  };

  const saveCharacter = (character: CharacterProfile) => {
    const nextCharacter = { ...character, id: character.id || makeId("character"), workspaceId: state.workspace.id };
    setState((current) => {
      const exists = current.characters.some((item) => item.id === nextCharacter.id);
      return {
        ...current,
        characters: exists
          ? current.characters.map((item) => (item.id === nextCharacter.id ? nextCharacter : item))
          : [nextCharacter, ...current.characters],
      };
    });
    void persistRepository(repository.upsertCharacter(nextCharacter), "Character");
    notify(`${nextCharacter.name || "Character"} saved.`);
  };

  const deleteCharacter = (characterId: string) => {
    const character = state.characters.find((item) => item.id === characterId);
    setState((current) => ({
      ...current,
      characters: current.characters.filter((item) => item.id !== characterId),
    }));
    void persistRepository(repository.deleteCharacter(characterId), "Character delete");
    notify(`${character?.name ?? "Character"} deleted.`);
  };

  const saveWorld = (world: WorldEntry) => {
    const nextWorld = { ...world, id: world.id || makeId("world"), workspaceId: state.workspace.id };
    setState((current) => {
      const exists = current.worlds.some((item) => item.id === nextWorld.id);
      return {
        ...current,
        worlds: exists ? current.worlds.map((item) => (item.id === nextWorld.id ? nextWorld : item)) : [nextWorld, ...current.worlds],
      };
    });
    void persistRepository(repository.upsertWorld(nextWorld), "World");
    notify(`${nextWorld.name || "World"} saved.`);
  };

  const deleteWorld = (worldId: string) => {
    const world = state.worlds.find((item) => item.id === worldId);
    setState((current) => ({
      ...current,
      worlds: current.worlds.filter((item) => item.id !== worldId),
      locations: current.locations.filter((item) => item.worldId !== worldId),
      factions: current.factions.filter((item) => item.worldId !== worldId),
    }));
    void persistRepository(repository.deleteWorld(worldId), "World delete");
    notify(`${world?.name ?? "World"} deleted.`);
  };

  const saveLocation = (location: LocationEntry) => {
    const nextLocation = { ...location, id: location.id || makeId("location"), workspaceId: state.workspace.id };
    setState((current) => {
      const exists = current.locations.some((item) => item.id === nextLocation.id);
      return {
        ...current,
        locations: exists ? current.locations.map((item) => (item.id === nextLocation.id ? nextLocation : item)) : [nextLocation, ...current.locations],
      };
    });
    void persistRepository(repository.upsertLocation(nextLocation), "Location");
    notify(`${nextLocation.name || "Location"} saved.`);
  };

  const deleteLocation = (locationId: string) => {
    const location = state.locations.find((item) => item.id === locationId);
    setState((current) => ({
      ...current,
      locations: current.locations.filter((item) => item.id !== locationId),
    }));
    void persistRepository(repository.deleteLocation(locationId), "Location delete");
    notify(`${location?.name ?? "Location"} deleted.`);
  };

  const saveFaction = (faction: FactionEntry) => {
    const nextFaction = { ...faction, id: faction.id || makeId("faction"), workspaceId: state.workspace.id };
    setState((current) => {
      const exists = current.factions.some((item) => item.id === nextFaction.id);
      return {
        ...current,
        factions: exists ? current.factions.map((item) => (item.id === nextFaction.id ? nextFaction : item)) : [nextFaction, ...current.factions],
      };
    });
    void persistRepository(repository.upsertFaction(nextFaction), "Faction");
    notify(`${nextFaction.name || "Faction"} saved.`);
  };

  const deleteFaction = (factionId: string) => {
    const faction = state.factions.find((item) => item.id === factionId);
    setState((current) => ({
      ...current,
      factions: current.factions.filter((item) => item.id !== factionId),
    }));
    void persistRepository(repository.deleteFaction(factionId), "Faction delete");
    notify(`${faction?.name ?? "Faction"} deleted.`);
  };

  const updateProvider = (providerId: string, enabled: boolean) => {
    const nextProvider = state.providers.find((provider) => provider.id === providerId);
    if (!nextProvider) return;
    const updatedProvider = { ...nextProvider, enabled };
    updateProviderSettings(updatedProvider);
  };

  const updateProviderSettings = (updatedProvider: Provider) => {
    setState((current) => ({
      ...current,
      providers: current.providers.map((provider) => (provider.id === updatedProvider.id ? updatedProvider : provider)),
    }));
    void persistRepository(repository.upsertProvider(updatedProvider, state.workspace.id), "Provider setting");
  };

  const updateBrandKit = (brandKit: BrandKit) => {
    setState((current) => ({ ...current, brandKit }));
    void persistRepository(repository.upsertBrandKit(brandKit, state.workspace.id), "Brand Kit");
    notify("Brand Kit saved.");
  };

  const updateProjectStatus = (projectId: string, status: Project["status"]) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const nextProject = { ...project, status, nextStep: `Project moved to ${status}`, updatedAt: nowLabel() };

    setState((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === projectId ? nextProject : item)),
    }));
    void persistRepository(repository.updateProject(nextProject), "Project status");
    notify(`Project moved to ${status}.`);
  };

  const updateProject = (project: Project) => {
    const nextProject = { ...project, updatedAt: nowLabel() };
    setState((current) => ({
      ...current,
      projects: current.projects.map((item) => (item.id === project.id ? nextProject : item)),
    }));
    void persistRepository(repository.updateProject(nextProject), "Project");
    notify("Project saved.");
  };

  const deleteProject = (projectId: string) => {
    if (state.projects.length <= 1) {
      notify("Keep at least one project in the workspace.");
      return;
    }

    const nextProject = state.projects.find((project) => project.id !== projectId);
    setState((current) => ({
      ...current,
      projects: current.projects.filter((project) => project.id !== projectId),
      scenes: current.scenes.filter((scene) => scene.projectId !== projectId),
      assets: current.assets.filter((asset) => asset.projectId !== projectId),
      generationJobs: current.generationJobs.filter((job) => job.projectId !== projectId),
      publishKits: current.publishKits.filter((kit) => kit.projectId !== projectId),
      timelineItems: current.timelineItems.filter((item) => item.projectId !== projectId),
    }));
    setSelectedProjectId(nextProject?.id ?? "");
    setSelectedSceneId(state.scenes.find((scene) => scene.projectId === nextProject?.id)?.id ?? "");
    void persistRepository(repository.deleteProject(projectId), "Project delete");
    notify("Project deleted from local workspace.");
  };

  const addSceneCard = () => {
    if (!activeProject) return;
    const nextNumber = projectScenes.length + 1;
    const nextProject: Project = {
      ...activeProject,
      sceneCount: activeProject.sceneCount + 1,
      runtime: `${(activeProject.sceneCount + 1) * 10} seconds`,
      updatedAt: nowLabel(),
    };
    const newScene: SceneCard = {
      id: makeId("scene"),
      projectId: activeProject.id,
      number: nextNumber,
      title: `NEW SIGNAL ${String(nextNumber).padStart(2, "0")}`,
      purpose: "Advance the story while preserving the 10-second Scene Card rule.",
      durationSeconds: 10,
      output: "One generated video",
      format: activeProject.format,
      location: activeProject.world,
      characters: activeProject.mainCharacters.slice(0, 1),
      mood: activeProject.tone,
      visualStyle: `Hyperrealistic futuristic cyberglass cinema, ${activeProject.genre}, dramatic contrast.`,
      summary: `Scene ${nextNumber} extends ${activeProject.title}.`,
      beats: [
        {
          id: makeId("beat"),
          range: "0-3s",
          title: "Visual hook",
          description: "Open with one strong cinematic image.",
          camera: "Wide establishing view.",
          audio: "Atmospheric intro.",
        },
        {
          id: makeId("beat"),
          range: "3-7s",
          title: "Story pressure",
          description: "Push toward the character as the conflict tightens.",
          camera: "Smooth push-in.",
          audio: "Low bass tension.",
        },
        {
          id: makeId("beat"),
          range: "7-10s",
          title: "Ending hook",
          description: "End on a reveal that motivates the next scene.",
          camera: "Tight close-up.",
          audio: "Glitch hit.",
        },
      ],
      dialogue: 'Spanish line: "No podemos parar ahora."',
      audio: "Rain, low cinematic bass, electric glitch.",
      fullPrompt: "",
      externalProvider: activeProject.aiTarget,
      negativePrompt: "No random extra characters, no location change, no cartoon style, no distorted face.",
      continuityRules: [
        "Keep all beats inside one generated 10-second video.",
        "Do not create separate video files for internal beats.",
      ],
      status: "Draft",
    };
    const promptedScene = {
      ...newScene,
      promptProvider: activeProject.aiTarget,
      fullPrompt: formatScenePrompt(newScene, activeProject.aiTarget, { language: activeProject.language }),
    };
    setState((current) => ({
      ...current,
      scenes: [...current.scenes, promptedScene],
      projects: current.projects.map((project) => (project.id === activeProject.id ? nextProject : project)),
    }));
    setSelectedSceneId(promptedScene.id);
    void persistRepository(repository.upsertScene(promptedScene), "Scene Card");
    void persistRepository(repository.updateProject(nextProject), "Scene count");
    notify("Scene Card added.");
  };

  const updateSceneCard = (scene: SceneCard) => {
    setState((current) => ({
      ...current,
      scenes: current.scenes.map((item) => (item.id === scene.id ? scene : item)),
    }));
    void persistRepository(repository.upsertScene(scene), "Scene Card");
    notify("Scene Card saved.");
  };

  const deleteSceneCard = (sceneId: string) => {
    const scene = state.scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const remainingProjectScenes = projectScenes.filter((item) => item.id !== sceneId);
    if (remainingProjectScenes.length === 0) {
      notify("A project needs at least one Scene Card.");
      return;
    }
    const nextProject = activeProject?.id === scene.projectId
      ? { ...activeProject, sceneCount: remainingProjectScenes.length, runtime: `${remainingProjectScenes.length * 10} seconds`, updatedAt: nowLabel() }
      : state.projects.find((project) => project.id === scene.projectId);

    setState((current) => {
      const remainingScenes = current.scenes
        .filter((item) => item.id !== sceneId)
        .map((item) => {
          if (item.projectId !== scene.projectId) return item;
          const renumberedIndex = remainingProjectScenes.findIndex((projectScene) => projectScene.id === item.id);
          return renumberedIndex >= 0 ? { ...item, number: renumberedIndex + 1 } : item;
        });

      return {
        ...current,
        scenes: remainingScenes,
        assets: current.assets.filter((asset) => asset.sceneId !== sceneId),
        generationJobs: current.generationJobs.filter((job) => job.sceneId !== sceneId),
        timelineItems: current.timelineItems.filter((item) => item.sceneId !== sceneId),
        projects: current.projects.map((project) =>
          project.id === scene.projectId
            ? { ...project, sceneCount: remainingProjectScenes.length, runtime: `${remainingProjectScenes.length * 10} seconds`, updatedAt: nowLabel() }
            : project,
        ),
      };
    });
    setSelectedSceneId(remainingProjectScenes[0].id);
    void persistRepository(repository.deleteScene(sceneId), "Scene Card delete");
    if (nextProject) void persistRepository(repository.updateProject(nextProject), "Scene count");
    notify("Scene Card deleted.");
  };

  const handleQuickAction = (label: string) => {
    if (label === "Open Editor") {
      setActiveView("cut");
      return;
    }
    if (label === "Generate Publish Kit") {
      setActiveView("publish");
      return;
    }
    if (label === "Upload Clips") {
      setActiveView("vault");
      notify("Asset Vault is ready for uploads.");
      return;
    }
    setActiveView(label.startsWith("New") ? "create" : "command");
  };

  if (booting) {
    return (
      <div className="boot-screen">
        <div>
          <span>NX</span>
          <strong>Loading NOX Studio</strong>
          <p>Checking workspace, session, and production data.</p>
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <LoginScreen
        error={loginError}
        message={loginMessage}
        onEnter={handleEmailSignIn}
        onCreateAccount={handleEmailSignUp}
        onResetPassword={handlePasswordReset}
        onGoogle={handleGoogleSignIn}
      />
    );
  }

  const screen = (() => {
    switch (activeView) {
      case "projects":
        return (
          <ProjectLibrary
            projects={state.projects}
            onNavigate={setActiveView}
            onSelectProject={(projectId) => {
              setSelectedProjectId(projectId);
              setActiveView("scene");
            }}
            onUpdateProject={updateProject}
            onUpdateProjectStatus={updateProjectStatus}
            onDeleteProject={deleteProject}
          />
        );
      case "create":
        return <CreateWizard onCreateProject={createProject} />;
      case "scene":
        if (!activeProject || !selectedScene) {
          return <CreateWizard onCreateProject={createProject} />;
        }
        return (
          <SceneComposer
            scenes={projectScenes}
            selectedScene={selectedScene}
            projectProvider={activeProject.aiTarget}
            promptProviders={promptProviderOptions}
            sceneJobs={selectedSceneJobs}
            sceneVideoState={selectedSceneVideoState ?? getSceneVideoState(state, selectedScene.id)}
            generationMode={generationMode}
            onSelectScene={setSelectedSceneId}
            onCopyPrompt={copyScenePrompt}
            onSelectProvider={updateSceneProvider}
            onUpdateStatus={updateSceneStatus}
            onAttachVideo={attachVideo}
            onRegeneratePrompt={regeneratePrompt}
            onPolishPrompt={polishPrompt}
            onGenerateVideo={queueVideoGeneration}
            onRunSceneJob={runQueuedGenerationJob}
            onOpenProviderSettings={() => setActiveView("settings")}
            onUpdateScene={updateSceneCard}
            onAddScene={addSceneCard}
            onDeleteScene={deleteSceneCard}
            continuityReport={selectedContinuityReport}
            sceneAsset={
              (selectedScene?.approvedAssetId ? state.assets.find((asset) => asset.id === selectedScene.approvedAssetId) : undefined) ??
              state.assets.find((asset) => asset.sceneId === selectedScene?.id && asset.type === "Video" && asset.status === "Approved") ??
              state.assets.find((asset) => asset.sceneId === selectedScene?.id && asset.type === "Video")
            }
          />
        );
      case "script":
        return <ScriptRoom scenes={projectScenes} project={activeProject} />;
      case "vault":
        return (
          <VaultHub
            assets={state.assets}
            characters={state.characters}
            worlds={state.worlds}
            locations={state.locations}
            factions={state.factions}
            generationJobs={state.generationJobs}
            activeProjectId={activeProject?.id}
            activeSceneId={selectedScene?.id}
            defaultQueueLane="Video"
            onUploadAsset={addVaultAsset}
            onUpdateAssetStatus={updateAssetStatus}
            onDeleteAsset={deleteAsset}
            onUpdateGenerationJobStatus={updateGenerationJobStatus}
            onRetryGenerationJob={retryGenerationJob}
            onQueueMissingVideos={queueAllMissingVideos}
            onQueuePublishMedia={queuePublishMediaJobs}
            onRetryFailedJobs={retryFailedGenerationJobs}
            onApprovePassingAssets={approvePassingGeneratedAssets}
            onCopyAssetPrompt={(asset) => {
              if (asset.promptUsed) void copyText(asset.promptUsed, "Asset prompt used");
            }}
            onSaveCharacter={saveCharacter}
            onDeleteCharacter={deleteCharacter}
            onUploadCharacterReference={uploadCharacterReference}
            onSaveWorld={saveWorld}
            onDeleteWorld={deleteWorld}
            onSaveLocation={saveLocation}
            onDeleteLocation={deleteLocation}
            onSaveFaction={saveFaction}
            onDeleteFaction={deleteFaction}
          />
        );
      case "cut":
        return (
          <NoxCut
            scenes={projectScenes}
            timelineItems={state.timelineItems.filter((item) => item.projectId === activeProject?.id)}
            assets={state.assets.filter((asset) => asset.projectId === activeProject?.id)}
            generationJobs={state.generationJobs.filter((job) => job.projectId === activeProject?.id)}
            renderJob={activeRenderJob}
            finalExportAsset={activeFinalExportAsset}
            onGenerateMissingClips={queueAllMissingVideos}
            onGenerateSceneClip={queueVideoGeneration}
            onApproveSceneClip={(sceneId) => updateSceneStatus(sceneId, "Approved")}
            onRunRenderJob={generateFullShortFilm}
            onOpenScene={(sceneId) => {
              setSelectedSceneId(sceneId);
              setActiveView("scene");
            }}
            onExportEditPlan={exportCurrentEditPlan}
            onExportRenderManifest={exportRenderManifestFile}
            onQueueRender={queueRenderJob}
            onMoveScene={moveSceneInCut}
            onAddTimelineUtility={addTimelineUtility}
            onUpdateTimelineClip={updateTimelineClip}
          />
        );
      case "publish":
        return (
          <PublishKitScreen
            publishKit={activePublishKit}
            releaseOperationPlans={releaseOperationPlans}
            finalExportAssetUrl={state.assets.find((asset) => asset.projectId === activeProject?.id && asset.type === "Final Export")?.fileUrl}
            onCopy={copyText}
            onGenerate={generateCurrentPublishKit}
            onUpdate={updatePublishKit}
            onExport={exportCurrentProject}
            onExportReleaseBundle={exportReleaseBundle}
            onQueueReleaseOperation={queueReleaseOperation}
          />
        );
      case "analytics":
        return (
          <AnalyticsScreen
            projects={state.projects}
            scenes={state.scenes}
            assets={state.assets}
            generationJobs={state.generationJobs}
            timelineItems={state.timelineItems}
          />
        );
      case "settings":
        return (
          <SettingsScreen
            assets={state.assets}
            providers={state.providers}
            brandKit={state.brandKit}
            workspaceId={state.workspace.id}
            onUpdateBrandKit={updateBrandKit}
            onUploadWatermark={uploadBrandWatermark}
            onToggleProvider={updateProvider}
            onUpdateProvider={updateProviderSettings}
          />
        );
      case "command":
      default:
        return <CommandCenter state={state} onNavigate={setActiveView} onQuickAction={handleQuickAction} />;
    }
  })();

  return (
    <AppShell
      activeView={activeView}
      projects={state.projects}
      activeProject={activeProject}
      selectedScene={selectedScene}
      toast={toast}
      userName={state.user.name}
      onNavigate={setActiveView}
      onSignOut={handleSignOut}
    >
      {screen}
    </AppShell>
  );
}

function sceneStatusForAssetStatus(status: StudioAsset["status"]): SceneStatus | undefined {
  if (status === "Approved") return "Approved";
  if (status === "Rejected") return "Needs Redo";
  if (status === "Needs Review") return "Video Uploaded";
  return undefined;
}

function jobStatusForAssetStatus(status: StudioAsset["status"]): GenerationJob["status"] | undefined {
  if (status === "Approved") return "Approved";
  if (status === "Rejected") return "Failed";
  if (status === "Needs Review") return "Needs Review";
  return undefined;
}

function sceneStatusForGenerationJob(status: GenerationJob["status"], scene: SceneCard): SceneStatus | undefined {
  if (status === "Failed") return "Needs Redo";
  if (status === "Approved" && scene.uploadedAsset) return "Approved";
  if ((status === "Completed" || status === "Needs Review") && scene.uploadedAsset) return "Video Uploaded";
  if (status === "Queued" || status === "Running" || status === "Completed") return "Generating Video";
  return undefined;
}

function deriveProjectProgress(project: Project, scenes: SceneCard[]): Project {
  const generatedScenes = scenes.filter((scene) => isSceneVideoReady(scene.status)).length;
  const hasGeneratingScene = scenes.some((scene) => scene.status === "Generating Video");
  const hasOpenVideoWork = scenes.some((scene) => ["Video Uploaded", "Needs Redo"].includes(scene.status));
  const status: Project["status"] =
    scenes.length > 0 && generatedScenes === scenes.length
      ? "Editing"
      : hasGeneratingScene
        ? "Generating Videos"
        : generatedScenes > 0 || hasOpenVideoWork
          ? "Scene Videos Needed"
          : "Scene Prompts Ready";

  return {
    ...project,
    generatedScenes,
    status,
    nextStep: deriveProjectNextStep(scenes),
    updatedAt: nowLabel(),
  };
}

function isSceneVideoReady(status: SceneStatus) {
  return ["Video Uploaded", "Approved", "Added to Timeline", "Rendered", "Published"].includes(status);
}

function deriveProjectNextStep(scenes: SceneCard[]) {
  const needsRedo = scenes.find((scene) => scene.status === "Needs Redo");
  if (needsRedo) return `Redo Scene ${String(needsRedo.number).padStart(2, "0")}`;

  const needsReview = scenes.find((scene) => scene.status === "Video Uploaded");
  if (needsReview) return `Review Scene ${String(needsReview.number).padStart(2, "0")}`;

  const needsUpload = scenes.find((scene) => scene.status === "Generating Video");
  if (needsUpload) return `Upload Scene ${String(needsUpload.number).padStart(2, "0")}`;

  const needsGeneration = scenes.find((scene) => scene.status === "Draft" || scene.status === "Prompt Ready");
  if (needsGeneration) return `Generate Scene ${String(needsGeneration.number).padStart(2, "0")}`;

  return "Assemble in NOX Cut";
}

function isSceneVideoGenerationJob(job: GenerationJob) {
  const text = `${job.task} ${job.provider}`.toLowerCase();
  return text.includes("video") || text.includes("manual external") || text.includes("storage");
}

function withGenerationJobStatus(job: GenerationJob, status: GenerationJob["status"], detail: string): GenerationJob {
  const timestamp = new Date().toISOString();
  const completedStatuses = new Set<GenerationJob["status"]>(["Completed", "Failed", "Approved"]);
  return {
    ...job,
    status,
    startedAt: status === "Running" ? timestamp : job.startedAt,
    completedAt: completedStatuses.has(status) ? timestamp : status === "Queued" || status === "Running" ? undefined : job.completedAt,
    outputPayload: status === "Failed" ? job.outputPayload : detail,
    errorMessage: status === "Failed" ? detail : "",
    retryCount: job.retryCount ?? 0,
    maxRetries: job.maxRetries ?? 2,
    runAfter: status === "Queued" || status === "Failed" ? timestamp : job.runAfter,
    lockedAt: status === "Running" ? timestamp : undefined,
    lockedBy: status === "Running" ? "browser-runner" : undefined,
    logs: appendGenerationJobLog(job, `${status}: ${detail}`),
  };
}

function withGenerationJobRetry(job: GenerationJob): GenerationJob {
  const retryCount = (job.retryCount ?? 0) + 1;
  return {
    ...job,
    status: "Queued",
    retryCount,
    maxRetries: job.maxRetries ?? 2,
    startedAt: undefined,
    completedAt: undefined,
    errorMessage: "",
    outputPayload: `Retry ${retryCount} queued after ${job.status}.`,
    runAfter: new Date().toISOString(),
    lockedAt: undefined,
    lockedBy: undefined,
    logs: appendGenerationJobLog(job, `Retry ${retryCount} queued.`),
  };
}

function appendGenerationJobLog(job: GenerationJob, message: string) {
  const timestamp = new Date().toISOString();
  return [...(job.logs ?? []), `${timestamp} - ${message}`].slice(-12);
}

function buildApprovedAssetTimelineItem(asset: StudioAsset, scene: SceneCard, timelineItems: TimelineItem[]): TimelineItem {
  const existing = timelineItems.find((item) => item.sceneId === scene.id && item.trackType === "video");
  const orderIndex = existing?.orderIndex ?? Math.max(scene.number - 1, 0);

  return {
    id: existing?.id ?? makeId("timeline"),
    projectId: scene.projectId,
    sceneId: scene.id,
    assetId: asset.id,
    trackType: "video",
    label: existing?.label ?? `SCENE ${String(scene.number).padStart(2, "0")} - ${scene.title}`,
    startTime: existing?.startTime ?? orderIndex * 10,
    endTime: existing?.endTime ?? orderIndex * 10 + 10,
    orderIndex,
    transitionIn: existing?.transitionIn ?? (orderIndex === 0 ? "Blackout Cut" : "Cyberglass Swipe"),
    transitionOut: existing?.transitionOut ?? "Signal Glitch",
    trimStartNote: existing?.trimStartNote ?? "Start on first clean usable frame.",
    trimEndNote: existing?.trimEndNote ?? "End before provider reset or unwanted extra motion.",
    editorNotes: appendApprovedAssetNote(existing?.editorNotes, asset.filename),
  };
}

function appendApprovedAssetNote(note: string | undefined, filename: string) {
  const approvedNote = `Source approved asset: ${filename}`;
  if (!note) return approvedNote;
  if (note.includes(approvedNote)) return note;
  if (note.includes("Needs approved source asset") || note.includes("Timeline item added before final approved asset")) return approvedNote;
  return `${note} ${approvedNote}`;
}

function slugForTag(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "reference";
}

function appendAssetDeletedNote(note: string | undefined, filename: string) {
  const deletedNote = `Source asset deleted from Vault: ${filename}.`;
  if (!note) return deletedNote;
  if (note.includes(deletedNote)) return note;
  return `${note} ${deletedNote}`;
}

export default App;
