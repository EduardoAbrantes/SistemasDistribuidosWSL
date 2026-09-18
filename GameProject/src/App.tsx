import { useEffect, useReducer } from "react";

const W = 10;
const H = 20;

type Kind = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = Kind | null;
type Board = Cell[][];
type Status = "idle" | "playing" | "paused" | "over";

interface Piece {
  kind: Kind;
  rot: number;
  x: number; // coluna do canto esquerdo da matriz da peça
  y: number; // linha do topo da matriz da peça
}

interface State {
  board: Board;
  piece: Piece;
  next: Kind;
  hold: Kind | null;
  canHold: boolean; // só pode guardar uma vez por peça
  bag: Kind[];
  score: number;
  lines: number;
  best: number;
  status: Status;
}

type Action =
  | { type: "start" }
  | { type: "tick" }
  | { type: "move"; dx: -1 | 1 }
  | { type: "rotate" }
  | { type: "soft" }
  | { type: "hard" }
  | { type: "hold" }
  | { type: "pause" };

const KINDS: Kind[] = ["I", "O", "T", "S", "Z", "J", "L"];

const BASE: Record<Kind, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

// Classes escritas por extenso para o Tailwind conseguir enxergá-las
const FILL: Record<Kind, string> = {
  I: "rounded-sm ring-1 ring-inset ring-white/30 bg-cyan-400",
  O: "rounded-sm ring-1 ring-inset ring-white/30 bg-yellow-400",
  T: "rounded-sm ring-1 ring-inset ring-white/30 bg-purple-500",
  S: "rounded-sm ring-1 ring-inset ring-white/30 bg-green-500",
  Z: "rounded-sm ring-1 ring-inset ring-white/30 bg-red-500",
  J: "rounded-sm ring-1 ring-inset ring-white/30 bg-blue-500",
  L: "rounded-sm ring-1 ring-inset ring-white/30 bg-orange-500",
};

const GHOST: Record<Kind, string> = {
  I: "rounded-sm ring-1 ring-inset ring-cyan-400/60",
  O: "rounded-sm ring-1 ring-inset ring-yellow-400/60",
  T: "rounded-sm ring-1 ring-inset ring-purple-500/60",
  S: "rounded-sm ring-1 ring-inset ring-green-500/60",
  Z: "rounded-sm ring-1 ring-inset ring-red-500/60",
  J: "rounded-sm ring-1 ring-inset ring-blue-500/60",
  L: "rounded-sm ring-1 ring-inset ring-orange-500/60",
};

const EMPTY = "bg-slate-800/70";
const LINE_POINTS = [0, 100, 300, 500, 800];

function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  return m.map((_row, r) => m.map((_cell, c) => m[n - 1 - c][r]));
}

function buildRotations(m: number[][]): number[][][] {
  const out = [m];
  for (let i = 1; i < 4; i++) out.push(rotateCW(out[i - 1]));
  return out;
}

const ROTATIONS = Object.fromEntries(
  KINDS.map((k) => [k, buildRotations(BASE[k])])
) as Record<Kind, number[][][]>;

function cellsOf(p: Piece): [number, number][] {
  const shape = ROTATIONS[p.kind][p.rot % 4];
  const out: [number, number][] = [];
  shape.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v) out.push([p.y + r, p.x + c]);
    })
  );
  return out;
}

function collides(board: Board, p: Piece): boolean {
  return cellsOf(p).some(
    ([r, c]) => c < 0 || c >= W || r < 0 || r >= H || board[r][c] !== null
  );
}

function ghostOf(board: Board, p: Piece): Piece {
  let g = p;
  while (!collides(board, { ...g, y: g.y + 1 })) g = { ...g, y: g.y + 1 };
  return g;
}

const emptyRow = (): Cell[] => Array.from({ length: W }, () => null);
const emptyBoard = (): Board => Array.from({ length: H }, emptyRow);

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

// "Saco" de 7 peças: todas aparecem uma vez antes de repetir
function draw(bag: Kind[]): [Kind, Kind[]] {
  const pool = bag.length > 0 ? bag : shuffle(KINDS);
  return [pool[0], pool.slice(1)];
}

function spawn(kind: Kind): Piece {
  return { kind, rot: 0, x: kind === "O" ? 4 : 3, y: 0 };
}

function newGame(best: number, status: Status): State {
  const [first, bag1] = draw([]);
  const [next, bag2] = draw(bag1);
  return {
    board: emptyBoard(),
    piece: spawn(first),
    next,
    hold: null,
    canHold: true,
    bag: bag2,
    score: 0,
    lines: 0,
    best,
    status,
  };
}

const levelOf = (lines: number) => Math.floor(lines / 10) + 1;

function lockPiece(s: State, bonus: number): State {
  const board = s.board.map((row) => [...row]);
  for (const [r, c] of cellsOf(s.piece)) board[r][c] = s.piece.kind;

  const kept = board.filter((row) => row.some((c) => c === null));
  const cleared = H - kept.length;
  const newBoard = [...Array.from({ length: cleared }, emptyRow), ...kept];

  const score = s.score + bonus + LINE_POINTS[cleared] * levelOf(s.lines);
  const lines = s.lines + cleared;

  const [next, bag] = draw(s.bag);
  const piece = spawn(s.next);
  const over = collides(newBoard, piece);

  return {
    ...s,
    board: newBoard,
    piece,
    next,
    bag,
    canHold: true,
    score,
    lines,
    best: over ? Math.max(s.best, score) : s.best,
    status: over ? "over" : "playing",
  };
}

function reducer(s: State, a: Action): State {
  if (a.type === "start") return newGame(s.best, "playing");
  if (a.type === "pause") {
    if (s.status === "playing") return { ...s, status: "paused" };
    if (s.status === "paused") return { ...s, status: "playing" };
    return s;
  }
  if (s.status !== "playing") return s;

  switch (a.type) {
    case "move": {
      const moved = { ...s.piece, x: s.piece.x + a.dx };
      return collides(s.board, moved) ? s : { ...s, piece: moved };
    }
    case "rotate": {
      const rot = (s.piece.rot + 1) % 4;
      // tenta girar; se bater na parede ou em blocos, tenta deslocar um pouco
      for (const dx of [0, -1, 1, -2, 2]) {
        const t = { ...s.piece, rot, x: s.piece.x + dx };
        if (!collides(s.board, t)) return { ...s, piece: t };
      }
      return s;
    }
    case "soft": {
      const down = { ...s.piece, y: s.piece.y + 1 };
      if (collides(s.board, down)) return s;
      return { ...s, piece: down, score: s.score + 1 };
    }
    case "tick": {
      const down = { ...s.piece, y: s.piece.y + 1 };
      if (!collides(s.board, down)) return { ...s, piece: down };
      return lockPiece(s, 0);
    }
    case "hold": {
      if (!s.canHold) return s;
      // primeira vez: pega a próxima da fila; depois: troca com a peça guardada
      const [next, bag] = s.hold === null ? draw(s.bag) : ([s.next, s.bag] as [Kind, Kind[]]);
      const piece = spawn(s.hold ?? s.next);
      const over = collides(s.board, piece);
      return {
        ...s,
        piece,
        hold: s.piece.kind,
        canHold: false,
        next,
        bag,
        best: over ? Math.max(s.best, s.score) : s.best,
        status: over ? "over" : "playing",
      };
    }
    case "hard": {
      const landed = ghostOf(s.board, s.piece);
      return lockPiece({ ...s, piece: landed }, (landed.y - s.piece.y) * 2);
    }
    default:
      return s;
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-sky-100">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Preview({ kind }: { kind: Kind | null }) {
  const shape: number[][] = kind ? ROTATIONS[kind][0] : [];
  return (
    <div className="grid w-20 grid-cols-4 gap-px rounded-lg bg-slate-900 p-1.5">
      {Array.from({ length: 16 }, (_, i) => {
        const on = shape[Math.floor(i / 4)]?.[i % 4] === 1;
        return <div key={i} className={"aspect-square " + (on && kind ? FILL[kind] : EMPTY)} />;
      })}
    </div>
  );
}

function TouchButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className="h-12 w-12 rounded-lg bg-white text-xl font-semibold shadow-sm ring-1 ring-sky-200 active:bg-sky-100"
    >
      {icon}
    </button>
  );
}

const KEYS: [string, string][] = [
  ["← →", "mover"],
  ["↑", "girar"],
  ["↓", "descer"],
  ["X / Espaço", "queda direta"],
  ["C", "guardar peça"],
  ["P", "pausar"],
];

// Teclas que continuam agindo enquanto estão seguradas:
// espera `delay` ms e depois repete a cada `rate` ms
const REPEAT: Record<string, { action: Action; delay: number; rate: number }> = {
  ArrowLeft: { action: { type: "move", dx: -1 }, delay: 160, rate: 45 },
  ArrowRight: { action: { type: "move", dx: 1 }, delay: 160, rate: 45 },
  ArrowDown: { action: { type: "soft" }, delay: 0, rate: 45 },
};

// Teclas de ação única (segurar não repete)
const ONCE: Record<string, Action> = {
  ArrowUp: { type: "rotate" },
  x: { type: "hard" },
  X: { type: "hard" },
  " ": { type: "hard" },
  c: { type: "hold" },
  C: { type: "hold" },
  p: { type: "pause" },
  P: { type: "pause" },
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => newGame(0, "idle"));

  const level = levelOf(state.lines);
  const speed = Math.max(100, 800 - (level - 1) * 70);

  // gravidade: a peça desce sozinha, cada vez mais rápido
  useEffect(() => {
    if (state.status !== "playing") return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), speed);
    return () => window.clearInterval(id);
  }, [state.status, speed]);

  // teclado
  useEffect(() => {
    const timers = new Map<string, { delay?: number; interval?: number }>();

    function stop(key: string) {
      const t = timers.get(key);
      if (!t) return;
      window.clearTimeout(t.delay);
      window.clearInterval(t.interval);
      timers.delete(key);
    }

    function stopAll() {
      for (const key of [...timers.keys()]) stop(key);
    }

    function onKeyDown(e: KeyboardEvent) {
      const rep = REPEAT[e.key];
      if (rep) {
        e.preventDefault();
        if (e.repeat || timers.has(e.key)) return; // a repetição é feita pelo nosso timer
        // esquerda e direita não brigam entre si
        if (e.key === "ArrowLeft") stop("ArrowRight");
        if (e.key === "ArrowRight") stop("ArrowLeft");
        dispatch(rep.action);
        const t: { delay?: number; interval?: number } = {};
        t.delay = window.setTimeout(() => {
          t.interval = window.setInterval(() => dispatch(rep.action), rep.rate);
        }, rep.delay);
        timers.set(e.key, t);
        return;
      }
      const once = ONCE[e.key];
      if (once) {
        e.preventDefault();
        if (!e.repeat) dispatch(once);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      stop(e.key);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stopAll); // perdeu o foco: solta todas as teclas
    return () => {
      stopAll();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stopAll);
    };
  }, []);

  // monta o que aparece na tela: tabuleiro + sombra + peça atual
  const shown: ({ kind: Kind; ghost: boolean } | null)[][] = state.board.map((row) =>
    row.map((c) => (c ? { kind: c, ghost: false } : null))
  );
  if (state.status === "playing" || state.status === "paused") {
    for (const [r, c] of cellsOf(ghostOf(state.board, state.piece))) {
      shown[r][c] = { kind: state.piece.kind, ghost: true };
    }
    for (const [r, c] of cellsOf(state.piece)) {
      shown[r][c] = { kind: state.piece.kind, ghost: false };
    }
  }

  const buttonClass =
    "rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-sky-50 px-4 py-8 text-slate-900">
      <h1 className="text-3xl font-bold tracking-tight">Tetris</h1>

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className="relative w-64 overflow-hidden rounded-xl bg-slate-900 p-1.5 shadow-lg sm:w-72">
          <div className="grid grid-cols-10 gap-px">
            {shown.flat().map((cell, i) => (
              <div
                key={i}
                className={
                  "aspect-square " +
                  (cell ? (cell.ghost ? GHOST[cell.kind] : FILL[cell.kind]) : EMPTY)
                }
              />
            ))}
          </div>

          {state.status !== "playing" && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/85 text-center text-white"
            >
              {state.status === "idle" && (
                <>
                  <p className="text-lg font-semibold">Pronto para jogar?</p>
                  <button type="button" className={buttonClass} onClick={() => dispatch({ type: "start" })}>
                    Iniciar
                  </button>
                </>
              )}
              {state.status === "paused" && (
                <>
                  <p className="text-lg font-semibold">Jogo pausado</p>
                  <button type="button" className={buttonClass} onClick={() => dispatch({ type: "pause" })}>
                    Continuar
                  </button>
                </>
              )}
              {state.status === "over" && (
                <>
                  <p className="text-lg font-semibold">Fim de jogo</p>
                  <p className="text-sm text-slate-300">
                    Você fez {state.score} pontos em {state.lines} linhas.
                  </p>
                  <button type="button" className={buttonClass} onClick={() => dispatch({ type: "start" })}>
                    Jogar de novo
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="flex w-64 flex-col gap-3 sm:w-52">
          <div className="flex gap-3">
            <div>
              <div className="mb-1 text-sm text-slate-600">Próxima</div>
              <Preview kind={state.next} />
            </div>
            <div className={state.canHold ? "" : "opacity-50"}>
              <div className="mb-1 text-sm text-slate-600">Guardada</div>
              <Preview kind={state.hold} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
            <Stat label="Pontos" value={state.score} />
            <Stat label="Linhas" value={state.lines} />
            <Stat label="Nível" value={level} />
            <Stat label="Recorde" value={state.best} />
          </div>
          <dl className="hidden gap-1 text-sm text-slate-600 sm:grid">
            {KEYS.map(([key, what]) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="font-mono text-slate-800">{key}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="flex gap-2 sm:hidden">
        <TouchButton label="Mover para a esquerda" icon="◀" onPress={() => dispatch({ type: "move", dx: -1 })} />
        <TouchButton label="Girar" icon="⟳" onPress={() => dispatch({ type: "rotate" })} />
        <TouchButton label="Mover para a direita" icon="▶" onPress={() => dispatch({ type: "move", dx: 1 })} />
        <TouchButton label="Descer" icon="▼" onPress={() => dispatch({ type: "soft" })} />
        <TouchButton label="Queda direta" icon="⤓" onPress={() => dispatch({ type: "hard" })} />
        <TouchButton label="Guardar peça" icon="⇄" onPress={() => dispatch({ type: "hold" })} />
      </div>
    </main>
  );
}