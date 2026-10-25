namespace Dcc.Tests.Support;

/// <summary>
/// Stands in for the claude CLI (run as <c>node fake-claude.cjs …args</c>). It answers the way the real one
/// does — stream-json lines ending in a result line with cost and usage — and does what each kind of call
/// is for: a write call writes <c>feature.txt</c>; a checks call (commands, no write) passes every check the
/// prompt numbers; anything else answers what a test put in <c>reply.txt</c> beside the script, or a small JSON object.
/// Every call's arguments and prompt are appended to <c>calls.log</c>, so a test can see what was sent.
///
/// A task's instruction steers it the way the old prove kit's stand-in was steered, by the words of its TASK line and of
/// each numbered check: "write x.txt" writes that file instead (its content names the instruction, so two tasks writing
/// the same file collide), "no code" writes nothing; a check that says "needs x.txt" waits for it (dependency_missing)
/// while x.txt is not in the branch, and one that says "tamper" changes <c>base.txt</c>, which DCC must put back.
///
/// A repository-onboarding call is known by the instruction it carries — on stdin, or in the
/// <c>--system-prompt-file</c> of a lean call — and gets an answer in the shape that instruction asks for: the
/// processes, a trial task, the judge, the open search, the reviewer, a person's request, an author's file, the scan
/// of the /init draft. A test overrides one kind with <c>onboarding-&lt;kind&gt;.txt</c> beside the script; an override
/// that reads <c>!fail</c> makes that call fail the way a failed CLI run does (is_error). Where the answer depends on the
/// call (each trial task, each file an author writes), <c>onboarding-&lt;kind&gt;.rules.json</c> holds
/// <c>[{ "when": regex, "answer": text or object }]</c>: the first rule whose regex matches the instruction answers, and a
/// call no rule matches falls back to the override or the default.
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
        const ONBOARDING = [
          ['processes', 'You are mapping how work is actually done in the repository'],
          ['trial', 'You are working in this repository with no instructions'],
          ['judge', 'You judge whether an AI coding agent did a task correctly'],
          ['marketplace', 'You search the web for ready-made components'],
          ['author', 'You write ONE file for an AI coding agent'],
          ['review', 'You review a plan for setting up an AI coding agent'],
          ['request', 'A person asked, in their own words, for a helper'],
          ['init_scan', 'You are the editor who decides what goes into the AI instructions'],
        ];
        const ANSWERS = {
          processes: { processes: [{ key: 'add_feature', title: 'Add a feature', source: 'git', evidence: ['README.md'], steps: [
            { key: 'write', title: 'Write the code', what: 'The change itself', agentTest: { judgment: false, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: 'a plain step' } },
            { key: 'review', title: 'Review the change', what: 'A second look before merging', agentTest: { judgment: true, externalInfo: false, readsALot: false, parallel: false, failsToday: false, why: 'needs a second opinion', reasons: { judgment: 'the author should not review their own change' } } },
          ] }] },
          trial: 'I read README.md. There are no automated tests in this repository, and no test framework.\nRESULT: there are no tests here.',
          judge: { passed: true, failureKind: null, detail: 'the answer matches the facts' },
          marketplace: { sources: [{ kind: 'plugin', name: 'stand-in markdown plugin', url: 'https://example.com/stand-in-markdown-plugin', publisher: 'Example', description: 'helps with markdown', tags: ['markdown'], official: false, why: 'the repository is mostly markdown', toolCount: null, readOnly: null, license: null, lastActivity: null }] },
          author: 'A small shop: a README and nothing else yet.',
          review: { missing: [{ kind: 'rule', title: 'Keep the README current', why: 'the README is the only document here' }], redundant: [] },
          request: { kind: 'rule', title: 'Answer in short sentences', what: 'A line in the instructions', questions: [{ key: 'tone', question_he: 'Which tone?', default: 'plain' }] },
          init_scan: { verdict: 'keep_ours', summary: 'the draft adds nothing ours lacks', compare: [], items: [], drop_ours: [], reject: [] },
        };
        function onboarding(text) {
          const hit = ONBOARDING.find(([, needle]) => text.includes(needle));
          if (!hit) return null;
          const kind = hit[0];
          const rules = path.join(__dirname, 'onboarding-' + kind + '.rules.json');
          if (fs.existsSync(rules)) {
            const rule = JSON.parse(fs.readFileSync(rules, 'utf8')).find((r) => new RegExp(r.when).test(text));
            if (rule) return { kind, answer: rule.answer };
          }
          const override = path.join(__dirname, 'onboarding-' + kind + '.txt');
          return { kind, answer: fs.existsSync(override) ? fs.readFileSync(override, 'utf8') : ANSWERS[kind] };
        }
        function respond(prompt) {
          let result;
          const sysFile = at('--system-prompt-file');
          const system = sysFile && fs.existsSync(sysFile) ? fs.readFileSync(sysFile, 'utf8') : null;
          const ob = onboarding((system || '') + '\n' + prompt);
          fs.appendFileSync(path.join(__dirname, 'calls.log'), JSON.stringify(system === null ? { args, prompt } : { args, prompt, system }) + '\n');
          if (ob && ob.answer === '!fail') {
            out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'the stand-in failed this ' + ob.kind + ' call', total_cost_usd: 0.001, duration_ms: 5, num_turns: 1,
                  usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: { 'claude-sonnet-5': { costUSD: 0.001 } } });
            if (!streaming) process.exit(0);
            return;
          }
          if (ob) {
            result = ob.answer;
          } else if (tools.includes('Write')) {
            const task = ((prompt.match(/TASK — this is the instruction, follow it exactly:\r?\n([^\r\n]*)/) || [])[1] || '').trim();
            const named = (task.match(/write (\S+)/) || [])[1];
            const file = named || (/no code/.test(task) ? null : 'feature.txt');
            if (file) {
              fs.writeFileSync(path.join(process.cwd(), file), named ? 'made by ' + task + '\n' : 'made by the stand-in\n');
              out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: path.join(process.cwd(), file) } }] } });
            }
            result = { summary: file ? 'wrote ' + file : 'did ' + task, filesChanged: file ? [file] : [], testsRun: null, followUps: [], affectedConsumers: [] };
          } else if (tools.includes('Bash')) {
            const checks = [...prompt.matchAll(/^#(\d+)(?: \[\w+\])?:(.*)$/gm)].map((m) => {
              const seq = Number(m[1]); const text = m[2] || '';
              if (/tamper/.test(text)) fs.writeFileSync(path.join(process.cwd(), 'base.txt'), 'tampered\n');
              const needs = (text.match(/needs (\S+)/) || [])[1];
              if (needs && !fs.existsSync(path.join(process.cwd(), needs))) return { seq, passed: false, detail: needs + ' is not here', likelyCause: 'dependency_missing' };
              return { seq, passed: true, detail: 'fine' };
            });
            result = { summary: 'checked', checks };
          } else {
            const reply = path.join(__dirname, 'reply.txt');
            result = fs.existsSync(reply) ? fs.readFileSync(reply, 'utf8') : { summary: 'read only' };
          }
          out({ type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } });
          out({ type: 'result', subtype: 'success', is_error: false, result: typeof result === 'string' ? result : JSON.stringify(result), total_cost_usd: 0.0123, duration_ms: 42, num_turns: 2,
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
