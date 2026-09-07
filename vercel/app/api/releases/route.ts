const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER || "WebDev-Den";
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "AlarmMini";

export async function GET() {
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AlarmMini-Installer" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return Response.json({ error: "releases_unavailable" }, { status: 502 });
    const releases = await response.json();
    if (!Array.isArray(releases)) return Response.json({ error: "invalid_releases" }, { status: 502 });
    return Response.json(releases.filter((release) => !release.draft && !release.prerelease), {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return Response.json({ error: "releases_unavailable" }, { status: 502 });
  }
}
