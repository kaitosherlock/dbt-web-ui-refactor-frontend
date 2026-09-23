# UX findings from the Databricks walkthrough (2026-09-24 ~03:30)

1. ConnectionDialog, Databricks: Schema is labelled "(optional)" but dbt runs
   require it (backend refuses a Databricks target without schema). Mark it
   required and validate before save. Same check for Snowflake schema.
2. ConnectionDialog: switching Auth Type (PAT -> OAuth M2M, or Snowflake
   password -> keypair) keeps the "leave blank to keep existing" hint for the
   new secret field although nothing is stored for that mode yet. Show the
   "keep existing" hint only when the stored auth_type equals the selected one;
   otherwise the field is required.
3. Develop project list + Home "Your projects" + Orchestrate project column:
   long project names are truncated to ~14 chars (dbt_e2e_202609...), so
   projects are indistinguishable. Allow two lines / wider column and add a
   title tooltip with the full name.
4. Home: projects that built successfully show status "Pending" and the
   "Ready" KPI is 13%. Find what "Ready"/"Pending" is derived from and make a
   project whose latest build succeeded show as ready (or rename the metric to
   what it actually measures).
5. RunOptionsDialog "Full refresh" help text says it is supported on snapshot;
   the backend accepts it for run, build, seed only. Fix the text.
6. RunOptionsDialog State & Defer: the State Target dropdown lists only the
   active target (dev) and says "Run a successful build on this target to
   generate state". The server never saves state for dev (only non-dev targets
   and schedules). List the project's non-dev targets (from targets API) plus
   any target that GET /dbt/state reports, default to the first with state, and
   explain: "State is saved after a successful run/build/seed/snapshot on a
   non-dev target or by a schedule."
7. Orchestrate RunDetail: at ~800px width the stat cards row (Started, Run
   duration, Executed nodes, Git commit) shows a horizontal scrollbar that
   covers the values. Wrap the cards (grid auto-fit) instead of scrolling.
8. Orchestrate RunDetail: "Target" shows "–" for runs on the default target;
   show "dev" (the default) when the run had no explicit --target.
9. Explore > Chart (ChartBuilder): when every result column is numeric, the
   default Value is the same column as Category (order_count/order_count), so
   the first render fails with "field bound to channels x, y". The default
   measure must be a numeric column different from the dimension (see the
   seeding helper in src/lib/board.ts or its refactored location + its tests).
