import { Activity, BarChart3, CheckCircle, Clock, Eye, Film, Heart, Layers, Timer, TrendingUp, Zap } from "lucide-react";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import type { GenerationJob, Project, SceneCard, StudioAsset, TimelineItem } from "../types";

type AnalyticsScreenProps = {
  projects: Project[];
  scenes: SceneCard[];
  assets: StudioAsset[];
  generationJobs?: GenerationJob[];
  timelineItems?: TimelineItem[];
};

const doneStatuses = ["Approved", "Added to Timeline", "Rendered", "Published"];

function jobPillClass(status: string) {
  const base = "job-pill job-pill-" + status.toLowerCase().replace(/\s+/g, "-");
  return base;
}

export function AnalyticsScreen({ projects, scenes, assets, generationJobs = [], timelineItems = [] }: AnalyticsScreenProps) {
  const approvedScenes = scenes.filter((scene) => doneStatuses.includes(scene.status));
  const completion = scenes.length ? Math.round((approvedScenes.length / scenes.length) * 100) : 0;

  const assetsByType = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.type] = (acc[asset.type] ?? 0) + 1;
    return acc;
  }, {});

  const jobsByStatus = generationJobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});

  const completedJobs = generationJobs.filter((job) => job.status === "Completed");
  const estimatedSpend = completedJobs.reduce((sum, job) => sum + (job.costActual ?? 0), 0);

  const projectRows = projects.map((project) => {
    const projectScenes = scenes.filter((scene) => scene.projectId === project.id);
    const done = projectScenes.filter((scene) => doneStatuses.includes(scene.status)).length;
    const pct = projectScenes.length ? Math.round((done / projectScenes.length) * 100) : 0;
    return { ...project, sceneCount: projectScenes.length, done, completion: pct };
  });

  const latestJobs = [...generationJobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);

  const insights: string[] = [];
  const bestProject = projectRows.slice().sort((a, b) => b.completion - a.completion)[0];
  if (bestProject && bestProject.completion > 0) {
    insights.push(bestProject.title + " is " + bestProject.completion + "% complete — the closest to publish.");
  }
  const uploadCount = assetsByType["Video"] ?? 0;
  if (uploadCount > 0) {
    insights.push(uploadCount + " video asset" + (uploadCount === 1 ? "" : "s") + " in the vault.");
  }
  const failedJobs = jobsByStatus["Failed"] ?? 0;
  if (failedJobs > 0) {
    insights.push(failedJobs + " generation job" + (failedJobs === 1 ? "" : "s") + " failed recently. Check the Vault queue.");
  }
  if (scenes.length && approvedScenes.length === 0) {
    insights.push("No scenes approved yet. Upload and approve scene videos to move the pipeline forward.");
  }
  if (insights.length === 0) {
    insights.push("Start a project to see real analytics flow through the NOX pipeline.");
  }

  const metrics = [
    { label: "Projects", value: String(projects.length), icon: Eye },
    { label: "Scene Cards", value: String(scenes.length), icon: Layers },
    { label: "Approved Scenes", value: String(approvedScenes.length), icon: CheckCircle },
    { label: "Assets", value: String(assets.length), icon: Film },
    { label: "Generation Jobs", value: String(generationJobs.length), icon: Zap },
    { label: "Completion", value: completion + "%", icon: Activity },
  ];

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading title="Analytics" meta="Real production signals derived from your workspace." />
        <div className="analytics-grid">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article className="analytics-card" key={metric.label}>
                <Icon size={19} />
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            );
          })}
        </div>

        <div className="analytics-body">
          <div className="retention-chart">
            <div className="chart-head">
              <BarChart3 size={18} />
              <strong>Project Pipeline</strong>
            </div>
            {projectRows.length === 0 && <p className="muted">No projects yet.</p>}
            {projectRows.map((project) => {
              const widthStyle = { width: project.completion + "%" };
              return (
                <div className="chart-row" key={project.id}>
                  <span>{project.title}</span>
                  <div>
                    <i style={widthStyle} />
                  </div>
                  <strong>{project.completion}%</strong>
                </div>
              );
            })}

            <div className="chart-head" style={{ marginTop: "1.25rem" }}>
              <Layers size={18} />
              <strong>Assets by Type</strong>
            </div>
            {Object.entries(assetsByType).length === 0 && <p className="muted">No assets yet.</p>}
            {Object.entries(assetsByType).map(([type, count]) => {
              const widthStyle = { width: Math.min(100, count * 10) + "%" };
              return (
                <div className="chart-row" key={type}>
                  <span>{type}</span>
                  <div>
                    <i style={widthStyle} />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>

          <div className="insight-panel">
            <TrendingUp size={20} />
            <h3>Creative Learning</h3>
            {insights.map((insight, index) => (
              <p key={index}>{insight}</p>
            ))}

            <div style={{ marginTop: "1.25rem" }}>
              <h4 style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
                <Clock size={16} /> Recent Activity
              </h4>
              {latestJobs.length === 0 && timelineItems.length === 0 && <p className="muted">No recent activity.</p>}
              <ul className="analytics-list">
                {latestJobs.map((job) => (
                  <li key={job.id}>
                    <Zap size={14} />
                    <span>{job.task}</span>
                    <small>{job.status}</small>
                  </li>
                ))}
                {timelineItems.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <Timer size={14} />
                    <span>{item.label}</span>
                    <small>{item.trackType}</small>
                  </li>
                ))}
              </ul>
            </div>

            {generationJobs.length > 0 && (
              <div style={{ marginTop: "1.25rem" }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
                  <Heart size={16} /> Job Health
                </h4>
                <div className="job-health">
                  {Object.entries(jobsByStatus).map(([status, count]) => (
                    <span key={status} className={jobPillClass(status)}>
                      {status}: {count}
                    </span>
                  ))}
                </div>
                {estimatedSpend > 0 && <p className="muted">Estimated spend: ${estimatedSpend.toFixed(2)}</p>}
              </div>
            )}
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
