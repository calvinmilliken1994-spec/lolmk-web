// Verify actual list JSX and handlers without a browser or production mutations.
// React hooks, navigation and Server Action transport are stubbed.
// Run: node scripts/test-rb-admin-list.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
let showArchived = false;
let pending = false;
let confirmed = false;
let refreshes = 0;
let hook = 0;
let transition;
const calls = [];
const actions = {
  async deleteEvent(id) { calls.push(["delete", id]); return { ok: true }; },
  async archiveEvent(id) { calls.push(["archive", id]); return { ok: true }; },
};
const exports = {};
const { outputText } = ts.transpileModule(readFileSync("src/components/riftbound/rb-admin-list.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
runInNewContext(outputText, {
  exports, confirm: () => confirmed,
  require(name) {
    if (name === "react") return {
      useState: () => [[null, false, showArchived][hook++], () => {}],
      useTransition: () => [pending, (fn) => { transition = fn(); }],
    };
    if (name === "next/link") return { default: "a" };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => refreshes++, push() {} }) };
    if (name.endsWith("riftbound/actions")) return actions;
    if (name === "@/components/ui/badge") return { Badge: "span" };
    if (name === "@/components/ui/button") return { Button: "button" };
    if (name === "@/components/sr/sr-shared") return { ErrorBanner: "div", Field: "label" };
    if (name === "./rb-setup-model") return { rbFormatDate: (date) => date };
    return nativeRequire(name);
  },
});
const event = (id, status) => ({ id, slug: id, name: id, status, config: { bestOf: 3, roundMinutes: 50 } });
function nodes(root) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
function render(tournaments) {
  hook = 0;
  return nodes(exports.RbAdminList({ tournaments }));
}
function button(elements, label) {
  return elements.filter((node) => node.type === "button"
    && [].concat(node.props.children).includes(label));
}

let elements = render([event("completed", "completed"), event("archived", "archived")]);
assert.equal(button(elements, "Delete").length, 1);
assert.equal(button(elements, "Archive").length, 1);
const remove = button(elements, "Delete")[0];
remove.props.onClick();
assert.equal(calls.length, 0, "Cancel must never invoke Delete");
confirmed = true;
remove.props.onClick();
await transition;
assert.deepEqual(calls, [["delete", "completed"]]);
assert.equal(refreshes, 1);
button(elements, "Archive")[0].props.onClick();
await transition;
assert.deepEqual(calls[1], ["archive", "completed"]);
assert.equal(refreshes, 2);
console.log("PASS: Delete/Archive require confirmation, target their row and refresh on success.");

showArchived = true;
elements = render([event("completed", "completed"), event("archived", "archived")]);
assert.equal(button(elements, "Delete").length, 2);
assert.equal(button(elements, "Archive").length, 1);
confirmed = false;
button(elements, "Archive")[0].props.onClick();
assert.equal(calls.length, 2);
console.log("PASS: archived rows are hidden by default and have Delete when shown.");

pending = true;
elements = render([event("draft", "draft")]);
assert.equal(button(elements, "Delete")[0].props.disabled, true);
assert.equal(button(elements, "Archive")[0].props.disabled, true);
pending = false;
for (const status of ["draft", "registration", "in_progress", "completed"]) {
  elements = render([event(status, status)]);
  assert.equal(button(elements, "Delete").length, 1);
  assert.equal(button(elements, "Archive").length, ["draft", "completed"].includes(status) ? 1 : 0);
}
console.log("PASS: pending controls disable; Archive retains its never-started/completed eligibility rule.");
