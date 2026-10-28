// 判定の確かめ。1年の 80 字・400 画すべてについて、手本から作った入力で判定が期待どおりになるかを見る。
//   1. 手本をそのままなぞる → すべて合格
//   2. 手書きらしく揺らす（字全体のずれ・大きさ・点ごとの揺れ・点の数） → すべて受け取る（合格か惜しい）
//   3. 字全体を小さく右下に書く → すべて受け取り、2画目からは字全体の補正で合格になる
//   4. 逆向きに書く → 向き違い（点と、逆にしても形がほぼ同じ画は除く）
//   5. 右にずらす → 惜しい（右へのずれを指摘）
//   6. 次の画を飛ばしてその次を書く → 書き順違い（2つの画が似ていて区別できない組は除く）
import { readFileSync } from 'node:fs'
import { GRADE1 } from '../src/kanji/grades.ts'
import { CLOSE, judge, prepare, type Target } from '../src/kanji/judge.ts'
import { flattenPath, resample, type Point } from '../src/kanji/path.ts'
import type { GradeData } from '../src/kanji/types.ts'

const data: GradeData = JSON.parse(readFileSync('src/kanji/data/grade1.json', 'utf8'))

// 結果を毎回同じにするための擬似乱数（mulberry32）
let seed = 20261028
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (a: number, b: number) => a + (b - a) * rand()

const failures: string[] = []
const fail = (msg: string) => failures.length < 40 && failures.push(msg)
const tally = { exact: 0, jitterOk: 0, jitterClose: 0, smallOk: 0, smallClose: 0, shift: 0, shiftOrder: 0, reverse: 0, reverseSkipped: 0, order: 0, orderSkipped: 0 }
let strokesTotal = 0

/** 揺らした入力。字全体を同じだけずらし・拡大し、点ごとの揺れはなめらかに（隣の点と相関させて）入れる */
function wobble(raw: readonly Point[], g: { dx: number; dy: number; s: number }): Point[] {
  const pts = resample(raw, Math.round(between(10, 60)))
  let nx = 0
  let ny = 0
  return pts.map(([x, y]) => {
    nx = nx * 0.7 + between(-1.5, 1.5)
    ny = ny * 0.7 + between(-1.5, 1.5)
    return [54.5 + (x - 54.5) * g.s + g.dx + nx, 54.5 + (y - 54.5) * g.s + g.dy + ny] as const
  })
}

const meanDist = (a: Target, b: Target, reverse = false) =>
  a.pts.reduce((sum, p, i) => {
    const q = b.pts[reverse ? b.pts.length - 1 - i : i]
    return sum + Math.hypot(p[0] - q[0], p[1] - q[1])
  }, 0) / a.pts.length

for (const ch of GRADE1) {
  const strokes = data.kanji[ch]
  const targets = prepare(strokes)
  const raws = strokes.map((s) => flattenPath(s.d))
  const g = { dx: between(-4, 4), dy: between(-4, 4), s: between(0.92, 1.08) }
  // 1画目は字全体の手がかりがないので、お手本から大きく外れると判定できない（0.8 倍・8 ずらしでは 1 画目の 16 字が外れた）
  const small = { dx: 6, dy: 6, s: 0.85 }
  const wobbled: Point[][] = []
  const smalls: Point[][] = []

  raws.forEach((raw, i) => {
    strokesTotal++
    const name = `${ch} ${i + 1}画目`

    // 判定に渡す「書き終えた画」は、それぞれの試し方で書いたものにする（なぞりは手本そのもの）
    const before = raws.slice(0, i)
    const exact = judge(raw, targets, i, before)
    if (exact.kind === 'ok' && exact.issues.length === 0) tally.exact++
    else fail(`なぞり ${name}: ${JSON.stringify(exact)}`)

    const w = wobble(raw, g)
    const j = judge(w, targets, i, wobbled)
    wobbled.push(w)
    if (j.kind !== 'ok') fail(`揺らし ${name}: ${JSON.stringify(j)}`)
    else if (j.issues.length === 0) tally.jitterOk++
    else tally.jitterClose++

    const sm = raw.map(([x, y]) => [54.5 + (x - 54.5) * small.s + small.dx, 54.5 + (y - 54.5) * small.s + small.dy] as const)
    const k = judge(sm, targets, i, smalls)
    smalls.push(sm)
    if (k.kind !== 'ok') fail(`小さく ${name}: ${JSON.stringify(k)}`)
    else if (i > 0 && k.issues.length) fail(`小さく ${name}（補正が効いていない）: ${JSON.stringify(k)}`)
    else if (k.issues.length) tally.smallClose++
    else tally.smallOk++

    // 点と、逆にしても形がほぼ同じ画（逆向きとの差が「惜しい」の範囲に入る）は、向きを判定できないので除く
    const t = targets[i]
    if (t.len < 15 || meanDist(t, t, true) <= CLOSE) tally.reverseSkipped++
    else {
      const r = judge([...raw].reverse(), targets, i, before)
      if (r.kind === 'direction') tally.reverse++
      else fail(`逆向き ${name}: ${JSON.stringify(r)}`)
    }

    // 右に枠の 1 割強ずらす → 惜しい（右へのずれを指摘）。ずらした先に別の画がある字は書き順違いになりうるので数えるだけにする
    const s = judge(raw.map(([x, y]) => [x + 12, y] as const), targets, i, before)
    if (s.kind === 'ok' && s.issues.some((x) => x.kind === 'shift' && x.dx > 0)) tally.shift++
    else if (s.kind === 'order') tally.shiftOrder++
    else fail(`右ずらし ${name}: ${JSON.stringify(s)}`)

    if (i + 1 < raws.length) {
      // 2つの画が似ている（どちらとしても受け取れる）組は、書き順違いと言えないので除く
      if (meanDist(targets[i + 1], t) <= CLOSE) tally.orderSkipped++
      else {
        const o = judge(raws[i + 1], targets, i, before)
        if (o.kind === 'order' && o.matched === i + 1) tally.order++
        else fail(`飛ばし ${name}→${i + 2}画目: ${JSON.stringify(o)}`)
      }
    }
  })
}

console.log(`画: ${strokesTotal}`)
console.log(`なぞり: 合格 ${tally.exact}`)
console.log(`揺らし: 合格 ${tally.jitterOk}、惜しい ${tally.jitterClose}`)
console.log(`小さく右下: 合格 ${tally.smallOk}、惜しい ${tally.smallClose}`)
console.log(`逆向き: 向き違い ${tally.reverse}（判定しない画 ${tally.reverseSkipped}）`)
console.log(`右ずらし: 惜しい ${tally.shift}（別の画に合って書き順違い ${tally.shiftOrder}）`)
console.log(`飛ばし: 書き順違い ${tally.order}（似ていて除いた組 ${tally.orderSkipped}）`)
if (failures.length) {
  console.error(`\n期待と違う判定（先頭 40 件）:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log('check:judge: 問題なし')
