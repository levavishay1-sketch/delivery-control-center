namespace Dcc.Tests.Support;

/// <summary>
/// Stands in for the claude CLI (run as <c>node fake-claude.cjs …args</c>). It answers the way the real one
/// does — stream-json lines ending in a result line with cost and usage — and does what each kind of call
/// is for: a write call writes <c>feature.txt</c>; a checks call (commands, no write) passes every check the
/// prompt numbers; anything else answers a small JSON object.
/// </summary>
public static class FakeClaude
{
    public const string Script = """
        const fs = require('fs'); const path = require('path');
        const args = process.argv.slice(2);
        const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
        const tools = at('--allowed-tools') || '';
        const streaming = at('--input-format') === 'stream-json';
        let buf = ''; let done = false;
        const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
        function respond(prompt) {
          let result;
          if (tools.includes('Write')) {
            fs.writeFileSync(path.join(process.cwd(), 'feature.txt'), 'made by the stand-in\n');
            out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(process.cwd(), 'feature.txt') } }] } });
            result = { summary: 'wrote feature.txt', filesChanged: ['feature.txt'], testsRun: null, followUps: [], affectedConsumers: [] };
          } else if (tools.includes('Bash')) {
            const seqs = [...prompt.matchAll(/^#(\d+)(?: \[\w+\])?:/gm)].map((m) => Number(m[1]));
            result = { summary: 'checked', checks: seqs.map((seq) => ({ seq, passed: true, detail: 'fine' })) };
          } else {
            result = { summary: 'read only' };
          }
          out({ type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } });
          out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(result), total_cost_usd: 0.0123, duration_ms: 42, num_turns: 2,
                usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: { 'claude-sonnet-5': { costUSD: 0.0123 } } });
          if (!streaming) process.exit(0);
        }
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (d) => {
          buf += d;
          if (streaming && !done && buf.includes('\n')) {
            done = true;
            let prompt = '';
            try { prompt = JSON.parse(buf.split('\n')[0]).message.content[0].text; } catch (e) { }
            respond(prompt);
          }
        });
        process.stdin.on('end', () => { if (!done) { done = true; respond(buf); } else process.exit(0); });
        """;
}
