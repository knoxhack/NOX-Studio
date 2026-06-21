import { PenLine, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { Project, SceneCard } from "../types";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";

type ScriptRoomProps = {
  scenes: SceneCard[];
  project?: Project;
};

export function ScriptRoom({ scenes, project }: ScriptRoomProps) {
  const [view, setView] = useState<"Simple" | "Dialogue" | "Production" | "Prompt">("Production");

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading
          title="Script Room"
          meta="Story, dialogue, scene purpose, and prompt-facing production notes."
          action={
            <button className="ghost-button small-button" type="button">
              <RefreshCw size={16} />
              Rewrite
            </button>
          }
        />
        <div className="script-layout">
          <aside className="script-sidebar">
            <strong>{project?.title ?? "NOX Project"}</strong>
            <p>{project?.synopsis ?? "Scene-by-scene script and production prompt views."}</p>
            <label>
              <span>Tone slider</span>
              <input type="range" min="0" max="100" defaultValue="72" />
            </label>
            <button className="cyan-button wide-button" type="button">
              <SlidersHorizontal size={17} />
              Spanish Dialogue Polish
            </button>
          </aside>
          <div className="script-main">
            <div className="scene-tabs">
              {(["Simple", "Dialogue", "Production", "Prompt"] as const).map((item) => (
                <button className={view === item ? "is-active" : ""} key={item} onClick={() => setView(item)} type="button">
                  {item} View
                </button>
              ))}
            </div>
            <div className="script-scenes">
              {scenes.map((scene) => (
                <article className="script-scene" key={scene.id}>
                  <div className="script-scene-head">
                    <span>SCENE {String(scene.number).padStart(2, "0")}</span>
                    <strong>{scene.title}</strong>
                    <PenLine size={16} />
                  </div>
                  {view === "Simple" ? <p>{scene.summary}</p> : null}
                  {view === "Dialogue" ? <p>{scene.dialogue}</p> : null}
                  {view === "Production" ? (
                    <>
                      <p>{scene.purpose}</p>
                      <small>{scene.location} / {scene.mood}</small>
                    </>
                  ) : null}
                  {view === "Prompt" ? <p>{scene.fullPrompt.slice(0, 240)}...</p> : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
