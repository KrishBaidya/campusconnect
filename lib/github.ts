import "server-only";

export type GitHubSummary = {
  username: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  avatarUrl: string | null;
  profileUrl: string;
  followers: number;
  publicRepos: number;
  topLanguages: string[];
  repos: { name: string; description: string | null; language: string | null; stars: number; url: string; topics: string[]; updatedAt: string }[];
};

const GH = "https://api.github.com";

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "campusconnect",
  };
  // Optional: without a token GitHub allows 60 requests/hour per server IP.
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** Public GitHub profile + most relevant repos (no user token needed). */
export async function fetchGitHubSummary(username: string): Promise<GitHubSummary> {
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) throw new Error("Invalid GitHub username");

  const [userRes, reposRes] = await Promise.all([
    fetch(`${GH}/users/${username}`, { headers: headers(), cache: "no-store" }),
    fetch(`${GH}/users/${username}/repos?per_page=100&sort=pushed&type=owner`, { headers: headers(), cache: "no-store" }),
  ]);
  if (userRes.status === 403 || userRes.status === 429) throw new Error("GitHub rate limit hit — add GITHUB_TOKEN to .env");
  if (!userRes.ok) throw new Error(`GitHub user lookup failed (${userRes.status})`);
  const u = await userRes.json();
  const raw: any[] = reposRes.ok ? await reposRes.json() : [];

  const own = raw.filter((r) => !r.fork && !r.archived);
  const langCount = new Map<string, number>();
  own.forEach((r) => r.language && langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1));

  const repos = own
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, 12)
    .map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      url: r.html_url,
      topics: r.topics ?? [],
      updatedAt: r.pushed_at,
    }));

  return {
    username: u.login,
    name: u.name,
    bio: u.bio,
    company: u.company,
    location: u.location,
    blog: u.blog || null,
    avatarUrl: u.avatar_url,
    profileUrl: u.html_url,
    followers: u.followers,
    publicRepos: u.public_repos,
    topLanguages: [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l]) => l),
    repos,
  };
}
