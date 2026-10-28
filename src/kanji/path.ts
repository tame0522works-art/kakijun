// KanjiVG の画（SVG の path の d）を折れ線にする。変換（tools）と画面の判定の両方で使う。
// KanjiVG の座標は 109×109 の枠。使われている命令は M・C・S（大文字・小文字）だけだが、L・H・V・Z も読めるようにしておく。

export type Point = readonly [number, number]

/** 字の枠の一辺（KanjiVG の viewBox） */
export const BOX = 109

const TOKEN = /[MmCcSsLlHhVvZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g

/** 3次ベジェを何本の線分で近似するか。KanjiVG の1区間は長くても枠の半分ほどなので、これで十分なめらか */
const CURVE_STEPS = 12

export function flattenPath(d: string): Point[] {
  const tokens = d.match(TOKEN) ?? []
  const out: Point[] = []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // S の1つ目の制御点は、直前の C/S の2つ目の制御点を現在地で折り返したもの
  let lastCtrl: Point | null = null

  const num = () => {
    const t = tokens[i++]
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`path の数が足りない: ${d}`)
    return Number(t)
  }
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS
      const u = 1 - t
      out.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ])
    }
    lastCtrl = [x2, y2]
    x = x3
    y = y3
  }

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + num()
        y = oy + num()
        startX = x
        startY = y
        out.push([x, y])
        lastCtrl = null
        // M に続く座標の組は L として扱う（SVG の決まり）
        cmd = rel ? 'l' : 'L'
        break
      case 'L':
        x = ox + num()
        y = oy + num()
        out.push([x, y])
        lastCtrl = null
        break
      case 'H':
        x = ox + num()
        out.push([x, y])
        lastCtrl = null
        break
      case 'V':
        y = oy + num()
        out.push([x, y])
        lastCtrl = null
        break
      case 'C':
        cubic(ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num())
        break
      case 'S': {
        const [cx, cy]: Point = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y]
        cubic(cx, cy, ox + num(), oy + num(), ox + num(), oy + num())
        break
      }
      case 'Z':
        x = startX
        y = startY
        out.push([x, y])
        lastCtrl = null
        break
      default:
        throw new Error(`読めない path の命令 ${cmd}: ${d}`)
    }
  }
  return out
}

export function polylineLength(pts: readonly Point[]): number {
  let len = 0
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
  return len
}

/** 折れ線を、道のりで等間隔な n 点に打ち直す。長さ 0（点を1回押しただけ）なら同じ点を n 個返す */
export function resample(pts: readonly Point[], n: number): Point[] {
  if (pts.length === 0) throw new Error('点のない線')
  const total = polylineLength(pts)
  if (total === 0) return Array.from({ length: n }, () => pts[0])
  const out: Point[] = [pts[0]]
  const step = total / (n - 1)
  let k = 1
  let walked = 0
  for (let j = 1; j < n - 1; j++) {
    const target = j * step
    while (k < pts.length) {
      const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
      if (seg > 0 && walked + seg >= target) {
        const t = (target - walked) / seg
        out.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t])
        break
      }
      walked += seg
      k++
    }
  }
  out.push(pts[pts.length - 1])
  return out
}
