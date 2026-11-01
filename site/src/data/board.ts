// Elements of the small boards drawn by MiniBoard: a unit is a pixel of the board.
export type Tone = 'blue' | 'green' | 'yellow' | 'pink' | 'violet' | 'orange'
export type Status = 'todo' | 'progress' | 'review' | 'done'
export type Item =
  | { t: 'frame'; at: number[]; title: string; tone?: Tone }
  | { t: 'card'; at: number[]; k: string; s: Status; to?: Status; d?: number; type?: 'story' | 'task' | 'bug'; title?: string; tr?: 'jira' | 'github' }
  | { t: 'note'; at: number[]; text: string; tone: Tone }
  | { t: 'timer'; at: number[]; left: string; fired?: boolean }
  | { t: 'gantt'; at: number[]; title: string; bars: [number, number, 'todo' | 'progress' | 'done'][] }
  | { t: 'focus'; at: number[]; time: string }
  | { t: 'arrow'; d: string; draw?: boolean }
  | { t: 'cursor'; at: number[]; to?: number[]; name: string; tone: Tone }
  | { t: 'search'; at: number[]; chips: string[]; hits: string[] }
