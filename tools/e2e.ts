// 画面操作のテスト。公開と同じ設定でビルドしたもの（CSP 入り）をローカルで配信し、画面なしの Chrome に
// 本物のマウス・タッチ・ペンの入力を送って、書いた線の判定・表示・字の切り替え・通信の制限を確かめる。
// `npm run e2e` で実行する（先に dist-e2e へビルドしてから、このスクリプトが配信とブラウザを立ち上げる）。
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Point } from '../src/kanji/path.ts'
import { Browser, sleep, type Page, type Viewport } from './cdp.ts'
import { strokeCount, strokeOf, writeStroke, type Input } from './strokes.ts'

const PORT = 4205
const BASE = `http://127.0.0.1:${PORT}/`
const DESKTOP: Viewport = { width: 1280, height: 860 }
const PHONE: Viewport = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true }
const FAILURES = 'e2e-failures'

class Ui {
  readonly page: Page
  constructor(page: Page) {
    this.page = page
  }

  async open() {
    await this.page.goto(BASE)
    await this.page.waitFor(`document.querySelector('canvas.pad') && document.querySelector('canvas.pad').width > 0`, '書く欄の表示')
  }

  text(selector: string) {
    return this.page.run<string>(`return (document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`)
  }

  feedback() {
    return this.text('.feedback')
  }

  /** 書けた画の数（書く欄の aria-label に入れている） */
  async written() {
    const label = await this.page.run<string>(`return document.querySelector('canvas.pad').getAttribute('aria-label')`)
    return Number(label.match(/(\d+)画まで/)![1])
  }

  write(pts: readonly Point[], input: Input = 'mouse') {
    return writeStroke(this.page, pts, input)
  }

  async writeAll(ch: string, input: Input = 'mouse') {
    for (let i = 0; i < strokeCount(ch); i++) await this.write(strokeOf(ch, i), input)
  }

  /** 見えている文字でボタンを押す（本物のクリックを送る） */
  async press(label: string, input: 'mouse' | 'touch' = 'mouse') {
    const c = await this.page.run<{ x: number; y: number } | null>(`
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s+/g, '') === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!b) return null;
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    `)
    assert.ok(c, `「${label}」のボタンがない`)
    if (input === 'touch') {
      await this.page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [c] })
      await sleep(50)
      await this.page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await this.page.send('Input.dispatchMouseEvent', { type, ...c, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
      }
    }
    await sleep(80)
  }

  async current() {
    return this.text('.current .char')
  }

  /** 書く欄で、いま描かれている色の画素の数（お手本の動きの確かめに使う） */
  colorPixels(rgb: [number, number, number]) {
    return this.page.run<number>(`
      const c = document.querySelector('canvas.pad');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ${rgb[0]}) < 30 && Math.abs(d[i + 1] - ${rgb[1]}) < 30 && Math.abs(d[i + 2] - ${rgb[2]}) < 30) n++;
      return n;
    `)
  }
}

/** --accent（ライト）。お手本の動きの色 */
const HINT_RGB: [number, number, number] = [43, 63, 143]

interface Scenario {
  name: string
  viewport?: Viewport
  run(ui: Ui): Promise<void>
}

const scenarios: Scenario[] = [
  {
    name: '最初の表示: 「右」の5画、1画目を待っている、一覧は80字',
    async run(ui) {
      await ui.open()
      assert.equal(await ui.current(), '右')
      assert.equal(await ui.text('.current .count'), '5画')
      assert.equal(await ui.feedback(), '1画目を書いてください')
      assert.equal(await ui.page.run<number>(`return document.querySelectorAll('.picker button').length`), 80)
      assert.match(await ui.text('.foot'), /KanjiVG.*CC BY-SA 3\.0/)
    },
  },
  {
    name: 'マウスで正しく書く: 5画とも合格し、一覧に印が付き、次の字へ進める',
    async run(ui) {
      await ui.open()
      for (let i = 0; i < 4; i++) {
        await ui.write(strokeOf('右', i))
        assert.equal(await ui.feedback(), `${i + 1}画目、合っています`)
      }
      await ui.write(strokeOf('右', 4))
      assert.equal(await ui.feedback(), '書けました。合っている 5・惜しい 0・間違い 0')
      assert.ok(await ui.page.run<boolean>(`return document.querySelector('.picker button[aria-current="true"]').classList.contains('finished')`), '一覧に書き終えた印がない')
      // 書き終えたあとに書いても、何も変わらない
      await ui.write(strokeOf('右', 0))
      assert.equal(await ui.written(), 5)
      await ui.press('次の字へ（雨）')
      assert.equal(await ui.current(), '雨')
      assert.equal(await ui.feedback(), '1画目を書いてください')
    },
  },
  {
    name: '書き順違い: 横画を先に書くと受け取らず、1画目のお手本が動く',
    async run(ui) {
      await ui.open()
      await ui.write(strokeOf('右', 1))
      assert.equal(await ui.feedback(), 'いまのは2画目です。先に1画目を書きます')
      assert.equal(await ui.written(), 0)
      assert.ok((await ui.colorPixels(HINT_RGB)) > 200, 'お手本の動きが描かれていない')
      // お手本の動きは2秒ほどで消える
      await sleep(2500)
      assert.equal(await ui.colorPixels(HINT_RGB), 0, 'お手本の動きが残っている')
      await ui.write(strokeOf('右', 0))
      assert.equal(await ui.feedback(), '1画目、合っています')
    },
  },
  {
    name: '向き違いと、惜しい（右にずれ）',
    async run(ui) {
      await ui.open()
      await ui.write(strokeOf('右', 0, { reverse: true }))
      assert.equal(await ui.feedback(), '1画目は向きが逆です。お手本の書き始めを見てください')
      assert.equal(await ui.written(), 0)
      await ui.write(strokeOf('右', 0, { dx: 11 }))
      assert.match(await ui.feedback(), /^1画目、惜しい。少し右にずれています/)
      assert.equal(await ui.written(), 1)
    },
  },
  {
    name: '1画戻す・書き直す・数え方',
    async run(ui) {
      await ui.open()
      await ui.write(strokeOf('右', 1))
      await ui.write(strokeOf('右', 0))
      await ui.write(strokeOf('右', 1))
      assert.equal(await ui.written(), 2)
      await ui.press('1画戻す')
      assert.equal(await ui.written(), 1)
      assert.equal(await ui.feedback(), '2画目を書いてください')
      await ui.write(strokeOf('右', 1))
      for (let i = 2; i < 5; i++) await ui.write(strokeOf('右', i))
      // 間違い1回は、戻した画を書き直しても数えたまま
      assert.equal(await ui.feedback(), '書けました。合っている 5・惜しい 0・間違い 1')
      await ui.press('書き直す')
      assert.equal(await ui.written(), 0)
      assert.equal(await ui.feedback(), '1画目を書いてください')
    },
  },
  {
    name: 'お手本を見る: 全部の画が順に描かれ、終われば消える',
    async run(ui) {
      await ui.open()
      await ui.press('お手本を見る')
      await sleep(300)
      const early = await ui.colorPixels(HINT_RGB)
      await sleep(3000)
      const late = await ui.colorPixels(HINT_RGB)
      assert.ok(early > 0 && late > early * 2, `描かれた量が増えていない（${early} → ${late}）`)
      await sleep(1500)
      assert.equal(await ui.colorPixels(HINT_RGB), 0, 'お手本の動きが残っている')
    },
  },
  {
    name: '一覧から字を選ぶと、その字に切り替わる',
    async run(ui) {
      await ui.open()
      await ui.write(strokeOf('右', 0))
      await ui.press('森')
      assert.equal(await ui.current(), '森')
      assert.equal(await ui.text('.current .count'), '12画')
      assert.equal(await ui.written(), 0)
      await ui.writeAll('森')
      assert.equal(await ui.feedback(), '書けました。合っている 12・惜しい 0・間違い 0')
    },
  },
  {
    name: 'スマホ: 指で書いても画面が動かず、一覧から選ぶと書く欄まで戻り、横にはみ出さない',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      const before = await ui.page.run<number>(`return scrollY`)
      await ui.writeAll('右', 'touch')
      assert.equal(await ui.feedback(), '書けました。合っている 5・惜しい 0・間違い 0')
      assert.equal(await ui.page.run<number>(`return scrollY`), before, '書いているあいだに画面が動いた')
      // 一覧のいちばん下の字を押すと、書く欄が画面の上に戻ってくる。
      // 指を離してすぐ（0.1 秒ほど）のタップは、Chrome が click にしないので、人の間合いくらい待つ
      await sleep(500)
      await ui.press('六', 'touch')
      assert.equal(await ui.current(), '六')
      await ui.page.waitFor(`Math.abs(document.querySelector('.writer').getBoundingClientRect().top) < 40`, '書く欄まで戻る')
      const layout = await ui.page.run<{ scrollW: number; innerW: number; pad: number }>(`
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, pad: document.querySelector('canvas.pad').getBoundingClientRect().width };
      `)
      assert.equal(layout.scrollW, layout.innerW, '横にはみ出している')
      assert.ok(layout.pad > 320, `書く欄の幅 ${layout.pad}px`)
    },
  },
  {
    name: 'ペンで書いたあとの指の接触は、手のひらとして無視する',
    viewport: PHONE,
    async run(ui) {
      await ui.open()
      await ui.write(strokeOf('右', 0), 'pen')
      assert.equal(await ui.written(), 1)
      await ui.write(strokeOf('右', 1), 'touch')
      assert.equal(await ui.written(), 1)
      assert.equal(await ui.feedback(), '1画目、合っています')
      await ui.write(strokeOf('右', 1), 'pen')
      assert.equal(await ui.written(), 2)
    },
  },
  {
    name: '公開版の CSP: 通信は拒否し、字のデータは同じ場所の JS から読む',
    async run(ui) {
      await ui.open()
      const csp = await ui.page.run<string>(`return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)
      assert.match(csp, /connect-src 'none'/)
      const files = await ui.page.run<string[]>(`return performance.getEntriesByType('resource').map(e => e.name)`)
      assert.ok(files.every((f) => f.startsWith(BASE)), `別の場所から読んでいる: ${files.join(', ')}`)
      assert.ok(files.some((f) => /\/assets\/grade1-[\w-]+\.js$/.test(f)), '字のデータを別ファイルで読んでいない')
      const blocked = await ui.page.run<boolean>(`try { await fetch('${BASE}'); return false } catch { return true }`)
      assert.ok(blocked, 'fetch が通ってしまう')
      assert.deepEqual(await ui.page.run(`return window.__csp`), [`connect-src ${BASE}`])
    },
  },
]

let server: ChildProcess | null = null

async function startServer() {
  // vite の preview で dist-e2e を配信する（npx を介さず、どの OS でも同じ起動のしかたにする）
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) return
    await sleep(100)
  }
  await stopServer()
  throw new Error('テスト用のサーバーが起動しませんでした')
}

async function stopServer() {
  if (!server) return
  const s = server
  server = null
  const exited = new Promise((r) => s.once('exit', r))
  s.kill()
  await exited
}

async function main() {
  const only = process.argv[2]
  await startServer()
  const browser = await Browser.launch(9347)
  let failed = 0
  try {
    for (const s of scenarios.filter((s) => !only || s.name.includes(only))) {
      const page = await browser.newPage(s.viewport ?? DESKTOP)
      // ページの中で起きた CSP 違反とエラーを記録しておく（意図して起こすもの以外は起きないはず）
      await page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__csp = []; window.__errors = [];
          document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
          addEventListener('error', e => window.__errors.push(String(e.message)));`,
      })
      const ui = new Ui(page)
      const t0 = Date.now()
      try {
        await s.run(ui)
        if (!s.name.startsWith('公開版の CSP')) assert.deepEqual(await page.run(`return window.__csp`), [], 'CSP 違反が起きた')
        assert.deepEqual(await page.run(`return window.__errors`), [], 'ページでエラーが起きた')
        console.log(`  ✓ ${s.name}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${s.name}\n      ${e instanceof Error ? e.message : String(e)}`)
        mkdirSync(FAILURES, { recursive: true })
        const { data } = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => ({ data: '' }))
        if (data) writeFileSync(join(FAILURES, `${scenarios.indexOf(s) + 1}.png`), Buffer.from(data, 'base64'))
      } finally {
        await page.send('Page.close').catch(() => {})
      }
    }
  } finally {
    await browser.close()
    await stopServer()
  }
  if (failed > 0) {
    console.log(`\n${failed} 件失敗しました（失敗時の画面: ${FAILURES}/）`)
    process.exit(1)
  }
  console.log('\ne2e OK')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
