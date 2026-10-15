// Small drawings in the board's own look, one per tour step, after the feature loops on
// tiko.run. Plain markup and CSS: no media files, the theme's colors, still under reduced motion.
// Keys, names and tasks are made up.
import '@/onboarding/loops.css'
import type { StepId } from '@/onboarding/tour'

const card = (key: string, title: string, type: string, extra = '', style = '') =>
  `<div class="tl-card${extra}" style="${style}"><span class="tl-ty ${type}"></span><span class="tl-k">${key}</span>${title}</div>`

const lozenge = (status: 'todo' | 'progress' | 'done', text: string) =>
  `<span class="tl-lz ${status}">${text}</span>`

export const LOOPS: Record<StepId, string> = {
  welcome: `<div class="tl-art tl-live">
    <span class="tl-chip"><i></i>Synced just now</span>
    ${card('DEMO-12', `Retry payments${lozenge('progress', 'In progress')}`, 'story', '', '--y:40px')}
    ${card('DEMO-18', `Billing cron<span class="tl-swap">${lozenge('progress', 'In review')}${lozenge('done', 'Done')}</span>`, 'task', ' tl-turning', '--y:84px')}
    ${card('DEMO-27', `Flaky login test${lozenge('todo', 'To do')}`, 'bug', '', '--y:128px')}
  </div>`,

  add: `<div class="tl-art tl-add">
    <div class="tl-in">
      <span class="tl-q tl-q1" style="--n:7ch">DEMO-12</span>
      <span class="tl-q tl-q2" style="--n:14ch">project = DEMO</span>
      <span class="tl-q tl-q3" style="--n:22ch">tracker.example/DEMO-7</span>
    </div>
    ${card('DEMO-12', 'Retry payments', 'story', ' tl-c1', '--y:64px')}
    ${card('DEMO-14', 'Invoice export', 'task', ' tl-c2', '--y:104px')}
    ${card('DEMO-7', 'Card for a pasted link', 'bug', ' tl-c3', '--y:144px')}
  </div>`,

  search: `<div class="tl-art tl-find">
    <div class="tl-pal">
      <div class="tl-pal-in"><span class="tl-typed">status:</span><span class="tl-filter">Status: In review</span><i></i></div>
      <div class="tl-row on"><span class="tl-ty task"></span><span class="tl-k">DEMO-18</span><span>Billing cron</span><small>In review</small></div>
      <div class="tl-row"><span class="tl-ty story"></span><span class="tl-k">DEMO-31</span><span>New pricing page</span><small>In review</small></div>
      <div class="tl-row"><span class="tl-ty bug"></span><span class="tl-k">DEMO-40</span><span>Typo in footer</span><small>In review</small></div>
    </div>
  </div>`,

  timer: `<div class="tl-art tl-wait">
    <span class="tl-list">Timers <b>1</b></span>
    <span class="tl-cube"><span class="tl-run">2m</span><span class="tl-fired">●</span></span>
    ${card('DEMO-18', `Billing cron${lozenge('progress', 'In review')}`, 'task', '', '--x:72px;--y:46px')}
    <div class="tl-went"><b>Ping QA about the cron</b><small>On DEMO-18 · Went off at 15:30</small></div>
  </div>`,

  gantt: `<div class="tl-art tl-plan">
    <div class="tl-gm">
      <div class="tl-gm-head">Oct<span>5</span><span>12</span><span>19</span><span>26</span></div>
      <div class="tl-gm-row"><i class="progress" style="--l:6%;--w:38%"></i></div>
      <div class="tl-gm-row"><i class="done" style="--l:24%;--w:34%;--t:0.25s"></i></div>
      <div class="tl-gm-row"><i class="tl-dropped" style="--l:60%;--w:30%;--t:0.5s"></i></div>
      <span class="tl-gm-today"></span>
    </div>
    ${card('DEMO-12', 'Retry payments', 'story', ' tl-dragged', '--x:24px;--y:142px')}
  </div>`,

  focus: `<div class="tl-art tl-focus">
    <div class="tl-capsule">
      <span class="tl-play"></span>
      <b>24:59</b>
      <span class="tl-eq"><i></i><i></i><i></i><i></i></span>
    </div>
    <div class="tl-track"><span>Rain on the window</span><i></i></div>
  </div>`,

  arrange: `<div class="tl-art tl-arrange">
    <div class="tl-fr"><b>Ideas</b></div>
    <i class="tl-st yellow">Split the cron</i>
    <i class="tl-st blue">Ask QA first</i>
    <span class="tl-guide"></span>
  </div>`,
}
