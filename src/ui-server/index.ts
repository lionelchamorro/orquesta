import path from "node:path";

const uiBuildDir = path.join(import.meta.dir, "..", "..", "dist", "ui");
const port = Number(Bun.env.ORQ_UI_PORT ?? 4173);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(Bun.file(path.join(uiBuildDir, "index.html")));
    }
    if (pathname === "/theme.css") {
      return new Response(Bun.file(path.join(uiBuildDir, "theme.css")));
    }
    if (pathname.startsWith("/assets/")) {
      return new Response(Bun.file(path.join(uiBuildDir, pathname.slice(1))));
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`orquesta web ui listening on http://localhost:${port}`);
console.log(`  daemon api: ${Bun.env.VITE_DAEMON_URL ?? "http://localhost:8000"}`);
