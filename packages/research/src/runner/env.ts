import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The environment an agent process receives (protocol 3.2: project settings
 * only, no user settings, plugins or personal memory; network through the
 * harness).
 *
 * ENFORCED AT SPAWN: the child gets exactly the variables built here. PATH is
 * never the user's: it is the explicit list of tool folders the harness
 * prepared (runner/toolchain.ts). Home, AppData, temp and the Claude Code
 * configuration directory point into a synthetic home under the run root.
 *
 * On Windows, Node's process layer (libuv) adds HOMEDRIVE, HOMEPATH, USERNAME,
 * USERDOMAIN, LOGONSERVER, USERPROFILE, TEMP, SYSTEMDRIVE and WINDIR from the
 * parent when a child's environment lacks them; the personal ones are set
 * here to synthetic values so that nothing is copied from the real user.
 * Variables injected by other software on the machine (seen:
 * BPPDOMAIN_MANAGER_*) are beyond the harness.
 *
 * NOT ENFORCED: the process still runs as the real OS account. The account's
 * name and profile folder remain available through operating-system calls
 * (for example os.userInfo()), and every file the account can read stays
 * readable by absolute path. Hiding those needs a separate OS account.
 */

/** Machine facts a program may need to start; none of them names a user. PATH is not among them. */
const SYSTEM_KEYS = ["PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "SystemDrive", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL"];

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

export function buildAgentEnv(o: { home: SyntheticHome; pathDirs: readonly string[]; proxyUrl?: string; extra?: Record<string, string>; from?: NodeJS.ProcessEnv }): Record<string, string> {
  const from = o.from ?? process.env;
  const env: Record<string, string> = {};
  for (const k of SYSTEM_KEYS) { const v = from[k]; if (typeof v === "string") env[k] = v; }
  const drive = path.parse(o.home.home).root.replace(/[\\/]$/, "");
  Object.assign(env, {
    PATH: o.pathDirs.join(path.delimiter),
    HOMEDRIVE: drive, HOMEPATH: o.home.home.slice(drive.length),
    USERNAME: "pilot", USERDOMAIN: "PILOT", LOGONSERVER: "\\\\PILOT", USER: "pilot", LOGNAME: "pilot",
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
