// KanjiVG のリリースから、全字の画のデータが入った XML（gzip）を raw/ に取ってくる。
// KanjiVG は CC BY-SA 3.0。変換したデータも同じライセンスで配り、帰属を表示する。
import { mkdirSync, writeFileSync } from 'node:fs'
import { RELEASE, XML_URL, RAW_XML } from './source.ts'

mkdirSync('raw', { recursive: true })
const res = await fetch(XML_URL)
if (!res.ok) throw new Error(`${XML_URL}: ${res.status}`)
const buf = Buffer.from(await res.arrayBuffer())
// gzip の先頭は 1f 8b
if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error(`${XML_URL}: gzip ではない応答`)
writeFileSync(RAW_XML, buf)
console.log(`${RAW_XML}: ${buf.length} バイト（${RELEASE}）`)
