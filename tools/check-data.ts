// 変換したデータの確かめ: 字の数・画数（別に書き起こした値と照合）・枠からのはみ出し
import { readFileSync } from 'node:fs'
import { GRADE1, GRADE1_STROKES } from '../src/kanji/grades.ts'
import { BOX, flattenPath } from '../src/kanji/path.ts'
import type { GradeData } from '../src/kanji/types.ts'

const data: GradeData = JSON.parse(readFileSync('src/kanji/data/grade1.json', 'utf8'))
const errors: string[] = []

const chars = [...GRADE1]
if (chars.length !== 80) errors.push(`1年の字が ${chars.length} 字（80 字のはず）`)
if (new Set(chars).size !== chars.length) errors.push('1年の字に重複がある')
if (Object.keys(GRADE1_STROKES).length !== 80) errors.push(`画数の表が ${Object.keys(GRADE1_STROKES).length} 字`)

for (const ch of chars) {
  const strokes = data.kanji[ch]
  if (!strokes) {
    errors.push(`${ch}: データにない`)
    continue
  }
  if (strokes.length !== GRADE1_STROKES[ch]) errors.push(`${ch}: ${strokes.length} 画（表では ${GRADE1_STROKES[ch]} 画）`)
  strokes.forEach((s, i) => {
    for (const [x, y] of flattenPath(s.d)) {
      if (x < 0 || y < 0 || x > BOX || y > BOX) {
        errors.push(`${ch} ${i + 1} 画目: 枠の外 (${x.toFixed(1)}, ${y.toFixed(1)})`)
        break
      }
    }
  })
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`check:data: ${chars.length} 字、計 ${chars.reduce((a, c) => a + data.kanji[c].length, 0)} 画、問題なし`)
