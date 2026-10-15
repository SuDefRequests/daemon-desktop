function validateDevURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Missing or invalid DAEMON_DEV_URL. Start development with npm run electron:dev.",
    );
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "DAEMON_DEV_URL must be a local Vite HTTP root URL with an explicit port.",
    );
  return url.href;
}
module.exports = { validateDevURL };
