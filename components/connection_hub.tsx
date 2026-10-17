"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ProviderId = "github" | "linkedin";
type Status = "idle" | "connecting" | "connected" | "error";

export interface ConnectResult {
  /** Optional: what you fetched, shown under the rail (e.g. "24 repos") */
  summary?: string;
}

interface ConnectionHubProps {
  /** Runs when a node is clicked. Do your OAuth / fetch here. Throw to show an error. */
  onConnect?: (id: ProviderId) => Promise<ConnectResult | void>;
  onDisconnect?: (id: ProviderId) => void;
  /** Already-connected providers (e.g. from /api/connections) shown as live on load */
  initial?: Partial<Record<ProviderId, { since: number; summary?: string }>>;
  /** Center node content (defaults to "="). Pass an avatar / initials. */
  hubContent?: React.ReactNode;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Geometry — everything lives in a 720 x 280 box that scales          */
/* ------------------------------------------------------------------ */

const W = 720;
const H = 280;
const HUB = { x: 360, y: 150 };
const TOP_Y = 70;

const PROVIDERS: Record<
  ProviderId,
  {
    label: string;
    x: number;
    y: number;
    color: string;
    main: string; // node -> hub (data)
    top: string; // node -> top rail -> hub (handshake)
    chipX: number;
    icon: React.ReactNode;
  }
> = {
  github: {
    label: "GitHub",
    x: 100,
    y: 150,
    color: "#e6edf3",
    main: `M100 150 H${HUB.x}`,
    top: `M100 150 V${TOP_Y} H${HUB.x} V${HUB.y}`,
    chipX: 230,
    icon: <GitHubIcon />,
  },
  linkedin: {
    label: "LinkedIn",
    x: 620,
    y: 150,
    color: "#2f8cff",
    main: `M620 150 H${HUB.x}`,
    top: `M620 150 V${TOP_Y} H${HUB.x} V${HUB.y}`,
    chipX: 490,
    icon: <LinkedInIcon />,
  },
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/* ------------------------------------------------------------------ */
/* Hook: elapsed timer                                                 */
/* ------------------------------------------------------------------ */

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

const defaultConnect = () =>
  new Promise<ConnectResult>((r) => setTimeout(() => r({}), 1600));

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ConnectionHub({
  onConnect = defaultConnect,
  onDisconnect,
  initial,
  hubContent,
  className,
}: ConnectionHubProps) {
  const [state, setState] = React.useState<
    Record<
      ProviderId,
      { status: Status; since?: number; latency?: number; summary?: string; error?: string }
    >
  >({
    github: { status: "idle" },
    linkedin: { status: "idle" },
  });
  const [flash, setFlash] = React.useState(0);

  // hydrate connections that already exist server-side
  React.useEffect(() => {
    if (!initial) return;
    setState((s) => {
      const next = { ...s };
      (Object.keys(initial) as ProviderId[]).forEach((id) => {
        const c = initial[id];
        if (c && next[id].status === "idle") next[id] = { status: "connected", since: c.since, summary: c.summary };
      });
      return next;
    });
  }, [initial]);

  const anyLive = Object.values(state).some((s) => s.status === "connected");
  const now = useNow(anyLive);

  async function toggle(id: ProviderId) {
    const cur = state[id];
    if (cur.status === "connecting") return;

    if (cur.status === "connected") {
      setState((s) => ({ ...s, [id]: { status: "idle" } }));
      onDisconnect?.(id);
      return;
    }

    setState((s) => ({ ...s, [id]: { status: "connecting" } }));
    try {
      // time the real request, but keep the animation readable even if it's instant
      let latency = 0;
      const timed = (async () => {
        const t0 = performance.now();
        const r = await onConnect(id);
        latency = Math.round(performance.now() - t0);
        return r;
      })();
      const [res] = await Promise.all([timed, new Promise((r) => setTimeout(r, 1300))]);
      setState((s) => ({
        ...s,
        [id]: {
          status: "connected",
          since: Date.now(),
          latency,
          summary: (res as ConnectResult | void)?.summary,
        },
      }));
      setFlash((f) => f + 1);
    } catch (e) {
      setState((s) => ({
        ...s,
        [id]: { status: "error", error: e instanceof Error ? e.message : "Failed" },
      }));
    }
  }

  return (
    <div
      className={cn("relative mx-auto w-full max-w-3xl select-none", className)}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {/* ---------------- Rails ---------------- */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <filter id="hub-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* base rails */}
        {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
          <g key={id} className="text-zinc-700/70">
            <path d={PROVIDERS[id].top} fill="none" stroke="currentColor" strokeWidth={4} />
            <path d={PROVIDERS[id].main} fill="none" stroke="currentColor" strokeWidth={4} />
          </g>
        ))}

        {/* ticks */}
        {[160, 200, 290, 430, 520, 560].map((x) => (
          <g key={x} className="text-zinc-600">
            <line x1={x} x2={x} y1={TOP_Y - 5} y2={TOP_Y + 5} stroke="currentColor" />
            <line x1={x} x2={x} y1={HUB.y - 5} y2={HUB.y + 5} stroke="currentColor" />
          </g>
        ))}

        {/* active overlays per provider */}
        {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
          <ProviderRails key={id} id={id} status={state[id].status} />
        ))}
      </svg>

      {/* ---------------- Chips on the top rail ---------------- */}
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
        const p = PROVIDERS[id];
        const s = state[id];
        return (
          <div
            key={id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-950"
            style={{ left: pct(p.chipX, W), top: pct(TOP_Y, H) }}
          >
            <motion.div
              layout
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[9px] whitespace-nowrap sm:px-3 sm:py-1 sm:text-xs",
                s.status === "connected"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : s.status === "connecting"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : s.status === "error"
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400",
              )}
            >
              <span className="hidden sm:inline">{p.label} · </span>
              {s.status === "connected" && s.since
                ? `live ${fmt(now - s.since)}`
                : s.status === "connecting"
                  ? "handshake…"
                  : s.status === "error"
                    ? "retry"
                    : "offline"}
            </motion.div>
          </div>
        );
      })}

      {/* ---------------- Captions under main rail ---------------- */}
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
        const p = PROVIDERS[id];
        const s = state[id];
        return (
          <div
            key={id}
            className="absolute hidden -translate-x-1/2 text-center text-[13px] leading-tight text-zinc-400 sm:block"
            style={{ left: pct(p.chipX, W), top: pct(HUB.y + 18, H) }}
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={s.status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="whitespace-nowrap"
              >
                {s.status === "connected"
                  ? (s.summary ?? "Fresh from the source")
                  : s.status === "connecting"
                    ? "Authorizing…"
                    : s.status === "error"
                      ? (s.error ?? "Connection failed")
                      : "Tap to connect"}
                {s.status === "connected" && s.latency != null && (
                  <span className="mt-0.5 block font-mono text-zinc-500">{s.latency} ms</span>
                )}
              </motion.p>
            </AnimatePresence>
          </div>
        );
      })}

      {/* ---------------- Provider nodes ---------------- */}
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
        <ProviderNode key={id} id={id} status={state[id].status} onClick={() => toggle(id)} />
      ))}

      {/* ---------------- Hub ---------------- */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: pct(HUB.x, W), top: pct(HUB.y, H), width: pct(64, W) }}
      >
        {/* flash ring on each successful connect */}
        <AnimatePresence>
          {flash > 0 && (
            <motion.span
              key={flash}
              className="absolute inset-0 rounded-2xl border-2 border-indigo-400"
              initial={{ scale: 1, opacity: 0.9 }}
              animate={{ scale: 1.9, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        <motion.div
          key={`hub-${flash}`}
          initial={flash ? { scale: 1.14 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 14 }}
          className={cn(
            "grid aspect-square w-full place-items-center rounded-2xl bg-gradient-to-b from-indigo-400 to-indigo-600 text-white transition-shadow duration-500",
            anyLive ? "shadow-[0_0_40px_rgba(99,102,241,.55)]" : "shadow-[0_8px_24px_rgba(0,0,0,.5)]",
          )}
        >
          {hubContent ?? <span className="text-xl font-bold sm:text-3xl">=</span>}
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rails: draw-in on connect, packets while connected, retract on off  */
/* ------------------------------------------------------------------ */

function ProviderRails({ id, status }: { id: ProviderId; status: Status }) {
  const p = PROVIDERS[id];
  const on = status === "connecting" || status === "connected";

  return (
    <g>
      {/* handshake rail (top) draws first */}
      <motion.path
        d={p.top}
        fill="none"
        stroke="#6366f1"
        strokeWidth={4}
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ duration: on ? 0.9 : 0.4, ease: "easeInOut" }}
      />
      {/* data rail (main) draws after */}
      <motion.path
        d={p.main}
        fill="none"
        stroke={status === "connected" ? p.color : "#6366f1"}
        strokeOpacity={status === "connected" ? 0.55 : 1}
        strokeWidth={4}
        strokeLinecap="round"
        initial={false}
        animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
        transition={{ duration: on ? 0.7 : 0.4, delay: on ? 0.5 : 0, ease: "easeInOut" }}
      />

      {/* comet running along the handshake rail while connecting */}
      {status === "connecting" && (
        <circle r={5} fill="#a5b4fc" filter="url(#hub-glow)">
          <animateMotion dur="0.9s" repeatCount="indefinite" path={p.top} />
        </circle>
      )}

      {/* data packets flowing into the hub once connected */}
      {status === "connected" &&
        [0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={-6}
            y={-2}
            width={12}
            height={4}
            rx={2}
            fill={p.color}
            style={{ filter: `drop-shadow(0 0 4px ${p.color})` }}
          >
            <animateMotion
              dur="1.6s"
              begin={`${i * 0.4}s`}
              repeatCount="indefinite"
              path={p.main}
              rotate="auto"
            />
          </rect>
        ))}

      {/* heartbeat going back out on the top rail */}
      {status === "connected" && (
        <circle r={3.5} fill="#a5b4fc">
          <animateMotion
            dur="2.4s"
            repeatCount="indefinite"
            path={p.top}
            keyPoints="1;0"
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Node                                                                */
/* ------------------------------------------------------------------ */

function ProviderNode({
  id,
  status,
  onClick,
}: {
  id: ProviderId;
  status: Status;
  onClick: () => void;
}) {
  const p = PROVIDERS[id];
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: pct(p.x, W), top: pct(p.y, H), width: pct(56, W) }}
    >
      {/* ripple while connecting */}
      {status === "connecting" &&
        [0, 0.5].map((d) => (
          <motion.span
            key={d}
            className="absolute inset-0 rounded-xl border border-indigo-400"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1, repeat: Infinity, delay: d, ease: "easeOut" }}
          />
        ))}

      <motion.button
        type="button"
        onClick={onClick}
        aria-label={`${status === "connected" ? "Disconnect" : "Connect"} ${p.label}`}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          "relative grid aspect-square w-full cursor-pointer place-items-center rounded-xl border bg-zinc-900 shadow-[0_6px_18px_rgba(0,0,0,.5)] transition-colors",
          "focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none",
          status === "connected"
            ? "border-indigo-500/50"
            : status === "error"
              ? "border-red-500/50"
              : "border-zinc-800 hover:border-zinc-600",
        )}
      >
        <span className="w-1/2">{p.icon}</span>

        {/* status dot */}
        <motion.span
          className={cn(
            "absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-zinc-950 sm:size-3",
            status === "connected" && "bg-emerald-400 shadow-[0_0_8px_#34d399]",
            status === "connecting" && "bg-amber-400",
            status === "error" && "bg-red-500",
            status === "idle" && "bg-zinc-600",
          )}
          animate={status === "connected" ? { scale: [1, 1.5, 1] } : { scale: 1 }}
          transition={{ duration: 0.5 }}
        />
      </motion.button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#fff" className="h-full w-full" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#0a66c2" className="h-full w-full" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.82 1.637-1.87 3.37-1.87 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}