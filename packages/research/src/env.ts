import { execSync } from "node:child_process";
import os from "node:os";

/**
 * The machine and tool versions a record was produced on (section 4.1,
 * "starting state"). Only version queries run here: nothing that reaches the
 * network, nothing that calls a model. A tool that does not answer is
 * recorded as UNAVAILABLE rather than guessed.
 */

const version = (cmd: string): string => {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/)[0] ?? "UNAVAILABLE";
  } catch {
    return "UNAVAILABLE";
  }
};

export function captureEnvironment(): Record<string, string> {
  return {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpus: String(os.cpus().length),
    memoryGb: (os.totalmem() / 2 ** 30).toFixed(1),
    node: process.version,
    npm: version("npm --version"),
    git: version("git --version"),
    dotnet: version("dotnet --version"),
    claudeCode: version("claude --version"),
  };
}
