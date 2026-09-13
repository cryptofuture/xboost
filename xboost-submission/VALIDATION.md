# Local release validation

Version: 1.8.0
Date: September 7, 2026

- Clean npm ci --ignore-scripts succeeded.
- StandardJS lint passed.
- 27 automated tests passed.
- web-ext 10.6.0 validation: 0 errors, 0 warnings, 0 notices.
- Extension ZIP inspected: readable runtime JS, HTML/CSS, icons, four product context documents, manifest, LICENSE and privacy policy. No token file, environment file, original reference extension, legacy server, node_modules or dependency lockfile is included in the installable package.
- Source archive constructed from explicit source paths, excluding credentials, environment files and build outputs.
- Extracted source archive supports a clean dependency install and test/build workflow.
- No live authenticated Firefox/X/Codex model run was performed during submission preparation.
- Source dependency versions repaired from the installed dependency lock after earlier release version replacements had affected dependency entries.
- No publication, signing request or reviewer account provisioning was performed.

SHA-256:

    86d80a404658c2ae54613b784d6b65dde742a1046c629df50c58b6cea217b582  xboost-1.8.0.zip
    362b4f7f8e4ef4921c128b8296c103b4fe8cf928d9c5694d599a00feaed93eae  xboost-1.8.0-source.zip

Remaining submission risks and owner choices are listed in SUBMIT.md. In particular, remote plaintext WS is retained by explicit owner request and conflicts with Mozilla's encrypted-remote-transport requirement; automated lint does not resolve that policy issue.
