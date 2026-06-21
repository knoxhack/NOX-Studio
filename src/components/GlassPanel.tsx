import type { ReactNode } from "react";

type GlassPanelProps = {
  children: ReactNode;
  className?: string;
  variant?: "default" | "strong" | "flat";
};

export function GlassPanel({ children, className = "", variant = "default" }: GlassPanelProps) {
  return <section className={`glass-panel glass-${variant} ${className}`}>{children}</section>;
}
