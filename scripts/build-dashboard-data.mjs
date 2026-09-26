import fs from 'node:fs/promises';
import path from 'node:path';

const token = process.env.GITHUB_TOKEN;
const repos = JSON.parse(await fs.readFile('dashboard/repos.json', 'utf8'));
const outDir = 'public';

if (!token) {
  throw new Error('GITHUB_TOKEN is required');
}

async function gh(url) {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ojarosch-github-actions-dashboard',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} for ${url}: ${body}`);
  }
  return res.json();
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    return { ...fallback, error: `${label}: ${err.message}` };
  }
}

function latestByName(runs, name) {
  return runs.find((run) => run.name === name) ?? null;
}

function countAlerts(alerts) {
  return alerts.reduce((acc, alert) => {
    const severity = alert.rule?.security_severity_level ?? alert.rule?.severity ?? alert.security_advisory?.severity ?? 'unknown';
    acc[severity] = (acc[severity] ?? 0) + 1;
    return acc;
  }, {});
}

async function repoData({ owner, repo, name }) {
  const base = `/repos/${owner}/${repo}`;
  const [meta, runs, issues, releases, tags, codeScanning, vulnAlerts] = await Promise.all([
    gh(base),
    gh(`${base}/actions/runs?per_page=100`),
    gh(`${base}/issues?state=open&labels=security&per_page=20`),
    gh(`${base}/releases?per_page=10`),
    gh(`${base}/tags?per_page=10`),
    safe('code scanning alerts', () => gh(`${base}/code-scanning/alerts?state=open&per_page=100`), []),
    safe('dependabot alerts', () => gh(`${base}/dependabot/alerts?state=open&per_page=100`), []),
  ]);

  const allRuns = runs.workflow_runs ?? [];
  return {
    owner,
    repo,
    name,
    url: meta.html_url,
    defaultBranch: meta.default_branch,
    updatedAt: meta.updated_at,
    pushedAt: meta.pushed_at,
    workflows: {
      ci: latestByName(allRuns, 'CI'),
      security: latestByName(allRuns, 'Security'),
      health: latestByName(allRuns, 'Repo Health'),
      release: latestByName(allRuns, 'Release'),
    },
    securityIssues: issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      updatedAt: issue.updated_at,
    })),
    codeScanning: Array.isArray(codeScanning)
      ? {
          count: codeScanning.length,
          bySeverity: countAlerts(codeScanning),
          alerts: codeScanning.map((alert) => ({
            number: alert.number,
            url: alert.html_url,
            state: alert.state,
            ruleId: alert.rule?.id,
            name: alert.rule?.name ?? alert.rule?.id,
            severity: alert.rule?.security_severity_level ?? alert.rule?.severity ?? 'unknown',
            description: alert.rule?.description,
            fullDescription: alert.rule?.full_description,
            message: alert.most_recent_instance?.message?.text,
            path: alert.most_recent_instance?.location?.path,
            startLine: alert.most_recent_instance?.location?.start_line,
            fixedAt: alert.fixed_at,
          })),
        }
      : { count: 0, bySeverity: {}, alerts: [], error: codeScanning.error },
    dependabot: Array.isArray(vulnAlerts)
      ? {
          count: vulnAlerts.length,
          bySeverity: countAlerts(vulnAlerts),
          alerts: vulnAlerts.map((alert) => ({
            number: alert.number,
            url: alert.html_url,
            state: alert.state,
            packageName: alert.dependency?.package?.name,
            ecosystem: alert.dependency?.package?.ecosystem,
            manifestPath: alert.dependency?.manifest_path,
            severity: alert.security_advisory?.severity ?? 'unknown',
            summary: alert.security_advisory?.summary,
            cve: alert.security_advisory?.cve_id,
            vulnerableRange: alert.security_vulnerability?.vulnerable_version_range,
            patchedVersions: alert.security_vulnerability?.patched_versions,
          })),
        }
      : { count: 0, bySeverity: {}, alerts: [], error: vulnAlerts.error },
    releases: releases
      .filter((release) => !release.draft)
      .sort((a, b) => new Date(b.published_at ?? 0) - new Date(a.published_at ?? 0))
      .map((release) => ({
        name: release.name || release.tag_name,
        tag: release.tag_name,
        url: release.html_url,
        publishedAt: release.published_at,
      })),
    tags: tags
      .sort((a, b) => b.name.localeCompare(a.name, undefined, {numeric: true}))
      .map((tag) => ({ name: tag.name, url: `${meta.html_url}/releases/tag/${tag.name}` })),
  };
}

const data = {
  generatedAt: new Date().toISOString(),
  repos: await Promise.all(repos.map(repoData)),
};

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'data.json'), JSON.stringify(data, null, 2));
