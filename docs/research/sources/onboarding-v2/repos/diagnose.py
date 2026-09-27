#!/usr/bin/env python3
"""Deterministic repository diagnosis. No LLM. Emits one JSON per repo.

usage: diagnose.py <repo-path> <name> [--no-git]
"""
import json, os, re, subprocess, sys, collections, hashlib

ROOT = os.path.abspath(sys.argv[1])
NAME = sys.argv[2]
NO_GIT = "--no-git" in sys.argv

SKIP_DIRS = {".git", "node_modules", "dist", "build", "target", "bin", "obj", ".pgdata",
             "vendor", ".venv", "venv", "__pycache__", ".next", ".turbo", "out", ".gradle",
             "packages" if NAME == "altshuler_trade" else "__never__",  # NuGet package cache in the client clone
             ".idea", ".vs", "coverage", "site-packages"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".jar", ".dll", ".exe",
              ".so", ".dylib", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".webp", ".svg",
              ".nupkg", ".pdb", ".bin", ".class", ".pyc", ".wasm", ".lock", ".sum", ".snk", ".pfx",
              ".gz", ".tar", ".7z", ".rar", ".bmp", ".psd", ".xlsx", ".docx", ".pptx", ".msi", ".cab"}

LANG_EXT = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".cjs": "JavaScript", ".py": "Python", ".go": "Go", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
    ".cs": "C#", ".vb": "VB.NET", ".php": "PHP", ".rb": "Ruby", ".rs": "Rust", ".tf": "HCL/Terraform",
    ".hcl": "HCL/Terraform", ".ipynb": "Jupyter", ".dart": "Dart", ".swift": "Swift", ".m": "Objective-C",
    ".sql": "SQL", ".sh": "Shell", ".ps1": "PowerShell", ".yaml": "YAML", ".yml": "YAML", ".json": "JSON",
    ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".xml": "XML", ".md": "Markdown", ".twig": "Twig",
    ".c": "C", ".cpp": "C++", ".h": "C/C++ header", ".proto": "Protobuf", ".tpl": "Helm template",
}
CODE_LANGS = {"TypeScript", "JavaScript", "Python", "Go", "Java", "Kotlin", "C#", "VB.NET", "PHP", "Ruby",
              "Rust", "HCL/Terraform", "Jupyter", "Dart", "Swift", "Objective-C", "C", "C++", "SQL", "Twig"}

def run(cmd, cwd=ROOT):
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ""

# ---------- walk ----------
files = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in SKIP_DIRS]
    for f in fn:
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, ROOT)
        files.append(rel)
files.sort()
relset = set(files)

def exists(*names):
    return [n for n in names if n in relset]

def any_glob(pattern):
    rx = re.compile(pattern)
    return [f for f in files if rx.search(f)]

def read(rel, limit=200_000):
    try:
        with open(os.path.join(ROOT, rel), "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read(limit)
    except Exception:
        return ""

# ---------- languages / lines ----------
lang_files = collections.Counter()
lang_lines = collections.Counter()
total_lines = 0
for f in files:
    ext = os.path.splitext(f)[1].lower()
    lang = LANG_EXT.get(ext)
    if ext in BINARY_EXT:
        continue
    if lang:
        lang_files[lang] += 1
    if lang in CODE_LANGS:
        try:
            with open(os.path.join(ROOT, f), "rb") as fh:
                n = sum(1 for _ in fh)
        except Exception:
            n = 0
        lang_lines[lang] += n
        total_lines += n
top_langs = [{"language": l, "files": c, "lines": lang_lines.get(l, 0)} for l, c in lang_files.most_common(8)]

# ---------- manifests / frameworks / build ----------
frameworks = set()
package_managers = set()
build = {"system": [], "commands": []}
tests = {"frameworks": [], "test_files": 0, "test_dirs": []}
lint = []

def add_build(sysname, cmd=None):
    if sysname not in build["system"]:
        build["system"].append(sysname)
    if cmd and cmd not in build["commands"]:
        build["commands"].append(cmd)

pkg_jsons = [f for f in files if f.endswith("package.json") and f.count("/") <= 2]
root_pkg = None
if "package.json" in relset:
    try:
        root_pkg = json.loads(read("package.json"))
    except Exception:
        root_pkg = {}
if root_pkg is not None:
    deps = {**root_pkg.get("dependencies", {}), **root_pkg.get("devDependencies", {})}
    scripts = root_pkg.get("scripts", {})
    for k in ("react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "esbuild", "webpack", "turbo", "nx", "vitest", "jest", "mocha", "playwright", "@playwright/test", "cypress", "eslint", "prettier", "biome", "@biomejs/biome", "typescript", "react-native", "expo", "tailwindcss", "storybook"):
        if k in deps:
            frameworks.add(k)
    if "pnpm-lock.yaml" in relset: package_managers.add("pnpm")
    if "yarn.lock" in relset: package_managers.add("yarn")
    if "package-lock.json" in relset: package_managers.add("npm")
    if "bun.lockb" in relset or "bun.lock" in relset: package_managers.add("bun")
    pm = "pnpm" if "pnpm" in package_managers else "yarn" if "yarn" in package_managers else "bun" if "bun" in package_managers else "npm"
    add_build("package.json scripts")
    for s in ("build", "compile", "package"):
        if s in scripts:
            add_build("package.json scripts", f"{pm} run {s}   # -> {scripts[s][:80]}")
            break
    for s in ("test", "test:unit", "test:ci"):
        if s in scripts:
            tests["frameworks"].append(f"package.json:{s} -> {scripts[s][:80]}")
            break
    for k in ("vitest", "jest", "mocha", "@playwright/test", "playwright", "cypress"):
        if k in deps and k not in tests["frameworks"]:
            tests["frameworks"].append(k)
    for k in ("eslint", "prettier", "biome", "@biomejs/biome"):
        if k in deps: lint.append(k)
sub_pkg_deps = {}
for pj in [f for f in files if f.endswith("package.json") and 1 <= f.count("/") <= 3]:
    try:
        d = json.loads(read(pj)); sub_pkg_deps.update({**d.get("dependencies", {}), **d.get("devDependencies", {})})
    except Exception: pass
for k in ("react", "next", "vue", "@angular/core", "svelte", "express", "fastify", "electron", "vite", "vitest", "jest", "mocha", "@playwright/test", "cypress", "react-native", "expo", "tailwindcss", "@tauri-apps/api", "ink"):
    if k in sub_pkg_deps: frameworks.add(k + " (sub-package)")
if exists("turbo.json"): frameworks.add("turborepo"); add_build("turborepo")
if exists("nx.json"): frameworks.add("nx")
if exists("lerna.json"): frameworks.add("lerna")

# Python
py_manifests = exists("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "environment.yml")
sub_py = [f for f in files if f.endswith("pyproject.toml") and f.count("/") == 1]
for m in py_manifests + sub_py:
    txt = read(m).lower()
    for k in ("fastapi", "django", "flask", "sqlmodel", "sqlalchemy", "pydantic", "celery", "starlette", "torch", "tensorflow", "scikit-learn", "sklearn", "pandas", "numpy", "jupyter", "notebook", "streamlit"):
        if k in txt: frameworks.add(k)
    if "pytest" in txt and "pytest" not in tests["frameworks"]: tests["frameworks"].append("pytest")
    if "unittest" in txt and "unittest" not in tests["frameworks"]: tests["frameworks"].append("unittest")
    for k in ("ruff", "black", "flake8", "mypy", "isort", "pylint"):
        if k in txt and k not in lint: lint.append(k)
    if "[tool.uv]" in txt or "uv.lock" in relset: package_managers.add("uv")
    if "[tool.poetry]" in txt or "poetry.lock" in relset: package_managers.add("poetry")
    if m.endswith("requirements.txt") or m.endswith("setup.py"): package_managers.add("pip")
    if m.endswith("environment.yml"): package_managers.add("conda")
    if "hatchling" in txt: add_build("hatch")
    if "setuptools" in txt: add_build("setuptools")
if py_manifests or sub_py:
    add_build("python packaging")
if "uv.lock" in relset: package_managers.add("uv")

# Go
if exists("go.mod"):
    package_managers.add("go modules"); add_build("go", "go build ./...")
    tests["frameworks"].append("go test")
    gm = read("go.mod")
    for k in ("github.com/spf13/cobra", "github.com/gin-gonic/gin", "net/http", "github.com/labstack/echo", "google.golang.org/grpc"):
        if k in gm: frameworks.add(k.split("/")[-1])
    if exists("Makefile"): add_build("make")
    if exists(".golangci.yml", ".golangci.yaml", ".golangci.toml"): lint.append("golangci-lint")

# Java / Kotlin
if exists("pom.xml"):
    package_managers.add("maven"); add_build("maven", "./mvnw package" if exists("mvnw") else "mvn package")
    pom = read("pom.xml")
    if "spring-boot" in pom: frameworks.add("spring-boot")
    if "junit" in pom: tests["frameworks"].append("junit")
    for k in ("checkstyle", "spotless", "spring-javaformat"):
        if k in pom: lint.append(k)
if exists("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"):
    package_managers.add("gradle"); add_build("gradle", "./gradlew build" if exists("gradlew") else "gradle build")
    g = " ".join(read(x) for x in exists("build.gradle", "build.gradle.kts", "settings.gradle.kts", "gradle/libs.versions.toml"))
    if "com.android" in g or "android" in g.lower(): frameworks.add("android")
    if "androidx.compose" in g.lower(): frameworks.add("jetpack-compose")
    if "hilt" in g.lower(): frameworks.add("hilt")
    if "junit" in g.lower(): tests["frameworks"].append("junit")
    if "spotless" in g.lower(): lint.append("spotless")
    if "detekt" in g.lower(): lint.append("detekt")
    if "ktlint" in g.lower(): lint.append("ktlint")
    if "roborazzi" in g.lower(): tests["frameworks"].append("roborazzi-screenshot")

# .NET
slns = any_glob(r"\.(sln|slnx|slnf)$")
csprojs = any_glob(r"\.(csproj|vbproj|fsproj)$")
if slns or csprojs:
    package_managers.add("nuget")
    frameworks.add(".NET")
    tfms = collections.Counter()
    pkgs = set()
    for c in csprojs[:400] + any_glob(r"packages\.config$")[:400]:
        t = read(c)
        for m in re.findall(r'<package id="([^"]+)"', t): pkgs.add(m)
        for m in re.findall(r"<TargetFrameworks?>([^<]+)<", t): tfms[m.strip()] += 1
        for m in re.findall(r'PackageReference Include="([^"]+)"', t): pkgs.add(m)
        if "ToolsVersion" in t and "<TargetFrameworkVersion>" in t:
            for m in re.findall(r"<TargetFrameworkVersion>([^<]+)<", t): tfms["netframework " + m] += 1
    build["dotnet_target_frameworks"] = dict(tfms.most_common(10))
    legacy = any(k.startswith("netframework") or k.startswith("v4") for k in tfms)
    if legacy:
        frameworks.add(".NET Framework (legacy, msbuild)")
        add_build("msbuild", f"msbuild {slns[0]} /t:Build   # requires Windows / Visual Studio build tools")
    else:
        add_build("dotnet", f"dotnet build {slns[0] if slns else ''}".strip())
    for k in ("Microsoft.AspNetCore", "Aspire", "xunit", "NUnit", "MSTest", "Microsoft.PowerPlatform.Dataverse.Client", "Microsoft.CrmSdk", "Microsoft.Xrm", "EntityFramework", "Microsoft.EntityFrameworkCore", "Dapper", "Moq", "FakeXrmEasy"):
        hits = [p for p in pkgs if k.lower() in p.lower()]
        if hits: frameworks.add(k)
    for k in ("xunit", "NUnit", "MSTest"):
        if k in frameworks: tests["frameworks"].append(k)
    if exists(".editorconfig"): lint.append("editorconfig")
    if exists("Directory.Build.props"): add_build("Directory.Build.props")

# PHP
if exists("composer.json"):
    package_managers.add("composer"); add_build("composer", "composer install")
    cj = read("composer.json")
    for k in ("laravel", "symfony", "twig", "phpunit", "phpstan", "psalm", "phpcs", "php-cs-fixer", "slim"):
        if k in cj.lower(): (tests if k == "phpunit" else lint if k in ("phpstan", "psalm", "phpcs", "php-cs-fixer") else frameworks).__class__  # noqa
    if "phpunit" in cj: tests["frameworks"].append("phpunit")
    for k in ("phpstan", "psalm", "squizlabs/php_codesniffer", "php-cs-fixer"):
        if k in cj: lint.append(k)
    for k in ("twig/twig", "symfony", "laravel", "slim"):
        if k in cj: frameworks.add(k)
jq = any_glob(r"jquery[^/]*\.js$")
if jq: frameworks.add("jQuery (vendored)")
if root_pkg and "jquery" in {**root_pkg.get("dependencies", {}), **root_pkg.get("devDependencies", {})}: frameworks.add("jquery")

# Rust
if exists("Cargo.toml"):
    package_managers.add("cargo"); add_build("cargo", "cargo build")
    tests["frameworks"].append("cargo test")
    if exists("codex-rs/Cargo.toml"): add_build("cargo", "cargo build (in codex-rs/)")
sub_cargo = [f for f in files if f.endswith("Cargo.toml") and f.count("/") == 1]
if sub_cargo and "cargo" not in package_managers:
    package_managers.add("cargo"); add_build("cargo", f"cargo build   # in {os.path.dirname(sub_cargo[0])}/")
    tests["frameworks"].append("cargo test")
    if exists("rust-toolchain.toml") or any_glob(r"rust-toolchain"): lint.append("rustfmt/clippy (toolchain pinned)")

# Terraform / Helm
tfs = any_glob(r"\.tf$")
if tfs:
    frameworks.add("terraform")
    add_build("terraform", "terraform init && terraform validate   # no compile; plan needs cloud creds")
    if exists(".pre-commit-config.yaml"): lint.append("pre-commit")
    pc = read(".pre-commit-config.yaml")
    for k in ("terraform_fmt", "terraform_validate", "terraform_docs", "tflint", "terraform_tfsec", "trivy", "checkov"):
        if k in pc: lint.append(k)
    if any_glob(r"\.tftest\.hcl$"): tests["frameworks"].append("terraform test")
    ex = any_glob(r"^examples/[^/]+/main\.tf$")
    if ex: tests["frameworks"].append(f"examples/ as integration checks ({len(ex)})")
if any_glob(r"(^|/)Chart\.yaml$"): frameworks.add("helm")

# Flutter / RN / mobile
if exists("pubspec.yaml"): frameworks.add("flutter/dart"); package_managers.add("pub")
if any_glob(r"^(android|ios)/") and root_pkg is not None: frameworks.add("react-native-shell")
if any_glob(r"AndroidManifest\.xml$"): frameworks.add("android-manifest")
if any_glob(r"\.xcodeproj/"): frameworks.add("xcode")

# Dynamics / PCF / CRM
if any_glob(r"ControlManifest\.Input\.xml$"): frameworks.add("PowerApps PCF control")
if any_glob(r"(?i)(^|/)(Plugins?|CrmEntryPoints|Workflows?)/"): pass

# Jupyter
nbs = any_glob(r"\.ipynb$")
if nbs: frameworks.add(f"jupyter notebooks ({len(nbs)})")

# ---------- tests count ----------
test_rx = re.compile(r"(^|/)(tests?|__tests__|spec|specs|e2e|src/test|Test|Tests)(/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.go$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$")
test_files = [f for f in files if test_rx.search(f) and os.path.splitext(f)[1].lower() in LANG_EXT and LANG_EXT[os.path.splitext(f)[1].lower()] in CODE_LANGS]
tests["test_files"] = len(test_files)
tests["test_dirs"] = sorted(collections.Counter(f.split("/")[0] if "/" in f else "." for f in test_files).most_common(6))
tests["frameworks"] = list(dict.fromkeys(tests["frameworks"]))

# ---------- lint / format config files ----------
for c in (".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts", ".prettierrc", ".prettierrc.json", "prettier.config.js", "biome.json", "biome.jsonc", ".editorconfig", "ruff.toml", ".flake8", "mypy.ini", ".pre-commit-config.yaml", "phpstan.neon", "phpstan.neon.dist", "psalm.xml", "phpcs.xml", "phpcs.xml.dist", ".php-cs-fixer.dist.php", ".golangci.yml", "rustfmt.toml", ".rustfmt.toml", "clippy.toml", "detekt.yml", "checkstyle.xml", ".stylelintrc", ".stylelintrc.json", "stylelint.config.js"):
    if c in relset: lint.append(c)
lint = list(dict.fromkeys(lint))

# ---------- CI ----------
ci = {"present": False, "systems": [], "workflows": [], "commands": []}
wf = [f for f in files if f.startswith(".github/workflows/") and f.endswith((".yml", ".yaml"))]
if wf:
    ci["present"] = True; ci["systems"].append("github-actions")
    cmds = collections.Counter()
    for w in wf:
        t = read(w)
        name = re.search(r"^name:\s*(.+)$", t, re.M)
        ci["workflows"].append({"file": w, "name": name.group(1).strip().strip('"\'') if name else os.path.basename(w)})
        for m in re.findall(r"^\s*(?:-\s*)?run:\s*\|?\s*(.+)$", t, re.M):
            m = m.strip()
            if re.search(r"\b(test|build|lint|check|vet|verify|mvnw|gradlew|dotnet|pytest|npm|pnpm|yarn|cargo|go |make|composer|phpunit|terraform|pre-commit|ruff|mypy|tsc|vitest|jest|playwright)\b", m):
                cmds[m[:100]] += 1
    ci["commands"] = [c for c, _ in cmds.most_common(15)]
    ci["workflow_count"] = len(wf)
for c, sysname in ((".gitlab-ci.yml", "gitlab-ci"), ("azure-pipelines.yml", "azure-pipelines"), ("Jenkinsfile", "jenkins"), (".circleci/config.yml", "circleci"), (".travis.yml", "travis"), ("bitbucket-pipelines.yml", "bitbucket")):
    if c in relset:
        ci["present"] = True; ci["systems"].append(sysname)
azp = any_glob(r"azure-pipelines.*\.ya?ml$|(^|/)\.azure(-pipelines|devops)/")
if azp and "azure-pipelines" not in ci["systems"]:
    ci["present"] = True; ci["systems"].append("azure-pipelines"); ci["workflows"] += [{"file": f} for f in azp[:5]]

# ---------- monorepo ----------
mono = {"is_monorepo": False, "workspaces": [], "packages": []}
if root_pkg and root_pkg.get("workspaces"):
    ws = root_pkg["workspaces"]; ws = ws.get("packages", ws) if isinstance(ws, dict) else ws
    mono["is_monorepo"] = True; mono["workspaces"] = ws
if "pnpm-workspace.yaml" in relset:
    mono["is_monorepo"] = True; mono["workspaces"].append("pnpm-workspace.yaml")
if exists("turbo.json", "nx.json", "lerna.json"): mono["is_monorepo"] = True
cargo_ws = [f for f in files if f.endswith("Cargo.toml") and "[workspace]" in read(f)]
if cargo_ws: mono["is_monorepo"] = True; mono["workspaces"].append(f"cargo workspace: {cargo_ws[0]}")
if len(slns) > 1 or len(csprojs) > 8:
    mono["is_monorepo"] = True; mono["workspaces"].append(f"{len(csprojs)} .NET projects in {len(slns)} solution(s)")
gradle_subs = [f for f in files if f.endswith(("build.gradle.kts", "build.gradle")) and f.count("/") >= 1]
if len(gradle_subs) > 5: mono["is_monorepo"] = True; mono["workspaces"].append(f"{len(gradle_subs)} gradle modules")
if mono["is_monorepo"]:
    pkgs = collections.Counter()
    for f in files:
        if f.endswith(("package.json", "Cargo.toml", "pyproject.toml", "build.gradle.kts", ".csproj", "go.mod")) and 1 <= f.count("/") <= 3:
            pkgs[os.path.dirname(f)] += 1
    mono["packages"] = sorted(pkgs)[:60]
    mono["package_count"] = len(pkgs)

# ---------- generated code ----------
gen = {"paths": [], "header_marked_files": 0, "header_sample": []}
gen_path_rx = re.compile(r"(__generated__|\.g\.cs$|\.pb\.go$|\.pb\.cc$|_pb2\.py$|\.generated\.|\.designer\.cs$|\.Designer\.cs$|/generated/|/gen/|\.min\.js$|\.min\.css$|_generated\.|\.d\.ts$|/dist/|\.snap$|Reference\.cs$|/migrations?/.*\.cs$|\.tf\.json$|\.xrm\.cs$|/Model/.*Entities\.cs$)")
gen_dirs = collections.Counter()
for f in files:
    if gen_path_rx.search(f):
        gen_dirs[os.path.dirname(f) or "."] += 1
gen["paths"] = [{"dir": d, "files": n} for d, n in gen_dirs.most_common(15)]
hdr_rx = re.compile(r"(auto-?generated|automatically generated|do not edit|generated by|<auto-generated|code generated .* do not edit|This file was generated|DO NOT MODIFY)", re.I)
hdr_hits = []
for f in files:
    ext = os.path.splitext(f)[1].lower()
    if ext in BINARY_EXT or LANG_EXT.get(ext) not in CODE_LANGS: continue
    if hdr_rx.search(read(f, 1200)):
        hdr_hits.append(f)
gen["header_marked_files"] = len(hdr_hits)
gen["header_sample"] = hdr_hits[:10]
hdr_dirs = collections.Counter(os.path.dirname(f) or "." for f in hdr_hits)
gen["header_dirs"] = [{"dir": d, "files": n} for d, n in hdr_dirs.most_common(10)]

# ---------- secrets ----------
sec_rx = [
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private_key_block", re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("connection_string_with_password", re.compile(r"(?i)(Password|Pwd)=[^;\s\"']{3,};", re.I)),
    ("connection_string_uri_with_creds", re.compile(r"(?i)\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp|mssql|sqlserver)://[^/\s:]+:[^@\s]{3,}@")),
    ("password_assignment", re.compile(r"(?i)\b(password|passwd|secret|client_secret|api[_-]?key|token)\b\s*[:=]\s*[\"'][^\"'\s$\{<]{8,}[\"']")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("stripe_key", re.compile(r"\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b")),
    ("openai_key", re.compile(r"\bsk-[A-Za-z0-9]{32,}\b")),
    ("azure_sas_or_storage_key", re.compile(r"(?i)(AccountKey=[A-Za-z0-9+/=]{40,}|sig=[A-Za-z0-9%]{30,})")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b")),
]
placeholder_rx = re.compile(r"(?i)(changethis|example|placeholder|your[_-]?|xxx|dummy|<.*>|\$\{|%s|password123|secret123|\*\*\*|redacted|fake|sample|test)")
secrets = {"total": 0, "by_kind": {}, "files": [], "sensitive_files": []}
sec_files = collections.Counter()
by_kind = collections.Counter(); test_hits = collections.Counter()
for f in files:
    ext = os.path.splitext(f)[1].lower()
    if ext in BINARY_EXT: continue
    if f.endswith((".md", ".lock", ".sum")): continue
    is_test = bool(re.search(r"(?i)(^|/)(tests?|__tests__|spec|fixtures?|testdata|snapshots)(/|$)|[._-](test|spec|tests)\.[a-z]+$|_test\.(go|rs|py)$|Tests?\.(cs|java|kt|php)$|test_[^/]+\.py$", f))
    t = read(f, 400_000)
    if not t: continue
    for kind, rx in sec_rx:
        for m in rx.finditer(t):
            line = t[max(0, t.rfind("\n", 0, m.start())):t.find("\n", m.end()) if t.find("\n", m.end()) != -1 else len(t)]
            if kind in ("password_assignment", "connection_string_with_password", "connection_string_uri_with_creds") and placeholder_rx.search(line):
                continue
            by_kind[kind] += 1; sec_files[f] += 1
            if is_test: test_hits[kind] += 1
secrets["total"] = sum(by_kind.values()); secrets["by_kind"] = dict(by_kind)
secrets["in_test_files"] = sum(test_hits.values()); secrets["outside_tests"] = secrets["total"] - secrets["in_test_files"]
secrets["files"] = [{"path": p, "hits": n} for p, n in sec_files.most_common(25)]
secrets["sensitive_files"] = [f for f in files if re.search(r"(^|/)(\.env(\.[a-z]+)?|.*\.pfx|.*\.snk|.*\.pem|.*\.p12|.*\.key|.*\.keystore|.*\.jks|secrets?\.(json|ya?ml)|appsettings\.(Production|Staging|Development)\.json|web\.config|app\.config|credentials|\.npmrc|\.pypirc)$", f, re.I)][:40]
secrets["dotenv_examples"] = [f for f in files if re.search(r"\.env\.(example|sample|template)$", f)]

# ---------- external systems ----------
ext_sys = collections.OrderedDict()
ext_rx = {
    "PostgreSQL": r"(?i)\b(postgres(ql)?|psycopg|pg_|npgsql|asyncpg)\b",
    "MySQL/MariaDB": r"(?i)\b(mysqli?|mariadb)\b",
    "SQL Server": r"(?i)(System\.Data\.SqlClient|Microsoft\.Data\.SqlClient|SqlConnection|Data Source=|Initial Catalog=)",
    "MongoDB": r"(?i)\bmongo(db|ose)?\b",
    "Redis": r"(?i)\bredis\b",
    "RabbitMQ/AMQP": r"(?i)\b(rabbitmq|amqp)\b",
    "Kafka": r"(?i)\bkafka\b",
    "AWS SDK": r"(boto3|aws-sdk|github\.com/aws/aws-sdk-go|AWSSDK\.|software\.amazon\.awssdk|hashicorp/aws)",
    "Azure SDK": r"(azure-identity|@azure/|Azure\.Identity|Microsoft\.Azure\.|azure-sdk-for-go|Azure\.Messaging)",
    "GCP SDK": r"(google-cloud-|@google-cloud/|cloud\.google\.com/go)",
    "Dataverse/Dynamics 365": r"(Microsoft\.Xrm\.Sdk|Microsoft\.Crm\.Sdk|Dataverse|IOrganizationService|Microsoft\.PowerPlatform|CrmSvcUtil|xrm\.|Xrm\.WebApi)",
    "Azure DevOps": r"(?i)(dev\.azure\.com|visualstudio\.com|azure-devops|vsts|azure-pipelines)",
    "Jira": r"(?i)\b(atlassian\.net|jira)\b",
    "Stripe": r"(?i)\bstripe\b",
    "SMTP/email": r"(?i)\b(smtp|sendgrid|mailgun|ses\b)",
    "OpenAI API": r"(?i)(api\.openai\.com|openai\b)",
    "Anthropic API": r"(?i)(anthropic|api\.anthropic\.com)",
    "Sentry": r"(?i)\bsentry\b",
    "Docker": r"(?i)^(FROM |docker-compose|services:)",
    "Kubernetes/Helm": r"(?i)(apiVersion: apps/v1|kind: Deployment|helm)",
    "OAuth/OIDC/Identity": r"(?i)(oauth2?|openid|oidc|keycloak|identityserver|Auth0|azure ?ad\b|entra)",
    "Elasticsearch/OpenSearch": r"(?i)\b(elasticsearch|opensearch)\b",
    "GraphQL": r"(?i)\bgraphql\b",
    "gRPC/Protobuf": r"(?i)\b(grpc|protobuf)\b",
    "SharePoint/Office365": r"(?i)(sharepoint|Microsoft\.Graph|office365)",
    "SOAP/WCF web services": r"(?i)(System\.ServiceModel|\.svc\b|wsdl|SoapClient)",
    "SAP": r"(?i)\bsap\b(?!i)",
}
manifest_like = [f for f in files if re.search(r"(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|pom\.xml|build\.gradle(\.kts)?|\.csproj|packages\.config|composer\.json|Cargo\.toml|docker-compose.*\.ya?ml|Dockerfile|\.tf|appsettings.*\.json|web\.config|app\.config|\.env\.example|libs\.versions\.toml)$", f)]
ext_hits = collections.defaultdict(lambda: {"count": 0, "files": collections.Counter()})
for f in manifest_like[:600]:
    t = read(f, 300_000)
    for name, rx in ext_rx.items():
        n = len(re.findall(rx, t, re.M))
        if n:
            ext_hits[name]["count"] += n; ext_hits[name]["files"][f] += n
for name, v in sorted(ext_hits.items(), key=lambda kv: -kv[1]["count"]):
    ext_sys[name] = {"count": v["count"], "sample_files": [p for p, _ in v["files"].most_common(4)]}

# ---------- AI config ----------
ai_rx = re.compile(r"(^|/)(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|\.cursor/rules(/|$)|\.github/copilot-instructions\.md|\.github/instructions/|\.mcp\.json|\.claude/|\.clinerules|\.kiro/|\.windsurf|\.windsurfrules|\.aider|\.agents/|\.codex/|copilot-instructions\.md|llms\.txt)", re.I)
ai_files = [f for f in files if ai_rx.search(f)]
ai = {"present": bool(ai_files), "files": ai_files[:60], "count": len(ai_files),
      "kinds": sorted({("CLAUDE.md" if "CLAUDE.md" in f else "AGENTS.md" if "AGENTS.md" in f else "cursor" if "cursor" in f.lower() else "copilot" if "copilot" in f.lower() else "clinerules" if "clinerules" in f else ".claude/" if "/.claude/" in "/" + f else ".agents/" if ".agents/" in f else "mcp.json" if "mcp.json" in f else "kiro" if ".kiro" in f else "windsurf" if "windsurf" in f.lower() else "other") for f in ai_files})}
ai["sizes"] = {f: len(read(f)) for f in ai_files if f.endswith(".md")}

# ---------- docs ----------
readme = next((f for f in files if re.fullmatch(r"README(\.md|\.rst|\.txt)?", f, re.I)), None)
docs = {"readme": readme, "readme_bytes": len(read(readme)) if readme else 0,
        "docs_dir": any(f.startswith(("docs/", "doc/", "documentation/")) for f in files),
        "docs_files": sum(1 for f in files if f.startswith(("docs/", "doc/", "documentation/"))),
        "adrs": [f for f in files if re.search(r"(?i)(^|/)(adr|adrs|decisions|architecture-decisions)/", f)][:10],
        "contributing": exists("CONTRIBUTING.md", ".github/CONTRIBUTING.md", "CONTRIBUTING.rst", "docs/CONTRIBUTING.md"),
        "architecture_docs": [f for f in files if re.search(r"(?i)architecture|design[-_]?doc|ARCHITECTURE", f) and f.endswith((".md", ".rst", ".txt"))][:10],
        "license": exists("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENSE.rst", "COPYING", "LICENCE"),
        "changelog": exists("CHANGELOG.md", "CHANGELOG", "CHANGES.md", "ChangeLog.md")}
if docs["license"]:
    lt = read(docs["license"][0], 3000)
    docs["license_kind"] = ("MIT" if "MIT License" in lt or "Permission is hereby granted, free of charge" in lt else "Apache-2.0" if "Apache License" in lt else "GPL" if "GNU GENERAL PUBLIC" in lt else "BSD" if "Redistribution and use in source and binary" in lt else "MPL" if "Mozilla Public" in lt else "unknown")
else:
    docs["license_kind"] = "none"

# ---------- Windows-only / environment ----------
win = {"sln": len(slns), "csproj": len(csprojs), "snk": len(any_glob(r"\.snk$")), "vbproj": len(any_glob(r"\.vbproj$")),
       "packages_config": len(any_glob(r"packages\.config$")), "ps1": len(any_glob(r"\.ps1$")), "bat_cmd": len(any_glob(r"\.(bat|cmd)$")),
       "legacy_netframework": ".NET Framework (legacy, msbuild)" in frameworks,
       "dll_checked_in": len(any_glob(r"\.dll$")), "exe_checked_in": len(any_glob(r"\.exe$"))}
win["windows_only_build"] = win["legacy_netframework"] or (win["sln"] > 0 and win["packages_config"] > 0 and ".NET" in frameworks and "dotnet" not in build["system"])
env = {"devcontainer": bool(exists(".devcontainer/devcontainer.json", ".devcontainer.json") or any_glob(r"^\.devcontainer/")),
       "dockerfile": [f for f in files if re.search(r"(^|/)Dockerfile[^/]*$", f)][:10],
       "docker_compose": [f for f in files if re.search(r"(^|/)(docker-)?compose[^/]*\.ya?ml$", f)][:10],
       "makefile": bool(exists("Makefile", "makefile", "justfile", "Taskfile.yml")),
       "nix_flake": bool(exists("flake.nix")), "editorconfig": bool(exists(".editorconfig")),
       "tool_versions": exists(".tool-versions", ".nvmrc", ".node-version", ".python-version", "rust-toolchain.toml", ".java-version", "global.json")}

# ---------- size ----------
size = {"files": len(files), "code_lines": total_lines, "bytes_on_disk_excl_git": 0}
try:
    size["bytes_on_disk_excl_git"] = int(run(["du", "-sb", "--exclude=.git", "--exclude=node_modules", "--exclude=packages" if NAME == "altshuler_trade" else "--exclude=__never__", "."]).split()[0])
except Exception: pass
big = sorted(((os.path.getsize(os.path.join(ROOT, f)), f) for f in files if os.path.isfile(os.path.join(ROOT, f))), reverse=True)[:8]
size["largest_files"] = [{"path": f, "bytes": b} for b, f in big]
size["top_level_dirs"] = sorted({f.split("/")[0] for f in files if "/" in f})[:40]

# ---------- git ----------
git = {"available": False}
if not NO_GIT and os.path.isdir(os.path.join(ROOT, ".git")):
    git["available"] = True
    git["head"] = run(["git", "rev-parse", "HEAD"]).strip()
    tracked = run(["git", "ls-files"]).split("\n")
    git["tracked_files"] = len([t for t in tracked if t])
    git["tracked_binaries_dll_exe_pdb"] = len([t for t in tracked if re.search(r"\.(dll|exe|pdb|nupkg)$", t, re.I)])
    git["tracked_ide_junk"] = len([t for t in tracked if re.search(r"(^|/)(\.vs|\.idea|obj)/|\.(suo|user)$", t)])
    git["tracked_package_dirs"] = len([t for t in tracked if re.match(r"(packages|node_modules|vendor)/", t)])
    git["commits_in_clone"] = int(run(["git", "rev-list", "--count", "HEAD"]).strip() or 0)
    git["shallow"] = os.path.exists(os.path.join(ROOT, ".git", "shallow"))
    git["last_commit_date"] = run(["git", "log", "-1", "--format=%cs"]).strip()
    git["first_commit_date_in_clone"] = run(["git", "log", "--reverse", "--format=%cs"]).strip().split("\n")[0]
    authors = run(["git", "shortlog", "-sn", "--no-merges", "HEAD"]).strip().split("\n")
    git["authors_in_clone"] = len([a for a in authors if a.strip()])
    log = run(["git", "log", "--no-merges", "--name-only", "--format=__C__%h|%an|%cs", "HEAD"])
    file_changes = collections.Counter(); dir_changes = collections.Counter(); file_authors = collections.defaultdict(set); dir_authors = collections.defaultdict(set)
    commit_sets = []
    cur = None; cur_files = []
    for line in log.split("\n"):
        if line.startswith("__C__"):
            if cur and cur_files:
                commit_sets.append((cur, tuple(sorted(cur_files))))
            cur = line[5:].split("|"); cur_files = []
        elif line.strip():
            f = line.strip(); cur_files.append(f)
            file_changes[f] += 1; file_authors[f].add(cur[1])
            d = f.split("/")[0] if "/" in f else "."
            d2 = "/".join(f.split("/")[:2]) if f.count("/") >= 2 else d
            dir_changes[d2] += 1; dir_authors[d2].add(cur[1])
    if cur and cur_files:
        commit_sets.append((cur, tuple(sorted(cur_files))))
    git["hot_files"] = [{"path": f, "changes": n, "authors": len(file_authors[f])} for f, n in file_changes.most_common(15)]
    git["hot_dirs"] = [{"dir": d, "changes": n, "authors": len(dir_authors[d])} for d, n in dir_changes.most_common(12)]
    # repeated change shapes: identical file-sets of >=3 files appearing in >=2 commits
    shapes = collections.Counter(fs for _, fs in commit_sets if 3 <= len(fs) <= 12)
    git["repeated_change_shapes"] = [{"files": list(fs), "times": n} for fs, n in shapes.most_common(8) if n >= 2]
    # co-change pairs (files changed together >= 4 times) as a softer signal
    pair = collections.Counter()
    for _, fs in commit_sets:
        if len(fs) <= 12:
            for i in range(len(fs)):
                for j in range(i + 1, len(fs)):
                    pair[(fs[i], fs[j])] += 1
    git["cochange_pairs"] = [{"a": a, "b": b, "times": n} for (a, b), n in pair.most_common(8) if n >= 4]
    git["commits_analyzed"] = len(commit_sets)
    ext_counter = collections.Counter(os.path.splitext(f)[1] for f in file_changes.elements())
    git["churn_by_ext"] = dict(ext_counter.most_common(8))

out = {
    "name": NAME, "path": ROOT,
    "languages": top_langs, "frameworks": sorted(frameworks), "package_managers": sorted(package_managers),
    "build": build, "tests": tests, "lint_format": lint, "ci": ci, "monorepo": mono,
    "generated_code": gen, "secrets": secrets, "external_systems": ext_sys, "ai_config": ai,
    "docs": docs, "windows_build": win, "environment": env, "size": size, "git": git,
}
print(json.dumps(out, indent=1, ensure_ascii=False))
