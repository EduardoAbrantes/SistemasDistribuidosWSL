import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent } from "react";

// ---------- Áudio ----------
// Todos os efeitos são sintetizados na hora com a Web Audio API,
// então o jogo não depende de nenhum arquivo de som externo.
function useSounds() {
  const ctxRef = useRef<AudioContext | null>(null);

  function ctx(): AudioContext {
    if (!ctxRef.current) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }

  function tone(freq: number, duration: number, opts?: { type?: OscillatorType; gain?: number; slideTo?: number }) {
    const audio = ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = opts?.type ?? "sine";
    osc.frequency.setValueAtTime(freq, audio.currentTime);
    if (opts?.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.slideTo, audio.currentTime + duration);
    }
    const peak = opts?.gain ?? 0.15;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(peak, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration + 0.02);
  }

  // estouro de ruído grave, usado no clique e no combo (mais forte no combo)
  function thump(duration: number, gainPeak: number, lowpassFreq: number) {
    const audio = ctx();
    const size = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, size, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);

    const src = audio.createBufferSource();
    src.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpassFreq;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(gainPeak, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);

    src.connect(filter).connect(gain).connect(audio.destination);
    src.start();
  }

  return {
    // som do clique: tom curto + um "corpo" de ruído grave por baixo, pra ficar mais encorpado
    click: useCallback(() => {
      const freq = 380 + Math.random() * 90;
      tone(freq, 0.09, { type: "triangle", gain: 0.2, slideTo: freq * 0.6 });
      thump(0.07, 0.12, 900);
    }, []),
    // "cha-ching" ao comprar uma melhoria
    buy: useCallback(() => {
      tone(660, 0.08, { type: "square", gain: 0.12 });
      setTimeout(() => tone(990, 0.12, { type: "square", gain: 0.12 }), 70);
    }, []),
    // fanfarra curta ao bater uma marca (100, 1000 cookies, etc.)
    milestone: useCallback(() => {
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => tone(f, 0.18, { type: "sine", gain: 0.16 }), i * 90)
      );
    }, []),
    // clique recusado (sem cookies suficientes)
    denied: useCallback(() => {
      tone(160, 0.15, { type: "sawtooth", gain: 0.1, slideTo: 90 });
    }, []),
    // impacto de combo a cada 10 cliques: golpe grave + um "rasgo" agudo descendente por cima
    combo: useCallback(() => {
      thump(0.35, 0.35, 500);
      tone(1200, 0.22, { type: "sawtooth", gain: 0.14, slideTo: 200 });
      setTimeout(() => tone(90, 0.2, { type: "square", gain: 0.2 }), 30);
    }, []),
  };
}

// ---------- Melhorias ----------
interface Upgrade {
  id: string;
  name: string;
  desc: string;
  baseCost: number;
  cps?: number; // cookies por segundo, se for produção automática
  clickBonus?: number; // some ao poder de clique, se for melhoria de clique
}

const UPGRADES: Upgrade[] = [
  { id: "cursor", name: "Cursor", desc: "+0.1 cookie/s", baseCost: 15, cps: 0.1 },
  { id: "grandma", name: "Vovó", desc: "+1 cookie/s", baseCost: 100, cps: 1 },
  { id: "farm", name: "Fazenda", desc: "+8 cookies/s", baseCost: 1100, cps: 8 },
  { id: "factory", name: "Fábrica", desc: "+47 cookies/s", baseCost: 12000, cps: 47 },
  { id: "finger", name: "Dedo de aço", desc: "+1 por clique", baseCost: 60, clickBonus: 1 },
  { id: "glove", name: "Luva turbo", desc: "+4 por clique", baseCost: 900, clickBonus: 4 },
];

// preço sobe ~15% a cada compra, como no clicker clássico
const priceOf = (u: Upgrade, owned: number) => Math.ceil(u.baseCost * Math.pow(1.15, owned));

interface State {
  cookies: number;
  totalEarned: number;
  clicks: number;
  owned: Record<string, number>;
  lastMilestone: number;
}

type Action =
  | { type: "click" }
  | { type: "tick"; dt: number }
  | { type: "buy"; id: string };

const MILESTONES = [50, 100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];

function initial(): State {
  return {
    cookies: 0,
    totalEarned: 0,
    clicks: 0,
    owned: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
    lastMilestone: -1,
  };
}

function clickPower(owned: Record<string, number>): number {
  return 1 + UPGRADES.reduce((sum, u) => sum + (u.clickBonus ?? 0) * (owned[u.id] ?? 0), 0);
}

function cps(owned: Record<string, number>): number {
  return UPGRADES.reduce((sum, u) => sum + (u.cps ?? 0) * (owned[u.id] ?? 0), 0);
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "click": {
      const gained = clickPower(s.owned);
      return { ...s, cookies: s.cookies + gained, totalEarned: s.totalEarned + gained, clicks: s.clicks + 1 };
    }
    case "tick": {
      const gained = cps(s.owned) * a.dt;
      if (gained <= 0) return s;
      return { ...s, cookies: s.cookies + gained, totalEarned: s.totalEarned + gained };
    }
    case "buy": {
      const upg = UPGRADES.find((u) => u.id === a.id);
      if (!upg) return s;
      const cost = priceOf(upg, s.owned[a.id] ?? 0);
      if (s.cookies < cost) return s;
      return {
        ...s,
        cookies: s.cookies - cost,
        owned: { ...s.owned, [a.id]: (s.owned[a.id] ?? 0) + 1 },
      };
    }
    default:
      return s;
  }
}

function fmt(n: number): string {
  if (n < 1000) return Math.floor(n).toString();
  const units = ["K", "M", "B", "T", "Qa", "Qi"];
  let v = n;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)}${units[i]}`;
}

interface Pop {
  id: number;
  x: number;
  y: number;
  value: number;
  combo: boolean;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const sounds = useSounds();
  const [pops, setPops] = useState<Pop[]>([]);
  const [bump, setBump] = useState(false);
  const [shake, setShake] = useState(false);
  const popId = useRef(0);
  const milestoneRef = useRef(-1);

  // produção automática das melhorias, a cada 100ms
  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: "tick", dt: 0.1 }), 100);
    return () => window.clearInterval(id);
  }, []);

  // toca a fanfarra quando o total ganho cruza uma marca, sem repetir a mesma marca
  useEffect(() => {
    const hit = [...MILESTONES].reverse().find((m) => state.totalEarned >= m);
    const idx = hit ? MILESTONES.indexOf(hit) : -1;
    if (idx > milestoneRef.current) {
      milestoneRef.current = idx;
      if (idx >= 0) sounds.milestone();
    }
  }, [state.totalEarned, sounds]);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    dispatch({ type: "click" });
    const combo = (state.clicks + 1) % 10 === 0;
    if (combo) {
      sounds.combo();
      setShake(true);
      setTimeout(() => setShake(false), 300);
    } else {
      sounds.click();
    }
    setBump(true);
    setTimeout(() => setBump(false), 90);

    const rect = e.currentTarget.getBoundingClientRect();
    const id = popId.current++;
    const pop: Pop = {
      id,
      x: e.clientX - rect.left + (Math.random() - 0.5) * 30,
      y: e.clientY - rect.top,
      value: clickPower(state.owned),
      combo,
    };
    setPops((prev: Pop[]) => [...prev, pop]);
    setTimeout(() => setPops((prev: Pop[]) => prev.filter((p) => p.id !== id)), 700);
  }

  function buy(id: string) {
    const upg = UPGRADES.find((u) => u.id === id)!;
    const cost = priceOf(upg, state.owned[id] ?? 0);
    if (state.cookies < cost) {
      sounds.denied();
      return;
    }
    dispatch({ type: "buy", id });
    sounds.buy();
  }

  return (
    <main
      className={
        "min-h-screen bg-amber-50 px-4 py-8 text-amber-950 " +
        (shake ? "motion-safe:animate-[shake_0.3s_ease-in-out]" : "")
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-center">
        <section className="flex flex-col items-center gap-4">
          <h1 className="text-3xl font-bold tracking-tight">🍪 Cookie Clicker</h1>
          <div className="text-center">
            <div className="text-4xl font-extrabold tabular-nums">{fmt(state.cookies)}</div>
            <div className="text-sm text-amber-700">cookies · {fmt(cps(state.owned))}/s</div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={handleClick}
              aria-label="Clicar no cookie"
              className={
                "select-none rounded-full text-8xl leading-none drop-shadow-lg transition-transform " +
                (bump ? "scale-95" : "scale-100 hover:scale-105")
              }
            >
              🍪
            </button>
            {pops.map((p) => (
              <span
                key={p.id}
                className={
                  "pointer-events-none absolute select-none font-bold motion-safe:animate-[float_0.7s_ease-out_forwards] " +
                  (p.combo ? "text-2xl text-red-600" : "text-lg text-amber-700")
                }
                style={{ left: p.x, top: p.y }}
              >
                +{fmt(p.value)}
                {p.combo && " 💥"}
              </span>
            ))}
          </div>

          <p className="text-sm text-amber-700">
            {fmt(state.clicks)} cliques · +{fmt(clickPower(state.owned))} por clique
          </p>
        </section>

        <section className="w-full max-w-xs">
          <h2 className="mb-2 text-lg font-semibold">Loja</h2>
          <ul className="flex flex-col gap-2">
            {UPGRADES.map((u) => {
              const owned = state.owned[u.id] ?? 0;
              const cost = priceOf(u, owned);
              const canAfford = state.cookies >= cost;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => buy(u.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg border-b-4 px-3 py-2 text-left shadow-sm transition active:translate-y-0.5 " +
                      (canAfford
                        ? "border-amber-600 bg-amber-200 hover:bg-amber-300"
                        : "border-amber-200 bg-amber-100/60 opacity-70")
                    }
                  >
                    <span>
                      <span className="block font-semibold">
                        {u.name} <span className="font-normal text-amber-700">×{owned}</span>
                      </span>
                      <span className="block text-xs text-amber-700">{u.desc}</span>
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-sm">{fmt(cost)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <style>{`
        @keyframes float {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(-40px); opacity: 0; }
        }
        @keyframes shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-6px, 3px); }
          40% { transform: translate(6px, -3px); }
          60% { transform: translate(-4px, -2px); }
          80% { transform: translate(4px, 2px); }
        }
      `}</style>
    </main>
  );
}