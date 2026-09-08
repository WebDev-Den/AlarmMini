const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER || "WebDev-Den";
const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "AlarmMini";

export async function GET() {
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AlarmMini-Installer" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return Response.json([]);
    if (!response.ok) return Response.json({ error: "releases_unavailable" }, { status: 502 });
    const release = await response.json();
    if (!release || Array.isArray(release) || typeof release.tag_name !== "string" || release.draft || release.prerelease)
      return Response.json({ error: "invalid_releases" }, { status: 502 });
    return Response.json([release], {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return Response.json({ error: "releases_unavailable" }, { status: 502 });
  }
}
