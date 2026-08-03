import http from 'http';

const CANDIDATE_PORTS = [
  3101, 3100, 3099, 3000, 3001, 3002, 3003, 3004, 3005, 3010, 3020, 3030,
];

function probeLogin(port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/login', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Find a local dev server serving /login with HTTP 200. */
export async function discoverBaseUrl(): Promise<string> {
  const fromEnv = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '');
  if (fromEnv) {
    try {
      const port = new URL(fromEnv).port || '80';
      if (await probeLogin(Number(port))) return fromEnv;
    } catch {
      /* fall through */
    }
  }

  for (const port of CANDIDATE_PORTS) {
    if (await probeLogin(port)) {
      return `http://localhost:${port}`;
    }
  }

  throw new Error(
    'No Khatario dev server found. Start with: npm run dev (or PORT=3101 npm run dev)',
  );
}
