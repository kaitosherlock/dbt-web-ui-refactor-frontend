import 'server-only'

/**
 * Shared server-side validation used by more than one feature's server.ts.
 *
 * `TARGET_NAME_PATTERN` mirrors `TARGET_NAME_RE` in dbt-runner
 * (`DbtService.target_secret_env`, see CLAUDE.md "Targets") — a target name
 * becomes a `profiles.yml` key and a `--target` value. It's checked both when
 * a project target is created (features/projects/server.ts) and when a
 * schedule names a target to run against (features/orchestrate/server.ts), so
 * it lives here once instead of drifting between the two.
 */
export const TARGET_NAME_PATTERN = /^[a-z][a-z0-9_]{0,29}$/
