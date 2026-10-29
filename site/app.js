/* app.js: wires the form to calc.js and draws the results. All maths lives in calc.js. */

/* ChartAxis: where the chart's value axis starts and ends, its tick labels, and where
 * the chart's labels go. Layout only, no money maths and no DOM, so
 * it can be tested on its own.
 * The axis floor is a round tick at or below every plotted value (all three lines),
 * so no line is ever clipped or moved, and never above 80% of the top; with a $0
 * start the floor is $0. */
(function (root) {
  "use strict";
  var full = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var KEYS = ["balance", "simpleBalance", "contributions"];

  /* A round axis top: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 times a power of ten. */
  function niceMax(v) {
    if (!(v > 4)) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var s = 0; s < steps.length; s++) if (steps[s] * p >= v) return steps[s] * p;
    return 10 * p;
  }

  /* The smallest step of 1, 2, 2.5 or 5 times a power of ten that is at least v, never under $1. */
  function niceStep(v) {
    if (!(v > 1)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var s = 0; s < steps.length; s++) if (steps[s] * p >= v) return steps[s] * p;
    return 10 * p;
  }

  /* pts: [{balance, simpleBalance, contributions}, ...]. Returns {floor, top, step, ticks}.
   * Ticks are every step from the floor; the top may sit between ticks. minTop, if
   * given, is the lowest the top may be (used only to make room for a label). */
  function scaleFor(pts, minTop) {
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) {
      KEYS.forEach(function (k) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); });
    });
    var floor, top, step;
    if (!(hi - lo >= 1)) {
      // Flat lines (no growth): a plain axis from $0, with the line below the top.
      floor = 0; top = niceMax(Math.max(0, hi) * 1.5); step = top / 4;
    } else {
      // Limit the zoom: the floor never sits above 80% of the top, so a small gain
      // never fills the chart. The axis spans at least from 80% of the highest value.
      lo = Math.min(lo, 0.8 * hi);
      // About five steps across that range. The floor is a whole step at or below
      // it; the top is the highest value rounded up to a fifth of a step, so little
      // empty space sits above the lines.
      step = niceStep((hi - lo) / 5);
      floor = Math.max(0, Math.floor(lo / step) * step);
      var fine = niceStep(step / 5);
      top = Math.ceil(Math.max(hi, minTop || 0) / fine) * fine;
      if (top <= floor) top = floor + fine;
    }
    // Ticks from a whole number of steps; the top is never below the last tick,
    // even where very large numbers round differently.
    var n = Math.floor((top - floor) / step + 1e-9), ticks = [];
    for (var i = 0; i <= n; i++) ticks.push(floor + i * step);
    top = Math.max(top, ticks[n]);
    return { floor: floor, top: top, step: step, ticks: ticks };
  }

  /* Fewest decimals that show x exactly (up to 6). */
  function digitsFor(x) {
    for (var d = 0; d < 6; d++) {
      var s = x * Math.pow(10, d);
      if (Math.abs(s - Math.round(s)) < 1e-9 * Math.max(1, Math.abs(s))) return d;
    }
    return 6;
  }

  /* Tick label: whole dollars below $1M, then $1.25M style, then $2.5e+24 style,
   * always with enough decimals that no two ticks read the same. */
  function axisLabel(v) {
    if (v < 1e6) return full.format(v);
    if (v >= 1e15) {
      var e = Math.floor(Math.log10(v));
      return "$" + v.toExponential(digitsFor(v / Math.pow(10, e)));
    }
    var u = v >= 1e12 ? 1e12 : v >= 1e9 ? 1e9 : 1e6;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact",
      maximumFractionDigits: digitsFor(v / u) }).format(v);
  }

  /* End labels: the vertical centres for the compound (upper) and simple (lower)
   * value labels, starting at their dots, kept at least h apart and inside [yMin, yMax]. */
  function endLabels(yCompound, ySimple, h, yMin, yMax) {
    var a = Math.min(Math.max(yCompound, yMin), yMax), b = Math.min(Math.max(ySimple, yMin), yMax);
    if (b - a < h) {
      var mid = (a + b) / 2;
      a = mid - h / 2; b = mid + h / 2;
      if (a < yMin) { a = yMin; b = a + h; }
      if (b > yMax) { b = yMax; a = b - h; }
    }
    return { compound: a, simple: b };
  }

  /* Generous widths: 12px end labels, and the 14px bold "Compounding adds" label. */
  function labelWidth(text) { return Math.ceil(String(text).length * 7.5); }
  function addsWidth(text) { return Math.ceil(String(text).length * 9); }

  /* The chart's whole layout, in viewBox units. pts as for scaleFor; compoundText and
   * simpleText are the end labels; addsText is the "Compounding adds" label. */
  var LABEL_H = 16;
  function frame(pts, compoundText, simpleText, addsText) {
    var W = 640, H = 480, L = 70, T = 8, B = 30;
    var R = 14 + 10 + Math.max(labelWidth(compoundText), labelWidth(simpleText));
    var pw = W - L - R, ph = H - T - B;
    var axis = scaleFor(pts);
    var years = pts.length - 1, last = pts[years];
    var x = function (yr) { return L + (yr / years) * pw; };
    // Every plotted value is at or above axis.floor, so each line sits at its true value.
    var y = function (v) { return T + ph - ((v - axis.floor) / (axis.top - axis.floor)) * ph; };
    // "Compounding adds" goes inside the plot, top left, or bottom left when the lines
    // run high there. A very long figure wraps after the colon, so it never runs off.
    var cut = addsText.lastIndexOf(": ");
    var lines = L + 32 + addsWidth(addsText) <= W - 4 || cut < 0 ? [addsText] : [addsText.slice(0, cut + 1), addsText.slice(cut + 2)];
    var bandH = 16 * lines.length, right = L + 32 + Math.max.apply(null, lines.map(addsWidth));
    // Every line only rises, so across the label's width they stay between the values
    // at the year before its left edge (vLo) and the year after its right edge (vHi).
    var i0 = Math.max(0, Math.floor(10 / pw * years)), i1 = Math.min(years, Math.ceil((right + 4 - L) / pw * years));
    var vLo = Math.min.apply(null, KEYS.map(function (k) { return pts[i0][k]; }));
    var vHi = Math.max.apply(null, KEYS.map(function (k) { return pts[i1][k]; }));
    var clear = 6; // gap between the label and any line, line width included
    var bandTop = T;
    if (y(vHi) < T + bandH + clear) {
      if (y(vLo) > T + ph - bandH - 2 - clear) {
        // Lines run through both corners (very fast growth with a long label): raise
        // the top just enough for the label to fit above them. The floor stays.
        var b = (bandH + clear) / ph;
        axis = scaleFor(pts, (vHi - b * axis.floor) / (1 - b));
      } else {
        bandTop = T + ph - bandH - 2;
      }
    }
    var adds = { keyX: L + 10, textX: L + 32, y: bandTop + 8, lines: lines, lineH: 16, right: right,
      top: bandTop, bottom: bandTop + bandH };
    var endX = x(years) + 10;
    // End labels stay inside the plot's height, and clear of "Compounding adds"
    // if that label is long enough to reach the right margin.
    var yMin = 2 + LABEL_H / 2, yMax = T + ph - LABEL_H / 2;
    if (adds.right + 8 > endX) {
      if (bandTop === T) yMin = adds.bottom + 4 + LABEL_H / 2;
      else yMax = adds.top - 4 - LABEL_H / 2;
    }
    var ends = endLabels(y(last.balance), y(last.simpleBalance), LABEL_H, yMin, yMax);
    return { W: W, H: H, L: L, R: R, T: T, B: B, pw: pw, ph: ph, axis: axis, years: years, x: x, y: y,
      adds: adds, endX: endX, endCompoundY: ends.compound, endSimpleY: ends.simple };
  }

  root.ChartAxis = { niceMax: niceMax, niceStep: niceStep, scaleFor: scaleFor, axisLabel: axisLabel,
    endLabels: endLabels, labelWidth: labelWidth, addsWidth: addsWidth, frame: frame, LABEL_H: LABEL_H };
})(typeof self !== "undefined" ? self : this);

(function () {
  "use strict";
  var C = window.CompoundCalc;
  var A = window.ChartAxis;
  var form = document.getElementById("calc-form");
  if (!form) return; // a page without the calculator, such as the axis tests
  var NUMERIC = ["principal", "monthly", "ratePct", "years"];
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
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

  /* The note under the chart when its axis does not start at $0. One element,
   * made here so both sites get it from this file; delete these lines to drop it. */
  var floorNote = document.createElement("p");
  floorNote.id = "chart-floor";
  floorNote.className = "chart-note";
  floorNote.hidden = true;
  $("chart").parentNode.insertBefore(floorNote, $("chart").nextSibling);

  /* Three lines over the years: compound balance, simple interest balance, and
   * total deposits. The gap between the top two is what compounding adds. */
  function drawChart(inputs, yearly, adds) {
    var pts = [{ year: 0, balance: inputs.principal, simpleBalance: inputs.principal, contributions: inputs.principal }].concat(yearly);
    var top = pts[pts.length - 1];
    var years = pts.length - 1;
    // The end labels show the same figures, formatted the same way, as the tiles.
    var compoundText = money.format(top.balance), simpleText = money.format(top.simpleBalance);
    var addsText = "Compounding adds by year " + years + ": " + money.format(adds);
    var f = A.frame(pts, compoundText, simpleText, addsText);
    var W = f.W, H = f.H, L = f.L, R = f.R, T = f.T, pw = f.pw, ph = f.ph, axis = f.axis, x = f.x, y = f.y;
    var line = function (key) {
      return pts.map(function (p, idx) { return (idx ? "L" : "M") + x(p.year).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
    };
    var out = ['<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'];
    axis.ticks.forEach(function (v) {
      var gy = y(v).toFixed(1);
      out.push('<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (L - 8) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + A.axisLabel(v) + "</text>");
    });
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
    // Each end dot's value, in its line's colour, pushed apart when the dots are close,
    // with a short tick back to its dot when it had to move.
    [["compound", top.balance, f.endCompoundY, compoundText], ["simple", top.simpleBalance, f.endSimpleY, simpleText]].forEach(function (e) {
      var dy = y(e[1]);
      if (Math.abs(e[2] - dy) > 1) {
        out.push('<line class="end-lead lead-' + e[0] + '" x1="' + (x(years) + 5).toFixed(1) + '" y1="' + dy.toFixed(1) +
          '" x2="' + (f.endX - 2).toFixed(1) + '" y2="' + e[2].toFixed(1) + '"/>');
      }
      out.push('<text class="end-label end-' + e[0] + '" x="' + f.endX.toFixed(1) + '" y="' + e[2].toFixed(1) + '" dominant-baseline="middle">' + e[3] + "</text>");
    });
    // Names the shaded area, in a corner the lines do not cross (see frame). Same figure as the tile.
    out.push('<rect class="gap gap-key" x="' + f.adds.keyX + '" y="' + (f.adds.y - 7) + '" width="14" height="14" rx="3"/>');
    out.push('<text class="gap-label" x="' + f.adds.textX + '" y="' + f.adds.y + '" dominant-baseline="middle">' + f.adds.lines.map(function (t, i) {
      return '<tspan x="' + f.adds.textX + '" dy="' + (i ? f.adds.lineH : 0) + '">' + t + "</tspan>";
    }).join("") + "</text>");
    // One invisible column per year so hovering shows that year's numbers.
    var colW = pw / Math.max(1, years);
    yearly.forEach(function (p) {
      var cx = x(p.year) - colW / 2;
      out.push('<rect class="hit" x="' + cx.toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) + '" height="' + ph + '"><title>Year ' + p.year +
        ": compound " + money.format(p.balance) + ", simple " + money.format(p.simpleBalance) + ", total deposits " + money.format(p.contributions) + "</title></rect>");
    });
    out.push("</svg>");
    $("chart").innerHTML = out.join("");
    var floorText = axis.floor > 0 ? A.axisLabel(axis.floor) : "";
    floorNote.textContent = floorText ? "Chart starts at " + floorText + ", not $0." : "";
    floorNote.hidden = !floorText;
    $("chart").setAttribute("aria-label", "Growth over " + years + (years === 1 ? " year" : " years") + ": " +
      money.format(top.balance) + " with compound interest, " + money.format(top.simpleBalance) + " with simple interest, total deposits " +
      money.format(top.contributions) + ". " + addsText + "." +
      (floorText ? " The chart starts at " + floorText + ", not $0." : ""));
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
      // Clear the chart too: an old chart could show an axis floor without its note.
      $("chart").innerHTML = "";
      floorNote.textContent = "";
      floorNote.hidden = true;
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
    drawChart(raw, res.yearly, res.compoundingAdds);
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
