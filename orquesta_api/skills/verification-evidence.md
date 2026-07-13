id: verification-evidence
name: Verification Evidence
description: Require concrete command output before claiming a pass.
suggested_roles: tester, verifier

Any claim of "pass" must quote the command that was run and the actual output that supports the claim.

Do not report success from memory, intent, or an assumed result. If the command was not run, say that it was not run.

When output is long, include the meaningful summary lines: command, exit status, failing or passing test names, and the final result line.

No success claims without evidence.
