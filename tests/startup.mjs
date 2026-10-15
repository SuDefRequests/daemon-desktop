import assert from "node:assert/strict";
import { createServer as createHTTPServer } from "node:http";
import { createServer } from "vite";
import devURL from "../electron/dev-url.cjs";
const occupied = createHTTPServer((_req, res) =>
  res.end("unrelated application"),
);
await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
let vite;
try {
  const port = occupied.address().port;
  vite = await createServer({
    server: { host: "127.0.0.1", port, strictPort: false },
  });
  await vite.listen();
  const actual = devURL.validateDevURL(vite.resolvedUrls.local[0]);
  assert.notEqual(new URL(actual).port, String(port));
  assert.match(await (await fetch(actual)).text(), /VIDUR AI/);
  assert.equal(
    await (await fetch(`http://127.0.0.1:${port}`)).text(),
    "unrelated application",
  );
  for (const invalid of [
    undefined,
    "https://127.0.0.1:5173",
    "http://example.com:5173",
    "http://127.0.0.1:5173/path",
  ])
    assert.throws(() => devURL.validateDevURL(invalid));
  console.log(
    "Startup: occupied port preserved, actual Vite URL selected and local URL validation passed.",
  );
} finally {
  await vite?.close();
  await new Promise((resolve) => occupied.close(resolve));
}
