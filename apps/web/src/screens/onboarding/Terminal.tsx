import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onboardingTerminalUrl, terminalAuthMessage, type SessionState } from "../../api.ts";

const STATE_HE: Record<SessionState, string> = {
  none: "הסשן יתחיל בשלב ההטמעה",
  live: "● סשן Claude פעיל",
  ended: "הסשן נסגר",
  disconnected: "הסשן נותק — אפשר לחדש אותו מכרטיס השלב",
};

/** What the person sees: the visible screen plus a little above it. */
function readScreen(xt: XTerm): string {
  const b = xt.buffer.active;
  const lines: string[] = [];
  for (let i = Math.max(0, b.viewportY - 20); i < b.viewportY + xt.rows; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The run's terminal: the real Claude Code session in a pseudo-terminal on
 * the DCC server, plus DCC's own dimmed lines. Keystrokes go straight to
 * Claude, so it behaves exactly like the terminal — answers, Esc, slash
 * commands. One socket per open screen; a dropped connection reconnects
 * and replays what was on screen.
 *
 * `screenRef` hands the assistant next to it a way to read what is on the
 * screen right now.
 */
export function RunTerminal({ repoId, runId, screenRef }: { repoId: string; runId: string; screenRef?: MutableRefObject<(() => string) | null> }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<SessionState>("none");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new XTerm({
      fontFamily: '"IBM Plex Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: { background: "#1B1741", foreground: "#E1DFF0", cursor: "#a9a3ff", selectionBackground: "#453AD180" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try { fit.fit(); } catch { /* not laid out yet */ }
    if (screenRef) screenRef.current = () => readScreen(term);

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | undefined;
    const sendResize = () => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    const connect = () => {
      ws = new WebSocket(onboardingTerminalUrl(repoId, runId));
      ws.onopen = () => { ws?.send(terminalAuthMessage()); setConnected(true); sendResize(); };
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as { type: string; data?: string; state?: SessionState };
        if (m.type === "replay") { term.reset(); term.write(m.data ?? ""); }
        else if (m.type === "output") term.write(m.data ?? "");
        else if (m.type === "state" && m.state) setState(m.state);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
    };
    const input = term.onData((d) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d })); });
    const refit = () => { try { fit.fit(); sendResize(); } catch { /* hidden */ } };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    // The first measurement can happen before the monospace font has
    // loaded; measured with the fallback font, lines run past the edge.
    void document.fonts?.ready.then(refit);
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      ro.disconnect();
      input.dispose();
      ws?.close();
      term.dispose();
      if (screenRef) screenRef.current = null;
    };
  }, [repoId, runId, screenRef]);

  return (
    <div>
      <div className="ob-term">
        <div className="ob-term-bar">
          <span>טרמינל · סשן Claude Code אחד לכל ההרצה</span>
          <span className={state === "live" ? "live" : undefined}>{connected ? STATE_HE[state] : "מתחבר…"}</span>
        </div>
        <div className="ob-term-body"><div ref={host} style={{ height: "100%" }} /></div>
      </div>
      <p className="ob-sub" style={{ margin: "6px 2px 0" }}>
        זה הסשן האמיתי של Claude Code, והוא נשאר פתוח בין השלבים עד המסירה. מה שמקלידים כאן מגיע אליו כמו בטרמינל, כולל פקודות כמו <span className="ob-code">/model</span> ו-<span className="ob-code">/cost</span>.
      </p>
    </div>
  );
}
