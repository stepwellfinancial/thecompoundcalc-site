/* app.js: wires the form to calc.js and draws the results. All maths lives in calc.js. */
(function () {
  "use strict";
  var C = window.CompoundCalc;
  var form = document.getElementById("calc-form");
  var NUMERIC = ["principal", "monthly", "ratePct", "years"];
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  var plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  var DEFAULTS = { principal: "10,000", monthly: "100", ratePct: "5", years: "10", frequency: "monthly", timing: "end" };
  var OUTPUTS = ["out-final", "out-simple", "out-diff"];

  function $(id) { return document.getElementById(id); }

  function readInputs() {
    var raw = {};
    NUMERIC.forEach(function (k) { raw[k] = C.parseAmount(form.elements[k].value, k !== "ratePct"); });
    raw.frequency = form.elements.frequency.value;
    raw.timing = form.querySelector('input[name="timing"]:checked').value;
    return raw;
  }

  function showErrors(errors) {
    NUMERIC.forEach(function (k) {
      var msg = errors[k] || "";
      if (k === "ratePct" && msg === "Enter a number." && form.elements[k].value.indexOf(",") !== -1) {
        msg = "Use a dot for decimals, like 4.5.";
      }
      $(k + "-err").textContent = msg;
      form.elements[k].setAttribute("aria-invalid", msg ? "true" : "false");
    });
  }

  /* A round axis top: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a power of ten. */
  function niceMax(v) {
    if (!(v > 4)) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var s = 0; s < steps.length; s++) if (steps[s] * p >= v) return steps[s] * p;
    return 10 * p;
  }

  function axisLabel(v) {
    return v >= 1e15 ? "$" + v.toExponential(1) : compact.format(v);
  }

  /* Three lines over the years: compound balance, simple interest balance, and
   * the money put in. The gap between the top two is what compounding adds. */
  function drawChart(inputs, yearly) {
    var W = 640, H = 280, L = 70, R = 14, T = 14, B = 30;
    var pw = W - L - R, ph = H - T - B;
    var pts = [{ year: 0, balance: inputs.principal, simpleBalance: inputs.principal, contributions: inputs.principal }].concat(yearly);
    var top = pts[pts.length - 1];
    var max = niceMax(Math.max(top.balance, top.simpleBalance));
    var years = pts.length - 1;
    var x = function (yr) { return L + (yr / years) * pw; };
    var y = function (v) { return T + ph - (Math.max(0, v) / max) * ph; };
    var line = function (key) {
      return pts.map(function (p, idx) { return (idx ? "L" : "M") + x(p.year).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
    };
    var out = ['<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'];
    for (var g = 0; g <= 4; g++) {
      var v = (max / 4) * g, gy = y(v).toFixed(1);
      out.push('<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (L - 8) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + axisLabel(v) + "</text>");
    }
    var every = Math.max(1, Math.ceil(years / 10));
    pts.forEach(function (p) {
      if (p.year % every === 0) {
        out.push('<text class="axis" x="' + x(p.year).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + p.year + "</text>");
      }
    });
    // The area between simple and compound is the extra that compounding earns.
    var gap = line("balance") + " " + pts.slice().reverse().map(function (p) {
      return "L" + x(p.year).toFixed(1) + " " + y(p.simpleBalance).toFixed(1);
    }).join(" ") + " Z";
    out.push('<path class="gap" d="' + gap + '"/>');
    out.push('<path class="ln ln-contrib" d="' + line("contributions") + '"/>');
    out.push('<path class="ln ln-simple" d="' + line("simpleBalance") + '"/>');
    out.push('<path class="ln ln-compound" d="' + line("balance") + '"/>');
    out.push('<circle class="dot-compound" cx="' + x(top.year).toFixed(1) + '" cy="' + y(top.balance).toFixed(1) + '" r="4"/>');
    out.push('<circle class="dot-simple" cx="' + x(top.year).toFixed(1) + '" cy="' + y(top.simpleBalance).toFixed(1) + '" r="4"/>');
    // One invisible column per year so hovering shows that year's numbers.
    var colW = pw / Math.max(1, years);
    yearly.forEach(function (p) {
      var cx = x(p.year) - colW / 2;
      out.push('<rect class="hit" x="' + cx.toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) + '" height="' + ph + '"><title>Year ' + p.year +
        ": compound " + money.format(p.balance) + ", simple " + money.format(p.simpleBalance) + ", put in " + money.format(p.contributions) + "</title></rect>");
    });
    out.push("</svg>");
    $("chart").innerHTML = out.join("");
    $("chart").setAttribute("aria-label", "Growth over " + years + (years === 1 ? " year" : " years") + ": " +
      money.format(top.balance) + " with compound interest, " + money.format(top.simpleBalance) + " with simple interest, from " +
      money.format(top.contributions) + " put in.");
  }

  function drawTable(yearly) {
    $("out-table").innerHTML = yearly.map(function (r) {
      return "<tr><td>" + r.year + "</td><td>" + money.format(r.contributions) + "</td><td>" + money.format(r.interest) +
        "</td><td>" + money.format(r.balance) + "</td><td>" + money.format(r.simpleBalance) + "</td></tr>";
    }).join("");
  }

  function update() {
    hideShare();
    var raw = readInputs();
    var errors = C.validate(raw);
    showErrors(errors);
    var results = document.querySelector(".results");
    if (Object.keys(errors).length) {
      // Never leave an old answer on screen as if it still applied.
      results.classList.add("stale");
      OUTPUTS.forEach(function (id) { $(id).textContent = "$..."; });
      $("out-table").innerHTML = "";
      $("chart").setAttribute("aria-label", "No chart: fix the highlighted field.");
      $("out-summary").textContent = errors.frequency || errors.timing || "Fix the highlighted field to see results.";
      return;
    }
    results.classList.remove("stale");
    var res = C.calculate(raw);
    $("out-final").textContent = money.format(res.final);
    $("out-simple").textContent = money.format(res.simpleFinal);
    $("out-diff").textContent = money.format(res.compoundingAdds);
    var note = res.final >= C.EXACT_TO_CENTS_BELOW ? " Numbers this large are only approximate." : "";
    $("out-summary").textContent = "You put in " + money.format(res.contributions) + ". With compound interest, " +
      money.format(res.interest) + " of the final balance is interest." + note;
    drawChart(raw, res.yearly);
    drawTable(res.yearly);
  }

  /* Inputs travel in the part of the link after "#", which browsers never send
   * to the web server, so a shared link does not put anyone's numbers in a log. */
  function toHash() {
    var raw = readInputs();
    var q = new URLSearchParams();
    NUMERIC.forEach(function (k) { if (isFinite(raw[k])) q.set(k, String(raw[k])); });
    q.set("frequency", raw.frequency);
    q.set("timing", raw.timing);
    return q.toString();
  }

  function fromHash() {
    var q = new URLSearchParams(location.hash.replace(/^#/, ""));
    NUMERIC.forEach(function (k) {
      if (!q.has(k)) return;
      var v = C.parseAmount(q.get(k));
      if (isFinite(v)) form.elements[k].value = k === "principal" || k === "monthly" ? plain.format(v) : String(v);
    });
    var f = q.get("frequency");
    if (f && Object.prototype.hasOwnProperty.call(C.FREQUENCIES, f)) form.elements.frequency.value = f;
    var t = q.get("timing");
    if (t === "start" || t === "end") form.querySelector('input[name="timing"][value="' + t + '"]').checked = true;
  }

  /* If the browser will not copy, show the link in a read-only box, selected,
   * so the user can copy it by hand. Any change to the inputs hides it again,
   * so it never shows a link to old numbers, and clears any copy status. */
  function hideShare() {
    $("share-box").hidden = true;
    $("share-url").value = "";
    $("copy-status").textContent = "";
  }

  function showShare(url) {
    var box = $("share-url");
    box.value = url;
    $("share-box").hidden = false;
    $("copy-status").textContent = "Your browser blocked copying. Select the link below and copy it.";
    box.focus();
    box.select();
    try { box.setSelectionRange(0, url.length); } catch (e) { /* some inputs refuse; select() already ran */ }
  }

  $("copy-link").addEventListener("click", function () {
    // A link with a field left out would open with a default the sender never saw.
    var errors = C.validate(readInputs());
    if (Object.keys(errors).length) {
      hideShare();
      $("copy-status").textContent = "Fix the highlighted field first.";
      var bad = NUMERIC.filter(function (k) { return errors[k]; });
      if (bad.length) form.elements[bad[0]].focus();
      return;
    }
    var hash = toHash(), url = location.origin + location.pathname + "#" + hash;
    var done = function (ok) {
      if (toHash() !== hash) return; // inputs changed while copying: the link is no longer "these numbers"
      if (!ok) return showShare(url);
      hideShare();
      $("copy-status").textContent = "Link copied.";
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return done(false);
    try {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } catch (e) { done(false); }
  });

  form.addEventListener("reset", function (e) {
    e.preventDefault();
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === "timing") form.querySelector('input[name="timing"][value="end"]').checked = true;
      else form.elements[k].value = DEFAULTS[k];
    });
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    hideShare();
    $("copy-status").textContent = "";
    update();
  });

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  window.addEventListener("hashchange", function () { fromHash(); update(); });
  fromHash();
  update();
})();
