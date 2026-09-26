# Onboard a Go repository

## 1. Add CI wrapper

Create `.github/workflows/ci.yml`:

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

## 2. Add security wrapper

Create `.github/workflows/security.yml`:

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

## 3. Add repo health wrapper

Create `.github/workflows/repo-health.yml`:

```yaml
name: Repo Health

on:
  schedule:
    - cron: "23 6 * * 1"
  workflow_dispatch:

jobs:
  repo-health:
    uses: ojarosch/github-actions/.github/workflows/repo-health.yml@v1
    permissions:
      contents: read
```

## 4. Add Dependabot

Copy `.github/dependabot-go.yml` from this repo to the target repo as `.github/dependabot.yml`.

## 5. Tag central repo

After pushing this repository to GitHub:

```bash
git tag v1
git push origin main --tags
```
