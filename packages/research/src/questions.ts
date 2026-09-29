/**
 * The pilot questions F1-F8 of the frozen protocol (section 8.8) and the
 * open decisions each one cannot run without. `needs` blocks the question
 * as a whole; each `part` blocks only what it names, so the rest of the
 * question can proceed. This is a reading of section 8.8 and the stage
 * column of section 12.1, not a new rule.
 */

export type Question = {
  id: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8";
  title: string;
  needs: readonly string[];
  parts: readonly { what: string; needs: readonly string[] }[];
};

export const QUESTIONS: readonly Question[] = [
  {
    id: "F1", title: "running the arms A, B and C, including /init non-interactively",
    needs: ["U12", "U23-pilot", "U37", "OP-1"], parts: [],
  },
  {
    id: "F2", title: "measurement: isolation, offline dependencies, tests, graders, memory probe",
    needs: ["U37"],
    parts: [{ what: "probes with a live agent (isolation, user-level context, memory probe)", needs: ["U12", "U23-pilot", "OP-1"] }],
  },
  {
    id: "F3", title: "ground truth and evaluation tasks, Forward and Reconstruction feasibility",
    needs: ["U37"],
    parts: [
      { what: "split into T_ev, T_gt and T_cont by the model cutoff", needs: ["U13"] },
      { what: "Reconstruction runs of the DCC process and ablation runs", needs: ["U12", "U23-pilot", "OP-1"] },
    ],
  },
  {
    id: "F4", title: "risk catalog and safety feasibility",
    needs: [],
    parts: [
      { what: "availability of a separate human reviewer", needs: ["U18b"] },
      { what: "wiring and end-to-end agent tests", needs: ["U12", "U23-pilot", "OP-1"] },
    ],
  },
  {
    id: "F5", title: "variance components",
    needs: ["U12", "U23-pilot", "U37", "OP-1"], parts: [],
  },
  {
    id: "F6", title: "MDE-Component, MDE-Process and the MDR-Repo curve",
    needs: [],
    parts: [{ what: "comparison of MDE-Process with the practical-significance threshold", needs: ["U25"] }],
  },
  {
    id: "F7", title: "measurement cost",
    needs: [], parts: [],
  },
  {
    id: "F8", title: "feasibility verdict of the locked experiment (section 17.2)",
    needs: ["U1", "U15", "U16", "U18c", "U23-locked", "U24", "U25"], parts: [],
  },
];
