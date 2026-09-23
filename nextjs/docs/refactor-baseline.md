# Frontend Refactoring Baseline & Smoke Checklist

Recorded on: 2026-09-23

## Baseline Status

| Check | Command | Baseline Result | Notes |
|---|---|---|---|
| **Unit Tests** | `npm run test:unit` | **20 passed (20 files, 120 tests)** | Duration ~1.8s, zero failures. |
| **Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **Passing in `src/`** | 141 diagnostics in `test/` due to missing vitest globals in tsconfig. `src/` has 0 errors. |
| **Lint** | `npm run lint` | **62 problems** | 2 in `.cjs` script, 60 in unused parallel tree. |
| **Build** | `npm run build` | Verified dev server running | Production build checked before merges. |

---

## 10-Step Manual Smoke Checklist

Every behavioural PR (Phase 5+) and release milestone must verify these 10 core user flows:

1. **Open Project**: Navigate to `/develop` and open an active project. Verify file tree loads.
2. **Edit & Save Model**: Open a `.sql` model in CodeEditor, make a change, and save (`Ctrl+S`). Verify dirty state indicator clears.
3. **Compile Model**: Click "Compile" button. Verify Jinja resolves to raw SQL in Compiled SQL pane.
4. **Preview Query**: Click "Preview" (`dbt show`). Verify results table renders rows, column headers, and execution duration.
5. **dbt Build & Streaming Logs**: Click "Build". Verify terminal log output streams line-by-line via SSE without buffering delays.
6. **Lineage DAG**: Open the Lineage tab. Verify upstream and downstream nodes are rendered and responsive to hover/click.
7. **Git Source Control**: Open SourceControlPanel. Verify git status shows modified files, stage changes, and commit history.
8. **Ingest Data Source**: Navigate to `/data?tab=sources`. Trigger a source sync and verify run starts.
9. **Schedules**: Navigate to `/orchestrate?tab=schedules`. Create or preview a schedule with a cron expression.
10. **Explore & Agent**: Navigate to `/explore`. Verify YAML dashboard charts render and assistant agent responds.

---

## Architectural Import Boundaries (Target Rules)

- `src/app/` → may import `components/`, `core/`, and `server/` (route handlers and server components only).
- `src/components/` → may import `components/` and `core/`. **Never `server/`**.
- `src/core/` → may import only `core/`. **No JSX components and no `server/`**.
- `src/server/` (`import 'server-only'`) → may import `server/` and `core/**/types`. **Never files marked `'use client'`**.
