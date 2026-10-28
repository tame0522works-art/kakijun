// README に載せる画面の画像を撮る。公開と同じ設定のビルドを配信した状態（npm run build → npm run preview）で
// `npm run screenshots` を実行する。Edge（なければ Chrome）を画面なしで起動し、Chrome DevTools Protocol で操作する。
// 書く線は手本に決まった揺れを足したものなので、アプリを直したら同じ画像を撮り直せる。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser, sleep, type Page } from './cdp.ts'
import { strokeCount, strokeOf, writeStroke, type Input } from './strokes.ts'

const BASE = process.argv[2] ?? 'http://localhost:5206/'
const OUT = 'docs/images'

async function shoot(cdp: Page, name: string) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`  ${OUT}/${name}`)
}

async function open(cdp: Page) {
  await cdp.goto(BASE)
  // 同じポートで別の作品が動いていると、その画面を撮ってしまうので、kakijun であることを先に確かめる
  const title = await cdp.run<string>(`return document.title`)
  if (title !== 'kakijun') throw new Error(`${BASE} で動いているのは kakijun ではありません（ページの題名: ${title || 'なし'}）`)
  await cdp.waitFor(`document.querySelector('canvas.pad')?.width > 0`, '書く欄の表示')
}

async function pick(cdp: Page, ch: string) {
  await cdp.run(`[...document.querySelectorAll('.picker button')].find(b => b.textContent === ${JSON.stringify(ch)}).click()`)
  await sleep(100)
}

/** 画の番号（0 始まり）を順に書く。番号ごとに揺れ方を変える */
async function write(cdp: Page, ch: string, order: number[], input: Input = 'mouse', opts: Record<number, { dx?: number; reverse?: boolean }> = {}) {
  for (const i of order) await writeStroke(cdp, strokeOf(ch, i, { wobble: i + 1, ...opts[i] }), input)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // このブラウザ専用の一時プロファイルを使うので、普段のデータには触れない
  const browser = await Browser.launch()
  try {
    const cdp = await browser.newPage({ width: 1100, height: 760 })
    console.log('撮影:')

    // 1. 「右」: 3画目を右にずらして「惜しい」、4画目の代わりに5画目を書いて書き順違い。お手本の4画目が伸び切ったところで撮る
    await open(cdp)
    await write(cdp, '右', [0, 1, 2], 'mouse', { 2: { dx: 10 } })
    await write(cdp, '右', [4])
    await sleep(750)
    await shoot(cdp, 'order.png')

    // 2. 「森」を書き終えたところ
    await pick(cdp, '森')
    await write(cdp, '森', [...Array(strokeCount('森')).keys()])
    await sleep(300)
    await shoot(cdp, 'done.png')

    // 3. スマホ: 「左」の1画目（横画）を逆向きに書いたところ。お手本が半分ほど伸びた、赤い線とまだ重なり切らないうちに撮る
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await open(cdp)
    await pick(cdp, '左')
    await write(cdp, '左', [0], 'touch', { 0: { reverse: true } })
    await sleep(380)
    await shoot(cdp, 'mobile.png')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
