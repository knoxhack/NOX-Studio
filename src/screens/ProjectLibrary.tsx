import { Eye, Filter, Grid2X2, List, PencilLine, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Project, ProjectStatus, ViewKey } from "../types";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { StatusPill } from "../components/StatusPill";

type ProjectLibraryProps = {
  projects: Project[];
  onNavigate: (view: ViewKey) => void;
  onSelectProject: (projectId: string) => void;
  onUpdateProject: (project: Project) => void;
  onUpdateProjectStatus: (projectId: string, status: Project["status"]) => void;
  onDeleteProject: (projectId: string) => void;
};

export function ProjectLibrary({
  projects,
  onNavigate,
  onSelectProject,
  onUpdateProject,
  onUpdateProjectStatus,
  onDeleteProject,
}: ProjectLibraryProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [sortBy, setSortBy] = useState("Recently updated");
  const [mode, setMode] = useState<"grid" | "list">("grid");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [detailProjectId, setDetailProjectId] = useState(projects[0]?.id ?? "");

  const statuses = ["All", ...Array.from(new Set(projects.map((project) => project.status)))];
  const sortOptions = ["Recently updated", "Title A-Z", "Status", "Runtime", "Scene count", "Progress"];
  const filteredProjects = useMemo(() => {
    return [...projects]
      .filter((project) => {
        const matchesStatus = status === "All" || project.status === status;
        const searchable = [
          project.title,
          project.type,
          project.genre,
          project.tone,
          project.world,
          project.idea,
          project.synopsis,
          project.format,
          project.runtime,
          project.aiTarget,
          project.language.promptLanguage,
          project.language.dialogueLanguage,
          project.language.subtitles,
          project.language.voiceStyle,
        ]
          .join(" ")
          .toLowerCase();
        const matchesQuery = searchable.includes(query.toLowerCase());
        return matchesStatus && matchesQuery;
      })
      .sort((a, b) => sortProjects(a, b, sortBy));
  }, [projects, query, sortBy, status]);

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading
          title="Project Library"
          meta="Search, filter, and open productions."
          action={
            <button className="primary-button small-button" type="button" onClick={() => onNavigate("create")}>
              New Film
            </button>
          }
        />
        <div className="toolbar-row">
          <label className="search-box">
            <Search size={17} />
            <input
              placeholder="Search projects, worlds, genres"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="select-box">
            <Filter size={17} />
            <select aria-label="Filter project status" value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="select-box">
            <SlidersHorizontal size={17} />
            <select aria-label="Sort projects" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              {sortOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <div className="segmented-control">
            <button className={mode === "grid" ? "is-active" : ""} onClick={() => setMode("grid")} type="button" title="Grid">
              <Grid2X2 size={16} />
            </button>
            <button className={mode === "list" ? "is-active" : ""} onClick={() => setMode("list")} type="button" title="List">
              <List size={16} />
            </button>
          </div>
        </div>

        <div className={`project-library project-${mode}`}>
          {filteredProjects.map((project) => (
            <article className="library-project" key={project.id}>
              <span className={`poster-frame compact poster-${project.posterTone}`}>
                <strong>{project.title.split(" - ")[0]}</strong>
                <small>{project.type}</small>
              </span>
              <div className="library-project-body">
                <strong>{project.title}</strong>
                <span>{project.genre} / {project.tone}</span>
                <span>{project.format} / {project.runtime}</span>
                <span className="project-progress-line">
                  <span style={{ width: `${(project.generatedScenes / project.sceneCount) * 100}%` }} />
                </span>
                <span className="inline-meta">
                  <StatusPill label={project.status} compact />
                  <span>{project.updatedAt}</span>
                </span>
                <span className="project-card-actions">
                  <button className="primary-button small-button" type="button" onClick={() => onSelectProject(project.id)}>
                    Open
                  </button>
                  <button
                    className="ghost-button small-button"
                    type="button"
                    onClick={() => setDetailProjectId((current) => (current === project.id ? "" : project.id))}
                  >
                    <Eye size={15} />
                    Details
                  </button>
                  <button className="ghost-button small-button" type="button" onClick={() => setEditingProject(project)}>
                    Edit
                  </button>
                  <button
                    className="ghost-button small-button"
                    type="button"
                    onClick={() => onUpdateProjectStatus(project.id, nextProjectStatus(project.status))}
                  >
                    <PencilLine size={15} />
                    Advance
                  </button>
                  <button className="danger-button small-button" type="button" onClick={() => onDeleteProject(project.id)}>
                    <Trash2 size={15} />
                    Delete
                  </button>
                </span>
                {editingProject?.id === project.id ? (
                  <ProjectEditForm
                    project={editingProject}
                    onChange={setEditingProject}
                    onCancel={() => setEditingProject(null)}
                    onSave={() => {
                      onUpdateProject(editingProject);
                      setEditingProject(null);
                    }}
                  />
                ) : null}
                {detailProjectId === project.id ? <ProjectDetailPanel project={project} /> : null}
              </div>
            </article>
          ))}
          {filteredProjects.length === 0 ? (
            <div className="empty-state project-empty-state">
              <h3>No projects match this view</h3>
              <p>Adjust search, status, or sorting to find another saved production.</p>
            </div>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function ProjectEditForm({
  project,
  onChange,
  onCancel,
  onSave,
}: {
  project: Project;
  onChange: (project: Project) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="inline-edit-panel">
      <label>
        <span>Title</span>
        <input value={project.title} onChange={(event) => onChange({ ...project, title: event.target.value })} />
      </label>
      <label>
        <span>Type</span>
        <input value={project.type} onChange={(event) => onChange({ ...project, type: event.target.value })} />
      </label>
      <label>
        <span>Genre</span>
        <input value={project.genre} onChange={(event) => onChange({ ...project, genre: event.target.value })} />
      </label>
      <label>
        <span>Tone</span>
        <input value={project.tone} onChange={(event) => onChange({ ...project, tone: event.target.value })} />
      </label>
      <label>
        <span>Format</span>
        <input value={project.format} onChange={(event) => onChange({ ...project, format: event.target.value })} />
      </label>
      <label>
        <span>Runtime</span>
        <input value={project.runtime} onChange={(event) => onChange({ ...project, runtime: event.target.value })} />
      </label>
      <label>
        <span>AI Target</span>
        <input value={project.aiTarget} onChange={(event) => onChange({ ...project, aiTarget: event.target.value })} />
      </label>
      <label>
        <span>Prompt Language</span>
        <input
          value={project.language.promptLanguage}
          onChange={(event) => onChange({ ...project, language: { ...project.language, promptLanguage: event.target.value } })}
        />
      </label>
      <label>
        <span>Dialogue Language</span>
        <input
          value={project.language.dialogueLanguage}
          onChange={(event) => onChange({ ...project, language: { ...project.language, dialogueLanguage: event.target.value } })}
        />
      </label>
      <label>
        <span>Subtitles</span>
        <input
          value={project.language.subtitles}
          onChange={(event) => onChange({ ...project, language: { ...project.language, subtitles: event.target.value } })}
        />
      </label>
      <label>
        <span>Voice Style</span>
        <input
          value={project.language.voiceStyle}
          onChange={(event) => onChange({ ...project, language: { ...project.language, voiceStyle: event.target.value } })}
        />
      </label>
      <div className="inline-edit-actions">
        <button className="primary-button small-button" type="button" onClick={onSave}>
          Save
        </button>
        <button className="ghost-button small-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProjectDetailPanel({ project }: { project: Project }) {
  return (
    <div className="project-detail-panel">
      <div className="project-detail-head">
        <strong>Project Detail</strong>
        <StatusPill label={project.releaseStatus} compact />
      </div>
      <p>{project.logline}</p>
      <div className="project-detail-grid">
        <DetailField label="World" value={project.world} />
        <DetailField label="AI target" value={project.aiTarget} />
        <DetailField label="Next step" value={project.nextStep} />
        <DetailField label="Scenes" value={`${project.generatedScenes}/${project.sceneCount} generated`} />
        <DetailField label="Prompt language" value={project.language.promptLanguage} />
        <DetailField label="Dialogue" value={project.language.dialogueLanguage} />
        <DetailField label="Subtitles" value={project.language.subtitles} />
        <DetailField label="Voice style" value={project.language.voiceStyle} />
      </div>
      <div className="project-detail-copy">
        <span>Idea</span>
        <p>{project.idea}</p>
      </div>
      <div className="project-detail-copy">
        <span>Synopsis</span>
        <p>{project.synopsis}</p>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function nextProjectStatus(status: Project["status"]): Project["status"] {
  const order: Array<ProjectStatus | "Scene Videos Needed" | "Publish Kit Ready"> = [
    "Idea",
    "Script Ready",
    "Scene Prompts Ready",
    "Generating Videos",
    "Scene Videos Needed",
    "Editing",
    "Ready to Publish",
    "Publish Kit Ready",
    "Published",
  ];
  const index = order.indexOf(status);
  return order[Math.min(index + 1, order.length - 1)] ?? "Idea";
}

function sortProjects(a: Project, b: Project, sortBy: string) {
  if (sortBy === "Recently updated") return parseUpdatedAtRank(b.updatedAt) - parseUpdatedAtRank(a.updatedAt) || a.title.localeCompare(b.title);
  if (sortBy === "Title A-Z") return a.title.localeCompare(b.title);
  if (sortBy === "Status") return a.status.localeCompare(b.status) || a.title.localeCompare(b.title);
  if (sortBy === "Runtime") return parseRuntimeSeconds(a.runtime) - parseRuntimeSeconds(b.runtime);
  if (sortBy === "Scene count") return b.sceneCount - a.sceneCount;
  if (sortBy === "Progress") {
    const aProgress = a.sceneCount ? a.generatedScenes / a.sceneCount : 0;
    const bProgress = b.sceneCount ? b.generatedScenes / b.sceneCount : 0;
    return bProgress - aProgress;
  }
  return 0;
}

function parseRuntimeSeconds(runtime: string) {
  const minutes = runtime.match(/(\d+(?:\.\d+)?)\s*min/i)?.[1];
  if (minutes) return Number(minutes) * 60;
  return Number(runtime.match(/\d+/)?.[0] ?? 0);
}

function parseUpdatedAtRank(value: string) {
  const normalized = value.trim();
  const now = new Date();
  if (!normalized || normalized.toLowerCase() === "just now") return now.getTime();

  const today = normalized.match(/^today(?:,\s*(.+))?$/i);
  if (today) return withCurrentDateTime(now, today[1]).getTime();

  if (/^yesterday$/i.test(normalized)) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return startOfDay(yesterday).getTime();
  }

  const monthDay = normalized.match(/^[A-Za-z]{3,9}\s+\d{1,2}$/);
  if (monthDay) {
    const parsed = Date.parse(`${normalized}, ${now.getFullYear()}`);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withCurrentDateTime(base: Date, time?: string) {
  const date = startOfDay(base);
  if (!time) return date;
  const parsed = Date.parse(`${base.toDateString()} ${time}`);
  return Number.isFinite(parsed) ? new Date(parsed) : date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
