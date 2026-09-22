const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceMax(value) {
  if (value <= 0) return 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * series: [{ key, label, colorVar }]
 * rows: [{ day: 'YYYY-MM-DD', [key]: number, ... }]
 */
export function renderLineChart(container, { series, rows }) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "chart-wrap";

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  for (const s of series) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const key = document.createElement("i");
    key.className = "legend-key";
    key.style.background = `var(${s.colorVar})`;
    item.appendChild(key);
    item.appendChild(document.createTextNode(s.label));
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "Keine Daten im gewählten Zeitraum.";
    wrap.appendChild(empty);
    container.appendChild(wrap);
    return;
  }

  const W = 720, H = 240, padL = 36, padR = 12, padT = 12, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const maxVal = niceMax(Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0))));
  const xFor = (i) => padL + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / maxVal) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img" });

  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const v = (maxVal / gridSteps) * i;
    const y = yFor(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "chart-grid" }));
    const label = svgEl("text", { x: padL - 6, y: y + 3, class: "chart-axis-label", "text-anchor": "end" });
    label.textContent = Math.round(v).toLocaleString("de-AT");
    svg.appendChild(label);
  }

  const tickEvery = Math.max(1, Math.ceil(rows.length / 6));
  rows.forEach((r, i) => {
    if (i % tickEvery !== 0 && i !== rows.length - 1) return;
    const label = svgEl("text", { x: xFor(i), y: H - 8, class: "chart-axis-label", "text-anchor": "middle" });
    label.textContent = r.day.slice(5);
    svg.appendChild(label);
  });

  for (const s of series) {
    const points = rows.map((r, i) => `${xFor(i)},${yFor(r[s.key] || 0)}`).join(" ");
    svg.appendChild(svgEl("polyline", {
      points, fill: "none", style: `stroke: var(${s.colorVar})`,
      "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round",
    }));
    const last = rows.length - 1;
    svg.appendChild(svgEl("circle", {
      cx: xFor(last), cy: yFor(rows[last][s.key] || 0), r: 4,
      style: `fill: var(${s.colorVar}); stroke: var(--chart-surface)`, "stroke-width": "2",
    }));
  }

  const crosshair = svgEl("line", { y1: padT, y2: padT + plotH, class: "chart-crosshair", visibility: "hidden" });
  svg.appendChild(crosshair);
  const dots = series.map((s) => {
    const d = svgEl("circle", { r: 4, style: `fill: var(${s.colorVar}); stroke: var(--chart-surface)`, "stroke-width": "2", visibility: "hidden" });
    svg.appendChild(d);
    return d;
  });

  const hitArea = svgEl("rect", { x: padL, y: padT, width: plotW, height: plotH, fill: "transparent", style: "cursor: crosshair" });
  svg.appendChild(hitArea);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  wrap.style.position = "relative";

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestDist = Infinity;
    rows.forEach((_, i) => {
      const dist = Math.abs(xFor(i) - relX);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  function showAt(i, clientX, clientY) {
    const row = rows[i];
    crosshair.setAttribute("x1", xFor(i));
    crosshair.setAttribute("x2", xFor(i));
    crosshair.setAttribute("visibility", "visible");
    series.forEach((s, idx) => {
      dots[idx].setAttribute("cx", xFor(i));
      dots[idx].setAttribute("cy", yFor(row[s.key] || 0));
      dots[idx].setAttribute("visibility", "visible");
    });

    tooltip.innerHTML = "";
    const date = document.createElement("div");
    date.className = "tooltip-date";
    date.textContent = row.day;
    tooltip.appendChild(date);
    for (const s of series) {
      const line = document.createElement("div");
      line.className = "tooltip-row";
      const key = document.createElement("i");
      key.style.background = `var(${s.colorVar})`;
      const value = document.createElement("strong");
      value.textContent = (row[s.key] || 0).toLocaleString("de-AT");
      const label = document.createElement("span");
      label.textContent = s.label;
      line.append(key, value, label);
      tooltip.appendChild(line);
    }

    const wrapRect = wrap.getBoundingClientRect();
    tooltip.hidden = false;
    let left = clientX - wrapRect.left + 12;
    if (left + 150 > wrapRect.width) left = clientX - wrapRect.left - 150 - 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${clientY - wrapRect.top - 40}px`;
  }

  function hide() {
    crosshair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
    tooltip.hidden = true;
  }

  hitArea.addEventListener("pointermove", (e) => showAt(nearestIndex(e.clientX), e.clientX, e.clientY));
  hitArea.addEventListener("pointerleave", hide);

  wrap.appendChild(svg);
  wrap.appendChild(tooltip);
  container.appendChild(wrap);
}

/** rows: [{ label, value }], sorted desc by caller */
export function renderMeterList(container, rows, { max } = {}) {
  container.innerHTML = "";
  const list = document.createElement("div");
  list.className = "meter-list";
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "Keine Daten.";
    container.appendChild(empty);
    return;
  }

  for (const r of rows) {
    const item = document.createElement("div");
    item.className = "meter-item";
    const label = document.createElement("span");
    label.className = "meter-label";
    label.textContent = r.label;
    const track = document.createElement("div");
    track.className = "meter-track";
    const fill = document.createElement("div");
    fill.className = "meter-fill";
    fill.style.width = `${Math.max(2, (r.value / top) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement("span");
    value.className = "meter-value";
    value.textContent = r.value.toLocaleString("de-AT");
    item.append(label, track, value);
    list.appendChild(item);
  }
  container.appendChild(list);
}
