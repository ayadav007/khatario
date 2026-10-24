import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ReleaseCommit, StagingProductionDiff } from '@/lib/staging-production-diff-types';

const execFileAsync = promisify(execFile);

export type { ReleaseCommit, StagingProductionDiff };

function appHostLabel(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || '';
  if (url.includes('staging.')) return 'staging';
  if (url.includes('localhost')) return 'local';
  return 'production';
}

function parseGithubRepo(remoteUrl: string): string | null {
  const m = remoteUrl.trim().match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return m ? m[1].replace(/\.git$/i, '') : null;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: process.cwd(),
    timeout: 12_000,
    windowsHide: true,
  });
  return stdout.trim();
}

function parseLog(raw: string): ReleaseCommit[] {
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [sha, date, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    return {
      sha,
      shortSha: (sha || '').slice(0, 7),
      subject,
      date: date || null,
    };
  });
}

async function fromGithub(repo: string, token?: string): Promise<ReleaseCommit[] | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'khatario-admin',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/compare/production...main`, {
    headers,
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    commits?: Array<{ sha: string; commit?: { message?: string; author?: { date?: string } } }>;
  };
  const commits = [...(data.commits || [])].reverse();
  return commits.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    subject: (c.commit?.message || '').split('\n')[0],
    date: c.commit?.author?.date || null,
  }));
}

export async function getStagingProductionDiff(): Promise<StagingProductionDiff> {
  const stagingRef = 'main';
  const productionRef = 'production';
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  let repo = process.env.GITHUB_REPOSITORY?.trim() || process.env.KHATARIO_GITHUB_REPO?.trim() || '';
  let thisBranch: string | null = null;
  let thisSha: string | null = null;

  try {
    thisBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    thisSha = (await git(['rev-parse', 'HEAD'])).slice(0, 7);
    if (!repo) {
      const remote = await git(['remote', 'get-url', 'origin']);
      repo = parseGithubRepo(remote) || '';
    }
  } catch {
    /* not a git checkout */
  }

  let commits: ReleaseCommit[] | null = null;
  let source: 'github' | 'git' = 'git';
  let hint: string | null = null;

  if (repo) {
    try {
      commits = await fromGithub(repo, token);
      if (commits) source = 'github';
    } catch {
      commits = null;
    }
  }

  if (!commits) {
    try {
      const raw = await git([
        'log',
        '--format=%H\t%cI\t%s',
        'origin/production..origin/main',
      ]);
      commits = parseLog(raw);
      source = 'git';
    } catch (err) {
      try {
        await git(['fetch', 'origin', 'main', 'production']);
        const raw = await git([
          'log',
          '--format=%H\t%cI\t%s',
          'origin/production..origin/main',
        ]);
        commits = parseLog(raw);
        source = 'git';
      } catch (inner) {
        hint =
          inner instanceof Error
            ? inner.message
            : err instanceof Error
              ? err.message
              : 'git log failed. On the VPS run: git fetch origin main production';
        commits = [];
      }
    }
  }

  return {
    thisHost: appHostLabel(),
    thisBranch,
    thisSha,
    stagingRef,
    productionRef,
    source,
    aheadBy: commits.length,
    commitsOnStagingNotProduction: commits,
    hint,
  };
}
