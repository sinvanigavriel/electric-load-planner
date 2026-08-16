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

// Tracks an element's BORDER-box height. Two things here are deliberate and
// both were needed to make safe-area padding behave:
//   - border-box, not the default contentRect: a bar's safe-area padding and
//     border are exactly the parts that must be reserved, and contentRect
//     reports neither.
//   - box:"border-box" on observe(), not just reading the border box in the
//     callback: a content-box observer never FIRES for a padding-only change,
//     and a safe-area inset appearing (iOS often reports 0 on first paint,
//     then the real value) or changing on rotation is precisely that.
// The resize/orientation listeners cover Safari older than 15.4, which
// ignores the box option.
function useObservedBorderBoxHeight(ref, setHeight) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(measure);
    ro.observe(el, { box: "border-box" });
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [ref, setHeight]);
}

// How many pixels of the layout viewport the on-screen keyboard is covering.
//
// iOS does NOT shrink the layout viewport when the keyboard opens — only the
// visual viewport — so window.innerHeight is unchanged and anything anchored
// to bottom:0 stays put underneath the keyboard. That is why the sheet's
// confirm button was unreachable while typing a custom load: not a spacing
// problem, no amount of trimming fixes it. Android resizes the layout viewport
// instead, which makes this naturally 0 there, so the same code is correct on
// both. The 40px floor ignores the small visual-viewport shifts that come from
// the URL bar and sub-pixel rounding.
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > 40 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

// Last few devices connected, newest first — a field board is mostly the same
// three or four machines over and over, so the fastest path to the common case
// is not searching a catalogue at all. Replayed as the exact original input
// (a preset by name, a custom load with its original value AND unit) so the
// electrical maths is identical to typing it again: re-entering 3000W as
// "13.0A" would silently change how a 3-phase rating gets split.
const RECENTS_KEY = "elp.recents.v1";
const MAX_RECENTS = 4;

function loadRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY));
    return Array.isArray(raw) ? raw.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

const recentKey = (r) => (r.kind === "preset" ? `p:${r.name}` : `c:${r.value}${r.unit}:${r.name}`);

// Resolves a stored recent back to something displayable. Returns null for
// entries that no longer resolve — e.g. a preset renamed in a later release —
// so a stale cache can never crash the sheet.
function recentInfo(r) {
  if (r.kind === "preset") {
    const item = PRESET_CATEGORIES.flatMap((c) => c.items).find((i) => i.name === r.name);
    return item ? { label: item.name, amps: wattsToAmps(item.watts), Icon: item.Icon } : null;
  }
  const v = parseFloat(r.value);
  if (!(v > 0)) return null;
  const amps = r.unit === "A" ? v : r.unit === "kW" ? (v * 1000) / VOLTAGE : v / VOLTAGE;
  return { label: r.name || "עומס מותאם", amps, Icon: Plug };
}

function saveRecents(list) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* private mode / quota — recents are a convenience, never a requirement */
  }
}

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
    return { ok: false, blocker: "מבטח 16A", reason: `יעבור את המבטח 16A של קבוצת השקעים (${fmt(newGroup16)}A)` };
  }
  if (newTotal > boxMax) {
    return { ok: false, blocker: "מגבלת הלוח", reason: `יעבור את מגבלת הלוח בפאזה זו (${fmt(newTotal)}A מתוך ${boxMax}A)` };
  }
  return { ok: true, note: `יישארו ${fmt(16 - newGroup16)}A בקבוצה, ${fmt(boxMax - newTotal)}A בפאזה` };
}

// The whole point of the tool is answering "which leg do I plug this into",
// and every number needed to answer it is already here — so answer it instead
// of asking. Runs the same evaluateAddition check across all three legs and
// ranks the ones that fit by how much headroom is left, so the picker can show
// the consequence of each choice up front and point at the emptiest leg.
// Headroom is whichever limit bites first: the 16A socket group or the board.
function phaseOptions(devices, boxMax, legAmps) {
  const totals = phaseTotals(devices);
  const opts = [1, 2, 3].map((p) => {
    const verdict = evaluateAddition(devices, boxMax, String(p), legAmps);
    return {
      phase: p,
      before: totals[p].total,
      after: totals[p].total + legAmps,
      ok: verdict.ok,
      blocker: verdict.blocker,
      headroom: Math.min(16 - (totals[p].group16 + legAmps), boxMax - (totals[p].total + legAmps)),
    };
  });
  const fits = opts.filter((o) => o.ok).sort((a, b) => b.headroom - a.headroom);
  return { opts, bestPhase: fits.length ? fits[0].phase : null };
}

// On-device diagnostic overlay. Opt-in only (see showDebug in App) — it used
// to render unconditionally, i.e. in front of every real user. Shows the
// numbers a Safari Web Inspector session would, directly on-device, since a
// Mac isn't available to connect one. Read-only, click-through.
//
// The line that matters is SHIFTED. If safe-area-inset-top is non-zero AND
// innerHeight + that inset adds back up to the full screen height, then iOS
// has laid the document out over the whole screen but is still reporting the
// shorter, status-bar-excluded height — the black-translucent bug that left a
// dead strip at the bottom. Healthy standalone reads safeTop:0.
function DebugOverlay() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;";
    probe.style.paddingTop = "env(safe-area-inset-top, -1px)";
    probe.style.paddingBottom = "env(safe-area-inset-bottom, -1px)";
    document.body.appendChild(probe);

    // Directly measures what 100dvh (driving the whole app's height) really
    // resolves to, independent of window.innerHeight — if these two numbers
    // ever disagree, or both disagree with screen.height, that's proof
    // window.innerHeight itself (which everything above is measured
    // against) is the thing under-reporting, not our layout.
    const dvhProbe = document.createElement("div");
    dvhProbe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:100dvh;visibility:hidden;pointer-events:none;";
    document.body.appendChild(dvhProbe);

    const update = () => {
      const main = document.querySelector("main");
      const appRoot = document.getElementById("root")?.firstElementChild;
      const bar = [...document.querySelectorAll("div")].find(
        (d) => d.className.includes("border-t-2") && d.querySelector("button")
      );
      const btn = bar ? bar.querySelector("button") : null;
      const cs = getComputedStyle(probe);
      const safeBottom = parseFloat(cs.paddingBottom);
      const btnBottom = btn ? btn.getBoundingClientRect().bottom : null;
      // Where the button's bottom edge SHOULD be if padding == real safe-area:
      // innerHeight - safeBottom - (bar's own 8px baseline padding below button).
      const expectedBtnBottom = window.innerHeight - Math.max(8, safeBottom);
      setInfo({
        html: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
        body: [document.body.scrollHeight, document.body.clientHeight],
        main: main ? [main.scrollHeight, main.clientHeight] : null,
        innerHeight: window.innerHeight,
        vvHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
        dpr: window.devicePixelRatio,
        safeTop: parseFloat(cs.paddingTop),
        safeBottom,
        appRootHeight: appRoot ? Math.round(appRoot.getBoundingClientRect().height) : null,
        barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : null,
        barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        btnBottom: btnBottom != null ? Math.round(btnBottom) : null,
        expectedBtnBottom: Math.round(expectedBtnBottom),
        extraGap: btnBottom != null ? Math.round(expectedBtnBottom - btnBottom) : null,
        dvhPx: Math.round(dvhProbe.getBoundingClientRect().height),
        screenHeight: window.screen ? window.screen.height : null,
        screenAvailHeight: window.screen ? window.screen.availHeight : null,
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
      dvhProbe.remove();
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
      {"\n"}
      {`appRootH:${info.appRootHeight} (vs innerH:${info.innerHeight})`}
      {"\n"}
      {`bar top:${info.barTop} bottom:${info.barBottom} gapBelowBar:${info.barBottom != null ? info.innerHeight - info.barBottom : "?"}`}
      {"\n"}
      {`btnBottom:${info.btnBottom} expected:${info.expectedBtnBottom} extraGap:${info.extraGap}`}
      {"\n"}
      {`100dvh=${info.dvhPx}px screen.h=${info.screenHeight} avail=${info.screenAvailHeight}`}
      {"\n"}
      {`SHIFTED:${
        info.safeTop > 0 && info.screenHeight != null && Math.abs(info.innerHeight + info.safeTop - info.screenHeight) <= 2
          ? `YES — ${info.safeTop}px dead strip at bottom`
          : "no"
      }`}
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

  const [recents, setRecents] = useState(loadRecents);
  const keyboardInset = useKeyboardInset();

  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // Diagnostic overlay: ?debug=1 works in a browser tab, but the viewport bugs
  // worth measuring only happen in the installed standalone app, where there's
  // no address bar to add a query string to — hence the 5-taps-on-the-logo
  // toggle, which is reachable there and invisible to everyone else.
  const [showDebug, setShowDebug] = useState(
    () => new URLSearchParams(window.location.search).get("debug") === "1"
  );
  const logoTaps = useRef(0);
  const logoTapTimer = useRef(null);
  useEffect(() => () => clearTimeout(logoTapTimer.current), []);
  function handleLogoTap() {
    logoTaps.current += 1;
    clearTimeout(logoTapTimer.current);
    if (logoTaps.current >= 5) {
      logoTaps.current = 0;
      setShowDebug((v) => !v);
      return;
    }
    logoTapTimer.current = setTimeout(() => (logoTaps.current = 0), 600);
  }

  // Sheet is bounded to the space below the header (not a % of viewport
  // height) so it can never grow tall enough to cover the header — and the
  // header never has to cover the sheet's own title bar either.
  const headerRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useObservedBorderBoxHeight(headerRef, setHeaderHeight);

  // The bottom bar is position:fixed (not a flex-flow child), so main has to
  // reserve its own bottom clearance equal to the bar's real height.
  const bottomBarRef = useRef(null);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  useObservedBorderBoxHeight(bottomBarRef, setBottomBarHeight);

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

  // What the picker previews. Deliberately independent of targetPhase: these
  // are what each option WOULD cost, so the numbers must not move around as
  // the user taps between them (totalRequested does move, since a 3-phase
  // W/kW rating is split across the legs).
  const singleLegAmps = singleAmps * qty;
  const threePhaseLegAmps = (isPowerBased ? singleAmps / 3 : singleAmps) * qty;
  const { opts: legOptions, bestPhase } = phaseOptions(devices, boxMax, singleLegAmps);
  const threePhaseVerdict = evaluateAddition(devices, boxMax, "3phase", threePhaseLegAmps);
  const noLegFits = hasSelection && bestPhase === null;

  function handleAdd() {
    if (!canAdd) return;
    const newOnes = Array.from({ length: qty }, () => ({
      id: genId(),
      name: deviceName,
      amps: perPhaseAmps,
      phase: targetPhase,
    }));
    setDevices((prev) => [...prev, ...newOnes]);

    const entry =
      mode === "preset" && selectedPreset
        ? { kind: "preset", name: selectedPreset.name }
        : { kind: "custom", name: customName.trim(), value: customValue, unit: customUnit };
    setRecents((prev) => {
      const next = [entry, ...prev.filter((r) => recentKey(r) !== recentKey(entry))].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });

    setSelectedPreset(null);
    setCustomValue("");
    setCustomName("");
    setQty(1);
    setTargetPhase(null);
  }

  // Puts a recent back into the normal input state rather than bypassing it,
  // so there is still exactly one path that produces singleAmps.
  function pickRecent(r) {
    if (r.kind === "preset") {
      const ci = PRESET_CATEGORIES.findIndex((c) => c.items.some((i) => i.name === r.name));
      const item = ci >= 0 ? PRESET_CATEGORIES[ci].items.find((i) => i.name === r.name) : null;
      if (!item) return;
      setMode("preset");
      setPresetCat(ci);
      setSelectedPreset(item);
    } else {
      setMode("custom");
      setCustomValue(r.value);
      setCustomUnit(r.unit);
      setCustomName(r.name);
    }
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
      {showDebug && <DebugOverlay />}
      {/* Header: board rating + reset + overload alert. A plain flex item
          (not scrolled, not sticky) — the page body below is the only
          scrollable region, so there's nothing for it to scroll past. */}
      <div ref={headerRef} className="shrink-0 border-b-4 border-zinc-900 bg-white pt-[min(env(safe-area-inset-top),60px)]">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-3">
          <div onClick={handleLogoTap} className="flex items-center gap-2 font-display text-lg font-black">
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
        {/* bottomBarHeight is the bar's true border-box height, so this only
            needs a small breathing gap on top of it — not the old magic
            constant, which left ~24px of dead scroll below the last card. */}
        <div className="mx-auto max-w-md px-4 pt-4" style={{ paddingBottom: bottomBarHeight + 16 }}>
        {threePhaseDevices.length > 0 && (
          <div className="mb-2 rounded-2xl border-2 border-red-200 bg-white px-4 py-3">
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
            <div key={p} className="mb-2 overflow-hidden rounded-2xl border-2 border-zinc-200 bg-white">
              <div className={`h-2 ${s.bar}`} />
              <div className="px-4 py-3">
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

      {/* Bottom bar: opens the add-equipment sheet. position:fixed with
          bottom:0 + padding-bottom:env(safe-area-inset-bottom) — the plain,
          standard safe-area toolbar pattern. It reads as "too much padding"
          on iPhone only if the web view is taller than the box bottom:0
          resolves against; that mismatch was the black-translucent status bar
          bug, fixed in index.html, not something to compensate for here.
          main reserves space for it via bottomBarHeight (measured above), so
          it can't cover a card. */}
      <div
        ref={bottomBarRef}
        className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-zinc-900 bg-white px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
      >
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

      {/* Add-equipment bottom sheet — bounded to the area below the header,
          and at the bottom by the keyboard rather than pinned to 0 (see
          useKeyboardInset), so on iOS the footer rides above the keyboard
          instead of hiding behind it. */}
      {showAddModal && (
        <div
          className="fixed inset-x-0 z-30 flex items-end justify-center"
          style={{ top: headerHeight, bottom: keyboardInset }}
        >
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
              {/* Recents — a board is mostly the same few machines, so the
                  common case should cost one tap, not tab + category + tile.
                  Absent until there is history, so it never costs a first-time
                  user any height. */}
              {recents.length > 0 && (
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
                  {recents.map((r) => {
                    const info = recentInfo(r);
                    if (!info) return null;
                    const active = info.label === deviceName;
                    return (
                      <button
                        key={recentKey(r)}
                        onClick={() => pickRecent(r)}
                        className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-1.5 font-body text-xs font-bold transition ${
                          active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700"
                        }`}
                      >
                        <info.Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-28 truncate">{info.label}</span>
                        <span className={active ? "text-zinc-300" : "text-zinc-400"}>{fmt(info.amps)}A</span>
                      </button>
                    );
                  })}
                </div>
              )}

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
                  {/* flex-wrap + justify-center, not grid-cols-3: a category
                      with 2 items left an empty third cell that read as a
                      missing tile. Centring the short row says "this category
                      has two" instead. */}
                  <div className="flex flex-wrap justify-center gap-2">
                    {PRESET_CATEGORIES[presetCat].items.map((item) => {
                      const selected = selectedPreset?.name === item.name;
                      const amps = wattsToAmps(item.watts);
                      const Icon = item.Icon;
                      return (
                        <button
                          key={item.name}
                          onClick={() => setSelectedPreset(selected ? null : item)}
                          className={`relative flex min-h-20 flex-[0_0_calc(33.333%-6px)] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center transition ${
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
                  {/* Each leg carries its own answer: what it holds now, what
                      it would hold after, and whether it can take the load at
                      all. A leg that would trip is disabled with the limit that
                      stops it named on the button, so the mistake can't be
                      tapped. The emptiest legal leg is labelled מומלץ — same
                      data the phase cards show, just brought to the decision. */}
                  <div className="mb-4">
                    <div className="mb-2 font-display text-sm font-bold text-zinc-600">לאיזה שקע מתחברים?</div>
                    <div className="mb-2 grid grid-cols-3 gap-2">
                      {legOptions.map((o) => {
                        const s = PHASE_STYLE[o.phase];
                        const selected = targetPhase === String(o.phase);
                        return (
                          <button
                            key={o.phase}
                            onClick={() => setTargetPhase(String(o.phase))}
                            disabled={!o.ok}
                            className={`relative rounded-xl pb-3 pt-5 text-center font-display text-white transition ${s.chipBg} ${
                              !o.ok
                                ? "opacity-40"
                                : selected
                                ? "ring-4 ring-zinc-900 ring-offset-2"
                                : o.phase === bestPhase
                                ? "ring-2 ring-inset ring-white/90"
                                : "opacity-80"
                            }`}
                          >
                            {o.ok && o.phase === bestPhase && (
                              <span className="absolute inset-x-1 top-1 rounded-md bg-white/95 py-0.5 text-[10px] font-black text-zinc-900">
                                מומלץ
                              </span>
                            )}
                            <div className="text-base font-black">{s.label}</div>
                            <div className="text-xs">{s.sub}</div>
                            <div className="mt-0.5 text-xs font-bold">
                              {o.ok ? `${fmt(o.before)} ← ${fmt(o.after)}A` : `✕ ${o.blocker}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Red stays — a 32A 5-pin socket is red by IEC 60309, and
                        matching the hardware is the whole point of the colour
                        coding here. But a full red FILL is also this app's
                        danger signal (#d32f2f vs red-600 #dc2626 are 9/255
                        apart), and the overload banner can be on screen at the
                        same moment meaning the opposite thing. So the red is
                        demoted from fill to identifier — a colour bar and a dot
                        on a white card, exactly how the phase cards in the main
                        list already carry their cable colour. Reads as a
                        different KIND of connection too, which it is: a
                        dedicated socket, not one of the three legs. */}
                    <button
                      onClick={() => setTargetPhase("3phase")}
                      disabled={!threePhaseVerdict.ok}
                      className={`w-full overflow-hidden rounded-xl border-2 bg-white text-right transition ${
                        !threePhaseVerdict.ok
                          ? "border-zinc-200 opacity-40"
                          : targetPhase === "3phase"
                          ? "border-zinc-900 ring-2 ring-zinc-900"
                          : "border-zinc-200"
                      }`}
                    >
                      <div className={`h-1.5 ${THREE_PHASE_STYLE.bar}`} />
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${THREE_PHASE_STYLE.dot}`} />
                          <span className="font-display text-base font-black text-zinc-900">{THREE_PHASE_STYLE.label}</span>
                          <span className="font-body text-xs text-zinc-400">{THREE_PHASE_STYLE.sub}</span>
                        </div>
                        <span className="font-body text-xs font-bold text-zinc-600">
                          {threePhaseVerdict.ok ? `+${fmt(threePhaseLegAmps)}A לכל פאזה` : "✕ לא נכנס"}
                        </span>
                      </div>
                    </button>
                  </div>

                </>
              )}
            </div>

            <div className="shrink-0 border-t-2 border-zinc-900 bg-white px-4 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-2">
              {/* No "pick a socket" hint here any more: the label above the
                  picker, the מומלץ badge and the button's own disabled text all
                  said it already, three times at once, and the extra 52px was
                  enough to push this button off the bottom of an iPhone. The
                  slot is now used only when it has something to add — that no
                  single leg can take this load, which nothing else shows. */}
              {noLegFits && !targetPhase && (
                <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-center font-body text-sm font-bold text-red-700">
                  ✕ אין פאזה בודדת שיכולה לקחת את העומס הזה
                </div>
              )}
              {evaluation && (
                <div className={`mb-2 rounded-xl px-3 py-2 text-center font-body text-sm font-bold ${evaluation.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {evaluation.ok ? evaluation.note : `✕ ${evaluation.reason}`}
                </div>
              )}
              {/* Quantity lives here, not as its own 92px card up in the
                  scrolling area. It modifies this action, so it belongs beside
                  it — and being in the sticky footer it stays reachable with
                  the keyboard open. Steppers stay 44px: this gets used with
                  work gloves on. The confirm button keeps the bottom bar's
                  geometry (rounded-xl / py-3 / text-base = 48px) so the same
                  primary action reads the same at both ends of the flow. */}
              <div className="flex items-stretch gap-2">
                <button
                  onClick={handleAdd}
                  disabled={!canAdd}
                  className={`flex-1 rounded-xl py-3 text-center font-display text-base font-black text-white transition ${
                    canAdd ? "bg-zinc-900 active:scale-[0.98]" : "bg-zinc-300"
                  }`}
                >
                  {!hasSelection ? "בחרו ציוד לחיבור" : !targetPhase ? "בחרו שקע לחיבור" : `חבר · ${fmt(totalRequested)}A`}
                </button>
                {/* Minus first, plus last — same DOM order as the original
                    quantity card, so the buttons stay where the hand already
                    expects them (RTL puts plus on the visual left). */}
                {hasSelection && (
                  <div className="flex shrink-0 items-center gap-1 rounded-xl bg-zinc-100 px-1">
                    <button
                      onClick={() => setQty((q) => Math.max(1, q - 1))}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-900 active:bg-zinc-200"
                      aria-label="הפחת יחידה"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="w-6 text-center font-display text-lg font-black tabular-nums">{qty}</span>
                    <button
                      onClick={() => setQty((q) => Math.min(50, q + 1))}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-900 active:bg-zinc-200"
                      aria-label="הוסף יחידה"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
