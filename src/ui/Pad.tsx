import { useEffect, useRef } from 'react'
import { BOX, type Point } from '../kanji/path.ts'
import { drawScene, FLASH_MS, hintRunning, type Scene } from './draw.ts'

interface Props extends Omit<Scene, 'live'> {
  label: string
  onStroke: (pts: Point[]) => void
}

export default function Pad({ label, onStroke, ...scene }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef<{ id: number; pts: Point[] } | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const frame = useRef(0)
  const penSeen = useRef(false)

  const redraw = () => {
    const el = canvas.current
    if (!el) return
    cancelAnimationFrame(frame.current)
    const tick = () => {
      const s = sceneRef.current
      const now = performance.now()
      drawScene(el, { ...s, live: live.current?.pts ?? null }, now)
      const flashing = s.flash !== null && now - s.flash.at < FLASH_MS
      if (flashing || hintRunning(s.hint, s.strokes.length, now)) frame.current = requestAnimationFrame(tick)
    }
    tick()
  }

  // 大きさは CSS で決め、描画の解像度を表示の画素に合わせる
  useEffect(() => {
    const el = canvas.current!
    const fit = () => {
      const px = Math.round(el.clientWidth * devicePixelRatio)
      if (el.width !== px) {
        el.width = px
        el.height = px
      }
      redraw()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // ダークモードの切り替えで色を読み直す
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', redraw)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', redraw)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  useEffect(redraw)

  const toBox = (e: PointerEvent | React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * BOX, ((e.clientY - r.top) / r.height) * BOX]
  }

  return (
    <canvas
      ref={canvas}
      className="pad"
      role="img"
      aria-label={label}
      onPointerDown={(e) => {
        // ペンで書いたことがあれば、それ以降の指の接触は手のひらとみなして無視する（タブレットでペンを使うとき）
        if (e.pointerType === 'pen') penSeen.current = true
        else if (e.pointerType === 'touch' && penSeen.current) return
        // 2本目の指などは無視する（書いている途中の線を壊さない）
        if (live.current || (e.pointerType === 'mouse' && e.button !== 0)) return
        e.currentTarget.setPointerCapture(e.pointerId)
        live.current = { id: e.pointerId, pts: [toBox(e)] }
        redraw()
      }}
      onPointerMove={(e) => {
        const l = live.current
        if (!l || l.id !== e.pointerId) return
        // ペンやタッチは1フレームに複数の点が届くので、まとめられた点もすべて拾う
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        for (const ev of events.length ? events : [e.nativeEvent]) l.pts.push(toBox(ev))
        redraw()
      }}
      onPointerUp={(e) => {
        const l = live.current
        if (!l || l.id !== e.pointerId) return
        live.current = null
        onStroke(l.pts)
      }}
      onPointerCancel={(e) => {
        if (live.current?.id === e.pointerId) {
          live.current = null
          redraw()
        }
      }}
    />
  )
}
