/* scenario.js: the scenario link, shared by both sites (byte-identical in site/ and site-main/, in shared.sha256).
 * A link carries a calculator's INPUTS after "#" (never sent to a server), never results: #v=1&key=value&...
 * 512-character cap first; only a model's own keys; unknown keys ignored, a repeated key rejects; each value
 * through the SAME parser and LIMITS as typing; choices exact; no "v" but known keys = legacy (read as v=1);
 * unknown "v" or any bad value = defaults plus STRINGS.badLink, never part-restored; no "v" and no model keys
 * (#how-it-works) = a page anchor, left alone. No cookies, storage or network; nothing from a link reaches
 * innerHTML, an attribute name, a selector, a URL or eval. validate() also serves saved scenarios and imports. */
(function (root) {
  "use strict";

  var STRINGS = {   // every visible string, in one place
    copyButton: "Copy link to these numbers",
    shareLabel: "Link to these numbers",
    copied: "Link copied.",
    blocked: "Your browser blocked copying. Select the link below and copy it.",
    fixFirst: "Fix the highlighted field first.",
    tooLong: "This link would be too long. Use fewer decimal places.",
    badLink: "This link's numbers couldn't be read.",
    note: "Anyone with this link can see the numbers in it. They may also be kept in your browser history.",
    fromLink: "These numbers came from a link. They may not be yours, so check them."
  };
  // The fixed choice lists, here so saved scenarios can be checked without the maths files (scenario-test.html checks them against those files).
  var VERSION = "1", MAX_LENGTH = 512, TIMING = ["end", "start"], FREQ = ["annually", "quarterly", "monthly", "daily"], MODES = ["growth", "time", "monthly"];
  // A link's number: a plain decimal as build() writes it, however many decimals typing allowed (the 512 cap bounds the whole link).
  var PLAIN_NUMBER = /^-?\d{1,25}(\.\d{1,340})?$/;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isString(v) { return typeof v === "string"; }

  // A finite number as a plain decimal that reads back as the same number (no exponent, no rounding).
  function decimalText(n) {
    if (typeof n !== "number" || !isFinite(n)) return "";
    var s = String(n), m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
    if (s.indexOf("e") === -1) return s;
    if (!m) return "";
    var d = m[2] + (m[3] || ""), p = 1 + Number(m[4]), z = function (k) { return new Array(Math.max(k, 0) + 1).join("0"); };
    return p <= 0 ? m[1] + "0." + z(-p) + d : p >= d.length ? m[1] + d + z(p - d.length) : m[1] + d.slice(0, p) + "." + d.slice(p);
  }
  function moneyText(v) { var p = decimalText(v).split("."); return p[0].replace(/\B(?=(\d{3})+$)/g, ",") + (p[1] ? "." + p[1] : ""); }   // 25000.5 -> "25,000.5"

  function L() { return { C: root.CompoundCalc, R: root.Rates, G: root.SavingsGoals }; }   // looked up when used: the calculator site has calc.js only

  // Field readers: text in, {value, error} out. A number reader is flagged, so a link's text is held to PLAIN_NUMBER.
  function num(fn, money) { fn.numeric = true; return { read: fn, money: money }; }
  function amount(commas, money) {
    return num(function (t) { var v = L().C.parseAmount(t, commas); return { value: v, error: isFinite(v) ? "" : "x" }; }, money);
  }
  function limited(limits, money) {   // rates.js's checkField, as typing uses it
    return num(function (t, ctx) { var r = L().R.checkField(t, limits(ctx)); return { value: r.value, error: r.error }; }, money);
  }
  function choice(list) { return { list: list, read: function (t) { return isString(t) && list.indexOf(t) !== -1 ? { value: t, error: "" } : { error: "x" }; } }; }
  function lim(lib, name, key) { return function (ctx) { var T = L()[lib][name]; return key === undefined ? T[ctx.direction === "toRate" ? "toRate" : "toApy"] : key ? T[key] : T; }; }
  function timing() { return choice(TIMING); }

  function compoundCheck(freq) {   // calc.js's validate on the whole set
    return function (values, defs) {
      var raw = {}, bad = [];
      ["principal", "monthly", "ratePct", "years", "frequency", "timing"].forEach(function (k) { raw[k] = has(values, k) ? values[k] : defs[k]; });
      if (freq) raw.frequency = freq;
      Object.keys(L().C.validate(raw)).forEach(function (k) { if (!(freq && k === "frequency")) bad.push(k); });
      return bad;
    };
  }
  function compoundFields(withFrequency) {
    var f = {};
    if (withFrequency) f.frequency = choice(FREQ);
    f.timing = timing(); f.principal = amount(true, true); f.monthly = amount(true, true); f.ratePct = amount(false); f.years = amount(true);
    return f;
  }
  function start(extra) {   // the compound pages' start values
    var o = { principal: 10000, monthly: 100, ratePct: 5, years: 10, timing: "end" };
    Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var INFLATION = compoundFields(true);
  INFLATION.inflation = limited(lim("R", "INFLATION_LIMITS", ""));

  // fields: readers in link order (choices first); defaults: the page's start values; activeFor: the keys that matter in a mode.
  var MODELS = {
    compound: { needs: ["C"], fields: compoundFields(true), check: compoundCheck(null), defaults: start({ frequency: "monthly" }) },
    inflation: { needs: ["C", "R"], fields: INFLATION, check: compoundCheck(null), defaults: start({ frequency: "monthly", inflation: 3 }) },
    savings: { needs: ["C", "R", "G"],
      fields: { mode: choice(MODES), timing: timing(), principal: limited(lim("G", "LIMITS", "principal"), true),
        monthly: limited(lim("G", "LIMITS", "monthly"), true), apyPct: limited(lim("G", "LIMITS", "apyPct")), years: limited(lim("G", "LIMITS", "years")),
        goal: limited(lim("G", "LIMITS", "goal"), true) },
      defaults: { mode: "growth", timing: "end", principal: 10000, monthly: 100, apyPct: 5, years: 10, goal: 50000 },
      activeFor: function (t) { var f = L().G.MODE_FIELDS; return ["mode", "timing"].concat(f[isString(t.mode) && has(f, t.mode) ? t.mode : "growth"]); },
      legacy: { apy: "apyPct" }, legacyPattern: { apy: /^\d+(\.\d{1,2})?$/ } },   // "#apy=5.12", the APY calculator's link
    apy: { needs: ["C", "R"],
      fields: { direction: choice(["toApy", "toRate"]), frequency: choice(FREQ.concat("continuous")), value: limited(lim("R", "APY_LIMITS")) },
      defaults: { direction: "toApy", frequency: "monthly", value: 5 } },
    rule72: { needs: ["C", "R"],
      fields: { mode: choice(["years", "rate"]), ratePct: limited(lim("R", "RULE72_LIMITS", "ratePct")), years: limited(lim("R", "RULE72_LIMITS", "years")) },
      defaults: { mode: "years", ratePct: 6, years: 12 },
      activeFor: function (t) { return ["mode", t.mode === "rate" ? "years" : "ratePct"]; } },   // each mode uses one field
    formula: { needs: ["C"], fields: compoundFields(false), check: compoundCheck("monthly"), defaults: start({}) }
  };
  Object.keys(MODELS).forEach(function (n) { MODELS[n].keys = Object.keys(MODELS[n].fields); });

  function modelFor(n) { return isString(n) && has(MODELS, n) ? MODELS[n] : null; }
  function defaults(n) { var m = modelFor(n); return m ? JSON.parse(JSON.stringify(m.defaults)) : null; }

  // texts: key -> text, typed or from a link (strict: a plain decimal first). -> {ok, values} or {ok: false, reason, bad}. Never throws.
  function fromTexts(name, texts, strict) {
    var m = modelFor(name), l = L(), values = {}, ctx = {}, bad = [];
    if (!m) return { ok: false, reason: "model", bad: [] };
    if (!m.needs.every(function (n) { return !!l[n]; })) return { ok: false, reason: "unavailable", bad: [] };
    m.keys.forEach(function (k) {
      if (!has(texts, k)) return;
      var t = texts[k], f = m.fields[k], r;
      if (!isString(t) || (strict && f.read.numeric && !PLAIN_NUMBER.test(t))) { bad.push(k); return; }
      try { r = f.read(t, ctx); } catch (e) { r = { error: "x" }; }
      if (r.error) bad.push(k); else values[k] = ctx[k] = r.value;
    });
    if (!bad.length) { try { bad = m.check ? m.check(values, m.defaults) : []; } catch (e) { bad = ["*"]; } }
    return bad.length ? { ok: false, reason: "value", bad: bad } : { ok: true, values: values };
  }

  // Stored or imported inputs checked as a link is. -> {ok, inputs}: a NEW object of allowlisted keys only, or {ok: false, bad}.
  function validate(name, inputs) {
    var m = modelFor(name), texts = Object.create(null), bad = [];
    if (!m || inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) return { ok: false, reason: m ? "value" : "model", bad: [] };
    m.keys.forEach(function (k) {
      if (!has(inputs, k)) return;
      var v = inputs[k];
      if (typeof v === "number" && isFinite(v)) texts[k] = decimalText(v); else if (isString(v)) texts[k] = v; else bad.push(k);
    });
    var r = fromTexts(name, texts);
    return bad.length || !r.ok ? { ok: false, reason: bad.length ? "value" : r.reason, bad: bad.concat(r.bad || []) } : { ok: true, inputs: r.values };
  }

  // parse: {kind: "none"} (leave the page alone) | {kind: "ok", inputs (the keys the link carried), legacy} | {kind: "error", reason}.
  function parse(name, fragment) {
    var m = modelFor(name), s = String(fragment === null || fragment === undefined ? "" : fragment).replace(/^#/, "");
    if (!m) return { kind: "error", reason: "model" };
    if (s === "") return { kind: "none" };
    if (s.length > MAX_LENGTH) return { kind: "error", reason: "too-long" };
    if (s.indexOf("=") === -1) return { kind: "none" };   // a page anchor such as #how-it-works
    var pairs = [], seen = Object.create(null), dup = false, hasV = false, v = null, legacy = m.legacy || {};
    new URLSearchParams(s).forEach(function (value, key) {
      if (seen[key] === 1) dup = true;
      seen[key] = 1;
      pairs.push([key, value]);
      if (key === "v") { hasV = true; v = value; }
    });
    if (!hasV && !pairs.some(function (p) { return has(m.fields, p[0]) || has(legacy, p[0]); })) return { kind: "none" };   // not ours
    var texts = Object.create(null), clash = false, r;
    if (dup) return { kind: "error", reason: "duplicate" };
    if (hasV && v !== VERSION) return { kind: "error", reason: "version" };
    pairs.forEach(function (p) {
      var k = p[0], t = legacy[k];
      if (has(m.fields, k)) texts[k] = p[1];
      else if (!hasV && t) {
        if (has(texts, t) || seen[t] === 1 || !m.legacyPattern[k].test(p[1])) clash = true;
        texts[t] = p[1];
      }
    });
    r = clash ? { ok: false, reason: "value" } : fromTexts(name, texts, true);
    return r.ok ? { kind: "ok", inputs: r.values, legacy: !hasV } : { kind: "error", reason: r.reason };
  }

  // build: the fragment (no "#") for the keys that matter, or null if any input is invalid or it passes the cap.
  function build(name, inputs) {
    var m = modelFor(name), c = validate(name, inputs), texts = Object.create(null), q = new URLSearchParams(), active;
    if (!m || !c.ok) return null;
    m.keys.forEach(function (k) { if (has(c.inputs, k)) texts[k] = isString(c.inputs[k]) ? c.inputs[k] : decimalText(c.inputs[k]); });
    active = m.activeFor ? m.activeFor(texts) : null;
    q.set("v", VERSION);
    m.keys.forEach(function (k) { if (has(texts, k) && (!active || active.indexOf(k) !== -1)) q.set(k, texts[k]); });
    // Never a link this site would refuse: it must pass the cap and read back as ok.
    return q.toString().length > MAX_LENGTH || parse(name, q.toString()).kind !== "ok" ? null : q.toString();
  }

  // attach: cfg {model, form, fields: key -> {id} | {radio}, onChange, ui?: {button, status, box, url} ids}. Never writes the address bar while typing.
  function attach(cfg) {
    var m = cfg && modelFor(cfg.model);
    if (!m || !cfg.form || !cfg.fields) return null;
    var form = cfg.form, doc = form.ownerDocument, button, status, box, url, old;
    function made(tag, cls) { var el = doc.createElement(tag); if (cls) el.className = cls; return el; }
    if (cfg.ui) {
      button = doc.getElementById(cfg.ui.button); status = doc.getElementById(cfg.ui.status);
      box = doc.getElementById(cfg.ui.box); url = doc.getElementById(cfg.ui.url);
      if (!button || !status || !box || !url) return null;
      old = box.querySelector("label");
      if (old) old.textContent = STRINGS.shareLabel;
    } else {
      var actions = made("div", "actions"), label = made("label");
      button = made("button", "btn"); button.type = "button";
      status = made("span", "muted"); status.setAttribute("aria-live", "polite");
      box = made("div", "field share"); box.hidden = true;
      label.setAttribute("for", "share-url"); label.textContent = STRINGS.shareLabel;
      url = made("input"); url.id = "share-url"; url.type = "text"; url.readOnly = true;
      url.setAttribute("autocomplete", "off"); url.setAttribute("spellcheck", "false");
      actions.appendChild(button); actions.appendChild(status); box.appendChild(label); box.appendChild(url);
      form.appendChild(actions); form.appendChild(box);
    }
    button.textContent = STRINGS.copyButton;
    var note = made("p", "muted scenario-note"), bad = made("p", "err scenario-bad"), from = made("p", "muted scenario-from");
    note.textContent = STRINGS.note; from.textContent = STRINGS.fromLink;
    box.parentNode.insertBefore(note, box.nextSibling);
    bad.setAttribute("role", "alert"); bad.hidden = true;
    from.setAttribute("role", "status"); from.hidden = true;
    form.insertBefore(from, form.firstChild); form.insertBefore(bad, form.firstChild);

    function radios(name) { return [].filter.call(form.querySelectorAll('input[type="radio"]'), function (r) { return r.name === name; }); }
    function readTexts() {   // each field's text as the visitor sees it; a hidden field is neither linked nor checked
      var texts = Object.create(null), active;
      m.keys.forEach(function (k) {
        var b = cfg.fields[k], el, on;
        if (!b) return;
        if (b.radio) { on = radios(b.radio).filter(function (r) { return r.checked; })[0]; texts[k] = on ? on.value : ""; }
        else if ((el = doc.getElementById(b.id))) texts[k] = el.value;
      });
      active = m.activeFor ? m.activeFor(texts) : null;
      if (active) m.keys.forEach(function (k) { if (active.indexOf(k) === -1) delete texts[k]; });
      return texts;
    }
    function showAll(values) {
      m.keys.forEach(function (k) {
        var b = cfg.fields[k], v = values[k], el;
        if (!b || !has(values, k)) return;
        if (b.radio) radios(b.radio).forEach(function (r) { r.checked = r.value === v; });
        else if ((el = doc.getElementById(b.id))) el.value = isString(v) ? v : m.fields[k].money ? moneyText(v) : decimalText(v);
      });
    }
    function clear() { box.hidden = true; url.value = ""; status.textContent = ""; bad.hidden = true; bad.textContent = ""; from.hidden = true; }
    function fragment() {
      var r = fromTexts(cfg.model, readTexts()), frag = r.ok ? build(cfg.model, r.values) : null;
      return { bad: r.bad, frag: frag, long: r.ok && frag === null };   // long: every number is fine but the link would pass the cap
    }

    function restore() {
      var r = parse(cfg.model, root.location.hash);
      if (r.kind === "none") return false;
      clear();
      if (r.kind === "ok") { showAll(m.defaults); showAll(r.inputs); from.hidden = false; }   // a link that carries some keys never mixes in the visitor's own; its numbers may not be theirs
      else { showAll(m.defaults); bad.textContent = STRINGS.badLink; bad.hidden = false; }
      if (cfg.onChange) cfg.onChange();
      return true;
    }

    button.addEventListener("click", function () {
      var f = fragment(), nav = root.navigator, link;
      if (f.frag === null) {   // a link with a field left out would open with a default the sender never saw
        clear();
        status.textContent = f.long ? STRINGS.tooLong : STRINGS.fixFirst;
        var first = (f.bad || []).filter(function (k) { return cfg.fields[k] && cfg.fields[k].id; })[0], el = first && doc.getElementById(cfg.fields[first].id);
        if (el) el.focus();
        return;
      }
      link = root.location.origin + root.location.pathname + "#" + f.frag;
      function done(ok) {
        if (fragment().frag !== f.frag) return;   // the numbers changed while copying
        clear();
        if (ok) { status.textContent = STRINGS.copied; return; }
        url.value = link; box.hidden = false; status.textContent = STRINGS.blocked;
        url.focus(); url.select();
        try { url.setSelectionRange(0, link.length); } catch (e) { /* select() already ran */ }
      }
      if (!nav || !nav.clipboard || !nav.clipboard.writeText) return done(false);
      try { nav.clipboard.writeText(link).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    });
    form.addEventListener("input", clear);
    form.addEventListener("change", clear);
    root.addEventListener("hashchange", restore);
    restore();
    var handle = {
      restore: restore,
      // The typed inputs, checked: {ok, inputs (the keys that matter)} or {ok: false, bad}; open(inputs) shows saved ones, as a link would.
      current: function () { var r = fromTexts(cfg.model, readTexts()); return r.ok ? { ok: true, inputs: r.values } : { ok: false, bad: r.bad }; },
      open: function (inputs) { showAll(m.defaults); showAll(inputs); clear(); if (cfg.onChange) cfg.onChange(); },   // like a link: what is missing starts from the defaults
      afterReset: function () {   // after the page's own Reset: messages go, a scenario fragment leaves the address bar
        clear();
        if (parse(cfg.model, root.location.hash).kind !== "none" && root.history && root.history.replaceState) {
          root.history.replaceState(null, "", root.location.pathname + root.location.search);
        }
      }
    };
    if (root.SavedScenarios) root.SavedScenarios.attach({ model: cfg.model, form: form, scenario: handle });   // the save area, if saved.js is loaded
    return handle;
  }

  var api = { STRINGS: STRINGS, VERSION: VERSION, MAX_LENGTH: MAX_LENGTH, MODELS: Object.keys(MODELS), defaults: defaults,
    // A model's keys, the fixed choices of its choice keys, and the link-number pattern: enough to check a saved entry without the maths files.
    shape: function (n) {
      var m = modelFor(n), c = {};
      if (m) m.keys.forEach(function (k) { if (m.fields[k].list) c[k] = m.fields[k].list.slice(); });
      return m ? { keys: m.keys.slice(), choices: c, plain: PLAIN_NUMBER } : null;
    }, decimalText: decimalText, fromTexts: fromTexts, validate: validate, parse: parse, build: build, attach: attach };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScenarioLink = api;
})(typeof self !== "undefined" ? self : this);
