import { ArrowRight, CheckCircle2, ClipboardList, Film, Plus, Sparkles, TriangleAlert, WandSparkles } from "lucide-react";
import { quickActions } from "../data/studioData";
import { getProjectWorkflowState } from "../lib/workflowState";
import type { StudioState, ViewKey } from "../types";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { StatusPill } from "../components/StatusPill";

type CommandCenterProps = {
  state: StudioState;
  onNavigate: (view: ViewKey) => void;
  onQuickAction: (label: string) => void;
};

export function CommandCenter({ state, onNavigate, onQuickAction }: CommandCenterProps) {
  const heroProject = state.projects[0];
  const heroWorkflow = heroProject ? getProjectWorkflowState(state, heroProject.id) : undefined;

  if (!heroProject || !heroWorkflow) {
    return (
      <div className="screen-grid command-center">
        <GlassPanel className="hero-panel" variant="strong">
          <div className="hero-content empty-hero">
            <div className="hero-copy">
              <p>NOX Studio</p>
              <h2>Create a short film</h2>
              <p className="hero-description">
                Start with one idea. NOX Studio will create the project, Scene Cards, clip workflow, NOX Cut assembly, and Publish Kit.
              </p>
              <div className="hero-actions">
                <button className="primary-button" type="button" onClick={() => onNavigate("create")}>
                  <Plus size={18} />
                  Create Short Film
                </button>
              </div>
            </div>
          </div>
        </GlassPanel>

        <QuickCreatePanel onQuickAction={onQuickAction} />
      </div>
    );
  }

  const projectWorkflows = state.projects
    .map((project) => getProjectWorkflowState(state, project.id))
    .filter((workflow): workflow is NonNullable<typeof workflow> => Boolean(workflow));

  return (
    <div className="screen-grid command-center">
      <GlassPanel className="hero-panel" variant="strong">
        <div className="hero-content">
          <div className="hero-copy">
            <p>NOX Studio</p>
            <h2>{heroProject.title}</h2>
            <div className="hero-meta">
              <StatusPill label={heroProject.status} />
              <span>{heroProject.runtime}</span>
              <span>{heroProject.format}</span>
              <span>{heroProject.world}</span>
            </div>
            <p className="hero-description">{heroProject.logline || heroProject.synopsis || heroProject.idea}</p>
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate(heroWorkflow.nextView)}>
                <WandSparkles size={18} />
                {heroWorkflow.nextActionLabel}
              </button>
              <button className="ghost-button" type="button" onClick={() => onNavigate("scene")}>
                <ClipboardList size={18} />
                Open Scene Cards
              </button>
            </div>
          </div>
          <div className="workflow-summary-card" aria-label="Current film workflow state">
            <strong>{heroWorkflow.renderState.label}</strong>
            <span>{heroWorkflow.approvedClipCount}/{heroWorkflow.sceneCount} approved clips</span>
            <span>{heroWorkflow.queuedClipCount + heroWorkflow.runningClipCount} clip jobs open</span>
            <span>{heroWorkflow.finalExportAsset ? heroWorkflow.finalExportAsset.filename : "No final MP4 yet"}</span>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel className="pipeline-panel">
        <SectionHeading title="Workflow State" meta="Real project progress from Scene Cards, clips, jobs, render, and final export." />
        <div className="metric-strip workflow-metrics">
          <WorkflowMetric icon={<Film size={18} />} label="Scenes" value={String(heroWorkflow.sceneCount)} />
          <WorkflowMetric icon={<CheckCircle2 size={18} />} label="Approved Clips" value={`${heroWorkflow.approvedClipCount}/${heroWorkflow.sceneCount}`} />
          <WorkflowMetric icon={<Sparkles size={18} />} label="Open Clip Jobs" value={String(heroWorkflow.queuedClipCount + heroWorkflow.runningClipCount)} />
          <WorkflowMetric icon={<TriangleAlert size={18} />} label="Needs Review" value={String(heroWorkflow.reviewClipCount + heroWorkflow.failedClipCount)} />
        </div>
        <div className="alert-stack large">
          {(heroWorkflow.blockers.length ? heroWorkflow.blockers : ["No workflow blockers detected."]).map((blocker) => (
            <button className={heroWorkflow.blockers.length ? "alert-item alert-warning" : "alert-item alert-cyan"} key={blocker} type="button" onClick={() => onNavigate(heroWorkflow.nextView)}>
              <TriangleAlert size={16} />
              {blocker}
            </button>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel className="current-productions">
        <SectionHeading
          title="Current Productions"
          action={
            <button className="text-button" type="button" onClick={() => onNavigate("projects")}>
              View all <ArrowRight size={15} />
            </button>
          }
        />
        <div className="production-list">
          {projectWorkflows.map((workflow) => (
            <button className="production-card" key={workflow.project.id} type="button" onClick={() => onNavigate(workflow.nextView)}>
              <span className={`mini-poster poster-${workflow.project.posterTone}`} aria-hidden="true" />
              <div>
                <strong>{workflow.project.title}</strong>
                <p>{workflow.nextActionLabel}</p>
                <div className="inline-meta">
                  <StatusPill label={workflow.renderState.label} compact />
                  <span>{workflow.approvedClipCount}/{workflow.sceneCount} clips approved</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </GlassPanel>

      <QuickCreatePanel onQuickAction={onQuickAction} />
    </div>
  );
}

function QuickCreatePanel({ onQuickAction }: { onQuickAction: (label: string) => void }) {
  return (
    <GlassPanel className="quick-create-panel">
      <SectionHeading title="Quick Create" meta="Start a production unit or jump to a real workflow step." />
      <div className="quick-action-grid">
        {quickActions.map((action) => (
          <button className="quick-action" key={action} type="button" onClick={() => onQuickAction(action)}>
            {action.startsWith("New") ? <Plus size={17} /> : <Sparkles size={17} />}
            <span>{action}</span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

function WorkflowMetric({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
