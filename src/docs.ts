export const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VexoStream YouTube Scraper — API Docs</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      padding: 2rem 1.25rem 4rem;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: #0b0d10;
      color: #e6edf3;
      line-height: 1.55;
    }
    main { max-width: 920px; margin: 0 auto; }
    h1 { font-size: 1.75rem; margin: 0 0 0.4rem; }
    p.lead { color: #9aa4b2; margin: 0 0 2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
    th, td {
      text-align: left;
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid #222730;
      vertical-align: top;
      font-size: 0.92rem;
    }
    th { color: #9aa4b2; font-weight: 600; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #161b22;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      font-size: 0.86rem;
    }
    pre {
      background: #161b22;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid #222730;
    }
    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
      font-size: 0.78rem;
      font-weight: 700;
      background: #1f6feb;
      color: #fff;
    }
  </style>
</head>
<body>
  <main>
    <h1>VexoStream YouTube Scraper</h1>
    <p class="lead">
      Anonymous public YouTube metadata &amp; captions REST API powered by Deno, Hono, and youtubei.js.
      No login, no OAuth, no cookies, no media download endpoint.
    </p>
    <table>
      <thead>
        <tr><th>Method</th><th>Path</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><span class="badge">GET</span></td><td><code>/</code></td><td>Service metadata and endpoint index</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/health</code></td><td>Instant liveness probe (no upstream network call)</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/video?url=</code></td><td>Full video metadata, all formats, captions list, and related videos</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/formats?url=</code></td><td>Complete list of video &amp; audio-only format itags</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/search?q=&amp;type=video&amp;limit=10&amp;sort=relevance</code></td><td>Search videos, channels, or playlists</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/channel?url=&amp;limit=10</code></td><td>Channel metadata and latest videos (supports <code>@handle</code>, <code>UC…</code>, or URL)</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/playlist?url=&amp;limit=50</code></td><td>Playlist metadata and paginated videos</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/comments?url=&amp;limit=20&amp;replies=0&amp;replies_all=false</code></td><td>Top-level comments with optional replies</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/transcript?url=&amp;lang=en</code></td><td>Parsed caption segments and full plain text</td></tr>
        <tr><td><span class="badge">GET</span></td><td><code>/download?url=&amp;lang=en&amp;format=vtt</code></td><td>Download captions as <code>srt</code>, <code>vtt</code>, <code>txt</code>, or <code>json</code></td></tr>
      </tbody>
    </table>
    <pre><code>curl "http://localhost:8000/video?url=dQw4w9WgXcQ"
curl "http://localhost:8000/transcript?url=dQw4w9WgXcQ&amp;lang=en"
curl "http://localhost:8000/download?url=dQw4w9WgXcQ&amp;format=srt" -o captions.srt</code></pre>
  </main>
</body>
</html>`;
