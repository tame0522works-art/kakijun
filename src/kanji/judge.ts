// 書いた1画を、手本の「次に書く画」と比べて判定する。座標はすべて KanjiVG の 109×109 の枠。
//
// 比べ方: 両方の線を道のりで等間隔な N 点に打ち直し、i 番目の点どうしの距離の平均をとる（fwd）。
// 書いた線を逆からたどった距離（rev）も見て、そちらが小さければ向きが逆とわかる。
// 次の画に合わなければ、まだ書いていない画とも比べ、合えば書き順違いとする。
import { flattenPath, polylineLength, resample, type Point } from './path.ts'
import type { Stroke } from './types.ts'

const N = 32

/** 点の平均距離がこれ以下なら合っている。枠の約 1 割 */
export const OK = 10
/** これ以下なら「惜しい」（その画として受け取り、ずれを伝える）。枠の約 1.6 割 */
export const CLOSE = 18
/** これより短い画（点）は向きを問わない。手で書く点は短く、向きが安定しないため */
const DOT = 15
/** 位置・長さ・形のずれを指摘する目安 */
const SHIFT = 7
const SHAPE = 8
const SHORT = 0.7
const LONG = 1.4

export interface Target {
  pts: Point[]
  len: number
  center: Point
}

export function prepare(strokes: readonly Stroke[]): Target[] {
  return strokes.map((s) => {
    const raw = flattenPath(s.d)
    const pts = resample(raw, N)
    return { pts, len: polylineLength(raw), center: centerOf(pts) }
  })
}

export type Issue =
  | { kind: 'shift'; dx: number; dy: number }
  | { kind: 'short' }
  | { kind: 'long' }
  | { kind: 'shape' }

export type Verdict =
  /** 受け取る。issues が空なら合格、あれば「惜しい」 */
  | { kind: 'ok'; issues: Issue[]; score: number }
  /** 向きが逆 */
  | { kind: 'direction'; score: number }
  /** まだ書いていない別の画（matched 番目、0 始まり）を書いた */
  | { kind: 'order'; matched: number; score: number }
  /** どの画にも合わない */
  | { kind: 'miss'; issues: Issue[]; score: number }

function centerOf(pts: readonly Point[]): Point {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

function meanDist(a: readonly Point[], b: readonly Point[], reverse = false, dx = 0, dy = 0): number {
  let sum = 0
  for (let i = 0; i < N; i++) {
    const q = b[reverse ? N - 1 - i : i]
    sum += Math.hypot(a[i][0] - dx - q[0], a[i][1] - dy - q[1])
  }
  return sum / N
}

interface Compared {
  fwd: number
  rev: number
  issues: Issue[]
}

function compare(user: readonly Point[], userLen: number, t: Target): Compared {
  const c = centerOf(user)
  const dx = c[0] - t.center[0]
  const dy = c[1] - t.center[1]
  const issues: Issue[] = []
  if (Math.hypot(dx, dy) > SHIFT) issues.push({ kind: 'shift', dx, dy })
  // 点は長さを問わない（押しただけの点も、少し引いた点も同じ点として扱う）
  if (t.len >= DOT) {
    const ratio = userLen / t.len
    if (ratio < SHORT) issues.push({ kind: 'short' })
    else if (ratio > LONG) issues.push({ kind: 'long' })
  }
  // 位置のずれを除いた形の違い
  if (meanDist(user, t.pts, false, dx, dy) > SHAPE) issues.push({ kind: 'shape' })
  return { fwd: meanDist(user, t.pts), rev: meanDist(user, t.pts, true), issues }
}

/**
 * @param drawn 書いた線の点（枠の座標）
 * @param targets prepare() の結果
 * @param index 次に書くはずの画（0 始まり）。これより前の画は書き終わっている
 */
export function judge(drawn: readonly Point[], targets: readonly Target[], index: number): Verdict {
  const user = resample(drawn, N)
  const userLen = polylineLength(drawn)
  const t = targets[index]
  const cur = compare(user, userLen, t)
  // 点は向きを問わないので、近いほうの向きで測る
  const score = t.len < DOT ? Math.min(cur.fwd, cur.rev) : cur.fwd

  if (score <= OK) return { kind: 'ok', issues: [], score }

  // 次の画にはっきり合わないときだけ、ほかの画を探す。合格の基準（OK）で合う画があれば書き順違い。
  // 向きより先に見る: 竹の1画目（ノ）の代わりに2画目（横）を書くと、横はノを逆にたどった線にも近くなる
  let best = -1
  let bestScore = Infinity
  for (let j = index + 1; j < targets.length; j++) {
    const o = targets[j]
    const d = meanDist(user, o.pts)
    const s = o.len < DOT ? Math.min(d, meanDist(user, o.pts, true)) : d
    if (s < bestScore) {
      best = j
      bestScore = s
    }
  }
  const reversed = t.len >= DOT && cur.rev <= CLOSE && cur.rev < cur.fwd
  if (best >= 0 && bestScore <= OK && bestScore < (reversed ? cur.rev : score)) return { kind: 'order', matched: best, score: bestScore }
  if (reversed) return { kind: 'direction', score: cur.rev }

  if (score <= CLOSE) return { kind: 'ok', issues: cur.issues.length ? cur.issues : [{ kind: 'shape' }], score }
  return { kind: 'miss', issues: cur.issues, score }
}
