import { useEffect, useMemo, useState } from 'react'
import { describe, type Feedback } from './feedback.ts'
import { GRADE1 } from './kanji/grades.ts'
import { judge, prepare } from './kanji/judge.ts'
import { loadGrade1 } from './kanji/load.ts'
import type { Point } from './kanji/path.ts'
import type { GradeData } from './kanji/types.ts'
import type { Hint, Ink } from './ui/draw.ts'
import Pad from './ui/Pad.tsx'

const CHARS = [...GRADE1]
/** 最初に出す字。右は「ノ」から書く（横画からではない）ので、書き順の確かめが伝わりやすい */
const FIRST = '右'

interface Tally {
  ok: number
  close: number
  wrong: number
}

const EMPTY: Tally = { ok: 0, close: 0, wrong: 0 }

export default function App() {
  const [data, setData] = useState<GradeData | null>(null)
  const [ch, setCh] = useState(FIRST)
  const [inks, setInks] = useState<Ink[]>([])
  const [flash, setFlash] = useState<(Ink & { at: number }) | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [tally, setTally] = useState<Tally>(EMPTY)
  const [guide, setGuide] = useState(true)
  const [finished, setFinished] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    loadGrade1().then(setData)
  }, [])

  const strokes = useMemo(() => data?.kanji[ch] ?? [], [data, ch])
  const targets = useMemo(() => prepare(strokes), [strokes])
  const index = inks.length
  const done = strokes.length > 0 && index === strokes.length

  const start = (next: string) => {
    setCh(next)
    setInks([])
    setFlash(null)
    setHint(null)
    setFeedback(null)
    setTally(EMPTY)
  }

  /** 一覧から選んだとき。スマホでは一覧が書く欄の下にあるので、書く欄が画面から外れていれば戻す */
  const pick = (next: string) => {
    start(next)
    const writer = document.querySelector('.writer')
    if (writer && writer.getBoundingClientRect().top < 0) writer.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onStroke = (pts: Point[]) => {
    if (done) return
    const v = judge(
      pts,
      targets,
      index,
      inks.map((i) => i.pts),
    )
    setFeedback(describe(v, index))
    if (v.kind === 'ok') {
      const close = v.issues.length > 0
      setInks([...inks, { pts, close }])
      setHint(null)
      setTally({ ...tally, [close ? 'close' : 'ok']: tally[close ? 'close' : 'ok'] + 1 })
      if (index + 1 === strokes.length) setFinished(new Set(finished).add(ch))
    } else {
      const now = performance.now()
      setFlash({ pts, at: now })
      // 間違えたら、書くはずだった画をその場でお手本として動かす
      setHint({ at: now, index })
      setTally({ ...tally, wrong: tally.wrong + 1 })
    }
  }

  // 戻した画は合格・惜しいの数から引く（間違えた回数はそのまま残す）
  const undo = () => {
    const kind = inks[inks.length - 1].close ? 'close' : 'ok'
    setTally({ ...tally, [kind]: tally[kind] - 1 })
    setInks(inks.slice(0, -1))
    setFeedback(null)
    setHint(null)
  }

  const pos = CHARS.indexOf(ch)

  return (
    <div className="app">
      <header className="bar">
        <h1>kakijun</h1>
        <p className="lead">漢字を書いて、書き順を1画ずつ確かめる</p>
      </header>

      <main className="main">
        <section className="writer" aria-label="書く欄">
          <div className="current">
            <button type="button" onClick={() => start(CHARS[(pos + CHARS.length - 1) % CHARS.length])} aria-label="前の字">
              ‹
            </button>
            <span className="char" lang="ja">
              {ch}
            </span>
            <span className="count">{strokes.length ? `${strokes.length}画` : ''}</span>
            <button type="button" onClick={() => start(CHARS[(pos + 1) % CHARS.length])} aria-label="次の字">
              ›
            </button>
          </div>

          {data ? (
            <Pad
              label={`「${ch}」を書く欄。${index}画まで書けています`}
              strokes={strokes}
              inks={inks}
              flash={flash}
              hint={hint}
              guide={guide}
              onStroke={onStroke}
            />
          ) : (
            <div className="pad loading">読み込み中…</div>
          )}

          <p className={`feedback ${feedback?.mark ?? ''}`} role="status" aria-live="polite">
            {done ? (
              <>
                書けました。合っている {tally.ok}・惜しい {tally.close}・間違い {tally.wrong}
              </>
            ) : (
              (feedback?.text ?? `${index + 1}画目を書いてください`)
            )}
          </p>

          <div className="actions">
            {done && (
              <button type="button" className="primary" onClick={() => start(CHARS[(pos + 1) % CHARS.length])}>
                次の字へ（{CHARS[(pos + 1) % CHARS.length]}）
              </button>
            )}
            <button type="button" onClick={() => setHint({ at: performance.now(), all: true })} disabled={!data}>
              お手本を見る
            </button>
            <button type="button" onClick={undo} disabled={index === 0}>
              1画戻す
            </button>
            <button type="button" onClick={() => start(ch)} disabled={index === 0 && !feedback}>
              書き直す
            </button>
            <label className="toggle">
              <input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} />
              お手本を薄く出す
            </label>
          </div>
        </section>

        <nav className="picker" aria-label="字を選ぶ">
          <h2>小学1年の漢字（80字）</h2>
          <ul>
            {CHARS.map((c) => (
              <li key={c}>
                <button type="button" lang="ja" aria-current={c === ch ? 'true' : undefined} className={finished.has(c) ? 'finished' : undefined} onClick={() => pick(c)}>
                  {c}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </main>

      <footer className="foot">
        <p>書き順は KanjiVG のお手本に合わせています。教科書や辞書によって、別の書き順が示されている字もあります。</p>
        <p>
          字のデータ: <a href="https://kanjivg.tagaini.net">KanjiVG</a>（© Ulrich Apel ほか、
          <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>）を加工して使用
        </p>
      </footer>
    </div>
  )
}
