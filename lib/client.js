window.__ModuleLoader__.load({id:'dsh-redteam',factory:(require)=>{const module={exports:{}};"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client-entry.ts
var client_entry_exports = {};
__export(client_entry_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_entry_exports);

// src/client.ts
var import_react = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client-data.ts
var nodeKinds = ["asset", "intent", "fact", "finding", "evidence"];
var kindLabels = { asset: "\u8D44\u4EA7", intent: "\u610F\u56FE", fact: "\u4E8B\u5B9E", finding: "\u53D1\u73B0", evidence: "\u8BC1\u636E" };
function matchesQuery(values, query) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}
function filterTask(rows, taskId) {
  return taskId ? rows.filter((row) => row.taskId === taskId) : rows;
}
function layoutGraph(nodes) {
  const columns = nodeKinds.filter((kind) => nodes.some((node) => node.kind === kind));
  const counts = /* @__PURE__ */ new Map();
  const positions = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const row = counts.get(node.kind) ?? 0;
    positions.set(node.id, { x: 18 + columns.indexOf(node.kind) * 200, y: 42 + row * 66 });
    counts.set(node.kind, row + 1);
  }
  return { columns, positions, width: Math.max(220, columns.length * 200 + 18), height: Math.max(124, ...[...counts.values()].map((count) => count * 66 + 56)) };
}
function graphRelations(snapshot, node) {
  const nodes = new Map(snapshot.nodes.filter((item) => item.taskId === node.taskId).map((item) => [item.id, item]));
  return snapshot.edges.filter((edge) => edge.taskId === node.taskId && (edge.from === node.id || edge.to === node.id)).map((edge) => ({
    edge,
    direction: edge.from === node.id ? "out" : "in",
    node: nodes.get(edge.from === node.id ? edge.to : edge.from),
    targetId: edge.from === node.id ? edge.to : edge.from
  }));
}
function graphRecord(snapshot, node) {
  const rows = node.kind === "asset" ? snapshot.assets : node.kind === "intent" ? snapshot.intents : node.kind === "finding" ? snapshot.findings : node.kind === "evidence" ? snapshot.evidence : [];
  return rows.find((row) => row.id === node.id && row.taskId === node.taskId) ?? node.data;
}

// src/client-styles.ts
var redteamStyles = `
.rt-panel{box-sizing:border-box;container-type:inline-size;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#252525);font:var(--dsw-font-xxs-12,12px/1.5 system-ui);color-scheme:inherit}
.rt-panel *{box-sizing:border-box}.rt-panel button,.rt-panel input,.rt-panel select{font:inherit;color:inherit}
.rt-head{display:flex;align-items:center;gap:8px;padding:10px 12px;min-height:40px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6)}
.rt-head strong{flex:1}.rt-muted{color:var(--dsw-alias-label-secondary,#737373)}.rt-small{font-size:11px}.rt-grow{flex:1;min-width:0}
.rt-controls{padding:8px 12px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6)}
.rt-input,.rt-select{min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l3,#d7d7d7);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1,#fff)}
.rt-select{max-width:100%;flex:1 1 130px}.rt-input{flex:1 1 160px}.rt-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l3,#d7d7d7);border-radius:var(--dsw-radius-sm,6px);background:transparent;cursor:pointer}
.rt-button:hover,.rt-row:hover{background:var(--dsw-alias-interactive-bg-hover,#f5f5f5)}.rt-button:disabled{opacity:.4;cursor:default}
.rt-panel :is(button,input,select,summary,[role=button]):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}
.rt-scroll{overflow:auto;flex:1;min-height:0;padding:10px 12px}.rt-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-secondary,#737373)}
.rt-error{padding:8px 12px;background:var(--dsw-alias-interactive-bg-hover,#f5f5f5);color:var(--dsw-alias-state-error-primary,#c44);border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6)}
.rt-card{border:1px solid var(--dsw-alias-border-l1,#e6e6e6);border-radius:var(--dsw-radius-md,8px);margin-bottom:8px;overflow:hidden}.rt-card>summary{padding:10px;cursor:pointer;overflow-wrap:anywhere}.rt-card[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6)}
.rt-card-body{padding:10px;overflow-wrap:anywhere}.rt-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.rt-scope-card{background:var(--dsw-alias-bg-layer-1,#fafafa)}.rt-stack{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rt-badge{flex:none}
.rt-graph-summary{display:flex;align-items:center;flex-wrap:wrap;gap:5px;padding:2px 0 6px;color:var(--dsw-alias-label-secondary,#737373);font-size:11px;font-variant-numeric:tabular-nums}
.rt-pre{font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:440px;margin:8px 0 0;background:var(--dsw-alias-interactive-bg-hover,#f5f5f5);padding:8px;border-radius:4px}
.rt-label{margin:12px 0 5px;font-weight:600}.rt-row{display:block;width:100%;text-align:left;border:0;border-radius:4px;background:transparent;padding:6px;cursor:pointer;overflow-wrap:anywhere}.rt-divider{height:1px;background:var(--dsw-alias-border-l1,#e6e6e6);margin:10px 0}
.rt-graph{overflow:auto;max-height:420px;border:1px solid var(--dsw-alias-border-l1,#e6e6e6);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,#fafafa);margin:8px 0;overscroll-behavior:contain;scrollbar-gutter:stable}.rt-graph-legend{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding:7px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e6e6);background:var(--dsw-alias-bg-base,#fff)}.rt-graph-legend .rt-badge{font-size:10px}.rt-graph svg{display:block;min-width:420px;max-width:none;height:auto}
.rt-node{cursor:pointer;outline:none}.rt-node rect{fill:var(--dsw-alias-bg-base,#fff);stroke:var(--dsw-alias-border-l3,#ccc)}.rt-node:hover rect,.rt-node:focus-visible rect{fill:var(--dsw-alias-interactive-bg-hover,#f5f5f5)}.rt-node[aria-pressed=true] rect{stroke:var(--dsw-alias-state-business-primary,#4d6bfe);stroke-width:2}.rt-node text{fill:var(--dsw-alias-label-primary,#252525);pointer-events:none}.rt-node .rt-node-kind{fill:var(--dsw-alias-label-secondary,#737373);font-size:10px}.rt-edge{stroke:var(--dsw-alias-border-l3,#bbb);fill:none}.rt-edge[data-active=true]{stroke:var(--dsw-alias-state-business-primary,#4d6bfe);stroke-width:2}
.rt-edge-label{fill:var(--dsw-alias-label-secondary,#737373);font-size:9px;text-anchor:middle;paint-order:stroke;stroke:var(--dsw-alias-bg-layer-1,#fafafa);stroke-width:3px;stroke-linejoin:round;pointer-events:none}.rt-edge[data-active=true]+.rt-edge-label{fill:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
.rt-detail{border-top:1px solid var(--dsw-alias-border-l1,#e6e6e6);padding-top:10px}.rt-detail h3{font-size:13px;margin:5px 0;overflow-wrap:anywhere}.rt-kv{display:grid;grid-template-columns:70px 1fr;gap:4px 8px;margin:8px 0}.rt-kv dt{color:var(--dsw-alias-label-secondary,#737373)}.rt-kv dd{margin:0;overflow-wrap:anywhere}.rt-pagination{display:flex;gap:8px;align-items:center;justify-content:space-between;padding-top:4px}.rt-report{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}
@container (max-width:420px){.rt-controls{padding-inline:10px}.rt-scroll{padding-inline:10px}.rt-graph-summary{padding-bottom:4px}.rt-graph{max-height:360px}}
@container (max-width:360px){.rt-head{align-items:flex-start;flex-wrap:wrap}.rt-head strong{flex-basis:100%}.rt-button{flex:1 1 auto}.rt-kv{grid-template-columns:1fr}.rt-kv dd{margin-bottom:4px}}
@media (prefers-reduced-motion:reduce){.rt-panel *{scroll-behavior:auto}}
`;

// src/client-deeplink.ts
var navigation = { findingId: "", revision: 0 };
var listeners = /* @__PURE__ */ new Set();
var readFindingNavigation = () => navigation;
function subscribeFindingNavigation(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function installFindingDeepLink(sidebar) {
  if (typeof window === "undefined" || !window.location) return () => {
  };
  let pending = false;
  const open = () => {
    if (!pending || !sidebar.getSnapshot().sessionId) return;
    pending = false;
    sidebar.openTab({ type: "dsh-redteam:findings", target: "right", reveal: true, meta: { findingId: navigation.findingId } });
  };
  const navigate = () => {
    const findingId = new URLSearchParams(window.location.search).get("redteamFinding")?.trim() ?? "";
    navigation = { findingId, revision: navigation.revision + 1 };
    listeners.forEach((listener) => listener());
    pending = Boolean(findingId);
    open();
  };
  const hasTarget = () => new URLSearchParams(window.location.search).has("redteamFinding");
  let unsubscribe;
  const follow = () => {
    if (hasTarget() && !unsubscribe) unsubscribe = sidebar.subscribeState(open);
    navigate();
  };
  window.addEventListener("popstate", follow);
  if (hasTarget()) follow();
  return () => {
    window.removeEventListener("popstate", follow);
    unsubscribe?.();
  };
}

// src/task-workspace/styles.ts
var taskWorkspaceStyles = `
.tw-root{container-type:inline-size;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12,12px/1.5 system-ui);color-scheme:inherit}
.tw-root *{box-sizing:border-box}.tw-root h2,.tw-root h3,.tw-root p{margin:0}.tw-root h2{font-size:15px;font-weight:600}.tw-root h3{font-size:13px;font-weight:600}
.tw-root a{color:var(--dsw-alias-state-business-primary);text-decoration:none}.tw-root a:hover{text-decoration:underline}.tw-root a:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.tw-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tw-toolbar,.tw-actions,.tw-inline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tw-toolbar{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tw-scroll{flex:1;min-height:0;overflow:auto;padding:12px;scrollbar-gutter:stable}.tw-stack{display:flex;flex-direction:column;gap:12px}.tw-gap{display:flex;flex-direction:column;gap:6px}.tw-grow{flex:1;min-width:0}
.tw-muted{color:var(--dsw-alias-label-secondary)}.tw-small{font-size:11px}.tw-title{overflow-wrap:anywhere}.tw-description{white-space:pre-wrap;overflow-wrap:anywhere}
.tw-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);padding:10px}.tw-card-selected{border-color:var(--dsw-alias-state-business-primary)}
.tw-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.tw-task-button{flex:1;min-width:0;justify-content:flex-start!important;text-align:left!important;white-space:normal!important;height:auto!important;min-height:32px;overflow-wrap:anywhere}
.tw-field{display:flex;flex-direction:column;gap:5px;min-width:0}.tw-field>span{font-weight:500}.tw-field input,.tw-field select,.tw-field textarea{width:100%}.tw-field small{color:var(--dsw-alias-label-secondary)}
.tw-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tw-full{grid-column:1/-1}.tw-root textarea,.tw-root select,.tw-root input:not([type=checkbox]):not([type=radio]):not([type=file]){font:inherit;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);padding:7px 8px;min-width:0}.tw-root textarea{resize:vertical;min-height:78px;line-height:1.6}.tw-root select,.tw-root input:not([type=checkbox]):not([type=radio]):not([type=file]){min-height:30px;max-width:100%}.tw-root :is(textarea,select,input:not([type=checkbox]):not([type=radio]):not([type=file])):focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.tw-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 12px;margin:0}.tw-kv dt{color:var(--dsw-alias-label-secondary)}.tw-kv dd{margin:0;overflow-wrap:anywhere;text-align:right}
.tw-notice{padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}.tw-notice[role=alert]{color:var(--dsw-alias-state-error-primary)}
.tw-empty{padding:28px 12px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--dsw-alias-label-secondary)}
.tw-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.tw-record{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.tw-record:last-child{border-bottom:0}.tw-row-content{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.tw-order{font-variant-numeric:tabular-nums;min-width:20px;color:var(--dsw-alias-label-secondary)}.tw-root fieldset{border:0;padding:0;margin:0;min-width:0}.tw-root fieldset:disabled{opacity:.65}.tw-root details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);padding:4px 0}.tw-root details[open]>summary{margin-bottom:8px}
@container (max-width:360px){.tw-grid{grid-template-columns:1fr}.tw-full{grid-column:auto}}
@media (max-width:420px){.tw-grid{grid-template-columns:1fr}.tw-full{grid-column:auto}.tw-top,.tw-scroll{padding:10px}.tw-toolbar{padding:8px 10px}}
`;

// src/management-ui/shared.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function apiUrl(path, query) {
  const base = new URL(document.baseURI);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const url = new URL(path.replace(/^\/+/, ""), base);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== void 0 && value !== null) url.searchParams.set(key, String(value));
  return url;
}
async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path instanceof URL ? path : apiUrl(path), { credentials: "same-origin", cache: "no-store", ...init, headers });
  if (response.status === 204 && response.ok) return void 0;
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`\u5BBF\u4E3B\u672A\u8FD4\u56DE JSON\uFF08HTTP ${response.status}\uFF09\uFF0C\u8BF7\u68C0\u67E5\u63D2\u4EF6\u8DEF\u7531\u662F\u5426\u5DF2\u542F\u7528\u3002`);
  }
  if (!response.ok) throw new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  return value;
}
var errorMessage = (failure) => failure instanceof Error ? failure.message : String(failure);
var managementStyles = `
.mg-root pre{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;line-height:1.6;background:var(--dsw-alias-bg-layer-1);padding:9px;border-radius:var(--dsw-radius-sm,6px);margin:0}
.mg-root table{width:100%;border-collapse:collapse;font:inherit}.mg-root th,.mg-root td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere}.mg-root th{color:var(--dsw-alias-label-secondary);font-weight:500}.mg-table{overflow:auto}
.mg-root label{min-width:0}.mg-root .tw-toolbar>select{flex:1;min-width:110px}.mg-root .tw-field textarea{min-height:100px}.mg-root .tw-actions{row-gap:8px}.mg-root input[type=file]{max-width:100%;font:inherit}
.mg-list{display:flex;flex-direction:column;gap:8px}.mg-meta{display:flex;gap:5px 12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11px}.mg-code{font-family:ui-monospace,monospace}.mg-root a{color:var(--dsw-alias-state-business-primary)}
`;
function ManagementPage({ title, description, actions, toolbar, loading, error, notice, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tw-root mg-root", "aria-label": title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: taskWorkspaceStyles + managementStyles }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "tw-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tw-grow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: title }),
        description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tw-muted tw-small", children: description })
      ] }),
      actions
    ] }),
    toolbar && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tw-toolbar", children: toolbar }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { tone: "error", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, { tone: "success", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tw-scroll", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tw-stack", children: [
      loading && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", className: "tw-muted", children: "\u6B63\u5728\u52A0\u8F7D\u2026" }),
      children
    ] }) })
  ] });
}
function Notice({ tone = "info", children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tw-notice", role: tone === "error" ? "alert" : "status", children });
}
function Field({ label: label2, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "tw-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label2 }),
    children,
    hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: hint })
  ] });
}
function JsonDetails({ value, summary = "\u67E5\u770B\u8BE6\u7EC6\u6570\u636E", open = false }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { open, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: summary }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: JSON.stringify(value, null, 2) })
  ] });
}

// src/client.ts
var e = import_react.default.createElement;
var emptySnapshot = { notificationSettings: {}, assetInterceptRules: [], taskCategories: [], taskTemplates: [], taskAssetRules: [], version: 0, tasks: [], assets: [], nodes: [], edges: [], intents: [], findings: [], evidence: [], traces: [], approvals: [], goals: [], constraints: [], scopes: [], traffic: [], interceptRules: [], archives: [], reports: [], notificationChannels: [], notificationEvents: [], notificationDeliveries: [], companies: [] };
var liveSnapshot = emptySnapshot;
var connection = { loaded: false, error: "" };
var selectedTask = "";
var snapshotListeners = /* @__PURE__ */ new Set();
var selectionListeners = /* @__PURE__ */ new Set();
var connectionListeners = /* @__PURE__ */ new Set();
function setLiveSnapshot(snapshot) {
  liveSnapshot = snapshot;
  snapshotListeners.forEach((listener) => listener());
}
var subscribeSnapshot = (listener) => {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
};
var subscribeConnection = (listener) => {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
};
var subscribeSelection = (listener) => {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
};
var readSnapshot = () => liveSnapshot;
var readConnection = () => connection;
var readSelection = () => selectedTask;
function changeConnection(next) {
  connection = next;
  connectionListeners.forEach((listener) => listener());
}
function selectTask(value) {
  selectedTask = value;
  selectionListeners.forEach((listener) => listener());
}
var pollUsers = 0;
var pollAbort;
var pollTimer;
function startPolling() {
  pollUsers++;
  if (pollUsers === 1) {
    const controller = new AbortController();
    pollAbort = controller;
    const refresh = async () => {
      try {
        const response = await fetch(apiUrl("/api/redteam/snapshot"), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json();
        if (!controller.signal.aborted) {
          setLiveSnapshot(snapshot);
          changeConnection({ loaded: true, error: "" });
        }
      } catch (error) {
        if (!controller.signal.aborted) changeConnection({ loaded: connection.loaded, error: error instanceof Error ? error.message : String(error) });
      } finally {
        if (!controller.signal.aborted) pollTimer = setTimeout(() => {
          void refresh();
        }, 1500);
      }
    };
    void refresh();
  }
  return () => {
    if (--pollUsers === 0) {
      pollAbort?.abort();
      clearTimeout(pollTimer);
    }
  };
}
function useWorkspace(props) {
  const snapshot = import_react.default.useSyncExternalStore(subscribeSnapshot, readSnapshot, readSnapshot);
  const status = import_react.default.useSyncExternalStore(subscribeConnection, readConnection, readConnection);
  const taskId = import_react.default.useSyncExternalStore(subscribeSelection, readSelection, readSelection);
  import_react.default.useEffect(() => props.visible === false ? void 0 : startPolling(), [props.visible]);
  const initial = props.tab.meta?.snapshot;
  const value = connection.loaded ? snapshot : initial ?? snapshot;
  return { snapshot: value, status, taskId: value.tasks.some((task) => task.id === taskId) ? taskId : "" };
}
function badgeTone(tone) {
  if (tone === "critical" || tone === "high" || tone === "error" || tone === "failed" || tone === "timeout") return "danger";
  if (tone === "medium" || tone === "warning" || tone === "paused") return "warning";
  if (tone === "done" || tone === "success") return "success";
  if (tone === "running" || tone === "info") return "info";
  return "neutral";
}
function Badge({ children, tone }) {
  return e("span", { className: "rt-badge", "data-tone": tone }, children);
}
function GraphBadge({ children, tone }) {
  return e("span", { className: "rt-badge", "data-tone": badgeTone(tone) }, children);
}
function Json({ value }) {
  return e("pre", { className: "rt-pre" }, JSON.stringify(value, null, 2));
}
function Empty({ children }) {
  return e("div", { className: "rt-empty" }, children);
}
function Panel({ title, count, workspace: workspace2, query, onQuery, children, controls }) {
  const { snapshot, status, taskId } = workspace2;
  return e(
    "section",
    { className: "rt-panel", "aria-label": title },
    e("style", null, redteamStyles),
    e("header", { className: "rt-head" }, e("strong", null, title), e("span", { className: "rt-muted rt-small" }, `${count} \u9879`)),
    status.error && e("div", { className: "rt-error", role: "status" }, `\u540C\u6B65\u5931\u8D25\uFF1A${status.error}\u3002\u4FDD\u7559\u4E0A\u6B21\u6570\u636E\uFF0C\u6B63\u5728\u91CD\u8BD5\u3002`),
    e(
      "div",
      { className: "rt-controls" },
      e(
        "select",
        { className: "rt-select", "aria-label": "\u7B5B\u9009\u4EFB\u52A1", value: taskId, onChange: (event) => selectTask(event.target.value) },
        e("option", { value: "" }, "\u5168\u90E8\u4EFB\u52A1"),
        snapshot.tasks.map((task) => e("option", { key: task.id, value: task.id }, task.title))
      ),
      e("input", { className: "rt-input", type: "search", "aria-label": `\u641C\u7D22${title}`, placeholder: `\u641C\u7D22${title}\u2026`, value: query, onChange: (event) => onQuery(event.target.value) }),
      controls
    ),
    e("div", { className: "rt-scroll" }, !status.loaded && snapshot === emptySnapshot && !status.error ? e("div", { className: "rt-empty", role: "status" }, "\u6B63\u5728\u52A0\u8F7D\u4EFB\u52A1\u6570\u636E\u2026") : children)
  );
}
function AssetGraphTab(props) {
  const workspace2 = useWorkspace(props);
  const { snapshot, taskId } = workspace2;
  const [query, setQuery] = import_react.default.useState("");
  const [kind, setKind] = import_react.default.useState("");
  const [selectedId, setSelectedId] = import_react.default.useState("");
  const [view, setView] = import_react.default.useState("graph");
  const taskNodes = filterTask(snapshot.nodes, taskId);
  const nodes = taskNodes.filter((node2) => (!kind || node2.kind === kind) && matchesQuery([node2.label, node2.kind, node2.data, node2.id], query));
  const node = taskNodes.find((item) => item.id === selectedId);
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = snapshot.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const task = snapshot.tasks.find((item) => item.id === taskId);
  import_react.default.useEffect(() => {
    if (selectedId && !nodes.some((item) => item.id === selectedId)) setSelectedId("");
  }, [selectedId, taskId, query, kind, snapshot.version]);
  return e(Panel, {
    title: "\u8D44\u4EA7\u4E0E\u63A2\u7D22\u56FE",
    count: nodes.length,
    workspace: workspace2,
    query,
    onQuery: setQuery,
    controls: e(
      import_react.default.Fragment,
      null,
      e("select", { className: "rt-select", "aria-label": "\u8282\u70B9\u7C7B\u578B", value: kind, onChange: (event) => setKind(event.target.value) }, e("option", { value: "" }, "\u6240\u6709\u8282\u70B9"), nodeKinds.map((item) => e("option", { key: item, value: item }, kindLabels[item]))),
      e("button", { className: "rt-button", "aria-pressed": view === "list", onClick: () => setView(view === "graph" ? "list" : "graph") }, view === "graph" ? "\u5217\u8868\u89C6\u56FE" : "\u56FE\u89C6\u56FE"),
      (query || kind || selectedId) && e("button", { className: "rt-button", onClick: () => {
        setQuery("");
        setKind("");
        setSelectedId("");
      } }, "\u6E05\u9664\u7B5B\u9009")
    ),
    children: e(
      import_react.default.Fragment,
      null,
      task && e("div", { className: "rt-card rt-card-body rt-scope-card" }, e("div", { className: "rt-card-head" }, e("strong", null, task.title), e(GraphBadge, { tone: task.status }, task.status)), e("p", { className: "rt-muted" }, task.goal)),
      e("div", { className: "rt-graph-summary", role: "status", "aria-live": "polite" }, e("span", null, `${nodes.length} / ${taskNodes.length} \u4E2A\u8282\u70B9`), e("span", { "aria-hidden": "true" }, "\xB7"), e("span", null, `${edges.length} \u6761\u5173\u7CFB`), selectedId && e("span", { className: "rt-muted" }, `\xB7 \u5DF2\u9009\u62E9 ${node?.label ?? "\u8282\u70B9"}`)),
      nodes.length === 0 ? e(Empty, null, query || kind ? "\u6CA1\u6709\u5339\u914D\u7684\u8282\u70B9\uFF0C\u8BF7\u8C03\u6574\u641C\u7D22\u6216\u7C7B\u578B\u3002" : "\u4EFB\u52A1\u8BB0\u5F55\u4EA7\u751F\u8D44\u4EA7\u3001\u610F\u56FE\u3001\u4E8B\u5B9E\u3001\u53D1\u73B0\u6216\u8BC1\u636E\u540E\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002") : view === "graph" ? e(GraphView, { nodes, edges, selectedId, onSelect: setSelectedId }) : e("div", { className: "rt-card", role: "list", "aria-label": "\u8D44\u4EA7\u8282\u70B9\u5217\u8868" }, nodes.map((item) => e("button", { key: item.id, className: "rt-row", "aria-pressed": item.id === selectedId, onClick: () => setSelectedId(item.id) }, e(GraphBadge, null, kindLabels[item.kind]), " ", item.label))),
      node ? e(NodeDetail, { node, snapshot, onSelect: (id) => {
        setSelectedId(id);
        setKind("");
        setQuery("");
      }, onSubagentJump: props.onSubagentJump }) : nodes.length > 0 && e("p", { className: "rt-muted" }, "\u9009\u62E9\u8282\u70B9\uFF0C\u67E5\u770B\u5B8C\u6574\u8BB0\u5F55\u548C\u5173\u8054\u5173\u7CFB\u3002")
    )
  });
}
function GraphView({ nodes, edges, selectedId, onSelect }) {
  const { positions, columns, width, height } = layoutGraph(nodes);
  const markerId = import_react.default.useId().replace(/:/g, "");
  const selectedIndex = nodes.findIndex((node) => node.id === selectedId);
  const selectRelative = (delta) => {
    if (!nodes.length) return;
    const index = selectedIndex < 0 ? delta > 0 ? 0 : nodes.length - 1 : (selectedIndex + delta + nodes.length) % nodes.length;
    onSelect(nodes[index].id);
  };
  return e("div", { className: "rt-graph", tabIndex: 0, role: "group", "aria-label": "\u53EF\u6EDA\u52A8\u8D44\u4EA7\u56FE", onKeyDown: (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectRelative(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectRelative(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (nodes[0]) onSelect(nodes[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      if (nodes.at(-1)) onSelect(nodes.at(-1).id);
    }
  } }, e("div", { className: "rt-graph-legend", "aria-label": "\u56FE\u4F8B" }, columns.map((kind) => e("span", { key: kind }, e(GraphBadge, null, kindLabels[kind])))), e(
    "svg",
    { width, height, role: "group", "aria-label": "\u8D44\u4EA7\u4E0E\u63A2\u7D22\u8282\u70B9" },
    e("defs", null, e("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, e("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--dsw-alias-border-l3,#bbb)" }))),
    columns.map((kind, index) => e("text", { key: kind, x: 18 + index * 200, y: 24, fill: "var(--dsw-alias-label-secondary,#737373)", fontSize: 11 }, `${kindLabels[kind]} \xB7 ${nodes.filter((node) => node.kind === kind).length}`)),
    edges.map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      const leftToRight = from.x < to.x;
      const x1 = from.x + (leftToRight ? 170 : 0);
      const x2 = to.x + (leftToRight ? 0 : 170);
      const sameColumn = from.x === to.x;
      const d = sameColumn ? `M ${from.x + 170} ${from.y + 23} C ${from.x + 194} ${from.y + 23}, ${to.x + 194} ${to.y + 23}, ${to.x + 170} ${to.y + 23}` : `M ${x1} ${from.y + 23} C ${(x1 + x2) / 2} ${from.y + 23}, ${(x1 + x2) / 2} ${to.y + 23}, ${x2} ${to.y + 23}`;
      const labelX = (x1 + x2) / 2;
      const labelY = (from.y + to.y) / 2 + (from.y === to.y ? -7 : 0);
      return e(import_react.default.Fragment, { key: edge.id }, e("path", { d, className: "rt-edge", "data-active": edge.from === selectedId || edge.to === selectedId, markerEnd: `url(#${markerId})` }, e("title", null, edge.relation)), e("text", { x: labelX, y: labelY, className: "rt-edge-label", "aria-hidden": "true" }, edge.relation));
    }),
    nodes.map((node) => {
      const position = positions.get(node.id);
      return e(
        "g",
        {
          key: node.id,
          transform: `translate(${position.x},${position.y})`,
          className: "rt-node",
          role: "button",
          tabIndex: 0,
          "aria-label": `${kindLabels[node.kind]}\uFF1A${node.label}`,
          "aria-pressed": node.id === selectedId,
          onClick: () => onSelect(node.id),
          onKeyDown: (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(node.id);
            }
          }
        },
        e("title", null, node.label),
        e("rect", { width: 170, height: 46, rx: 6 }),
        e("text", { x: 9, y: 19, fontSize: 11 }, node.label.length > 22 ? `${node.label.slice(0, 21)}\u2026` : node.label),
        e("text", { x: 9, y: 35, className: "rt-node-kind" }, String(node.data.state ?? node.data.status ?? node.data.kind ?? kindLabels[node.kind]))
      );
    })
  ));
}
function NodeDetail({ node, snapshot, onSelect, onSubagentJump }) {
  const relations = graphRelations(snapshot, node);
  const intent = node.kind === "intent" ? snapshot.intents.find((item) => item.id === node.id) : void 0;
  return e(
    "section",
    { className: "rt-detail", "aria-label": "\u8282\u70B9\u8BE6\u60C5" },
    e(GraphBadge, null, kindLabels[node.kind]),
    e("h3", null, node.label),
    e("dl", { className: "rt-kv" }, e("dt", null, "\u8282\u70B9 ID"), e("dd", null, node.id), e("dt", null, "\u4EFB\u52A1"), e("dd", null, snapshot.tasks.find((task) => task.id === node.taskId)?.title ?? node.taskId)),
    intent?.execution && onSubagentJump && e(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", onClick: () => onSubagentJump(intent.execution.childSessionId) }, "\u6253\u5F00 Worker \u4F1A\u8BDD"),
    e("div", { className: "rt-label" }, `\u5173\u8054\u5173\u7CFB \xB7 ${relations.length}`),
    relations.length === 0 ? e("div", { className: "rt-muted" }, "\u6682\u65E0\u5173\u8054\u5173\u7CFB") : relations.map(({ edge, direction, node: target, targetId }) => e(import_dsh_client_ui_primitives.Button, { key: edge.id, size: "sm", variant: "ghost", className: "rt-row", disabled: !target, onClick: () => onSelect(targetId) }, `${direction === "out" ? "\u2192" : "\u2190"} ${edge.relation} \xB7 ${target?.label ?? `${targetId}\uFF08\u8282\u70B9\u672A\u63D0\u4F9B\uFF09`}`)),
    e("details", { open: true }, e("summary", { className: "rt-label" }, "\u5B8C\u6574\u8BB0\u5F55"), e(Json, { value: graphRecord(snapshot, node) }))
  );
}
function rowTime(row) {
  return "updatedAt" in row ? row.updatedAt : "createdAt" in row ? row.createdAt : row.requestedAt;
}
function rowSummary(row) {
  return "summary" in row ? row.summary : "url" in row ? `${row.method} ${row.url}` : "markdown" in row ? `\u62A5\u544A \xB7 \u7248\u672C ${row.version}` : row.action;
}
function rowTone(row) {
  return "severity" in row ? row.severity : "kind" in row ? row.kind : "status" in row ? String(row.status ?? "") : "report";
}
var pageSize = 40;
function SnapshotTab(props) {
  const workspace2 = useWorkspace(props);
  const { snapshot, taskId } = workspace2;
  const kind = props.tab.type.split(":").pop();
  const title = kind === "findings" ? "\u53D1\u73B0" : kind === "traffic" ? "\u6D41\u91CF" : kind === "report" ? "\u62A5\u544A" : "\u4EFB\u52A1\u6D3B\u52A8";
  const [query, setQuery] = import_react.default.useState("");
  const [category, setCategory] = import_react.default.useState("");
  const [page, setPage] = import_react.default.useState(0);
  const navigation2 = import_react.default.useSyncExternalStore(subscribeFindingNavigation, readFindingNavigation, readFindingNavigation);
  const targetId = kind === "findings" ? navigation2.findingId : "";
  const target = snapshot.findings.find((finding) => finding.id === targetId);
  const [expandedId, setExpandedId] = import_react.default.useState("");
  const landing = import_react.default.useRef("");
  const targetElement = import_react.default.useRef(null);
  const all = kind === "findings" ? snapshot.findings : kind === "traffic" ? snapshot.traffic : kind === "report" ? snapshot.reports : [...snapshot.traces, ...snapshot.approvals];
  const taskRows = filterTask(all, taskId);
  const rows = taskRows.filter((row) => (!category || rowTone(row) === category) && matchesQuery([rowSummary(row), row, snapshot.tasks.find((task) => task.id === row.taskId)?.title], query)).sort((a, b) => rowTime(b).localeCompare(rowTime(a)) || a.id.localeCompare(b.id));
  const categories = [...new Set(taskRows.map(rowTone))].filter(Boolean).sort();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  import_react.default.useEffect(() => setPage(0), [taskId, query, category, kind]);
  import_react.default.useEffect(() => {
    setQuery("");
    setCategory("");
  }, [kind]);
  import_react.default.useEffect(() => {
    if (!targetId || !target) return;
    if (landing.current === `${navigation2.revision}:${targetId}`) return;
    selectTask(target.taskId);
    setQuery("");
    setCategory("");
  }, [targetId, target?.taskId, navigation2.revision]);
  import_react.default.useEffect(() => {
    if (!target || !targetId || taskId !== target.taskId || query || category) return;
    const key = `${navigation2.revision}:${targetId}`;
    if (landing.current === key) return;
    const index = rows.findIndex((row) => row.id === targetId);
    if (index < 0) return;
    setPage(Math.floor(index / pageSize));
    setExpandedId(targetId);
    landing.current = key;
  }, [targetId, target?.taskId, taskId, query, category, navigation2.revision, rows]);
  import_react.default.useEffect(() => {
    if (props.visible === false || !expandedId || !targetElement.current) return;
    targetElement.current.scrollIntoView({ block: "nearest" });
    targetElement.current.focus({ preventScroll: true });
  }, [expandedId, currentPage, props.visible, navigation2.revision]);
  return e(Panel, {
    title,
    count: rows.length,
    workspace: workspace2,
    query,
    onQuery: setQuery,
    controls: categories.length > 1 || category ? e("select", { className: "rt-select", "aria-label": "\u7B5B\u9009\u7C7B\u522B", value: category, onChange: (event) => setCategory(event.target.value) }, e("option", { value: "" }, "\u6240\u6709\u7C7B\u522B"), [.../* @__PURE__ */ new Set([...categories, ...category ? [category] : []])].map((value) => e("option", { key: value, value }, value))) : void 0,
    children: e(
      import_react.default.Fragment,
      null,
      targetId && !target && workspace2.status.loaded && e("div", { className: "rt-error", role: "status" }, `\u672A\u627E\u5230\u901A\u77E5\u4E2D\u7684\u53D1\u73B0 ${targetId}\u3002\u8BB0\u5F55\u53EF\u80FD\u5DF2\u5220\u9664\u6216\u5F52\u6863\uFF0C\u8BF7\u68C0\u67E5\u4EFB\u52A1\u6570\u636E\u3002`),
      rows.length === 0 ? e(Empty, null, query || category ? "\u6CA1\u6709\u5339\u914D\u7684\u8BB0\u5F55\uFF0C\u8BF7\u8C03\u6574\u7B5B\u9009\u6761\u4EF6\u3002" : "\u5F53\u524D\u4EFB\u52A1\u6682\u65E0\u8BB0\u5F55\u3002") : rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row) => e(
        "details",
        { key: row.id, className: "rt-card", open: row.id === expandedId ? true : void 0, ref: row.id === expandedId ? targetElement : void 0, tabIndex: row.id === expandedId ? -1 : void 0, "data-finding-id": kind === "findings" ? row.id : void 0 },
        e("summary", null, e(Badge, { tone: rowTone(row) }, rowTone(row)), " ", rowSummary(row), e("div", { className: "rt-muted rt-small", style: { marginTop: 4 } }, `${snapshot.tasks.find((task) => task.id === row.taskId)?.title ?? row.taskId ?? "\u672A\u5173\u8054\u4EFB\u52A1"} \xB7 ${new Date(rowTime(row)).toLocaleString()}`)),
        e("div", { className: "rt-card-body" }, e(RowDetail, { row, snapshot, onSubagentJump: props.onSubagentJump }))
      )),
      rows.length > pageSize && e("div", { className: "rt-pagination" }, e("button", { className: "rt-button", disabled: currentPage === 0, onClick: () => setPage(currentPage - 1) }, "\u4E0A\u4E00\u9875"), e("span", { className: "rt-muted" }, `${currentPage + 1} / ${Math.ceil(rows.length / pageSize)} \u9875`), e("button", { className: "rt-button", disabled: (currentPage + 1) * pageSize >= rows.length, onClick: () => setPage(currentPage + 1) }, "\u4E0B\u4E00\u9875"))
    )
  });
}
function RowDetail({ row, snapshot, onSubagentJump }) {
  if ("vulnClass" in row) return e(
    import_react.default.Fragment,
    null,
    e("dl", { className: "rt-kv" }, e("dt", null, "\u6F0F\u6D1E\u7C7B\u522B"), e("dd", null, row.vulnClass), e("dt", null, "\u72B6\u6001"), e("dd", null, row.status)),
    e("div", { className: "rt-label" }, "\u5173\u8054\u8D44\u4EA7"),
    row.assetIds.length === 0 ? e("div", { className: "rt-muted" }, "\u6682\u65E0\u5173\u8054\u8D44\u4EA7") : row.assetIds.map((id) => e("div", { key: id }, snapshot.assets.find((asset) => asset.id === id)?.value ?? id)),
    e("div", { className: "rt-label" }, "\u8BC1\u636E"),
    row.evidenceIds.length === 0 ? e("div", { className: "rt-muted" }, "\u6682\u65E0\u5173\u8054\u8BC1\u636E") : row.evidenceIds.map((id) => {
      const evidence = snapshot.evidence.find((item) => item.id === id);
      return e("details", { key: id }, e("summary", null, evidence?.summary ?? id), e(Json, { value: evidence ?? { id, missing: true } }));
    })
  );
  if ("url" in row) return e(import_react.default.Fragment, null, e("div", null, row.url), e("div", { className: "rt-label" }, "\u8BF7\u6C42"), e(Json, { value: row.request ?? "\u672A\u6355\u83B7\u8BF7\u6C42\u5185\u5BB9" }), e("div", { className: "rt-label" }, "\u54CD\u5E94"), e(Json, { value: row.response ?? "\u672A\u6355\u83B7\u54CD\u5E94\u5185\u5BB9" }));
  if ("markdown" in row) return e(import_react.default.Fragment, null, e("button", { className: "rt-button", onClick: () => downloadReport(row) }, "\u4E0B\u8F7D Markdown"), e("div", { className: "rt-divider" }), e("pre", { className: "rt-report" }, row.markdown));
  if ("worker" in row) {
    const intent = snapshot.intents.find((item) => item.id === row.intentId);
    return e(
      import_react.default.Fragment,
      null,
      e("div", null, `Worker\uFF1A${row.worker}`),
      intent && e("div", null, `\u610F\u56FE\uFF1A${intent.summary}`),
      intent?.execution && onSubagentJump && e(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", onClick: () => onSubagentJump(intent.execution.childSessionId) }, "\u6253\u5F00 Worker \u4F1A\u8BDD"),
      row.data && e(Json, { value: row.data })
    );
  }
  return e(Json, { value: row });
}
function downloadReport(report) {
  const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `redteam-report-${report.id.replace(/[^a-z0-9_-]/gi, "_")}-v${report.version}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}

// src/task-workspace/client.tsx
var import_react5 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/task-workspace/contracts.ts
var TASK_WORKSPACE_PATH = "/api/redteam/task-workspace";

// src/task-workspace/forms.tsx
var import_react2 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime2 = require("react/jsx-runtime");
function Field2({ label: label2, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "tw-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: label2 }),
    children,
    hint && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: hint })
  ] });
}
function CategorySelect({ categories, value, onChange, label: label2 = "\u4EFB\u52A1\u5206\u7C7B" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { "aria-label": label2, value, onChange: (event) => onChange(event.target.value), children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u672A\u5206\u7C7B" }),
    categories.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: row.id, children: row.name }, row.id))
  ] });
}
function NewTaskForm({ categories, templates, tasks, busy, onCreate, onCancel }) {
  const [templateId, setTemplateId] = import_react2.default.useState("");
  const [title, setTitle] = import_react2.default.useState("");
  const [description, setDescription] = import_react2.default.useState("");
  const [goal, setGoal] = import_react2.default.useState("");
  const [categoryId, setCategoryId] = import_react2.default.useState("");
  const [timeout, setTimeout2] = import_react2.default.useState("0");
  const [heartbeat, setHeartbeat] = import_react2.default.useState("600");
  const [coverage, setCoverage] = import_react2.default.useState(true);
  const [seed, setSeed] = import_react2.default.useState(false);
  const [sources, setSources] = import_react2.default.useState([]);
  const template = templates.find((row) => row.id === templateId);
  function useTemplate(id) {
    setTemplateId(id);
    const selected = templates.find((row) => row.id === id);
    if (selected) {
      setDescription(selected.description);
      setGoal(selected.goal);
      setCategoryId(selected.categoryId ?? "");
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("form", { className: "tw-stack", "aria-label": "\u65B0\u5EFA\u4EFB\u52A1\u8868\u5355", onSubmit: (event) => {
    event.preventDefault();
    void onCreate({
      ...title.trim() ? { title: title.trim() } : {},
      description,
      goal,
      categoryId: categoryId || null,
      ...templateId ? { templateId } : {},
      timeoutSeconds: Number(timeout),
      planHeartbeatSeconds: Number(heartbeat),
      coverageEnabled: coverage,
      seedFirstIntent: seed,
      sourceTaskIds: sources
    });
  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4F7F\u7528\u6A21\u677F", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { "aria-label": "\u4F7F\u7528\u6A21\u677F", value: templateId, onChange: (event) => useTemplate(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u7A7A\u767D\u4EFB\u52A1" }),
        templates.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: row.id, children: row.name }, row.id))
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4EFB\u52A1\u5206\u7C7B", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CategorySelect, { categories, value: categoryId, onChange: setCategoryId }) })
    ] }),
    template && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "tw-muted tw-small", children: [
      "\u6A21\u677F\u5305\u542B ",
      template.interceptRules.length,
      " \u6761\u8D44\u4EA7\u89C4\u5219\uFF0C\u521B\u5EFA\u65F6\u4E00\u5E76\u5E94\u7528\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4EFB\u52A1\u540D\u79F0", hint: "\u7559\u7A7A\u65F6\u4ECE\u4EFB\u52A1\u63CF\u8FF0\u751F\u6210\u540D\u79F0\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Input, { "aria-label": "\u4EFB\u52A1\u540D\u79F0", maxLength: 200, value: title, onChange: (event) => setTitle(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u6838\u9A8C\u6D4B\u8BD5\u73AF\u5883\u7684\u767B\u5F55\u6D41\u7A0B" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4EFB\u52A1\u63CF\u8FF0", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { "aria-label": "\u4EFB\u52A1\u63CF\u8FF0", required: true, maxLength: 16e3, rows: 4, value: description, onChange: (event) => setDescription(event.target.value), placeholder: "\u8BF4\u660E\u6388\u6743\u76EE\u6807\u3001\u80CC\u666F\u548C\u9700\u8981\u6267\u884C\u7684\u5DE5\u4F5C\u3002" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4EFB\u52A1\u76EE\u6807", hint: "Planner \u4F1A\u5206\u89E3\u4E3A\u53EF\u9A8C\u8BC1\u76EE\u6807\uFF1B\u65E0\u76EE\u6807\u7684\u76F4\u6295\u4EFB\u52A1\u53EF\u7559\u7A7A\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { "aria-label": "\u4EFB\u52A1\u76EE\u6807", maxLength: 16e3, rows: 3, value: goal, onChange: (event) => setGoal(event.target.value), placeholder: "\u5199\u660E\u9884\u671F\u7ED3\u679C\u548C\u9A8C\u6536\u6761\u4EF6\u3002" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u6267\u884C\u8BBE\u7F6E\u4E0E\u6765\u6E90\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-stack", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-grid", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u4EFB\u52A1\u65F6\u9650\uFF08\u79D2\uFF09", hint: "0 \u8868\u793A\u4E0D\u9650\u65F6\uFF1B\u4ECE\u5B9E\u9645\u6A21\u578B\u8FD0\u884C\u5F00\u59CB\u8BA1\u65F6\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Input, { "aria-label": "\u4EFB\u52A1\u65F6\u9650\uFF08\u79D2\uFF09", type: "number", min: 0, step: 1, required: true, value: timeout, onChange: (event) => setTimeout2(event.target.value) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "Planner \u5FC3\u8DF3\uFF08\u79D2\uFF09", hint: "\u81F3\u5C11 600 \u79D2\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Input, { "aria-label": "Planner \u5FC3\u8DF3\uFF08\u79D2\uFF09", type: "number", min: 600, step: 1, required: true, value: heartbeat, onChange: (event) => setHeartbeat(event.target.value) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Checkbox, { checked: coverage, onChange: setCoverage, label: "\u542F\u7528\u8986\u76D6\u5206\u6790" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Checkbox, { checked: seed, onChange: setSeed, label: "\u5C06\u63CF\u8FF0\u4F5C\u4E3A\u9996\u4E2A\u610F\u56FE\u76F4\u63A5\u6267\u884C" }),
        tasks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-gap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u53EA\u8BFB\u5F15\u7528\u6765\u6E90\u4EFB\u52A1\u7684\u4E8B\u5B9E\u548C\u53D1\u73B0" }),
          tasks.map((row) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Checkbox, { checked: sources.includes(row.id), label: row.title, onChange: (checked) => setSources((values) => checked ? [...values, row.id] : values.filter((id) => id !== row.id)) }, row.id))
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { type: "submit", size: "sm", variant: "primary", children: busy ? "\u6B63\u5728\u521B\u5EFA\u2026" : "\u521B\u5EFA\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "tw-muted tw-small", children: "\u521B\u5EFA\u540E\u53EF\u68C0\u67E5\u76EE\u6807\u4E0E\u6A21\u578B\u914D\u7F6E\uFF0C\u518D\u4ECE\u5F53\u524D\u4F1A\u8BDD\u542F\u52A8\u3002" })
  ] }) });
}
function TemplateForm({ value, categories, busy, onSave, onCancel }) {
  const [name, setName] = import_react2.default.useState(value?.name ?? "");
  const [description, setDescription] = import_react2.default.useState(value?.description ?? "");
  const [goal, setGoal] = import_react2.default.useState(value?.goal ?? "");
  const [categoryId, setCategoryId] = import_react2.default.useState(value?.categoryId ?? "");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("form", { className: "tw-stack", "aria-label": "\u4EFB\u52A1\u6A21\u677F\u8868\u5355", onSubmit: (event) => {
    event.preventDefault();
    void onSave({ name, description, goal, categoryId: categoryId || null, interceptRules: value?.interceptRules ?? [] });
  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u6A21\u677F\u540D\u79F0", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Input, { "aria-label": "\u6A21\u677F\u540D\u79F0", required: true, maxLength: 120, value: name, onChange: (event) => setName(event.target.value) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u6A21\u677F\u5206\u7C7B", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CategorySelect, { label: "\u6A21\u677F\u5206\u7C7B", categories, value: categoryId, onChange: setCategoryId }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u6A21\u677F\u63CF\u8FF0", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { "aria-label": "\u6A21\u677F\u63CF\u8FF0", required: true, maxLength: 16e3, value: description, onChange: (event) => setDescription(event.target.value), rows: 3 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field2, { label: "\u6A21\u677F\u76EE\u6807", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { "aria-label": "\u6A21\u677F\u76EE\u6807", required: true, maxLength: 16e3, value: goal, onChange: (event) => setGoal(event.target.value), rows: 3 }) }),
    value && value.interceptRules.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "tw-muted", children: [
      "\u4FDD\u7559\u6A21\u677F\u73B0\u6709\u7684 ",
      value.interceptRules.length,
      " \u6761\u8D44\u4EA7\u89C4\u5219\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { type: "submit", variant: "primary", size: "sm", children: "\u4FDD\u5B58\u6A21\u677F" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88\u7F16\u8F91" })
    ] })
  ] }) });
}

// src/task-workspace/records.tsx
var import_react3 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
function DeleteAction({ label: label2, disabled, onDelete }) {
  const [confirming, setConfirming] = import_react3.default.useState(false);
  return confirming ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tw-inline", role: "group", "aria-label": `\u786E\u8BA4${label2}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tw-small", children: [
      "\u786E\u8BA4",
      label2,
      "\uFF1F"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", size: "sm", disabled, onClick: () => {
      void onDelete().then((ok) => {
        if (ok) setConfirming(false);
      });
    }, children: "\u786E\u8BA4\u5220\u9664" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", size: "sm", disabled, onClick: () => setConfirming(false), children: "\u53D6\u6D88" })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", size: "sm", disabled, onClick: () => setConfirming(true), children: label2 });
}
function GoalsEditor({ goals, busy, onSave, onDelete }) {
  const [editing, setEditing] = import_react3.default.useState();
  const [text, setText] = import_react3.default.useState("");
  const shown = goals.filter((goal) => goal.state !== "deleted");
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-inline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { className: "tw-grow", children: "\u53EF\u9A8C\u8BC1\u76EE\u6807" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "tw-muted", children: [
        shown.filter((goal) => goal.state === "met").length,
        " / ",
        shown.length,
        " \u5DF2\u8FBE\u6210"
      ] })
    ] }),
    shown.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tw-muted", children: "\u8FD8\u6CA1\u6709\u5206\u89E3\u76EE\u6807\u3002\u4EFB\u52A1\u542F\u52A8\u65F6 Planner \u4F1A\u4ECE\u4EFB\u52A1\u63CF\u8FF0\u4E0E\u76EE\u6807\u521D\u59CB\u5316\uFF0C\u4E5F\u53EF\u5728\u6B64\u6DFB\u52A0\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: shown.map((goal) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "tw-record tw-gap", "aria-label": `\u76EE\u6807\uFF1A${goal.text}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tw-row-content", children: goal.text }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Tag, { tone: goal.state === "met" ? "success" : "outline", children: goal.state === "met" ? "\u5DF2\u8BC1\u660E" : "\u5F85\u9A8C\u8BC1" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", disabled: busy, onClick: () => {
          setEditing(goal.id);
          setText(goal.text);
        }, children: "\u7F16\u8F91\u76EE\u6807" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DeleteAction, { label: "\u5220\u9664\u76EE\u6807", disabled: busy, onDelete: () => onDelete(goal.id) })
      ] })
    ] }, goal.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { className: "tw-stack tw-section", "aria-label": "\u76EE\u6807\u7F16\u8F91\u8868\u5355", onSubmit: (event) => {
      event.preventDefault();
      void onSave(editing, text).then((ok) => {
        if (ok) {
          setEditing(void 0);
          setText("");
        }
      });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Field2, { label: editing ? "\u7F16\u8F91\u76EE\u6807\u5185\u5BB9" : "\u65B0\u589E\u76EE\u6807", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("textarea", { "aria-label": "\u76EE\u6807\u5185\u5BB9", required: true, rows: 3, value: text, disabled: busy, onChange: (event) => setText(event.target.value), placeholder: "\u63CF\u8FF0\u53EF\u7531\u8BC1\u636E\u9A8C\u8BC1\u7684\u7ED3\u679C\u3002" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "submit", size: "sm", variant: "primary", disabled: busy, children: editing ? "\u4FDD\u5B58\u76EE\u6807" : "\u6DFB\u52A0\u76EE\u6807" }),
        editing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", size: "sm", disabled: busy, onClick: () => {
          setEditing(void 0);
          setText("");
        }, children: "\u53D6\u6D88\u7F16\u8F91" })
      ] })
    ] })
  ] });
}
function ConstraintsEditor({ constraints, scopes, busy, onSave, onDelete }) {
  const [editing, setEditing] = import_react3.default.useState();
  const [text, setText] = import_react3.default.useState("");
  const [kind, setKind] = import_react3.default.useState("deny");
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u4EFB\u52A1\u7EA6\u675F" }),
    constraints.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tw-muted", children: "\u5C1A\u65E0\u7EA6\u675F\u3002\u53EF\u4EE5\u660E\u786E\u5141\u8BB8\u7684\u8303\u56F4\u548C\u7981\u6B62\u7684\u64CD\u4F5C\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: constraints.map((row) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "tw-record tw-gap", "aria-label": `\u7EA6\u675F\uFF1A${row.text}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tw-row-content", children: row.text }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Tag, { tone: row.kind === "deny" ? "warning" : "info", children: row.kind === "deny" ? "\u7981\u6B62" : "\u5141\u8BB8" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", disabled: busy, onClick: () => {
          setEditing(row.id);
          setText(row.text);
          setKind(row.kind);
        }, children: "\u7F16\u8F91\u7EA6\u675F" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DeleteAction, { label: "\u5220\u9664\u7EA6\u675F", disabled: busy, onDelete: () => onDelete(row.id) })
      ] })
    ] }, row.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("form", { className: "tw-stack tw-section", "aria-label": "\u7EA6\u675F\u7F16\u8F91\u8868\u5355", onSubmit: (event) => {
      event.preventDefault();
      void onSave(editing, text, kind).then((ok) => {
        if (ok) {
          setEditing(void 0);
          setText("");
        }
      });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Field2, { label: "\u7EA6\u675F\u7C7B\u578B", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { "aria-label": "\u7EA6\u675F\u7C7B\u578B", disabled: busy, value: kind, onChange: (event) => setKind(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "deny", children: "\u7981\u6B62" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "allow", children: "\u5141\u8BB8" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Field2, { label: "\u7EA6\u675F\u5185\u5BB9", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Input, { "aria-label": "\u7EA6\u675F\u5185\u5BB9", required: true, disabled: busy, value: text, onChange: (event) => setText(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u53EA\u4F7F\u7528\u6D4B\u8BD5\u8D26\u53F7\uFF0C\u4E0D\u4FEE\u6539\u751F\u4EA7\u6570\u636E" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "submit", size: "sm", variant: "primary", disabled: busy, children: editing ? "\u4FDD\u5B58\u7EA6\u675F" : "\u6DFB\u52A0\u7EA6\u675F" }),
        editing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { type: "button", size: "sm", onClick: () => {
          setEditing(void 0);
          setText("");
        }, children: "\u53D6\u6D88\u7F16\u8F91" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "tw-stack tw-section", "aria-label": "\u4EFB\u52A1\u8303\u56F4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: "\u4EFB\u52A1\u8303\u56F4" }),
      scopes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "tw-muted", children: "\u5C1A\u65E0\u8303\u56F4\u6761\u76EE\u3002\u521D\u59CB\u5316\u7ED3\u679C\u5C06\u5728\u8FD9\u91CC\u663E\u793A\u3002" }) : scopes.map((row) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "tw-inline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Tag, { children: row.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "tw-row-content", children: row.value })
      ] }, row.id))
    ] })
  ] });
}

// src/task-workspace/models.tsx
var import_react4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
function ModelsEditor({ task, workspace: workspace2, busy, act }) {
  const chain = task.llmChain;
  const [ids, setIds] = import_react4.default.useState(() => [...chain?.profiles ?? []].sort((a, b) => a.position - b.position).map((row) => row.profileId));
  const [activeId, setActiveId] = import_react4.default.useState(chain?.activeProfileId ?? "");
  const [dirty, setDirty] = import_react4.default.useState(false);
  const [candidate, setCandidate] = import_react4.default.useState("");
  const [creating, setCreating] = import_react4.default.useState(false);
  const [editingProfile, setEditingProfile] = import_react4.default.useState();
  const profile = (id) => workspace2.profiles.find((row) => row.id === id);
  import_react4.default.useEffect(() => {
    if (dirty) return;
    setIds([...chain?.profiles ?? []].sort((a, b) => a.position - b.position).map((row) => row.profileId));
    setActiveId(chain?.activeProfileId ?? "");
  }, [chain, dirty]);
  const move = (index, delta) => {
    setDirty(true);
    setIds((prior) => {
      const next = [...prior];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: "\u4EFB\u52A1\u6A21\u578B\u94FE" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted", children: "\u6309\u987A\u5E8F\u9009\u62E9\u771F\u5B9E\u6A21\u578B\u914D\u7F6E\uFF0C\u989D\u5EA6\u8017\u5C3D\u65F6\u7531\u8FD0\u884C\u65F6\u5207\u6362\u3002\u7A7A\u94FE\u6309\u89D2\u8272\u3001\u5168\u5C40\u914D\u7F6E\u53CA\u5F53\u524D\u4F1A\u8BDD\u7EE7\u627F\u3002" })
    ] }),
    ids.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "tw-card tw-muted", children: "\u5F53\u524D\u672A\u6307\u5B9A\u4EFB\u52A1\u6A21\u578B\u94FE\u3002" }),
    ids.map((id, index) => {
      const entry = profile(id), state = chain?.profiles.find((row) => row.profileId === id);
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "tw-card tw-gap", "aria-label": `\u6A21\u578B\u94FE\u914D\u7F6E\uFF1A${entry?.name ?? id}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "tw-order", children: index + 1 }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-grow", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: entry?.name ?? "\u914D\u7F6E\u5DF2\u4E0D\u5B58\u5728" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small", children: entry ? `${entry.provider} / ${entry.model}` : id })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: state?.status === "quota_exhausted" || entry?.available === false ? "warning" : "info", children: state?.status === "quota_exhausted" ? "\u989D\u5EA6\u8017\u5C3D" : entry?.available === false ? "\u4E0D\u53EF\u7528" : "\u53EF\u7528" })
        ] }),
        (state?.lastError || entry?.reason) && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small tw-description", children: state?.lastError || entry?.reason }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy || index === 0, "aria-label": `\u4E0A\u79FB${entry?.name ?? id}`, onClick: () => move(index, -1), children: "\u4E0A\u79FB" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy || index === ids.length - 1, "aria-label": `\u4E0B\u79FB${entry?.name ?? id}`, onClick: () => move(index, 1), children: "\u4E0B\u79FB" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy, "aria-label": `\u79FB\u51FA${entry?.name ?? id}`, onClick: () => {
            setDirty(true);
            setIds((prior) => prior.filter((value) => value !== id));
            if (activeId === id) setActiveId("");
          }, children: "\u79FB\u51FA\u94FE" })
        ] })
      ] }, id);
    }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-inline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { className: "tw-grow", "aria-label": "\u6DFB\u52A0\u6A21\u578B\u914D\u7F6E", disabled: busy, value: candidate, onChange: (event) => setCandidate(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u9009\u62E9\u5DF2\u6709\u6A21\u578B\u914D\u7F6E" }),
        workspace2.profiles.filter((row) => !ids.includes(row.id)).map((row) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: row.id, children: [
          row.name,
          row.available ? "" : "\uFF08\u4E0D\u53EF\u7528\uFF09"
        ] }, row.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy || !candidate, onClick: () => {
        setDirty(true);
        setIds((prior) => [...prior, candidate]);
        setCandidate("");
      }, children: "\u52A0\u5165\u94FE" })
    ] }),
    ids.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u4ECE\u54EA\u4E2A\u914D\u7F6E\u5F00\u59CB", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u5F53\u524D\u6A21\u578B\u914D\u7F6E", disabled: busy, value: activeId, onChange: (event) => {
      setDirty(true);
      setActiveId(event.target.value);
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u4ECE\u7B2C\u4E00\u9879\u5F00\u59CB" }),
      ids.map((id) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: id, children: profile(id)?.name ?? id }, id))
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", variant: "primary", disabled: busy, onClick: async () => {
        if (await act({ action: "chain.set", taskId: task.id, profileIds: ids, activeProfileId: activeId || null })) setDirty(false);
      }, children: "\u4FDD\u5B58\u6A21\u578B\u94FE" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy || ids.length === 0, onClick: () => {
        setDirty(true);
        setIds([]);
        setActiveId("");
      }, children: "\u6E05\u7A7A\u9009\u62E9" })
    ] }),
    dirty && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small", role: "status", children: "\u6A21\u578B\u94FE\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small", children: "\u4FDD\u5B58\u4F1A\u91CD\u7F6E\u94FE\u5185\u7684\u989D\u5EA6\u8017\u5C3D\u6807\u8BB0\u3002\u6E05\u7A7A\u9009\u62E9\u540E\u9700\u4FDD\u5B58\u624D\u4F1A\u751F\u6548\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "tw-stack tw-section", "aria-label": "\u6A21\u578B\u914D\u7F6E\u7BA1\u7406", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-inline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { className: "tw-grow", children: "\u53EF\u7528\u914D\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy, onClick: () => {
          setEditingProfile(void 0);
          setCreating((value) => !value);
        }, children: creating ? "\u6536\u8D77\u914D\u7F6E\u8868\u5355" : "\u65B0\u5EFA\u6A21\u578B\u914D\u7F6E" })
      ] }),
      creating && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ProfileForm, { value: profile(editingProfile ?? ""), workspace: workspace2, busy, onSave: async (input) => {
        const ok = await act({ action: "profile.upsert", input });
        if (ok) setCreating(false);
        return ok;
      } }, editingProfile ?? "new"),
      !workspace2.profiles.length && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted", children: "\u5C1A\u672A\u521B\u5EFA\u914D\u7F6E\u3002\u53EF\u4ECE DSH \u5DF2\u6CE8\u518C\u7684 provider \u548C\u6A21\u578B\u4E2D\u9009\u62E9\uFF1B\u51ED\u8BC1\u4ECD\u7531 DSH \u7BA1\u7406\u3002" }),
      workspace2.profiles.map((row) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-record tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-grow", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: row.name }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "tw-muted tw-small", children: [
              row.provider,
              " / ",
              row.model
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: row.available ? "success" : "warning", children: row.available ? "\u5DF2\u5C31\u7EEA" : "\u4E0D\u53EF\u7528" })
        ] }),
        row.reason && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small", children: row.reason }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "tw-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_dsh_client_ui_primitives4.Button, { size: "sm", disabled: busy, onClick: () => {
            setEditingProfile(row.id);
            setCreating(true);
          }, children: [
            "\u7F16\u8F91\u914D\u7F6E ",
            row.name
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(DeleteAction, { label: `\u5220\u9664\u914D\u7F6E ${row.name}`, disabled: busy, onDelete: () => act({ action: "profile.delete", id: row.id }) })
        ] })
      ] }, row.id)),
      workspace2.profiles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "tw-muted tw-small", children: "\u5220\u9664\u914D\u7F6E\u4F1A\u79FB\u9664\u5404\u4EFB\u52A1\u5BF9\u5B83\u7684\u5F15\u7528\uFF1B\u6B63\u5728\u4F7F\u7528\u7684\u5168\u5C40\u914D\u7F6E\u987B\u5148\u5728\u5BBF\u4E3B\u4E2D\u5207\u6362\u3002" })
    ] })
  ] });
}
function ProfileForm({ value, workspace: workspace2, busy, onSave }) {
  const [name, setName] = import_react4.default.useState(value?.name ?? "");
  const [provider, setProvider] = import_react4.default.useState(value?.provider ?? "");
  const [model, setModel] = import_react4.default.useState(value?.model ?? "");
  const [effort, setEffort] = import_react4.default.useState(value?.reasoningEffort ?? "");
  const [maxTokens, setMaxTokens] = import_react4.default.useState(value?.maxTokens?.toString() ?? "");
  const models = workspace2.catalog.models.filter((row) => row.provider === provider);
  const selected = models.find((row) => row.id === model);
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("form", { className: "tw-card tw-stack", "aria-label": value ? "\u7F16\u8F91\u6A21\u578B\u914D\u7F6E\u8868\u5355" : "\u65B0\u5EFA\u6A21\u578B\u914D\u7F6E\u8868\u5355", onSubmit: (event) => {
    event.preventDefault();
    void onSave({ ...value ? { id: value.id } : {}, name, provider, model, ...maxTokens ? { maxTokens: Number(maxTokens) } : {}, ...effort ? { reasoningEffort: effort } : {} });
  }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u914D\u7F6E\u540D\u79F0", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Input, { "aria-label": "\u914D\u7F6E\u540D\u79F0", required: true, value: name, onChange: (event) => setName(event.target.value) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u6A21\u578B\u63D0\u4F9B\u65B9", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u6A21\u578B\u63D0\u4F9B\u65B9", required: true, value: provider, onChange: (event) => {
      setProvider(event.target.value);
      setModel("");
      setEffort("");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u9009\u62E9 DSH \u63D0\u4F9B\u65B9" }),
      workspace2.catalog.providers.map((row) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: row.id, children: row.name }, row.id))
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u6A21\u578B", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u6A21\u578B", required: true, value: model, onChange: (event) => {
      setModel(event.target.value);
      setEffort("");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u9009\u62E9\u6A21\u578B" }),
      models.map((row) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: row.id, children: row.name }, row.id))
    ] }) }),
    selected && selected.reasoningEfforts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u63A8\u7406\u5F3A\u5EA6", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { "aria-label": "\u63A8\u7406\u5F3A\u5EA6", value: effort, onChange: (event) => setEffort(event.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u6A21\u578B\u9ED8\u8BA4\u503C" }),
      selected.reasoningEfforts.map((row) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: row.id, children: row.name }, row.id))
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field2, { label: "\u6700\u5927\u8F93\u51FA token", hint: "\u7559\u7A7A\u65F6\u4F7F\u7528\u5BBF\u4E3B\u9ED8\u8BA4\u503C\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Input, { "aria-label": "\u6700\u5927\u8F93\u51FA token", type: "number", min: 1, step: 1, value: maxTokens, onChange: (event) => setMaxTokens(event.target.value) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { type: "submit", size: "sm", variant: "primary", children: "\u4FDD\u5B58\u6A21\u578B\u914D\u7F6E" })
  ] }) });
}

// src/task-workspace/client.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var statuses = { draft: "\u8349\u7A3F", running: "\u8FD0\u884C\u4E2D", paused: "\u5DF2\u6682\u505C", done: "\u5DF2\u5B8C\u6210", failed: "\u5931\u8D25", timeout: "\u5DF2\u8D85\u65F6" };
var time = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "\u5C1A\u672A\u5F00\u59CB";
function endpoint() {
  const base = new URL(document.baseURI);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(TASK_WORKSPACE_PATH.replace(/^\/+/, ""), base);
}
function TaskStatus({ task }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Tag, { tone: task.queued ? "warning" : task.status === "done" ? "success" : task.status === "running" ? "info" : ["failed", "timeout"].includes(task.status) ? "danger" : "outline", children: task.queued ? "\u6392\u961F\u4E2D" : statuses[task.status] });
}
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function workspace(value) {
  if (!object(value) || value.version !== 1 || !object(value.agent) || !object(value.catalog) || !object(value.admission) || !["tasks", "categories", "templates", "goals", "constraints", "scopes", "companies", "profiles"].every((key) => Array.isArray(value[key])) || !Array.isArray(value.catalog.providers) || !Array.isArray(value.catalog.models)) throw new Error("\u5BBF\u4E3B\u8FD4\u56DE\u4E86\u4E0D\u652F\u6301\u7684\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u6570\u636E\uFF0C\u8BF7\u5237\u65B0\u6216\u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u3002");
  return value;
}
async function responseBody(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(object(body) && typeof body.error === "string" ? body.error : `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  return body;
}
function TaskWorkspaceTab(props) {
  const sessionId = props.scope?.sessionId;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "tw-root", "aria-label": "\u4EFB\u52A1\u5DE5\u4F5C\u53F0", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("style", { children: taskWorkspaceStyles }),
    sessionId ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ScopedWorkspace, { sessionId, visible: props.visible }, sessionId) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { children: "\u4EFB\u52A1\u5DE5\u4F5C\u53F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A DSH \u4F1A\u8BDD\u3002\u5DE5\u4F5C\u53F0\u4F1A\u4F7F\u7528\u8BE5\u4F1A\u8BDD\u7684 Agent \u548C\u6A21\u578B\u6267\u884C\u4EFB\u52A1\u3002" })
    ] })
  ] });
}
function ScopedWorkspace({ sessionId, visible }) {
  const [data, setData] = import_react5.default.useState();
  const [error, setError] = import_react5.default.useState("");
  const [loadError, setLoadError] = import_react5.default.useState("");
  const [notice, setNotice] = import_react5.default.useState("");
  const [busy, setBusy] = import_react5.default.useState(false);
  const busyRef = import_react5.default.useRef(false);
  const pendingActions = import_react5.default.useRef(/* @__PURE__ */ new Set());
  const pendingExecution = import_react5.default.useRef(0);
  const readSequence = import_react5.default.useRef(0);
  const latestAction = import_react5.default.useRef(0);
  const [view, setView] = import_react5.default.useState("tasks");
  const [selected, setSelected] = import_react5.default.useState("");
  const [query, setQuery] = import_react5.default.useState("");
  const [category, setCategory] = import_react5.default.useState("");
  const [filter, setFilter] = import_react5.default.useState("");
  const active = import_react5.default.useRef(true);
  import_react5.default.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const refresh = import_react5.default.useCallback(async (signal) => {
    if (busyRef.current && pendingExecution.current === 0) return;
    const sequence = ++readSequence.current;
    try {
      const url = endpoint();
      url.searchParams.set("sessionId", sessionId);
      const result = workspace(await responseBody(await fetch(url, { credentials: "same-origin", cache: "no-store", signal })));
      if (active.current && !signal?.aborted && sequence === readSequence.current) {
        setData(result);
        setLoadError("");
      }
    } catch (failure) {
      if (active.current && !signal?.aborted && sequence === readSequence.current) setLoadError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [sessionId]);
  import_react5.default.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => {
        void poll();
      }, 4e3);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh, visible]);
  async function action(input, success = "\u64CD\u4F5C\u5DF2\u5B8C\u6210") {
    const actionKey = `${input.action}:${"taskId" in input ? input.taskId : ""}`;
    if (pendingActions.current.has(actionKey) || busyRef.current && input.action !== "task.pause") return;
    const actionSequence = ++latestAction.current;
    const execution = ["task.start", "task.resume", "task.rerun", "task.pause"].includes(input.action);
    pendingActions.current.add(actionKey);
    if (execution) pendingExecution.current++;
    busyRef.current = true;
    ++readSequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = await responseBody(await fetch(endpoint(), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, sessionId }) }));
      if (!object(body)) throw new Error("\u5BBF\u4E3B\u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u64CD\u4F5C\u7ED3\u679C\u3002");
      const result = { workspace: workspace(body.workspace), ...typeof body.taskId === "string" ? { taskId: body.taskId } : {} };
      if (active.current && actionSequence === latestAction.current) {
        ++readSequence.current;
        setData(result.workspace);
        setLoadError("");
        setNotice(success);
        if (input.action === "task.delete") setSelected("");
      }
      return result;
    } catch (failure) {
      if (active.current && actionSequence === latestAction.current) setError(failure instanceof Error ? failure.message : String(failure));
      return void 0;
    } finally {
      pendingActions.current.delete(actionKey);
      if (execution) pendingExecution.current--;
      busyRef.current = pendingActions.current.size > 0;
      if (active.current) setBusy(busyRef.current);
    }
  }
  const act = async (input) => !!await action(input);
  const task = data?.tasks.find((row) => row.id === selected);
  const tasks = data?.tasks.filter((row) => (!query.trim() || `${row.title} ${row.description ?? ""} ${row.goal}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (!category || (category === "uncategorized" ? !row.categoryId : row.categoryId === category)) && (!filter || (filter === "queued" ? row.queued : !row.queued && row.status === filter))) ?? [];
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { className: "tw-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-grow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { children: view === "create" ? "\u65B0\u5EFA\u4EFB\u52A1" : view === "library" ? "\u6A21\u677F\u4E0E\u5206\u7C7B" : "\u4EFB\u52A1\u5DE5\u4F5C\u53F0" }),
        data && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "tw-muted tw-small", children: [
          data.tasks.length,
          " \u4E2A\u4EFB\u52A1 \xB7 ",
          data.tasks.filter((row) => row.queued).length,
          " \u4E2A\u6392\u961F"
        ] })
      ] }),
      selected || view !== "tasks" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
        setSelected("");
        setView("tasks");
        setNotice("");
      }, children: "\u8FD4\u56DE\u4EFB\u52A1" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "primary", disabled: !data || busy, onClick: () => setView("create"), children: "\u65B0\u5EFA\u4EFB\u52A1" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      error,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u91CD\u65B0\u52A0\u8F7D" })
    ] }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      "\u540C\u6B65\u5931\u8D25\uFF1A",
      loadError,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u91CD\u8BD5\u540C\u6B65" })
    ] }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "tw-notice", role: "status", children: notice }),
    busy && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "tw-notice", role: "status", children: "\u6B63\u5728\u5904\u7406\u64CD\u4F5C\uFF0C\u8BF7\u7B49\u5F85\u5BBF\u4E3B\u8FD4\u56DE\u7ED3\u679C\u2026" }),
    !data ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "tw-empty", children: loadError ? "\u4EFB\u52A1\u6570\u636E\u672A\u52A0\u8F7D\u3002" : "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "tw-notice tw-small", "aria-label": "\u5F53\u524D\u6267\u884C\u4F1A\u8BDD", children: data.agent.available ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        "\u5F53\u524D\u4F1A\u8BDD \xB7 ",
        data.agent.provider,
        " / ",
        data.agent.model,
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("br", {}),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { title: sessionId, children: sessionId })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        "\u5F53\u524D\u4F1A\u8BDD\u5C1A\u4E0D\u80FD\u6267\u884C\u4EFB\u52A1\uFF1A",
        data.agent.error ?? "\u8BF7\u5148\u5728 DSH \u4E2D\u9009\u62E9\u6A21\u578B\u5E76\u6FC0\u6D3B Agent\u3002"
      ] }) }),
      view === "tasks" && !selected && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Input, { className: "tw-grow", "aria-label": "\u641C\u7D22\u4EFB\u52A1", type: "search", value: query, onChange: (event) => setQuery(event.target.value), placeholder: "\u641C\u7D22\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => setView("library"), children: "\u6A21\u677F\u4E0E\u5206\u7C7B" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { "aria-label": "\u6309\u5206\u7C7B\u7B5B\u9009", value: category, onChange: (event) => setCategory(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u5168\u90E8\u5206\u7C7B" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "uncategorized", children: "\u672A\u5206\u7C7B" }),
          data.categories.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("option", { value: row.id, children: [
            row.name,
            "\uFF08",
            row.taskCount,
            "\uFF09"
          ] }, row.id))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { "aria-label": "\u6309\u72B6\u6001\u7B5B\u9009", value: filter, onChange: (event) => setFilter(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: "\u5168\u90E8\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "queued", children: "\u6392\u961F\u4E2D" }),
          Object.entries(statuses).map(([value, label2]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value, children: label2 }, value))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("main", { className: "tw-scroll", children: view === "create" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(NewTaskForm, { categories: data.categories, templates: data.templates, tasks: data.tasks, busy, onCancel: () => setView("tasks"), onCreate: async (input) => {
        const result = await action({ action: "task.create", input }, "\u4EFB\u52A1\u5DF2\u521B\u5EFA\uFF0C\u5C1A\u672A\u542F\u52A8\u3002");
        if (result?.taskId) {
          setSelected(result.taskId);
          setView("tasks");
        }
        return !!result;
      } }) : view === "library" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Library, { workspace: data, busy, act }) : selected ? task ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TaskDetail, { task, workspace: data, busy, act }, task.id) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-empty", children: [
        "\u8BE5\u4EFB\u52A1\u5DF2\u4E0D\u5B58\u5728\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", onClick: () => setSelected(""), children: "\u8FD4\u56DE\u5217\u8868" })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "tw-stack", children: tasks.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: data.tasks.length ? "\u6CA1\u6709\u5339\u914D\u7684\u4EFB\u52A1" : "\u5F00\u59CB\u4E00\u4E2A\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: data.tasks.length ? "\u8C03\u6574\u641C\u7D22\u3001\u5206\u7C7B\u6216\u72B6\u6001\u7B5B\u9009\u3002" : "\u4ECE\u63CF\u8FF0\u6216\u6A21\u677F\u521B\u5EFA\u4EFB\u52A1\uFF0C\u68C0\u67E5\u76EE\u6807\u540E\u518D\u542F\u52A8\u3002" }),
        !data.tasks.length && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "primary", size: "sm", onClick: () => setView("create"), children: "\u521B\u5EFA\u7B2C\u4E00\u4E2A\u4EFB\u52A1" })
      ] }) : tasks.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "tw-card tw-gap", "aria-label": `\u4EFB\u52A1\uFF1A${row.title}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives5.Button, { className: "tw-task-button", size: "sm", onClick: () => {
            setSelected(row.id);
            setNotice("");
          }, children: [
            row.pinnedAt ? "\u7F6E\u9876 \xB7 " : "",
            row.title
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TaskStatus, { task: row })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-description tw-muted", children: row.goal || row.description }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-inline tw-small tw-muted", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: data.categories.find((item) => item.id === row.categoryId)?.name ?? "\u672A\u5206\u7C7B" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
            "\xB7 \u66F4\u65B0\u4E8E ",
            time(row.updatedAt)
          ] })
        ] }),
        row.queued && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "tw-small tw-muted", children: [
          row.queueMode === "resume" ? "\u7B49\u5F85\u6062\u590D" : "\u7B49\u5F85\u521D\u59CB\u5316",
          " \xB7 \u6392\u961F\u65F6\u95F4 ",
          time(row.queuedAt)
        ] })
      ] }, row.id)) }) })
    ] })
  ] });
}
function TaskDetail({ task, workspace: workspace2, busy, act }) {
  const [tab, setTab] = import_react5.default.useState("overview");
  const [renaming, setRenaming] = import_react5.default.useState(false);
  const [title, setTitle] = import_react5.default.useState(task.title);
  const [deleteAssets, setDeleteAssets] = import_react5.default.useState(false);
  const [deleteFindings, setDeleteFindings] = import_react5.default.useState(false);
  const id = import_react5.default.useId();
  const items = ["overview", "goals", "constraints", "models"].map((value) => ({ value, label: { overview: "\u6982\u89C8", goals: "\u76EE\u6807", constraints: "\u7EA6\u675F", models: "\u6A21\u578B\u94FE" }[value], id: `${id}-${value}`, panelId: `${id}-${value}-panel` }));
  const executionDisabled = !workspace2.agent.available || busy && task.status !== "running";
  const taskAction = task.status === "paused" ? "task.resume" : ["done", "failed", "timeout"].includes(task.status) ? "task.rerun" : "task.start";
  const actionLabel = task.status === "paused" ? "\u6062\u590D\u4EFB\u52A1" : ["done", "failed", "timeout"].includes(task.status) ? "\u91CD\u65B0\u8FD0\u884C" : "\u542F\u52A8\u4EFB\u52A1";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-card-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { className: "tw-title", children: task.title }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TaskStatus, { task })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-actions", children: [
      task.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: executionDisabled, onClick: () => {
        void act({ action: "task.pause", taskId: task.id });
      }, children: task.queued ? "\u6682\u505C\u6392\u961F" : "\u6682\u505C\u4EFB\u52A1" }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "primary", disabled: executionDisabled, onClick: () => {
        void act({ action: taskAction, taskId: task.id });
      }, children: actionLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
        void act({ action: "task.metadata", taskId: task.id, patch: { pinned: !task.pinnedAt } });
      }, children: task.pinnedAt ? "\u53D6\u6D88\u7F6E\u9876" : "\u7F6E\u9876\u4EFB\u52A1" })
    ] }),
    task.queued && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-card tw-muted", role: "status", children: [
      "\u4EFB\u52A1\u6B63\u5728\u6392\u961F\u3002",
      workspace2.admission.enabled ? `\u6700\u591A\u540C\u65F6\u8FD0\u884C ${workspace2.admission.limit} \u4E2A\u4EFB\u52A1\uFF1B` : "",
      "\u6A21\u578B\u5C31\u7EEA\u4E14\u83B7\u5F97\u540D\u989D\u540E\u81EA\u52A8",
      task.queueMode === "resume" ? "\u6062\u590D" : "\u542F\u52A8",
      "\u3002"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.SegmentedTabs, { items, value: tab, onChange: setTab, label: "\u4EFB\u52A1\u8BE6\u60C5" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { id: `${id}-${tab}-panel`, role: "tabpanel", "aria-labelledby": `${id}-${tab}`, className: "tw-stack", children: [
      tab === "overview" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-inline", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: "tw-grow", children: "\u4EFB\u52A1\u4FE1\u606F" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
            setTitle(task.title);
            setRenaming((value) => !value);
          }, children: "\u91CD\u547D\u540D" })
        ] }),
        renaming && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("form", { className: "tw-inline", onSubmit: (event) => {
          event.preventDefault();
          void act({ action: "task.metadata", taskId: task.id, patch: { title } }).then((ok) => {
            if (ok) setRenaming(false);
          });
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Input, { "aria-label": "\u4FEE\u6539\u4EFB\u52A1\u540D\u79F0", className: "tw-grow", required: true, maxLength: 200, value: title, disabled: busy, onChange: (event) => setTitle(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", type: "submit", disabled: busy, children: "\u4FDD\u5B58\u540D\u79F0" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Field2, { label: "\u4EFB\u52A1\u5206\u7C7B", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(CategorySelect, { categories: workspace2.categories, value: task.categoryId ?? "", onChange: (categoryId) => {
          if (!busy) void act({ action: "task.category", taskIds: [task.id], categoryId: categoryId || null });
        } }) }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u63CF\u8FF0" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-description", children: task.description || "\u65E0\u63CF\u8FF0" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u539F\u59CB\u76EE\u6807" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-description", children: task.goal || "\u672A\u8BBE\u7F6E\u76EE\u6807\uFF0C\u6309\u76F4\u6295\u610F\u56FE\u6267\u884C\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("dl", { className: "tw-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: "\u521B\u5EFA\u65F6\u95F4" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: time(task.createdAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: "\u9996\u6B21\u8FD0\u884C" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: time(task.firstRunAt) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: "\u622A\u6B62\u65F6\u95F4" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: task.deadlineAt ? time(task.deadlineAt) : task.timeoutSeconds ? `\u9996\u6B21\u6267\u884C\u540E ${task.timeoutSeconds} \u79D2` : "\u4E0D\u9650\u65F6" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: "\u5B8C\u6210\u65F6\u95F4" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: task.completedAt ? time(task.completedAt) : "\u5C1A\u672A\u5B8C\u6210" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: "\u4EFB\u52A1 ID" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: task.id })
        ] }),
        !!task.sourceTaskIds?.length && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "tw-gap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u6765\u6E90\u4EFB\u52A1" }),
          task.sourceTaskIds.map((sourceId) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-muted", children: workspace2.tasks.find((row) => row.id === sourceId)?.title ?? sourceId }, sourceId))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("details", { className: "tw-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("summary", { children: "\u5220\u9664\u4EFB\u52A1" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-stack", children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-muted", children: "\u505C\u6B62\u4EFB\u52A1\u540E\u5220\u9664\u4EFB\u52A1\u548C\u63A2\u7D22\u8BB0\u5F55\u3002\u9ED8\u8BA4\u4FDD\u7559\u5168\u5C40\u8D44\u4EA7\u3001\u72EC\u7ACB\u53D1\u73B0\u53CA\u5176\u8BC1\u636E\uFF1B\u6D41\u91CF\u7531\u6D41\u91CF\u7BA1\u7406\u5355\u72EC\u5220\u9664\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Checkbox, { checked: deleteAssets, onChange: setDeleteAssets, label: "\u540C\u65F6\u5220\u9664\u6CA1\u6709\u5176\u4ED6\u4EFB\u52A1\u5F15\u7528\u7684\u8D44\u4EA7" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Checkbox, { checked: deleteFindings, onChange: setDeleteFindings, label: "\u540C\u65F6\u5220\u9664\u6B64\u4EFB\u52A1\u7684\u53D1\u73B0" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DeleteAction, { label: `\u5220\u9664\u4EFB\u52A1 ${task.title}`, disabled: busy || !workspace2.agent.available, onDelete: () => act({ action: "task.delete", taskId: task.id, deleteAssets, deleteFindings }) })
          ] })
        ] })
      ] }),
      tab === "goals" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(GoalsEditor, { goals: workspace2.goals.filter((row) => row.taskId === task.id), busy, onSave: (goalId, text) => act(goalId ? { action: "goal.update", taskId: task.id, id: goalId, text } : { action: "goal.create", taskId: task.id, text }), onDelete: (goalId) => act({ action: "goal.delete", taskId: task.id, id: goalId }) }),
      tab === "constraints" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ConstraintsEditor, { constraints: workspace2.constraints.filter((row) => row.taskId === task.id), scopes: workspace2.scopes.filter((row) => row.taskId === task.id), busy, onSave: (constraintId, text, kind) => act(constraintId ? { action: "constraint.update", taskId: task.id, id: constraintId, text, kind } : { action: "constraint.create", taskId: task.id, text, kind }), onDelete: (constraintId) => act({ action: "constraint.delete", taskId: task.id, id: constraintId }) }),
      tab === "models" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ModelsEditor, { task, workspace: workspace2, busy, act }, task.id)
    ] })
  ] });
}
function Library({ workspace: workspace2, busy, act }) {
  const [categoryName, setCategoryName] = import_react5.default.useState("");
  const [editingCategory, setEditingCategory] = import_react5.default.useState("");
  const [templateId, setTemplateId] = import_react5.default.useState();
  const template = workspace2.templates.find((row) => row.id === templateId);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u5206\u7C7B" }),
    workspace2.categories.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-muted", children: "\u521B\u5EFA\u5206\u7C7B\u540E\uFF0C\u53EF\u5728\u4EFB\u52A1\u5217\u8868\u7B5B\u9009\u548C\u6574\u7406\u4EFB\u52A1\u3002" }),
    workspace2.categories.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-record tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-inline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { className: "tw-grow", children: row.name }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives5.Tag, { children: [
          row.taskCount,
          " \u4E2A\u4EFB\u52A1"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => {
          setEditingCategory(row.id);
          setCategoryName(row.name);
        }, children: "\u91CD\u547D\u540D\u5206\u7C7B" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DeleteAction, { label: `\u5220\u9664\u5206\u7C7B ${row.name}`, disabled: busy, onDelete: () => act({ action: "category.delete", id: row.id }) })
    ] }, row.id)),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("form", { className: "tw-inline", "aria-label": "\u5206\u7C7B\u7F16\u8F91\u8868\u5355", onSubmit: (event) => {
      event.preventDefault();
      void act(editingCategory ? { action: "category.rename", id: editingCategory, name: categoryName } : { action: "category.create", name: categoryName }).then((ok) => {
        if (ok) {
          setCategoryName("");
          setEditingCategory("");
        }
      });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Input, { className: "tw-grow", "aria-label": "\u5206\u7C7B\u540D\u79F0", maxLength: 80, required: true, disabled: busy, value: categoryName, onChange: (event) => setCategoryName(event.target.value), placeholder: "\u5206\u7C7B\u540D\u79F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", type: "submit", disabled: busy, children: editingCategory ? "\u4FDD\u5B58\u5206\u7C7B" : "\u6DFB\u52A0\u5206\u7C7B" }),
      editingCategory && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", type: "button", onClick: () => {
        setEditingCategory("");
        setCategoryName("");
      }, children: "\u53D6\u6D88" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-small tw-muted", children: "\u5220\u9664\u5206\u7C7B\u4FDD\u7559\u4EFB\u52A1\u548C\u6A21\u677F\uFF0C\u5E76\u5C06\u5176\u79FB\u81F3\u672A\u5206\u7C7B\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-inline tw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { className: "tw-grow", children: "\u4EFB\u52A1\u6A21\u677F" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => setTemplateId("new"), children: "\u65B0\u5EFA\u6A21\u677F" })
    ] }),
    templateId !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TemplateForm, { value: template, categories: workspace2.categories, busy, onCancel: () => setTemplateId(void 0), onSave: async (input) => {
      const ok = await act(template ? { action: "template.update", id: template.id, patch: input } : { action: "template.create", input });
      if (ok) setTemplateId(void 0);
      return ok;
    } }, templateId),
    !workspace2.templates.length && templateId === void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-muted", children: "\u5C06\u5E38\u7528\u63CF\u8FF0\u548C\u76EE\u6807\u4FDD\u5B58\u4E3A\u6A21\u677F\uFF0C\u521B\u5EFA\u4EFB\u52A1\u65F6\u76F4\u63A5\u5957\u7528\u3002" }),
    workspace2.templates.map((row) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "tw-card tw-gap", "aria-label": `\u6A21\u677F\uFF1A${row.name}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: row.name }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Tag, { children: workspace2.categories.find((item) => item.id === row.categoryId)?.name ?? "\u672A\u5206\u7C7B" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "tw-description tw-muted", children: row.goal }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { size: "sm", disabled: busy, onClick: () => setTemplateId(row.id), children: "\u7F16\u8F91\u6A21\u677F" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DeleteAction, { label: `\u5220\u9664\u6A21\u677F ${row.name}`, disabled: busy, onDelete: () => act({ action: "template.delete", id: row.id }) })
      ] })
    ] }, row.id))
  ] });
}

// src/interception-ui/client.tsx
var import_react7 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/interception-ui/forms.tsx
var import_react6 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/interception-ui/api.ts
var HttpError = class extends Error {
  constructor(message2, status) {
    super(message2);
    this.status = status;
  }
};
function endpoint2(path) {
  const base = new URL(document.baseURI);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(`api/redteam/interception/${path}`, base);
}
async function request(path, options = {}) {
  const response = await fetch(endpoint2(path), {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    ...options.method ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body ?? {}) } : {}
  });
  const body = await response.json();
  if (!response.ok) {
    const message2 = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : response.status === 409 ? "\u8FD9\u6761\u5BA1\u6279\u5DF2\u7531\u5176\u4ED6\u64CD\u4F5C\u5904\u7406\uFF0C\u5DF2\u91CD\u65B0\u8BFB\u53D6\u6700\u65B0\u72B6\u6001\u3002" : `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`;
    throw new HttpError(message2, response.status);
  }
  return body;
}
function listPath(view, taskId, page) {
  const query = new URLSearchParams({ offset: String(page * 30), limit: "30" });
  if (taskId.trim()) query.set("task_id", taskId.trim());
  return `${view}?${query}`;
}

// src/interception-ui/forms.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var freshRule = () => ({ name: "", enabled: true, priority: 0, matchTarget: "tool_name", matchType: "string", pattern: "", action: "ask", message: "", timeoutEnabled: true, timeoutSeconds: 300, timeoutAction: "deny" });
function ActionSelect({ label: label2, value, change, ask = true }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": label2, value, onChange: (event) => change(event.target.value), children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "allow", children: "\u5141\u8BB8" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "deny", children: "\u62D2\u7EDD" }),
    ask && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "ask", children: "\u4EBA\u5DE5\u5BA1\u6279" })
  ] });
}
function RuleForm({ value, onSaved, onCancel }) {
  const [form, setForm] = import_react6.default.useState(() => value ? { name: value.name, enabled: value.enabled, priority: value.priority, matchTarget: value.matchTarget, matchType: value.matchType, pattern: value.pattern, action: value.action, message: value.message, timeoutEnabled: value.timeoutEnabled, timeoutSeconds: value.timeoutSeconds, timeoutAction: value.timeoutAction, ...value.taskId ? { taskId: value.taskId } : {} } : freshRule());
  const [busy, setBusy] = import_react6.default.useState(false), [error, setError] = import_react6.default.useState("");
  const patch = (update) => setForm((current) => ({ ...current, ...update }));
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`rules${value ? "/" + encodeURIComponent(value.id) : ""}`, { method: value ? "PUT" : "POST", body: form });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("form", { className: "tw-stack", "aria-label": value ? "\u7F16\u8F91\u62E6\u622A\u89C4\u5219" : "\u65B0\u5EFA\u62E6\u622A\u89C4\u5219", onSubmit: (event) => {
    void save(event);
  }, children: [
    error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u89C4\u5219\u540D\u79F0", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u89C4\u5219\u540D\u79F0", required: true, value: form.name, onChange: (event) => patch({ name: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u4EFB\u52A1 ID", hint: "\u7559\u7A7A\u5E94\u7528\u4E8E\u6240\u6709\u4EFB\u52A1\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u89C4\u5219\u4EFB\u52A1 ID", value: form.taskId ?? "", onChange: (event) => {
        const taskId = event.target.value;
        setForm((current) => {
          const next = { ...current };
          if (taskId) next.taskId = taskId;
          else delete next.taskId;
          return next;
        });
      } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Checkbox, { label: "\u542F\u7528\u89C4\u5219", checked: form.enabled, onChange: (enabled) => patch({ enabled }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u4F18\u5148\u7EA7", hint: "\u6570\u503C\u8D8A\u5927\u8D8A\u5148\u5339\u914D\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u4F18\u5148\u7EA7", type: "number", step: 1, required: true, value: form.priority, onChange: (event) => patch({ priority: Number(event.target.value) }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5339\u914D\u5BF9\u8C61", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": "\u5339\u914D\u5BF9\u8C61", value: form.matchTarget, onChange: (event) => patch({ matchTarget: event.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "tool_name", children: "\u5DE5\u5177\u540D\u79F0" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "tool_input", children: "\u5DE5\u5177\u53C2\u6570" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5339\u914D\u65B9\u5F0F", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { "aria-label": "\u5339\u914D\u65B9\u5F0F", value: form.matchType, onChange: (event) => patch({ matchType: event.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "string", children: "\u5305\u542B\u5B57\u7B26\u4E32" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "regex", children: "\u6B63\u5219\u8868\u8FBE\u5F0F\uFF08RE2\uFF09" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u547D\u4E2D\u540E\u64CD\u4F5C", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ActionSelect, { label: "\u547D\u4E2D\u540E\u64CD\u4F5C", value: form.action, change: (action) => patch({ action }) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5339\u914D\u8868\u8FBE\u5F0F", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("textarea", { "aria-label": "\u5339\u914D\u8868\u8FBE\u5F0F", rows: 3, required: true, value: form.pattern, onChange: (event) => patch({ pattern: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5224\u5B9A\u8BF4\u660E", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("textarea", { "aria-label": "\u5224\u5B9A\u8BF4\u660E", rows: 3, value: form.message, onChange: (event) => patch({ message: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Checkbox, { label: "\u542F\u7528\u5BA1\u6279\u8D85\u65F6", checked: form.timeoutEnabled, onChange: (timeoutEnabled) => patch({ timeoutEnabled }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5BA1\u6279\u8D85\u65F6\uFF08\u79D2\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u5BA1\u6279\u8D85\u65F6\uFF08\u79D2\uFF09", type: "number", step: 1, required: true, value: form.timeoutSeconds, onChange: (event) => patch({ timeoutSeconds: Number(event.target.value) }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u8D85\u65F6\u64CD\u4F5C", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ActionSelect, { label: "\u8D85\u65F6\u64CD\u4F5C", ask: false, value: form.timeoutAction, change: (timeoutAction) => patch({ timeoutAction }) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { type: "submit", size: "sm", variant: "primary", children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u89C4\u5219" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { type: "button", size: "sm", onClick: onCancel, children: "\u53D6\u6D88" })
      ] })
    ] })
  ] });
}
function JudgeSettings({ initial }) {
  const [judge, setJudge] = import_react6.default.useState(initial.judge), [tools, setTools] = import_react6.default.useState(initial.enabledTools.join("\n"));
  const [busy, setBusy] = import_react6.default.useState(false), [error, setError] = import_react6.default.useState(""), [notice, setNotice] = import_react6.default.useState("");
  const patch = (value) => setJudge((current) => ({ ...current, ...value }));
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await request("settings", { method: "PUT", body: { enabledTools: tools.split("\n").map((row) => row.trim()).filter(Boolean), judge } });
      setTools(saved.enabledTools.join("\n"));
      setJudge(saved.judge);
      setNotice("\u5BA1\u6279\u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("form", { "aria-label": "\u5BA1\u6279\u8BBE\u7F6E", className: "tw-stack", onSubmit: (event) => {
    void save(event);
  }, children: [
    error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u7EB3\u5165\u62E6\u622A\u7684\u5DE5\u5177", hint: "\u6BCF\u884C\u4E00\u4E2A\u51C6\u786E\u5DE5\u5177\u540D\uFF1B\u7559\u7A7A\u8868\u793A\u6CA1\u6709\u5DE5\u5177\u8FDB\u5165\u62E6\u622A\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("textarea", { "aria-label": "\u7EB3\u5165\u62E6\u622A\u7684\u5DE5\u5177", rows: 5, value: tools, onChange: (event) => setTools(event.target.value) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Checkbox, { label: "\u542F\u7528\u6A21\u578B\u5224\u5B9A", checked: judge.enabled, onChange: (enabled) => patch({ enabled }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5224\u5B9A\u6A21\u578B\u914D\u7F6E ID", hint: "\u586B\u5199\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u4E2D\u5DF2\u6CE8\u518C\u7684\u6A21\u578B\u914D\u7F6E ID\uFF1B\u7559\u7A7A\u6309\u8FD0\u884C\u65F6\u9ED8\u8BA4\u6A21\u578B\u8DEF\u7531\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u5224\u5B9A\u6A21\u578B\u914D\u7F6E ID", value: judge.profileId ?? "", onChange: (event) => patch({ profileId: event.target.value || null }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u5224\u5B9A\u63D0\u793A\u8BCD", hint: "\u7559\u7A7A\u6062\u590D\u539F\u7248\u9ED8\u8BA4\u63D0\u793A\u8BCD\uFF1B\u670D\u52A1\u4F1A\u4FDD\u7559\u8F93\u5165\u8FB9\u754C\u548C\u8F93\u51FA\u5951\u7EA6\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("textarea", { "aria-label": "\u5224\u5B9A\u63D0\u793A\u8BCD", rows: 12, value: judge.prompt, onChange: (event) => patch({ prompt: event.target.value }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u6A21\u578B\u5224\u5B9A\u8D85\u65F6\uFF08\u79D2\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u6A21\u578B\u5224\u5B9A\u8D85\u65F6\uFF08\u79D2\uFF09", required: true, type: "number", min: 1, step: 1, value: judge.timeoutSeconds, onChange: (event) => patch({ timeoutSeconds: Number(event.target.value) }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u6A21\u578B\u5224\u5B9A\u5931\u8D25\u65F6", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ActionSelect, { label: "\u6A21\u578B\u5224\u5B9A\u5931\u8D25\u65F6", value: judge.failAction, change: (failAction) => patch({ failAction }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\uFF08\u79D2\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Input, { "aria-label": "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\uFF08\u79D2\uFF09", required: true, type: "number", min: 1, step: 1, value: judge.askTimeoutSeconds, onChange: (event) => patch({ askTimeoutSeconds: Number(event.target.value) }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field2, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\u64CD\u4F5C", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ActionSelect, { label: "\u6A21\u578B\u8F6C\u4EBA\u5DE5\u8D85\u65F6\u64CD\u4F5C", ask: false, value: judge.askTimeoutAction, change: (askTimeoutAction) => patch({ askTimeoutAction }) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { type: "submit", size: "sm", variant: "primary", children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u5BA1\u6279\u8BBE\u7F6E" })
    ] })
  ] });
}

// src/interception-ui/client.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var labels = { pending: "\u5F85\u5BA1\u6279", allowed: "\u5DF2\u5141\u8BB8", denied: "\u5DF2\u62D2\u7EDD", timeout: "\u5DF2\u8D85\u65F6" };
var executionLabels = { pending: "\u7B49\u5F85\u5DE5\u5177\u7ED3\u679C", succeeded: "\u8C03\u7528\u6210\u529F", failed: "\u8C03\u7528\u5931\u8D25", not_executed: "\u672A\u6267\u884C", unknown: "\u7ED3\u679C\u672A\u77E5" };
var sourceLabels = { rule: "\u89C4\u5219", model: "\u6A21\u578B\u5224\u5B9A", manual: "\u4EBA\u5DE5" };
var actionLabels = { allow: "\u5141\u8BB8", deny: "\u62D2\u7EDD", ask: "\u4EBA\u5DE5\u5BA1\u6279" };
var styles = `${taskWorkspaceStyles}.ia-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);background:var(--dsw-alias-interactive-bg-hover);padding:8px;border-radius:var(--dsw-radius-sm);margin:0;max-height:420px;overflow:auto}.ia-record-button{text-align:left;white-space:normal;justify-content:flex-start!important;width:100%}.ia-detail{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.ia-reason{white-space:pre-wrap;overflow-wrap:anywhere}.ia-pager{display:flex;align-items:center;justify-content:space-between;gap:8px}`;
var time2 = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "\u5C1A\u672A\u51B3\u5B9A";
var errorText = (error) => error instanceof Error ? error.message : String(error);
function Json2({ value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("pre", { className: "ia-json", children: JSON.stringify(value, null, 2) });
}
function InterceptionTab(props) {
  const id = import_react7.default.useId();
  const [view, setView] = import_react7.default.useState("pending"), [taskId, setTaskId] = import_react7.default.useState(""), [page, setPage] = import_react7.default.useState(0);
  const [records, setRecords] = import_react7.default.useState({ total: 0, items: [] }), [rules, setRules] = import_react7.default.useState([]), [settings, setSettings] = import_react7.default.useState();
  const [selected, setSelected] = import_react7.default.useState(""), [detail, setDetail] = import_react7.default.useState(), [execution, setExecution] = import_react7.default.useState();
  const [editing, setEditing] = import_react7.default.useState(), [deleteId, setDeleteId] = import_react7.default.useState("");
  const [loaded, setLoaded] = import_react7.default.useState(false), [loadError, setLoadError] = import_react7.default.useState(""), [error, setError] = import_react7.default.useState(""), [notice, setNotice] = import_react7.default.useState(""), [busy, setBusy] = import_react7.default.useState(false);
  const sequence = import_react7.default.useRef(0), busyRef = import_react7.default.useRef(false), alive = import_react7.default.useRef(true);
  const selectedRef = import_react7.default.useRef(selected);
  selectedRef.current = selected;
  import_react7.default.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = import_react7.default.useCallback(async (signal) => {
    if (busyRef.current) return;
    const current = ++sequence.current;
    try {
      if (view === "pending" || view === "history") {
        const [rows, record] = await Promise.all([request(listPath(view, taskId, page), { signal }), selected ? request(`records/${encodeURIComponent(selected)}`, { signal }) : void 0]);
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setRecords(rows);
        setDetail(record);
        if (page > 0 && page * 30 >= rows.total) setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
        if (record && execution) setExecution((previous) => previous ? { ...previous, execution: record.execution } : previous);
      } else if (view === "rules") {
        const rows = await request("rules", { signal });
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setRules(rows);
      } else {
        const value = await request("settings", { signal });
        if (signal?.aborted || !alive.current || current !== sequence.current) return;
        setSettings(value);
      }
      setLoaded(true);
      setLoadError("");
    } catch (failure) {
      if (!signal?.aborted && alive.current && current === sequence.current) setLoadError(errorText(failure));
    }
  }, [view, taskId, page, selected, Boolean(execution)]);
  const latestRefresh = import_react7.default.useRef(refresh);
  latestRefresh.current = refresh;
  import_react7.default.useEffect(() => {
    if (props.visible === false) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      await refresh(controller.signal);
      if (!controller.signal.aborted && (view === "pending" || view === "history")) timer = setTimeout(() => {
        void poll();
      }, 2e3);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh, props.visible]);
  async function mutate(path, method, body, message2) {
    if (busyRef.current) return false;
    busyRef.current = true;
    ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    let success = false;
    try {
      await request(path, { method, body });
      if (alive.current) setNotice(message2);
      success = true;
    } catch (failure) {
      if (alive.current) setError(errorText(failure));
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        await latestRefresh.current();
      }
    }
    return success;
  }
  function changeView(value) {
    if (busyRef.current || value === view) return;
    ++sequence.current;
    setView(value);
    setPage(0);
    setLoaded(false);
    setError("");
    setNotice("");
    setEditing(void 0);
    setDeleteId("");
    if (value === "settings") setSettings(void 0);
  }
  async function openExecution(record) {
    setError("");
    try {
      const result = await request(`records/${encodeURIComponent(record.id)}/execution`);
      if (alive.current && selectedRef.current === record.id) setExecution(result);
    } catch (failure) {
      if (alive.current && selectedRef.current === record.id) setError(errorText(failure));
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "tw-root", "aria-label": "\u4EBA\u5DE5\u5BA1\u6279\u5DE5\u4F5C\u53F0", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("style", { children: styles }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "tw-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h2", { children: "\u5DE5\u5177\u5BA1\u6279" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u5237\u65B0" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "tw-toolbar", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.SegmentedTabs, { label: "\u5BA1\u6279\u89C6\u56FE", value: view, onChange: changeView, items: [
      { value: "pending", label: "\u5F85\u5BA1\u6279", id: `${id}-pending`, panelId: `${id}-pending-panel` },
      { value: "history", label: "\u5386\u53F2", id: `${id}-history`, panelId: `${id}-history-panel` },
      { value: "rules", label: "\u89C4\u5219", id: `${id}-rules`, panelId: `${id}-rules-panel` },
      { value: "settings", label: "\u8BBE\u7F6E", id: `${id}-settings`, panelId: `${id}-settings-panel` }
    ] }) }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      "\u540C\u6B65\u5931\u8D25\uFF1A",
      loadError,
      "\u3002\u4FDD\u7559\u5DF2\u52A0\u8F7D\u6570\u636E\u3002"
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "tw-notice", role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "tw-notice", role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-scroll tw-stack", role: "tabpanel", id: `${id}-${view}-panel`, "aria-labelledby": `${id}-${view}`, children: [
      !loaded && !loadError && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u5BA1\u6279\u6570\u636E\u2026" }),
      (view === "pending" || view === "history") && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Input, { "aria-label": "\u6309\u4EFB\u52A1 ID \u7B5B\u9009\u5BA1\u6279", placeholder: "\u6309\u4EFB\u52A1 ID \u7B5B\u9009", value: taskId, onChange: (event) => {
          setTaskId(event.target.value);
          setPage(0);
          setSelected("");
          setDetail(void 0);
          setExecution(void 0);
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "tw-muted", children: [
          view === "pending" ? "\u5F85\u4EBA\u5DE5\u51B3\u5B9A" : "\u5168\u90E8\u5BA1\u6279\u8BB0\u5F55",
          " \xB7 ",
          records.total,
          " \u6761"
        ] }),
        loaded && records.items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "tw-empty", children: view === "pending" ? "\u5F53\u524D\u6CA1\u6709\u5F85\u5904\u7406\u7684\u5BA1\u6279\u3002" : "\u6CA1\u6709\u5339\u914D\u7684\u5BA1\u6279\u8BB0\u5F55\u3002" }),
        records.items.map((record) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: `tw-card ${selected === record.id ? "tw-card-selected" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_dsh_client_ui_primitives7.Button, { size: "sm", className: "ia-record-button", onClick: () => {
            setSelected(record.id);
            setDetail(void 0);
            setExecution(void 0);
          }, "aria-label": `\u67E5\u770B\u5BA1\u6279 ${record.toolName} ${record.id}`, children: [
            record.toolName,
            " \xB7 ",
            labels[record.status]
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "tw-small tw-muted", children: [
            record.taskId ?? "\u672A\u5173\u8054\u4EFB\u52A1",
            " \xB7 ",
            time2(record.createdAt)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ia-reason", children: record.reason })
        ] }, record.id)),
        records.total > 30 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("nav", { className: "ia-pager", "aria-label": "\u5BA1\u6279\u5206\u9875", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: page === 0, onClick: () => setPage((value) => value - 1), children: "\u4E0A\u4E00\u9875" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
            page + 1,
            " / ",
            Math.ceil(records.total / 30),
            " \u9875"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: (page + 1) * 30 >= records.total, onClick: () => setPage((value) => value + 1), children: "\u4E0B\u4E00\u9875" })
        ] }),
        detail && detail.id === selected && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "ia-detail tw-stack", "aria-label": "\u5BA1\u6279\u8BE6\u60C5", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: detail.toolName }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Tag, { tone: detail.status === "pending" ? "warning" : detail.effectiveAction === "allow" ? "success" : "danger", children: labels[detail.status] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("dl", { className: "tw-kv", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: "\u5BA1\u6279 ID" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: detail.id }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: "\u4EFB\u52A1" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: detail.taskId ?? "\u672A\u5173\u8054\u4EFB\u52A1" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: "\u5224\u5B9A\u6765\u6E90" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: sourceLabels[detail.decisionSource] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: "\u5339\u914D\u89C4\u5219" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: detail.ruleName ?? detail.ruleId ?? "\u65E0" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: "\u51B3\u5B9A\u65F6\u95F4" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: time2(detail.decidedAt) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: "\u5224\u5B9A\u7406\u7531" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ia-reason", children: detail.reason }),
            detail.decisionReason && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ia-reason", children: detail.decisionReason })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: "\u5B8C\u6574\u5DE5\u5177\u53C2\u6570" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Json2, { value: detail.toolInput })
          ] }),
          detail.status === "pending" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => {
              void mutate(`records/${encodeURIComponent(detail.id)}/decide`, "POST", { allowed: true, ...detail.taskId ? { taskId: detail.taskId } : {} }, "\u5DF2\u5141\u8BB8\u8FD9\u6761\u5DE5\u5177\u8C03\u7528");
            }, children: "\u5141\u8BB8\u672C\u6B21\u8C03\u7528" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => {
              void mutate(`records/${encodeURIComponent(detail.id)}/decide`, "POST", { allowed: false, ...detail.taskId ? { taskId: detail.taskId } : {} }, "\u5DF2\u62D2\u7EDD\u8FD9\u6761\u5DE5\u5177\u8C03\u7528");
            }, children: "\u62D2\u7EDD\u672C\u6B21\u8C03\u7528" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("h3", { children: [
              "\u8C03\u7528\u7ED3\u679C \xB7 ",
              executionLabels[detail.execution.status]
            ] }),
            detail.execution.output !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("pre", { className: "ia-json", children: detail.execution.output }),
            detail.execution.truncated && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "tw-muted", children: "\u4FDD\u5B58\u7684\u7ED3\u679C\u5DF2\u622A\u65AD\uFF0C\u53EF\u524D\u5F80\u4F1A\u8BDD\u67E5\u770B\u539F\u59CB\u8C03\u7528\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", onClick: () => {
              void openExecution(detail);
            }, children: "\u67E5\u770B\u6267\u884C\u5173\u8054" }),
            execution && props.onSubagentJump && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", onClick: () => props.onSubagentJump?.(execution.sessionId), children: "\u6253\u5F00\u8C03\u7528\u4F1A\u8BDD" })
          ] }),
          execution && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Json2, { value: execution }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("summary", { children: "\u5B8C\u6574\u5224\u5B9A\u8BB0\u5F55\u4E0E\u6A21\u578B\u8F93\u5165" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Json2, { value: detail })
          ] })
        ] })
      ] }),
      view === "rules" && (editing ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RuleForm, { value: editing === "new" ? void 0 : editing, onCancel: () => setEditing(void 0), onSaved: () => {
        setEditing(void 0);
        setNotice("\u89C4\u5219\u5DF2\u4FDD\u5B58");
        void refresh();
      } }, editing === "new" ? "new" : editing.id) : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", onClick: () => setEditing("new"), children: "\u65B0\u5EFA\u89C4\u5219" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "tw-muted", children: "\u6309\u4F18\u5148\u7EA7\u964D\u5E8F\u6267\u884C\uFF1B\u540C\u4F18\u5148\u7EA7\u4FDD\u6301\u521B\u5EFA\u987A\u5E8F\u3002" }),
        loaded && rules.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "\u5C1A\u65E0\u62E6\u622A\u89C4\u5219\u3002" }),
        rules.map((rule) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("article", { className: "tw-card tw-stack", "aria-label": `\u89C4\u5219 ${rule.name}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: rule.name }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Tag, { tone: rule.enabled ? "info" : "outline", children: rule.enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u505C\u7528" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { children: [
            rule.taskId ?? "\u6240\u6709\u4EFB\u52A1",
            " \xB7 \u4F18\u5148\u7EA7 ",
            rule.priority,
            " \xB7 ",
            rule.matchTarget === "tool_name" ? "\u5DE5\u5177\u540D\u79F0" : "\u5DE5\u5177\u53C2\u6570",
            " / ",
            rule.matchType === "regex" ? "\u6B63\u5219\u8868\u8FBE\u5F0F" : "\u5305\u542B\u5B57\u7B26\u4E32",
            " \u2192 ",
            actionLabels[rule.action]
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("pre", { className: "ia-json", children: rule.pattern }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "ia-reason", children: rule.message }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => setEditing(rule), children: "\u7F16\u8F91\u89C4\u5219" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => {
              void mutate(`rules/${encodeURIComponent(rule.id)}/toggle`, "POST", { enabled: !rule.enabled }, rule.enabled ? "\u89C4\u5219\u5DF2\u505C\u7528" : "\u89C4\u5219\u5DF2\u542F\u7528");
            }, children: rule.enabled ? "\u505C\u7528\u89C4\u5219" : "\u542F\u7528\u89C4\u5219" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => setDeleteId(rule.id), children: "\u5220\u9664\u89C4\u5219" })
          ] }),
          deleteId === rule.id && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
              "\u5220\u9664\u300C",
              rule.name,
              "\u300D\uFF1F"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", disabled: busy, onClick: () => {
              void mutate(`rules/${encodeURIComponent(rule.id)}`, "DELETE", {}, "\u89C4\u5219\u5DF2\u5220\u9664").then((success) => {
                if (success) setDeleteId("");
              });
            }, children: "\u786E\u8BA4\u5220\u9664\u89C4\u5219" }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.Button, { size: "sm", onClick: () => setDeleteId(""), children: "\u53D6\u6D88\u5220\u9664" })
          ] })
        ] }, rule.id))
      ] })),
      view === "settings" && settings && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(JudgeSettings, { initial: settings })
    ] })
  ] });
}

// src/asset-management/client.tsx
var import_react11 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/asset-management/client-api.ts
function managementEndpoint(path) {
  const base = new URL(document.baseURI);
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(`api/redteam/asset-management/${path.replace(/^\/+/, "")}`, base);
}
async function request2(path, options = {}) {
  const response = await fetch(managementEndpoint(path), {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
    ...options.body === void 0 ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }
  });
  const body = await response.json();
  if (!response.ok) {
    const message2 = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`;
    throw new Error(message2);
  }
  return body;
}

// src/asset-management/company-panel.tsx
var import_react8 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime8 = require("react/jsx-runtime");
var errorText2 = (error) => error instanceof Error ? error.message : String(error);
var scopeLabels = { domain: "\u57DF\u540D", ip: "IP \u5730\u5740", cidr: "\u7F51\u6BB5", icp: "\u5907\u6848\u53F7", keyword: "\u5173\u952E\u8BCD" };
function scopeValue(scope) {
  return scope.domain || scope.net || scope.value || scope.raw || "";
}
function scopeEditorText(scopes) {
  return scopes.map((scope) => `${scope.kind}: ${scope.kind === "ip" ? scopeValue(scope).split("/")[0] : scopeValue(scope)}`).join("\n");
}
function scopeInputs(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const typed = /^(domain|ip|cidr|icp|keyword)\s*:\s*(.*)$/i.exec(line);
    return typed ? { kind: typed[1].toLowerCase(), value: typed[2] } : line;
  });
}
function mutationMessage(label2, result) {
  const parts = [label2], added = result.scope_added ?? result.added, skipped = result.scope_skipped ?? result.skipped, invalid = result.scope_invalid ?? result.invalid;
  if (added !== void 0) parts.push(`\u8303\u56F4\u89C4\u5219\uFF1A\u65B0\u589E ${added} \u6761\uFF0C\u91CD\u590D ${skipped ?? 0} \u6761\uFF0C\u65E0\u6548 ${invalid ?? 0} \u6761\u3002`);
  if (result.assets_deleted !== void 0) parts.push(`\u5220\u9664\u8D44\u4EA7 ${result.assets_deleted} \u6761\u3002`);
  if (result.updated !== void 0) parts.push(`\u66F4\u65B0\u4E86 ${result.updated} \u6761\u8D44\u4EA7\u7684\u516C\u53F8\u5F52\u5C5E\u3002`);
  const errors = result.scope_errors ?? result.errors;
  if (errors?.length) parts.push(`\u4EE5\u4E0B\u8303\u56F4\u672A\u4FDD\u5B58\uFF1A
${errors.join("\n")}`);
  if (result.warnings?.length) parts.push(result.warnings.join("\n"));
  return parts.join("\n");
}
function CompanyPanel() {
  const [companies, setCompanies] = import_react8.default.useState([]), [loaded, setLoaded] = import_react8.default.useState(false);
  const [loading, setLoading] = import_react8.default.useState(true), [busy, setBusy] = import_react8.default.useState(false);
  const [loadError, setLoadError] = import_react8.default.useState(""), [actionError, setActionError] = import_react8.default.useState(""), [notice, setNotice] = import_react8.default.useState("");
  const [selected, setSelected] = import_react8.default.useState(""), [creating, setCreating] = import_react8.default.useState(false), [query, setQuery] = import_react8.default.useState("");
  const [revision, refresh] = import_react8.default.useReducer((value) => value + 1, 0);
  const lifetime = import_react8.default.useRef(null), mutationPending = import_react8.default.useRef(false);
  import_react8.default.useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  import_react8.default.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void request2("companies", { signal: controller.signal }).then((rows) => {
      if (!controller.signal.aborted) {
        setCompanies(rows);
        setLoaded(true);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(errorText2(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);
  const mutate = async (path, body, label2, method = "POST") => {
    if (mutationPending.current) return;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await request2(path, { method, body, signal });
      if (signal.aborted) return;
      setNotice(mutationMessage(label2, result));
      refresh();
      return result;
    } catch (error) {
      if (!signal.aborted) setActionError(errorText2(error));
      return;
    } finally {
      mutationPending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  const filtered = companies.filter((company) => company.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "tw-root", "aria-label": "\u516C\u53F8\u7BA1\u7406", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: taskWorkspaceStyles }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("header", { className: "tw-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { children: "\u516C\u53F8\u4E0E\u8303\u56F4" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy || loading, onClick: () => refresh(), children: loading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u5237\u65B0\u516C\u53F8" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => {
          setCreating(true);
          setSelected("");
          setActionError("");
          setNotice("");
        }, children: "\u65B0\u5EFA\u516C\u53F8" })
      ] })
    ] }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      "\u516C\u53F8\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A",
      loadError,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy || loading, onClick: () => refresh(), children: "\u91CD\u8BD5\u52A0\u8F7D\u516C\u53F8" })
    ] }),
    actionError && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "tw-notice", role: "alert", children: actionError }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "tw-notice", role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Input, { className: "tw-grow", "aria-label": "\u641C\u7D22\u516C\u53F8", placeholder: "\u641C\u7D22\u516C\u53F8\u540D\u79F0", value: query, disabled: busy, onChange: (event) => setQuery(event.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy || loading, onClick: () => {
        void mutate("companies/reattribute", {}, "\u5DF2\u91CD\u65B0\u8BA1\u7B97\u516C\u53F8\u5F52\u5C5E\u3002");
      }, children: "\u91CD\u65B0\u8BA1\u7B97\u5F52\u5C5E" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-scroll tw-stack", "aria-busy": busy || loading, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "tw-muted", children: "\u8303\u56F4\u7528\u4E8E\u81EA\u52A8\u5339\u914D\u8D44\u4EA7\u6240\u5C5E\u516C\u53F8\u3002\u57DF\u540D\u3001\u7F51\u6BB5\u548C\u5907\u6848\u53F7\u53C2\u4E0E\u5339\u914D\uFF1B\u5173\u952E\u8BCD\u7528\u4E8E\u63CF\u8FF0\u8303\u56F4\u3002" }),
      busy && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", className: "tw-muted", children: "\u6B63\u5728\u4FDD\u5B58\uFF0C\u8BF7\u7A0D\u5019\u2026" }),
      creating && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(NewCompany, { busy, mutate, onCancel: () => setCreating(false), onCreated: (id) => {
        setCreating(false);
        setSelected(id);
      } }),
      selected && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(CompanyDetail, { id: selected, assetCount: companies.find((company) => company.id === selected)?.asset_count, revision, busy, mutate, onBack: () => setSelected(""), onDeleted: () => setSelected("") }, selected),
      !selected && !creating && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-stack", children: [
        loading && !loaded ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u516C\u53F8\u2026" }) : loaded && !filtered.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: companies.length ? "\u6CA1\u6709\u5339\u914D\u7684\u516C\u53F8" : "\u8FD8\u6CA1\u6709\u516C\u53F8" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: companies.length ? "\u8C03\u6574\u641C\u7D22\u540D\u79F0\u540E\u91CD\u8BD5\u3002" : "\u521B\u5EFA\u516C\u53F8\u5E76\u6DFB\u52A0\u8303\u56F4\uFF0C\u5DF2\u6709\u8D44\u4EA7\u4F1A\u6309\u8303\u56F4\u91CD\u65B0\u5339\u914D\u5F52\u5C5E\u3002" })
        ] }) : null,
        filtered.map((company) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("article", { className: "tw-card tw-gap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", className: "tw-task-button", disabled: busy, onClick: () => {
              setSelected(company.id);
              setActionError("");
              setNotice("");
            }, children: company.name }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "tw-muted", children: [
              company.asset_count,
              " \u6761\u8D44\u4EA7"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-muted", children: [
            company.scope.length,
            " \u6761\u8303\u56F4\u89C4\u5219"
          ] }),
          company.scope.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-description tw-small", children: [
            company.scope.slice(0, 3).map(scopeValue).join(" \xB7 "),
            company.scope.length > 3 ? " \u2026" : ""
          ] })
        ] }, company.id))
      ] })
    ] })
  ] });
}
function NewCompany({ busy, mutate, onCancel, onCreated }) {
  const [name, setName] = import_react8.default.useState(""), [logo, setLogo] = import_react8.default.useState(""), [scope, setScope] = import_react8.default.useState("");
  async function submit(event) {
    event.preventDefault();
    const result = await mutate("companies", { name: name.trim(), ...logo.trim() ? { logo: logo.trim() } : {}, scope: scopeInputs(scope) }, "\u516C\u53F8\u5DF2\u521B\u5EFA\u3002");
    if (result?.id) onCreated(result.id);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("form", { className: "tw-card tw-stack", "aria-label": "\u65B0\u5EFA\u516C\u53F8", onSubmit: (event) => {
    void submit(event);
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u65B0\u5EFA\u516C\u53F8" }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "tw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: "\u516C\u53F8\u540D\u79F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Input, { "aria-label": "\u516C\u53F8\u540D\u79F0", required: true, value: name, onChange: (event) => setName(event.target.value), placeholder: "\u4F8B\u5982\uFF1A\u793A\u4F8B\u79D1\u6280" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "tw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: "Logo \u5730\u5740\uFF08\u53EF\u9009\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Input, { "aria-label": "\u516C\u53F8 Logo \u5730\u5740", value: logo, onChange: (event) => setLogo(event.target.value), placeholder: "https://\u2026" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "tw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: "\u521D\u59CB\u8303\u56F4\uFF08\u6BCF\u884C\u4E00\u6761\uFF09" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("textarea", { "aria-label": "\u521D\u59CB\u516C\u53F8\u8303\u56F4", rows: 6, value: scope, onChange: (event) => setScope(event.target.value), placeholder: "example.com\n192.0.2.0/24\n\u4EACICP\u5907123\u53F7\nkeyword: \u793A\u4F8B\u54C1\u724C" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: "\u652F\u6301\u57DF\u540D\u3001IP\u3001\u7F51\u6BB5\u3001\u5907\u6848\u53F7\u548C\u5173\u952E\u8BCD\u3002\u53EF\u7528 domain:\u3001ip:\u3001cidr:\u3001icp:\u3001keyword: \u660E\u786E\u7C7B\u578B\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { type: "submit", size: "sm", variant: "primary", disabled: !name.trim() || busy, children: busy ? "\u521B\u5EFA\u4E2D\u2026" : "\u521B\u5EFA\u516C\u53F8" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { type: "button", size: "sm", disabled: busy, onClick: onCancel, children: "\u53D6\u6D88\u521B\u5EFA" })
      ] })
    ] })
  ] });
}
function CompanyDetail({ id, assetCount, revision, busy, mutate, onBack, onDeleted }) {
  const [detail, setDetail] = import_react8.default.useState();
  const [loading, setLoading] = import_react8.default.useState(true), [error, setError] = import_react8.default.useState(""), [attempt, retry] = import_react8.default.useReducer((value) => value + 1, 0);
  const [scope, setScope] = import_react8.default.useState(""), [reset, setReset] = import_react8.default.useState(false), [reason, setReason] = import_react8.default.useState("");
  const [deleteAssets, setDeleteAssets] = import_react8.default.useState(false), [confirming, setConfirming] = import_react8.default.useState(false);
  const path = `companies/${encodeURIComponent(id)}`;
  import_react8.default.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void request2(path, { signal: controller.signal }).then((row) => {
      if (!controller.signal.aborted) setDetail(row);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(errorText2(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [path, revision, attempt]);
  async function save(event) {
    event.preventDefault();
    const result = await mutate(`${path}/scope`, { scope: scopeInputs(scope), reset, reason: reason.trim() }, reset ? "\u516C\u53F8\u8303\u56F4\u5DF2\u66FF\u6362\u3002" : "\u5DF2\u8FFD\u52A0\u516C\u53F8\u8303\u56F4\u3002");
    if (result) {
      setScope("");
      setReset(false);
      setReason("");
    }
  }
  const disabled = busy || loading || Boolean(error);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "\u516C\u53F8\u8BE6\u60C5", "aria-busy": loading || busy, children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-inline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { className: "tw-grow", children: detail?.company.name ?? "\u516C\u53F8\u8BE6\u60C5" }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy, onClick: onBack, children: "\u8FD4\u56DE\u516C\u53F8\u5217\u8868" })
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "tw-muted", role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u516C\u53F8\u8BE6\u60C5\u2026" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      error,
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy || loading, onClick: () => retry(), children: "\u91CD\u8BD5\u516C\u53F8\u8BE6\u60C5" })
    ] }),
    detail && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-muted", children: [
        assetCount === void 0 ? "" : `${assetCount} \u6761\u8D44\u4EA7 \xB7 `,
        detail.scope.length,
        " \u6761\u8303\u56F4\u89C4\u5219"
      ] }),
      detail.company.logo && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-description tw-small tw-muted", children: [
        "Logo \u5730\u5740\uFF1A",
        detail.company.logo
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "tw-gap", "aria-label": "\u5DF2\u4FDD\u5B58\u7684\u516C\u53F8\u8303\u56F4", children: !detail.scope.length ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "tw-muted", children: "\u5C1A\u672A\u8BBE\u7F6E\u8303\u56F4\u3002" }) : detail.scope.map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-record tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-inline", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "tw-muted", children: scopeLabels[item.kind] ?? item.kind }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "tw-row-content", children: scopeValue(item) })
        ] }),
        item.reason && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-small tw-muted tw-description", children: [
          "\u5907\u6CE8\uFF1A",
          item.reason
        ] })
      ] }, item.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("form", { className: "tw-section tw-stack", "aria-label": "\u7F16\u8F91\u516C\u53F8\u8303\u56F4", onSubmit: (event) => {
        void save(event);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u7F16\u8F91\u8303\u56F4" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("fieldset", { disabled, className: "tw-stack", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Checkbox, { label: "\u66FF\u6362\u5168\u90E8\u8303\u56F4", checked: reset, disabled, onChange: (checked) => {
            setReset(checked);
            setScope(checked ? scopeEditorText(detail.scope) : "");
          } }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "tw-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
              reset ? "\u66FF\u6362\u540E\u7684\u8303\u56F4" : "\u8FFD\u52A0\u8303\u56F4",
              "\uFF08\u6BCF\u884C\u4E00\u6761\uFF09"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("textarea", { "aria-label": "\u7F16\u8F91\u516C\u53F8\u8303\u56F4\u5185\u5BB9", rows: 6, value: scope, onChange: (event) => setScope(event.target.value), placeholder: "example.com\n192.0.2.0/24\nkeyword: \u793A\u4F8B\u54C1\u724C" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: reset ? "\u4FDD\u5B58\u65F6\u8986\u76D6\u5168\u90E8\u73B0\u6709\u89C4\u5219\uFF1B\u7559\u7A7A\u4F1A\u6E05\u7A7A\u8303\u56F4\uFF0C\u5E76\u91CD\u65B0\u8BA1\u7B97\u81EA\u52A8\u5F52\u5C5E\u3002\u65E0\u6548\u89C4\u5219\u4F1A\u963B\u6B62\u6574\u6B21\u66FF\u6362\u3002" : "\u73B0\u6709\u89C4\u5219\u4FDD\u6301\u4E0D\u53D8\uFF1B\u91CD\u590D\u89C4\u5219\u4F1A\u8DF3\u8FC7\uFF0C\u65E0\u6548\u89C4\u5219\u4F1A\u5728\u7ED3\u679C\u4E2D\u5217\u51FA\u3002" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "tw-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: "\u8303\u56F4\u53D8\u66F4\u5907\u6CE8\uFF08\u53EF\u9009\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Input, { "aria-label": "\u8303\u56F4\u53D8\u66F4\u5907\u6CE8", value: reason, onChange: (event) => setReason(event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { type: "submit", size: "sm", variant: "primary", disabled: disabled || !reset && !scope.trim(), children: reset ? "\u4FDD\u5B58\u66FF\u6362\u8303\u56F4" : "\u8FFD\u52A0\u8303\u56F4" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "tw-section tw-stack", "aria-label": "\u5220\u9664\u516C\u53F8", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: "\u5220\u9664\u516C\u53F8" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("fieldset", { disabled: disabled || confirming, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Checkbox, { label: "\u540C\u65F6\u5220\u9664\u8BE5\u516C\u53F8\u5F53\u524D\u5F52\u5C5E\u7684\u5168\u90E8\u8D44\u4EA7", checked: deleteAssets, disabled: disabled || confirming, onChange: setDeleteAssets }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "tw-muted", children: deleteAssets ? "\u8FD9\u4E9B\u8D44\u4EA7\u4E5F\u4F1A\u4ECE\u5F53\u524D\u4EFB\u52A1\u5F15\u7528\u4E2D\u79FB\u9664\uFF1B\u6F0F\u6D1E\u7684\u5386\u53F2\u8BC1\u636E\u8BB0\u5F55\u4FDD\u7559\u3002" : "\u4FDD\u7559\u5DF2\u6709\u8D44\u4EA7\uFF0C\u5220\u9664\u516C\u53F8\u8303\u56F4\uFF0C\u5E76\u6309\u5176\u4ED6\u516C\u53F8\u8303\u56F4\u91CD\u65B0\u5339\u914D\u8D44\u4EA7\u5F52\u5C5E\u3002" }),
        confirming ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-gap", role: "group", "aria-label": "\u786E\u8BA4\u5220\u9664\u516C\u53F8", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "tw-description", children: [
            "\u786E\u8BA4\u5220\u9664\u300C",
            detail.company.name,
            "\u300D",
            deleteAssets ? "\u53CA\u5F53\u524D\u5F52\u5C5E\u7684\u5168\u90E8\u8D44\u4EA7" : "\u5E76\u4FDD\u7559\u8D44\u4EA7",
            "\uFF1F"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled, onClick: () => {
              void mutate(path, { delete_assets: deleteAssets }, "\u516C\u53F8\u5DF2\u5220\u9664\u3002", "DELETE").then((result) => {
                if (result) onDeleted();
              });
            }, children: [
              "\u786E\u8BA4\u5220\u9664\u516C\u53F8",
              deleteAssets ? "\u53CA\u8D44\u4EA7" : ""
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled: busy, onClick: () => setConfirming(false), children: "\u53D6\u6D88\u5220\u9664" })
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { size: "sm", disabled, onClick: () => setConfirming(true), children: "\u5220\u9664\u516C\u53F8\u2026" })
      ] })
    ] })
  ] });
}

// src/asset-management/task-panel.tsx
var import_react9 = require("react");
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime9 = require("react/jsx-runtime");
var types = [["", "\u5168\u90E8\u7C7B\u578B"], ["root_domain", "\u6839\u57DF\u540D"], ["subdomain", "\u5B50\u57DF\u540D"], ["ip", "IP"], ["app", "\u5E94\u7528"], ["service", "\u670D\u52A1"], ["endpoint", "\u63A5\u53E3"]];
var errorText3 = (error) => error instanceof Error ? error.message : String(error);
var assetLabel = (asset) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;
function TaskAssetPanel() {
  const [tasks, setTasks] = (0, import_react9.useState)(), [taskId, setTaskId] = (0, import_react9.useState)("");
  const [error, setError] = (0, import_react9.useState)(""), [revision, setRevision] = (0, import_react9.useState)(0);
  (0, import_react9.useEffect)(() => {
    const controller = new AbortController();
    setError("");
    void request2("tasks", { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setTasks(data.tasks);
      setTaskId((current) => data.tasks.some((task) => task.id === current) ? current : data.tasks[0]?.id ?? "");
    }).catch((error2) => {
      if (!controller.signal.aborted) setError(errorText3(error2));
    });
    return () => controller.abort();
  }, [revision]);
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "tw-root", "aria-label": "\u4EFB\u52A1\u8D44\u4EA7", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("style", { children: taskWorkspaceStyles }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("header", { className: "tw-top", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h2", { children: "\u4EFB\u52A1\u8D44\u4EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", onClick: () => setRevision((value) => value + 1), children: "\u5237\u65B0\u4EFB\u52A1" })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      "\u4EFB\u52A1\u52A0\u8F7D\u5931\u8D25\uFF1A",
      error
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "tw-toolbar", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "tw-field tw-grow", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u9009\u62E9\u4EFB\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("select", { "aria-label": "\u9009\u62E9\u4EFB\u52A1", value: taskId, onChange: (event) => setTaskId(event.target.value), disabled: !tasks?.length, children: [
        !tasks?.length && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value: "", children: tasks ? "\u6682\u65E0\u4EFB\u52A1" : "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u2026" }),
        tasks?.map((task) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("option", { value: task.id, children: [
          task.title,
          " \xB7 ",
          task.status
        ] }, task.id))
      ] })
    ] }) }),
    taskId && tasks ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(TaskAssets, { taskId, tasks }, taskId) : tasks && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "tw-empty", children: "\u8BF7\u5148\u5728\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u521B\u5EFA\u4EFB\u52A1\u3002" })
  ] });
}
function TaskAssets({ taskId, tasks }) {
  const [type, setType] = (0, import_react9.useState)(""), [offset, setOffset] = (0, import_react9.useState)(0), [revision, setRevision] = (0, import_react9.useState)(0);
  const [page, setPage] = (0, import_react9.useState)(), [targets2, setTargets] = (0, import_react9.useState)();
  const [loading, setLoading] = (0, import_react9.useState)(true), [loadError, setLoadError] = (0, import_react9.useState)("");
  const [busy, setBusy] = (0, import_react9.useState)(false), [error, setError] = (0, import_react9.useState)(""), [notice, setNotice] = (0, import_react9.useState)("");
  const [ids, setIds] = (0, import_react9.useState)(""), [summary, setSummary] = (0, import_react9.useState)(""), [scope, setScope] = (0, import_react9.useState)("");
  const [detaching, setDetaching] = (0, import_react9.useState)(""), [selected, setSelected] = (0, import_react9.useState)("");
  const [refs, setRefs] = (0, import_react9.useState)(), [refsError, setRefsError] = (0, import_react9.useState)("");
  const lifetime = (0, import_react9.useRef)(null), pending = (0, import_react9.useRef)(false);
  const base = `tasks/${encodeURIComponent(taskId)}`;
  const taskName = (id) => tasks.find((task) => task.id === id)?.title ?? id;
  (0, import_react9.useEffect)(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  (0, import_react9.useEffect)(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setPage(void 0);
    setTargets(void 0);
    setSelected("");
    setDetaching("");
    const query = new URLSearchParams({ limit: "20", offset: String(offset), ...type ? { type } : {} });
    void Promise.all([
      request2(`${base}/assets?${query}`, { signal: controller.signal }),
      request2(`${base}/intent-assets`, { signal: controller.signal })
    ]).then(([assets, intents]) => {
      if (controller.signal.aborted) return;
      if (offset && offset >= assets.total) {
        setOffset(Math.max(0, Math.floor((assets.total - 1) / 20) * 20));
        return;
      }
      setPage(assets);
      setTargets(intents.assets);
    }).catch((error2) => {
      if (!controller.signal.aborted) setLoadError(errorText3(error2));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [base, type, offset, revision]);
  (0, import_react9.useEffect)(() => {
    setRefs(void 0);
    setRefsError("");
    if (!selected) return;
    const controller = new AbortController();
    void request2(`${base}/assets/${encodeURIComponent(selected)}/refs`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setRefs(data);
    }).catch((error2) => {
      if (!controller.signal.aborted) setRefsError(errorText3(error2));
    });
    return () => controller.abort();
  }, [base, selected, revision]);
  async function mutate(path, method, body, describe, clear) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const signal = lifetime.current?.signal;
    try {
      const result = await request2(path, { method, ...body === void 0 ? {} : { body }, signal });
      if (signal?.aborted) return;
      setNotice(describe(result));
      clear();
      setRevision((value) => value + 1);
    } catch (error2) {
      if (!signal?.aborted) setError(errorText3(error2));
    } finally {
      pending.current = false;
      if (!signal?.aborted) setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-scroll tw-stack", children: [
    error && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "tw-notice", role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "tw-notice", role: "status", children: notice }),
    busy && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: "\u6B63\u5728\u4FDD\u5B58\u2026" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { className: "tw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("summary", { children: "\u5173\u8054\u5DF2\u6709\u5168\u5C40\u8D44\u4EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("form", { className: "tw-stack", onSubmit: (event) => {
        event.preventDefault();
        const assetIds = [...new Set(ids.split(/[\s,，]+/u).filter(Boolean))];
        if (!assetIds.length || !summary.trim()) {
          setError("\u8BF7\u586B\u5199\u8D44\u4EA7 ID \u548C\u5173\u8054\u6765\u6E90\u8BF4\u660E\u3002");
          return;
        }
        void mutate(`${base}/assets`, "POST", { asset_ids: assetIds, source_summary: summary.trim() }, (result) => `\u5DF2\u5173\u8054 ${result.attached} \u6761\u8D44\u4EA7\uFF0C${result.existing} \u6761\u5DF2\u5173\u8054\u8D44\u4EA7\u7684\u6765\u6E90\u5DF2\u66F4\u65B0\u3002`, () => {
          setIds("");
          setSummary("");
        });
      }, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("fieldset", { className: "tw-stack", disabled: busy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u5168\u5C40\u8D44\u4EA7 ID" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("textarea", { required: true, "aria-label": "\u5168\u5C40\u8D44\u4EA7 ID", value: ids, onChange: (event) => setIds(event.target.value), placeholder: "\u6BCF\u884C\u4E00\u4E2A ID\uFF0C\u4E5F\u53EF\u7528\u9017\u53F7\u5206\u9694\uFF1B\u6BCF\u6B21\u6700\u591A 100 \u6761" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u6765\u6E90\u8BF4\u660E\uFF08\u5FC5\u586B\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Input, { required: true, "aria-label": "\u5173\u8054\u6765\u6E90\u8BF4\u660E", value: summary, onChange: (event) => setSummary(event.target.value), placeholder: "\u4E3A\u4F55\u5C06\u8FD9\u4E9B\u8D44\u4EA7\u52A0\u5165\u5F53\u524D\u4EFB\u52A1" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { type: "submit", size: "sm", variant: "primary", children: "\u5173\u8054\u8D44\u4EA7" })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { className: "tw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("summary", { children: "\u6309\u8303\u56F4\u767B\u8BB0\u6D4B\u8BD5\u8D44\u4EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("form", { className: "tw-stack", onSubmit: (event) => {
        event.preventDefault();
        const lines2 = scope.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
        if (!lines2.length) {
          setError("\u8BF7\u586B\u5199\u81F3\u5C11\u4E00\u6761\u8303\u56F4\u3002");
          return;
        }
        void mutate(`${base}/assets`, "POST", { scope: lines2 }, (result) => `\u65B0\u589E ${result.scopes_added} \u6761\u8303\u56F4\uFF0C${result.scopes_existing} \u6761\u5DF2\u5B58\u5728\uFF1B\u5173\u8054 ${result.assets_linked} \u6761\u8D44\u4EA7\uFF0C${result.assets_existing} \u6761\u5DF2\u5173\u8054\u3002`, () => setScope(""));
      }, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u8303\u56F4\uFF08\u6BCF\u884C\u4E00\u6761\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("textarea", { required: true, "aria-label": "\u4EFB\u52A1\u8D44\u4EA7\u8303\u56F4", value: scope, onChange: (event) => setScope(event.target.value), placeholder: "example.com\n192.0.2.10\n192.0.2.0/24" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("small", { children: "\u652F\u6301\u57DF\u540D\u3001IP\u3001CIDR\u3001ICP\u5907\u6848\u53CA\u5173\u952E\u8BCD\u3002\u57DF\u540D\u548C IP \u4F1A\u5173\u8054\u8D44\u4EA7\uFF1B\u5176\u4ED6\u89C4\u5219\u767B\u8BB0\u4E3A\u4EFB\u52A1\u8303\u56F4\u3002\u4EFB\u4E00\u6761\u65E0\u6548\u65F6\u6574\u6279\u4E0D\u4FDD\u5B58\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { type: "submit", size: "sm", variant: "primary", children: "\u767B\u8BB0\u8303\u56F4" })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("label", { className: "tw-field tw-grow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: "\u8D44\u4EA7\u7C7B\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("select", { value: type, disabled: busy, "aria-label": "\u4EFB\u52A1\u8D44\u4EA7\u7C7B\u578B", onChange: (event) => {
          setType(event.target.value);
          setOffset(0);
        }, children: types.map(([value, label2]) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("option", { value, children: label2 }, value)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy || loading, onClick: () => setRevision((value) => value + 1), children: "\u5237\u65B0\u8D44\u4EA7" })
    ] }),
    loadError && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-notice", role: "alert", children: [
      "\u52A0\u8F7D\u5931\u8D25\uFF1A",
      loadError
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4EFB\u52A1\u8D44\u4EA7\u4E0E\u610F\u56FE\u76EE\u6807\u2026" }),
    page && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-muted", children: [
        "\u5171 ",
        page.total,
        " \u6761\u5173\u8054\u8D44\u4EA7"
      ] }),
      !page.assets.length && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "tw-empty", children: "\u5F53\u524D\u7B5B\u9009\u4E0B\u6CA1\u6709\u5173\u8054\u8D44\u4EA7\u3002" }),
      page.assets.map((asset) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("article", { className: "tw-card tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { className: "tw-title", children: assetLabel(asset) }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-small tw-muted tw-description", children: [
          asset.type,
          " \xB7 ",
          asset.id
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-description", children: [
          "\u6765\u6E90\uFF1A",
          asset.task_source || "\u672A\u8BB0\u5F55",
          asset.task_source_summary ? ` \xB7 ${asset.task_source_summary}` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy, onClick: () => setSelected((value) => value === asset.id ? "" : asset.id), children: selected === asset.id ? "\u6536\u8D77\u5F15\u7528" : "\u67E5\u770B\u5F15\u7528" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy, onClick: () => setDetaching(asset.id), children: "\u89E3\u9664\u5173\u8054" })
        ] }),
        detaching === asset.id && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-gap", role: "group", "aria-label": "\u786E\u8BA4\u89E3\u9664\u5173\u8054", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { children: [
            "\u786E\u8BA4\u4ECE\u5F53\u524D\u4EFB\u52A1\u79FB\u9664 ",
            assetLabel(asset),
            "\uFF1F\u5168\u5C40\u8D44\u4EA7\u548C\u5386\u53F2\u5F15\u7528\u4F1A\u4FDD\u7559\u3002"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy, onClick: () => {
              void mutate(`${base}/assets/${encodeURIComponent(asset.id)}`, "DELETE", void 0, () => "\u5DF2\u89E3\u9664\u4EFB\u52A1\u5173\u8054\uFF0C\u4FDD\u7559\u5168\u5C40\u8D44\u4EA7\u548C\u5386\u53F2\u5F15\u7528\u3002", () => setDetaching(""));
            }, children: "\u786E\u8BA4\u89E3\u9664\u5173\u8054" }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy, onClick: () => setDetaching(""), children: "\u53D6\u6D88" })
          ] })
        ] }),
        selected === asset.id && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("section", { className: "tw-section tw-gap", "aria-label": "\u8D44\u4EA7\u5F15\u7528", children: refsError ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { role: "alert", children: [
          "\u5F15\u7528\u52A0\u8F7D\u5931\u8D25\uFF1A",
          refsError,
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", onClick: () => setSelected(""), children: "\u5173\u95ED\u540E\u91CD\u8BD5" })
        ] }) : !refs ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u5F15\u7528\u2026" }) : ["intents", "facts", "findings"].map((kind, index) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-gap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("h3", { children: [
            ["\u610F\u56FE", "\u4E8B\u5B9E", "\u53D1\u73B0"][index],
            " \xB7 ",
            refs[kind].length
          ] }),
          refs[kind].map((ref) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-record", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "tw-description", children: ref.summary || ref.id }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-small tw-muted tw-description", children: [
              ref.state,
              " \xB7 ",
              ref.id,
              " \xB7 ",
              ref.inherited && ref.source_task_id ? `\u7EE7\u627F\u81EA ${taskName(ref.source_task_id)}\uFF08${ref.source_task_id}\uFF09` : "\u5F53\u524D\u4EFB\u52A1"
            ] })
          ] }, ref.id))
        ] }, kind)) })
      ] }, asset.id)),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy || loading || offset === 0, onClick: () => setOffset((value) => Math.max(0, value - 20)), children: "\u4E0A\u4E00\u9875" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { children: [
          "\u7B2C ",
          Math.floor(offset / 20) + 1,
          " \u9875"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives9.Button, { size: "sm", disabled: busy || loading || offset + 20 >= page.total, onClick: () => setOffset((value) => value + 20), children: "\u4E0B\u4E00\u9875" })
      ] })
    ] }),
    targets2 && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "tw-section tw-stack", "aria-label": "\u610F\u56FE\u8D44\u4EA7", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("h3", { children: [
        "\u610F\u56FE\u76EE\u6807\u4E0E\u6765\u6E90 \xB7 ",
        targets2.length
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "tw-muted", children: "\u5305\u62EC\u5F53\u524D\u4EFB\u52A1\u7684\u610F\u56FE\u76EE\u6807\u53CA\u76F4\u63A5\u6765\u6E90\u4EFB\u52A1\u7684\u5DF2\u7EC8\u7ED3\u610F\u56FE\uFF1B\u5386\u53F2\u76EE\u6807\u53EF\u80FD\u5DF2\u89E3\u9664\u8D44\u4EA7\u5173\u8054\u3002" }),
      !targets2.length && /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "tw-muted", children: "\u5C1A\u65E0\u610F\u56FE\u8D44\u4EA7\u3002" }),
      targets2.map((target) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("article", { className: "tw-card tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("strong", { className: "tw-title", children: target.label }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-small tw-description", children: [
          target.type,
          " \xB7 \u8D44\u4EA7 ",
          target.asset_id,
          " \xB7 \u610F\u56FE ",
          target.intent_id
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-description", children: [
          target.inherited ? "\u7EE7\u627F\u6765\u6E90\u4EFB\u52A1" : "\u5F53\u524D\u4EFB\u52A1",
          "\uFF1A",
          taskName(target.source_task_id),
          "\uFF08",
          target.source_task_id,
          "\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-description", children: [
          "\u6765\u6E90\uFF1A",
          target.source,
          " \xB7 ",
          target.source_summary
        ] }),
        target.source_node_id && /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("p", { className: "tw-small tw-description", children: [
          "\u6765\u6E90\u8282\u70B9\uFF1A",
          target.source_node_id
        ] })
      ] }, `${target.source_task_id}:${target.intent_id}:${target.asset_id}`))
    ] })
  ] });
}

// src/asset-management/scopesentry-panel.tsx
var import_react10 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime10 = require("react/jsx-runtime");
var assetTypes = [{ key: "subdomain", label: "\u5B50\u57DF\u540D\u53CA\u5173\u8054 IP" }, { key: "service", label: "\u670D\u52A1" }, { key: "app", label: "\u5E94\u7528" }];
var pageSize2 = 50;
function targets(rows, dimension) {
  return rows.map((row) => {
    const id = dimension === "project" ? row.id : row.name;
    if (typeof id !== "string" || !id.trim()) throw new Error(`ScopeSentry \u8FD4\u56DE\u7684${dimension === "project" ? "\u9879\u76EE\u7F3A\u5C11 ID" : "\u4EFB\u52A1\u7F3A\u5C11\u540D\u79F0"}`);
    const name = typeof row.name === "string" && row.name ? row.name : id;
    const detail = typeof row.AssetCount === "number" ? `${row.AssetCount} \u4E2A\u8D44\u4EA7` : typeof row.status === "string" || typeof row.status === "number" ? `\u72B6\u6001\uFF1A${row.status}` : "";
    return { id, name, detail };
  });
}
var message = (error) => error instanceof Error ? error.message : String(error);
function ScopeSentryPanel() {
  const [status, setStatus] = import_react10.default.useState(null);
  const [url, setUrl] = import_react10.default.useState(""), [apiKey, setApiKey] = import_react10.default.useState(""), [enabled, setEnabled] = import_react10.default.useState(true);
  const [dimension, setDimension] = import_react10.default.useState("project");
  const [search, setSearch] = import_react10.default.useState(""), [appliedSearch, setAppliedSearch] = import_react10.default.useState("");
  const [page, setPage] = import_react10.default.useState(1), [rows, setRows] = import_react10.default.useState([]), [loaded, setLoaded] = import_react10.default.useState(false);
  const [selected, setSelected] = import_react10.default.useState([]), [chosenTypes, setChosenTypes] = import_react10.default.useState(["subdomain", "service", "app"]);
  const [createCompany, setCreateCompany] = import_react10.default.useState(true);
  const [statusBusy, setStatusBusy] = import_react10.default.useState(true), [configBusy, setConfigBusy] = import_react10.default.useState(false);
  const [listBusy, setListBusy] = import_react10.default.useState(false), [syncBusy, setSyncBusy] = import_react10.default.useState(false);
  const [error, setError] = import_react10.default.useState(""), [notice, setNotice] = import_react10.default.useState("");
  const [result, setResult] = import_react10.default.useState(null);
  const mounted = import_react10.default.useRef(false), requests = import_react10.default.useRef(/* @__PURE__ */ new Set()), syncRequest = import_react10.default.useRef(null);
  const busy = statusBusy || configBusy || listBusy || syncBusy;
  const ready = Boolean(status?.configured && status.enabled);
  function controller() {
    const value = new AbortController();
    requests.current.add(value);
    return value;
  }
  async function loadTargets(nextDimension, nextPage, query) {
    const pending = controller();
    setListBusy(true);
    setError("");
    setSelected([]);
    setRows([]);
    setLoaded(false);
    try {
      const params = new URLSearchParams({ page: String(nextPage), size: String(pageSize2), ...query ? { search: query } : {} });
      let nextRows;
      if (nextDimension === "project") {
        const response = await request2(`scopesentry/projects?${params}`, { signal: pending.signal });
        nextRows = targets(response.projects, nextDimension);
      } else {
        const response = await request2(`scopesentry/tasks?${params}`, { signal: pending.signal });
        nextRows = targets(response.tasks, nextDimension);
      }
      if (!mounted.current || pending.signal.aborted) return;
      setRows(nextRows);
      setPage(nextPage);
      setAppliedSearch(query);
      setLoaded(true);
    } catch (failure) {
      if (mounted.current && !pending.signal.aborted) setError(`\u52A0\u8F7D\u76EE\u6807\u5931\u8D25\uFF1A${message(failure)}`);
    } finally {
      requests.current.delete(pending);
      if (mounted.current && !pending.signal.aborted) setListBusy(false);
    }
  }
  async function refreshStatus() {
    const pending = controller();
    setStatusBusy(true);
    setError("");
    try {
      const next = await request2("scopesentry/status", { signal: pending.signal });
      if (!mounted.current || pending.signal.aborted) return;
      setStatus(next);
      setEnabled(next.exists ? next.enabled : true);
      if (next.configured && next.enabled) await loadTargets(dimension, 1, search.trim());
      else {
        setRows([]);
        setSelected([]);
        setLoaded(false);
      }
    } catch (failure) {
      if (mounted.current && !pending.signal.aborted) setError(`\u8BFB\u53D6\u6570\u636E\u6E90\u72B6\u6001\u5931\u8D25\uFF1A${message(failure)}`);
    } finally {
      requests.current.delete(pending);
      if (mounted.current && !pending.signal.aborted) setStatusBusy(false);
    }
  }
  import_react10.default.useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
      for (const pending of requests.current) pending.abort();
      requests.current.clear();
    };
  }, []);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const pending = controller();
    setConfigBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const next = await request2("scopesentry/datasource", {
        method: "POST",
        signal: pending.signal,
        body: { ...url.trim() ? { url: url.trim() } : {}, ...apiKey.trim() ? { api_key: apiKey.trim() } : {}, enabled }
      });
      if (!mounted.current || pending.signal.aborted) return;
      setApiKey("");
      setUrl("");
      setStatus(next);
      setEnabled(next.enabled);
      setNotice(next.reachable ? "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u8FDE\u63A5\u6B63\u5E38\u3002" : next.enabled ? "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u8FDE\u63A5\u68C0\u67E5\u672A\u901A\u8FC7\u3002" : "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u6570\u636E\u6E90\u5DF2\u505C\u7528\u3002");
      setRows([]);
      setSelected([]);
      setLoaded(false);
      if (next.configured && next.enabled && next.reachable) await loadTargets(dimension, 1, search.trim());
    } catch (failure) {
      if (mounted.current && !pending.signal.aborted) setError(`\u4FDD\u5B58\u914D\u7F6E\u5931\u8D25\uFF1A${message(failure)}`);
    } finally {
      requests.current.delete(pending);
      if (mounted.current && !pending.signal.aborted) setConfigBusy(false);
    }
  }
  function changeDimension(next) {
    if (next === dimension || busy) return;
    setDimension(next);
    setSearch("");
    setAppliedSearch("");
    setPage(1);
    setSelected([]);
    setResult(null);
    setNotice("");
    if (ready) void loadTargets(next, 1, "");
  }
  async function synchronize() {
    if (busy || !ready || !selected.length || !chosenTypes.length || syncRequest.current) return;
    const pending = controller();
    syncRequest.current = pending;
    setSyncBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    try {
      const response = await request2("scopesentry/sync", {
        method: "POST",
        signal: pending.signal,
        body: { dimension, targets: selected, asset_types: chosenTypes, create_company: dimension === "project" && createCompany, page_size: 100 }
      });
      if (mounted.current && !pending.signal.aborted) setResult(response);
    } catch (failure) {
      if (mounted.current) {
        if (pending.signal.aborted) setNotice("\u540C\u6B65\u8BF7\u6C42\u5DF2\u53D6\u6D88\uFF1B\u53D6\u6D88\u524D\u5DF2\u5199\u5165\u7684\u8D44\u4EA7\u4F1A\u4FDD\u7559\u3002");
        else setError(`\u540C\u6B65\u5931\u8D25\uFF1A${message(failure)}`);
      }
    } finally {
      requests.current.delete(pending);
      if (syncRequest.current === pending) syncRequest.current = null;
      if (mounted.current) setSyncBusy(false);
    }
  }
  const resultFailed = result !== null && (!result.ok || result.errors.length > 0);
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tw-stack", "aria-label": "ScopeSentry \u8D44\u4EA7\u540C\u6B65", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("style", { children: taskWorkspaceStyles }),
    error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "tw-notice", role: "alert", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "tw-notice", role: "status", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "ScopeSentry \u6570\u636E\u6E90\u914D\u7F6E", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "ScopeSentry \u6570\u636E\u6E90" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", variant: "outline", disabled: busy, onClick: () => {
          void refreshStatus();
        }, children: statusBusy ? "\u68C0\u67E5\u4E2D\u2026" : "\u68C0\u67E5\u8FDE\u63A5" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-gap", "aria-live": "polite", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: statusBusy ? "\u6B63\u5728\u8BFB\u53D6\u6570\u636E\u6E90\u72B6\u6001\u2026" : status === null ? "\u5C1A\u672A\u53D6\u5F97\u6570\u636E\u6E90\u72B6\u6001" : !status.exists || !status.configured ? "\u5C1A\u672A\u914D\u7F6E\u5B8C\u6574\u7684\u6570\u636E\u6E90" : !status.enabled ? "\u6570\u636E\u6E90\u5DF2\u505C\u7528" : status.reachable ? "\u5DF2\u8FDE\u63A5" : "\u8FDE\u63A5\u5931\u8D25" }),
        status?.error && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-description", role: "alert", children: status.error }),
        status?.url && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "tw-muted tw-description", children: [
          "\u5F53\u524D\u5730\u5740\uFF1A",
          status.url
        ] }),
        status?.hasApiKey && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted", children: "\u5DF2\u4FDD\u5B58 API Key\uFF1B\u7559\u7A7A\u4F1A\u4FDD\u7559\u73B0\u6709\u5BC6\u94A5\u3002" }),
        status?.tools.length ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("summary", { children: [
            "\u5DF2\u53D1\u73B0 ",
            status.tools.length,
            " \u4E2A\u5DE5\u5177"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-description", children: status.tools.join("\u3001") })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("form", { className: "tw-stack", onSubmit: (event) => {
        void save(event);
      }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("fieldset", { className: "tw-stack", disabled: busy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: "MCP \u5730\u5740" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Input, { "aria-label": "ScopeSentry MCP \u5730\u5740", type: "url", autoComplete: "off", placeholder: status?.url ? "\u7559\u7A7A\u4FDD\u7559\u5F53\u524D\u5730\u5740" : "https://scopesentry.example/mcp", required: !status?.url && enabled, value: url, onChange: (event) => setUrl(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("small", { children: "\u586B\u5199\u65B0\u5730\u5740\u53EF\u66FF\u6362\u5F53\u524D\u5730\u5740\u3002" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: "API Key" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Input, { "aria-label": "ScopeSentry API Key", type: "password", autoComplete: "new-password", placeholder: status?.hasApiKey ? "\u7559\u7A7A\u4FDD\u7559\u73B0\u6709\u5BC6\u94A5" : "\u8F93\u5165 API Key", required: !status?.hasApiKey && enabled, value: apiKey, onChange: (event) => setApiKey(event.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Checkbox, { label: "\u542F\u7528 ScopeSentry \u6570\u636E\u6E90", checked: enabled, onChange: setEnabled, disabled: busy }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "tw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "submit", variant: "primary", size: "sm", children: configBusy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u914D\u7F6E" }) })
      ] }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "\u9009\u62E9\u540C\u6B65\u76EE\u6807", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "\u9009\u62E9\u9879\u76EE\u6216\u4EFB\u52A1" }),
      !ready && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted", children: "\u914D\u7F6E\u5E76\u542F\u7528\u6570\u636E\u6E90\u540E\uFF0C\u53EF\u52A0\u8F7D\u9879\u76EE\u6216\u4EFB\u52A1\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-actions", "aria-label": "\u540C\u6B65\u7EF4\u5EA6", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", variant: dimension === "project" ? "primary" : "outline", "aria-pressed": dimension === "project", disabled: busy, onClick: () => changeDimension("project"), children: "\u6309\u9879\u76EE" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", variant: dimension === "task" ? "primary" : "outline", "aria-pressed": dimension === "task", disabled: busy, onClick: () => changeDimension("task"), children: "\u6309\u4EFB\u52A1" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("form", { className: "tw-inline", onSubmit: (event) => {
        event.preventDefault();
        if (!busy && ready) void loadTargets(dimension, 1, search.trim());
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Input, { className: "tw-grow", "aria-label": "\u641C\u7D22 ScopeSentry \u9879\u76EE\u6216\u4EFB\u52A1", placeholder: dimension === "project" ? "\u641C\u7D22\u9879\u76EE" : "\u641C\u7D22\u4EFB\u52A1", disabled: !ready || busy, value: search, onChange: (event) => setSearch(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "submit", size: "sm", variant: "outline", disabled: !ready || busy, children: listBusy ? "\u52A0\u8F7D\u4E2D\u2026" : "\u641C\u7D22 / \u52A0\u8F7D" })
      ] }),
      listBusy ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u76EE\u6807\u2026" }) : loaded && rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "tw-muted", children: [
        "\u672C\u9875\u6CA1\u6709\u5339\u914D\u7684",
        dimension === "project" ? "\u9879\u76EE" : "\u4EFB\u52A1",
        "\u3002"
      ] }) : rows.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Checkbox, { label: `\u9009\u62E9\u672C\u9875\u5168\u90E8 ${rows.length} \u9879`, checked: rows.every((row) => selected.includes(row.id)), disabled: busy, onChange: (checked) => setSelected(checked ? rows.map((row) => row.id) : []) }),
        rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-record tw-gap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Checkbox, { className: "tw-title", label: row.name, checked: selected.includes(row.id), disabled: busy, onChange: (checked) => setSelected((current) => checked ? [...current, row.id] : current.filter((id) => id !== row.id)) }),
          row.detail && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted tw-small", children: row.detail }),
          dimension === "project" && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted tw-small tw-description", children: row.id })
        ] }, row.id))
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", disabled: !ready || busy || page <= 1, onClick: () => {
          void loadTargets(dimension, page - 1, appliedSearch);
        }, children: "\u4E0A\u4E00\u9875" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "tw-muted", children: [
          "\u7B2C ",
          page,
          " \u9875 \xB7 \u6BCF\u9875 ",
          pageSize2,
          " \u9879"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", disabled: !ready || busy || !loaded || rows.length < pageSize2, onClick: () => {
          void loadTargets(dimension, page + 1, appliedSearch);
        }, children: "\u4E0B\u4E00\u9875" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted tw-small", children: "\u5206\u9875\u3001\u641C\u7D22\u6216\u5207\u6362\u7EF4\u5EA6\u540E\u9700\u91CD\u65B0\u9009\u62E9\u76EE\u6807\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "\u540C\u6B65\u9009\u9879", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "\u540C\u6B65\u5185\u5BB9" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("fieldset", { className: "tw-gap", disabled: busy || !ready, children: [
        assetTypes.map((type) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Checkbox, { label: type.label, checked: chosenTypes.includes(type.key), disabled: busy || !ready, onChange: (checked) => setChosenTypes((current) => checked ? [...current, type.key] : current.filter((value) => value !== type.key)) }, type.key)),
        dimension === "project" && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Checkbox, { label: "\u6309\u9879\u76EE\u521B\u5EFA\u516C\u53F8\u53CA\u8303\u56F4\uFF0C\u5E76\u66F4\u65B0\u8D44\u4EA7\u5F52\u5C5E", checked: createCompany, onChange: setCreateCompany, disabled: busy || !ready })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { className: "tw-muted", children: [
        "\u5DF2\u9009\u62E9 ",
        selected.length,
        " \u4E2A",
        dimension === "project" ? "\u9879\u76EE" : "\u4EFB\u52A1",
        "\u3001",
        chosenTypes.length,
        " \u7C7B\u8D44\u4EA7\u3002\u6BCF\u4E2A\u76EE\u6807\u6BCF\u7C7B\u8D44\u4EA7\u6700\u591A\u540C\u6B65 5000 \u6761\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", variant: "primary", disabled: !ready || busy || selected.length === 0 || chosenTypes.length === 0, onClick: () => {
          void synchronize();
        }, children: syncBusy ? "\u6B63\u5728\u540C\u6B65\u2026" : "\u540C\u6B65\u6240\u9009\u76EE\u6807" }),
        syncBusy && /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", size: "sm", variant: "outline", onClick: () => syncRequest.current?.abort(), children: "\u53D6\u6D88\u540C\u6B65" })
      ] })
    ] }),
    result && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "ScopeSentry \u540C\u6B65\u7ED3\u679C", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { role: resultFailed ? "alert" : "status", children: resultFailed ? "\u540C\u6B65\u5B58\u5728\u5931\u8D25" : result.partial || result.warnings.length > 0 ? "\u540C\u6B65\u5B8C\u6210\uFF08\u90E8\u5206\u7ED3\u679C\uFF09" : "\u540C\u6B65\u5B8C\u6210" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-muted", children: "\u4EE5\u4E0B\u662F\u6210\u529F\u5165\u5E93\u6216\u66F4\u65B0\u7684\u8BB0\u5F55\u6570\uFF0C\u5305\u542B\u5DF2\u5B58\u5728\u8D44\u4EA7\u7684\u66F4\u65B0\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("dl", { className: "tw-kv", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dt", { children: "\u5B50\u57DF\u540D" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dd", { children: result.synced.subdomain }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dt", { children: "\u5173\u8054 IP" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dd", { children: result.synced.ip }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dt", { children: "\u670D\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dd", { children: result.synced.service }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dt", { children: "\u5E94\u7528" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dd", { children: result.synced.app })
      ] }),
      result.companies.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "\u516C\u53F8" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "tw-description", children: result.companies.join("\u3001") })
      ] }),
      result.warnings.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-gap", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "\u63D0\u9192" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { children: result.warnings.map((warning, index) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("li", { className: "tw-description", children: warning }, index)) })
      ] }),
      result.errors.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "tw-gap", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: "\u9519\u8BEF" }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { children: result.errors.map((failure, index) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("li", { className: "tw-description", children: failure }, index)) })
      ] })
    ] })
  ] });
}

// src/asset-management/client.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var kinds = { root_domain: "\u6839\u57DF\u540D", subdomain: "\u5B50\u57DF\u540D", ip: "IP", app: "\u5E94\u7528", service: "\u670D\u52A1", endpoint: "\u7AEF\u70B9" };
var label = (asset) => asset.url || asset.domain || asset.ip || asset.app_name || asset.id;
var errorText4 = (error) => error instanceof Error ? error.message : String(error);
var styles2 = `${taskWorkspaceStyles}.am-json{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.6 var(--ds-font-family-code,monospace);max-height:320px;overflow:auto;margin:0}.am-select{min-width:0;max-width:100%}.am-assets{display:grid;gap:8px}.am-field{display:grid;gap:5px}.am-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.am-editor{display:grid;gap:10px}.am-editor textarea{min-height:100px;resize:vertical}.am-check{display:flex;gap:8px;align-items:flex-start}.am-label{overflow-wrap:anywhere;min-width:0;flex:1}.am-actions{display:flex;flex-wrap:wrap;gap:6px}`;
function AssetManagementTab(props) {
  const [view, setView] = import_react11.default.useState("assets");
  const id = import_react11.default.useId();
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "tw-root", "aria-label": "\u8D44\u4EA7\u7BA1\u7406", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("style", { children: styles2 }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("header", { className: "tw-top", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h2", { children: "\u8D44\u4EA7\u7BA1\u7406" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "tw-toolbar", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.SegmentedTabs, { label: "\u8D44\u4EA7\u7BA1\u7406\u89C6\u56FE", value: view, onChange: (value) => setView(value), items: [
      { value: "assets", label: "\u5168\u5C40\u8D44\u4EA7", id: `${id}-assets`, panelId: `${id}-assets-panel` },
      { value: "companies", label: "\u516C\u53F8\u8303\u56F4", id: `${id}-companies`, panelId: `${id}-companies-panel` },
      { value: "tasks", label: "\u4EFB\u52A1\u8D44\u4EA7", id: `${id}-tasks`, panelId: `${id}-tasks-panel` },
      { value: "sync", label: "ScopeSentry", id: `${id}-sync`, panelId: `${id}-sync-panel` }
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("main", { className: "tw-scroll", role: "tabpanel", id: `${id}-${view}-panel`, "aria-labelledby": `${id}-${view}`, children: props.visible !== false && (view === "assets" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(AssetsPanel, {}) : view === "companies" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(CompanyPanel, {}) : view === "tasks" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(TaskAssetPanel, {}) : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ScopeSentryPanel, {})) })
  ] });
}
function AssetsPanel() {
  const [type, setType] = import_react11.default.useState("root_domain"), [dsl, setDsl] = import_react11.default.useState(""), [search, setSearch] = import_react11.default.useState(""), [company, setCompany] = import_react11.default.useState(""), [page, setPage] = import_react11.default.useState(0);
  const [data, setData] = import_react11.default.useState(), [companies, setCompanies] = import_react11.default.useState([]);
  const [selected, setSelected] = import_react11.default.useState([]), [editing, setEditing] = import_react11.default.useState(), [detail, setDetail] = import_react11.default.useState();
  const [confirmDelete, setConfirmDelete] = import_react11.default.useState(false), [busy, setBusy] = import_react11.default.useState(false), [error, setError] = import_react11.default.useState(""), [notice, setNotice] = import_react11.default.useState("");
  const sequence = import_react11.default.useRef(0), busyRef = import_react11.default.useRef(false), life = import_react11.default.useRef(new AbortController());
  import_react11.default.useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);
  const refresh = import_react11.default.useCallback(async () => {
    const n = ++sequence.current;
    try {
      const params = new URLSearchParams({ type, limit: "30", offset: String(page * 30) });
      if (search) params.set("dsl", search);
      if (company && !search) params.set("company_id", company);
      const [rows, owners] = await Promise.all([request2(`assets?${params}`, { signal: life.current.signal }), request2("companies", { signal: life.current.signal })]);
      if (life.current.signal.aborted || n !== sequence.current) return;
      setData(rows);
      setCompanies(owners);
      setError("");
      setSelected((current) => current.filter((id) => rows.assets.some((asset) => asset.id === id)));
      if (page > 0 && page * 30 >= rows.total) setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
    } catch (failure) {
      if (!life.current.signal.aborted && n === sequence.current) setError(errorText4(failure));
    }
  }, [type, search, company, page]);
  import_react11.default.useEffect(() => {
    void refresh();
  }, [refresh]);
  async function change(work, success) {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    ++sequence.current;
    try {
      await work();
      if (life.current.signal.aborted) return false;
      setNotice(success);
      await refresh();
      return true;
    } catch (failure) {
      if (!life.current.signal.aborted) setError(errorText4(failure));
      return false;
    } finally {
      busyRef.current = false;
      if (!life.current.signal.aborted) setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "tw-stack", children: [
    error && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { role: "alert", className: "tw-notice", children: error }),
    notice && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { role: "status", className: "tw-notice", children: notice }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", variant: "primary", disabled: busy, onClick: () => setEditing("new"), children: "\u767B\u8BB0\u8D44\u4EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => {
        void refresh();
      }, children: "\u5237\u65B0" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "tw-muted", children: data ? `\u5171 ${data.total} \u6761` : "\u6B63\u5728\u52A0\u8F7D\u2026" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("form", { className: "am-toolbar", onSubmit: (event) => {
      event.preventDefault();
      setSearch(dsl);
      setPage(0);
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { "aria-label": "\u8D44\u4EA7\u7C7B\u578B", disabled: busy, value: type, onChange: (event) => {
        setType(event.target.value);
        setPage(0);
        setSelected([]);
      }, children: Object.entries(kinds).map(([value, text]) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value, children: text }, value)) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { "aria-label": "\u6309\u516C\u53F8\u7B5B\u9009", className: "am-select", disabled: busy || !!search, value: company, onChange: (event) => {
        setCompany(event.target.value);
        setPage(0);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: "", children: "\u5168\u90E8\u516C\u53F8" }),
        companies.map((row) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: row.id, children: row.name }, row.id))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Input, { "aria-label": "\u8D44\u4EA7 DSL \u7B5B\u9009", value: dsl, onChange: (event) => setDsl(event.target.value), placeholder: 'domain="example.com"', disabled: busy }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", type: "submit", disabled: busy, children: "\u7B5B\u9009" })
    ] }),
    search && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "tw-muted", children: "\u5DF2\u5E94\u7528 DSL \u6761\u4EF6\uFF1B\u516C\u53F8\u4E0B\u62C9\u7B5B\u9009\u5728\u6E05\u7A7A DSL \u540E\u751F\u6548\u3002" }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(AssetEditor, { asset: editing === "new" ? void 0 : editing, companies, busy, onCancel: () => setEditing(void 0), onSave: async (asset) => {
      const ok = await change(async () => {
        const result = await request2("assets", { method: "POST", body: { assets: [asset] }, signal: life.current.signal });
        if (result.errors.length) throw new Error(result.errors.map((row) => row.error).join("\n"));
      }, "\u8D44\u4EA7\u5DF2\u4FDD\u5B58");
      if (ok) setEditing(void 0);
      return ok;
    } }, editing === "new" ? "new" : editing.id),
    !!selected.length && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
          "\u5DF2\u9009\u62E9 ",
          selected.length,
          " \u6761\u8D44\u4EA7"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => setConfirmDelete(true), children: "\u6279\u91CF\u5220\u9664" })
      ] }),
      confirmDelete && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("p", { children: [
          "\u786E\u8BA4\u5220\u9664\u8FD9 ",
          selected.length,
          " \u6761\u5168\u5C40\u8D44\u4EA7\uFF1F\u76F8\u5173\u4EFB\u52A1\u5173\u8054\u548C\u5B9E\u65F6\u951A\u70B9\u4F1A\u79FB\u9664\uFF0C\u6F0F\u6D1E\u5386\u53F2\u8BC1\u636E\u4FDD\u7559\u3002"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => {
            void change(() => request2("assets", { method: "DELETE", body: { ids: selected }, signal: life.current.signal }), "\u5DF2\u5220\u9664\u6240\u9009\u8D44\u4EA7").then((ok) => {
              if (ok) {
                setSelected([]);
                setConfirmDelete(false);
                setDetail(void 0);
              }
            });
          }, children: "\u786E\u8BA4\u5220\u9664" }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => setConfirmDelete(false), children: "\u53D6\u6D88" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-assets", children: [
      data?.assets.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "tw-muted", children: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u8D44\u4EA7\u3002" }),
      data?.assets.map((asset) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("article", { className: "tw-card tw-stack", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-check", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Checkbox, { checked: selected.includes(asset.id), disabled: busy, onChange: (checked) => {
            setConfirmDelete(false);
            setSelected((ids) => checked === true ? [...ids, asset.id] : ids.filter((id) => id !== asset.id));
          }, label: `\u9009\u62E9\u8D44\u4EA7 ${label(asset)}` }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-label", children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: label(asset) }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("p", { className: "tw-muted tw-small", children: [
              companies.find((row) => row.id === asset.company_id)?.name ?? "\u672A\u5F52\u5C5E\u516C\u53F8",
              " \xB7 ",
              (asset.task_ids ?? []).length,
              " \u4E2A\u4EFB\u52A1"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => setEditing(asset), children: "\u7F16\u8F91" }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy, onClick: () => {
            void change(async () => setDetail(await request2(`assets/${encodeURIComponent(asset.id)}`, { signal: life.current.signal })), "\u5DF2\u8BFB\u53D6\u8D44\u4EA7\u8BE6\u60C5");
          }, children: "\u8BE6\u60C5" })
        ] })
      ] }, asset.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy || page === 0, onClick: () => setPage(page - 1), children: "\u4E0A\u4E00\u9875" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
        "\u7B2C ",
        page + 1,
        " \u9875"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", disabled: busy || !data || (page + 1) * 30 >= data.total, onClick: () => setPage(page + 1), children: "\u4E0B\u4E00\u9875" })
    ] }),
    detail && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-toolbar", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h3", { children: "\u8D44\u4EA7\u8BE6\u60C5" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { size: "sm", onClick: () => setDetail(void 0), children: "\u5173\u95ED\u8BE6\u60C5" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("p", { className: "tw-muted", children: [
        "\u8D44\u4EA7 ID\uFF1A",
        detail.id
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("pre", { className: "am-json", children: JSON.stringify(detail, null, 2) })
    ] })
  ] });
}
function AssetEditor({ asset, companies, busy, onCancel, onSave }) {
  const [kind, setKind] = import_react11.default.useState(asset?.type ?? "root_domain");
  const [fields, setFields] = import_react11.default.useState(() => Object.fromEntries(Object.entries({ ...asset, ...typeof asset?.app_description === "string" ? { description: asset.app_description } : {}, ...asset?.type === "endpoint" && asset.ip ? { service_ip: asset.ip } : {} }).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)])));
  const [extra, setExtra] = import_react11.default.useState(""), [error, setError] = import_react11.default.useState("");
  const common = kind === "app" ? ["app_name", "bundle_id", "app_icp", "category", "description"] : kind === "ip" ? ["ip"] : kind === "endpoint" ? ["url", "method", "service_ip"] : kind === "service" ? fields.url ? ["url", "ip", "page_title", "status_code"] : ["url", "domain", "ip", "port", "service_name"] : kind === "subdomain" ? ["domain", "record_type", "icp"] : ["domain", "icp"];
  const names = { app_name: "\u5E94\u7528\u540D\u79F0", bundle_id: "Bundle ID", record_type: "DNS \u8BB0\u5F55\u7C7B\u578B", app_icp: "\u5E94\u7528 ICP", category: "\u5206\u7C7B", description: "\u63CF\u8FF0", ip: "IP \u5730\u5740", service_ip: "\u670D\u52A1 IP", url: "URL", method: "HTTP \u65B9\u6CD5", status_code: "HTTP \u72B6\u6001\u7801", domain: "\u57DF\u540D", port: "\u7AEF\u53E3", service_name: "\u670D\u52A1\u540D\u79F0", page_title: "\u9875\u9762\u6807\u9898", icp: "ICP" };
  const identity = kind === "app" ? ["app_name", "bundle_id"] : kind === "ip" ? ["ip"] : kind === "endpoint" ? ["url", "method"] : kind === "service" ? asset?.url ? ["url"] : ["url", "domain", "ip", "port", "service_name"] : kind === "subdomain" ? ["domain", "record_type"] : ["domain"];
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("form", { className: "tw-card am-editor", onSubmit: (event) => {
    event.preventDefault();
    setError("");
    try {
      const input = { type: kind };
      if (extra.trim()) {
        const parsed = JSON.parse(extra);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("\u6269\u5C55\u5B57\u6BB5\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
        Object.assign(input, parsed);
      }
      input.type = kind;
      for (const key of [...common, ...kind === "app" ? ["company_id"] : []]) if (fields[key]) input[key] = ["port", "status_code"].includes(key) ? Number(fields[key]) : fields[key];
      if (asset) for (const key of identity) {
        if (fields[key]) input[key] = key === "port" ? Number(fields[key]) : fields[key];
        else delete input[key];
      }
      void onSave(input);
    } catch (failure) {
      setError(errorText4(failure));
    }
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h3", { children: asset ? "\u7F16\u8F91\u8D44\u4EA7" : "\u767B\u8BB0\u8D44\u4EA7" }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "am-field", children: [
      "\u7C7B\u578B",
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { value: kind, disabled: busy || !!asset, onChange: (event) => {
        setKind(event.target.value);
        setFields({});
      }, children: Object.entries(kinds).map(([value, text]) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value, children: text }, value)) })
    ] }),
    asset && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "tw-muted", children: "\u8EAB\u4EFD\u5B57\u6BB5\u4FDD\u6301\u4E0D\u53D8\uFF1B\u767B\u8BB0\u540C\u4E00\u81EA\u7136\u952E\u4F1A\u66F4\u65B0\u73B0\u6709\u8D44\u4EA7\u3002" }),
    common.map((key) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "am-field", children: [
      names[key],
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Input, { value: fields[key] ?? "", disabled: busy || !!asset && identity.includes(key), onChange: (event) => setFields({ ...fields, [key]: event.target.value }) })
    ] }, key)),
    kind === "app" && /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "am-field", children: [
      "\u516C\u53F8",
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { value: fields.company_id ?? "", disabled: busy, onChange: (event) => setFields({ ...fields, company_id: event.target.value }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: "", children: "\u4FDD\u6301\u539F\u5F52\u5C5E\u6216\u6309\u8303\u56F4\u5339\u914D" }),
        companies.map((row) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: row.id, children: row.name }, row.id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("summary", { children: "\u6269\u5C55\u5B57\u6BB5\uFF08JSON\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("textarea", { "aria-label": "\u8D44\u4EA7\u6269\u5C55\u5B57\u6BB5 JSON", value: extra, disabled: busy, onChange: (event) => setExtra(event.target.value), placeholder: '{"technologies":["nginx"]}' })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "am-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { type: "submit", size: "sm", variant: "primary", disabled: busy, children: "\u4FDD\u5B58\u8D44\u4EA7" }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives11.Button, { type: "button", size: "sm", disabled: busy, onClick: onCancel, children: "\u53D6\u6D88" })
    ] })
  ] });
}

// src/system-runtime/client.tsx
var import_react12 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime12 = require("react/jsx-runtime");
var root = "/api/redteam/system";
var retryLabels = { connect: "\u8FDE\u63A5\u5931\u8D25", empty: "\u7A7A\u54CD\u5E94", stream: "\u6D41\u4E2D\u65AD", breaker: "\u7194\u65AD", intent: "\u610F\u56FE\u91CD\u8BD5" };
var tabs = [{ id: "settings", panelId: "system-settings-panel", value: "settings", label: "\u7CFB\u7EDF\u8BBE\u7F6E" }, { id: "pool", panelId: "system-pool-panel", value: "pool", label: "\u6A21\u578B\u6C60" }];
function SystemRuntimeTab({ visible }) {
  const [tab, setTab] = import_react12.default.useState("settings");
  const [settings, setSettings] = import_react12.default.useState();
  const [pool, setPool] = import_react12.default.useState();
  const [loading, setLoading] = import_react12.default.useState(false), [busy, setBusy] = import_react12.default.useState(false);
  const [error, setError] = import_react12.default.useState(""), [notice, setNotice] = import_react12.default.useState("");
  const pending = import_react12.default.useRef(false);
  const refresh = import_react12.default.useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([requestJson(`${root}/settings`, { signal }), requestJson(`${root}/model-pool`, { signal })]);
    if (signal?.aborted) return;
    if (results[0].status === "fulfilled") setSettings(results[0].value);
    if (results[1].status === "fulfilled") setPool(results[1].value);
    setError(results.filter((result) => result.status === "rejected").map((result) => errorMessage(result.reason)).join("\n"));
    setLoading(false);
  }, []);
  import_react12.default.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [visible, refresh]);
  const act = async (work, success) => {
    if (pending.current) return void 0;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await work();
      setNotice(success);
      return result;
    } catch (failure) {
      setError(errorMessage(failure));
      return void 0;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    ManagementPage,
    {
      title: "\u7CFB\u7EDF\u8BBE\u7F6E\u4E0E\u6A21\u578B\u6C60",
      description: "\u8BBE\u7F6E\u4FDD\u5B58\u5728\u5F53\u524D\u63D2\u4EF6\u5B9E\u4F8B\u3002\u641C\u7D22\u548C\u6A21\u578B\u6D4B\u8BD5\u4F1A\u53D1\u9001\u771F\u5B9E\u8BF7\u6C42\u3002",
      loading,
      error,
      notice,
      actions: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: loading || busy, onClick: () => void refresh(), children: "\u5237\u65B0\u72B6\u6001" }),
      toolbar: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.SegmentedTabs, { items: tabs, value: tab, onChange: setTab, label: "\u7CFB\u7EDF\u7BA1\u7406\u89C6\u56FE" }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { hidden: tab !== "settings", children: settings && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(SettingsForm, { initial: settings, busy, act, onSaved: setSettings }) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { hidden: tab !== "pool", children: pool && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(PoolPanel, { pool, busy, act, refresh: () => refresh() }) })
      ]
    }
  );
}
function SettingsForm({ initial, busy, act, onSaved }) {
  const [patch, setPatch] = import_react12.default.useState({});
  const [braveMode, setBraveMode] = import_react12.default.useState("keep"), [tavilyMode, setTavilyMode] = import_react12.default.useState("keep");
  const [braveKey, setBraveKey] = import_react12.default.useState(""), [tavilyKey, setTavilyKey] = import_react12.default.useState("");
  const [test, setTest] = import_react12.default.useState();
  const current = { ...initial, ...patch };
  const change = (key, value) => setPatch((old) => ({ ...old, [key]: value }));
  const dirty = Object.keys(patch).length > 0 || braveMode !== "keep" || tavilyMode !== "keep";
  const secretPatch = { ...braveMode === "keep" ? {} : { brave_search_api_key: braveMode === "clear" ? "" : braveKey }, ...tavilyMode === "keep" ? {} : { tavily_search_api_key: tavilyMode === "clear" ? "" : tavilyKey } };
  async function save(event) {
    event.preventDefault();
    const saved = await act(() => requestJson(`${root}/settings`, { method: "PUT", body: JSON.stringify({ ...patch, ...secretPatch }) }), "\u7CFB\u7EDF\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u3002");
    if (saved) {
      onSaved(saved);
      setPatch({});
      setBraveMode("keep");
      setTavilyMode("keep");
      setBraveKey("");
      setTavilyKey("");
    }
  }
  async function testSearch() {
    setTest(void 0);
    const result = await act(async () => {
      const result2 = await requestJson(`${root}/web-search/test`, { method: "POST", body: JSON.stringify({ web_search_backend: current.web_search_backend, web_search_proxy: current.web_search_proxy, ...braveMode === "replace" ? { brave_search_api_key: braveKey } : {}, ...tavilyMode === "replace" ? { tavily_search_api_key: tavilyKey } : {} }) });
      if (!result2.ok) throw new Error(result2.error || "\u641C\u7D22\u6D4B\u8BD5\u6CA1\u6709\u6210\u529F");
      return result2;
    }, "\u641C\u7D22\u6D4B\u8BD5\u6210\u529F\u3002");
    setTest(result);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("form", { className: "tw-stack", onSubmit: save, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "\u7F51\u9875\u641C\u7D22" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.web_search_enabled === true, onChange: (value) => change("web_search_enabled", value), label: "\u542F\u7528\u7F51\u9875\u641C\u7D22" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: "\u641C\u7D22\u540E\u7AEF", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("select", { value: current.web_search_backend ?? "ddgs", onChange: (event) => change("web_search_backend", event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "ddgs", children: "DuckDuckGo" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "brave-free", children: "Brave" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "tavily", children: "Tavily" }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "deepseek", children: "DeepSeek" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: "\u641C\u7D22\u4EE3\u7406", hint: "\u7559\u7A7A\u76F4\u8FDE\uFF1B\u72EC\u7ACB\u4E8E\u76EE\u6807\u6D41\u91CF\u4EE3\u7406\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Input, { value: current.web_search_proxy ?? "", onChange: (event) => change("web_search_proxy", event.target.value), placeholder: "http://127.0.0.1:8080" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(SecretInput, { label: "Brave API Key", configured: initial.brave_key_set, mode: braveMode, setMode: setBraveMode, value: braveKey, setValue: setBraveKey }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(SecretInput, { label: "Tavily API Key", configured: initial.tavily_key_set, mode: tavilyMode, setMode: setTavilyMode, value: tavilyKey, setValue: setTavilyKey }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "tw-muted tw-small", children: "\u6D4B\u8BD5\u4F7F\u7528\u5F53\u524D\u8868\u5355\u7684\u540E\u7AEF\u3001\u4EE3\u7406\u548C\u65B0\u5BC6\u94A5\uFF1B\u4FDD\u7559\u65F6\u4F7F\u7528\u5DF2\u4FDD\u5B58\u5BC6\u94A5\u3002\u6E05\u7A7A\u5BC6\u94A5\u540E\u8BF7\u5148\u4FDD\u5B58\u518D\u6D4B\u8BD5\u3002DeepSeek \u6D4B\u8BD5\u4F1A\u8C03\u7528\u6A21\u578B\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", size: "sm", disabled: busy || braveMode === "clear" || tavilyMode === "clear" || braveMode === "replace" && !braveKey.trim() || tavilyMode === "replace" && !tavilyKey.trim(), onClick: () => void testSearch(), children: "\u6D4B\u8BD5\u641C\u7D22\u8FDE\u63A5" }) }),
      test && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(Notice, { tone: "success", children: [
        test.backend,
        " \u8FD4\u56DE ",
        test.count,
        " \u6761\u641C\u7D22\u7ED3\u679C\u3002"
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "\u6267\u884C\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.llm_pool_enabled === true, onChange: (value) => change("llm_pool_enabled", value), label: "\u542F\u7528\u6A21\u578B\u6C60" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.llm_pool_bind_fallback === true, onChange: (value) => change("llm_pool_bind_fallback", value), label: "\u5141\u8BB8\u5DF2\u7ED1\u5B9A\u6A21\u578B\u4F7F\u7528\u6C60\u5185\u56DE\u9000" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.constraints_inject_planner === true, onChange: (value) => change("constraints_inject_planner", value), label: "\u5411 Planner \u6CE8\u5165\u4EFB\u52A1\u7EA6\u675F" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.constraints_inject_worker === true, onChange: (value) => change("constraints_inject_worker", value), label: "\u5411 Worker \u6CE8\u5165\u4EFB\u52A1\u7EA6\u675F" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: current.noa_compaction === true, onChange: (value) => change("noa_compaction", value), label: "\u542F\u7528 NoA \u4E0A\u4E0B\u6587\u538B\u7F29" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { type: "submit", variant: "primary", size: "sm", disabled: !dirty || busy, children: "\u4FDD\u5B58\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", size: "sm", disabled: !dirty || busy, onClick: () => {
        setPatch({});
        setBraveMode("keep");
        setTavilyMode("keep");
        setBraveKey("");
        setTavilyKey("");
      }, children: "\u64A4\u9500\u672A\u4FDD\u5B58\u4FEE\u6539" }),
      dirty && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { tone: "warning", children: "\u5C1A\u672A\u4FDD\u5B58" })
    ] })
  ] }) });
}
function SecretInput({ label: label2, configured, mode, setMode, value, setValue }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-grid", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: label2, hint: configured ? "\u5DF2\u914D\u7F6E\uFF0C\u670D\u52A1\u7AEF\u4E0D\u4F1A\u56DE\u4F20\u5BC6\u94A5\u3002" : "\u5C1A\u672A\u914D\u7F6E\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("select", { "aria-label": `${label2} \u64CD\u4F5C`, value: mode, onChange: (event) => setMode(event.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "keep", children: "\u4FDD\u7559\u5F53\u524D\u5BC6\u94A5" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "replace", children: "\u8BBE\u7F6E\u65B0\u5BC6\u94A5" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "clear", children: "\u6E05\u7A7A\u5BC6\u94A5" })
    ] }) }),
    mode === "replace" && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: `\u65B0 ${label2}`, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Input, { type: "password", autoComplete: "new-password", required: true, value, onChange: (event) => setValue(event.target.value) }) })
  ] });
}
function RetryFields({ value, keys, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "tw-stack", children: keys.map((key) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-grid", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: `${retryLabels[key]}\u6B21\u6570`, hint: "0 \u4F7F\u7528\u9ED8\u8BA4\u6216\u7EE7\u627F\uFF1B-1 \u7981\u7528\uFF1B\u6700\u591A 20\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Input, { type: "number", required: true, min: -1, max: 20, step: 1, value: value[key].attempts, onChange: (event) => onChange(key, { ...value[key], attempts: event.target.valueAsNumber }) }) }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: `${retryLabels[key]}\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09`, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Input, { type: "number", required: true, min: 0, max: 36e5, step: 1, value: value[key].interval_ms, onChange: (event) => onChange(key, { ...value[key], interval_ms: event.target.valueAsNumber }) }) })
  ] }, key)) });
}
function PoolPanel({ pool, busy, act, refresh }) {
  const [selected, setSelected] = import_react12.default.useState("");
  const [probe, setProbe] = import_react12.default.useState();
  const [confirmReset, setConfirmReset] = import_react12.default.useState(false);
  const row = pool.chain.find((item) => item.profile_id === selected);
  async function reset(profileId) {
    await act(async () => {
      await requestJson(`${root}/model-health/reset`, { method: "POST", body: JSON.stringify(profileId ? { profile_id: profileId } : {}) });
      await refresh();
      setConfirmReset(false);
    }, "\u6A21\u578B\u5065\u5EB7\u72B6\u6001\u5DF2\u91CD\u7F6E\u3002");
  }
  async function test(profileId) {
    setProbe(void 0);
    await act(async () => {
      const result = await requestJson(`${root}/model-test/${encodeURIComponent(profileId)}`, { method: "POST", body: "{}" });
      setProbe(result);
      await refresh();
      if (!result.ok) throw new Error("\u6A21\u578B\u6D4B\u8BD5\u5931\u8D25\uFF0C\u8BE6\u89C1\u6D4B\u8BD5\u7ED3\u679C\u3002");
    }, "\u6A21\u578B\u6D4B\u8BD5\u6210\u529F\u3002");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-inline", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { tone: pool.enabled ? "success" : "outline", children: pool.enabled ? "\u6A21\u578B\u6C60\u5DF2\u542F\u7528" : "\u6A21\u578B\u6C60\u672A\u542F\u7528" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { children: pool.bind_fallback ? "\u7ED1\u5B9A\u5141\u8BB8\u56DE\u9000" : "\u7ED1\u5B9A\u4E0D\u56DE\u9000" })
    ] }),
    !pool.chain.length ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "tw-empty", children: "\u5C1A\u65E0\u6A21\u578B\u914D\u7F6E\u3002\u8BF7\u5148\u5728\u4EFB\u52A1\u5DE5\u4F5C\u53F0\u7684\u6A21\u578B\u914D\u7F6E\u4E2D\u6DFB\u52A0\u6A21\u578B\u3002" }) : pool.chain.map((item) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: "tw-card tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-inline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { className: "tw-grow", children: item.name }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { tone: item.state === "ok" ? "success" : item.state === "tripped" ? "danger" : "warning", children: item.state === "ok" ? "\u6B63\u5E38" : item.state === "tripped" ? "\u7194\u65AD\u4E2D" : "\u964D\u7EA7" }),
        item.active && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { tone: "info", children: "\u5F53\u524D" }),
        item.policy.excluded && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Tag, { children: "\u5DF2\u6392\u9664" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "mg-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
          item.provider,
          " / ",
          item.model
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
          "\u4F18\u5148\u7EA7 ",
          item.policy.priority
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
          "\u5931\u8D25 ",
          item.fails,
          " \xB7 \u7194\u65AD ",
          item.trips,
          " \xB7 \u51B7\u5374 ",
          item.cooldown_secs,
          " \u79D2"
        ] })
      ] }),
      item.last_error && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { className: "tw-description", children: [
        item.last_error,
        " ",
        item.last_at && `\uFF08${new Date(item.last_at).toLocaleString()}\uFF09`
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy, onClick: () => setSelected(item.profile_id), children: "\u7F16\u8F91\u7B56\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy, onClick: () => void test(item.profile_id), children: "\u6D4B\u8BD5\u6A21\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy, onClick: () => void reset(item.profile_id), children: "\u91CD\u7F6E\u5065\u5EB7" })
      ] })
    ] }, item.profile_id)),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "tw-muted tw-small", children: "\u6A21\u578B\u6D4B\u8BD5\u4F1A\u53D1\u9001\u4E00\u6B21\u77ED\u8BF7\u6C42\uFF0C\u53EF\u80FD\u6D88\u8017\u63D0\u4F9B\u65B9\u989D\u5EA6\uFF1B\u8D85\u65F6\u4E0A\u9650 30 \u79D2\u3002" }),
    probe && /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "tw-card tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: "\u6D4B\u8BD5\u7ED3\u679C" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
        probe.profile_id,
        " \xB7 ",
        probe.elapsed_ms,
        " \u6BEB\u79D2 \xB7 ",
        probe.ok ? "\u6210\u529F" : "\u5931\u8D25"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "tw-description", children: probe.response }),
      probe.failure !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(JsonDetails, { value: probe.failure, summary: "\u9519\u8BEF\u8BE6\u60C5", open: true })
    ] }),
    row && /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ProfileEditor, { row, busy, act, refresh, onClose: () => setSelected("") }, row.profile_id),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(GlobalRetry, { initial: pool.retry, busy, act, refresh }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "tw-actions", children: confirmReset ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: "\u91CD\u7F6E\u5168\u90E8\u6A21\u578B\u7684\u7194\u65AD\u548C\u5931\u8D25\u72B6\u6001\uFF1F" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy, onClick: () => void reset(), children: "\u786E\u8BA4\u91CD\u7F6E\u5168\u90E8" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy, onClick: () => setConfirmReset(false), children: "\u53D6\u6D88" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", disabled: busy || !pool.chain.length, onClick: () => setConfirmReset(true), children: "\u91CD\u7F6E\u5168\u90E8\u6A21\u578B\u5065\u5EB7" }) })
  ] });
}
function ProfileEditor({ row, busy, act, refresh, onClose }) {
  const [policy, setPolicy] = import_react12.default.useState(row.policy);
  const numeric = [{ key: "priority", label: "\u4F18\u5148\u7EA7" }, { key: "ratePerSecond", label: "\u6BCF\u79D2\u8BF7\u6C42\u4E0A\u9650", min: 0 }, { key: "ratePerMinute", label: "\u6BCF\u5206\u949F\u8BF7\u6C42\u4E0A\u9650", min: 0 }, { key: "windowTokens", label: "\u4E0A\u4E0B\u6587 token \u4E0A\u9650", min: 0 }];
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("form", { className: "tw-card tw-stack", onSubmit: (event) => {
    event.preventDefault();
    void act(async () => {
      await requestJson(`${root}/model-policy/${encodeURIComponent(row.profile_id)}`, { method: "PUT", body: JSON.stringify(policy) });
      await refresh();
      onClose();
    }, "\u6A21\u578B\u7B56\u7565\u5DF2\u4FDD\u5B58\u3002");
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("h3", { children: [
      row.name,
      " \xB7 \u6A21\u578B\u7B56\u7565"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Checkbox, { checked: policy.excluded, onChange: (excluded) => setPolicy((old) => ({ ...old, excluded })), label: "\u4ECE\u6A21\u578B\u6C60\u4E2D\u6392\u9664\u6B64\u914D\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "tw-grid", children: numeric.map(({ key, label: label2, min }) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(Field, { label: label2, hint: min === 0 ? "0 \u8868\u793A\u4E0D\u9650\u5236\u3002" : void 0, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Input, { required: true, type: "number", step: 1, min, value: policy[key], onChange: (event) => setPolicy((old) => ({ ...old, [key]: event.target.valueAsNumber })) }) }, key)) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RetryFields, { value: policy.retry, keys: ["connect", "empty", "stream"], onChange: (key, rule) => setPolicy((old) => ({ ...old, retry: { ...old.retry, [key]: rule } })) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", type: "submit", variant: "primary", children: "\u4FDD\u5B58\u6A21\u578B\u7B56\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { size: "sm", type: "button", onClick: onClose, children: "\u53D6\u6D88" })
      ] })
    ] })
  ] });
}
function GlobalRetry({ initial, busy, act, refresh }) {
  const [patch, setPatch] = import_react12.default.useState({});
  const retry = { ...initial, ...patch };
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("details", { className: "tw-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("summary", { children: "\u5168\u5C40\u4E94\u5C42\u91CD\u8BD5\u7B56\u7565" }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("form", { className: "tw-stack", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        await requestJson(`${root}/model-retry`, { method: "PUT", body: JSON.stringify(retry) });
        await refresh();
        setPatch({});
      }, "\u5168\u5C40\u91CD\u8BD5\u7B56\u7565\u5DF2\u4FDD\u5B58\u3002");
    }, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { disabled: busy, className: "tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RetryFields, { value: retry, keys: ["connect", "empty", "stream", "breaker", "intent"], onChange: (key, rule) => setPatch((old) => ({ ...old, [key]: rule })) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { type: "submit", size: "sm", variant: "primary", disabled: !Object.keys(patch).length, children: "\u4FDD\u5B58\u5168\u5C40\u7B56\u7565" }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", size: "sm", disabled: !Object.keys(patch).length, onClick: () => setPatch({}), children: "\u64A4\u9500\u4FEE\u6539" })
      ] })
    ] }) })
  ] });
}

// src/platform/client.tsx
var import_react16 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives16 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/platform/client-agents.tsx
var import_react14 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives14 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/platform/client-common.tsx
var import_react13 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime13 = require("react/jsx-runtime");
function usePlatformApi(sessionId) {
  const [busy, setBusy] = import_react13.default.useState(false), [error, setError] = import_react13.default.useState(""), [notice, setNotice] = import_react13.default.useState("");
  const locked = import_react13.default.useRef(false);
  const call = import_react13.default.useCallback(async (domain, action, payload = {}) => requestJson(`api/redteam/platform/${domain}`, { method: "POST", body: JSON.stringify({ action, payload, sessionId }) }), [sessionId]);
  const act = import_react13.default.useCallback(async (operation, message2 = "\u64CD\u4F5C\u5DF2\u5B8C\u6210") => {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(message2);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);
  return { call, act, busy, error, notice };
}
function jsonObject(text, name) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}\u5FC5\u987B\u662F JSON \u5BF9\u8C61`);
  return value;
}
var lines = (text) => text.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
var pretty = (value) => JSON.stringify(value, null, 2);
function TextField({ label: label2, value, onChange, multiline = false, required = false, disabled = false, hint }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Field, { label: label2, hint, children: multiline ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("textarea", { "aria-label": label2, rows: 5, value, required, disabled, onChange: (event) => onChange(event.target.value) }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives13.Input, { "aria-label": label2, value, required, disabled, onChange: (event) => onChange(event.target.value) }) });
}
function NumberField({ label: label2, value, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Field, { label: label2, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives13.Input, { "aria-label": label2, type: "number", min: 0, step: 1, required: true, value, onChange: (event) => onChange(event.target.valueAsNumber) }) });
}
function Choice({ label: label2, value, values, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Field, { label: label2, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("select", { "aria-label": label2, value, onChange: (event) => onChange(event.target.value), children: values.map(([key, text]) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("option", { value: key, children: text }, key)) }) });
}
function AgentBindings({ agents, selected, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("fieldset", { className: "tw-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("legend", { children: "\u53EF\u4F7F\u7528\u7684 Agent" }),
    agents.map((agent) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives13.Checkbox, { label: agent.name, checked: selected.includes(agent.key), onChange: (checked) => onChange(checked ? [...selected, agent.key] : selected.filter((key) => key !== agent.key)) }, agent.key))
  ] });
}
function SaveBar({ busy, label: label2 = "\u4FDD\u5B58", onCancel }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "tw-actions", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives13.Button, { type: "submit", variant: "primary", size: "sm", disabled: busy, children: busy ? "\u6B63\u5728\u5904\u7406\u2026" : label2 }),
    onCancel && /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives13.Button, { type: "button", size: "sm", disabled: busy, onClick: onCancel, children: "\u53D6\u6D88\u7F16\u8F91" })
  ] });
}

// src/platform/client-agents.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function AgentsPanel({ call, act, busy, sessionId }) {
  const [agents, setAgents] = import_react14.default.useState([]), [selected, setSelected] = import_react14.default.useState("");
  const [creating, setCreating] = import_react14.default.useState(false), [key, setKey] = import_react14.default.useState(""), [name, setName] = import_react14.default.useState(""), [description, setDescription] = import_react14.default.useState("");
  const [loaded, setLoaded] = import_react14.default.useState(false);
  const load = import_react14.default.useCallback(async () => {
    setAgents(await call("agents", "list"));
    setLoaded(true);
  }, [call]);
  import_react14.default.useEffect(() => {
    void act(load, "");
  }, [act, load]);
  const row = agents.find((a) => a.key === selected);
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => {
        setCreating(true);
        setSelected("");
      }, children: "\u65B0\u5EFA Agent" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(load, "\u5217\u8868\u5DF2\u5237\u65B0"), children: "\u5237\u65B0\u5217\u8868" })
    ] }),
    !loaded ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6 Agent\u2026" }) : agents.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "tw-muted", children: "\u6CA1\u6709 Agent\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "mg-list", children: agents.map((agent) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "tw-record", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: agent.name }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Tag, { tone: agent.enabled ? "success" : "outline", children: agent.enabled ? "\u542F\u7528" : "\u505C\u7528" }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Tag, { children: agent.builtin ? "\u5185\u7F6E" : "\u81EA\u5B9A\u4E49" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: agent.description }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "mg-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: agent.key }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
          "\u6A21\u578B\uFF1A",
          agent.llmProfileId ?? "\u7EE7\u627F\u5F53\u524D\u4F1A\u8BDD"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
          "\u63D0\u793A\u8BCD v",
          agent.currentPromptVersion
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => {
        setSelected(agent.key);
        setCreating(false);
      }, children: [
        "\u7BA1\u7406 ",
        agent.name
      ] })
    ] }, agent.key)) }),
    creating && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack tw-section", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        const created = await call("agents", "create", { key, name, description: description || void 0 });
        await load();
        setSelected(created.key);
        setCreating(false);
        setKey("");
        setName("");
        setDescription("");
      }, "Agent \u5DF2\u521B\u5EFA");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: "\u65B0\u5EFA Agent" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "Agent \u6807\u8BC6", required: true, value: key, onChange: setKey, hint: "\u4EE5\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EA\u542B\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "Agent \u540D\u79F0", required: true, value: name, onChange: setName }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "Agent \u63CF\u8FF0", multiline: true, value: description, onChange: setDescription }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy, label: "\u521B\u5EFA Agent", onCancel: () => setCreating(false) })
    ] }),
    row && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(AgentEditor, { row, call, act, busy, sessionId, reload: load, onDeleted: () => setSelected("") }, row.key)
  ] });
}
function AgentEditor({ row, call, act, busy, reload, onDeleted, sessionId }) {
  const [draft, setDraft] = import_react14.default.useState(row), [profile, setProfile] = import_react14.default.useState(String(row.llmProfileId ?? ""));
  const [copyKey, setCopyKey] = import_react14.default.useState(""), [copyName, setCopyName] = import_react14.default.useState("");
  const [message2, setMessage] = import_react14.default.useState(""), [taskId, setTaskId] = import_react14.default.useState(""), [runResult, setRunResult] = import_react14.default.useState();
  const patch = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }));
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "tw-stack tw-section", "aria-label": `Agent ${row.name} \u8BBE\u7F6E`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("h3", { children: [
      row.name,
      " \xB7 \u8FD0\u884C\u8BBE\u7F6E"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        const value = { enabled: draft.enabled, llmProfileId: profile.trim() || null, maxTurns: draft.maxTurns, runSeconds: draft.runSeconds, webSearch: draft.webSearch, interactiveShell: draft.interactiveShell, triggerRunMode: draft.triggerRunMode, triggerMergeMode: draft.triggerMergeMode, triggerMaxParallel: draft.triggerMaxParallel };
        if (!row.builtin) {
          value.name = draft.name;
          value.description = draft.description;
        }
        await call("agents", "update", { key: row.key, patch: value });
        await reload();
      }, "Agent \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    }, children: [
      !row.builtin && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "Agent \u540D\u79F0", required: true, value: draft.name, onChange: (value) => patch("name", value) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "Agent \u63CF\u8FF0", multiline: true, value: draft.description, onChange: (value) => patch("description", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: "\u542F\u7528 Agent", checked: draft.enabled, onChange: (value) => patch("enabled", value) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u6A21\u578B\u914D\u7F6E ID", value: profile, onChange: setProfile, hint: "\u7559\u7A7A\u7EE7\u627F\u4F1A\u8BDD\u6A21\u578B\uFF1B\u586B\u5199\u5DF2\u5B58\u5728\u7684\u6A21\u578B\u914D\u7F6E ID\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NumberField, { label: "\u6700\u5927\u8F6E\u6570\uFF080 \u4E0D\u9650\uFF09", value: draft.maxTurns, onChange: (value) => patch("maxTurns", value) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NumberField, { label: "\u8FD0\u884C\u65F6\u9650\uFF08\u79D2\uFF0C0 \u4E0D\u9650\uFF09", value: draft.runSeconds, onChange: (value) => patch("runSeconds", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: "\u5141\u8BB8\u7F51\u9875\u641C\u7D22", checked: draft.webSearch, onChange: (value) => patch("webSearch", value) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: "\u5141\u8BB8\u4EA4\u4E92\u5F0F\u7EC8\u7AEF", checked: draft.interactiveShell, onChange: (value) => patch("interactiveShell", value) }),
      !row.builtin && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Choice, { label: "\u89E6\u53D1\u8FD0\u884C\u65B9\u5F0F", value: draft.triggerRunMode, values: [["serial", "\u4E32\u884C"], ["parallel", "\u5E76\u884C"]], onChange: (value) => patch("triggerRunMode", value === "parallel" ? "parallel" : "serial") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Choice, { label: "\u89E6\u53D1\u6D88\u606F\u5408\u5E76", value: draft.triggerMergeMode, values: [["all", "\u5168\u90E8\u5408\u5E76"], ["by_task", "\u6309\u4EFB\u52A1\u5408\u5E76"], ["none", "\u4E0D\u5408\u5E76"]], onChange: (value) => patch("triggerMergeMode", value === "all" ? "all" : value === "by_task" ? "by_task" : "none") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NumberField, { label: "\u6700\u5927\u5E76\u884C\u8FD0\u884C\u6570\uFF080 \u4E0D\u9650\uFF09", value: draft.triggerMaxParallel, onChange: (value) => patch("triggerMaxParallel", value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("summary", { children: "\u590D\u5236\u6216\u5220\u9664 Agent" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack tw-gap", onSubmit: (event) => {
        event.preventDefault();
        void act(async () => {
          await call("agents", "copy", { key: row.key, newKey: copyKey, name: copyName });
          await reload();
          setCopyKey("");
          setCopyName("");
        }, "\u5DF2\u590D\u5236 Agent \u53CA\u8D44\u6E90\u7ED1\u5B9A");
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u526F\u672C\u6807\u8BC6", required: true, value: copyKey, onChange: setCopyKey }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u526F\u672C\u540D\u79F0", required: true, value: copyName, onChange: setCopyName }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy, label: "\u521B\u5EFA\u526F\u672C" })
      ] }),
      !row.builtin && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(DeleteAction, { label: "\u5220\u9664 Agent", disabled: busy, onDelete: () => act(async () => {
        await call("agents", "delete", { key: row.key });
        await reload();
        onDeleted();
      }, "Agent \u5DF2\u5220\u9664") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(PromptsPanel, { row, call, act, busy, reload }, `prompt-${row.key}`),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(VisibilityPanel, { agentKey: row.key, call, act, busy }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("summary", { children: "\u7ACB\u5373\u8FD0\u884C" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack tw-gap", onSubmit: (event) => {
        event.preventDefault();
        void act(async () => {
          setRunResult(await call("agents", "run", { key: row.key, message: message2, taskId: taskId || void 0 }));
        }, "Agent \u8FD0\u884C\u5DF2\u8FD4\u56DE");
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u8FD0\u884C\u6307\u4EE4", required: true, multiline: true, value: message2, onChange: setMessage }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u5173\u8054\u4EFB\u52A1 ID\uFF08\u53EF\u9009\uFF09", value: taskId, onChange: setTaskId }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "tw-muted", children: "\u4F7F\u7528\u5F53\u524D DSH \u4F1A\u8BDD\u7684 Agent \u548C\u6A21\u578B\u542F\u52A8\u771F\u5B9E\u8FD0\u884C\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy: busy || !sessionId, label: sessionId ? "\u8FD0\u884C Agent" : "\u8BF7\u5148\u6253\u5F00 DSH \u4F1A\u8BDD" })
      ] }),
      runResult !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(JsonDetails, { value: runResult, summary: "\u8FD0\u884C\u7ED3\u679C", open: true })
    ] })
  ] });
}
function PromptsPanel({ row, call, act, busy, reload }) {
  const [versions, setVersions] = import_react14.default.useState([]), [variables, setVariables] = import_react14.default.useState([]);
  const [template, setTemplate] = import_react14.default.useState(""), [note, setNote] = import_react14.default.useState(""), [activate, setActivate] = import_react14.default.useState(true), [sample, setSample] = import_react14.default.useState("{}"), [preview, setPreview] = import_react14.default.useState("");
  const [loaded, setLoaded] = import_react14.default.useState(false), [wrapKind, setWrapKind] = import_react14.default.useState("run");
  const [wrapPrompt, setWrapPrompt] = import_react14.default.useState(row.wrapupPrompt), [wrapTurns, setWrapTurns] = import_react14.default.useState(row.wrapupMaxTurns);
  async function load() {
    const next = await call("prompts", "versions", { key: row.key });
    const vars = await call("prompts", "variables", { key: row.key });
    setVersions(next);
    setVariables(vars);
    setTemplate(next.find((v) => v.version === row.currentPromptVersion)?.template ?? "");
    setLoaded(true);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("details", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("summary", { children: "\u63D0\u793A\u8BCD\u3001\u7248\u672C\u53CA\u6536\u5C3E" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-stack tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(load, ""), children: loaded ? "\u91CD\u65B0\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u63D0\u793A\u8BCD\uFF08\u8986\u76D6\u5F53\u524D\u7F16\u8F91\uFF09" : "\u8BFB\u53D6\u63D0\u793A\u8BCD" }),
      loaded && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "tw-actions", children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => setTemplate(version.template), children: [
          "\u8F7D\u5165 v",
          version.version,
          version.version === row.currentPromptVersion ? " \xB7 \u5F53\u524D" : ""
        ] }, version.version)) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
          event.preventDefault();
          void act(async () => {
            await call("prompts", "save", { key: row.key, template, note: note || void 0, activate });
            setVersions(await call("prompts", "versions", { key: row.key }));
            await reload();
          }, "\u63D0\u793A\u8BCD\u7248\u672C\u5DF2\u4FDD\u5B58");
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u63D0\u793A\u8BCD\u6A21\u677F", required: true, multiline: true, value: template, onChange: setTemplate }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u7248\u672C\u5907\u6CE8", value: note, onChange: setNote }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: "\u4FDD\u5B58\u540E\u6FC0\u6D3B\u6B64\u7248\u672C", checked: activate, onChange: setActivate }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy, label: "\u4FDD\u5B58\u65B0\u7248\u672C" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Field, { label: "\u5DF2\u6709\u7248\u672C", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("select", { "aria-label": "\u6FC0\u6D3B\u63D0\u793A\u8BCD\u7248\u672C", value: row.currentPromptVersion, disabled: busy, onChange: (event) => {
          const version = Number(event.target.value);
          void act(async () => {
            await call("prompts", "activate", { key: row.key, version });
            await reload();
          }, "\u5DF2\u6FC0\u6D3B\u63D0\u793A\u8BCD\u7248\u672C");
        }, children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("option", { value: version.version, children: [
          "v",
          version.version,
          " \xB7 ",
          version.note || version.createdAt
        ] }, version.version)) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u9884\u89C8\u53D8\u91CF\uFF08JSON\uFF09", multiline: true, value: sample, onChange: setSample }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => setPreview(await call("prompts", "preview", { key: row.key, template, sample: jsonObject(sample, "\u9884\u89C8\u53D8\u91CF") })), ""), children: "\u9884\u89C8\u5F53\u524D\u6A21\u677F" }),
        preview && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { children: preview }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("summary", { children: "\u53EF\u7528\u53D8\u91CF" }),
          variables.map((variable) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "tw-record", children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: variable.name }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: variable.description }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { children: variable.example })
          ] }, variable.name))
        ] }),
        row.builtin && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => {
          const version = await call("prompts", "reset", { key: row.key });
          setTemplate(version.template);
          setVersions(await call("prompts", "versions", { key: row.key }));
          await reload();
        }, "\u5185\u7F6E\u63D0\u793A\u8BCD\u5DF2\u6062\u590D\u4E3A\u65B0\u7248\u672C"), children: "\u6062\u590D\u5185\u7F6E\u63D0\u793A\u8BCD" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack tw-section", onSubmit: (event) => {
        event.preventDefault();
        void act(async () => {
          await call("prompts", "save_wrapup", { key: row.key, kind: wrapKind, prompt: wrapPrompt, maxTurns: wrapTurns });
          await reload();
        }, "\u6536\u5C3E\u63D0\u793A\u8BCD\u5DF2\u4FDD\u5B58");
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Choice, { label: "\u6536\u5C3E\u7C7B\u578B", value: wrapKind, values: [["run", "\u5355\u6B21\u8FD0\u884C\u7ED3\u675F"], ["task_timeout", "\u4EFB\u52A1\u8D85\u65F6"]], onChange: (value) => {
          const kind = value === "run" ? "run" : "task_timeout";
          setWrapKind(kind);
          setWrapPrompt(kind === "run" ? row.wrapupPrompt : row.taskTimeoutWrapupPrompt);
          setWrapTurns(kind === "run" ? row.wrapupMaxTurns : row.taskTimeoutWrapupMaxTurns);
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u6536\u5C3E\u63D0\u793A\u8BCD", required: true, multiline: true, value: wrapPrompt, onChange: setWrapPrompt }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NumberField, { label: "\u6536\u5C3E\u8F6E\u6570", value: wrapTurns, onChange: setWrapTurns }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy, label: "\u4FDD\u5B58\u6536\u5C3E\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { type: "button", size: "sm", disabled: busy, onClick: () => void act(async () => {
          await call("prompts", "reset_wrapup", { key: row.key, kind: wrapKind });
          setWrapPrompt("");
          setWrapTurns(0);
          await reload();
        }, "\u6536\u5C3E\u8BBE\u7F6E\u5DF2\u6062\u590D\u9ED8\u8BA4"), children: "\u6062\u590D\u9ED8\u8BA4\u6536\u5C3E" })
      ] })
    ] })
  ] });
}
function VisibilityPanel({ agentKey, call, act, busy }) {
  const [data, setData] = import_react14.default.useState();
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("details", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("summary", { children: "MCP \u4E0E Skill \u53EF\u89C1\u6027" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-stack tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => setData(await call("visibility", "agent", { key: agentKey })), ""), children: "\u8BFB\u53D6\u8D44\u6E90\u7ED1\u5B9A" }),
      data && /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
        event.preventDefault();
        void act(() => call("visibility", "set_agent", { key: agentKey, bindings: { mcp: Object.fromEntries(data.mcp.map((v) => [v.id, v.visible])), skill: Object.fromEntries(data.skill.map((v) => [v.name, v.visible])) } }), "\u8D44\u6E90\u53EF\u89C1\u6027\u5DF2\u4FDD\u5B58");
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: "MCP \u670D\u52A1" }),
        data.mcp.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u5C1A\u672A\u914D\u7F6E MCP \u670D\u52A1\u3002" }),
        data.mcp.map((resource) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: `MCP #${resource.id}`, checked: resource.visible, onChange: (visible) => setData({ ...data, mcp: data.mcp.map((v) => v.id === resource.id ? { ...v, visible } : v) }) }, resource.id)),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: "Skills" }),
        data.skill.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u5C1A\u672A\u914D\u7F6E Skill\u3002" }),
        data.skill.map((resource) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: resource.name, checked: resource.visible, onChange: (visible) => setData({ ...data, skill: data.skill.map((v) => v.name === resource.name ? { ...v, visible } : v) }) }, resource.name)),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy, label: "\u4FDD\u5B58\u8D44\u6E90\u7ED1\u5B9A" })
      ] })
    ] })
  ] });
}
var events = [["finding", "\u65B0\u53D1\u73B0"], ["goal_met", "\u76EE\u6807\u8FBE\u6210"], ["task_timeout", "\u4EFB\u52A1\u8D85\u65F6"], ["tool_call", "\u5DE5\u5177\u8C03\u7528"], ["task_create", "\u4EFB\u52A1\u521B\u5EFA"]];
var emptyTrigger = () => ({ agentKey: "", enabled: true, intervalSeconds: 0, events: [], toolNames: [], messages: {} });
function TriggersPanel({ call, act, busy }) {
  const [snapshot, setSnapshot] = import_react14.default.useState(), [agents, setAgents] = import_react14.default.useState([]), [draft, setDraft] = import_react14.default.useState(emptyTrigger);
  const [tools, setTools] = import_react14.default.useState("");
  const load = import_react14.default.useCallback(async () => {
    setSnapshot(await call("triggers", "list"));
    setAgents((await call("agents", "list")).filter((agent) => !agent.builtin));
  }, [call]);
  import_react14.default.useEffect(() => {
    void act(load, "");
  }, [act, load]);
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(load, "\u89E6\u53D1\u8BB0\u5F55\u5DF2\u5237\u65B0"), children: "\u5237\u65B0\u89E6\u53D1\u5668" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => setSnapshot(await call("triggers", "step")), "\u5DF2\u8BFB\u53D6\u65B0\u4E8B\u4EF6\u5E76\u5B9E\u9645\u8C03\u5EA6"), children: "\u7ACB\u5373\u68C0\u67E5\u5E76\u8C03\u5EA6" })
    ] }),
    snapshot?.triggers.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u6682\u65E0\u89E6\u53D1\u5668\u3002\u5148\u521B\u5EFA\u81EA\u5B9A\u4E49 Agent\uFF0C\u518D\u914D\u7F6E\u89E6\u53D1\u6761\u4EF6\u3002" }),
    snapshot?.triggers.map((trigger) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "tw-record", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: trigger.agentKey }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { children: [
        trigger.intervalSeconds ? `\u6BCF ${trigger.intervalSeconds} \u79D2\uFF1B` : "",
        trigger.events.map((kind) => events.find((v) => v[0] === kind)?.[1]).join("\u3001")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Tag, { tone: trigger.enabled ? "success" : "outline", children: trigger.enabled ? "\u542F\u7528" : "\u505C\u7528" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", disabled: busy, onClick: () => {
          setDraft(trigger);
          setTools(trigger.toolNames.join("\n"));
        }, children: "\u7F16\u8F91\u89E6\u53D1\u5668" }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(DeleteAction, { label: "\u5220\u9664\u89E6\u53D1\u5668", disabled: busy, onDelete: () => act(async () => {
          await call("triggers", "delete", { id: trigger.id });
          await load();
          if (draft.id === trigger.id) setDraft(emptyTrigger());
        }, "\u89E6\u53D1\u5668\u5DF2\u5220\u9664") })
      ] })
    ] }, trigger.id)),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("form", { className: "tw-stack tw-section", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        await call("triggers", "save", { trigger: { ...draft, toolNames: lines(tools) } });
        await load();
        setDraft(emptyTrigger());
        setTools("");
      }, "\u89E6\u53D1\u5668\u5DF2\u4FDD\u5B58");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: draft.id ? "\u7F16\u8F91\u89E6\u53D1\u5668" : "\u65B0\u5EFA\u89E6\u53D1\u5668" }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Field, { label: "\u89E6\u53D1\u7684 Agent", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("select", { "aria-label": "\u89E6\u53D1\u7684 Agent", required: true, disabled: Boolean(draft.id), value: draft.agentKey, onChange: (event) => setDraft({ ...draft, agentKey: event.target.value }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "", children: "\u9009\u62E9\u81EA\u5B9A\u4E49 Agent" }),
        agents.map((agent) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: agent.key, children: agent.name }, agent.key))
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: "\u542F\u7528\u89E6\u53D1\u5668", checked: draft.enabled, onChange: (enabled) => setDraft({ ...draft, enabled }) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(NumberField, { label: "\u5B9A\u65F6\u95F4\u9694\uFF08\u79D2\uFF0C0 \u5173\u95ED\u5B9A\u65F6\uFF09", value: draft.intervalSeconds, onChange: (intervalSeconds) => setDraft({ ...draft, intervalSeconds }) }),
      events.map(([kind, label2]) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Checkbox, { label: label2, checked: draft.events.includes(kind), onChange: (checked) => setDraft({ ...draft, events: checked ? [...draft.events, kind] : draft.events.filter((value) => value !== kind) }) }, kind)),
      draft.events.includes("tool_call") && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: "\u89E6\u53D1\u5DE5\u5177\u540D\u79F0\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", multiline: true, required: true, value: tools, onChange: setTools }),
      [...draft.events, ...draft.intervalSeconds > 0 ? ["interval"] : []].map((kind) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TextField, { label: `${kind === "interval" ? "\u5B9A\u65F6" : events.find((v) => v[0] === kind)?.[1]}\u89E6\u53D1\u63D0\u793A\u8BCD`, multiline: true, value: draft.messages[kind] ?? "", onChange: (value) => setDraft({ ...draft, messages: { ...draft.messages, [kind]: value } }) }, kind)),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(SaveBar, { busy: busy || agents.length === 0, label: "\u4FDD\u5B58\u89E6\u53D1\u5668", onCancel: draft.id ? () => {
        setDraft(emptyTrigger());
        setTools("");
      } : void 0 })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "tw-stack tw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: "\u8FD0\u884C\u961F\u5217\u4E0E\u7ED3\u679C" }),
      snapshot?.runs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: "\u6682\u65E0\u89E6\u53D1\u8FD0\u884C\u3002" }),
      snapshot?.runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "tw-record", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "tw-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: run.agentKey }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives14.Tag, { tone: run.status === "failed" ? "danger" : run.status === "done" ? "success" : "outline", children: run.status })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: run.messages.join("\n") }),
        run.error && /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { role: "alert", children: run.error }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(JsonDetails, { value: run })
      ] }, run.id))
    ] })
  ] });
}

// src/platform/client-resources.tsx
var import_react15 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives15 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime15 = require("react/jsx-runtime");
function ToolsPanel({ call, act, busy }) {
  const [builtins, setBuiltins] = import_react15.default.useState([]), [customs, setCustoms] = import_react15.default.useState([]), [agents, setAgents] = import_react15.default.useState([]);
  const [selected, setSelected] = import_react15.default.useState();
  const [python, setPython] = import_react15.default.useState(""), [query, setQuery] = import_react15.default.useState("");
  const load = import_react15.default.useCallback(async () => {
    setBuiltins(await call("tools", "list"));
    setCustoms(await call("tools", "custom_list"));
    setAgents(await call("agents", "list"));
  }, [call]);
  import_react15.default.useEffect(() => {
    void act(async () => {
      await load();
      setPython((await call("tools", "python_get")).path);
    }, "");
  }, [act, call, load]);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => setSelected({ kind: "custom" }), children: "\u65B0\u5EFA\u81EA\u5B9A\u4E49\u5DE5\u5177" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => void act(load, "\u5DE5\u5177\u5217\u8868\u5DF2\u5237\u65B0"), children: "\u5237\u65B0\u5DE5\u5177" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u641C\u7D22\u5DE5\u5177", value: query, onChange: setQuery }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("summary", { children: "Python \u89E3\u91CA\u5668" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("form", { className: "tw-stack tw-gap", onSubmit: (event) => {
        event.preventDefault();
        void act(() => call("tools", "python_set", { path: python }), "Python \u89E3\u91CA\u5668\u8DEF\u5F84\u5DF2\u4FDD\u5B58");
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "Python \u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84", value: python, required: true, onChange: setPython }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SaveBar, { busy })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("h3", { children: [
      "\u81EA\u5B9A\u4E49\u5DE5\u5177\uFF08",
      customs.length,
      "\uFF09"
    ] }),
    customs.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0\u81EA\u5B9A\u4E49\u5DE5\u5177\u3002\u652F\u6301\u547D\u4EE4\u3001Python \u811A\u672C\u3001HTTP \u8BF7\u6C42\u548C\u7EC8\u7AEF\u5DE5\u5177\u3002" }),
    customs.filter((row) => `${row.key} ${row.description}`.toLowerCase().includes(query.toLowerCase())).map((row) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("article", { className: "tw-record", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: row.key }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Tag, { children: row.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Tag, { tone: row.enabled ? "success" : "outline", children: row.enabled ? "\u542F\u7528" : "\u505C\u7528" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: row.description }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => setSelected({ kind: "custom", row }), children: "\u7F16\u8F91\u5DE5\u5177" }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(DeleteAction, { label: "\u5220\u9664\u5DE5\u5177", disabled: busy, onDelete: () => act(async () => {
          await call("tools", "custom_delete", { key: row.key });
          await load();
          if (selected?.row?.key === row.key) setSelected(void 0);
        }, "\u81EA\u5B9A\u4E49\u5DE5\u5177\u5DF2\u5220\u9664") })
      ] })
    ] }, row.key)),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("summary", { children: [
        "\u5185\u7F6E\u5DE5\u5177\uFF08",
        builtins.length,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "mg-list tw-gap", children: builtins.filter((row) => `${row.key} ${row.description}`.toLowerCase().includes(query.toLowerCase())).map((row) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("article", { className: "tw-record", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: row.key }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: row.description }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => setSelected({ kind: "builtin", row }), children: "\u914D\u7F6E\u5DE5\u5177" })
      ] }, row.key)) })
    ] }),
    selected?.kind === "builtin" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(BuiltinEditor, { row: selected.row, agents, call, act, busy, reload: load, close: () => setSelected(void 0) }, `builtin-${selected.row.key}`),
    selected?.kind === "custom" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(CustomEditor, { row: selected.row, agents, call, act, busy, reload: load, close: () => setSelected(void 0) }, `custom-${selected.row?.key ?? "new"}`)
  ] });
}
function BuiltinEditor({ row, agents, call, act, busy, reload, close }) {
  const [description, setDescription] = import_react15.default.useState(row.description), [schema, setSchema] = import_react15.default.useState(pretty(row.schema)), [bindings, setBindings] = import_react15.default.useState(row.agents), [enabled, setEnabled] = import_react15.default.useState(row.enabled);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("form", { className: "tw-stack tw-section", onSubmit: (event) => {
    event.preventDefault();
    void act(async () => {
      await call("tools", "update", { key: row.key, patch: { description, schema: jsonObject(schema, "\u5DE5\u5177 schema"), agents: bindings, enabled } });
      await reload();
    }, "\u5DE5\u5177\u914D\u7F6E\u5DF2\u4FDD\u5B58");
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("h3", { children: [
      "\u914D\u7F6E ",
      row.key
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u5DE5\u5177\u63CF\u8FF0", multiline: true, value: description, onChange: setDescription }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u53C2\u6570 schema\uFF08JSON\uFF09", multiline: true, value: schema, onChange: setSchema, hint: "\u4FDD\u7559\u5B9E\u9645\u53C2\u6570\u7ED3\u6784\uFF0C\u53EA\u4FEE\u6539\u670D\u52A1\u5141\u8BB8\u7684\u63CF\u8FF0\u4E0E\u9ED8\u8BA4\u503C\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u542F\u7528\u5DE5\u5177", checked: enabled, onChange: setEnabled }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(AgentBindings, { agents, selected: bindings, onChange: setBindings }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SaveBar, { busy, onCancel: close }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { type: "button", size: "sm", disabled: busy, onClick: () => void act(async () => {
      const reset = await call("tools", "reset", { key: row.key });
      setDescription(reset.description);
      setSchema(pretty(reset.schema));
      setBindings(reset.agents);
      setEnabled(reset.enabled);
      await reload();
    }, "\u5185\u7F6E\u5DE5\u5177\u5DF2\u6062\u590D\u9ED8\u8BA4"), children: "\u6062\u590D\u5185\u7F6E\u5DE5\u5177\u9ED8\u8BA4\u914D\u7F6E" })
  ] });
}
function CustomEditor({ row, agents, call, act, busy, reload, close }) {
  const [key, setKey] = import_react15.default.useState(row?.key ?? ""), [description, setDescription] = import_react15.default.useState(row?.description ?? ""), [kind, setKind] = import_react15.default.useState(row?.kind ?? "script");
  const [schema, setSchema] = import_react15.default.useState(pretty(row?.schema ?? { type: "object", properties: {} })), [bindings, setBindings] = import_react15.default.useState(row?.agents ?? []), [enabled, setEnabled] = import_react15.default.useState(row?.enabled ?? true), [deferred, setDeferred] = import_react15.default.useState(row?.deferred ?? false);
  const [command, setCommand] = import_react15.default.useState(typeof row?.exec.command === "string" ? row.exec.command : ""), [code, setCode] = import_react15.default.useState(typeof row?.exec.code === "string" ? row.exec.code : ""), [url, setUrl] = import_react15.default.useState(typeof row?.exec.url === "string" ? row.exec.url : "");
  const [method, setMethod] = import_react15.default.useState(typeof row?.exec.method === "string" ? row.exec.method : "GET"), [headers, setHeaders] = import_react15.default.useState(pretty(row?.exec.headers ?? {})), [body, setBody] = import_react15.default.useState(typeof row?.exec.body === "string" ? row.exec.body : "");
  const [proxy, setProxy] = import_react15.default.useState(typeof row?.exec.proxy === "string" ? row.exec.proxy : ""), [recordingProxy, setRecordingProxy] = import_react15.default.useState(row?.exec.use_recording_proxy === true), [timeout, setTimeout2] = import_react15.default.useState(typeof row?.exec.timeout_ms === "number" ? row.exec.timeout_ms : 12e4);
  const [params, setParams] = import_react15.default.useState("{}"), [result, setResult] = import_react15.default.useState();
  function tool() {
    const exec = { ...row?.exec ?? {}, timeout_ms: timeout };
    if (kind === "script") exec.code = code;
    if (kind === "command") exec.command = command;
    if (kind === "http") Object.assign(exec, { url, method, headers: jsonObject(headers, "HTTP headers"), body, proxy, use_recording_proxy: recordingProxy });
    return { key, description, kind, exec, schema: jsonObject(schema, "\u53C2\u6570 schema"), agents: bindings, enabled, deferred };
  }
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "tw-stack tw-section", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        await call("tools", row ? "custom_update" : "custom_create", { key: row?.key, tool: tool() });
        await reload();
        close();
      }, "\u81EA\u5B9A\u4E49\u5DE5\u5177\u5DF2\u4FDD\u5B58");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: row ? `\u7F16\u8F91 ${row.key}` : "\u65B0\u5EFA\u81EA\u5B9A\u4E49\u5DE5\u5177" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u5DE5\u5177\u6807\u8BC6", required: true, disabled: Boolean(row), value: key, onChange: setKey }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u5DE5\u5177\u63CF\u8FF0", required: true, multiline: true, value: description, onChange: setDescription }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Choice, { label: "\u5DE5\u5177\u7C7B\u578B", value: kind, values: [["script", "Python \u811A\u672C"], ["command", "\u7CFB\u7EDF\u547D\u4EE4"], ["http", "HTTP \u8BF7\u6C42"], ["shell", "\u4EA4\u4E92\u5F0F\u7EC8\u7AEF"]], onChange: (value) => {
        if (value === "script" || value === "command" || value === "http" || value === "shell") setKind(value);
      } }),
      kind === "script" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "Python \u6E90\u7801", required: true, multiline: true, value: code, onChange: setCode, hint: "\u8F93\u5165\u53C2\u6570\u901A\u8FC7\u6807\u51C6\u8F93\u5165\u4F20\u5165 JSON\u3002\u6267\u884C\u7ED3\u679C\u7531\u6807\u51C6\u8F93\u51FA\u8FD4\u56DE\u3002" }),
      kind === "command" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u547D\u4EE4\u6A21\u677F", required: true, multiline: true, value: command, onChange: setCommand, hint: "\u53EF\u4F7F\u7528 {{\u53C2\u6570\u540D}} \u66FF\u6362\u7ECF\u8F6C\u4E49\u7684\u53C2\u6570\u3002" }),
      kind === "shell" && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: "\u4EA4\u4E92\u5F0F\u7EC8\u7AEF\u4F7F\u7528\u5DE5\u5177\u53C2\u6570\u63D0\u4F9B\u547D\u4EE4\uFF0C\u7531\u5BBF\u4E3B\u6267\u884C\u8FB9\u754C\u63A7\u5236\u3002" }),
      kind === "http" && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u8BF7\u6C42 URL \u6A21\u677F", required: true, value: url, onChange: setUrl }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "HTTP \u65B9\u6CD5", required: true, value: method, onChange: setMethod }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "HTTP \u8BF7\u6C42\u5934\uFF08JSON\uFF09", multiline: true, value: headers, onChange: setHeaders }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u8BF7\u6C42\u6B63\u6587\u6A21\u677F", multiline: true, value: body, onChange: setBody }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u4EE3\u7406\u5730\u5740\uFF08\u53EF\u9009\uFF09", value: proxy, onChange: setProxy }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u901A\u8FC7\u6D41\u91CF\u8BB0\u5F55\u4EE3\u7406\u53D1\u9001", checked: recordingProxy, onChange: setRecordingProxy })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(NumberField, { label: "\u6267\u884C\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09", value: timeout, onChange: setTimeout2 }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u53C2\u6570 schema\uFF08JSON\uFF09", multiline: true, value: schema, onChange: setSchema }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(AgentBindings, { agents, selected: bindings, onChange: setBindings }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u542F\u7528\u5DE5\u5177", checked: enabled, onChange: setEnabled }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u6309\u9700\u52A0\u8F7D\u5DE5\u5177", checked: deferred, onChange: setDeferred }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SaveBar, { busy, onCancel: close })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-stack tw-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: "\u6D4B\u8BD5\u5F53\u524D\u914D\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "tw-muted", children: "\u6D4B\u8BD5\u4F1A\u5B9E\u9645\u6267\u884C\u5F53\u524D\u8868\u5355\u4E2D\u7684\u811A\u672C\u3001\u547D\u4EE4\u6216\u8BF7\u6C42\uFF0C\u4E0D\u4F1A\u4FDD\u5B58\u914D\u7F6E\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u6D4B\u8BD5\u53C2\u6570\uFF08JSON\uFF09", multiline: true, value: params, onChange: setParams }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => setResult(await call("tools", "custom_test", { tool: tool(), params: jsonObject(params, "\u6D4B\u8BD5\u53C2\u6570") })), "\u5DE5\u5177\u6D4B\u8BD5\u5DF2\u8FD4\u56DE"), children: "\u6267\u884C\u6D4B\u8BD5" }),
      result !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(JsonDetails, { value: result, summary: "\u5B9E\u9645\u6267\u884C\u7ED3\u679C", open: true })
    ] })
  ] });
}
function McpPanel({ call, act, busy }) {
  const [servers, setServers] = import_react15.default.useState([]), [editing, setEditing] = import_react15.default.useState(), [discovery, setDiscovery] = import_react15.default.useState();
  const load = import_react15.default.useCallback(async () => setServers(await call("mcp", "list")), [call]);
  import_react15.default.useEffect(() => {
    void act(load, "");
  }, [act, load]);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => setEditing("new"), children: "\u6DFB\u52A0 MCP \u670D\u52A1" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => void act(load, "MCP \u5217\u8868\u5DF2\u5237\u65B0"), children: "\u5237\u65B0 MCP" })
    ] }),
    servers.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "tw-muted", children: "\u5C1A\u672A\u914D\u7F6E MCP \u670D\u52A1\u3002" }),
    servers.map((server) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("article", { className: "tw-record", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: server.name }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Tag, { children: server.transport }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Tag, { tone: server.enabled ? "success" : "outline", children: server.enabled ? "\u542F\u7528" : "\u505C\u7528" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "mg-code", children: server.transport === "stdio" ? server.command : server.url }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
        server.tools.length,
        " \u4E2A\u5DF2\u53D1\u73B0\u5DE5\u5177"
      ] }),
      server.discoveryError && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { role: "alert", children: server.discoveryError }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => setEditing(server), children: "\u7F16\u8F91\u670D\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => {
          try {
            setDiscovery(await call("mcp", "discover", { id: server.id }));
          } finally {
            await load();
          }
        }, "\u5DF2\u6267\u884C\u771F\u5B9E MCP \u5DE5\u5177\u53D1\u73B0"), children: "\u53D1\u73B0\u5DE5\u5177" }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(DeleteAction, { label: "\u5220\u9664 MCP \u670D\u52A1", disabled: busy, onDelete: () => act(async () => {
          await call("mcp", "delete", { id: server.id });
          await load();
          if (editing !== "new" && editing?.id === server.id) setEditing(void 0);
        }, "MCP \u670D\u52A1\u53CA\u7ED1\u5B9A\u5DF2\u5220\u9664") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(JsonDetails, { value: server.tools, summary: "\u5DE5\u5177\u6E05\u5355\u4E0E\u53C2\u6570" }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ResourceBindings, { kind: "mcp", id: String(server.id), call, act, busy })
    ] }, server.id)),
    discovery !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(JsonDetails, { value: discovery, summary: "\u6700\u8FD1\u53D1\u73B0\u7ED3\u679C", open: true }),
    editing && /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(McpEditor, { row: editing === "new" ? void 0 : editing, call, act, busy, reload: load, close: () => setEditing(void 0) }, editing === "new" ? "new" : editing.id)
  ] });
}
function McpEditor({ row, call, act, busy, reload, close }) {
  const [name, setName] = import_react15.default.useState(row?.name ?? ""), [transport, setTransport] = import_react15.default.useState(row?.transport ?? "stdio");
  const [command, setCommand] = import_react15.default.useState(row?.command ?? ""), [args, setArgs] = import_react15.default.useState((row?.args ?? []).join("\n")), [env, setEnv] = import_react15.default.useState(pretty(row?.env ?? {})), [url, setUrl] = import_react15.default.useState(row?.url ?? ""), [enabled, setEnabled] = import_react15.default.useState(row?.enabled ?? true), [insecure, setInsecure] = import_react15.default.useState(row?.insecure ?? false);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("form", { className: "tw-stack tw-section", onSubmit: (event) => {
    event.preventDefault();
    void act(async () => {
      try {
        await call("mcp", "save", { server: { id: row?.id, name, transport, command, args: lines(args), env: jsonObject(env, transport === "stdio" ? "\u73AF\u5883\u53D8\u91CF" : "\u8BF7\u6C42\u5934"), url, enabled, insecure } });
      } finally {
        await reload();
      }
      close();
    }, "MCP \u914D\u7F6E\u5DF2\u4FDD\u5B58\u5E76\u5B8C\u6210\u542F\u7528\u670D\u52A1\u7684\u53D1\u73B0");
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: row ? "\u7F16\u8F91 MCP \u670D\u52A1" : "\u65B0\u5EFA MCP \u670D\u52A1" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u670D\u52A1\u540D\u79F0", required: true, value: name, onChange: setName }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Choice, { label: "MCP \u4F20\u8F93\u65B9\u5F0F", value: transport, values: [["stdio", "\u672C\u5730\u6807\u51C6\u8F93\u5165\u8F93\u51FA"], ["http", "Streamable HTTP"], ["sse", "SSE"]], onChange: (value) => {
      if (value === "stdio" || value === "http" || value === "sse") setTransport(value);
    } }),
    transport === "stdio" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u542F\u52A8\u547D\u4EE4", required: true, value: command, onChange: setCommand }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "\u547D\u4EE4\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", multiline: true, value: args, onChange: setArgs })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: "MCP URL", required: true, value: url, onChange: setUrl }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u5141\u8BB8\u4E0D\u53D7\u4FE1\u4EFB\u7684 TLS \u8BC1\u4E66", checked: insecure, onChange: setInsecure })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(TextField, { label: transport === "stdio" ? "\u73AF\u5883\u53D8\u91CF\uFF08JSON\uFF09" : "\u8BA4\u8BC1\u53CA\u8BF7\u6C42\u5934\uFF08JSON\uFF09", multiline: true, value: env, onChange: setEnv }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: "\u542F\u7528\u670D\u52A1\u5E76\u7ACB\u5373\u53D1\u73B0\u5DE5\u5177", checked: enabled, onChange: setEnabled }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SaveBar, { busy, onCancel: close })
  ] });
}
function ResourceBindings({ kind, id, call, act, busy }) {
  const [bindings, setBindings] = import_react15.default.useState();
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("details", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("summary", { children: "\u54EA\u4E9B Agent \u53EF\u4EE5\u4F7F\u7528\u6B64\u8D44\u6E90" }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "tw-stack tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Button, { size: "sm", disabled: busy, onClick: () => void act(async () => setBindings(await call("visibility", "resource", { kind, id })), ""), children: "\u8BFB\u53D6 Agent \u7ED1\u5B9A" }),
      bindings && /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
        event.preventDefault();
        void act(() => call("visibility", "set_resource", { kind, id, bindings: Object.fromEntries(bindings.map((binding) => [binding.agentKey, binding.enabled])) }), "Agent \u7ED1\u5B9A\u5DF2\u4FDD\u5B58");
      }, children: [
        bindings.map((binding) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives15.Checkbox, { label: binding.agentKey, checked: binding.enabled, onChange: (enabled) => setBindings(bindings.map((item) => item.agentKey === binding.agentKey ? { ...item, enabled } : item)) }, binding.agentKey)),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(SaveBar, { busy, label: "\u4FDD\u5B58 Agent \u7ED1\u5B9A" })
      ] })
    ] })
  ] });
}

// src/platform/client.tsx
var import_jsx_runtime16 = require("react/jsx-runtime");
var views = [
  { id: "platform-agents", panelId: "platform-agents-panel", value: "agents", label: "Agent" },
  { id: "platform-tools", panelId: "platform-tools-panel", value: "tools", label: "\u5DE5\u5177" },
  { id: "platform-mcp", panelId: "platform-mcp-panel", value: "mcp", label: "MCP" },
  { id: "platform-skills", panelId: "platform-skills-panel", value: "skills", label: "Skills" },
  { id: "platform-triggers", panelId: "platform-triggers-panel", value: "triggers", label: "\u89E6\u53D1\u5668" }
];
function PlatformManagementTab({ visible, scope }) {
  const [view, setView] = import_react16.default.useState("agents");
  const sessionId = scope?.sessionId;
  const { call, act, busy, error, notice } = usePlatformApi(sessionId);
  const [contract, setContract] = import_react16.default.useState();
  const [contractError, setContractError] = import_react16.default.useState("");
  const [contractLoading, setContractLoading] = import_react16.default.useState(false);
  const loadContract = import_react16.default.useCallback(async (signal) => {
    setContractLoading(true);
    setContractError("");
    try {
      const value = await requestJson("/api/redteam/platform/contract", { signal });
      if (!signal?.aborted) setContract(value);
    } catch (failure) {
      if (!signal?.aborted) setContractError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (!signal?.aborted) setContractLoading(false);
    }
  }, []);
  import_react16.default.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    void loadContract(controller.signal);
    return () => controller.abort();
  }, [loadContract, visible]);
  let panel;
  if (view === "agents") panel = /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(AgentsPanel, { call, act, busy, sessionId });
  else if (view === "tools") panel = /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ToolsPanel, { call, act, busy });
  else if (view === "mcp") panel = /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(McpPanel, { call, act, busy });
  else if (view === "skills") panel = /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(SkillsPanel, { call, act, busy });
  else panel = /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(TriggersPanel, { call, act, busy });
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
    ManagementPage,
    {
      title: "\u5E73\u53F0\u8D44\u6E90\u7BA1\u7406",
      description: "Agent\u3001\u63D0\u793A\u8BCD\u3001\u5DE5\u5177\u3001MCP\u3001Skill \u4E0E\u89E6\u53D1\u5668\u5747\u901A\u8FC7\u5BBF\u4E3B owner API \u6301\u4E45\u5316\u3002",
      loading: contractLoading || busy,
      error: error || contractError,
      notice,
      actions: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives16.Button, { size: "sm", disabled: busy || contractLoading || !visible, onClick: () => void loadContract(), children: "\u5237\u65B0\u5951\u7EA6" }),
      toolbar: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives16.SegmentedTabs, { label: "\u5E73\u53F0\u7BA1\u7406\u89C6\u56FE", value: view, onChange: (value) => setView(value), items: views }),
      children: [
        !contract ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "tw-muted", role: "status", children: contractLoading ? "\u6B63\u5728\u8BFB\u53D6\u5E73\u53F0\u7BA1\u7406\u5951\u7EA6\u2026" : "\u5E73\u53F0\u7BA1\u7406\u5951\u7EA6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u68C0\u67E5\u5BBF\u4E3B\u8DEF\u7531\u6216\u6743\u9650\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { id: `platform-${view}-panel`, role: "tabpanel", children: panel }),
        contract !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: "\u5F53\u524D\u5BBF\u4E3B\u80FD\u529B\u5951\u7EA6" }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { children: String(JSON.stringify(contract, null, 2)) })
        ] })
      ]
    }
  );
}
function SkillsPanel({ call, act, busy }) {
  const [skills, setSkills] = import_react16.default.useState([]), [loaded, setLoaded] = import_react16.default.useState(false), [name, setName] = import_react16.default.useState(""), [description, setDescription] = import_react16.default.useState("");
  const load = import_react16.default.useCallback(async () => {
    setSkills(await call("skills", "list"));
    setLoaded(true);
  }, [call]);
  import_react16.default.useEffect(() => {
    void act(load, "");
  }, [act, load]);
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "tw-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "tw-actions", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives16.Button, { size: "sm", disabled: busy, onClick: () => void act(load, "Skill \u5217\u8868\u5DF2\u5237\u65B0"), children: "\u5237\u65B0" }) }),
    !loaded ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6 Skill\u2026" }) : skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "tw-muted", children: "\u6CA1\u6709 Skill\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "mg-list", children: skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("article", { className: "tw-card tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: skill.name }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: skill.description || "\u65E0\u63CF\u8FF0" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "mg-meta", children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: skill.directory ?? skill.name }) })
    ] }, skill.directory ?? skill.name)) }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("form", { className: "tw-card tw-stack", onSubmit: (event) => {
      event.preventDefault();
      void act(async () => {
        await call("skills", "create", { name: name.trim(), description: description.trim() });
        await load();
        setName("");
        setDescription("");
      }, "Skill \u5DF2\u521B\u5EFA");
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: "\u521B\u5EFA Skill" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { className: "tw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: "\u540D\u79F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("input", { "aria-label": "Skill \u540D\u79F0", value: name, onChange: (event) => setName(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { className: "tw-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: "\u63CF\u8FF0" }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { "aria-label": "Skill \u63CF\u8FF0", value: description, onChange: (event) => setDescription(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives16.Button, { type: "submit", size: "sm", variant: "primary", disabled: busy || !name.trim(), children: "\u521B\u5EFA Skill" })
      ] })
    ] })
  ] });
}

// src/host-management/client.tsx
var import_react17 = require("react");
var import_dsh_client_ui_primitives17 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime17 = require("react/jsx-runtime");
function HostManagementPage({ visible = true }) {
  const [health, setHealth] = (0, import_react17.useState)();
  const [stats, setStats] = (0, import_react17.useState)();
  const [logs, setLogs] = (0, import_react17.useState)([]);
  const [update, setUpdate] = (0, import_react17.useState)();
  const [updateAvailable, setUpdateAvailable] = (0, import_react17.useState)(false);
  const [error, setError] = (0, import_react17.useState)("");
  const [notice, setNotice] = (0, import_react17.useState)("");
  const [spec, setSpec] = (0, import_react17.useState)("");
  const [busy, setBusy] = (0, import_react17.useState)(false);
  const refresh = async () => {
    setError("");
    const results = await Promise.allSettled([requestJson("/api/redteam/host/health"), requestJson("/api/redteam/host/stats"), requestJson("/api/redteam/host/logs?limit=100"), requestJson("/api/redteam/host/update/check")]);
    const [h, s, l, u] = results;
    if (h.status === "fulfilled") setHealth(h.value);
    if (s.status === "fulfilled") setStats(s.value);
    if (l.status === "fulfilled") setLogs(l.value.items);
    if (u.status === "fulfilled") {
      setUpdate(u.value);
      setUpdateAvailable(true);
    } else {
      setUpdateAvailable(false);
      setUpdate(void 0);
    }
    const core = results.slice(0, 3).filter((result) => result.status === "rejected");
    if (core.length) setError(core.map((result) => errorMessage(result.reason)).join("\n"));
  };
  (0, import_react17.useEffect)(() => {
    if (visible) void refresh();
  }, [visible]);
  (0, import_react17.useEffect)(() => {
    if (!visible) return;
    const source = new EventSource(apiUrl("/api/redteam/host/logs/stream").toString(), { withCredentials: true });
    source.onmessage = (event) => {
      try {
        const row = JSON.parse(event.data);
        setLogs((current) => [...current, row].slice(-200));
      } catch {
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [visible]);
  const loadHistory = async () => {
    const before = logs[0]?.seq;
    if (!before || busy) return;
    setBusy(true);
    try {
      const result = await requestJson("/api/redteam/host/logs/history?before=" + encodeURIComponent(String(before)) + "&limit=100");
      setLogs((current) => [...result.items, ...current.filter((row) => !result.items.some((item) => item.seq === row.seq))]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const apply2 = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setError("");
      setNotice("");
      const result = await requestJson("/api/redteam/host/update/apply", { method: "POST", body: JSON.stringify(spec ? { spec } : {}) });
      setNotice("\u66F4\u65B0\u64CD\u4F5C\u5DF2\u63D0\u4EA4\uFF0C\u9875\u9762\u4F1A\u901A\u8FC7\u65E5\u5FD7\u6D41\u663E\u793A\u8FDB\u5EA6\u3002");
      setUpdate(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const rollback = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!spec.trim() || typeof update?.runtime !== "string" || !update.runtime) throw new Error("\u8BF7\u5148\u68C0\u67E5\u7248\u672C\u5E76\u586B\u5199\u76EE\u6807\u5305\u6E90\uFF1B\u663E\u5F0F\u964D\u7EA7\u8FD8\u9700\u8981\u5339\u914D\u5F53\u524D DSH runtime \u7684\u517C\u5BB9\u6027\u6E05\u5355\u3002");
      setError("");
      setNotice("");
      const result = await requestJson("/api/redteam/host/update/rollback", { method: "POST", body: JSON.stringify({ spec: spec.trim(), compatibility: { runtimeVersion: update.runtime, rollback: true } }) });
      setNotice("\u5DF2\u63D0\u4EA4\u663E\u5F0F\u7248\u672C\u5B89\u88C5\u8BF7\u6C42\uFF0C\u5BBF\u4E3B\u4F1A\u8FD4\u56DE\u53EF\u6838\u9A8C\u72B6\u6001\u3002");
      setUpdate(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(ManagementPage, { title: "\u5BBF\u4E3B\u4E0E\u66F4\u65B0", description: "\u67E5\u770B DSH \u5BBF\u4E3B\u5065\u5EB7\u72B6\u6001\u3001\u5F15\u64CE\u7EDF\u8BA1\u548C\u670D\u52A1\u65E5\u5FD7\uFF0C\u5E76\u7BA1\u7406\u63D2\u4EF6\u7248\u672C\u3002", loading: !health && !stats && !logs.length && !error, error, notice, actions: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Button, { size: "sm", disabled: !visible || busy, onClick: () => void refresh(), children: "\u5237\u65B0" }), children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: "\u5065\u5EB7" }),
        health ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("p", { role: "status", children: [
          health.ok ? "\u8FD0\u884C\u6B63\u5E38" : "\u5F02\u5E38",
          " \xB7 ",
          health.service,
          " \xB7 ",
          health.version
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0\u6570\u636E" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: "\u5F15\u64CE\u7EDF\u8BA1" }),
        stats ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(JsonDetails, { value: stats, open: true }) : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0\u6570\u636E" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: "\u63D2\u4EF6\u7248\u672C" }),
      updateAvailable ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)(import_jsx_runtime17.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(Field, { label: "\u5305\u89C4\u683C", hint: "\u4F8B\u5982 registry \u5305\u540D\u6216\u9694\u79BB\u6D4B\u8BD5\u7528\u672C\u5730 tarball\uFF1B\u663E\u5F0F\u7248\u672C\u5B89\u88C5\u9700\u8981\u5305\u6E90\u53CA\u517C\u5BB9\u6027\u6E05\u5355", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Input, { value: spec, onChange: (event) => setSpec(event.target.value), placeholder: "package@version \u6216\u672C\u5730 .tgz", disabled: busy }) }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Button, { size: "sm", disabled: busy, onClick: () => void refresh(), children: "\u68C0\u67E5\u7248\u672C" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Button, { size: "sm", disabled: busy || !spec.trim(), onClick: () => void apply2(), children: "\u63D0\u4EA4\u5B89\u88C5/\u5347\u7EA7" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Button, { size: "sm", disabled: busy || !spec.trim(), onClick: () => void rollback(), children: "\u63D0\u4EA4\u663E\u5F0F\u7248\u672C\u5B89\u88C5\uFF08\u56DE\u9000\uFF09" })
        ] }),
        update && /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(JsonDetails, { value: update, summary: "\u7248\u672C\u68C0\u67E5\u7ED3\u679C", open: true })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(Notice, { children: "\u5F53\u524D\u5BBF\u4E3B\u6CA1\u6709\u5B89\u88C5 DSH \u7248\u672C\u7BA1\u7406\u9002\u914D\u5668\uFF0C\u65E0\u6CD5\u63D0\u4F9B update/check/apply/rollback\uFF1B\u63D2\u4EF6 CLI \u7684\u771F\u5B9E\u80FD\u529B\u4E0E\u7F3A\u53E3\u89C1 parity \u77E9\u9635\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: "\u670D\u52A1\u65E5\u5FD7" }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives17.Button, { size: "sm", disabled: busy || !logs.length, onClick: () => void loadHistory(), children: "\u52A0\u8F7D\u66F4\u65E9\u65E5\u5FD7" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "mg-list", children: logs.length ? logs.map((row) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "mg-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { className: "mg-code", children: [
          "#",
          row.seq
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: row.ts }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: row.level }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: row.tag }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: row.text })
      ] }, row.seq)) : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0\u65E5\u5FD7" }) })
    ] })
  ] });
}

// src/conversation-workspace/client.tsx
var import_react21 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives21 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/conversation-workspace/client-files.tsx
var import_react19 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives19 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/conversation-workspace/client-common.tsx
var import_react18 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives18 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime18 = require("react/jsx-runtime");
var conversationPath = "/api/redteam/conversation-workspace";
var conversationUrl = (id, action = "") => `${conversationPath}/conversations/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
var jsonBody = (value) => ({ method: "POST", body: JSON.stringify(value) });
var dateTime = (value) => new Date(value).toLocaleString("zh-CN", { hour12: false });
function useOperation() {
  const [busy, setBusy] = import_react18.default.useState(false), [error, setError] = import_react18.default.useState(""), [notice, setNotice] = import_react18.default.useState("");
  const mounted = import_react18.default.useRef(true), locked = import_react18.default.useRef(false);
  import_react18.default.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = import_react18.default.useCallback(async (work, success = "") => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (mounted.current) setNotice(success);
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  return { busy, error, notice, run, setError, setNotice };
}
function ConfirmDelete({ label: label2, description, disabled, onConfirm }) {
  const [confirm, setConfirm] = import_react18.default.useState(false);
  return confirm ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "tw-gap", role: "group", "aria-label": `\u786E\u8BA4${label2}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: description }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "tw-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_dsh_client_ui_primitives18.Button, { size: "sm", disabled, onClick: () => {
        void onConfirm().then(() => setConfirm(false));
      }, children: [
        "\u786E\u8BA4",
        label2
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(import_dsh_client_ui_primitives18.Button, { size: "sm", disabled, onClick: () => setConfirm(false), children: "\u53D6\u6D88" })
    ] })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(import_dsh_client_ui_primitives18.Button, { size: "sm", disabled, onClick: () => setConfirm(true), children: label2 });
}

// src/conversation-workspace/client-files.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
function WorkspaceFilesPanel({ visible, initialPath = "" }) {
  const [path, setPath] = import_react19.default.useState(initialPath), [pathInput, setPathInput] = import_react19.default.useState(initialPath);
  const [entries, setEntries] = import_react19.default.useState([]), [loading, setLoading] = import_react19.default.useState(false), [loadError, setLoadError] = import_react19.default.useState("");
  const [editor, setEditor] = import_react19.default.useState(), [content, setContent] = import_react19.default.useState(""), [dirty, setDirty] = import_react19.default.useState(false);
  const [newPath, setNewPath] = import_react19.default.useState(""), [revision, setRevision] = import_react19.default.useState(0);
  const operation = useOperation();
  import_react19.default.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    void requestJson(apiUrl(`${conversationPath}/files/list`, { path }), { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setEntries(result.entries);
        setLoadError("");
      }
    }).catch((failure) => {
      if (!controller.signal.aborted) {
        setEntries([]);
        setLoadError(errorMessage(failure));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [path, visible, revision]);
  const refresh = () => setRevision((value) => value + 1);
  async function read(file) {
    await operation.run(async () => {
      const result = await requestJson(apiUrl(`${conversationPath}/files/read`, { path: file }));
      setEditor(result);
      setContent(result.content ?? "");
      setDirty(false);
    });
  }
  function navigate(value) {
    setPath(value);
    setPathInput(value);
    setEntries([]);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-stack", children: [
    loadError && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Notice, { tone: "error", children: loadError }),
    operation.error && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Notice, { tone: "error", children: operation.error }),
    operation.notice && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Notice, { tone: "success", children: operation.notice }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("form", { className: "tw-inline", onSubmit: (event) => {
      event.preventDefault();
      navigate(pathInput);
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Input, { "aria-label": "\u5DE5\u4F5C\u533A\u76EE\u5F55", className: "tw-grow", value: pathInput, onChange: (event) => setPathInput(event.target.value), placeholder: "\u76F8\u5BF9\u5DE5\u4F5C\u533A\u8DEF\u5F84\uFF1B\u7559\u7A7A\u4E3A\u6839\u76EE\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", type: "submit", children: "\u6253\u5F00\u76EE\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", type: "button", disabled: loading, onClick: refresh, children: "\u5237\u65B0\u6587\u4EF6" }),
      path && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", type: "button", onClick: () => navigate(path.split("/").slice(0, -1).join("/")), children: "\u4E0A\u7EA7\u76EE\u5F55" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: "\u65B0\u5EFA\u4E0E\u4E0A\u4F20" }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Field, { label: "\u65B0\u6587\u4EF6\u6216\u76EE\u5F55\u8DEF\u5F84", hint: "\u76F8\u5BF9\u4E8E\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\uFF1B\u4E0A\u4F20\u76EE\u6807\u662F\u5F53\u524D\u6253\u5F00\u7684\u76EE\u5F55\u3002", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Input, { value: newPath, onChange: (event) => setNewPath(event.target.value), placeholder: path ? `${path}/notes.txt` : "notes.txt" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", disabled: !newPath.trim() || operation.busy || dirty, onClick: () => {
          setEditor({ path: newPath.trim(), size: 0, binary: false, content: "" });
          setContent("");
          setDirty(true);
        }, children: "\u7F16\u8F91\u65B0\u6587\u4EF6" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", disabled: !newPath.trim() || operation.busy, onClick: () => {
          void operation.run(async () => {
            await requestJson(`${conversationPath}/files/mkdir`, jsonBody({ path: newPath.trim() }));
            refresh();
          }, "\u76EE\u5F55\u5DF2\u521B\u5EFA");
        }, children: "\u521B\u5EFA\u76EE\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("label", { className: "tw-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: "\u4E0A\u4F20\u5230\u5F53\u524D\u76EE\u5F55\uFF08\u540C\u540D\u6587\u4EF6\u4F1A\u8986\u76D6\uFF09" }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { "aria-label": "\u4E0A\u4F20\u5DE5\u4F5C\u533A\u6587\u4EF6", type: "file", multiple: true, disabled: operation.busy, onChange: (event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length) return;
            void operation.run(async () => {
              const form = new FormData();
              for (const file of files) form.append("file", file);
              await requestJson(apiUrl(`${conversationPath}/files/upload`, { path }), { method: "POST", body: form });
              refresh();
            }, "\u6587\u4EF6\u5DF2\u4E0A\u4F20");
          } })
        ] })
      ] })
    ] }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55\u2026" }),
    !loading && !loadError && !entries.length && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: "tw-muted", children: "\u6B64\u76EE\u5F55\u6CA1\u6709\u6587\u4EF6\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "mg-list", children: entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("article", { className: "tw-card tw-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-grow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { className: "tw-title", children: entry.name }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "mg-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: entry.dir ? "\u76EE\u5F55" : `${entry.size.toLocaleString()} \u5B57\u8282` }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: new Date(entry.mtime).toLocaleString() })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Tag, { tone: "outline", children: entry.dir ? "\u76EE\u5F55" : "\u6587\u4EF6" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", disabled: operation.busy || !entry.dir && dirty, onClick: () => entry.dir ? navigate(entry.path) : void read(entry.path), children: entry.dir ? "\u8FDB\u5165\u76EE\u5F55" : "\u67E5\u770B / \u7F16\u8F91" }),
        !entry.dir && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("a", { href: apiUrl(`${conversationPath}/files/download`, { path: entry.path }).href, download: entry.name, children: "\u4E0B\u8F7D" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ConfirmDelete, { label: "\u5220\u9664\u6587\u4EF6\u6216\u76EE\u5F55", description: `\u5C06\u6C38\u4E45\u5220\u9664 ${entry.path}${entry.dir ? " \u53CA\u5176\u4E2D\u5168\u90E8\u6587\u4EF6" : ""}\u3002`, disabled: operation.busy || dirty && editor?.path === entry.path, onConfirm: () => operation.run(async () => {
          await requestJson(apiUrl(`${conversationPath}/files/delete`, { path: entry.path }), { method: "DELETE" });
          if (editor?.path === entry.path) {
            setEditor(void 0);
            setDirty(false);
          }
          refresh();
        }, "\u5DF2\u5220\u9664") })
      ] })
    ] }, entry.path)) }),
    editor && /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "tw-card tw-stack", "aria-label": "\u6587\u4EF6\u7F16\u8F91\u5668", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { className: "tw-title", children: editor.path }),
        dirty && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Tag, { tone: "warning", children: "\u672A\u4FDD\u5B58" })
      ] }),
      editor.binary ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Notice, { children: editor.too_large ? "\u6587\u4EF6\u8D85\u8FC7 2 MiB \u9884\u89C8\u4E0A\u9650\uFF0C\u8BF7\u4E0B\u8F7D\u67E5\u770B\u3002" : "\u6B64\u6587\u4EF6\u4E3A\u4E8C\u8FDB\u5236\u6216\u975E UTF-8 \u5185\u5BB9\uFF0C\u8BF7\u4E0B\u8F7D\u67E5\u770B\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Field, { label: "\u6587\u4EF6\u5185\u5BB9", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("textarea", { "aria-label": "\u6587\u4EF6\u5185\u5BB9", rows: 16, value: content, onChange: (event) => {
        setContent(event.target.value);
        setDirty(true);
      } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "tw-actions", children: [
        !editor.binary && /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", variant: "primary", disabled: !dirty || operation.busy, onClick: () => {
          void operation.run(async () => {
            await requestJson(`${conversationPath}/files/write`, jsonBody({ path: editor.path, content }));
            setDirty(false);
            refresh();
          }, "\u6587\u4EF6\u5DF2\u4FDD\u5B58");
        }, children: "\u4FDD\u5B58\u6587\u4EF6" }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("a", { href: apiUrl(`${conversationPath}/files/download`, { path: editor.path }).href, download: true, children: "\u4E0B\u8F7D\u6587\u4EF6" }),
        dirty ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ConfirmDelete, { label: "\u653E\u5F03\u7F16\u8F91", description: "\u672A\u4FDD\u5B58\u7684\u6587\u4EF6\u5185\u5BB9\u5C06\u4E22\u5931\u3002", disabled: operation.busy, onConfirm: async () => {
          setEditor(void 0);
          setDirty(false);
        } }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives19.Button, { size: "sm", onClick: () => setEditor(void 0), children: "\u5173\u95ED\u6587\u4EF6" })
      ] })
    ] })
  ] });
}

// src/conversation-workspace/client-side.tsx
var import_react20 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives20 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime20 = require("react/jsx-runtime");
function SideQuestionsPanel({ parentKind, parentId, visible }) {
  const [explorationId, setExplorationId] = import_react20.default.useState(""), [intentId, setIntentId] = import_react20.default.useState("");
  const [scope, setScope] = import_react20.default.useState({ exploration: "", intent: "" });
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-stack", children: [
    parentKind === "task" && /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("form", { className: "tw-card tw-stack", onSubmit: (event) => {
      event.preventDefault();
      setScope({ exploration: explorationId.trim(), intent: intentId.trim() });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h3", { children: "\u4EFB\u52A1\u65C1\u8DEF\u4E0A\u4E0B\u6587" }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Field, { label: "\u63A2\u7D22 ID\uFF08\u53EF\u9009\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Input, { value: explorationId, onChange: (event) => setExplorationId(event.target.value) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Field, { label: "\u610F\u56FE ID\uFF08\u53EF\u9009\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Input, { value: intentId, onChange: (event) => setIntentId(event.target.value) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Button, { size: "sm", type: "submit", children: "\u4F7F\u7528\u6B64\u4E0A\u4E0B\u6587" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(SideSession, { parentKind, parentId, scope, visible }, `${parentKind}:${parentId}:${scope.exploration}:${scope.intent}`)
  ] });
}
function SideSession({ parentKind, parentId, scope, visible }) {
  const [data, setData] = import_react20.default.useState(), [question, setQuestion] = import_react20.default.useState("");
  const [revision, setRevision] = import_react20.default.useState(0), [loadError, setLoadError] = import_react20.default.useState(""), [streamError, setStreamError] = import_react20.default.useState("");
  const [loading, setLoading] = import_react20.default.useState(false), [activeId, setActiveId] = import_react20.default.useState("");
  const operation = useOperation();
  const query = import_react20.default.useMemo(() => ({ parent_kind: parentKind, parent_id: parentId, exploration_id: scope.exploration || void 0, intent_id: scope.intent || void 0 }), [parentKind, parentId, scope.exploration, scope.intent]);
  import_react20.default.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    void requestJson(apiUrl(`${conversationPath}/side-questions`, query), { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setData(result);
        setActiveId(result.current?.id ?? "");
        setLoadError("");
      }
    }).catch((failure) => {
      if (!controller.signal.aborted) setLoadError(errorMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [query, revision, visible]);
  import_react20.default.useEffect(() => {
    if (!visible || !activeId) return;
    const events2 = new EventSource(apiUrl(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/events`).href, { withCredentials: true });
    setStreamError("");
    const onExchange = (event) => {
      try {
        const exchange = JSON.parse(event.data);
        if (exchange.id !== activeId || typeof exchange.sequence !== "number" || typeof exchange.answer !== "string") throw new Error("\u65C1\u8DEF\u4E8B\u4EF6\u683C\u5F0F\u65E0\u6548");
        setData((current) => {
          const old = current?.items.find((item) => item.id === exchange.id);
          if (old && old.sequence > exchange.sequence) return current;
          const items = [exchange, ...current?.items.filter((item) => item.id !== exchange.id) ?? []].sort((a, b) => b.ordinal - a.ordinal);
          return { ...current, items, current: exchange.status === "running" ? exchange : void 0 };
        });
        if (exchange.status !== "running") {
          events2.close();
          setActiveId("");
        }
      } catch (failure) {
        events2.close();
        setStreamError(errorMessage(failure));
      }
    };
    events2.addEventListener("exchange", onExchange);
    events2.onerror = () => {
      events2.close();
      setStreamError("\u65C1\u8DEF\u4E8B\u4EF6\u8FDE\u63A5\u5DF2\u4E2D\u65AD\u3002\u70B9\u51FB\u5237\u65B0\u6062\u590D\u5F53\u524D\u7ED3\u679C\uFF0C\u5DF2\u63D0\u4EA4\u7684\u95EE\u9898\u4E0D\u4F1A\u91CD\u590D\u53D1\u9001\u3002");
    };
    return () => events2.close();
  }, [activeId, visible]);
  const running = !!activeId;
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "tw-stack", "aria-label": "\u65C1\u8DEF\u63D0\u95EE", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-card-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-grow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h3", { children: "\u65C1\u8DEF\u63D0\u95EE" }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "tw-muted", children: "\u57FA\u4E8E\u4E3B\u4F1A\u8BDD\u6700\u8FD1\u7684\u6A21\u578B\u4E0A\u4E0B\u6587\u56DE\u7B54\uFF0C\u4E0D\u5411\u4E3B Agent \u8FFD\u52A0\u6307\u4EE4\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Button, { size: "sm", disabled: loading || operation.busy, onClick: () => setRevision((value) => value + 1), children: "\u5237\u65B0\u65C1\u8DEF" })
    ] }),
    [loadError, streamError, operation.error].filter(Boolean).map((error, index) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Notice, { tone: "error", children: error }, index)),
    operation.notice && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Notice, { tone: "success", children: operation.notice }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u65C1\u8DEF\u5386\u53F2\u2026" }),
    data?.snapshot ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(Notice, { children: [
      data.snapshot.provider,
      " / ",
      data.snapshot.model,
      " \xB7 \u4E0A\u4E0B\u6587\u65F6\u95F4 ",
      dateTime(data.snapshot.capturedAt),
      !data.snapshot.available && ` \xB7 ${data.snapshot.reason ?? "\u4E0A\u4E0B\u6587\u6682\u4E0D\u53EF\u7528"}`
    ] }) : !loading && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Notice, { children: "\u5C1A\u672A\u6355\u83B7\u6B64\u4E0A\u4E0B\u6587\u3002\u5148\u8FD0\u884C\u5BF9\u5E94\u4E3B\u4F1A\u8BDD\uFF0C\u518D\u5237\u65B0\u65C1\u8DEF\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("form", { className: "tw-stack", onSubmit: (event) => {
      event.preventDefault();
      void operation.run(async () => {
        const exchange = await requestJson(`${conversationPath}/side-questions`, jsonBody({ ...query, question, client_request_id: crypto.randomUUID() }));
        setQuestion("");
        setData((current) => ({ ...current, items: [exchange, ...current?.items.filter((item) => item.id !== exchange.id) ?? []], current: exchange.status === "running" ? exchange : void 0 }));
        setActiveId(exchange.status === "running" ? exchange.id : "");
      });
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Field, { label: "\u65C1\u8DEF\u95EE\u9898", children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("textarea", { "aria-label": "\u65C1\u8DEF\u95EE\u9898", rows: 4, maxLength: 4e3, value: question, disabled: operation.busy, onChange: (event) => setQuestion(event.target.value), placeholder: "\u8BE2\u95EE\u5F53\u524D\u53D1\u73B0\u3001\u8FDB\u5C55\u6216\u51B3\u7B56\u4F9D\u636E" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Button, { size: "sm", type: "submit", variant: "primary", disabled: !question.trim() || running || operation.busy || !data?.snapshot?.available, children: "\u63D0\u4EA4\u65C1\u8DEF\u95EE\u9898" }),
        running && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Button, { size: "sm", type: "button", disabled: operation.busy, onClick: () => {
          void operation.run(async () => {
            const exchange = await requestJson(`${conversationPath}/side-requests/${encodeURIComponent(activeId)}/cancel`, { method: "POST" });
            setData((current) => ({ ...current, items: [exchange, ...current?.items.filter((item) => item.id !== exchange.id) ?? []] }));
            setActiveId("");
          }, "\u65C1\u8DEF\u8BF7\u6C42\u5DF2\u53D6\u6D88");
        }, children: "\u53D6\u6D88\u65C1\u8DEF\u751F\u6210" }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ConfirmDelete, { label: "\u6E05\u7A7A\u65C1\u8DEF\u5386\u53F2", description: "\u5C06\u6E05\u7A7A\u6B64\u7236\u4F1A\u8BDD\u4E0B\u7684\u65C1\u8DEF\u95EE\u9898\u548C\u56DE\u7B54\uFF1B\u6B63\u5728\u8FD0\u884C\u7684\u65C1\u8DEF\u4F1A\u88AB\u53D6\u6D88\u3002", disabled: operation.busy || !data?.items.length, onConfirm: () => operation.run(async () => {
          await requestJson(apiUrl(`${conversationPath}/side-questions`, query), { method: "DELETE" });
          setActiveId("");
          setData(void 0);
          setRevision((value) => value + 1);
        }, "\u65C1\u8DEF\u5386\u53F2\u5DF2\u6E05\u7A7A") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "mg-list", "aria-live": "polite", children: data?.items.map((exchange) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("article", { className: "tw-card tw-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "tw-card-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("strong", { className: "tw-title", children: exchange.question }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Tag, { tone: exchange.status === "failed" ? "danger" : exchange.status === "running" ? "info" : "outline", children: { running: "\u751F\u6210\u4E2D", completed: "\u5DF2\u5B8C\u6210", cancelled: "\u5DF2\u53D6\u6D88", failed: "\u5931\u8D25", interrupted: "\u5DF2\u4E2D\u65AD" }[exchange.status] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "tw-description", children: exchange.answer || (exchange.status === "running" ? "\u7B49\u5F85\u6A21\u578B\u56DE\u7B54\u2026" : "\u6CA1\u6709\u56DE\u7B54\u5185\u5BB9") }),
      exchange.error && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Notice, { tone: "error", children: exchange.error }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "mg-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { children: dateTime(exchange.createdAt) }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", { children: [
          exchange.model.provider,
          " / ",
          exchange.model.model
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", { children: [
          "\u8F93\u5165 ",
          exchange.usage.inputTokens,
          " / \u8F93\u51FA ",
          exchange.usage.outputTokens,
          " tokens"
        ] })
      ] }),
      exchange.context && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(JsonDetails, { summary: "\u4E0A\u4E0B\u6587\u7528\u91CF\u8BE6\u60C5", value: exchange.context })
    ] }, exchange.id)) }),
    data?.nextCursor !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(import_dsh_client_ui_primitives20.Button, { size: "sm", disabled: operation.busy, onClick: () => {
      void operation.run(async () => {
        const older = await requestJson(apiUrl(`${conversationPath}/side-questions`, { ...query, before: data.nextCursor }));
        setData((current) => ({ ...current, items: [...current?.items ?? [], ...older.items.filter((row) => !current?.items.some((item) => item.id === row.id))], nextCursor: older.nextCursor }));
      });
    }, children: "\u52A0\u8F7D\u66F4\u65E9\u65C1\u8DEF\u95EE\u9898" })
  ] });
}

// src/conversation-workspace/client.tsx
var import_jsx_runtime21 = require("react/jsx-runtime");
function ConversationWorkspaceTab({ visible, scope }) {
  const [view, setView] = import_react21.default.useState("conversations");
  const [rows, setRows] = import_react21.default.useState([]), [selected, setSelected] = import_react21.default.useState("");
  const [error, setError] = import_react21.default.useState(""), [notice, setNotice] = import_react21.default.useState(""), [loading, setLoading] = import_react21.default.useState(false);
  const [taskId, setTaskId] = import_react21.default.useState(""), [agentKey, setAgentKey] = import_react21.default.useState("mainagent");
  const [title, setTitle] = import_react21.default.useState(""), [message2, setMessage] = import_react21.default.useState(""), [messages, setMessages] = import_react21.default.useState();
  const operation = useOperation();
  const current = rows.find((row) => row.id === selected);
  const refresh = import_react21.default.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await requestJson(`${conversationPath}/conversations`));
      setError("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);
  import_react21.default.useEffect(() => {
    if (visible) void refresh();
  }, [refresh, visible]);
  import_react21.default.useEffect(() => {
    if (!current || view !== "conversations") return;
    const controller = new AbortController();
    void requestJson(apiUrl(conversationUrl(current.id, "messages"), { cursor: 0, limit: 200 }), { signal: controller.signal }).then(setMessages).catch((failure) => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [current?.id, view]);
  async function create(event) {
    event.preventDefault();
    await operation.run(async () => {
      const row = await requestJson(`${conversationPath}/conversations`, jsonBody({ agent_key: agentKey.trim(), title: title.trim() || void 0, task_id: taskId.trim() || void 0 }));
      setRows((current2) => [row, ...current2]);
      setSelected(row.id);
      setTitle("");
      setNotice("\u4F1A\u8BDD\u5DF2\u521B\u5EFA");
    }, "\u4F1A\u8BDD\u5DF2\u521B\u5EFA");
  }
  async function send(event) {
    event.preventDefault();
    if (!current || !message2.trim()) return;
    await operation.run(async () => {
      await requestJson(conversationUrl(current.id, "send"), jsonBody({ message: message2 }));
      setMessage("");
      const page = await requestJson(apiUrl(conversationUrl(current.id, "messages"), { cursor: 0, limit: 200 }));
      setMessages(page);
    }, "\u6D88\u606F\u5DF2\u53D1\u9001");
  }
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
    ManagementPage,
    {
      title: "\u4F1A\u8BDD\u3001\u6587\u4EF6\u4E0E\u65C1\u8DEF",
      description: scope?.sessionId ? `\u5F53\u524D DSH \u4F1A\u8BDD\uFF1A${scope.sessionId}` : "\u7BA1\u7406\u72EC\u7ACB\u4F1A\u8BDD\u548C\u4EFB\u52A1\u4E3B\u5BF9\u8BDD\u3002",
      loading: loading || operation.busy,
      error: error || operation.error,
      notice: notice || operation.notice,
      actions: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Button, { size: "sm", disabled: loading || operation.busy, onClick: () => void refresh(), children: "\u5237\u65B0" }),
      toolbar: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.SegmentedTabs, { label: "\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u89C6\u56FE", value: view, onChange: (value) => setView(value), items: [{ value: "conversations", label: "\u4F1A\u8BDD", id: "conv-list", panelId: "conv-list-panel" }, { value: "files", label: "\u6587\u4EF6", id: "conv-files", panelId: "conv-files-panel" }, { value: "side", label: "\u65C1\u8DEF\u95EE\u9898", id: "conv-side", panelId: "conv-side-panel" }] }),
      children: view === "files" ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(WorkspaceFilesPanel, { visible, initialPath: current?.taskId ? `tasks/${current.taskId}` : "" }) : view === "side" ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(SideQuestionsPanel, { parentKind: current?.taskId ? "task" : "conversation", parentId: current?.taskId || current?.id || scope?.sessionId || "", visible: visible && Boolean(current || scope?.sessionId) }) : /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(import_jsx_runtime21.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("form", { className: "tw-card tw-stack", onSubmit: create, children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("h3", { children: "\u65B0\u5EFA\u72EC\u7ACB\u4F1A\u8BDD" }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "tw-grid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Field, { label: "Agent \u6807\u8BC6", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Input, { "aria-label": "Agent \u6807\u8BC6", value: agentKey, onChange: (event) => setAgentKey(event.target.value) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Field, { label: "\u4EFB\u52A1 ID\uFF08\u53EF\u9009\uFF09", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Input, { "aria-label": "\u4EFB\u52A1 ID\uFF08\u53EF\u9009\uFF09", value: taskId, onChange: (event) => setTaskId(event.target.value) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(Field, { label: "\u6807\u9898", children: /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Input, { "aria-label": "\u4F1A\u8BDD\u6807\u9898", value: title, onChange: (event) => setTitle(event.target.value) }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Button, { type: "submit", size: "sm", variant: "primary", disabled: operation.busy || !agentKey.trim(), children: "\u521B\u5EFA\u4F1A\u8BDD" })
        ] }),
        !rows.length ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0\u4F1A\u8BDD\u3002\u53EF\u521B\u5EFA\u72EC\u7ACB\u4F1A\u8BDD\uFF0C\u6216\u4ECE\u4EFB\u52A1\u8BE6\u60C5\u521B\u5EFA\u4E3B\u4F1A\u8BDD\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "mg-list", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("article", { className: `tw-card tw-stack${selected === row.id ? " tw-card-selected" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "tw-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Button, { size: "sm", className: "tw-task-button", onClick: () => setSelected(row.id), children: row.title }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Tag, { tone: "outline", children: row.taskId ? "\u4EFB\u52A1" : "\u72EC\u7ACB" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "mg-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { children: row.agentKey }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { children: dateTime(row.updatedAt) }),
            row.profileId && /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("span", { children: [
              "profile ",
              row.profileId
            ] })
          ] }),
          selected === row.id && /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "tw-stack", children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "tw-actions", children: [
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Button, { size: "sm", disabled: operation.busy, onClick: () => void operation.run(async () => {
                await requestJson(conversationUrl(row.id, "stop"), { method: "POST", body: "{}" });
              }, "\u5DF2\u8BF7\u6C42\u505C\u6B62"), children: "\u505C\u6B62\u8FD0\u884C" }),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ConfirmDelete, { label: "\u5220\u9664\u4F1A\u8BDD", description: "\u4F1A\u8BDD\u8BB0\u5F55\u3001\u65C1\u8DEF\u8BB0\u5F55\u548C\u5173\u8054\u8FD0\u884C\u5C06\u88AB\u5220\u9664\u3002", disabled: operation.busy, onConfirm: () => operation.run(async () => {
                await requestJson(conversationUrl(row.id), { method: "DELETE" });
                setRows((current2) => current2.filter((item) => item.id !== row.id));
                setSelected("");
              }, "\u4F1A\u8BDD\u5DF2\u5220\u9664") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "tw-record", children: messages?.events.map((event, index) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "tw-record", children: [
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "mg-meta", children: String(event.type || "event") }),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { className: "tw-description", children: typeof event.text === "string" ? event.text : JSON.stringify(event.content ?? event) })
            ] }, index)) }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("form", { className: "tw-inline", onSubmit: send, children: [
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Input, { "aria-label": "\u53D1\u9001\u6D88\u606F", value: message2, onChange: (event) => setMessage(event.target.value), placeholder: "\u8F93\u5165\u6D88\u606F" }),
              /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(import_dsh_client_ui_primitives21.Button, { size: "sm", type: "submit", variant: "primary", disabled: operation.busy || !message2.trim(), children: "\u53D1\u9001" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("small", { className: "tw-muted", children: [
              "\u771F\u5B9E DSH session\uFF1A",
              row.sessionId
            ] })
          ] })
        ] }, row.id)) })
      ] })
    }
  );
}

// src/observability/client.tsx
var import_react22 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives22 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime22 = require("react/jsx-runtime");
var root2 = "/api/redteam/observability";
function ObservabilityTab({ visible }) {
  const [view, setView] = import_react22.default.useState("records");
  const [enabled, setEnabled] = import_react22.default.useState(false), [records, setRecords] = import_react22.default.useState({ items: [], total: 0 });
  const [data, setData] = import_react22.default.useState(), [error, setError] = import_react22.default.useState(""), [notice, setNotice] = import_react22.default.useState("");
  const [busy, setBusy] = import_react22.default.useState(false), [taskId, setTaskId] = import_react22.default.useState("");
  const refresh = import_react22.default.useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const settings = await requestJson(`${root2}/settings`);
      setEnabled(settings.enabled);
      if (view === "records") setRecords(await requestJson(`${root2}/records?limit=50&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ""}`));
      else if (view === "commands") setData(await requestJson(`${root2}/commands?limit=100&offset=0${taskId ? `&task_id=${encodeURIComponent(taskId)}` : ""}`));
      else if (view === "usage") setData(await requestJson(`${root2}/usage?group=model`));
      else setData(await requestJson(`${root2}/tool-stats`));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [taskId, view]);
  import_react22.default.useEffect(() => {
    if (visible) void refresh();
  }, [refresh, visible]);
  async function toggle(value) {
    setBusy(true);
    setError("");
    try {
      await requestJson(`${root2}/settings`, { method: "PUT", body: JSON.stringify({ enabled: value }) });
      setEnabled(value);
      setNotice(value ? "\u5DF2\u5F00\u542F\u8C03\u7528\u5F55\u5236" : "\u5DF2\u5173\u95ED\u8C03\u7528\u5F55\u5236");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function deleteTaskRecords() {
    if (!taskId.trim() || !window.confirm("\u5220\u9664\u8BE5\u4EFB\u52A1\u7684\u8C03\u7528\u8BB0\u5F55\uFF1F")) return;
    setBusy(true);
    try {
      await requestJson(`${root2}/records?task_id=${encodeURIComponent(taskId)}`, { method: "DELETE" });
      setNotice("\u5DF2\u5220\u9664\u8BE5\u4EFB\u52A1\u7684\u8C03\u8BD5\u8BB0\u5F55");
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const tabs2 = [{ value: "records", label: "LLM \u8BB0\u5F55", id: "obs-records", panelId: "obs-records-panel" }, { value: "commands", label: "\u547D\u4EE4", id: "obs-commands", panelId: "obs-commands-panel" }, { value: "usage", label: "\u7528\u91CF", id: "obs-usage", panelId: "obs-usage-panel" }, { value: "tools", label: "\u5DE5\u5177\u7EDF\u8BA1", id: "obs-tools", panelId: "obs-tools-panel" }];
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(
    ManagementPage,
    {
      title: "\u8C03\u7528\u8BB0\u5F55\u4E0E\u7528\u91CF",
      description: "\u67E5\u770B\u89C4\u8303\u5316\u6A21\u578B\u8C03\u7528\u3001\u547D\u4EE4\u7ED3\u679C\u548C token \u6C47\u603B\uFF1B\u539F\u59CB\u4F20\u8F93\u4EC5\u5728\u5BBF\u4E3B dispatcher \u53EF\u7528\u65F6\u63D0\u4F9B\u3002",
      loading: busy,
      error,
      notice,
      actions: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.Button, { size: "sm", disabled: busy, onClick: () => void refresh(), children: "\u5237\u65B0" }),
      toolbar: /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)(import_jsx_runtime22.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.SegmentedTabs, { label: "\u89C2\u6D4B\u89C6\u56FE", value: view, onChange: (value) => setView(value), items: tabs2 }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.Checkbox, { label: "\u5F00\u542F LLM \u5F55\u5236", checked: enabled, disabled: busy, onChange: (value) => void toggle(value) }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "tw-inline", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "tw-muted", children: "\u4EFB\u52A1\u7B5B\u9009" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.Input, { "aria-label": "\u4EFB\u52A1\u7B5B\u9009", value: taskId, onChange: (event) => setTaskId(event.target.value), placeholder: "task id", disabled: busy })
        ] }),
        view === "records" && /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.Button, { size: "sm", disabled: busy || !taskId.trim(), onClick: () => void deleteTaskRecords(), children: "\u5220\u9664\u4EFB\u52A1\u8BB0\u5F55" })
      ] }),
      children: view === "records" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "mg-list", children: records.items.length ? records.items.map((row) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("article", { className: "tw-card tw-stack", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "tw-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("strong", { children: row.model || "\u672A\u77E5\u6A21\u578B" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives22.Tag, { tone: row.status === "ok" ? "success" : "danger", children: row.status })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "mg-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: row.taskId || "\u65E0\u4EFB\u52A1" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: row.provider || "" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: new Date(row.startedAt).toLocaleString("zh-CN") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("span", { children: [
            row.durationMs ?? 0,
            " ms"
          ] })
        ] }),
        row.usage && /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(JsonDetails, { value: row.usage, summary: "Token \u7528\u91CF" })
      ] }, row.id)) : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "tw-muted", children: "\u6682\u65E0 LLM \u8BB0\u5F55\u3002" }) }) : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(JsonDetails, { value: data ?? [], open: true, summary: view === "commands" ? "\u547D\u4EE4\u8BB0\u5F55" : view === "usage" ? "\u6A21\u578B/Token \u6C47\u603B" : "\u5DE5\u5177\u7EDF\u8BA1" })
    }
  );
}

// src/client-entry.ts
var inject = ["betterSidebar"];
function apply(ctx) {
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:tasks", title: "\u4EFB\u52A1\u5DE5\u4F5C\u53F0", description: "\u7BA1\u7406\u4EFB\u52A1\u3001\u6A21\u677F\u3001\u5206\u7C7B\u3001\u76EE\u6807\u4E0E\u6A21\u578B\u914D\u7F6E\u3002", order: 29, single: true, component: TaskWorkspaceTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: "dsh-redteam:assets",
    title: "\u8D44\u4EA7\u56FE",
    description: "\u67E5\u770B\u4EFB\u52A1\u8D44\u4EA7\u3001\u63A2\u7D22\u56FE\u3001\u610F\u56FE\u548C\u53D1\u73B0\u3002",
    order: 30,
    single: true,
    component: AssetGraphTab
  }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:findings", title: "\u53D1\u73B0", description: "\u67E5\u770B\u6F0F\u6D1E\u53D1\u73B0\u548C\u8BC1\u636E\u5173\u8054\u3002", order: 31, single: true, component: SnapshotTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:traffic", title: "\u6D41\u91CF", description: "\u67E5\u770B\u6355\u83B7\u7684\u8BF7\u6C42\u54CD\u5E94\u7D22\u5F15\u3002", order: 32, single: true, component: SnapshotTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:activity", title: "\u6D3B\u52A8", description: "\u67E5\u770B Planner\u3001Worker \u548C\u5BA1\u6279\u6D3B\u52A8\u3002", order: 33, single: true, component: SnapshotTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:report", title: "\u62A5\u544A", description: "\u67E5\u770B\u4EFB\u52A1 Markdown \u62A5\u544A\u3002", order: 34, single: true, component: SnapshotTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:approvals", title: "\u5BA1\u6279", description: "\u5904\u7406\u5F85\u5BA1\u6279\u8C03\u7528\u3001\u67E5\u770B\u5BA1\u8BA1\u5E76\u7BA1\u7406\u5DE5\u5177\u89C4\u5219\u3002", order: 35, single: true, component: InterceptionTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:asset-management", title: "\u8D44\u4EA7\u7BA1\u7406", description: "\u7BA1\u7406\u5168\u5C40\u8D44\u4EA7\u3001\u516C\u53F8\u8303\u56F4\u3001\u4EFB\u52A1\u5173\u8054\u548C ScopeSentry \u540C\u6B65\u3002", order: 36, single: true, component: AssetManagementTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:system", title: "\u7CFB\u7EDF\u8BBE\u7F6E", description: "\u7BA1\u7406\u641C\u7D22\u3001\u6A21\u578B\u6C60\u3001\u5065\u5EB7\u72B6\u6001\u548C\u91CD\u8BD5\u7B56\u7565\u3002", order: 37, single: true, component: SystemRuntimeTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:observability", title: "\u8C03\u7528\u8BB0\u5F55", description: "\u67E5\u770B LLM \u5F55\u5236\u3001\u547D\u4EE4\u8BB0\u5F55\u548C token \u7528\u91CF\u3002", order: 38, single: true, component: ObservabilityTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:conversations", title: "\u4F1A\u8BDD\u4E0E\u6587\u4EF6", description: "\u7BA1\u7406\u72EC\u7ACB\u4F1A\u8BDD\u3001\u4EFB\u52A1\u4E3B\u5BF9\u8BDD\u3001\u65C1\u8DEF\u95EE\u9898\u548C\u5DE5\u4F5C\u533A\u6587\u4EF6\u3002", order: 39, single: true, component: ConversationWorkspaceTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:platform", title: "\u5E73\u53F0\u8D44\u6E90", description: "\u7BA1\u7406 Agent\u3001\u5DE5\u5177\u3001MCP\u3001Skill \u4E0E\u89E6\u53D1\u5668\u3002", order: 40, single: true, component: PlatformManagementTab }));
  ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-redteam:host", title: "\u5BBF\u4E3B\u4E0E\u66F4\u65B0", description: "\u67E5\u770B\u5065\u5EB7\u3001\u7EDF\u8BA1\u3001\u65E5\u5FD7\u5E76\u6838\u5BF9\u63D2\u4EF6\u66F4\u65B0\u80FD\u529B\u3002", order: 41, single: true, component: HostManagementPage }));
  ctx.effect(() => installFindingDeepLink(ctx.betterSidebar));
}

return module.exports;}});
