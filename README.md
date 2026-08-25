# Claude Session Manager (csm)

[English](#-english) · [한국어](#-한국어)

A terminal-based manager for **Claude Code** sessions. Browse, search, resume,
delete, back up, restore, and analyze token usage across all your Claude Code
conversations — from the command line or a fast keyboard-driven TUI.

---

## 🇺🇸 English

### Features

- **📋 List** — every session across all projects, newest first
- **🔍 Search** — by title, session id, project slug, path, or prompt text
- **▶ Resume** — continue any finished session with `claude -r <id>`
- **🗑 Delete** — move sessions to a trash folder (restorable), or purge them
- **📊 Stats** — token usage per session / project / global (input, output, cache)
- **💾 Backup** — single session, whole project, or everything, as `.tar.gz`
- **📂 Restore** — extract archives anywhere, optionally remapping paths for cross-machine moves
- **🖥 TUI** — full-screen Ink-based interface with keyboard navigation

### Requirements

- Node.js ≥ 18
- Claude Code CLI on your `PATH` (needed for resume)

### Install

```bash
git clone https://github.com/uptodatelabs/claude-session-manager.git
cd claude-session-manager
npm install
npm run build
npm link        # exposes the global `csm` command
```

### Quick start

```bash
csm              # launch the interactive TUI
csm list         # list sessions, newest first
csm list -n 10   # only the 10 most recent
```

### CLI reference

| Command | Description |
|---------|-------------|
| `csm` | Launch the TUI (default when run in a terminal) |
| `csm list [-p <slug>] [-n <count>] [--json]` | List sessions, newest first |
| `csm show <id> [--messages <n>] [--json]` | Session details plus recent messages |
| `csm resume <id>` | Continue a session in Claude Code |
| `csm rm <id>` | Move a session to the trash |
| `csm trash list` | Show trashed sessions |
| `csm trash restore <trash-id>` | Undo a deletion |
| `csm trash purge <trash-id>` | Permanently delete a trashed session |
| `csm stats [-p <slug>] [--json]` | Aggregate token usage |
| `csm backup [<id>] [-p <slug>] [--all] [-o <dir>]` | Create a `.tar.gz` archive |
| `csm restore <archive> [options]` | Restore sessions from an archive |

Session ids may be abbreviated to any unique prefix (e.g. `csm show 4f2a`).

#### `csm restore` options

| Option | Description |
|--------|-------------|
| `-o, --output <dir>` | Target projects directory (default: `~/.claude/projects`) |
| `--remap <path>` | Rewrite every recorded `cwd` in the sessions to `<path>` and file them under the matching slug — makes resumes work after moving machines |
| `--skip-existing` | Do not overwrite session files that already exist at the destination |
| `--dry-run` | Print the archive manifest without writing anything |

### How resume works

`csm resume <id>` reads the working directory recorded inside the session file
and launches Claude there, so file operations and git context pick up exactly
where the conversation left off.

- **macOS / Linux** — Claude runs in the same terminal.
- **Windows** — Claude opens in its own console window. Sharing one console
  between the manager and a native TUI child leaves Claude unresponsive, so a
  dedicated window is launched instead (equivalent to typing `claude -r <id>`
  yourself).

> **Caution:** do not resume a session that another Claude Code process is
> currently writing — two processes appending to the same session file will
> conflict.

### TUI keybindings

| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | Move selection |
| `g` / `G` | Jump to top / bottom |
| `/` | Search (Enter applies, Esc cancels) |
| `Enter` | Open session detail |
| `r` | Resume selected session |
| `d` `d` | Delete (press twice to confirm) |
| `s` | Token statistics view |
| `Esc` | Back / cancel |
| `q` | Quit |

### Data & storage

Sessions are read from Claude Code's own storage at
`~/.claude/projects/<slug>/<uuid>.jsonl`. The manager keeps its own state in
`~/.claude-session-manager/`:

```
~/.claude-session-manager/
├── index.json    # session index cache (incremental, mtime-based refresh)
├── trash/        # deleted sessions + manifest.json (undo-able)
└── logs/
```

Slugs are produced by Claude Code itself (every character outside
`[A-Za-z0-9-]` becomes a dash), so `F:\Github\api_tester` is stored under
`F--Github-api-tester`.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `CSM_PROJECTS_DIR` | Override `~/.claude/projects` (testing, custom setups) |
| `CSM_STATE_DIR` | Override `~/.claude-session-manager` |

### Statistics notes

Token numbers are summed directly from the `usage` fields recorded in each
session (`input`, `output`, `cache_creation`, `cache_read`). There is no cost
estimation — figures are exact, not modeled.

### Cross-machine backup & restore

```bash
# Machine A
csm backup abc12345 -o ./backups

# copy backups/*.tar.gz to machine B, then:
csm restore ./backups/<archive>.tar.gz --remap /home/me/MyProject
```

`--remap` rewrites every recorded working directory inside the session files
to the new location and files them under the slug derived from it, so
`claude -r <id>` works on the target machine.

### Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # unit tests (vitest)
npm run e2e        # end-to-end verification of every CLI feature (50 checks)
npm run lint       # eslint
npm run dev -- list   # run from source without building
```

Project layout:

```
src/
├── core/     # scanner, reader, indexer, stats, actions (data layer)
├── ui/       # App, ListView, DetailView, StatsView (Ink TUI)
├── utils/    # formatting, shared IO helpers
└── cli.ts    # commander entry point
scripts/
└── e2e-verify.mjs
tests/        # unit tests + fixtures
```

### Known limitations

- Interactive TUI behaviour is verified through rendering tests; automated
  end-to-end keypress testing requires a real pseudo-terminal.
- Backups contain session `.jsonl` files only — project memory directories are
  not included.
- On Windows, resuming opens a separate console window (see above).

### License

MIT

---

## 🇰🇷 한국어

**Claude Code** 세션을 위한 터미널 기반 매니저입니다. 세션 탐색·검색·재개·삭제·백업·복원, 토큰 사용량 분석을 커맨드 라인과 키보드 중심 TUI로 처리합니다.

### 주요 기능

- **📋 목록** — 모든 프로젝트의 세션을 최신순으로 표시
- **🔍 검색** — 제목, 세션 ID, 프로젝트 슬러그, 경로, 프롬프트 본문으로 검색
- **▶ 재개** — 완료된 세션을 `claude -r <id>` 로 이어서 작업
- **🗑 삭제** — 휴지통 이동(복구 가능) 또는 영구 삭제
- **📊 통계** — 세션/프로젝트/전체 토큰 사용량 (input, output, cache)
- **💾 백업** — 단일 세션, 프로젝트 전체, 전체 세션을 `.tar.gz` 로 보관
- **📂 복원** — 어디든 추출 가능, `--remap` 으로 다른 머신 이동 시 경로 재매핑
- **🖥 TUI** — Ink 기반 전체 화면 인터페이스, 키보드 조작

### 요구 사항

- Node.js ≥ 18
- `PATH`에 Claude Code CLI 설치 (resume에 필요)

### 설치

```bash
git clone https://github.com/uptodatelabs/claude-session-manager.git
cd claude-session-manager
npm install
npm run build
npm link        # 전역 `csm` 명령어 생성
```

### 빠른 시작

```bash
csm              # 대화형 TUI 실행
csm list         # 세션 목록 (최신순)
csm list -n 10   # 최근 10개만
```

### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `csm` | TUI 실행 (터미널에서 실행 시 기본) |
| `csm list [-p <slug>] [-n <count>] [--json]` | 세션 목록, 최신순 |
| `csm show <id> [--messages <n>] [--json]` | 세션 상세 + 최근 메시지 |
| `csm resume <id>` | Claude Code에서 세션 이어서 작업 |
| `csm rm <id>` | 세션을 휴지통으로 이동 |
| `csm trash list` | 휴지통 목록 조회 |
| `csm trash restore <trash-id>` | 삭제 취소 (복원) |
| `csm trash purge <trash-id>` | 휴지통에서 영구 삭제 |
| `csm stats [-p <slug>] [--json]` | 토큰 사용량 집계 |
| `csm backup [<id>] [-p <slug>] [--all] [-o <dir>]` | `.tar.gz` 백업 생성 |
| `csm restore <archive> [options]` | 백업 아카이브에서 복원 |

세션 ID는 고유하게 식별되는 범위까지 축약 가능합니다 (예: `csm show 4f2a`).

#### `csm restore` 옵션

| 옵션 | 설명 |
|------|------|
| `-o, --output <dir>` | 복원 대상 projects 디렉터리 (기본값: `~/.claude/projects`) |
| `--remap <path>` | 세션 파일 안의 기록된 `cwd`를 모두 `<path>`로 재기록하고 해당 슬러그 폴더에 배치 — 다른 머신으로 옮긴 뒤 resume이 동작하게 함 |
| `--skip-existing` | 대상 위치에 이미 있는 세션 파일은 덮어쓰지 않음 |
| `--dry-run` | 아무것도 쓰지 않고 아카이브 내역만 출력 |

### resume 동작 방식

`csm resume <id>`는 세션 파일에 기록된 작업 디렉터리(`cwd`)를 읽어 그 위치에서 Claude를 실행합니다. 따라서 파일 작업과 git 컨텍스트가 대화가 끊겼던 지점 그대로 이어집니다.

- **macOS / Linux** — 같은 터미널에서 Claude 실행
- **Windows** — Claude 전용 콘솔 창을 새로 열어 실행. 매니저와 네이티브 TUI 자식 프로세스가 하나의 콘솔을 공유하면 Claude가 입력을 받지 못하는 문제가 있어, 전용 창 방식을 사용합니다 (`claude -r <id>` 를 직접 입력한 것과 동일하게 동작)

> **주의:** 다른 Claude Code 프로세스가 지금 쓰고 있는 세션을 resume하지 마세요. 두 프로세스가 같은 세션 파일에 동시에 기록되어 충돌합니다.

### TUI 단축키

| 키 | 동작 |
|----|------|
| `↑`/`↓` 또는 `j`/`k` | 선택 이동 |
| `g` / `G` | 맨 위 / 맨 아래 |
| `/` | 검색 (Enter 적용, Esc 취소) |
| `Enter` | 세션 상세 보기 |
| `r` | 선택한 세션 resume |
| `d` `d` | 삭제 (두 번 눌러 확인) |
| `s` | 토큰 통계 화면 |
| `Esc` | 뒤로 가기 / 취소 |
| `q` | 종료 |

### 데이터 및 저장 위치

세션은 Claude Code의 저장소인 `~/.claude/projects/<slug>/<uuid>.jsonl` 에서 읽습니다. 매니저 자체 상태는 `~/.claude-session-manager/` 에 보관됩니다:

```
~/.claude-session-manager/
├── index.json    # 세션 인덱스 캐시 (mtime 기반 증분 갱신)
├── trash/        # 삭제된 세션 + manifest.json (복구 가능)
└── logs/
```

슬러그는 Claude Code가 생성한 것을 그대로 사용합니다 (`[A-Za-z0-9-]` 외 모든 문자는 대시로 변환). 예: `F:\Github\api_tester` → `F--Github-api-tester`.

### 환경 변수

| 변수 | 용도 |
|------|------|
| `CSM_PROJECTS_DIR` | `~/.claude/projects` 대체 (테스트, 커스텀 환경) |
| `CSM_STATE_DIR` | `~/.claude-session-manager` 대체 |

### 통계 참고 사항

토큰 수치는 세션 파일에 기록된 `usage` 필드(input, output, cache_creation, cache_read)를 직접 합산한 값입니다. 비용 추정은 하지 않으며, 수치는 정확한 값입니다.

### 머신 간 백업 & 복원

```bash
# A 머신
csm backup abc12345 -o ./backups

# backups/*.tar.gz 를 B 머신으로 복사한 뒤:
csm restore ./backups/<archive>.tar.gz --remap /home/me/MyProject
```

`--remap`은 세션 파일 안의 모든 작업 디렉터리 기록을 새 위치로 다시 쓰고, 그 경로에서 파생된 슬러그 폴더에 배치합니다. 덕분에 B 머신에서도 `claude -r <id>` 가 정상 동작합니다.

### 개발

```bash
npm install
npm run build      # TypeScript → dist/ 컴파일
npm test           # 단위 테스트 (vitest)
npm run e2e        # 모든 CLI 기능 E2E 검증 (50개 체크)
npm run lint       # eslint
npm run dev -- list   # 빌드 없이 소스에서 실행
```

프로젝트 구조:

```
src/
├── core/     # scanner, reader, indexer, stats, actions (데이터 레이어)
├── ui/       # App, ListView, DetailView, StatsView (Ink TUI)
├── utils/    # 포맷 유틸, 공용 IO 헬퍼
└── cli.ts    # commander 진입점
scripts/
└── e2e-verify.mjs
tests/        # 단위 테스트 + 픽스처
```

### 알려진 제약

- TUI 인터랙티브 동작은 렌더링 테스트로 검증합니다. 실제 키 입력 E2E에는 실제 PTY가 필요합니다.
- 백업에는 세션 `.jsonl` 파일만 포함되며, 프로젝트 메모리 디렉터리는 포함되지 않습니다.
- Windows에서는 resume 시 별도 콘솔 창이 열립니다 (위 설명 참고).

### 라이선스

MIT
