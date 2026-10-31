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
   * always with enough decimals that no two ticks read the same. With short set
   * (narrow charts only), $1,000 and up read $22.5K style, still exact. */
  function axisLabel(v, short) {
    if (short === true && v >= 1e3 && v < 1e6) { // only true, so map(axisLabel) never shortens
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact",
        maximumFractionDigits: digitsFor(v / 1e3) }).format(v);
    }
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

  /* Generous widths: end labels (12px unless px is given), and the bold
   * "Compounding adds" label (14px unless px is given). */
  function labelWidth(text, px) { return Math.ceil(String(text).length * 7.5 * (px || 12) / 12); }
  function addsWidth(text, px) { return Math.ceil(String(text).length * 9 * (px || 14) / 14); }

  /* Chart text sizes in CSS pixels, by the chart's drawn width. The chart is drawn
   * one viewBox unit per CSS pixel, so these are the sizes people see. The same
   * sizes are in styles.css, under the svg class named here. */
  var SIZES = {
    narrow: { cls: "sz-narrow", axisPx: 12, labelPx: 12, addsPx: 13, shortTicks: true, addsAbove: true },
    wide: { cls: "sz-wide", axisPx: 13, labelPx: 13, addsPx: 14, shortTicks: false, addsAbove: false }
  };
  function sizeFor(width) { return width < 440 ? SIZES.narrow : SIZES.wide; }

  /* "Compounding adds" in as few lines as fit maxW: one line, else split after the
   * colon, else more (see below). */
  function wrapAdds(text, px, maxW) {
    var fits = function (ls) { return Math.max.apply(null, ls.map(function (t) { return addsWidth(t, px); })) <= maxW; };
    var cut = text.lastIndexOf(": ");
    if (cut < 0 || fits([text])) return [text];
    var two = [text.slice(0, cut + 1), text.slice(cut + 2)];
    if (fits(two)) return two;
    // Still too long: the figure and its "(+6.8%)" on separate lines, else the
    // words split before " by ", else both. The last way is used even if it does not fit.
    var by = two[0].indexOf(" by "), paren = two[1].indexOf(" (");
    var tries = [];
    if (paren > 0) tries.push([two[0], two[1].slice(0, paren), two[1].slice(paren + 1)]);
    if (by >= 0) tries.push([two[0].slice(0, by), two[0].slice(by + 1), two[1]]);
    if (by >= 0 && paren > 0) tries.push([two[0].slice(0, by), two[0].slice(by + 1), two[1].slice(0, paren), two[1].slice(paren + 1)]);
    for (var t = 0; t < tries.length; t++) if (fits(tries[t])) return tries[t];
    return tries.length ? tries[tries.length - 1] : two;
  }

  /* The chart's whole layout, in viewBox units. pts as for scaleFor; compoundText and
   * simpleText are the end labels; addsText is the "Compounding adds" label. size,
   * if given, is {W, H} in CSS pixels: the chart is then drawn at that size with the
   * text sizes from sizeFor(W). Without it, the 640 x 480 layout as before.
   * mult, if given, is {compound, simple}: each end figure's growth multiple ("2.3×"),
   * written on a second line under that figure, followed by WORDS.multTail (empty: "2.3×").
   * Without mult the end labels are the figure alone, as before. */
  var LABEL_H = 16, BAND_GAP = 8;
  // The words after a multiple ("1.5×") and after the percent ("(+6.8%)"), in one place. Bare for now; the fuller
  // wordings considered were " deposits" and " more" (put either back here and in the tests' TAIL_ constants).
  var WORDS = { multTail: "", pctTail: "" };
  var SUB_GAP = 8;   // clear space between the compound and the simple end label
  function frame(pts, compoundText, simpleText, addsText, size, mult) {
    var sz = size ? sizeFor(size.W) : null;
    var labelPx = sz ? sz.labelPx : 12, addsPx = sz ? sz.addsPx : 14, axisPx = sz ? sz.axisPx : 12;
    var labelH = sz ? labelPx + 5 : LABEL_H, lineH = sz ? addsPx + 3 : 16;
    // Each end label is a figure with, when there is a multiple, a second line under it:
    // hh is the whole label's height and subStep the drop from the figure to that line.
    var hasSub = !!(mult && mult.compound && mult.simple);
    // subStep is at least 1.25 times the text size, so the two lines keep a line height over 1.2.
    var subStep = hasSub ? (sz ? Math.ceil(labelPx * 1.25) : 15) : 0, hh = labelH + subStep;
    var sub = hasSub ? { compound: mult.compound + WORDS.multTail, simple: mult.simple + WORDS.multTail } : null;
    var subWidth = function (s) { return s ? Math.max(labelWidth(s.compound, labelPx), labelWidth(s.simple, labelPx)) : 0; };
    var axis = scaleFor(pts);
    var W = sz ? size.W : 640, H = sz ? size.H : 480, T = sz ? 10 : 8, B = sz ? axisPx + 18 : 30;
    // The left margin fits the widest tick label, including one more step in case
    // the top is raised below.
    var L = 70;
    if (sz) {
      var tickW = axis.ticks.concat([axis.ticks[axis.ticks.length - 1] + axis.step]).map(function (v) {
        var t = axisLabel(v, sz.shortTicks);
        // M, B and T are wider than a digit.
        return labelWidth(t, axisPx) + (/[MBT]/.test(t) ? Math.ceil(axisPx * 0.4) : 0);
      });
      L = 10 + Math.max.apply(null, tickW);
    }
    var R = (sz ? 4 : 14) + 10 + Math.max(labelWidth(compoundText, labelPx), labelWidth(simpleText, labelPx), subWidth(sub));
    var minPlot = Math.round(0.4 * W);
    // On a narrow chart "Compounding adds" would be as wide as the plot, so it goes
    // in its own band above the plot, starting at the chart's left edge. End figures
    // too long for the right margin go in that band too, so their text keeps its size:
    // each after a dot in its line's colour and named in words ("Compound: $X"), not
    // by colour alone, wrapping after the colon when the line is too long.
    var above = !!(sz && sz.addsAbove), aboveLines = null, endsAbove = false, endLines = null;
    if (above) {
      aboveLines = wrapAdds(addsText, addsPx, W - 2 - 22);
      if (W - L - R < minPlot) {
        endsAbove = true; R = 12;
        var named = function (word, text) {
          var one = word + ": " + text;
          return labelWidth(one, labelPx) <= W - 2 - 22 ? [one] : [word + ":", text];
        };
        endLines = { compound: named("Compound", compoundText), simple: named("Simple", simpleText) };
        if (hasSub) {
          // The multiple is the last line of each.
          endLines.compound.push(sub.compound);
          endLines.simple.push(sub.simple);
        }
      }
      // Separate labels in the band, and the band and the plot, keep a clear gap of 8:
      // 4 of space plus the two 2px halos (styles.css).
      T = 2 + lineH * (aboveLines.length + (endsAbove ? endLines.compound.length + endLines.simple.length : 0)) + (endsAbove ? 2 * BAND_GAP : 0) + 16;
    }
    var pw = W - L - R, ph = H - T - B;
    // Figures too long even for that (about $10^22 and up on a 360px phone) would squeeze
    // the plot: then the chart is drawn wider than its box and scaled down to fit.
    var needW = Math.max(L + R + minPlot, endsAbove ? 24 + Math.max.apply(null,
      endLines.compound.concat(endLines.simple).map(function (t) { return labelWidth(t, labelPx); })) : 0);
    if (sz && W < needW) {
      var grow = needW / W;
      W = needW; H = Math.round(H * grow);
      pw = W - L - R; ph = H - T - B;
    }
    var years = pts.length - 1, last = pts[years];
    // Year labels: every year when they fit, else every 2, 5, 10... years.
    var every = Math.max(1, Math.ceil(years / 10));
    if (sz) {
      var room = Math.max(1, Math.floor(pw / (labelWidth(String(years), axisPx) + 14)));
      var steps = [1, 2, 5, 10, 20, 25, 50, 100];
      for (var s = 0; s < steps.length; s++) { every = steps[s]; if (years / every <= room) break; }
    }
    var x = function (yr) { return L + (yr / years) * pw; };
    // Every plotted value is at or above axis.floor, so each line sits at its true value.
    var y = function (v) { return T + ph - ((v - axis.floor) / (axis.top - axis.floor)) * ph; };
    // "Compounding adds" goes inside the plot, top left, or bottom left when the lines
    // run high there. A long label wraps (see wrapAdds), so it never runs off.
    var keyX = above ? 0 : L + 10, textX = keyX + 22;
    var clear = 6; // gap between the label and any line, line width included
    var place = function (ls) {
      var p = { lines: ls, bandH: lineH * ls.length,
        right: textX + Math.max.apply(null, ls.map(function (t) { return addsWidth(t, addsPx); })) };
      // Every line only rises, so across the label's width they stay between the values
      // at the year before its left edge (vLo) and the year after its right edge (vHi).
      var i0 = Math.max(0, Math.floor(10 / pw * years)), i1 = Math.min(years, Math.max(0, Math.ceil((p.right + 4 - L) / pw * years)));
      p.vLo = Math.min.apply(null, KEYS.map(function (k) { return pts[i0][k]; }));
      p.vHi = Math.max.apply(null, KEYS.map(function (k) { return pts[i1][k]; }));
      p.topOk = y(p.vHi) >= T + p.bandH + clear;
      p.bottomOk = y(p.vLo) <= T + ph - p.bandH - 2 - clear;
      return p;
    };
    var pl = place(above ? aboveLines : wrapAdds(addsText, addsPx, W - 4 - textX));
    if (sz && !above && !pl.topOk && !pl.bottomOk && pl.lines.length === 1 && addsText.indexOf(": ") > 0) {
      // On one line it would cross the lines in both corners: try it on two first.
      var cut = addsText.lastIndexOf(": ");
      var two = place([addsText.slice(0, cut + 1), addsText.slice(cut + 2)]);
      if (two.topOk || two.bottomOk) pl = two;
    }
    var lines = pl.lines, bandH = pl.bandH, right = pl.right, vLo = pl.vLo, vHi = pl.vHi;
    var bandTop = above ? 2 + (endsAbove ? lineH * (endLines.compound.length + endLines.simple.length) + 2 * BAND_GAP : 0) : T;
    if (!above && !pl.topOk) {
      if (!pl.bottomOk) {
        // Lines run through both corners (very fast growth with a long label): raise
        // the top just enough for the label to fit above them. The floor stays.
        var b = (bandH + clear) / ph;
        axis = scaleFor(pts, (vHi - b * axis.floor) / (1 - b));
      } else {
        bandTop = T + ph - bandH - 2;
      }
    }
    var adds = { keyX: keyX, textX: textX, y: bandTop + lineH / 2, lines: lines, lineH: lineH, right: right,
      top: bandTop, bottom: bandTop + bandH };
    var endX = x(years) + 10;
    // End labels stay inside the plot's height, and clear of "Compounding adds"
    // if that label is long enough to reach the right margin.
    // Positions here are the centre of each whole label (figure and multiple), which
    // sits subStep / 2 below the figure's own line; the figure's y is returned.
    var yMin = 2 + hh / 2, yMax = T + ph - hh / 2;
    if (adds.right + 8 > endX) {
      if (above || bandTop === T) yMin = adds.bottom + 4 + hh / 2;
      else yMax = adds.top - 4 - hh / 2;
    }
    var ends = endLabels(y(last.balance) + subStep / 2, y(last.simpleBalance) + subStep / 2, hh + (hasSub ? SUB_GAP : 0), yMin, yMax);
    ends = { compound: ends.compound - subStep / 2, simple: ends.simple - subStep / 2 };
    if (endsAbove) {
      endX = textX;
      ends = { compound: 2 + lineH / 2, simple: 2 + lineH * (endLines.compound.length + 0.5) + BAND_GAP };
    }
    return { W: W, H: H, L: L, R: R, T: T, B: B, pw: pw, ph: ph, axis: axis, years: years, x: x, y: y,
      adds: adds, endX: endX, endCompoundY: ends.compound, endSimpleY: ends.simple, endsAbove: endsAbove, endKeyX: keyX + 7,
      endLines: endLines, sub: sub, subStep: subStep,
      every: every, cls: sz ? sz.cls : "", shortTicks: sz ? sz.shortTicks : false };
  }

  root.ChartAxis = { niceMax: niceMax, niceStep: niceStep, scaleFor: scaleFor, axisLabel: axisLabel,
    endLabels: endLabels, labelWidth: labelWidth, addsWidth: addsWidth, frame: frame, LABEL_H: LABEL_H,
    sizeFor: sizeFor, wrapAdds: wrapAdds, words: WORDS };
})(typeof self !== "undefined" ? self : this);

(function () {
  "use strict";
  var C = window.CompoundCalc;
  var A = window.ChartAxis;
  var form = document.getElementById("calc-form");
  if (!form) return; // a page without the calculator, such as the axis tests
  var NUMERIC = ["principal", "monthly", "ratePct", "years"];
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
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

  /* The percent under "Compounding adds", in words ("+6.8% more than the simple
   * balance"); hidden when there is none (see calc.js addsPercentText). */
  function showMore(pct) {
    var el = $("out-diff-more");
    if (!el) return; // a page without the line
    el.textContent = pct ? pct + " more than the simple balance" : "";
    el.hidden = !pct;
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
  // Under the legend, so the legend sits directly under the chart.
  var legend = $("chart").parentNode.querySelector(".legend");
  var noteAfter = legend || $("chart");
  noteAfter.parentNode.insertBefore(floorNote, noteAfter.nextSibling);

  /* Three lines over the years: compound balance, simple interest balance, and
   * total deposits. The gap between the top two is what compounding adds. */
  var lastDraw = null;

  // A figure never breaks inside a number: styles.css shrinks it to its tile; if it still does not fit, the tiles
  // stack (.stack); only if it does not fit even then (the largest inputs) may it wrap (.wrap-long).
  var tiles = document.querySelector(".split");
  function fitTiles() {
    if (!tiles) return;
    tiles.classList.add("fit");
    tiles.classList.remove("stack", "wrap-long");
    var over = function () {
      return [].some.call(tiles.querySelectorAll("dd:not(.more)"), function (d) { return d.scrollWidth > d.clientWidth + 1; });
    };
    if (over()) { tiles.classList.add("stack"); if (over()) tiles.classList.add("wrap-long"); }
  }

  function drawChart(inputs, yearly, adds) {
    fitTiles();
    lastDraw = [inputs, yearly, adds];
    var pts = [{ year: 0, balance: inputs.principal, simpleBalance: inputs.principal, contributions: inputs.principal }].concat(yearly);
    var top = pts[pts.length - 1];
    var years = pts.length - 1;
    // The end labels show the same figures, formatted the same way, as the tiles.
    var compoundText = money.format(top.balance), simpleText = money.format(top.simpleBalance);
    // Each end figure's growth multiple of everything put in (start plus contributions),
    // and what compounding adds as a percent of the simple balance. Either is left out
    // when it has no meaning (calc.js gives "" for zero money in, or a 0.0% gap).
    var mult = { compound: C.multipleText(top.balance, top.contributions), simple: C.multipleText(top.simpleBalance, top.contributions) };
    // Both or neither: one figure with a multiple and the other without would mislead.
    if (!mult.compound || !mult.simple) mult = { compound: "", simple: "" };
    var pct = C.addsPercentText(adds, top.simpleBalance);
    var addsText = "Compounding adds by year " + years + ": " + money.format(adds) + (pct ? " (" + pct + A.words.pctTail + ")" : "");
    // Drawn at the chart box's own size in CSS pixels, so the text is the same size on
    // every screen. The height comes from the box's aspect-ratio in styles.css, never
    // from what was drawn in it last. Without one, the 640 x 480 layout.
    var box = $("chart"), bw = Math.round(box.clientWidth), bh = 0;
    var ratio = String(getComputedStyle(box).aspectRatio || "").split("/").map(parseFloat);
    if (ratio.length === 2 && ratio[0] > 0 && ratio[1] > 0) bh = Math.round(bw * ratio[1] / ratio[0]);
    drawnW = bw;
    var f = A.frame(pts, compoundText, simpleText, addsText, bw > 200 && bh > 100 ? { W: bw, H: bh } : null, mult);
    var W = f.W, H = f.H, L = f.L, R = f.R, T = f.T, pw = f.pw, ph = f.ph, axis = f.axis, x = f.x, y = f.y;
    var line = function (key) {
      return pts.map(function (p, idx) { return (idx ? "L" : "M") + x(p.year).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
    };
    var out = ['<svg' + (f.cls ? ' class="' + f.cls + '"' : "") + ' viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'];
    axis.ticks.forEach(function (v) {
      var gy = y(v).toFixed(1);
      out.push('<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (L - 8) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + A.axisLabel(v, f.shortTicks) + "</text>");
    });
    var every = f.every;
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
    // with a short tick back to its dot when it had to move. When they sit in the band
    // above the plot (long figures on a phone), each follows a dot in its line's colour.
    // The growth multiple is a second line under each figure (class end-sub); the full words are in the aria text.
    [["compound", top.balance, f.endCompoundY, compoundText], ["simple", top.simpleBalance, f.endSimpleY, simpleText]].forEach(function (e) {
      var dy = y(e[1]);
      if (f.endsAbove) {
        out.push('<circle class="dot-' + e[0] + '" cx="' + f.endKeyX + '" cy="' + e[2].toFixed(1) + '" r="4"/>');
      } else if (Math.abs(e[2] - dy) > 1) {
        out.push('<line class="end-lead lead-' + e[0] + '" x1="' + (x(years) + 5).toFixed(1) + '" y1="' + dy.toFixed(1) +
          '" x2="' + (f.endX - 2).toFixed(1) + '" y2="' + e[2].toFixed(1) + '"/>');
      }
      var tsp = function (t, dy, cls) {
        return '<tspan' + (cls ? ' class="' + cls + '"' : "") + ' x="' + f.endX.toFixed(1) + '" dy="' + dy + '">' + t + "</tspan>";
      };
      var words;
      if (f.endsAbove) {
        var ls = f.endLines[e[0]];
        words = ls.map(function (t, i) { return tsp(t, i ? f.adds.lineH : 0, f.sub && i === ls.length - 1 ? "end-sub" : ""); }).join("");
      } else {
        words = f.sub ? tsp(e[3], 0, "") + tsp(f.sub[e[0]], f.subStep, "end-sub") : e[3];
      }
      out.push('<text class="end-label end-' + e[0] + '" x="' + f.endX.toFixed(1) + '" y="' + e[2].toFixed(1) + '" dominant-baseline="middle">' + words + "</text>");
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
    // The same figures in words for screen readers, with the multiples and the percent.
    // "1.5×" is read as "1.5 times", so a screen reader does not say the letter x.
    var said = function (m) { return m ? " (" + m.replace("×", " times") + " what you put in)" : ""; };
    $("chart").setAttribute("aria-label", "Growth over " + years + (years === 1 ? " year" : " years") + ": " +
      money.format(top.balance) + " with compound interest" + said(mult.compound) + ", " + money.format(top.simpleBalance) +
      " with simple interest" + said(mult.simple) + ", total deposits " + money.format(top.contributions) + ". Compounding adds by year " + years + ": " +
      money.format(adds) + (pct ? ", " + pct.replace("+", "") + " more than the simple balance" : "") + "." +
      (floorText ? " The chart starts at " + floorText + ", not $0." : ""));
  }

  function drawTable(yearly) {
    $("out-table").innerHTML = yearly.map(function (r) {
      return "<tr><td>" + r.year + "</td><td>" + money.format(r.contributions) + "</td><td>" + money.format(r.interest) +
        "</td><td>" + money.format(r.balance) + "</td><td>" + money.format(r.simpleBalance) + "</td></tr>";
    }).join("");
  }

  function update() {
    var raw = readInputs();
    var errors = C.validate(raw);
    showErrors(errors);
    var results = document.querySelector(".results");
    if (Object.keys(errors).length) {
      // Never leave an old answer on screen as if it still applied.
      results.classList.add("stale");
      OUTPUTS.forEach(function (id) { $(id).textContent = "$..."; });
      showMore("");
      $("out-table").innerHTML = "";
      // Clear the chart too: an old chart could show an axis floor without its note.
      $("chart").innerHTML = "";
      lastDraw = null;
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
    showMore(C.addsPercentText(res.compoundingAdds, res.simpleFinal));
    var note = res.final >= C.EXACT_TO_CENTS_BELOW ? " Numbers this large are only approximate." : "";
    $("out-summary").textContent = "You put in " + money.format(res.contributions) + ". With compound interest, " +
      money.format(res.interest) + " of the final balance is interest." + note;
    drawChart(raw, res.yearly, res.compoundingAdds);
    drawTable(res.yearly);
  }

  /* "Copy link" and restoring a link are in scenario.js, shared with the other calculators:
   * the inputs travel in the part of the link after "#", which browsers never send to the web
   * server, they are checked like typing, and the address bar is never written while typing. */
  var scenario = window.ScenarioLink ? window.ScenarioLink.attach({
    model: "compound",
    form: form,
    fields: { principal: { id: "principal" }, monthly: { id: "monthly" }, ratePct: { id: "ratePct" }, years: { id: "years" },
      frequency: { id: "frequency" }, timing: { radio: "timing" } },
    ui: { button: "copy-link", status: "copy-status", box: "share-box", url: "share-url" },
    onChange: update
  }) : null;

  form.addEventListener("reset", function (e) {
    e.preventDefault();
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === "timing") form.querySelector('input[name="timing"][value="end"]').checked = true;
      else form.elements[k].value = DEFAULTS[k];
    });
    if (scenario) scenario.afterReset();
    update();
  });

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  // Redraw the chart only (not the form) when its width changes, such as on rotating a phone.
  var drawnW = 0, pending = false;
  window.addEventListener("resize", function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      var w = Math.round($("chart").clientWidth);
      if (lastDraw && w !== drawnW) drawChart.apply(null, lastDraw);
    });
  });
  update();
})();
