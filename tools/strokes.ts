// 手本の画から書く入力を作り、Chrome DevTools Protocol で書く欄に送る。画面テスト（e2e.ts）と README の画像（screenshots.ts）で使う。
import { readFileSync } from 'node:fs'
import { BOX, flattenPath, resample, type Point } from '../src/kanji/path.ts'
import type { GradeData } from '../src/kanji/types.ts'
import { sleep, type Page } from './cdp.ts'

const data: GradeData = JSON.parse(readFileSync('src/kanji/data/grade1.json', 'utf8'))

export const strokeCount = (ch: string) => data.kanji[ch].length

/**
 * 手本の画を、書く入力の点列（枠の座標）にする。
 * dx は右へのずらし。wobble を渡すと、手書きらしいなめらかな揺れを入れる（同じ値なら毎回同じ揺れ）
 */
export function strokeOf(ch: string, i: number, opts: { reverse?: boolean; dx?: number; wobble?: number } = {}): Point[] {
  let seed = opts.wobble ?? 0
  // 擬似乱数（mulberry32）
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let nx = 0
  let ny = 0
  const pts = resample(flattenPath(data.kanji[ch][i].d), 24).map(([x, y]) => {
    if (opts.wobble !== undefined) {
      nx = nx * 0.85 + (rand() - 0.5) * 0.6
      ny = ny * 0.85 + (rand() - 0.5) * 0.6
    }
    return [x + (opts.dx ?? 0) + nx, y + ny] as const
  })
  return opts.reverse ? pts.reverse() : pts
}

export type Input = 'mouse' | 'touch' | 'pen'

/** 枠の座標の点列を、書く欄の上の画面の座標にして、指定の道具で1画書く */
export async function writeStroke(page: Page, pts: readonly Point[], input: Input = 'mouse') {
  const r = await page.run<{ left: number; top: number; width: number }>(`
    const r = document.querySelector('canvas.pad').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  `)
  const at = ([x, y]: Point) => ({ x: r.left + (x / BOX) * r.width, y: r.top + (y / BOX) * r.width })
  if (input === 'touch') {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(pts[0])] })
    for (const p of pts.slice(1)) await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(p)] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    const send = (type: string, p: Point, buttons: number) => page.send('Input.dispatchMouseEvent', { type, ...at(p), button: 'left', buttons, clickCount: 1, pointerType: input })
    await send('mousePressed', pts[0], 1)
    for (const p of pts.slice(1)) await send('mouseMoved', p, 1)
    await send('mouseReleased', pts[pts.length - 1], 0)
  }
  await sleep(60)
}
