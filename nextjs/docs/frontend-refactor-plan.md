# Kế hoạch refactor frontend: `app / features / entities / common / server`

> Phạm vi: `nextjs/src/`. Không đổi URL, không đổi hành vi, không thêm màn hình mới.
> Mục tiêu: nhiều người cùng code mà ít đụng nhau, và khi có lỗi thì biết ngay phải mở folder nào.

---

## 1. Hiện trạng (đo trên nhánh `main`, commit `8a628d7`)

| Vấn đề | Chi tiết | Hậu quả |
|---|---|---|
| **3 HTTP client** | `lib/api/client.ts` (`ApiClient`), `lib/api-client.ts` (`apiFetch` + ~40 hàm, 16 file dùng), `core/api/client.ts` (không ai dùng) | Mỗi chỗ báo lỗi một kiểu, xử lý token một kiểu, nên debug phải đoán đang đi qua client nào |
| **Cây code song song bỏ dở** | `src/core/`, `src/components/`, `src/app/workspace/`, khoảng 3.000 dòng. App đang chạy **không import** file nào. Nhiều endpoint gọi tới không tồn tại (`/api/sources`, `/api/runs/{id}/cancel`, `/api/schedules/{id}/run`), `billing`/`usage` trả số giả | Người mới đọc nhầm, sửa nhầm chỗ |
| **Biên server/client không rõ** | `lib/actions/data.ts` có `'use server'`, 34 hàm Prisma, hiện chỉ route handler dùng | Nếu một client component import nó, mọi hàm thành server action công khai và bỏ qua bước kiểm tra của route |
| **God component** | `DevelopLayout.tsx` dài 2.182 dòng, 60 `useState`, 14 `useEffect`, 36 lời gọi API | Ai sửa Develop cũng đụng file này, nên conflict liên tục |
| Component lớn khác | `SourceControlPanel.tsx` (1.197 dòng, 26 `useState`), `ConnectionDialog.tsx` (1.150), `FileExplorer/index.tsx` (862), `SourceDialog.tsx` (750) | |
| `lib/` là túi đồ tạp | 45 file lẫn auth, crypto, Prisma, parser log, chart, AI provider | Không biết file nào chạy được ở trình duyệt |
| Test | 28 file vitest trong `test/`, chỉ cho `lib/` và route handler, chưa có test component | |

---

## 2. Cấu trúc đích

```
src/
├── app/            CỬA VÀO. Mỗi URL là một trang. Chỉ ghép, không chứa logic.
│   ├── (auth)/     login, logout
│   ├── (app)/      page.tsx (/), develop/, orchestrate/, explore/, data/, settings/
│   └── api/        route handler: kiểm tra session rồi gọi features/*/server.ts
│
├── features/       CHỨC NĂNG. Mỗi folder là một việc người dùng làm, và có một owner.
│   ├── home/           trang tổng quan
│   ├── projects/       tạo, xoá, đổi tên, khôi phục project; ProjectSettingsDialog
│   ├── develop/        IDE: cây file, tab editor, terminal, lineage, compiled SQL, preview
│   ├── git/            commit, push, pull, diff, lịch sử, credential
│   ├── connections/    danh bạ warehouse: lưu, sửa, test
│   ├── ingest/         nguồn dlt (sql_database / rest_api / filesystem), chạy ingest
│   ├── lakehouse/      DuckLake, publish Iceberg
│   ├── orchestrate/    lịch sử run, schedule
│   ├── explore/        SQL console, catalog, chart, dashboard
│   ├── assistant/      khung chat dsh-agent (dùng trong Develop và Explore)
│   └── settings/       AI provider (key, base URL)
│
├── entities/       THỰC THỂ DÙNG CHUNG. Thứ mà từ 2 feature trở lên cùng nhắc tới.
│   ├── project/        kiểu Project, getProjects, bộ chọn project
│   ├── connection/     kiểu Connection, danh sách, dropdown chọn connection
│   ├── run/            kiểu Run, RunStatusBadge, formatter, parse log, useDbtRunStream
│   ├── file/           filesApi (Develop, Explore vì dashboard là file YAML, Assistant)
│   └── target/         kiểu ProjectTarget, getProjectTargets (Develop, Orchestrate)
│
├── common/         GẠCH XÂY NHÀ. Không biết gì về dbt.
│   ├── ui/             button, input, dialog, card, dropdown-menu, alert-dialog, textarea
│   ├── components/     CodeEditor (Monaco), EmptyState, BrandMark, icon
│   ├── layout/         AppLayout, Sidebar, TopBar, PageHeader, PageTabs, navigation.ts
│   ├── api/            MỘT client duy nhất: gửi request, gắn token, chuẩn hoá lỗi
│   ├── hooks/          useSseStream (đọc luồng SSE), useDebounce…
│   ├── lib/            cn(), clipboard, clientLogs
│   ├── model/          hàm thuần không dính dbt (format thời gian, byte…)
│   ├── types.ts
│   └── index.ts
│
├── server/         CHỈ SERVER. Mọi file mở đầu bằng `import 'server-only'`.
│   ├── auth/           auth.ts, auth.config.ts, auth-refresh, auth-headers, oidc
│   ├── db.ts           Prisma client. Chỉ server/ và features/*/server.ts được import.
│   ├── crypto.ts
│   ├── session.ts
│   ├── host-guard.ts
│   ├── origin.ts
│   └── proxy.ts        chuyển tiếp request xuống dbt-runner và dsh-agent
│
└── types/          bổ sung kiểu cho thư viện ngoài (next-auth.d.ts)
```

### 2.1 Bên trong một feature (chỉ tạo những gì cần)

```
features/orchestrate/
├── components/     phần nhìn thấy, chỉ nhận props và hiển thị
├── hooks/          giữ trạng thái và gọi dữ liệu
├── model/          hàm thuần, có test (cron.ts, formatters…)
├── api.ts          các lời gọi từ trình duyệt lên /api/*
├── server.ts       truy vấn Prisma của feature. `import 'server-only'`. Chỉ app/api/* gọi.
├── types.ts
└── index.ts        CỬA TRƯỚC: chỉ export thứ bên ngoài được dùng
```

**Không có `actions.ts`.** Trình duyệt luôn gọi qua `app/api/*`. Route handler tự kiểm tra session để trả về 401 thay vì redirect (xem CLAUDE.md). Nếu sau này thật sự cần server action, phải bàn trước rồi ghi vào mục 3.

### 2.2 Entity và feature khác nhau thế nào

- **Entity**: *một thứ là gì*. Gồm kiểu dữ liệu, cách lấy danh sách, và một component nhỏ hiển thị nó (badge, dropdown chọn). Không có màn hình.
- **Feature**: *người dùng làm gì với nó*. Gồm màn hình, form, dialog, luồng thao tác.
- Nếu không chắc: một thứ chỉ một feature dùng thì để trong feature đó. Khi feature thứ hai cần đến thì mới chuyển xuống `entities/`, trong cùng PR đó.

---

## 3. Quy tắc (lint kiểm tra, không chỉ ghi ra giấy)

### 3.1 Ai được import ai

```
app       → features, entities, common, server (server chỉ trong route handler và server component)
features  → entities, common, feature khác QUA index.ts
entities  → common
common    → common
server    → server, types của entities/features
```

| Quy tắc | Lý do |
|---|---|
| Trong cùng một feature dùng import tương đối (`./hooks/useRuns`) | Giúp lint phân biệt import nội bộ với import từ feature khác |
| Sang feature khác chỉ qua `@/features/git`, **cấm** `@/features/git/components/...` | Owner của feature đó được tự do sắp xếp bên trong |
| Không được có import vòng (`import/no-cycle`) | Import vòng là dấu hiệu cần tách một entity |
| `@prisma/client` và `@/server/db` chỉ dùng được trong `server/**` và `features/*/server.ts` | Không để Prisma lọt ra trình duyệt |
| File có `'use client'` không được import `server/**` hay `*/server.ts` | Gói `server-only` sẽ làm build lỗi, lint chặn sớm hơn |

### 3.2 Cấu hình ESLint (thêm vào `eslint.config.mjs`)

```js
const restrict = (groups, message) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: groups, message }] }],
});

// thêm vào mảng eslintConfig
{
  files: ["src/common/**"],
  rules: restrict(["@/features/*", "@/entities/*", "@/server/*", "@/app/*"],
    "common/ không được biết về domain hay server"),
},
{
  files: ["src/entities/**"],
  rules: restrict(["@/features/*", "@/server/*", "@/app/*"],
    "entities/ chỉ được dùng common/"),
},
{
  files: ["src/features/**"],
  ignores: ["src/features/*/server.ts"],
  rules: restrict(["@/features/*/*", "@/server/*", "@/app/*", "@prisma/client"],
    "Sang feature khác qua index.ts; code server để trong server.ts"),
},
{
  files: ["src/**"],
  rules: { "import/no-cycle": ["error", { maxDepth: 5 }] },
},
```

Giai đoạn chuyển tiếp để các rule ở mức `"warn"`. Phase 7 mới chuyển thành `"error"`.

### 3.3 Quy ước đặt tên

- Component: `PascalCase.tsx`. Hook: `useXxx.ts`. Hàm thuần: `kebab-case.ts`.
- Một component không quá **400 dòng**. Quá thì tách hook hoặc component con.
- Test đặt ở `test/<layer>/<feature>/xxx.unit.test.ts` để giữ cấu hình vitest hiện tại.

### 3.4 Làm việc nhiều người

- `CODEOWNERS`: mỗi `features/*` có một owner. `common/`, `server/` và `eslint.config.mjs` cần thêm một reviewer chung.
- PR đổi `common/ui` hoặc `entities/*` phải ghi rõ trong mô tả những feature nào bị ảnh hưởng.
- Một PR chỉ làm **một** trong hai việc: *di chuyển* (chỉ đổi đường dẫn) hoặc *thay đổi* (sửa logic), không làm cả hai.

---

## 4. Bảng chuyển file

`cv2/` là `src/components-v2/`.

### 4.1 Xoá (không ai import)

| Đường dẫn | Ghi chú |
|---|---|
| `src/core/**` | Cây song song bỏ dở. Copy `ApiError` và phần build `params` sang bước 2.1 trước khi xoá |
| `src/components/**` | UI kit và workspace trùng lặp |
| `src/app/workspace/**` | Route `/workspace/*` không có trong navigation |
| `src/lib/clipboard.ts`, `src/lib/dbt/intellisense.ts`, `src/lib/git/credentialStore.ts` | Không thấy import trực tiếp. **Kiểm tra lại** các re-export qua `index.ts` trước khi xoá |

### 4.2 `common/`

| Hiện tại | Đích |
|---|---|
| `cv2/ui/*` | `common/ui/*` |
| `cv2/shared/CodeEditor.tsx`, `EmptyState.tsx`, `BrandMark.tsx` | `common/components/*` |
| `cv2/icons/assets/DbtIcon.tsx` | `common/components/icons/DbtIcon.tsx` |
| `cv2/layout/*` (gồm `navigation.ts`, `Sidebar.tsx`) | `common/layout/*` |
| `cv2/observability/ClientErrorReporter.tsx` | `common/components/ClientErrorReporter.tsx` |
| `lib/api/client.ts` + `lib/api-client.ts#apiFetch` | `common/api/client.ts` (gộp, xem Phase 2) |
| `lib/utils.ts`, `lib/clientLogs.ts`, `lib/branding.ts` | `common/lib/*` |
| `lib/monaco-loader.ts` | `common/components/monaco-loader.ts` |
| `lib/context/GlobalContext.tsx` | `common/layout/GlobalContext.tsx` |
| phần đọc SSE trong `lib/hooks/use*Stream.ts` | `common/hooks/useSseStream.ts` (mới) |

`cv2/shared/CodeEditor.tsx` hiện import `lib/explore-data`. Muốn nó thuộc `common/` thì phải bỏ phụ thuộc đó (truyền vào qua props), còn không thì chuyển nó sang `features/explore`.

### 4.3 `server/`

| Hiện tại | Đích |
|---|---|
| `lib/db.ts`, `lib/crypto.ts`, `lib/session.ts`, `lib/host-guard.ts`, `lib/origin.ts` | `server/*` |
| `lib/auth.ts`, `lib/auth.config.ts`, `lib/auth-refresh.ts`, `lib/auth-headers.ts`, `lib/oidc.ts` | `server/auth/*` |
| `lib/auth-constants.ts`, `lib/auth-errors.ts` | `server/auth/` nếu chỉ server dùng. Trang login (client) cũng dùng, nên phần hằng số dùng chung để ở `common/lib/auth-constants.ts` |
| `lib/api/proxy.ts` | `server/proxy.ts` |
| `lib/actions/data.ts` | tách ra `features/*/server.ts` (xem 4.5), bỏ `'use server'` |

### 4.4 `entities/`

| Hiện tại | Đích |
|---|---|
| phần project trong `lib/api-client.ts` (`getProjects`, `toSnakeProject`…) | `entities/project/api.ts`, `types.ts` |
| phần connection trong `lib/api-client.ts`, `lib/api/connection.ts` | `entities/connection/api.ts` |
| `cv2/runs/RunStatusBadge.tsx`, `formatters.ts`, `types.ts` | `entities/run/components/`, `model/`, `types.ts` |
| `lib/dbt-run-logs.ts`, `lib/hooks/useDbtRunStream.ts` | `entities/run/model/dbt-run-logs.ts`, `hooks/useDbtRunStream.ts` |
| `lib/api/files.ts`, `lib/hooks/useFileWatcher.ts` | `entities/file/api.ts`, `hooks/useFileWatcher.ts` |
| `ProjectTargetRow`, `getProjectTargets` trong `lib/api-client.ts` | `entities/target/` |

### 4.5 `features/`

| Feature | Lấy từ |
|---|---|
| `home` | `cv2/dashboard/DashboardOverview.tsx` |
| `projects` | `cv2/develop/{NewProjectForm,ProjectCard,ProjectList,ConnectionCheckDialog}.tsx`, `cv2/develop/transforms/{Delete,HardDelete,Rename,Restore}ProjectDialog.tsx`, `cv2/develop/settings/*` (ProjectSettingsDialog, TargetsPanel, EnvVarsPanel, LakehousePanel), `lib/api/env-vars.ts`. **server.ts**: phần Projects, Targets, Env vars trong `data.ts` |
| `develop` | `cv2/develop/DevelopLayout.tsx`, `cv2/develop/types.ts`, `cv2/develop/transforms/{Dialogs,EditorTabs,FileExplorer,RightPanel,TerminalPanel}`, `cv2/develop/workspace/{CodeEditor,CompiledSQLView,LineageView,QueryPlanView,QueryResultsTable,TerminalOutput}.tsx`, `lib/api/dbt.ts`, `lib/dbt-command-args.ts` (`model/`, **nơi duy nhất** thêm `--target`), `lib/develop-session.ts`, `lib/hooks/useDbtIntellisense.ts` |
| `git` | `cv2/develop/git/*`, `cv2/develop/workspace/{SourceControlPanel,CommitHistory,DiffEditor}.tsx`, `lib/api/git.ts`, `lib/git/*` |
| `connections` | `cv2/connections/*`. **server.ts**: phần Connections trong `data.ts` |
| `ingest` | `cv2/sources/*`, `lib/ingest-source-validation.ts` (`model/`), `lib/hooks/useIngestStream.ts`, các hàm ingest trong `lib/api-client.ts`. **server.ts**: phần Ingest trong `data.ts` |
| `lakehouse` | `cv2/lakehouse/LakehouseView.tsx`, `lib/lakehouse.ts` (`model/`), các hàm Iceberg/Lakehouse trong `lib/api-client.ts` |
| `orchestrate` | `cv2/runs/{RunsView,RunDetail,RunLogConsole}.tsx`, `cv2/schedules/*`, `lib/cron.ts` (`model/`), các hàm schedule trong `lib/api-client.ts`. **server.ts**: phần Runs, Schedules trong `data.ts` |
| `explore` | `cv2/explore/*`, `lib/board.ts`, `lib/query-chart.ts`, `lib/explore-data.ts`, `lib/dashboard-guide.ts` (`model/`) |
| `assistant` | `cv2/develop/agent/*` (AgentPanel, Markdown, markdown-code), `lib/hooks/useAgentStream.ts`, `lib/hooks/useAgentAvailability.ts`, `lib/explore-agent.ts` (`model/`) |
| `settings` | `cv2/settings/AssistantProvidersCard.tsx`, `lib/ai-provider-form.ts`, `lib/ai-provider-definitions.ts` (`model/`). **server.ts**: `lib/ai-providers.ts`, `lib/ai-provider-connection.ts` (chỉ route handler dùng) |

---

## 5. Các phase

Mỗi mục đánh số là **một PR**. Phase nào cũng có thể dừng lại mà app vẫn chạy bình thường.

### Phase 0: đo mức hiện tại (1 PR)

1. `npm ci`, sau đó ghi lại kết quả của `tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm test` (cần DB test) và `npm run build` vào `nextjs/docs/refactor-baseline.md`. Từ đây trở đi, mọi PR phải **không tệ hơn** mức này.
2. Thêm script `"typecheck": "tsc --noEmit"`. Thêm gói `server-only`.
3. Thêm các rule ở mục 3.2 ở mức `warn`, ghi số lỗi hiện có.
4. Viết **checklist smoke test** (mục 6) vào cùng file baseline.

### Phase 1: dọn và dựng khung (2 PR)

5. Xoá mọi thứ ở mục 4.1. Rủi ro gần như bằng 0 vì không ai import.
6. Tạo `common/` bằng cách chuyển mọi thứ ở mục 4.2 **trừ** `common/api` và `useSseStream` (hai thứ đó làm ở Phase 2). Chỉ `git mv` và sửa import. Cập nhật đường dẫn trong CLAUDE.md (`navigation.ts`, `Sidebar.tsx`).

### Phase 2: một HTTP client (2 PR)

7. Tạo `common/api/client.ts` bằng cách gộp:
   - từ `lib/api/client.ts`: `getDbtRunnerUrl`, `getAgentUrl`, session ID của dbt, gắn bearer token và refresh token;
   - từ `lib/api-client.ts`: cách gọi ngắn gọn như `apiFetch`;
   - thêm mới: `ApiError { status, message, details, url, method }` và phần build `params`.

   Hai file cũ tạm thời chỉ re-export sang file mới. Thêm `test/common/api-client.unit.test.ts` để test: chuẩn hoá lỗi, phản hồi 204, encode params, header session.
8. Sửa các file đang import đi thẳng tới client mới, rồi xoá hai file re-export.

   **Kết quả:** mọi request lỗi đều ném một kiểu lỗi duy nhất, có URL và status. Riêng việc này đã giúp debug nhiều nhất.

### Phase 3: biên server (1 PR)

9. Chuyển mọi thứ ở mục 4.3 vào `server/`. Tách `lib/actions/data.ts` thành các `features/*/server.ts` như ở mục 4.5, và thay `'use server'` bằng `import 'server-only'`.
   - Route handler trong `app/api/*` sửa import sang `features/*/server.ts`.
   - Kiểm tra `revalidatePath` vẫn chạy như cũ.
   - `test/setup.ts` và các test Prisma chỉ cần sửa đường dẫn import.
   - Cập nhật CLAUDE.md: `src/lib/oidc.ts` → `src/server/auth/oidc.ts`, `src/lib/host-guard.ts` → `src/server/host-guard.ts`.

### Phase 4: entities và features (5 PR, chỉ di chuyển)

| PR | Nội dung |
|---|---|
| 10 | `entities/*` (mục 4.4). Tách `lib/api-client.ts` theo entity, chưa xoá file gốc |
| 11 | `features/projects`, `features/git` |
| 12 | `features/develop`, `features/assistant` |
| 13 | `features/connections`, `features/ingest`, `features/lakehouse`, `features/orchestrate` |
| 14 | `features/explore`, `features/settings`, `features/home`. Xoá phần còn lại của `lib/` và `components-v2/` |

Mỗi PR: tạo `index.ts` cho feature, chuyển test tương ứng, cập nhật các đường dẫn CLAUDE.md có nhắc tới (`ConnectionDialog.tsx`, `ProjectSettingsDialog.tsx`, `src/lib/board.ts`, `lib/explore-agent.ts`, `buildDbtCommandWithArgs`).

15. **SSE parser dùng chung.** So sánh định dạng event của `useDbtRunStream`, `useIngestStream` và `useAgentStream`, rồi tách phần chung ra `common/hooks/useSseStream.ts`: đọc từng dòng, parse `event:`/`data:`, xử lý abort, log từng event ở môi trường dev. Nếu hình dạng event khác nhau thì chỉ dùng chung phần parse frame, không ép về một kiểu event. Thêm unit test cho trường hợp một frame bị cắt giữa hai chunk.

### Phase 5: tách god component (4 PR, có đổi hành vi, cần chạy đủ smoke test)

16. **`features/develop/components/DevelopLayout.tsx`**
    - Bước đầu: liệt kê 60 `useState` và gom nhóm (tab/file đang mở, cây file, trạng thái git, lệnh dbt và terminal, lineage và preview, kích thước panel).
    - Mỗi nhóm thành một hook: `features/develop/hooks/useOpenFiles`, `useDbtCommands`, `usePanelLayout`, và `features/git/hooks/useGitStatus`. Logic nhiều nhánh viết thành reducer thuần và có unit test.
    - Mục tiêu: `DevelopLayout` còn dưới 400 dòng, chỉ làm việc ghép.
    - Mỗi commit làm một nhóm, chạy smoke test sau mỗi commit.
17. **`features/git/components/SourceControlPanel.tsx`**: gom 26 `useState` vào `hooks/useSourceControl`, tách ra `StagedList`, `CommitForm`, `History`.
18. **`ConnectionDialog.tsx` và `SourceDialog.tsx`**: tách nhóm field theo từng loại ra `components/fields/<type>.tsx`, theo mẫu `RestSourceFields`/`FileSourceFields` đã có. Vẫn **một** dialog, và danh sách loại phải khớp `dbt-runner/adapters/__init__.py`.
19. **`FileExplorer/index.tsx`** (7 effect), nếu sau bước 16 vẫn còn khó sửa.

### Phase 6: quản lý dữ liệu server thống nhất (tuỳ chọn, 2–3 PR)

20. Thêm `@tanstack/react-query` và **devtools**. Chuyển các lời gọi đọc list/detail sang react-query theo từng entity: project, connection, schedule, run list, ingest source. Devtools cho thấy mọi request đang cache, trạng thái và lỗi của nó, đúng thứ cần để debug. SSE vẫn là hook riêng dùng `useSseStream`.

### Phase 7: khoá lại (1 PR)

21. Chuyển các rule ở mục 3.2 sang `error`. Thêm `CODEOWNERS`. Thêm mục "Frontend layout" vào CLAUDE.md, tóm tắt mục 2 và 3 của file này.

---

## 6. Kiểm tra mỗi PR

**Tự động (mọi PR):** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, kết quả không tệ hơn baseline. PR từ Phase 3 trở đi chạy thêm `npm test`.

**PR chỉ di chuyển:** `git diff -M --stat` phải cho thấy chỉ có rename và sửa import, không có dòng logic nào đổi.

**Smoke test thủ công** (bắt buộc từ Phase 5, khuyến khích từ Phase 3):

1. Đăng nhập và đăng xuất (cả khi `AUTH_DISABLED=true`)
2. `/develop`: tạo project, mở project, đổi tên, xoá và khôi phục
3. Mở model, sửa, lưu, format, compile, preview, xem query plan
4. Chạy `dbt build` và xem log chạy trực tiếp, sau đó huỷ một run
5. Xem lineage của một model
6. Git: xem status, diff, commit, push
7. `/data`: tạo connection, bấm Test; tạo ingest source, chạy ingest, xem log
8. `/orchestrate`: tạo schedule, xem preview cron, xem lịch sử run và chi tiết một run
9. `/explore`: chạy SQL, duyệt catalog, dựng chart, lưu dashboard, mở lại dashboard ở chế độ view
10. Chat với assistant ở Develop và ở Explore
11. `/settings`: thêm AI provider, bấm test

---

## 7. Không làm trong đợt này

- Không thêm route mới, không thêm `/workspace`. Giữ 5 section và sub-page dạng `?tab=` như trong CLAUDE.md.
- Không tạo dialog cài đặt thứ hai. Cấu hình theo project vẫn nằm ở `ProjectSettingsDialog`.
- Không thêm billing, usage, admin, analytics.
- Không thêm `zod`, `sql-formatter`, `yaml` theo kiểu "tiện thì thêm". Format SQL vẫn là `sqlglot` phía server.
- Không đổi API của dbt-runner.

---

## 8. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| PR di chuyển file conflict với các branch đang mở | Merge Phase 1 và Phase 4 vào lúc ít branch mở, báo trước cho team. Mỗi PR chỉ di chuyển, nên rebase chỉ phải sửa đường dẫn |
| Tách `DevelopLayout` làm hỏng hành vi mà test không bắt được | Mỗi commit tách một nhóm state, chạy smoke test sau mỗi commit, reducer thuần có unit test |
| Client component vô tình import code server | `server-only` làm build lỗi, lint chặn từ Phase 0 |
| Sửa `toSnakeProject` ảnh hưởng mọi nơi dùng project | Không làm trong Phase 4. Làm thành PR riêng nếu được duyệt (mục 9) |
| `common/api` mới xử lý token hoặc session khác bản cũ | Unit test trước (bước 7), chuyển nơi dùng sau (bước 8) |

---

## 9. Cần quyết định

1. **Có dùng TanStack Query (Phase 6) không?** Đề xuất: có, chủ yếu để dùng devtools.
2. **Thời điểm merge Phase 1 và Phase 4:** chọn tuần ít branch frontend đang mở.
3. **Có bỏ lớp map snake_case của project (`toSnakeProject`) không?** Đây là dấu vết từ thời dùng Supabase. Nếu bỏ thì làm PR riêng sau PR 10.
4. **Ai là owner của từng feature** (để điền `CODEOWNERS` ở Phase 7).
