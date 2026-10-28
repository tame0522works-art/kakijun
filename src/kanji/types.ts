/** 1画。type は KanjiVG の画の種類（㇐・㇑・㇒ など、ない画もある）、d は SVG の path */
export interface Stroke {
  type: string
  d: string
}

export interface GradeData {
  attribution: string
  kanji: Record<string, Stroke[]>
}
