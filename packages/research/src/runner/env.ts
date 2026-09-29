import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The environment an agent process receives (protocol 3.2: project settings
 * only, no user settings, plugins or personal memory; network through the
 * harness).
 *
 * ENFORCED AT SPAWN: the child gets exactly the variables built here and
 * nothing it inherits by accident: no tokens, no DCC variables, no real home.
 * The home, AppData and Claude Code configuration directories point into a
 * synthetic home that the harness creates per run.
 *
 * NOT ENFORCED: this changes where well-behaved programs look. A process that
 * opens the real home by absolute path is not stopped by it; the file system
 * is shared (same OS user). That is detected, not prevented (runner/leak.ts).
 */

/** Variables a Windows or POSIX program needs to start at all; passed through from the harness. */
const SYSTEM_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "SystemDrive", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL"];

export type SyntheticHome = { home: string; appData: string; localAppData: string; claudeConfig: string; temp: string; gitConfig: string };

export function makeSyntheticHome(runDir: string): SyntheticHome {
  const home = path.join(runDir, "home");
  const h: SyntheticHome = {
    home,
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    claudeConfig: path.join(home, ".claude"),
    temp: path.join(runDir, "tmp"),
    gitConfig: path.join(home, ".gitconfig"),
  };
  for (const d of [h.appData, h.localAppData, h.claudeConfig, h.temp]) mkdirSync(d, { recursive: true });
  writeFileSync(h.gitConfig, "");
  return h;
}

export function buildAgentEnv(o: { home: SyntheticHome; proxyUrl?: string; extra?: Record<string, string>; from?: NodeJS.ProcessEnv }): Record<string, string> {
  const from = o.from ?? process.env;
  const env: Record<string, string> = {};
  for (const k of SYSTEM_KEYS) { const v = from[k]; if (typeof v === "string") env[k] = v; }
  // On Windows, Node's process layer (libuv) adds HOMEDRIVE, HOMEPATH, USERNAME,
  // USERDOMAIN and LOGONSERVER from the parent when a child's environment lacks
  // them, which would hand the child the real home and user name. Setting them
  // here to synthetic values keeps them out. Variables injected by other
  // software on the machine (seen: BPPDOMAIN_MANAGER_*) are beyond the harness.
  const parsed = path.parse(o.home.home);
  Object.assign(env, {
    HOMEDRIVE: parsed.root.replace(/[\\/]$/, ""), HOMEPATH: o.home.home.slice(parsed.root.replace(/[\\/]$/, "").length),
    USERNAME: "pilot", USERDOMAIN: "PILOT", LOGONSERVER: "\\\\PILOT", USER: "pilot", LOGNAME: "pilot",
  });
  Object.assign(env, {
    HOME: o.home.home, USERPROFILE: o.home.home,
    APPDATA: o.home.appData, LOCALAPPDATA: o.home.localAppData,
    CLAUDE_CONFIG_DIR: o.home.claudeConfig,
    TEMP: o.home.temp, TMP: o.home.temp, TMPDIR: o.home.temp,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: o.home.gitConfig, GIT_TERMINAL_PROMPT: "0",
  });
  if (o.proxyUrl) Object.assign(env, { HTTP_PROXY: o.proxyUrl, HTTPS_PROXY: o.proxyUrl, http_proxy: o.proxyUrl, https_proxy: o.proxyUrl, ALL_PROXY: o.proxyUrl, NO_PROXY: "", no_proxy: "" });
  Object.assign(env, o.extra ?? {});
  return env;
}
