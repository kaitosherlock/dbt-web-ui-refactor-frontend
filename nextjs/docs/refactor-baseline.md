# Phase 0 baseline — Frontend refactor

Đo trên `nextjs/` tại commit `fd5b9d7` (nhánh `claude/frontend-architecture-refactor-740f7a`),
sau `npm ci` + `npx prisma generate`. Mọi PR từ Phase 1 trở đi phải **không tệ hơn** bảng dưới đây.

## Môi trường đo

- Node v24.17.0, npm 11.13.0
- Postgres test DB: container `dbt-craft-postgres` (đã chạy sẵn từ trước, không phải do refactor
  này khởi động), database `dbtcraft_test`, migrate bằng `scripts/setup-test-db.sh`

## Kết quả từng lệnh

| Lệnh | Kết quả | Ghi chú |
|---|---|---|
| `npx tsc --noEmit` | **FAIL** (exit 2), nhưng `src/**` sạch (0 lỗi) | 139/140 lỗi đều ở `test/**`, do `tsconfig.json` chưa khai `"types": ["vitest/globals"]` — lỗi có sẵn từ trước, không phải do đợt refactor. 1 lỗi còn lại (`monaco-loader.unit.test.ts`) là kiểu mock monaco thiếu field, cũng có sẵn từ trước. |
| `npm run lint` | **FAIL** (62 lỗi) | **100% nằm trong `src/core/`, `src/components/`, `src/app/workspace/`** — cây song song bỏ dở, sẽ bị xoá ở Phase 1 bước 5. Ngoài ra `scripts/*.cjs` (3 file) lỗi `no-require-imports`, có sẵn từ trước, ngoài phạm vi refactor. |
| `npm run test:unit` | **PASS** | 20 file, 120 test |
| `npm test` (full, cần DB test) | **PASS** | 28 file, 202 test, 75.98s |
| `npm run build` | **FAIL** ở bước lint-trong-build | TypeScript compile **thành công** (`✓ Compiled successfully in 75s`). Toàn bộ lỗi khiến build fail đều là các lỗi lint liệt kê ở trên, tức cùng nằm trong cây `core/`/`components/`/`app/workspace/` sẽ bị xoá. |

## Kết luận

Sau khi xoá cây song song bỏ dở (Phase 1, bước 5), dự kiến:
- `npm run lint` → PASS (còn lại chỉ 3 lỗi `scripts/*.cjs` có sẵn từ trước, không thuộc phạm vi)
- `npm run build` → PASS
- `npx tsc --noEmit` trên `src/**` → đã sạch, giữ nguyên

Baseline áp dụng từ đây: **`src/` (không tính `test/**`) phải luôn 0 lỗi TypeScript, `npm run lint`
và `npm run build` phải xanh sau Phase 1, `test:unit` 120/120 và `test` 202/202 phải luôn pass**
(số lượng test có thể tăng khi thêm test mới trong lúc refactor, nhưng không được giảm hoặc chuyển
từ pass sang fail).

## Việc đã làm trong Phase 0

- Thêm script `"typecheck": "tsc --noEmit"` vào `package.json`.
- Thêm gói `server-only` vào `dependencies` (dùng từ Phase 3).
- Thêm 3 rule ranh giới import vào `eslint.config.mjs`, ở mức **`warn`** (mục 3.2 của plan):
  `common/` không được import `features/entities/server/app`, `entities/` không được import
  `features/server/app`, `features/*` (trừ `server.ts`) không được import sang feature khác trừ
  qua `index.ts`, và `import/no-cycle` toàn repo. **Số vi phạm hiện tại: 0**, vì `src/common/`,
  `src/entities/`, `src/features/`, `src/server/` chưa tồn tại — các rule này chưa bắt được gì,
  sẽ có tác dụng dần khi Phase 1–4 tạo ra các thư mục đó.

## Việc chưa làm (nằm ngoài phạm vi refactor này)

- Không sửa 139 lỗi typecheck trong `test/**` (thiếu `vitest/globals`) — có thể sửa riêng bằng
  cách thêm `"types": ["vitest/globals"]` vào `tsconfig.json`, nhưng đó là sửa cấu hình test,
  không phải sửa kiến trúc frontend.
- Không sửa 3 lỗi lint trong `scripts/*.cjs`.
- Không chạy `npm audit fix` (17 vulnerability có sẵn, ngoài phạm vi).

## Checklist smoke test thủ công

Xem mục 6 trong [frontend-refactor-plan.md](./frontend-refactor-plan.md). Bắt buộc chạy từ Phase 5
trở đi (khi tách `DevelopLayout` và các component lớn), khuyến khích chạy từ Phase 3.
