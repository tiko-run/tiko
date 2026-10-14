export const DEMO = 'https://demo.tiko.run/demo'
export const DOCS = 'https://docs.tiko.run'
export const REPO = 'https://github.com/tiko-run/tiko'
export const INSTALL_SH = 'curl -fsSL https://tiko.run/install.sh | sh'
export const INSTALL_PS1 = 'irm https://tiko.run/install.ps1 | iex'

export const TITLE = 'tiko: open-source canvas with live Jira and GitHub task cards'
export const DESCRIPTION =
  'A self-hosted infinite canvas where the tasks from your tracker live as cards. Lay them out the way you think, and their statuses update on their own.'

export const FAQ = [
  {
    q: 'What is tiko?',
    a: 'tiko is an open-source, self-hosted whiteboard where the tasks from your tracker live as cards. You lay them out on an infinite canvas with frames, notes and arrows, and each card keeps showing the real status of its task.',
  },
  {
    q: 'Which trackers does tiko work with?',
    a: 'Jira Data Center and Server, and GitHub issues and pull requests. Jira Cloud, Linear and Plane are planned. One board can mix tasks from several trackers.',
  },
  {
    q: 'Does tiko change my tasks?',
    a: 'No. tiko only reads tasks and never edits them. Each person connects their own token and sees what their tracker access allows.',
  },
  {
    q: 'How fresh are the statuses?',
    a: 'Statuses refresh every 30 seconds while a board is open, with one batched request per board. A closed task is struck through.',
  },
  {
    q: 'Where is my data?',
    a: 'On your server, in one SQLite file. Tracker tokens are encrypted and never sent back to the browser. Usage counts carry no personal data and turn off with one setting.',
  },
  {
    q: 'How do I install it?',
    a: 'With one command on Linux, macOS or Windows: the installer sets up Docker if it is missing and starts the latest release. You can also run the Docker Compose file yourself or deploy to Railway or Render.',
  },
  {
    q: 'Is tiko free?',
    a: 'Yes. tiko is free software under AGPL-3.0: run it on your own server for as many people as you like. A hosted tiko Cloud with a free plan is coming.',
  },
]
