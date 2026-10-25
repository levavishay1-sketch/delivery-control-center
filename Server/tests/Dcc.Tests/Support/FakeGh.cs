namespace Dcc.Tests.Support;

/// <summary>
/// Stands in for the GitHub CLI (run as <c>node fake-gh.cjs …args</c>). A test lists rules in <c>gh-rules.json</c>
/// beside the script — each a regex over the joined arguments and what to answer (stdout, stderr, exit code); the
/// first rule that matches answers. <c>--version</c> always succeeds; anything without a rule fails, the way a host
/// that does not know the repository would. Every call's arguments are appended to <c>gh-calls.log</c>.
/// </summary>
public static class FakeGh
{
    public const string Script = """
        const fs = require('fs'); const path = require('path');
        const args = process.argv.slice(2); const line = args.join(' ');
        fs.appendFileSync(path.join(__dirname, 'gh-calls.log'), JSON.stringify(args) + '\n');
        if (args[0] === '--version') { process.stdout.write('gh version 2.0.0 (fake)\n'); process.exit(0); }
        let rules = [];
        try { rules = JSON.parse(fs.readFileSync(path.join(__dirname, 'gh-rules.json'), 'utf8')); } catch (e) { }
        for (const r of rules) {
          if (!new RegExp(r.match).test(line)) continue;
          if (r.out !== undefined) process.stdout.write(typeof r.out === 'string' ? r.out : JSON.stringify(r.out));
          if (r.err) process.stderr.write(r.err);
          process.exit(r.code || 0);
        }
        process.stderr.write('HTTP 404: Not Found (fake gh has no rule for: ' + line + ')\n');
        process.exit(1);
        """;
}
