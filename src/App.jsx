// Electric Load Planner — field tool for splitting generator load across
// 32A/63A distribution boxes without tripping breakers.
//
// Layout: sticky header only shows board rating + reset + an overload
// alert (when relevant). Per-phase load lives in exactly one place — the
// phase cards in the page body — each showing both limits that matter
// (board total, 16A socket group) so there's no second "status" widget
// to cross-reference. Adding equipment happens in a bottom-sheet modal
// opened from a floating "+" button, kept off the status screen entirely.
//
// Electrical model:
// - One 3-phase main board rated 32A or 63A (the generator cable feeding it).
// - 3 single-phase legs (L1 brown / L2 orange / L3 black), each leg has a
//   16A MCB feeding a group of regular 230V sockets.
// - Optional 32A 3-phase (red, 5-pin) sockets draw equally from all 3 legs
//   at once, on top of whatever each leg is already carrying.
// - A leg overloads if: its 16A socket group is exceeded, OR its total load
//   (16A group + share of any 3-phase devices) exceeds the board rating.

import React, { useState, useRef, useEffect } from "react";
import {
  Fan,
  Flame,
  Coffee,
  Droplets,
  Utensils,
  UtensilsCrossed,
  Refrigerator,
  Speaker,
  Wind,
  Lightbulb,
  Monitor,
  Plug,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  X,
} from "lucide-react";

const VOLTAGE = 230;

const PRESET_CATEGORIES = [
  {
    label: "אוורור וחימום",
    items: [
      { name: "מאוורר תעשייתי", watts: 690, Icon: Fan },
      { name: "תנור חימום פטריה", watts: 2760, Icon: Flame },
    ],
  },
  {
    label: "מטבח וקייטרינג",
    items: [
      { name: "צ'יפסר כפול", watts: 3000, Icon: Utensils },
      { name: "מיחם מים מסחרי", watts: 2500, Icon: Droplets },
      { name: "מכונת קפה", watts: 2000, Icon: Coffee },
      { name: "מחמם מזון / פלטה", watts: 1500, Icon: UtensilsCrossed },
      { name: "מקרר / מקפיא", watts: 800, Icon: Refrigerator },
    ],
  },
  {
    label: "במה, תאורה והגברה",
    items: [
      { name: "ארון מגברים", watts: 3000, Icon: Speaker },
      { name: "מכונת עשן", watts: 1500, Icon: Wind },
      { name: "פנס ראש נע", watts: 500, Icon: Lightbulb },
      { name: "מסך לדים", watts: 300, Icon: Monitor },
    ],
  },
];

const PHASE_STYLE = {
  1: { chipBg: "bg-cable-brown", dot: "bg-cable-brown", bar: "bg-cable-brown", label: "פאזה 1", sub: "כבל חום", short: "L1" },
  2: { chipBg: "bg-cable-orange", dot: "bg-cable-orange", bar: "bg-cable-orange", label: "פאזה 2", sub: "כבל כתום", short: "L2" },
  3: { chipBg: "bg-cable-black", dot: "bg-cable-black", bar: "bg-cable-black", label: "פאזה 3", sub: "כבל שחור", short: "L3" },
};
const THREE_PHASE_STYLE = { chipBg: "bg-cable-red", dot: "bg-cable-red", bar: "bg-cable-red", label: "תלת פאזי", sub: "שקע אדום 32A", short: "3F" };

const wattsToAmps = (w) => w / VOLTAGE;
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function phaseTotals(devices) {
  const totals = { 1: { group16: 0, threePhase: 0 }, 2: { group16: 0, threePhase: 0 }, 3: { group16: 0, threePhase: 0 } };
  devices.forEach((d) => {
    if (d.phase === "3phase") {
      totals[1].threePhase += d.amps;
      totals[2].threePhase += d.amps;
      totals[3].threePhase += d.amps;
    } else {
      totals[d.phase].group16 += d.amps;
    }
  });
  [1, 2, 3].forEach((p) => {
    totals[p].total = totals[p].group16 + totals[p].threePhase;
  });
  return totals;
}

function evaluateAddition(devices, boxMax, phase, totalRequested) {
  const totals = phaseTotals(devices);
  if (phase === "3phase") {
    for (const p of [1, 2, 3]) {
      const newTotal = totals[p].total + totalRequested;
      if (newTotal > boxMax) {
        return { ok: false, reason: `פאזה ${p} תעבור את מגבלת הלוח (${fmt(newTotal)}A מתוך ${boxMax}A)` };
      }
    }
    const minRemaining = Math.min(...[1, 2, 3].map((p) => boxMax - totals[p].total - totalRequested));
    return { ok: true, note: `לכל פאזה יישארו לפחות ${fmt(minRemaining)}A` };
  }
  const t = totals[phase];
  const newGroup16 = t.group16 + totalRequested;
  const newTotal = t.total + totalRequested;
  if (newGroup16 > 16) {
    return { ok: false, reason: `יעבור את המבטח 16A של קבוצת השקעים (${fmt(newGroup16)}A)` };
  }
  if (newTotal > boxMax) {
    return { ok: false, reason: `יעבור את מגבלת הלוח בפאזה זו (${fmt(newTotal)}A מתוך ${boxMax}A)` };
  }
  return { ok: true, note: `יישארו ${fmt(16 - newGroup16)}A בקבוצה, ${fmt(boxMax - newTotal)}A בפאזה` };
}

// TEMPORARY diagnostic overlay — remove once the iOS phantom-scroll bug is
// found. Shows the same scrollHeight/clientHeight numbers a Safari Web
// Inspector session would, directly on-device, since a Mac isn't available
// to connect one. Read-only, click-through (pointerEvents: none).
function DebugOverlay() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;";
    probe.style.paddingTop = "env(safe-area-inset-top, -1px)";
    probe.style.paddingBottom = "env(safe-area-inset-bottom, -1px)";
    document.body.appendChild(probe);

    const update = () => {
      const main = document.querySelector("main");
      const cs = getComputedStyle(probe);
      setInfo({
        html: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
        body: [document.body.scrollHeight, document.body.clientHeight],
        main: main ? [main.scrollHeight, main.clientHeight] : null,
        innerHeight: window.innerHeight,
        vvHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
        dpr: window.devicePixelRatio,
        safeTop: parseFloat(cs.paddingTop),
        safeBottom: parseFloat(cs.paddingBottom),
      });
    };

    update();
    const id = setInterval(update, 800);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      probe.remove();
    };
  }, []);

  if (!info) return null;
  const line = (label, [scroll, client]) => {
    const over = scroll > client;
    return `${label}: ${scroll}/${client}${over ? " ⚠OVERFLOW" : ""}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        insetInline: 0,
        zIndex: 9999,
        pointerEvents: "none",
        background: "rgba(0,0,0,0.85)",
        color: "#4ade80",
        fontFamily: "monospace",
        fontSize: 10,
        lineHeight: 1.4,
        padding: "4px 6px",
        direction: "ltr",
        textAlign: "left",
        whiteSpace: "pre",
      }}
    >
      {line("html", info.html)}
      {"\n"}
      {line("body", info.body)}
      {"\n"}
      {info.main ? line("main", info.main) : "main: not found"}
      {"\n"}
      {`innerH:${info.innerHeight} vvH:${info.vvHeight} dpr:${info.dpr}`}
      {"\n"}
      {`safe-top:${info.safeTop} safe-bottom:${info.safeBottom}`}
    </div>
  );
}

export default function App() {
  const [boxMax, setBoxMax] = useState(32);
  const [devices, setDevices] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [mode, setMode] = useState("preset"); // "preset" | "custom"
  const [presetCat, setPresetCat] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState(null);
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState("W"); // W | kW | A
  const [customName, setCustomName] = useState("");
  const [qty, setQty] = useState(1);
  // No default phase — must be picked explicitly every time, so a fast tap
  // never silently lands a device on phase 1 by accident.
  const [targetPhase, setTargetPhase] = useState(null);

  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // Sheet is bounded to the space below the header (not a % of viewport
  // height) so it can never grow tall enough to cover the header — and the
  // header never has to cover the sheet's own title bar either.
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setHeaderHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let singleAmps = 0;
  let isPowerBased = true; // true: derived from W/kW (nameplate = total power). false: entered directly in A.
  let deviceName = "";
  let hasSelection = false;

  if (mode === "preset" && selectedPreset) {
    singleAmps = wattsToAmps(selectedPreset.watts);
    isPowerBased = true;
    deviceName = selectedPreset.name;
    hasSelection = true;
  } else if (mode === "custom") {
    const v = parseFloat(customValue);
    if (v > 0) {
      if (customUnit === "W") { singleAmps = v / VOLTAGE; isPowerBased = true; }
      if (customUnit === "kW") { singleAmps = (v * 1000) / VOLTAGE; isPowerBased = true; }
      if (customUnit === "A") { singleAmps = v; isPowerBased = false; }
      deviceName = customName.trim() || "עומס מותאם אישית";
      hasSelection = true;
    }
  }

  // Amps actually drawn from each phase leg once connected:
  // - Single leg (L1/L2/L3): the full singleAmps value.
  // - 3-phase socket: a W/kW rating is the device's TOTAL power (standard
  //   nameplate convention), split evenly across all 3 legs — so each leg
  //   only carries a third of the single-phase-equivalent figure. An A
  //   rating on 3-phase gear is conventionally already per-line (e.g. a
  //   "32A 5-pin plug" carries 32A on each pin), so it's used as-is.
  const perPhaseAmps = targetPhase === "3phase" && isPowerBased ? singleAmps / 3 : singleAmps;

  const totalRequested = perPhaseAmps * qty;
  const evaluation = hasSelection && targetPhase ? evaluateAddition(devices, boxMax, targetPhase, totalRequested) : null;
  const canAdd = hasSelection && targetPhase && evaluation?.ok;

  function handleAdd() {
    if (!canAdd) return;
    const newOnes = Array.from({ length: qty }, () => ({
      id: genId(),
      name: deviceName,
      amps: perPhaseAmps,
      phase: targetPhase,
    }));
    setDevices((prev) => [...prev, ...newOnes]);
    setSelectedPreset(null);
    setCustomValue("");
    setCustomName("");
    setQty(1);
    setTargetPhase(null);
  }

  function removeDevice(id) {
    setDevices((prev) => prev.filter((d) => d.id !== id));
  }

  function handleResetClick() {
    if (!confirmReset) {
      setConfirmReset(true);
      resetTimer.current = setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    clearTimeout(resetTimer.current);
    setConfirmReset(false);
    setDevices([]);
  }

  const totals = phaseTotals(devices);
  const threePhaseDevices = devices.filter((d) => d.phase === "3phase");

  const worstLevel = (() => {
    let level = "ok";
    [1, 2, 3].forEach((p) => {
      const t = totals[p];
      if (t.total > boxMax || t.group16 > 16) level = "over";
      else if (level !== "over" && (t.total > boxMax * 0.85 || t.group16 > 16 * 0.85)) level = "warn";
    });
    return level;
  })();

  const alertBanner = {
    warn: { cls: "bg-amber-500", Icon: AlertTriangle, text: "קרוב לגבול — שימו לב" },
    over: { cls: "bg-red-600", Icon: AlertTriangle, text: "עומס יתר בלוח!" },
  }[worstLevel];

  return (
    <div dir="rtl" className="h-[100dvh] flex flex-col overflow-hidden bg-zinc-100 font-body text-zinc-900">
      <DebugOverlay />
      {/* Header: board rating + reset + overload alert. A plain flex item
          (not scrolled, not sticky) — the page body below is the only
          scrollable region, so there's nothing for it to scroll past. */}
      <div ref={headerRef} className="shrink-0 border-b-4 border-zinc-900 bg-white pt-[min(env(safe-area-inset-top),60px)]">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 font-display text-lg font-black">
            <Plug className="h-6 w-6" />
            <span>עומסי חשמל</span>
          </div>
          <div className="mr-auto flex overflow-hidden rounded-xl border-2 border-zinc-900">
            {[32, 63].map((v) => (
              <button
                key={v}
                onClick={() => setBoxMax(v)}
                className={`px-4 py-2 font-display text-base font-black transition ${
                  boxMax === v ? "bg-zinc-900 text-white" : "bg-white text-zinc-900"
                }`}
              >
                {v}A
              </button>
            ))}
          </div>
          <button
            onClick={handleResetClick}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 transition ${
              confirmReset ? "border-red-600 bg-red-600 text-white" : "border-zinc-300 bg-white text-zinc-500"
            }`}
            aria-label="לוח חדש"
            title="לוח חדש"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>

        {/* Only takes screen space when something actually needs attention */}
        {alertBanner && (
          <div className={`flex items-center gap-2 px-4 py-2 font-display text-sm font-bold text-white ${alertBanner.cls}`}>
            <alertBanner.Icon className="h-4 w-4 shrink-0" />
            <span>{alertBanner.text}</span>
          </div>
        )}

        {confirmReset && (
          <div className="bg-red-600 py-1.5 text-center font-body text-sm font-bold text-white">
            לחצו שוב כדי לנקות את כל הציוד מהלוח
          </div>
        )}
      </div>

      {/* The only scrollable region on the page — bounded to the leftover
          space below the header, so it only scrolls when content actually
          overflows it (no phantom scroll when the board is nearly empty). */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <div className="mx-auto max-w-md px-4 pb-4 pt-4">
        {threePhaseDevices.length > 0 && (
          <div className="mb-3 rounded-2xl border-2 border-red-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 font-display text-sm font-black text-red-600">
              <span className={`h-2.5 w-2.5 rounded-full ${THREE_PHASE_STYLE.dot}`} />
              שקעים תלת-פאזיים · מוסיפים לכל 3 הפאזות
            </div>
            {threePhaseDevices.map((d) => (
              <div key={d.id} className="mb-1.5 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 last:mb-0">
                <div className="font-body text-sm font-bold">
                  {d.name} <span className="font-normal text-zinc-500">· {fmt(d.amps)}A לכל פאזה</span>
                </div>
                <button onClick={() => removeDevice(d.id)} className="rounded-lg bg-zinc-200 p-1.5 text-zinc-600 active:bg-red-600 active:text-white">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {[1, 2, 3].map((p) => {
          const s = PHASE_STYLE[p];
          const t = totals[p];
          const group16Pct = Math.min((t.group16 / 16) * 100, 100);
          const group16Over = t.group16 > 16;
          const totalPct = Math.min((t.total / boxMax) * 100, 100);
          const totalOver = t.total > boxMax;
          const phaseDevices = devices.filter((d) => d.phase === String(p));

          return (
            <div key={p} className="mb-3 overflow-hidden rounded-2xl border-2 border-zinc-200 bg-white">
              <div className={`h-2 ${s.bar}`} />
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-display text-base font-black">
                    <span className={`h-3 w-3 rounded-full ${s.dot}`} />
                    {s.label} <span className="font-normal text-zinc-400">· {s.sub}</span>
                  </div>
                  <div className={`rounded-lg px-2 py-1 font-display text-sm font-black ${totalOver ? "bg-red-100 text-red-700" : "bg-zinc-100"}`}>
                    {fmt(t.total)}A
                  </div>
                </div>

                <div className="mb-1 flex justify-between font-body text-xs font-bold text-zinc-500">
                  <span>סה״כ בפאזה (מגבלת הלוח)</span>
                  <span>{fmt(t.total)} / {boxMax}A</span>
                </div>
                <div className="mb-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className={`h-full rounded-full ${totalOver ? "bg-red-600" : s.bar}`} style={{ width: `${totalPct}%` }} />
                </div>

                <div className="mb-1 flex justify-between font-body text-xs font-bold text-zinc-500">
                  <span>שקעים רגילים (מבטח 16A)</span>
                  <span>{fmt(t.group16)} / 16A</span>
                </div>
                <div className="mb-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className={`h-full rounded-full ${group16Over ? "bg-red-600" : s.bar}`} style={{ width: `${group16Pct}%` }} />
                </div>

                {phaseDevices.length > 0 && (
                  <div className="space-y-1.5">
                    {phaseDevices.map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
                        <div className="font-body text-sm font-bold">
                          {d.name} <span className="font-normal text-zinc-500">· {fmt(d.amps)}A</span>
                        </div>
                        <button onClick={() => removeDevice(d.id)} className="rounded-lg bg-zinc-200 p-1.5 text-zinc-600 active:bg-red-600 active:text-white">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </main>

      {/* Bottom bar: opens the add-equipment sheet. A fixed part of the
          page layout (shrink-0, like the header) rather than a button
          floating over content — the card list above is flex-sized to
          leave exactly this much room, so it can never cover a card. */}
      <div className="shrink-0 border-t-2 border-zinc-900 bg-white px-4 py-4">
        <button
          onClick={() => {
            setTargetPhase(null);
            setShowAddModal(true);
          }}
          className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 font-display text-base font-black text-white transition active:scale-[0.98]"
        >
          <Plus className="h-5 w-5" />
          הוספת ציוד
        </button>
      </div>

      {/* Add-equipment bottom sheet — bounded to the area below the header */}
      {showAddModal && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-end justify-center" style={{ top: headerHeight }}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddModal(false)} />
          <div className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-zinc-100 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b-2 border-zinc-900 bg-white px-4 py-3">
              <span className="font-display text-lg font-black">הוספת ציוד</span>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 active:bg-zinc-200"
                aria-label="סגור"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pb-4 pt-3">
              {/* Mode tabs */}
              <div className="mb-3 flex overflow-hidden rounded-2xl border-2 border-zinc-900">
                <button
                  onClick={() => setMode("preset")}
                  className={`flex-1 py-3 font-display text-base font-black transition ${
                    mode === "preset" ? "bg-zinc-900 text-white" : "bg-white text-zinc-500"
                  }`}
                >
                  ציוד מהרשימה
                </button>
                <button
                  onClick={() => setMode("custom")}
                  className={`flex-1 py-3 font-display text-base font-black transition ${
                    mode === "custom" ? "bg-zinc-900 text-white" : "bg-white text-zinc-500"
                  }`}
                >
                  עומס מותאם
                </button>
              </div>

              {/* Preset grid */}
              {mode === "preset" && (
                <div className="mb-4 rounded-2xl border-2 border-zinc-200 bg-white p-3">
                  <div className="mb-3 flex gap-1.5">
                    {PRESET_CATEGORIES.map((cat, i) => (
                      <button
                        key={cat.label}
                        onClick={() => setPresetCat(i)}
                        className={`flex-1 rounded-lg py-2 font-body text-xs font-bold transition ${
                          presetCat === i ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_CATEGORIES[presetCat].items.map((item) => {
                      const selected = selectedPreset?.name === item.name;
                      const amps = wattsToAmps(item.watts);
                      const Icon = item.Icon;
                      return (
                        <button
                          key={item.name}
                          onClick={() => setSelectedPreset(selected ? null : item)}
                          className={`relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center transition ${
                            selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-800"
                          }`}
                        >
                          {selected && <CheckCircle2 className="absolute right-1 top-1 h-4 w-4" />}
                          <Icon className="h-6 w-6" />
                          <span className="font-body text-xs font-bold leading-tight">{item.name}</span>
                          <span className={`font-body text-xs ${selected ? "text-zinc-300" : "text-zinc-400"}`}>{fmt(amps)}A</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom entry */}
              {mode === "custom" && (
                <div className="mb-4 rounded-2xl border-2 border-zinc-200 bg-white p-4">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={customValue}
                    onChange={(e) => setCustomValue(e.target.value)}
                    placeholder="0"
                    className="mb-3 w-full rounded-xl border-2 border-zinc-200 bg-zinc-50 p-4 text-center font-display text-3xl font-black text-zinc-900 focus:border-zinc-900 focus:outline-none"
                  />
                  <div className="mb-3 flex overflow-hidden rounded-xl border-2 border-zinc-900">
                    {["W", "kW", "A"].map((u) => (
                      <button
                        key={u}
                        onClick={() => setCustomUnit(u)}
                        className={`flex-1 py-2 font-display font-bold transition ${
                          customUnit === u ? "bg-zinc-900 text-white" : "bg-white text-zinc-600"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="שם הציוד (לא חובה)"
                    className="w-full rounded-xl border-2 border-zinc-200 bg-zinc-50 p-3 font-body text-base focus:border-zinc-900 focus:outline-none"
                  />
                </div>
              )}

              {/* Target socket + quantity — only once something is picked.
                  Phase picker comes first (no default — see targetPhase
                  state) so it can't be scrolled past or skipped by a fast tap. */}
              {hasSelection && (
                <>
                  <div className="mb-4">
                    <div className="mb-2 font-display text-sm font-bold text-zinc-600">לאיזה שקע מתחברים?</div>
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      {[1, 2, 3].map((p) => {
                        const s = PHASE_STYLE[p];
                        const selected = targetPhase === String(p);
                        return (
                          <button
                            key={p}
                            onClick={() => setTargetPhase(String(p))}
                            className={`rounded-xl py-4 text-center font-display text-white transition ${s.chipBg} ${
                              selected ? "ring-4 ring-zinc-900 ring-offset-2" : "opacity-80"
                            }`}
                          >
                            <div className="text-base font-black">{s.label}</div>
                            <div className="text-xs">{s.sub}</div>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setTargetPhase("3phase")}
                      className={`w-full rounded-xl py-4 text-center font-display text-white transition ${THREE_PHASE_STYLE.chipBg} ${
                        targetPhase === "3phase" ? "ring-4 ring-zinc-900 ring-offset-2" : "opacity-80"
                      }`}
                    >
                      <div className="text-base font-black">{THREE_PHASE_STYLE.label}</div>
                      <div className="text-xs">{THREE_PHASE_STYLE.sub}</div>
                    </button>
                  </div>

                  <div className="mb-4 flex items-center justify-between rounded-2xl border-2 border-zinc-200 bg-white p-3">
                    <span className="font-display text-base font-bold text-zinc-700">כמות יחידות</span>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 active:bg-zinc-200"
                      >
                        <Minus className="h-5 w-5" />
                      </button>
                      <span className="w-8 text-center font-display text-2xl font-black">{qty}</span>
                      <button
                        onClick={() => setQty((q) => Math.min(50, q + 1))}
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 active:bg-zinc-200"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="shrink-0 border-t-2 border-zinc-900 bg-white px-4 py-4">
              {hasSelection && !targetPhase && (
                <div className="mb-2 rounded-xl bg-zinc-100 px-3 py-2 text-center font-body text-sm font-bold text-zinc-500">
                  בחרו לאיזה שקע מתחברים
                </div>
              )}
              {evaluation && (
                <div className={`mb-2 rounded-xl px-3 py-2 text-center font-body text-sm font-bold ${evaluation.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {evaluation.ok ? evaluation.note : `✕ ${evaluation.reason}`}
                </div>
              )}
              <button
                onClick={handleAdd}
                disabled={!canAdd}
                className={`w-full rounded-2xl py-4 text-center font-display text-xl font-black text-white transition ${
                  canAdd ? "bg-zinc-900 active:scale-[0.98]" : "bg-zinc-300"
                }`}
              >
                {!hasSelection ? "בחרו ציוד לחיבור" : !targetPhase ? "בחרו שקע לחיבור" : `חבר · ${fmt(totalRequested)}A`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
