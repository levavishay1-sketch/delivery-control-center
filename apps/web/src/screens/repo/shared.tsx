import type { MutableRefObject, ReactNode } from "react";
import type { AutomationLevel, OnboardingRunView, OnboardingStep, OnboardingStepDefinition } from "../../api.ts";
import { Info } from "../../claude/Info.tsx";
import { LEVEL_HE } from "./labels.ts";

/**
 * What every step card of the dossier receives, and the small pieces they
 * share. Kept apart from `steps.tsx` so the plan and the build files can use
 * them without importing each other in a circle.
 */

/** Runs one action against the API, refreshes the view, and shows the error on the screen; `busy` carries `name` meanwhile. */
export type Act = <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;

export type StepProps = {
  def: OnboardingStepDefinition;
  step: OnboardingStep;
  view: OnboardingRunView;
  /** Display names by user id — who corrected, decided, delivered. */
  users: Record<string, string>;
  runnable: boolean;
  busy: string | null;
  act: Act;
  onRun: () => void;
  /** The terminal hands the chat a way to read its screen while it is shown. */
  screenRef: MutableRefObject<(() => string) | null>;
  nav: (h: string) => void;
};

export const isOver = (v: OnboardingRunView) => v.run.status === "Completed" || v.run.status === "Cancelled";

export function Working({ text }: { text: string }) {
  return <div className="rd-working"><span className="spinner" /><span>{text}</span></div>;
}

/** A step that has not run: why, in one line. */
export function NotYet({ runnable, text }: { runnable: boolean; text?: string }) {
  return <p className="ob-sub">{runnable ? (text ?? "עוד לא רץ. לחצו על \"הרץ\" כדי להתחיל.") : "הצעד הזה יהיה זמין אחרי שהצעדים שלפניו יסתיימו."}</p>;
}

/** One key/value tile of the `.ob-kv` grid — the "i" sits on the label. */
export function Kv({ label, info, code, children }: { label: string; info?: string; code?: boolean; children: ReactNode }) {
  return (
    <div>
      <div className="l">{label}{info && <Info k={info} />}</div>
      <div className={`v${code ? " ob-code" : ""}`}>{children}</div>
    </div>
  );
}

/** One figure tile of the `.rd-tiles` grid. */
export function Tile({ n, label, info, tone }: { n: ReactNode; label: string; info?: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="rd-tile">
      <div className={`n${tone ? ` ${tone}` : ""}`}>{n}</div>
      <div className="l">{label}{info && <Info k={info} />}</div>
    </div>
  );
}

/** The three automation levels as one choice — on the pre-start page and in the rail. */
export function LevelChooser({ value, levels, disabled, onChange }: { value: AutomationLevel; levels: readonly AutomationLevel[]; disabled?: boolean; onChange: (l: AutomationLevel) => void }) {
  return (
    <div className="rd-levels">
      {levels.map((l) => (
        <button key={l} type="button" aria-pressed={value === l} disabled={disabled} onClick={() => onChange(l)}>
          <div className="t">{LEVEL_HE[l].title}{l === "reversible_auto" && <span className="rd-chip ok">מומלץ</span>}</div>
          <div className="d">{LEVEL_HE[l].desc}</div>
        </button>
      ))}
    </div>
  );
}

/** A file name short enough for a table cell: the last two parts of the path. */
export const shortPath = (p: string) => { const parts = p.split("/"); return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p; };
