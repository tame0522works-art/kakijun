// raw/kanjivg.xml.gz から学年の字だけを抜き出し、src/kanji/data/grade<n>.json に書く。
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { GRADE1 } from '../src/kanji/grades.ts'
import { flattenPath } from '../src/kanji/path.ts'
import type { GradeData, Stroke } from '../src/kanji/types.ts'
import { ATTRIBUTION, RAW_XML } from './source.ts'

const xml = gunzipSync(readFileSync(RAW_XML)).toString('utf8')

/** KanjiVG の生成されたファイルは属性が1行に収まっているので、正規表現で足りる */
function strokesOf(ch: string): Stroke[] {
  const code = ch.codePointAt(0)!.toString(16).padStart(5, '0')
  const m = xml.match(new RegExp(`<kanji id="kvg:kanji_${code}">([\\s\\S]*?)</kanji>`))
  if (!m) throw new Error(`${ch}（${code}）が KanjiVG にない`)
  const strokes: Stroke[] = []
  for (const tag of m[1].matchAll(/<path ([^>]*)\/>/g)) {
    const attrs = Object.fromEntries([...tag[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]))
    const n = Number(attrs.id.match(/-s(\d+)$/)?.[1])
    // 画の番号は書き順そのもの。1 から順に並んでいなければ止める
    if (n !== strokes.length + 1) throw new Error(`${ch}: ${strokes.length + 1} 画目のはずが ${attrs.id}`)
    // 読めない命令があればここで止まる
    flattenPath(attrs.d)
    strokes.push({ type: attrs['kvg:type'] ?? '', d: attrs.d.replace(/\s+/g, ' ').trim() })
  }
  return strokes
}

const data: GradeData = { attribution: ATTRIBUTION, kanji: {} }
for (const ch of GRADE1) data.kanji[ch] = strokesOf(ch)
const json = JSON.stringify(data)
writeFileSync('src/kanji/data/grade1.json', json)
console.log(`src/kanji/data/grade1.json: ${Object.keys(data.kanji).length} 字、${json.length} バイト`)
