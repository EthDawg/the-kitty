/* The native demo host. The page uses the same five capabilities as its artifact
   host; absent capabilities stay absent. Swift owns storage, the save picker and
   the trusted-main-frame check. No Google/AI permission is implied by this shim. */
(function (root) {
  "use strict";
  const PREF_PATH = "data/users/native-demo/kitty";
  const PREF_LIMIT = 1024 * 1024, EXPORT_LIMIT = 10 * 1024 * 1024;
  const ROUTES = new Set(["home", "activity", "review", "insights", "goals", "setup"]);
  const doc = root.document;
  let bridgeFailed = false, ready = false, queuedRoute = null;
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
    id: async () => "native-demo",
  });
  const db = Object.freeze({
    doc(path) {
      if (path !== PREF_PATH) throw failure("invalid_request", "Only this demo's preference document is available.");
      return Object.freeze({
        async get() {
          const value = await rpc("preferences.get", { path });
          const data = value === null ? null : preferenceCopy(value);
          return Object.freeze({ exists: data !== null, data: () => data === null ? undefined : preferenceCopy(data) });
        },
        async set(value) {
          const result = await rpc("preferences.set", { path, value: preferenceCopy(value) });
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
  root.claude = Object.freeze({
    async use(name) {
      if (!bridge()) return null;
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
  root.KittyNative = Object.freeze({
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
