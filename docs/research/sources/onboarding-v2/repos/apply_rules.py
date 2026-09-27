#!/usr/bin/env python3
"""Apply rules.json to every diagnosis/*.json -> components/<repo>.json + components/summary.md"""
import json, glob, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
rules = json.load(open(os.path.join(HERE, "rules.json")))["rules"]
os.makedirs(os.path.join(HERE, "components"), exist_ok=True)

# ---- helpers used by `when` expressions ----
def gen_dirs(d):
    out = [p["dir"] for p in d["generated_code"]["paths"] if p["files"] >= 2 and not p["dir"].endswith("__tests__")]
    out += [p["dir"] for p in d["generated_code"]["header_dirs"] if p["files"] >= 2 and p["dir"] not in out]
    return out[:6]

def hot_multi_author(d):
    g = d["git"]
    if not g.get("available"): return None
    for h in g.get("hot_dirs", []):
        if h["dir"] != "." and h["authors"] >= 10 and h["changes"] >= 100:
            return h
    return None

def shapes(d):
    return [s for s in d["git"].get("repeated_change_shapes", []) if s["times"] >= 3 and len(s["files"]) >= 3]

def langs(d):
    return {l["language"] for l in d["languages"]}

DEP_FILES = re.compile(r"(go\.mod|go\.sum|package\.json|pnpm-lock|yarn\.lock|uv\.lock|Cargo\.lock|Cargo\.toml|composer\.lock|libs\.versions\.toml|Directory\.Packages\.props|pyproject\.toml|\.csproj$|build\.gradle)")
def dep_bump_shape(d):
    for p in d["git"].get("cochange_pairs", []):
        if DEP_FILES.search(p["a"]) and DEP_FILES.search(p["b"]) and p["times"] >= 8:
            return p
    return None

def fmt_ctx(d):
    g = d["git"]; hot = hot_multi_author(d); sh = shapes(d); dep = dep_bump_shape(d)
    i18n = next((h for h in g.get("hot_dirs", []) if re.search(r"(^|/)(po|locale|locales|i18n|lang|translations?)$", h["dir"])), None)
    sec_out = [f["path"] for f in d["secrets"]["files"] if not re.search(r"(?i)(test|spec|fixture|snapshot)", f["path"])]
    ai_md = [f for f in d["ai_config"]["files"] if f.endswith(("AGENTS.md", "CLAUDE.md")) and f.count("/") == 0]
    tf_pair = next((p["times"] for p in g.get("cochange_pairs", []) if "variables.tf" in (p["a"], p["b"])), 0)
    bp = next((p for p in g.get("cochange_pairs", []) if {os.path.basename(p["a"]), os.path.basename(p["b"])} <= {"pom.xml", "build.gradle", "build.gradle.kts", "Cargo.toml", "package.json"}), None)
    tfms = d["build"].get("dotnet_target_frameworks", {})
    return {
        "gen_dirs": ", ".join(gen_dirs(d)) or "-",
        "test_files": d["tests"]["test_files"], "test_frameworks": ", ".join(d["tests"]["frameworks"][:3]) or "-",
        "test_cmd": next((c for c in d["ci"]["commands"] if re.search(r"\b(test|verify|pytest|phpunit|vitest|jest)\b", c)), None) or (d["tests"]["frameworks"][0] if d["tests"]["frameworks"] else "-"),
        "ci_systems": ", ".join(d["ci"]["systems"]), "ci_n": d["ci"].get("workflow_count", len(d["ci"]["workflows"])), "ci_cmds": "; ".join(d["ci"]["commands"][:3]),
        "mono_ws": "; ".join(map(str, d["monorepo"]["workspaces"][:2])) or "workspace", "mono_n": d["monorepo"].get("package_count", "?"),
        "hot_dir": hot["dir"] if hot else "-", "hot_changes": hot["changes"] if hot else 0, "hot_authors": hot["authors"] if hot else 0,
        "shape_n": len(sh), "shape_example": (" + ".join(os.path.basename(f) for f in sh[0]["files"][:4]) + f" ({sh[0]['times']}x)") if sh else "-",
        "sec_outside": d["secrets"]["outside_tests"], "sec_total": d["secrets"]["total"], "sec_kinds": ", ".join(d["secrets"]["by_kind"].keys()), "sec_files_outside": ", ".join(sec_out[:3]),
        "sens_n": len(d["secrets"]["sensitive_files"]), "sens_sample": ", ".join(os.path.basename(f) for f in d["secrets"]["sensitive_files"][:3]),
        "sln_n": d["windows_build"]["sln"], "snk_n": d["windows_build"]["snk"], "tfm": ", ".join(list(tfms)[:2]) or "-",
        "dv_n": d["external_systems"].get("Dataverse/Dynamics 365", {}).get("count", 0),
        "db_kinds": ", ".join(k for k in ("PostgreSQL", "MySQL/MariaDB", "SQL Server") if k in d["external_systems"]),
        "compose": "compose present" if d["environment"]["docker_compose"] else "no compose - skip the MCP",
        "cloud": ", ".join(k for k in ("AWS SDK", "Azure SDK", "GCP SDK") if k in d["external_systems"]),
        "ai_kinds": ", ".join(k for k in d["ai_config"]["kinds"] if k in ("cursor", "clinerules", "copilot", "windsurf", "kiro")), "ai_n": d["ai_config"]["count"],
        "ai_files": ", ".join(ai_md) or ", ".join(d["ai_config"]["files"][:2]),
        "ai_missing": "build/test commands, generated paths, external systems - whichever the file lacks",
        "build_cmd": "; ".join(d["build"]["commands"][:2]) or "(none inferable)", "lint": ", ".join(d["lint_format"][:4]) or "-",
        "formatter": next((l for l in d["lint_format"] if l in ("@biomejs/biome", "biome", "prettier", "ruff", "black", "spotless", "ktlint", "golangci-lint", "rustfmt/clippy (toolchain pinned)", "php-cs-fixer", "spring-javaformat", "terraform_fmt", "eslint")), d["lint_format"][0] if d["lint_format"] else "-"),
        "nb_n": sum(l["files"] for l in d["languages"] if l["language"] == "Jupyter"),
        "tf_n": sum(l["files"] for l in d["languages"] if l["language"] == "HCL/Terraform"), "tf_lint": ", ".join(l for l in d["lint_format"] if l.startswith(("terraform", "tflint"))), "tf_pair": tf_pair,
        "doc_pointer": (d["docs"]["architecture_docs"][0] if d["docs"]["architecture_docs"] else "docs/" if d["docs"]["docs_files"] else d["docs"]["readme"] or "README"),
        "readme_kb": round(d["docs"]["readme_bytes"] / 1024, 1), "docs_files": d["docs"]["docs_files"], "arch": ", ".join(d["docs"]["architecture_docs"][:2]) or "none",
        "env_kind": ", ".join(k for k, v in (("devcontainer", d["environment"]["devcontainer"]), ("Dockerfile", d["environment"]["dockerfile"]), ("compose", d["environment"]["docker_compose"])) if v),
        "php_files": sum(l["files"] for l in d["languages"] if l["language"] == "PHP"),
        "i18n_dir": i18n["dir"] if i18n else "-", "i18n_changes": i18n["changes"] if i18n else 0,
        "bin_n": g.get("tracked_binaries_dll_exe_pdb", 0), "pkg_n": g.get("tracked_package_dirs", 0), "ide_n": g.get("tracked_ide_junk", 0),
        "screenshot": ", ".join(t for t in d["tests"]["frameworks"] if "screenshot" in t) or "none found",
        "mobile": ", ".join(f for f in d["frameworks"] if f in ("android", "flutter/dart", "jetpack-compose", "react-native (sub-package)")),
        "build_systems": " + ".join(s for s in d["build"]["system"] if s in ("maven", "gradle", "cargo", "dotnet", "msbuild", "go", "composer", "turborepo")),
        "build_pair_times": bp["times"] if bp else 0,
        "authors": g.get("authors_in_clone", 0), "contrib": ", ".join(d["docs"]["contributing"]) or "no CONTRIBUTING",
        "llm": ", ".join(k for k in ("OpenAI API", "Anthropic API") if k in d["external_systems"]),
        "dep_files": (os.path.basename(dep["a"]) + " + " + os.path.basename(dep["b"])) if dep else "-", "dep_times": dep["times"] if dep else 0,
        "containers": ", ".join(k for k in ("PostgreSQL", "Redis", "RabbitMQ/AMQP") if k in d["external_systems"]),
    }

class SafeDict(dict):
    def __missing__(self, k): return "{" + k + "}"

results = {}
for path in sorted(glob.glob(os.path.join(HERE, "diagnosis", "*.json"))):
    d = json.load(open(path))
    ctx = SafeDict(fmt_ctx(d))
    fired = []
    for r in rules:
        try:
            ok = eval(r["when"], {"gen_dirs": gen_dirs, "hot_multi_author": hot_multi_author, "shapes": shapes, "langs": langs, "dep_bump_shape": dep_bump_shape, "any": any, "len": len, "sum": sum, "d": d})
        except Exception as e:
            ok = False; print("rule error", r["id"], d["name"], e)
        if ok:
            fired.append({"rule": r["id"], "signal": r["signal"],
                          "components": [{"kind": c["kind"], "name": c["name"].format_map(ctx)} for c in r["components"]],
                          "reason": r["reason"].format_map(ctx)})
    kinds = collections.Counter(c["kind"] for f in fired for c in f["components"])
    results[d["name"]] = {"name": d["name"], "rules_fired": [f["rule"] for f in fired], "component_count": sum(kinds.values()), "by_kind": dict(kinds), "components": fired}
    json.dump(results[d["name"]], open(os.path.join(HERE, "components", d["name"] + ".json"), "w"), indent=1)

# ---- side-by-side summary ----
names = list(results)
all_rules = [r["id"] for r in rules]
lines = ["# Component sets per repository (rules applied to the deterministic diagnosis)", "",
         "## Rule-firing matrix", "", "| rule | signal | " + " | ".join(names) + " |", "|---|---|" + "---|" * len(names)]
for r in rules:
    lines.append(f"| {r['id']} | {r['signal']} | " + " | ".join("x" if r["id"] in results[n]["rules_fired"] else "" for n in names) + " |")
lines += ["", "## Set fingerprints", "", "| repo | rules fired | components | by kind |", "|---|---|---|---|"]
for n in names:
    v = results[n]
    lines.append(f"| {n} | {', '.join(v['rules_fired'])} | {v['component_count']} | " + ", ".join(f"{k} {c}" for k, c in sorted(v["by_kind"].items())) + " |")
sets = {n: frozenset(results[n]["rules_fired"]) for n in names}
lines += ["", f"Distinct rule sets: {len(set(sets.values()))} of {len(names)} repositories.", ""]
pairs = []
for i, a in enumerate(names):
    for b in names[i + 1:]:
        j = len(sets[a] & sets[b]) / max(1, len(sets[a] | sets[b]))
        pairs.append((j, a, b))
pairs.sort(reverse=True)
lines += ["Most similar pairs (Jaccard on rules fired): " + "; ".join(f"{a}~{b} {j:.2f}" for j, a, b in pairs[:4]), ""]
for n in names:
    lines += [f"## {n}", ""]
    for f in results[n]["components"]:
        lines.append(f"- **{f['rule']}** {f['signal']} - _{f['reason']}_")
        for c in f["components"]:
            lines.append(f"  - `{c['kind']}` {c['name']}")
    lines.append("")
open(os.path.join(HERE, "components", "summary.md"), "w").write("\n".join(lines))
print("\n".join(lines[:len(all_rules) + 12]))
print("\nDistinct rule sets:", len(set(sets.values())), "of", len(names))
