import { ArrowRight, Check, Film, Languages, Sparkles } from "lucide-react";
import { useState } from "react";
import { GlassPanel } from "../components/GlassPanel";
import { SectionHeading } from "../components/SectionHeading";
import { promptProviderOptions } from "../lib/noxCore";
import type { LanguageSettings } from "../types";

const projectTypes = ["Shortfilm", "Episode", "Season", "Trailer", "Music Video", "Promo Clip"];
const formats = ["TikTok / Reels / Shorts - 9:16", "YouTube Cinematic - 16:9", "Square Social - 1:1", "NOX Films App - adaptive"];
const lengths = ["30 seconds = 3 scene cards", "60 seconds = 6 scene cards", "90 seconds = 9 scene cards", "120 seconds = 12 scene cards"];
const genres = ["Sci-fi", "Cyberpunk", "Drama", "Mystery", "Urban Honduran cinema", "AI conspiracy", "Supernatural"];
const tones = ["Dark", "Emotional", "Viral", "Epic", "Street-realistic", "Suspenseful", "Melancholic"];
const targets = [...promptProviderOptions];
const languagePresets: LanguageSettings[] = [
  {
    promptLanguage: "English",
    dialogueLanguage: "Spanish",
    subtitles: "Spanish",
    voiceStyle: "Honduran / Central American",
  },
  {
    promptLanguage: "English",
    dialogueLanguage: "English",
    subtitles: "English",
    voiceStyle: "Neutral cinematic English",
  },
  {
    promptLanguage: "Spanish",
    dialogueLanguage: "Spanish",
    subtitles: "Spanish",
    voiceStyle: "Urban Honduran Spanish",
  },
];

type CreateWizardProps = {
  onCreateProject: (input: {
    title: string;
    idea: string;
    type: string;
    format: string;
    length: string;
    genre: string;
    tone: string;
    target: string;
    language: LanguageSettings;
  }) => void;
};

export function CreateWizard({ onCreateProject }: CreateWizardProps) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Neon Saints");
  const [idea, setIdea] = useState(
    "A street-level sci-fi shortfilm about a courier who discovers an AI saint hidden inside an old market speaker."
  );
  const [type, setType] = useState(projectTypes[0]);
  const [format, setFormat] = useState(formats[0]);
  const [length, setLength] = useState(lengths[1]);
  const [genre, setGenre] = useState(genres[1]);
  const [tone, setTone] = useState(tones[0]);
  const [target, setTarget] = useState<string>("Grok");
  const [language, setLanguage] = useState<LanguageSettings>(languagePresets[0]);

  const steps = [
    { label: "Project", icon: Film },
    { label: "Format", icon: Sparkles },
    { label: "Language", icon: Languages },
    { label: "AI Target", icon: Check },
  ];

  const createProject = () => {
    onCreateProject({
      title,
      idea,
      type,
      format,
      length,
      genre,
      tone,
      target,
      language,
    });
  };

  return (
    <div className="single-screen">
      <GlassPanel>
        <SectionHeading title="Create Wizard" meta="Turn one idea into a production-ready Scene Card package." />
        <div className="wizard-layout">
          <div className="wizard-steps" aria-label="Creation steps">
            {steps.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  className={step === index ? "is-active" : ""}
                  key={item.label}
                  onClick={() => setStep(index)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="wizard-main">
            {step === 0 ? (
              <div className="form-stack">
                <label>
                  <span>Project title</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label>
                  <span>Idea</span>
                  <textarea value={idea} onChange={(event) => setIdea(event.target.value)} />
                </label>
                <OptionGrid options={projectTypes} value={type} onChange={setType} />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="form-stack">
                <OptionGrid title="Output format" options={formats} value={format} onChange={setFormat} />
                <OptionGrid title="Length" options={lengths} value={length} onChange={setLength} />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="form-stack">
                <OptionGrid title="Genre" options={genres} value={genre} onChange={setGenre} />
                <OptionGrid title="Tone" options={tones} value={tone} onChange={setTone} />
                <OptionGrid
                  title="Language package"
                  options={languagePresets.map(formatLanguagePreset)}
                  value={formatLanguagePreset(language)}
                  onChange={(value) => {
                    const preset = languagePresets.find((item) => formatLanguagePreset(item) === value);
                    if (preset) setLanguage(preset);
                  }}
                />
                <div className="settings-list-grid">
                  <label>
                    <span>Prompt language</span>
                    <input
                      value={language.promptLanguage}
                      onChange={(event) => setLanguage({ ...language, promptLanguage: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Dialogue language</span>
                    <input
                      value={language.dialogueLanguage}
                      onChange={(event) => setLanguage({ ...language, dialogueLanguage: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Subtitles</span>
                    <input
                      value={language.subtitles}
                      onChange={(event) => setLanguage({ ...language, subtitles: event.target.value })}
                    />
                  </label>
                  <label className="span-2">
                    <span>Voice style</span>
                    <input
                      value={language.voiceStyle}
                      onChange={(event) => setLanguage({ ...language, voiceStyle: event.target.value })}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="form-stack">
                <OptionGrid title="AI target" options={targets} value={target} onChange={setTarget} />
                <div className="generated-summary">
                  <strong>Ready to generate</strong>
                  <p>{idea}</p>
                  <span>NOX Studio will create title options, a logline, characters, world notes, and {length.match(/\d+ scene/)?.[0] ?? "6 scene cards"}.</span>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="wizard-summary">
            <span className="summary-label">Production Package</span>
            <h3>{title}</h3>
            <p>{type} / {format}</p>
            <p>{genre} / {tone}</p>
            <p>{target}</p>
            <p>{language.dialogueLanguage} dialogue / {language.voiceStyle}</p>
            <div className="scene-rule-card">
              <strong>1 Scene Card = 1 generated 10-second video</strong>
              <span>Each card may include 1-3 internal timed beats inside one prompt.</span>
            </div>
            {step < 3 ? (
              <button className="primary-button wide-button" type="button" onClick={() => setStep((current) => current + 1)}>
                Next Step
                <ArrowRight size={18} />
              </button>
            ) : (
              <button className="primary-button wide-button" type="button" onClick={createProject}>
                Generate Production Package
                <Sparkles size={18} />
              </button>
            )}
          </aside>
        </div>
      </GlassPanel>
    </div>
  );
}

function formatLanguagePreset(language: LanguageSettings) {
  return `${language.dialogueLanguage} dialogue / ${language.subtitles} subtitles / ${language.voiceStyle}`;
}

type OptionGridProps = {
  title?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

function OptionGrid({ title, options, value, onChange }: OptionGridProps) {
  return (
    <div>
      {title ? <span className="field-title">{title}</span> : null}
      <div className="option-grid">
        {options.map((option) => (
          <button
            className={value === option ? "is-selected" : ""}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
