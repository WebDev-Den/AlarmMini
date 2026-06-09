import { NextRequest } from "next/server";

const ALLOWED_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
];

function isAllowedHost(hostname: string) {
  return (
    ALLOWED_HOSTS.includes(hostname) ||
    hostname.endsWith(".githubusercontent.com")
  );
}

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source");

  if (!source) {
    return new Response("Missing source", { status: 400 });
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return new Response("Invalid source URL", { status: 400 });
  }

  if (!isAllowedHost(sourceUrl.hostname)) {
    return new Response("Source host is not allowed", { status: 403 });
  }

  const upstream = await fetch(sourceUrl.toString(), {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "user-agent": "AlarmMini-Installer/1.0 (+https://github.com/WebDev-Den/AlarmMini)",
      accept: "application/octet-stream,*/*",
    },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error ${upstream.status}`, {
      status: upstream.status || 502,
    });
  }

  const headers = new Headers();
  headers.set(
    "content-type",
    upstream.headers.get("content-type") || "application/octet-stream",
  );
  headers.set("cache-control", "public, max-age=3600");

  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers.set("content-disposition", disposition);
  }

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
