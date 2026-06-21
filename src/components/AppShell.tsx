import {
  Bell,
  Bot,
  ChevronRight,
  CircleUserRound,
  Film,
  LogOut,
  RadioTower,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { mobileNavKeys, navItems } from "../data/studioData";
import type { Project, SceneCard, ViewKey } from "../types";
import { GlassPanel } from "./GlassPanel";
import { StatusPill } from "./StatusPill";

type AppShellProps = {
  activeView: ViewKey;
  children: ReactNode;
  projects: Project[];
  activeProject?: Project;
  selectedScene?: SceneCard;
  toast?: string;
  userName: string;
  onNavigate: (view: ViewKey) => void;
  onSignOut: () => void;
};

export function AppShell({
  activeView,
  children,
  projects,
  activeProject,
  selectedScene,
  toast,
  userName,
  onNavigate,
  onSignOut,
}: AppShellProps) {
  const mobileItems = navItems.filter((item) => (mobileNavKeys as readonly string[]).includes(item.key));
  const assistantProject = activeProject ?? projects[0];
  const missingWorkspace = !assistantProject || !selectedScene;
  const assistantAlerts = missingWorkspace
    ? [{ tone: "cyan", text: "Create a short film to start the real workflow." }]
    : [
        selectedScene.status === "Prompt Ready"
          ? { tone: "warning", text: `Scene ${String(selectedScene.number).padStart(2, "0")} needs a generated or uploaded clip.` }
          : undefined,
        selectedScene.status === "Video Uploaded"
          ? { tone: "cyan", text: `Scene ${String(selectedScene.number).padStart(2, "0")} is ready for review.` }
          : undefined,
        assistantProject.generatedScenes < assistantProject.sceneCount
          ? { tone: "warning", text: `${assistantProject.sceneCount - assistantProject.generatedScenes} scene clip${assistantProject.sceneCount - assistantProject.generatedScenes === 1 ? "" : "s"} still needed.` }
          : { tone: "cyan", text: "Scene videos are ready for NOX Cut." },
      ].filter((alert): alert is { tone: string; text: string } => Boolean(alert));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <button className="brand-lockup" onClick={() => onNavigate("command")} type="button">
          <span className="brand-mark" aria-hidden="true">
            NX
          </span>
          <span>
            <strong>NOX Studio</strong>
            <small>AI Film OS</small>
          </span>
        </button>

        <nav className="side-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                className={`side-nav-item ${active ? "is-active" : ""}`}
                key={item.key}
                onClick={() => onNavigate(item.key)}
                type="button"
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <GlassPanel className="sidebar-pulse" variant="flat">
          <div className="mini-orb" aria-hidden="true">
            <RadioTower size={17} />
          </div>
          <div>
            <strong>Scene Card Rule</strong>
            <p>1 card = 1 generated 10s video.</p>
          </div>
        </GlassPanel>
      </aside>

      <div className="workspace-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <p>Scene Card Cinema Pipeline</p>
            <h1>Build your cinematic universe, one Scene Card at a time.</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" title="Studio alerts" onClick={() => onNavigate("command")}>
              <Bell size={18} />
            </button>
            <button className="user-chip" type="button" onClick={onSignOut}>
              <CircleUserRound size={18} />
              <span>{userName}</span>
              <LogOut size={15} />
            </button>
          </div>
        </header>

        <main className="workspace">{children}</main>
      </div>

      <aside className="agent-rail" aria-label="AI Agent Panel">
        <GlassPanel className="agent-panel" variant="strong">
          <div className="agent-header">
            <div>
              <p>AI Agent Panel</p>
              <h2>Project Assistant</h2>
            </div>
            <span className="agent-state">
              <Bot size={16} />
              Live
            </span>
          </div>

          <div className="assistant-card">
            <div className="assistant-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>{missingWorkspace ? "Create your first project" : assistantProject?.nextStep}</strong>
              <p>
                {missingWorkspace
                  ? "NOX Core is ready to turn an idea into Scene Cards."
                  : `${assistantProject?.title} still needs ${
                      (assistantProject?.sceneCount ?? 0) - (assistantProject?.generatedScenes ?? 0)
                    } scene videos.`}
              </p>
            </div>
          </div>

          <div className="agent-block">
            <div className="agent-block-title">
              <Zap size={16} />
              Generation Status
            </div>
            <div className="generation-meter">
              <span
                style={{
                  width: missingWorkspace
                    ? "0%"
                    : `${((assistantProject?.generatedScenes ?? 0) / Math.max(assistantProject?.sceneCount ?? 1, 1)) * 100}%`,
                }}
              />
            </div>
            <p>
              {missingWorkspace
                ? "No scene videos ready"
                : `${assistantProject?.generatedScenes ?? 0}/${assistantProject?.sceneCount ?? 0} scene videos ready`}
            </p>
          </div>

          <div className="agent-block">
            <div className="agent-block-title">
              <Film size={16} />
              Active Scene
            </div>
            {selectedScene ? (
              <button className="selected-scene-button" type="button" onClick={() => onNavigate("scene")}>
                <span>SCENE {String(selectedScene.number).padStart(2, "0")}</span>
                <strong>{selectedScene.title}</strong>
                <StatusPill label={selectedScene.status} compact />
                <ChevronRight size={16} />
              </button>
            ) : (
              <button className="selected-scene-button" type="button" onClick={() => onNavigate("create")}>
                <span>NO SCENE</span>
                <strong>Generate Scene Cards</strong>
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          <div className="agent-block">
            <div className="agent-block-title">
              <ShieldAlert size={16} />
              Continuity Warnings
            </div>
            <div className="alert-stack">
              {assistantAlerts.slice(0, 4).map((alert) => (
                <button className={`alert-item alert-${alert.tone}`} key={alert.text} type="button">
                  {alert.text}
                </button>
              ))}
            </div>
          </div>
        </GlassPanel>
      </aside>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activeView === item.key ? "is-active" : ""}
              key={item.key}
              onClick={() => onNavigate(item.key)}
              type="button"
              title={item.label}
            >
              <Icon size={19} />
              <span>
                {item.label
                  .replace("Command Center", "Home")
                  .replace("Scene Composer", "Scenes")
                  .replace("NOX Cut", "Editor")}
              </span>
            </button>
          );
        })}
      </nav>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
