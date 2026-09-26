import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function fmtDate(value) {
  if (!value) return 'never';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

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

function Workflow({ label, run }) {
  const content = <strong className={`pill ${statusClass(run)}`}>{statusText(run)}</strong>;
  return (
    <div className="workflow">
      <span>{label}</span>
      {run?.html_url ? <a href={run.html_url}>{content}</a> : content}
    </div>
  );
}

function SummaryCard({ repo }) {
  const findingCount = repo.codeScanning.count + repo.dependabot.count;
  const latestVersion = repo.releases[0]?.tag ?? repo.tags[0]?.name ?? 'none';

  return (
    <article className="summary-card">
      <header>
        <h2><a href={repo.url}>{repo.name}</a></h2>
        <span className={`finding ${findingCount > 0 ? 'warn' : 'ok'}`}>{findingCount} findings</span>
      </header>
      <section className="workflow-grid">
        <Workflow label="CI" run={repo.workflows.ci} />
        <Workflow label="Security" run={repo.workflows.security} />
        <Workflow label="Health" run={repo.workflows.health} />
        <Workflow label="Release" run={repo.workflows.release} />
      </section>
      <dl className="summary-facts">
        <dt>Latest</dt><dd>{latestVersion}</dd>
        <dt>Last push</dt><dd>{fmtDate(repo.pushedAt)}</dd>
        <dt>Code scan</dt><dd>{repo.codeScanning.count}</dd>
        <dt>Dependabot</dt><dd>{repo.dependabot.count}</dd>
      </dl>
    </article>
  );
}

function RepoDetails({ repos }) {
  return (
    <section className="panel">
      <h2>Details</h2>
      <div className="tool-list">
        {repos.map((repo) => {
          const seenVersions = new Set();
          const versions = [...repo.releases, ...repo.tags]
            .filter((v) => {
              const key = v.tag ?? v.name;
              if (seenVersions.has(key)) return false;
              seenVersions.add(key);
              return true;
            })
            .slice(0, 8);

          return (
            <article className="tool-row" key={repo.repo}>
              <h3><a href={repo.url}>{repo.name}</a></h3>
              <section>
                <h4>Version history</h4>
                <ul>
                  {versions.length ? versions.map((v, idx) => (
                    <li key={`${v.tag ?? v.name}-${idx}`}>
                      <a href={v.url}><strong>{v.tag ?? v.name}</strong></a>
                      {v.publishedAt && <small>{fmtDate(v.publishedAt)}</small>}
                    </li>
                  )) : <li>No tags/releases found</li>}
                </ul>
              </section>
              <section>
                <h4>Security report</h4>
                <ul className="finding-list">
                  {repo.codeScanning.alerts?.map((alert) => (
                    <li key={`code-${alert.number}`} className="finding-item">
                      <a href={alert.url}><strong>{alert.ruleId || alert.name}</strong></a>
                      <span className={`severity ${alert.severity}`}>{alert.severity}</span>
                      <p>{alert.message || alert.description || alert.fullDescription}</p>
                      {alert.path && <small>{alert.path}{alert.startLine ? `:${alert.startLine}` : ''}</small>}
                    </li>
                  ))}
                  {repo.dependabot.alerts?.map((alert) => (
                    <li key={`dep-${alert.number}`} className="finding-item">
                      <a href={alert.url}><strong>{alert.packageName}</strong></a>
                      <span className={`severity ${alert.severity}`}>{alert.severity}</span>
                      <p>{alert.summary}</p>
                      <small>{alert.ecosystem} · {alert.manifestPath} · vulnerable {alert.vulnerableRange}{alert.patchedVersions ? ` · fixed in ${alert.patchedVersions}` : ''}</small>
                    </li>
                  ))}
                  {!repo.codeScanning.count && !repo.dependabot.count && <li>No open security findings</li>}
                </ul>
              </section>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load dashboard data: ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  const repos = useMemo(() => data?.repos ?? [], [data]);

  if (error) return <main><h1>Dashboard failed</h1><p>{error.message}</p></main>;
  if (!data) return <main><h1>Go repo dashboard</h1><p className="meta">Loading…</p></main>;

  return (
    <main>
      <section className="hero">
        <div>
          <h1>Go repo dashboard</h1>
          <div className="meta">CI, security findings, and version history for managed repos.</div>
        </div>
        <div className="meta">Updated {fmtDate(data.generatedAt)}</div>
      </section>
      <section className="summary-grid">
        {repos.map((repo) => <SummaryCard key={repo.repo} repo={repo} />)}
      </section>
      <RepoDetails repos={repos} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
