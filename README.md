# Claude Session Manager (csm)

A terminal-based manager for **Claude Code** sessions. Browse, search, resume,
delete, backup, restore, and analyze token usage across all your Claude Code
conversations — all from the command line or a fast TUI.

![CLI](https://img.shields.io/badge/CLI-OK-green)
![TUI](https://img.shields.io/badge/TUI-Ink_7-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## Features

- **📋 List** — all sessions across projects, newest first
- **🔍 Search** — by title, session ID, project slug, or prompt content
- **▶ Resume** — spawn `claude -r <id>` in the right directory
- **🗑 Delete** — move to trash (undo-able), permanently purge
- **📊 Stats** — token usage per session / project / global (input, output, cache)
- **💾 Backup** — single session, project, or full archive (`.tar.gz`)
- **📂 Restore** — extract archives, with `--remap` for cross-machine cwd paths
- **🖥 TUI** — full-screen terminal UI with keyboard navigation (Ink 7)

---

## Quick Start

```bash
# Install globally
npm install -g .

# Or run from the project directory
npm run dev -- list
```

### Commands

| Command | Description |
|---------|-------------|
| `csm` | Launch the TUI (default) |
| `csm list` | List sessions, newest first |
| `csm show <id>` | Show session details + recent messages |
| `csm resume <id>` | Resume a session in Claude Code |
| `csm rm <id>` | Move a session to the trash |
| `csm trash list` | View trashed sessions |
| `csm trash restore <id>` | Undo a deletion |
| `csm trash purge <id>` | Permanently delete a trash entry |
| `csm stats` | Aggregate token usage across sessions |
| `csm backup <id> \| --project <slug> \| --all` | Create a `.tar.gz` archive |
| `csm restore <file> [--remap <path>]` | Restore from a backup archive |

### TUI Keybindings

| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | Navigate sessions |
| `/` | Start search |
| `Enter` | View session details |
| `r` | Resume selected session |
| `d` | Delete (press twice to confirm) |
| `s` | Token statistics view |
| `q` | Quit |

---

## Data & Storage

All session data is read from Claude Code's storage at
`~/.claude/projects/<slug>/<uuid>.jsonl`.  The manager maintains its own cache
at `~/.claude-session-manager/`:

```
~/.claude-session-manager/
├── index.json          # Fast session index (mtime-based incremental refresh)
├── trash/              # Deleted sessions (undo-able)
│   ├── manifest.json
│   └── <timestamp>_<id>.jsonl
└── logs/               # Diagnostic logs
```

### Environment variables

| Variable | Purpose |
|----------|---------|
| `CSM_PROJECTS_DIR` | Override `~/.claude/projects` (useful for testing) |
| `CSM_STATE_DIR` | Override `~/.claude-session-manager` |

---

## Cross-machine backup & restore

Backup a session on one machine and restore it on another:

```bash
# Machine A
csm backup abc12345 -o ./backups

# Copy to Machine B, then:
csm restore ./backups/*.tar.gz --remap /home/user/MyProject
```

The `--remap` flag rewrites all `cwd` paths in the session file to match the
new location, so `claude -r <id>` works correctly on the target machine.

---

## Development

```bash
npm install
npm run build
npm test
# or
npm run dev -- list
```

The project uses **TypeScript** (`NodeNext` ESM), **Ink 7** (React 19) for the
TUI, and **Vitest** for testing.

### Project structure

```
src/
├── core/        # Data layer: scanner, reader, indexer, stats, actions
├── ui/          # Ink TUI: App, ListView, DetailView, StatsView
├── utils/       # Formatting, I/O helpers
└── cli.ts       # Entry point (commander CLI)
tests/
├── helpers.ts
├── paths.test.ts, reader.test.ts, scanner.test.ts, indexer.test.ts
├── stats.test.ts, actions.test.ts
└── tui-render.test.tsx
```

---

## License

MIT