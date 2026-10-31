/* saved.js: scenarios saved in this browser (localStorage), shared by both sites (byte-identical in site/ and site-main/, in
 * shared.sha256). One key, one JSON document {format, v, scenarios: [{name, model, inputs}]}: inputs only, never results, app
 * data or IDs; the name is the only free text. At most 50 scenarios, 60-character names, 100 KB, checked before every write; a
 * full store is reported, never evicted. Stored data and imported files are untrusted and go through the same reader and
 * ScenarioLink.validate. No cookies or network; names are shown with textContent only. Export and import are JSON only. */
(function (root) {
  "use strict";

  var STRINGS = {   // every visible string, in one place
    title: "Saved scenarios",
    note: "Saved in this browser, not encrypted. Anyone using this browser can see them. For your real figures, use the Stepwell Financial app, which encrypts them only when you turn its lock on.",
    origin: "Saved scenarios stay on this website. They don't carry over to our other website or to the app.",
    unavailable: "Saving isn't available in this browser window. Links still work.",
    nameLabel: "Name this scenario",
    save: "Save", open: "Open", rename: "Rename", del: "Delete", cancel: "Cancel", exportBtn: "Export", importBtn: "Import", clearAll: "Clear all (every calculator)", clearThem: "Clear them",
    empty: "Nothing saved for this calculator yet.",
    noName: "Give it a name first.",
    taken: "You already saved one with that name.",
    full: "You can save up to 50 scenarios in all, across every calculator on this site. Delete one first.",
    tooBig: "Saved scenarios can take up to 100 KB in all, across every calculator on this site. Delete one first.",
    quota: "Your browser has no room left to save. Nothing was changed.",
    failed: "Couldn't save in this browser. Nothing was changed.",
    changed: "That one has changed. The list is up to date now.",
    corrupt: "The saved scenarios in this browser couldn't be read. Clear them to start again.",
    skippedStored: "{n} saved scenarios couldn't be read. They will be dropped the next time you change your saved scenarios.",
    skippedStored1: "1 saved scenario couldn't be read. It will be dropped the next time you change your saved scenarios.",
    changeFailed: "Couldn't change your saved scenarios. Nothing was changed.",
    clearFailed: "Couldn't clear the saved scenarios. They may still be in this browser.",
    saved: "Saved \"{name}\".", opened: "Opened \"{name}\".", deleted: "Deleted \"{name}\".", renamed: "Renamed to \"{name}\".",
    cleared: "Cleared. {n} saved scenarios were removed from this browser, for every calculator on this site.",
    cleared1: "Cleared. 1 saved scenario was removed from this browser, for every calculator on this site.",
    cleared0: "Cleared. No saved scenarios are left in this browser, for any calculator on this site.",
    nothingToExport: "There is nothing to export yet.",
    exported: "Exported {n} scenarios.", exported1: "Exported 1 scenario.",
    fileUnreadable: "That file couldn't be read.",
    fileBig: "That file is over 100 KB, so it wasn't read.",
    fileBad: "That isn't a Stepwell scenarios file.",
    fileMany: "That file has more than 50 scenarios, so it wasn't read.",
    fileHas: "This file has {n} scenarios.", fileHas1: "This file has 1 scenario.", skipped: "{n} skipped.", nothingIn: "Nothing in it can be imported.",
    fromFile: "These came from a file. The numbers may not be yours, so check them when you open them.",
    replaceNote: "Add keeps what you have saved. Replace removes everything you have saved on this site, for every calculator, and puts these in its place.",
    add: "Add", replace: "Replace",
    addNoRoom: "There isn't room: you have {n} saved and the limit is 50. Replace them instead, or delete some first.",
    dupInFile1: "1 had the same name as another in the file, so it was left out.",
    dupInFile: "{n} had the same name as another in the file, so they were left out.",
    added: "Added {n}.", already: "{n} already saved.", replaced: "Replaced your {n} saved scenarios with {m} from the file.",
    replaced1: "Replaced your 1 saved scenario with {m} from the file.", replaced0: "Saved {m} from the file."
  };
  var KEY = "stepwell.scenarios.v1", PROBE = "stepwell.scenarios.probe", FORMAT = "stepwell-scenarios";
  var MAX_COUNT = 50, MAX_NAME = 60, MAX_BYTES = 102400;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isString(v) { return typeof v === "string"; }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function fmt(s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return has(v, k) ? String(v[k]) : m; }); }
  function bytes(s) { try { return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length; } catch (e) { return Infinity; } }

  // Character classes from code point ranges (no escapes in the source).
  function rx(rs) { return new RegExp("[" + rs.map(function (r) { return String.fromCharCode(r[0]) + "-" + String.fromCharCode(r[1]); }).join("") + "]", "g"); }
  var BREAKS = rx([[9, 10], [13, 13], [8232, 8233]]);
  // control, bidi, zero-width and other invisible characters (including variation selectors), and the tag and variation-selector planes
  var STRIP = rx([[0, 31], [127, 159], [173, 173], [847, 847], [1564, 1564], [4447, 4448], [6068, 6069], [6155, 6158], [8203, 8207], [8234, 8238], [8288, 8303], [12644, 12644], [65024, 65039], [65279, 65279], [65440, 65440], [65529, 65531]]);
  var ASTRAL = new RegExp("[" + String.fromCodePoint(0xE0000) + "-" + String.fromCodePoint(0xE0FFF) + "]", "gu");

  // A name as shown and stored: those characters stripped, spaces collapsed, at most 60 characters.
  function cleanName(s) {
    if (!isString(s)) return "";
    var t = s.replace(BREAKS, " ").replace(STRIP, "").replace(ASTRAL, "").replace(/\s+/g, " ").trim();
    return (Array.from ? Array.from(t).slice(0, MAX_NAME).join("") : t.slice(0, MAX_NAME)).trim();
  }

  /* A scenario for a model this page cannot validate (its maths is not loaded here) is carried through every write, after a strict
   * check: only name, model and inputs; a name of 60 characters or fewer; inputs only with that model's own keys, each a value from
   * its fixed choice list or a plain number from 0 to 100 million (a plain-decimal string, or a finite number: kept as a number).
   * No free text can pass. It is checked in full on its own page. Anything failing even this is counted as unreadable. */
  function carry(it) {
    var shape = root.ScenarioLink.shape(it.model), inputs = it.inputs, name, copy = {}, ok = isObj(inputs) && isString(it.name) && Array.from(it.name).length <= MAX_NAME;
    if (!ok || Object.keys(it).length !== 3 || !has(it, "name") || !has(it, "inputs") || !(name = cleanName(it.name))) return null;
    Object.keys(inputs).forEach(function (k) {
      var v = inputs[k], list = shape.choices[k], n = typeof v === "number" ? v : isString(v) && shape.plain.test(v) ? Number(v) : NaN;
      if (shape.keys.indexOf(k) === -1) ok = false;
      else if (list) { if (list.indexOf(v) !== -1) copy[k] = v; else ok = false; }
      else if (isFinite(n) && n >= 0 && n <= 100000000) copy[k] = n; else ok = false;
    });
    return ok ? { name: name, model: it.model, inputs: copy } : null;
  }

  // Text -> {ok, scenarios, total, skipped} or {ok: false, reason: parse|format|many}; for the stored document and an imported file alike.
  // New objects are built from allowlisted keys only (never merged or spread).
  function readDoc(text, models) {   // models: the calculators on this site, for an import (an entry for any other is skipped)
    var doc, S = root.ScenarioLink, out = [];
    try { doc = JSON.parse(text); } catch (e) { return { ok: false, reason: "parse" }; }
    if (!isObj(doc) || doc.format !== FORMAT || doc.v !== 1 || !Array.isArray(doc.scenarios)) return { ok: false, reason: "format" };
    if (doc.scenarios.length > MAX_COUNT) return { ok: false, reason: "many" };
    doc.scenarios.forEach(function (it) {
      var name, v, c;
      if (!isObj(it) || !isString(it.model) || S.MODELS.indexOf(it.model) === -1 || (models && models.indexOf(it.model) === -1)) return;
      name = cleanName(it.name);
      v = name && has(it, "inputs") ? S.validate(it.model, it.inputs) : null;
      if (v && v.ok) out.push({ name: name, model: it.model, inputs: v.inputs });
      else if (v && v.reason === "unavailable" && (c = carry(it))) out.push(c);
    });
    return { ok: true, scenarios: out, total: doc.scenarios.length, skipped: doc.scenarios.length - out.length };
  }
  function docText(list) {
    return JSON.stringify({ format: FORMAT, v: 1, scenarios: list.map(function (s) { return { name: s.name, model: s.model, inputs: s.inputs }; }) });
  }

  function quota(e) { return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014); }

  // The store over a localStorage-like object. Every call is inside try/catch and never throws.
  function store(st) {
    return {
      // A write, read and delete test on a probe key before "Save" is shown; the real document is not touched, and the probe is always
      // removed. -> "ok", "full" (the write hit the quota but saved scenarios still read: list, Open and Delete work, Save is refused), or "".
      works: function () {
        var res = "";
        try { st.setItem(PROBE, "1"); res = st.getItem(PROBE) === "1" ? "ok" : ""; } catch (e) { res = quota(e) ? "full" : ""; } finally {
          try { st.removeItem(PROBE); if (res === "ok" && st.getItem(PROBE) !== null) res = ""; if (res === "full") st.getItem(KEY); } catch (e2) { res = ""; }
        }
        return res;
      },
      read: function () {   // -> {ok, scenarios, skipped} or {ok: false}
        var text, r;
        try { text = st.getItem(KEY); } catch (e) { return { ok: false }; }
        if (text === null) return { ok: true, scenarios: [], skipped: 0 };
        if (!isString(text) || bytes(text) > MAX_BYTES) return { ok: false };
        r = readDoc(text);
        return r.ok ? { ok: true, scenarios: r.scenarios, skipped: r.skipped } : { ok: false };
      },
      write: function (list) {   // -> {ok} or {ok: false, reason: count|size|quota|failed}; the caps are checked first
        if (list.length > MAX_COUNT) return { ok: false, reason: "count" };
        var text = docText(list);
        if (bytes(text) > MAX_BYTES) return { ok: false, reason: "size" };
        try { st.setItem(KEY, text); } catch (e) {
          return { ok: false, reason: quota(e) ? "quota" : "failed" };
        }
        return { ok: true };
      },
      clear: function () { try { st.removeItem(KEY); return st.getItem(KEY) === null; } catch (e) { return false; } }
    };
  }

  // The calculators on this site: a page's script tag may name them (data-models="compound"); none named means every calculator.
  var SITE = (function () { var s = root.document && root.document.currentScript, m = s && s.getAttribute("data-models"); return m ? m.split(" ") : null; })();
  var counter = 0;
  // attach: cfg {model, form, scenario (ScenarioLink's handle: current, open), storage? (tests)}.
  function attach(cfg) {
    var S = root.ScenarioLink, form = cfg && cfg.form, ls = null, doc, st, siteModels = SITE;
    if (!S || !form || !cfg.scenario || S.MODELS.indexOf(cfg.model) === -1) return null;
    if (cfg.siteModels !== undefined) siteModels = cfg.siteModels;   // tests
    doc = form.ownerDocument;
    try { ls = cfg.storage !== undefined ? cfg.storage : root.localStorage; } catch (e) { ls = null; }
    st = ls ? store(ls) : null;

    function el(tag, text, cls) { var e = doc.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
    function btn(text, fn) { var b = el("button", text, "btn ghost"); b.type = "button"; b.addEventListener("click", fn); return b; }
    var det = el("details", "", "saved"), box = el("div"), say = el("p", "", "muted"), list = el("ul"), pending = null;
    det.appendChild(el("summary", STRINGS.title)); det.appendChild(box);
    form.appendChild(det);
    if (!st || !st.works()) { box.appendChild(el("p", STRINGS.unavailable, "muted")); return { available: false }; }
    box.appendChild(el("p", STRINGS.note + " " + STRINGS.origin, "muted"));
    say.setAttribute("aria-live", "polite");

    var row = el("div", "", "field"), nameLabel = el("label", STRINGS.nameLabel), nameIn = el("input"), fileIn = el("input"), imp = el("div", "", "muted"), impText = el("p"), impFrom = el("p", STRINGS.fromFile), impNote = el("p", STRINGS.replaceNote);
    var saveBtn = btn(STRINGS.save, save), clearThem = btn(STRINGS.clearThem, clearAll), actions = el("div", "", "actions");
    saveBtn.className = "btn"; clearThem.hidden = true;
    nameIn.type = "text"; nameIn.maxLength = MAX_NAME; nameIn.setAttribute("autocomplete", "off");
    nameIn.id = "saved-name-" + (++counter); nameLabel.setAttribute("for", nameIn.id);
    nameIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } });
    row.appendChild(nameLabel); row.appendChild(nameIn);
    fileIn.type = "file"; fileIn.accept = ".json,application/json"; fileIn.hidden = true;
    fileIn.addEventListener("change", pickFile);
    actions.appendChild(btn(STRINGS.exportBtn, exportAll)); actions.appendChild(btn(STRINGS.importBtn, function () { fileIn.click(); })); actions.appendChild(btn(STRINGS.clearAll, clearAll));
    imp.hidden = true; imp.appendChild(impText); imp.appendChild(impFrom); imp.appendChild(impNote);
    [[STRINGS.add, function () { importNow(false); }], [STRINGS.replace, function () { importNow(true); }], [STRINGS.cancel, function () { pending = null; imp.hidden = true; }]].forEach(function (b) { imp.appendChild(btn(b[0], b[1])); });
    [row, saveBtn, say, clearThem, list, actions, fileIn, imp].forEach(function (n) { box.appendChild(n); });

    function msg(text) { say.textContent = text; }
    function same(a, b) { return a.model === b.model && a.name === b.name && JSON.stringify(a.inputs) === JSON.stringify(b.inputs); }
    function taken(all, model, name, except) { return all.some(function (s) { return s.model === model && s.name === name && s !== except; }); }
    function find(all, e) { for (var i = 0; i < all.length; i++) if (same(all[i], e)) return i; return -1; }
    function fresh() { var r = st.read(); if (!r.ok) { msg(STRINGS.corrupt); render(); } return r.ok ? r : null; }
    function commit(next, ok, failText) {   // the caps are checked inside write; a refusal changes nothing; failText: what a Delete or Rename says
      var w = st.write(next);
      msg(w.ok ? ok : failText || STRINGS[{ count: "full", size: "tooBig", quota: "quota" }[w.reason] || "failed"]);
      render();
      return w.ok;
    }

    // Where keyboard focus sits in the list (its row and which button), so it can go back after the list is rebuilt: a deleted or
    // renamed row's button is gone, and focus would drop to the top of the page. A row being renamed counts as its Rename button.
    function rowFocus() {
      var a = doc.activeElement, li = a && a.closest ? a.closest("li") : null;
      if (!li || !list.contains(li)) return null;
      return { row: [].indexOf.call(list.children, li), btn: li.querySelector("input") ? 1 : [].indexOf.call(li.querySelectorAll("button"), a) };
    }
    function refocus(h) {   // the same row (or the last one left) and the same button; the name box when no row has a button
      var li = list.children[Math.min(h.row, list.children.length - 1)], bs = li ? li.querySelectorAll("button") : [];
      (bs.length ? bs[Math.min(Math.max(h.btn, 0), bs.length - 1)] : nameIn).focus();
    }
    function render() {
      var r = st.read(), keep = say.textContent, mine, held = rowFocus();
      list.textContent = "";
      saveBtn.disabled = !r.ok; clearThem.hidden = r.ok;
      if (!r.ok) { say.textContent = STRINGS.corrupt; if (held) nameIn.focus(); return; }
      mine = r.scenarios.filter(function (s) { return s.model === cfg.model; });
      if (r.skipped) list.appendChild(el("li", r.skipped === 1 ? STRINGS.skippedStored1 : fmt(STRINGS.skippedStored, { n: r.skipped }), "muted"));
      if (!mine.length) list.appendChild(el("li", STRINGS.empty, "muted"));
      mine.forEach(function (e) {
        var li = el("li"), nm = el("span", e.name), id = "saved-n-" + (++counter);
        nm.id = id;
        function tool(text, fn) { var b = btn(text, fn); b.setAttribute("aria-describedby", id); li.appendChild(b); }
        li.appendChild(nm);
        tool(STRINGS.open, function () { cfg.scenario.open(e.inputs); msg(fmt(STRINGS.opened, { name: e.name })); });
        tool(STRINGS.rename, function () { editName(li, e); });
        tool(STRINGS.del, function () {
          var f = fresh(), i = f ? find(f.scenarios, e) : -1;
          if (!f) return;
          if (i < 0) { msg(STRINGS.changed); render(); return; }
          f.scenarios.splice(i, 1);
          commit(f.scenarios, fmt(STRINGS.deleted, { name: e.name }), STRINGS.changeFailed);
        });
        list.appendChild(li);
      });
      say.textContent = keep;
      if (held) refocus(held);
    }
    function editName(li, e) {   // rename in place
      var inp = el("input");
      inp.type = "text"; inp.maxLength = MAX_NAME; inp.value = e.name; inp.setAttribute("aria-label", STRINGS.rename);
      li.textContent = "";
      li.appendChild(inp);
      li.appendChild(btn(STRINGS.save, function () {
        var f = fresh(), i = f ? find(f.scenarios, e) : -1, n = cleanName(inp.value);
        if (!f) return;
        if (!n) { msg(STRINGS.noName); return; }
        if (i < 0) { msg(STRINGS.changed); render(); return; }
        if (taken(f.scenarios, e.model, n, f.scenarios[i])) { msg(STRINGS.taken); return; }
        f.scenarios[i].name = n;
        commit(f.scenarios, fmt(STRINGS.renamed, { name: n }), STRINGS.changeFailed);
      }));
      li.appendChild(btn(STRINGS.cancel, render));
      inp.focus();
    }
    function save() {
      var n = cleanName(nameIn.value), cur = cfg.scenario.current(), f;
      if (!n) { msg(STRINGS.noName); nameIn.focus(); return; }
      if (!cur.ok) { msg(S.STRINGS.fixFirst); return; }
      f = fresh();
      if (!f) return;
      if (taken(f.scenarios, cfg.model, n)) { msg(STRINGS.taken); return; }
      if (commit(f.scenarios.concat([{ name: n, model: cfg.model, inputs: cur.inputs }]), fmt(STRINGS.saved, { name: n }))) nameIn.value = "";
    }
    function clearAll() {
      var r = st.read(), n = r.ok ? r.scenarios.length : 0;
      if (!st.clear()) { msg(STRINGS.clearFailed); return; }
      msg(n === 0 ? STRINGS.cleared0 : n === 1 ? STRINGS.cleared1 : fmt(STRINGS.cleared, { n: n }));
      render();
    }
    function exportAll() {
      var f = fresh(), url, a;
      if (!f) return;
      if (!f.scenarios.length) { msg(STRINGS.nothingToExport); return; }
      url = root.URL.createObjectURL(new root.Blob([docText(f.scenarios)], { type: "application/json" }));
      a = el("a"); a.href = url; a.download = "stepwell-scenarios.json";
      box.appendChild(a); a.click(); box.removeChild(a);
      root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
      msg(f.scenarios.length === 1 ? STRINGS.exported1 : fmt(STRINGS.exported, { n: f.scenarios.length }));
    }
    function pickFile() {   // the size is checked before the file is read
      var file = fileIn.files && fileIn.files[0], rd;
      if (!file) return;
      imp.hidden = true; pending = null;
      if (file.size > MAX_BYTES) { fileIn.value = ""; msg(STRINGS.fileBig); return; }
      rd = new root.FileReader();
      rd.onload = function () {
        var r = isString(rd.result) ? readDoc(rd.result, siteModels) : { ok: false, reason: "parse" };
        fileIn.value = "";
        if (!r.ok) { msg(r.reason === "many" ? STRINGS.fileMany : STRINGS.fileBad); return; }
        pending = r.scenarios;
        msg("");
        impText.textContent = (r.total === 1 ? STRINGS.fileHas1 : fmt(STRINGS.fileHas, { n: r.total })) + (r.skipped ? " " + fmt(STRINGS.skipped, { n: r.skipped }) : "") + (pending.length ? "" : " " + STRINGS.nothingIn);
        impFrom.hidden = impNote.hidden = !pending.length;   // the warnings go with the Add and Replace buttons
        imp.hidden = false;
        [].forEach.call(imp.querySelectorAll("button"), function (b) { if (b.textContent !== STRINGS.cancel) b.hidden = !pending.length; });
      };
      rd.onerror = function () { fileIn.value = ""; msg(STRINGS.fileUnreadable); };
      rd.readAsText(file);
    }
    function importNow(replace) {
      var f = st.read(), have = f.ok ? f.scenarios : [], add = [], dup, keep = [];
      if (!pending) return;
      if (replace) {   // a name used twice in the file for one calculator is kept once, as Add does
        pending.forEach(function (s) { if (!taken(keep, s.model, s.name)) keep.push(s); });
        dup = pending.length - keep.length;
        if (commit(keep, (have.length === 0 ? fmt(STRINGS.replaced0, { m: keep.length }) : have.length === 1 ? fmt(STRINGS.replaced1, { m: keep.length }) : fmt(STRINGS.replaced, { n: have.length, m: keep.length })) + (dup ? " " + (dup === 1 ? STRINGS.dupInFile1 : fmt(STRINGS.dupInFile, { n: dup })) : ""))) { pending = null; imp.hidden = true; }
        return;
      }
      if (!f.ok) { msg(STRINGS.corrupt); render(); return; }
      pending.forEach(function (s) { if (!taken(have.concat(add), s.model, s.name)) add.push(s); });
      dup = pending.length - add.length;
      if (have.length + add.length > MAX_COUNT) { msg(fmt(STRINGS.addNoRoom, { n: have.length })); return; }
      if (commit(have.concat(add), fmt(STRINGS.added, { n: add.length }) + (dup ? " " + fmt(STRINGS.already, { n: dup }) : ""))) { pending = null; imp.hidden = true; }
    }
    render();
    return { available: true, refresh: render };
  }

  var api = { STRINGS: STRINGS, KEY: KEY, MAX_COUNT: MAX_COUNT, MAX_NAME: MAX_NAME, MAX_BYTES: MAX_BYTES, cleanName: cleanName, readDoc: readDoc,
    docText: docText, bytes: bytes, store: store, attach: attach };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SavedScenarios = api;
})(typeof self !== "undefined" ? self : this);
