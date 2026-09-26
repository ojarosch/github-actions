# github-actions

Central reusable GitHub Actions workflows for Go repositories.

## Use in a repo

Create a small wrapper workflow in the target repo:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    uses: ojarosch/github-actions/.github/workflows/go-ci.yml@v1
    permissions:
      contents: read
```

Security scan wrapper:

```yaml
name: Security

on:
  pull_request:
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:

jobs:
  security:
    uses: ojarosch/github-actions/.github/workflows/go-security.yml@v1
    permissions:
      contents: read
      security-events: write
      issues: write
```

## Workflows

- `go-ci.yml`: format, vet, test, race test, tidy check, optional `golangci-lint`.
- `go-security.yml`: `govulncheck`, OSV scan, CodeQL, and scheduled issue creation/update.
- `go-release.yml`: GoReleaser-based release workflow.
- `repo-health.yml`: weekly checks for expected repository hygiene files.

## Versioning

Consumer repos should use the stable major tag:

```yaml
uses: ojarosch/github-actions/.github/workflows/go-ci.yml@v1
```

Create `v2` only for breaking workflow input or behavior changes.
