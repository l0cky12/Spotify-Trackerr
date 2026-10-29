# Automated checks

Pull requests and pushes to `main` run:

- **CI:** a clean Node 22 install, Svelte/TypeScript checks, all Vitest tests, the production build, and Chromium smoke tests. Browser failures retain screenshots and traces for seven days.
- **Dependency audit:** `npm audit --include=dev --audit-level=high`. High and critical findings fail; lower severities remain visible. Development dependencies are included because build tools execute in CI.
- **Dependency review:** newly introduced high/critical vulnerabilities fail on pull requests, including development and unknown dependency scopes. No license policy is imposed.
- **Secret scan:** Trivy scans the checked-out source using its built-in secret rules and fails on detections. This scans the current tree, not deleted secrets in Git history, and does not recognize every possible credential.
- **Container checks:** Trivy first checks the Dockerfile for misconfigurations such as running as root. The job then builds the final Docker image, verifies login startup, unsigned API access rejection and host filtering, and scans the image's OS and application packages, file layers, and build history for vulnerabilities, embedded secrets and misconfigurations. High/critical misconfigurations, secrets, and fixable vulnerabilities fail. The seven-day JSON artifact also includes lower-severity and unfixed findings.
- **CodeQL:** the JavaScript/TypeScript extended security suite uploads findings to GitHub Security. It complements tests; do not assume full `.svelte` component coverage. Successful analysis alone does not mean there are no findings.

Dependency, secret, and container checks also run daily at 06:23 UTC; CodeQL runs weekly on Mondays at 06:41 UTC. Schedules start after these files reach the default branch. Each workflow can also be run manually. Container scans rebuild current source with a fresh base image; they do not inspect an already deployed container.

Actions are pinned to full commit SHAs, checkout credentials are not persisted, and only CodeQL receives `security-events: write`. Checks use GitHub-hosted runners and require no production or music-service secrets. Dependabot opens weekly npm, Actions, and Docker update PRs, grouping npm minor/patch upgrades. Updates are not automatically merged.

## Repository settings

After merging, configure the following under repository Settings (these settings are not changed by workflow files):

1. Enable the dependency graph, Dependabot alerts, and Dependabot security updates under **Security / Advanced Security**.
2. Enable GitHub secret scanning and push protection. These complement the source-tree scan with supported credential detection in history and before pushes. Rotate any real credential that was exposed; deleting it is insufficient.
3. Require the CI, dependency audit/review, secret scan, and container checks on `main` using a branch protection rule or ruleset, once the checks have run. Include administrators if they should also be subject to the checks.
4. Enable code-scanning merge protection for high/critical CodeQL security findings, in addition to requiring completed analysis. Use this advanced workflow rather than enabling a second CodeQL default setup.

This repository is public, so GitHub code scanning and dependency review are available. Moving to a private repository changes eligibility: those features require a qualifying organization plan with Code Security; Secret Protection has separate eligibility. Branch protection on private repositories also depends on the plan. See [GitHub code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning), [dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), and [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Reproduce locally

```sh
npm ci
npm run check
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npm audit --include=dev --audit-level=high
docker build --pull --tag trackerr:ci .
```

Browser tests start the production server on `127.0.0.1:4173` with a fresh database under the OS temporary directory. They refuse to reuse an existing server, clear music-service credentials for that process, and stub outbound requests so background jobs cannot contact real services. They create only synthetic accounts and listening history. Vitest and Playwright discover separate test files.

The runtime Docker stage removes the unused bundled npm CLI and its dependencies; the build stage retains npm for installation and compilation. Vite's minimum version is 8.3.3 to address the advisories affecting the previous locked 8.3.2 release. The initial npm audit still reports low-severity advisories through `deepmerge`; these remain visible and are below the merge-blocking threshold.
