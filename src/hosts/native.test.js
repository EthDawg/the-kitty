/* Run explicitly: node --test src/hosts/native.test.js
   Tests the shipped shim in a fresh browser-like VM, with no network or provider. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(__dirname + "/native.js", "utf8");
const PATH = "data/users/native-demo/kitty";
const COPY = (value) => JSON.parse(JSON.stringify(value));

function host(reply, { subframe = false, reduced = false } = {}) {
  const document = new EventTarget(), attributes = new Map(), styles = new Map(), calls = [];
  document.documentElement = { setAttribute: (key, value) => attributes.set(key, value), style: { setProperty: (key, value) => styles.set(key, value) } };
  const media = new EventTarget(); media.matches = reduced;
  const window = { document, Blob, TextEncoder, btoa, CustomEvent, matchMedia: () => media };
  window.top = subframe ? {} : window;
  if (reply !== undefined) window.webkit = { messageHandlers: { kitty: { postMessage(message) { calls.push(COPY(message)); return reply(message); } } } };
  vm.runInNewContext(source, { window }, { filename: "native.js" });
  return { window, document, calls, attributes, styles, media, use: (name) => window.claude.use(name) };
}
const ok = (value) => Promise.resolve({ ok: true, value });
const isCode = (code) => (error) => error.code === code;

test("the demo exposes only the five intended capabilities, with no live or AI authority", async () => {
  const h = host(() => ok(null));
  assert.equal(h.window.KITTY_HOST, "native");
  assert.equal(await h.use("mcp"), null);
  assert.equal(await h.use("sample"), null);
  assert.equal(await h.use("constructor"), null);
  assert.equal(await h.use("unknown"), null);
  const user = await h.use("user");
  assert.equal(await user.isOwner(), false);
  assert.equal(await user.id(), "native-demo");
  assert.deepEqual(COPY(await user.me()), { name: "" });
  assert.equal(h.calls.length, 0, "discovery must not probe the bridge with side effects");
});

test("missing bridge and subframes have no capabilities", async () => {
  for (const h of [host(), host(() => ok(null), { subframe: true })]) {
    for (const name of ["mcp", "sample", "user", "db", "downloads"]) assert.equal(await h.use(name), null);
    assert.equal(h.calls.length, 0);
  }
});

test("opening one verified file scopes Sheets and preferences, and closing invalidates old handles", async () => {
  const sheetID = "fictional_existing_sheet_000001", preferenceID = "native-" + "a".repeat(64);
  const selection = { sheetID, preferenceID, title: "Fictional Sheet", sheetVersion: 2, canEdit: false, session: "80454d6f-fde5-4fc1-8361-accdd7c9ce50" };
  const h = host(({ method }) => ok(method === "google.open" ? selection : method === "sheets.call" ? { payload: {values:[["fixture"]]} } : null));
  const db = await h.use("db"), demo = db.doc(PATH);
  await h.window.KittyNative.google.open(sheetID);
  const house = db.doc("data/users/" + preferenceID + "/kitty"), mcp = await h.use("mcp");
  assert.equal(await (await h.use("user")).id(), preferenceID);
  await assert.rejects(demo.get(), isCode("stale_session"));
  await assert.rejects(mcp.callTool("Google Sheets", "get_values", {spreadsheetId:"different"}), isCode("not_granted"));
  assert.throws(() => db.doc(PATH), isCode("invalid_request"));
  assert.deepEqual(COPY(await mcp.callTool("Google Sheets", "get_values", {spreadsheetId:sheetID,range:"Entries!A1:U"})), {payload:{values:[["fixture"]]}});
  assert.equal(h.calls.at(-1).params.session, selection.session);
  await h.window.KittyNative.google.close();
  await assert.rejects(house.get(), isCode("stale_session"));
  await assert.rejects(mcp.callTool("Google Sheets", "get_values", {spreadsheetId:sheetID}), isCode("not_granted"));
  assert.equal(await h.use("mcp"), null);
  assert.equal(await (await h.use("user")).id(), "native-demo");
});

test("a non-Promise native handler fails closed on the actual call", async () => {
  const h = host(() => undefined), db = await h.use("db");
  await assert.rejects(db.doc(PATH).get(), isCode("bridge_unavailable"));
  assert.equal(await h.use("downloads"), null);
  await assert.rejects(db.doc(PATH).get(), isCode("bridge_unavailable"));
  assert.equal(h.calls.length, 1);
});

test("only the native demo preference document may be read or written", async () => {
  const h = host(() => ok(null)), db = await h.use("db");
  for (const path of ["data/users/another/kitty", "data/users/native-demo/kitty/child", PATH + "/", "../kitty", null]) {
    assert.throws(() => db.doc(path), isCode("invalid_request"));
  }
  const snapshot = await db.doc(PATH).get();
  assert.equal(snapshot.exists, false);
  assert.equal(snapshot.data(), undefined);
  assert.deepEqual(h.calls, [{ method: "preferences.get", params: { path: PATH } }]);
});

test("preference snapshots return detached JSON data and set awaits the native confirmation", async () => {
  let resolveWrite;
  const h = host(({ method }) => method === "preferences.get" ? ok({ theme: "dark", hidden: ["one"] }) : new Promise((resolve) => { resolveWrite = resolve; }));
  const doc = (await h.use("db")).doc(PATH), snapshot = await doc.get();
  const changed = snapshot.data(); changed.hidden.push("two");
  assert.deepEqual(COPY(snapshot.data()), { theme: "dark", hidden: ["one"] });
  let finished = false;
  const pending = doc.set({ theme: "light", savedAt: 123 }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.deepEqual(h.calls[1], { method: "preferences.set", params: { path: PATH, value: { theme: "light", savedAt: 123 } } });
  resolveWrite({ ok: true, value: null }); await pending;
  assert.equal(finished, true);
});

test("invalid or oversized preferences never reach native storage", async () => {
  const h = host(() => ok(null)), doc = (await h.use("db")).doc(PATH);
  const cyclic = {}; cyclic.self = cyclic;
  const values = [[], null, { amount: NaN }, { callback: () => {} }, cyclic, JSON.parse('{"__proto__":{"owner":true}}'), { text: "é".repeat(530000) }];
  for (const value of values) await assert.rejects(doc.set(value), isCode("invalid_request"));
  assert.equal(h.calls.length, 0);
});

test("malformed native preference replies are not treated as saved or valid data", async () => {
  for (const reply of [{ ok: true }, { ok: "true", value: null }, null, { ok: true, value: [] }]) {
    const h = host(() => Promise.resolve(reply)), doc = (await h.use("db")).doc(PATH);
    await assert.rejects(doc.get());
  }
  const h = host(() => ok({ saved: true }));
  await assert.rejects((await h.use("db")).doc(PATH).set({ theme: "dark" }), isCode("invalid_response"));
});

test("exports retain the exact UTF-8 bytes including BOM, quotes, CRLF and Unicode", async () => {
  const h = host(() => ok({ status: "saved" }));
  const bytes = Buffer.from('\ufeffName,Note\r\n"Davies 🐱","one, two\r\nthree"\r\n');
  const result = await (await h.use("downloads")).save({ filename: "Kitty 🐱.csv", data: new Blob([bytes], { type: "text/csv" }) });
  assert.deepEqual(COPY(result), { status: "saved" });
  assert.deepEqual(h.calls, [{ method: "downloads.save", params: { filename: "Kitty 🐱.csv", mimeType: "text/csv", base64: bytes.toString("base64") } }]);
});

test("chunked binary base64 has no padding corruption and waits for the picker", async () => {
  let reply;
  const h = host(() => new Promise((resolve) => { reply = resolve; }));
  const bytes = Uint8Array.from({ length: 80003 }, (_, i) => i % 256);
  let finished = false;
  const pending = (await h.use("downloads")).save({ filename: "binary.dat", data: new Blob([bytes]) }).then(() => { finished = true; });
  while (!reply) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(h.calls[0].params.mimeType, "application/octet-stream");
  assert.deepEqual(Buffer.from(h.calls[0].params.base64, "base64"), Buffer.from(bytes));
  reply({ ok: true, value: { status: "saved" } }); await pending;
  assert.equal(finished, true);
});

test("cancelled and unconfirmed exports never resolve as saved", async () => {
  for (const [reply, code] of [
    [{ ok: false, error: { code: "cancelled", message: "Save cancelled." } }, "cancelled"],
    [{ ok: true, value: null }, "invalid_response"],
    [{ ok: true, value: { status: "presented" } }, "invalid_response"],
  ]) {
    const h = host(() => Promise.resolve(reply));
    await assert.rejects((await h.use("downloads")).save({ filename: "rows.csv", data: new Blob(["rows"]) }), isCode(code));
    assert.equal(h.calls.length, 1);
  }
});

test("oversized exports and unsafe filenames fail before native dispatch", async () => {
  const h = host(() => ok({ status: "saved" })), downloads = await h.use("downloads");
  for (const filename of ["", "../rows.csv", ".hidden", "folder/rows.csv", "folder\\rows.csv", "bad:name", "bad\nname", "猫".repeat(61)]) {
    await assert.rejects(downloads.save({ filename, data: new Blob(["x"]) }), isCode("invalid_request"));
  }
  await assert.rejects(downloads.save({ filename: "too-large.csv", data: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) }), isCode("invalid_request"));
  assert.equal(h.calls.length, 0);
});

test("an export at the exact decoded-byte ceiling is accepted", async () => {
  const h = host(() => ok({ status: "saved" }));
  await (await h.use("downloads")).save({ filename: "limit.dat", data: new Blob([new Uint8Array(10 * 1024 * 1024)]) });
  assert.equal(Buffer.from(h.calls[0].params.base64, "base64").byteLength, 10 * 1024 * 1024);
});

test("native routes are allowlisted and the latest pre-ready intent is queued", () => {
  const h = host(), routes = [];
  h.document.addEventListener("kitty:native-route", (event) => routes.push(event.detail.route));
  assert.equal(h.window.KittyNative.ready, false);
  assert.equal(h.window.KittyNative.openRoute("home"), true);
  assert.equal(h.window.KittyNative.openRoute("review"), true);
  for (const route of ["javascript:alert(1)", "entry:T0001", "../setup", "Home", "goals:save", { route: "home" }]) assert.equal(h.window.KittyNative.openRoute(route), false);
  assert.deepEqual(routes, []);
  h.document.dispatchEvent(new CustomEvent("kitty:app-ready"));
  assert.equal(h.window.KittyNative.ready, true);
  assert.equal(h.attributes.get("data-kitty-ready"), "true");
  assert.deepEqual(routes, ["review"]);
  for (const route of ["activity", "insights", "goals", "setup"]) assert.equal(h.window.KittyNative.openRoute(route), true);
  assert.deepEqual(routes, ["review", "activity", "insights", "goals", "setup"]);
});

test("native text scale changes font adjustment, never page zoom", () => {
  const h = host(), events = [];
  h.document.addEventListener("kitty:native-environment", (event) => events.push(COPY(event.detail)));
  h.window.KittyNative.receiveEnvironment({ textScale: 1.35, reduceMotion: true });
  assert.equal(h.styles.get("--kitty-native-text-size"), "135%");
  assert.equal(h.attributes.get("data-kitty-reduce-motion"), "true");
  assert.deepEqual(events[0], { textScale: 1.35, reduceMotion: true });
  h.window.KittyNative.receiveEnvironment({ textScale: Infinity, reduceMotion: "false" });
  assert.equal(h.styles.get("--kitty-native-text-size"), "135%");
  h.window.KittyNative.receiveEnvironment({ textScale: 99 });
  assert.equal(h.styles.get("--kitty-native-text-size"), "320%");
  assert.equal(h.styles.has("zoom"), false);
  assert.equal(h.styles.has("transform"), false);
});

test("system reduced motion remains effective and changes propagate", () => {
  const h = host(undefined, { reduced: true });
  h.window.KittyNative.receiveEnvironment({ reduceMotion: false });
  assert.equal(h.window.KittyNative.environment.reduceMotion, true);
  h.media.matches = false; h.media.dispatchEvent(new Event("change"));
  assert.equal(h.window.KittyNative.environment.reduceMotion, false);
  assert.equal(h.attributes.get("data-kitty-reduce-motion"), "false");
});

test("bank review binds a private editable session and dispatches only its opaque ticket", async () => {
  const sheetID="fictional_private_sheet_00001", sourceID="a".repeat(64), session="80454d6f-fde5-4fc1-8361-accdd7c9ce50";
  const descriptor={sheetID,session,sheetVersion:2,preferenceID:"native-"+"b".repeat(64),title:"Practice",canEdit:true,canImportBankFiles:true};
  const metadata={sourceID,name:"proof.csv",byteLength:149,mimeType:"text/csv",account:"ACC-CC",month:"2027-01",downloadDay:"2027-01-31"};
  const h=host(({method})=>ok(method==="google.open"?descriptor:method==="files.bank-preview"?{mode:"confirm",ticket:"opaque"}:{status:"verified"}));
  await h.window.KittyNative.google.open(sheetID);
  const files=h.window.KittyNative.files;
  await assert.rejects(files.previewBank({...metadata,text:"edited rows"}),isCode("invalid_request"));
  await assert.rejects(files.commitBank({bytes:"replacement"}),isCode("invalid_request"));
  await files.previewBank(metadata);await files.commitBank("opaque");
  assert.deepEqual(h.calls.at(-2),{method:"files.bank-preview",params:{session,sheetID,...metadata}});
  assert.deepEqual(h.calls.at(-1),{method:"files.bank-commit",params:{session,sheetID,ticket:"opaque"}});
  await files.outstandingBank();
  assert.deepEqual(h.calls.at(-1),{method:"files.bank-status",params:{session,sheetID}});
  await h.window.KittyNative.google.close();
  await assert.rejects(files.outstandingBank(),isCode("not_granted"));
  await assert.rejects(files.cancelBank("opaque"),isCode("not_granted"));
  for(const override of [{canEdit:false},{canImportBankFiles:false}, {canImportBankFiles:undefined}]){
    const denied=host(()=>ok({...descriptor,...override}));await denied.window.KittyNative.google.open(sheetID);
    await assert.rejects(denied.window.KittyNative.files.previewBank(metadata),isCode("not_granted"));
    assert.equal(denied.calls.filter(c=>c.method==="files.bank-preview").length,0);
  }
});
