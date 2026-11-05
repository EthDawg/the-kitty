/* The native demo host. The page uses the same five capabilities as its artifact
   host; absent capabilities stay absent. Swift owns storage, the save picker and
   the trusted-main-frame check. No Google/AI permission is implied by this shim. */
(function (root) {
  "use strict";
  const PREF_PATH = "data/users/native-demo/kitty";
  const PREF_LIMIT = 1024 * 1024, EXPORT_LIMIT = 10 * 1024 * 1024;
  const ROUTES = new Set(["home", "activity", "review", "insights", "goals", "setup"]);
  const doc = root.document;
  let bridgeFailed = false, ready = false, queuedRoute = null, activeGoogle = null;
  let textScale = 1, nativeReduceMotion = false;
  const motionQuery = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  root.KITTY_HOST = "native";
  doc.documentElement.setAttribute("data-kitty-host", "native");

  function failure(code, message) { const error = new Error(message); error.code = code; return error; }
  function bridge() {
    const handler = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.kitty;
    return !bridgeFailed && root.top === root && handler && typeof handler.postMessage === "function" ? handler : null;
  }
  async function rpc(method, params) {
    const handler = bridge();
    if (!handler) throw failure("bridge_unavailable", "This native capability is unavailable. Nothing is confirmed saved.");
    let pending;
    try { pending = handler.postMessage({ method, params }); }
    catch (_) { throw failure("bridge_unavailable", "The native request could not be sent. Nothing is confirmed saved."); }
    // WKScriptMessageHandlerWithReply returns a Promise. An old fire-and-forget
    // handler cannot acknowledge a durable save, and must never fabricate one.
    if (!pending || typeof pending.then !== "function") {
      bridgeFailed = true;
      throw failure("bridge_unavailable", "The native host cannot confirm this request.");
    }
    let reply;
    try { reply = await pending; }
    catch (_) { throw failure("bridge_unavailable", "The native reply was interrupted. Nothing is confirmed saved."); }
    if (reply && reply.ok === true && Object.prototype.hasOwnProperty.call(reply, "value")) return reply.value;
    if (reply && reply.ok === false && reply.error && typeof reply.error.code === "string" && typeof reply.error.message === "string") {
      throw failure(reply.error.code.slice(0, 100), reply.error.message.slice(0, 1000));
    }
    throw failure("invalid_response", "The native reply did not confirm the requested action.");
  }
  function plain(value) { return value !== null && Object.prototype.toString.call(value) === "[object Object]"; }
  function preferenceCopy(value) {
    if (!plain(value)) throw failure("invalid_request", "Preferences must be a plain JSON object.");
    const ancestors = new Set(); let nodes = 0;
    function valid(item, depth) {
      if (++nodes > 20000 || depth > 32) throw failure("invalid_request", "The preferences are too complex to save.");
      if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) return;
      if ((!Array.isArray(item) && !plain(item)) || ancestors.has(item)) throw failure("invalid_request", "Preferences must contain JSON values without cycles.");
      ancestors.add(item);
      for (const key of Object.keys(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw failure("invalid_request", "The preference key is not supported.");
        valid(item[key], depth + 1);
      }
      ancestors.delete(item);
    }
    valid(value, 0);
    const json = JSON.stringify(value);
    if (new root.TextEncoder().encode(json).byteLength > PREF_LIMIT) throw failure("invalid_request", "Preferences exceed the 1 MiB limit.");
    return JSON.parse(json);
  }
  const user = Object.freeze({
    isOwner: async () => false,
    me: async () => ({ name: "" }),
    id: async () => activeGoogle?.preferenceID || "native-demo",
  });
  const db = Object.freeze({
    doc(path) {
      const session = activeGoogle?.session, binding = session ? { session } : {};
      if (path !== (session ? "data/users/" + activeGoogle.preferenceID + "/kitty" : PREF_PATH)) throw failure("invalid_request", "Only this session's preference document is available.");
      const check = () => { if (session !== activeGoogle?.session) throw failure("stale_session", "The selected Sheet changed."); };
      return Object.freeze({
        async get() {
          check(); const value = await rpc("preferences.get", { path, ...binding }); check();
          const data = value === null ? null : preferenceCopy(value);
          return Object.freeze({ exists: data !== null, data: () => data === null ? undefined : preferenceCopy(data) });
        },
        async set(value) {
          check(); const result = await rpc("preferences.set", { path, ...binding, value: preferenceCopy(value) }); check();
          if (result !== null) throw failure("invalid_response", "Preference storage was not confirmed.");
        },
      });
    },
  });
  function base64(bytes) {
    // Each non-final chunk is a multiple of three, so concatenating its base64
    // adds no padding in the middle and avoids spreading a 10 MiB array at once.
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 24576) chunks.push(root.btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 24576))));
    return chunks.join("");
  }
  const downloads = Object.freeze({
    async save(request) {
      if (!request || typeof request.filename !== "string" || !request.filename.trim()
        || new root.TextEncoder().encode(request.filename).byteLength > 180
        || /^[.]/.test(request.filename) || /[\\/:\u0000-\u001f\u007f]/.test(request.filename)
        || !(request.data instanceof root.Blob)) throw failure("invalid_request", "Choose a valid filename and a file to save.");
      const blob = request.data;
      if (blob.size > EXPORT_LIMIT) throw failure("invalid_request", "The file exceeds the 10 MiB export limit.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== blob.size || bytes.byteLength > EXPORT_LIMIT) throw failure("invalid_request", "The export bytes do not match the file.");
      const result = await rpc("downloads.save", { filename: request.filename, mimeType: blob.type || "application/octet-stream", base64: base64(bytes) });
      if (!result || result.status !== "saved") throw failure("invalid_response", "The native host has not confirmed that this file was saved.");
      return { status: "saved" };
    },
  });
  const capabilities = Object.freeze({ mcp: null, sample: null, user, db, downloads });
  function sheets(session) {
    const categoryRPC = async (method, request = {}) => {
      if (activeGoogle?.session !== session) throw failure("stale_session", "Open the selected Sheet again.");
      const result = await rpc(method, { session, server:"Google Sheets", input:{ ...request, spreadsheetId:activeGoogle.sheetID } });
      if (activeGoogle?.session !== session) throw failure("stale_session", "The selected Sheet changed.");
      return result;
    };
    return Object.freeze({
      pendingCategory: () => categoryRPC("sheets.category-pending"),
      async saveCategory(entry, old, category) {
        if (activeGoogle?.canEdit !== true) throw failure("not_granted", "This Sheet is read-only.");
        const id = activeGoogle.sheetID, plan = await categoryRPC("sheets.category-plan", {entry, old, category});
        if (!plan || plan.entry !== entry || plan.category !== category || !Array.isArray(plan.decision) ||
            plan.decision.length !== 8 || !/^Entries!H[1-9][0-9]*$/.test(plan.cell) || !/^Decisions!A[1-9][0-9]*:H$/.test(plan.table)) {
          throw failure("invalid_response", "The category write plan did not match your choice.");
        }
        await this.callTool("Google Sheets", "update_values", {spreadsheetId:id, range:plan.cell, values:[[category]]});
        await this.callTool("Google Sheets", "append_values", {spreadsheetId:id, range:plan.table, values:[plan.decision]});
        return { decisionID:plan.decision[0], entry, category };
      },
      async callTool(server, tool, input) {
        if (activeGoogle?.session !== session || server !== "Google Sheets" || !plain(input) ||
            input.spreadsheetId !== activeGoogle.sheetID) throw failure("not_granted", "Only the selected Sheet is available.");
        const result = await rpc("sheets.call", { session, server, tool, input });
        if (activeGoogle?.session !== session) throw failure("stale_session", "The selected Sheet changed.");
        return result;
      },
      async invalidate() { /* Native reads are always fresh. */ }
    });
  }
  root.claude = Object.freeze({
    async use(name) {
      if (!bridge()) return null;
      if (name === "mcp" && activeGoogle) return sheets(activeGoogle.session);
      return Object.prototype.hasOwnProperty.call(capabilities, name) ? capabilities[name] : null;
    },
  });

  function environment() { return Object.freeze({ textScale, reduceMotion: nativeReduceMotion || !!(motionQuery && motionQuery.matches) }); }
  function applyEnvironment() {
    const value = environment();
    doc.documentElement.style.setProperty("--kitty-native-text-size", Number((textScale * 100).toFixed(2)) + "%");
    // Compact navigation follows the system tab-bar convention. Reading content
    // scales fully; already-large monetary displays retain a readable line length.
    doc.documentElement.style.setProperty("--kitty-native-control-size", Number((Math.min(textScale, 1.4) * 100).toFixed(2)) + "%");
    doc.documentElement.style.setProperty("--kitty-native-display-size", Number((Math.min(textScale, 1.4) * 100).toFixed(2)) + "%");
    doc.documentElement.setAttribute("data-kitty-large-text", String(textScale > 1.35));
    doc.documentElement.setAttribute("data-kitty-reduce-motion", String(value.reduceMotion));
    doc.dispatchEvent(new root.CustomEvent("kitty:native-environment", { detail: value }));
    return value;
  }
  function route(routeName) {
    doc.dispatchEvent(new root.CustomEvent("kitty:native-route", { detail: { route: routeName } }));
  }
  async function askRPC(method, params = {}) {
    const session=activeGoogle?.session, value=await rpc(method, {...params, ...(session?{session}:{})});
    if(session!==activeGoogle?.session) throw failure("stale_session","The selected Sheet changed.");
    return value;
  }
  root.KittyNative = Object.freeze({
    ask: Object.freeze({share:text=>askRPC("ask.share",{text})}),
    icon: Object.freeze({status: () => rpc("icon.status", {}), select: alternate => rpc("icon.set", {alternate})}),
    privacy: Object.freeze({setEnabled:enabled => rpc("privacy.set",{enabled:enabled === true})}),
    google: Object.freeze({
      status: () => rpc("google.status", {}),
      select: (sheetID) => { activeGoogle = null; return rpc("google.choose", { sheetID }); },
      async open(sheetID) {
        activeGoogle = null;
        const v = await rpc("google.open", { sheetID });
        if (!v || v.sheetID !== sheetID || v.sheetVersion !== 2 || typeof v.canEdit !== "boolean" ||
            !/^native-[0-9a-f]{64}$/.test(v.preferenceID || "") ||
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v.session || "")) {
          throw failure("invalid_response", "The selected Sheet could not be opened.");
        }
        activeGoogle = Object.freeze({ ...v }); return activeGoogle;
      },
      close: () => { activeGoogle = null; return rpc("google.close", {}); },
      disconnect: () => { activeGoogle = null; return rpc("google.disconnect", {}); }
    }),
    files: Object.freeze({pick: () => rpc("files.open", activeGoogle ? {session:activeGoogle.session} : {})}),
    get ready() { return ready; },
    get environment() { return environment(); },
    receiveEnvironment(value) {
      if (plain(value)) {
        if (typeof value.textScale === "number" && Number.isFinite(value.textScale)) textScale = Math.min(3.2, Math.max(0.8, value.textScale));
        if (typeof value.reduceMotion === "boolean") nativeReduceMotion = value.reduceMotion;
      }
      return applyEnvironment();
    },
    openRoute(value) {
      if (typeof value !== "string" || !ROUTES.has(value)) return false;
      if (ready) route(value); else queuedRoute = value; // Latest intent wins; no unbounded pre-boot queue.
      return true;
    },
  });
  doc.addEventListener("kitty:app-ready", () => {
    ready = true;
    doc.documentElement.setAttribute("data-kitty-ready", "true");
    if (queuedRoute !== null) { const next = queuedRoute; queuedRoute = null; route(next); }
  });
  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener("change", applyEnvironment);
  applyEnvironment();
})(window);
