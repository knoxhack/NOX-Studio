import type { ReactNode } from "react";

type SectionHeadingProps = {
  title: string;
  action?: ReactNode;
  meta?: string;
};

export function SectionHeading({ title, meta, action }: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {meta ? <p>{meta}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}
