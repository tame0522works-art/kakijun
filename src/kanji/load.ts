import type { GradeData } from './types.ts'

// fetch は CSP（connect-src 'none'）で止まるので、学年ごとの JSON は動的 import で別のファイルとして読む
export function loadGrade1(): Promise<GradeData> {
  return import('./data/grade1.json').then((m) => m.default as GradeData)
}
