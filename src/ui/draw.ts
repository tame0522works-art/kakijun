// 書く欄の描画。座標は KanjiVG の 109×109 の枠で持ち、描くときに canvas の大きさへ拡大する。
import { BOX, flattenPath, polylineLength, type Point } from '../kanji/path.ts'
import type { Stroke } from '../kanji/types.ts'

export interface Ink {
  pts: Point[]
  close?: boolean
}

/** お手本の動き。all は全部の画を順に、index はその画だけ */
export type Hint = { at: number } & ({ all: true } | { index: number })

export interface Scene {
  strokes: readonly Stroke[]
  inks: readonly Ink[]
  /** いま書いている線 */
  live: readonly Point[] | null
  /** 受け取らなかった線。少しのあいだ赤で見せて消す */
  flash: (Ink & { at: number }) | null
  hint: Hint | null
  guide: boolean
}

/** 1画を描き終えるまでの時間と、次の画までの間 */
const STROKE_MS = 650
const GAP_MS = 180
/** 1画だけのお手本は、描き終えてからしばらく残す */
const HOLD_MS = 1400
export const FLASH_MS = 1100

const MODEL_WIDTH = 3.4
const INK_WIDTH = 3.6

const pathCache = new Map<string, { path: Path2D; len: number; start: Point }>()
function modelPath(s: Stroke) {
  let p = pathCache.get(s.d)
  if (!p) {
    const pts = flattenPath(s.d)
    p = { path: new Path2D(s.d), len: polylineLength(pts), start: pts[0] }
    pathCache.set(s.d, p)
  }
  return p
}

/** 動きが続いているあいだは true（呼ぶ側が次のフレームを頼む） */
export function hintRunning(h: Hint | null, count: number, now: number): boolean {
  if (!h) return false
  const total = 'all' in h ? count * (STROKE_MS + GAP_MS) : STROKE_MS + HOLD_MS
  return now - h.at < total
}

function colors(el: Element) {
  const s = getComputedStyle(el)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return { line: v('--line'), guide: v('--guide'), ink: v('--fg'), close: v('--close'), wrong: v('--wrong'), hint: v('--accent'), bg: v('--bg') }
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Point[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  // 押しただけの点も見えるように、同じ位置へ線を引く（丸い端で点になる）
  if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
}

/** 書き始めの印と画の番号 */
function startMark(ctx: CanvasRenderingContext2D, start: Point, n: number, color: string, bg: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(start[0], start[1], 3.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '600 5px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = bg
  ctx.fillText(String(n), start[0], start[1] + 0.3)
}

export function drawScene(canvas: HTMLCanvasElement, scene: Scene, now: number) {
  const ctx = canvas.getContext('2d')!
  const c = colors(canvas)
  const k = canvas.width / BOX
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 十字の補助線（習字の用紙と同じ）
  ctx.strokeStyle = c.line
  ctx.lineWidth = 0.5
  ctx.setLineDash([2, 2])
  ctx.beginPath()
  ctx.moveTo(BOX / 2, 0)
  ctx.lineTo(BOX / 2, BOX)
  ctx.moveTo(0, BOX / 2)
  ctx.lineTo(BOX, BOX / 2)
  ctx.stroke()
  ctx.setLineDash([])

  if (scene.guide) {
    ctx.strokeStyle = c.guide
    ctx.lineWidth = MODEL_WIDTH
    for (const s of scene.strokes) ctx.stroke(modelPath(s).path)
  }

  ctx.lineWidth = INK_WIDTH
  for (const ink of scene.inks) {
    ctx.strokeStyle = ink.close ? c.close : c.ink
    polyline(ctx, ink.pts)
  }

  // 受け取らなかった線は、お手本の動きの下に描く（同じ場所に重なっても、お手本の向きが見えるように）
  const f = scene.flash
  if (f && now - f.at < FLASH_MS) {
    ctx.globalAlpha = 1 - (now - f.at) / FLASH_MS
    ctx.strokeStyle = c.wrong
    ctx.lineWidth = INK_WIDTH
    polyline(ctx, f.pts)
    ctx.globalAlpha = 1
  }

  const h = scene.hint
  if (h && hintRunning(h, scene.strokes.length, now)) {
    const t = now - h.at
    const list = 'all' in h ? scene.strokes.map((s, i) => ({ s, i, t: t - i * (STROKE_MS + GAP_MS) })) : [{ s: scene.strokes[h.index], i: h.index, t }]
    ctx.strokeStyle = c.hint
    ctx.lineWidth = MODEL_WIDTH
    for (const { s, i, t: local } of list) {
      if (local < 0) continue
      const m = modelPath(s)
      const p = Math.min(1, local / STROKE_MS)
      // 線の長さぶんの破線をずらして、書き始めから伸びていくように見せる
      ctx.setLineDash([m.len, m.len + 1])
      ctx.lineDashOffset = m.len * (1 - p)
      ctx.stroke(m.path)
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
      startMark(ctx, m.start, i + 1, c.hint, c.bg)
    }
  }

  if (scene.live && scene.live.length) {
    ctx.strokeStyle = c.ink
    ctx.lineWidth = INK_WIDTH
    polyline(ctx, scene.live)
  }
}
