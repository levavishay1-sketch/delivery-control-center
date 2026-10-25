namespace Dcc.Tests.Support;

/// <summary>
/// Stands in for the interactive claude in an onboarding run's pseudo-terminal (run as <c>node fake-claude-terminal.cjs
/// …args</c>). It prints a banner (with a Hebrew word, so the decoding is seen), echoes what it is typed, and — the way
/// the real one does through <c>statusline.mjs</c> — keeps a status snapshot at the path the <c>--settings</c> file's
/// status-line command names, plus a JSONL transcript beside the settings: a user line and an assistant line per prompt
/// (<c>/init</c> is written as a command when the session starts). Every prompt costs $0.02; a prompt that starts with
/// "work" leaves the turn unfinished (a tool is "running"), so the session looks busy. <c>/exit</c> ends it with code 0.
/// </summary>
public static class FakeClaudeTerminal
{
    public const string Script = """
        const fs = require('fs'); const path = require('path');
        const args = process.argv.slice(2);
        const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
        const resume = at('--resume');
        const id = resume || at('--session-id') || 'none';
        const settings = at('--settings');
        const model = at('--model') || 'claude-fake-1';
        const effort = at('--effort') || 'medium';
        let statusOut = null;
        try {
          const cmd = JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command;
          const quoted = [...cmd.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
          statusOut = quoted[quoted.length - 1];
        } catch { /* no status line: nothing is reported */ }
        const transcript = path.join(path.dirname(settings || '.'), 'transcript-' + id + '.jsonl');
        let cost = 0, input = 0, output = 0, turns = 0;
        const now = () => new Date().toISOString();
        const entry = (o) => fs.appendFileSync(transcript, JSON.stringify(o) + '\n');
        function status() {
          if (!statusOut) return;
          const s = { session_id: id, transcript_path: transcript, model: { id: model, display_name: 'Fake ' + model }, effort: { level: effort },
            cost: { total_cost_usd: cost, total_api_duration_ms: turns * 1000, total_duration_ms: turns * 1500, total_lines_added: 0, total_lines_removed: 0 },
            context_window: { total_input_tokens: input, total_output_tokens: output } };
          fs.writeFileSync(statusOut + '.tmp', JSON.stringify(s)); fs.renameSync(statusOut + '.tmp', statusOut);
        }
        function turn(content, stop) {
          turns++; cost = Math.round((cost + 0.02) * 1e6) / 1e6; input += 200; output += 40;
          entry({ type: 'user', message: { role: 'user', content }, timestamp: now() });
          entry({ type: 'assistant', message: { id: 'msg_' + process.pid + '_' + turns, role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: 'done' }] }, timestamp: now() });
          status();
        }
        process.stdout.write('FAKE CLAUDE ' + (resume ? 'resumed' : 'new') + ' ' + id + ' שלום\r\n');
        if (!resume && args.includes('/init')) turn('<command-name>/init</command-name>\n<command-message>init</command-message>\n<command-args></command-args>', 'end_turn');
        else status();
        let typed = '';
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (d) => {
          process.stdout.write(d.replace(/\x1b/g, '').replace(/\r/g, '\r\n'));
          typed = (typed + d).replace(/\x1b\[20[01]~/g, '');
          let i;
          while ((i = typed.indexOf('\r')) >= 0) {
            const text = typed.slice(0, i).replace(/\x1b/g, '').trim();
            typed = typed.slice(i + 1);
            if (!text) continue;
            if (text === '/exit') { process.stdout.write('bye\r\n'); status(); setTimeout(() => process.exit(0), 50); return; }
            turn(text, text.startsWith('work') ? 'tool_use' : 'end_turn');
            process.stdout.write('you said: ' + text + '\r\n');
          }
        });
        process.stdin.on('end', () => process.exit(0));
        setInterval(() => {}, 1 << 30);
        """;
}
