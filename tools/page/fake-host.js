/* A host in the browser, for the page tests: window.claude.use over fakeConnector, the same fake of Google the runtime's own tests use. It waits for the page to load the
   runtime, so the page's real path runs: the gzip in the page, inflated and started on "Start yours". window.__HOST__ says what this host has. */
(function () {
  const opts = window.__HOST__ = Object.assign({ mcp: true, drive: true, sample: null }, window.__HOST__ || {});
  let fake = null;
  function connector() {
    if (fake) return fake;
    if (!window.KittyHousehold) throw { code: "server_unavailable", message: "The test host has no runtime yet." };
    const K = window.KittyHousehold, sheet = new K.FakeSheet();
    try { const saved = localStorage.getItem("fake-google-sheet"); if (saved) sheet.sheets = JSON.parse(saved); } catch (e) { /* first run */ }
    fake = K.fakeConnector({ sheet });
    if (!opts.drive) for (const t of ["create_file", "search_files", "download_file_content"]) fake.revoke(t);
    window.__fake = fake;
    return fake;
  }
  const mcp = {
    async callTool(server, tool, input, o) { const c = connector(), r = await c.callTool(server, tool, input, o); try { localStorage.setItem("fake-google-sheet", JSON.stringify(c.sheet.sheets)); } catch (e) { /* too big for a test */ } return r; },
    async invalidate() {},
  };
  window.claude = { async use(name) {
    if (name === "mcp") return opts.mcp ? mcp : null;
    if (name === "sample") return opts.sample ? { json: async () => JSON.parse(opts.sample) } : null;
    return null;
  } };
})();
