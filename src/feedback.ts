// 判定の結果を、画面に出す一文にする
import type { Issue, Verdict } from './kanji/judge.ts'

export type Mark = 'ok' | 'close' | 'wrong'

export interface Feedback {
  mark: Mark
  text: string
}

/** 枠の座標で、これ以上ずれていたら「少し」を付けない */
const FAR = 12

function direction(dx: number, dy: number): string {
  const d = Math.hypot(dx, dy)
  // 斜めの成分が小さければ、上下か左右の一方だけで言う
  const h = Math.abs(dx) >= d * 0.4 ? (dx > 0 ? '右' : '左') : ''
  const v = Math.abs(dy) >= d * 0.4 ? (dy > 0 ? '下' : '上') : ''
  // 日本語では「右上」「左下」のように左右を先に言う
  return h + v
}

function issueText(i: Issue): string {
  switch (i.kind) {
    case 'shift':
      return `${Math.hypot(i.dx, i.dy) < FAR ? '少し' : ''}${direction(i.dx, i.dy)}にずれています`
    case 'short':
      return '短めです'
    case 'long':
      return '長めです'
    case 'shape':
      return '形が少し違います'
  }
}

/** @param index 判定した画（0 始まり） */
export function describe(v: Verdict, index: number): Feedback {
  const n = index + 1
  switch (v.kind) {
    case 'ok':
      return v.issues.length
        ? { mark: 'close', text: `${n}画目、惜しい。${v.issues.map(issueText).join('・')}` }
        : { mark: 'ok', text: `${n}画目、合っています` }
    case 'direction':
      return { mark: 'wrong', text: `${n}画目は向きが逆です。お手本の書き始めを見てください` }
    case 'order':
      return { mark: 'wrong', text: `いまのは${v.matched + 1}画目です。先に${n}画目を書きます` }
    case 'miss':
      return { mark: 'wrong', text: `${n}画目と合いません。お手本を見てください` }
  }
}
