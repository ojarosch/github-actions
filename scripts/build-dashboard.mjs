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
    return {...fallback, error: `${label}: ${err.message}`};
  }
}

function latestByName(runs, name) {
  return runs.find((run) => run.name === name) ?? null;
}

function countAlerts(alerts) {
  return alerts.reduce((acc, alert) => {
    const severity = alert.rule?.security_severity_level ?? alert.rule?.severity ?? 'unknown';
    acc[severity] = (acc[severity] ?? 0) + 1;
    return acc;
  }, {});
}

async function repoData({owner, repo, name}) {
  const base = `/repos/${owner}/${repo}`;
  const [meta, runs, issues, releases, tags, codeScanning, vulnAlerts] = await Promise.all([
    gh(base),
    gh(`${base}/actions/runs?per_page=50&branch=main`),
    gh(`${base}/issues?state=open&labels=security&per_page=20`),
    gh(`${base}/releases?per_page=10`),
    gh(`${base}/tags?per_page=10`),
    safe('code scanning alerts', () => gh(`${base}/code-scanning/alerts?state=open&per_page=100`), []),
    safe('dependabot alerts', () => gh(`${base}/dependabot/alerts?state=open&per_page=100`), []),
  ]);

  const allRuns = runs.workflow_runs ?? [];
  const ci = latestByName(allRuns, 'CI');
  const security = latestByName(allRuns, 'Security');
  const health = latestByName(allRuns, 'Repo Health');
  const release = latestByName(allRuns, 'Release');

  return {
    owner,
    repo,
    name,
    url: meta.html_url,
    defaultBranch: meta.default_branch,
    updatedAt: meta.updated_at,
    pushedAt: meta.pushed_at,
    workflows: {ci, security, health, release},
    securityIssues: issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      updatedAt: issue.updated_at,
    })),
    codeScanning: Array.isArray(codeScanning) ? {
      count: codeScanning.length,
      bySeverity: countAlerts(codeScanning),
    } : {count: 0, bySeverity: {}, error: codeScanning.error},
    dependabot: Array.isArray(vulnAlerts) ? {
      count: vulnAlerts.length,
      bySeverity: countAlerts(vulnAlerts),
    } : {count: 0, bySeverity: {}, error: vulnAlerts.error},
    releases: releases.map((release) => ({
      name: release.name || release.tag_name,
      tag: release.tag_name,
      url: release.html_url,
      publishedAt: release.published_at,
    })),
    tags: tags.map((tag) => ({name: tag.name, url: tag.zipball_url})),
  };
}

const generatedAt = new Date().toISOString();
const data = {
  generatedAt,
  repos: await Promise.all(repos.map(repoData)),
};

await fs.rm(outDir, {recursive: true, force: true});
await fs.mkdir(outDir, {recursive: true});
await fs.writeFile(path.join(outDir, 'data.json'), JSON.stringify(data, null, 2));
await fs.writeFile(path.join(outDir, 'index.html'), render(data));

function statusClass(run) {
  if (!run) return 'unknown';
  if (run.status !== 'completed') return 'running';
  return run.conclusion || 'unknown';
}

function statusText(run) {
  if (!run) return 'missing';
  if (run.status !== 'completed') return run.status;
  return run.conclusion || 'unknown';
}

function fmtDate(value) {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-GB', {dateStyle: 'medium', timeStyle: 'short'});
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
}

function workflowCell(label, run) {
  const cls = statusClass(run);
  const text = statusText(run);
  const link = run?.html_url ? `<a href="${esc(run.html_url)}">${esc(text)}</a>` : esc(text);
  return `<div class="workflow"><span>${esc(label)}</span><strong class="pill ${cls}">${link}</strong></div>`;
}

function render(data) {
  const cards = data.repos.map((repo) => {
    const findingCount = repo.securityIssues.length + repo.codeScanning.count + repo.dependabot.count;
    const latestVersion = repo.releases[0]?.tag ?? repo.tags[0]?.name ?? 'none';
    return `<article class="card">
      <header>
        <h2><a href="${esc(repo.url)}">${esc(repo.name)}</a></h2>
        <span class="finding ${findingCount > 0 ? 'warn' : 'ok'}">${findingCount} finding${findingCount === 1 ? '' : 's'}</span>
      </header>
      <section class="grid">
        ${workflowCell('CI', repo.workflows.ci)}
        ${workflowCell('Security', repo.workflows.security)}
        ${workflowCell('Health', repo.workflows.health)}
        ${workflowCell('Release', repo.workflows.release)}
      </section>
      <dl>
        <dt>Latest version</dt><dd>${esc(latestVersion)}</dd>
        <dt>Last push</dt><dd>${esc(fmtDate(repo.pushedAt))}</dd>
        <dt>Open security issues</dt><dd>${repo.securityIssues.length}</dd>
        <dt>Code scanning alerts</dt><dd>${repo.codeScanning.count}</dd>
        <dt>Dependabot alerts</dt><dd>${repo.dependabot.count}</dd>
      </dl>
      <details>
        <summary>Version history</summary>
        <ul>${repo.releases.concat(repo.tags).slice(0, 10).map((v) => `<li>${esc(v.tag ?? v.name)} ${v.publishedAt ? `<small>${esc(fmtDate(v.publishedAt))}</small>` : ''}</li>`).join('') || '<li>No tags/releases found</li>'}</ul>
      </details>
      <details>
        <summary>Security issues</summary>
        <ul>${repo.securityIssues.map((issue) => `<li><a href="${esc(issue.url)}">#${issue.number} ${esc(issue.title)}</a></li>`).join('') || '<li>No open security issues</li>'}</ul>
      </details>
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Go repo CI dashboard</title>
  <style>
    :root { color-scheme: light dark; --ok:#16833a; --bad:#b42318; --warn:#b54708; --run:#175cd3; --card: color-mix(in srgb, Canvas, CanvasText 4%); --border: color-mix(in srgb, CanvasText, transparent 82%); }
    body { margin: 0; font: 16px/1.45 system-ui, -apple-system, Segoe UI, sans-serif; background: Canvas; color: CanvasText; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px; }
    .hero { display:flex; justify-content:space-between; gap:16px; align-items:end; margin-bottom:24px; }
    h1 { margin:0; font-size: clamp(2rem, 5vw, 4rem); letter-spacing:-0.05em; }
    .meta { color: color-mix(in srgb, CanvasText, transparent 35%); }
    .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:16px; }
    .card { border:1px solid var(--border); border-radius:18px; background:var(--card); padding:18px; box-shadow: 0 1px 2px color-mix(in srgb, CanvasText, transparent 90%); }
    header { display:flex; justify-content:space-between; align-items:start; gap:12px; }
    h2 { margin:0 0 14px; font-size:1.25rem; }
    a { color: inherit; }
    .finding, .pill { border-radius:999px; padding:3px 9px; font-size:.85rem; font-weight:700; white-space:nowrap; }
    .ok, .success { background: color-mix(in srgb, var(--ok), transparent 85%); color: var(--ok); }
    .warn, .failure, .cancelled, .timed_out { background: color-mix(in srgb, var(--bad), transparent 85%); color: var(--bad); }
    .running, .in_progress, .queued { background: color-mix(in srgb, var(--run), transparent 85%); color: var(--run); }
    .unknown, .missing, .skipped { background: color-mix(in srgb, CanvasText, transparent 88%); color: color-mix(in srgb, CanvasText, transparent 20%); }
    .grid { display:grid; gap:8px; margin:12px 0 16px; }
    .workflow { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    dl { display:grid; grid-template-columns: 1fr auto; gap:6px 12px; margin:0 0 12px; }
    dt { color: color-mix(in srgb, CanvasText, transparent 35%); }
    dd { margin:0; text-align:right; font-weight:650; }
    details { border-top:1px solid var(--border); padding-top:10px; margin-top:10px; }
    summary { cursor:pointer; font-weight:700; }
    ul { padding-left: 20px; }
    small { color: color-mix(in srgb, CanvasText, transparent 40%); }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div><h1>Go repo dashboard</h1><div class="meta">CI, security findings, and version history for managed repos.</div></div>
      <div class="meta">Updated ${esc(fmtDate(data.generatedAt))}</div>
    </section>
    <section class="cards">${cards}</section>
  </main>
</body>
</html>`;
}
