"""Smoke coverage for the pinned dbt runtime and bundled DuckDB adapter."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dbt_common.events.event_manager_client import cleanup_event_logger

from app.services import dbt_cli
from app.services.dbt_service import DbtService
from app.services.dbt_worker_process import _run_dbt


def test_sample_project_parses_with_pinned_dbt_runtime():
    with tempfile.TemporaryDirectory() as tmp:
        project_path = Path(tmp)
        models_path = project_path / "models"
        models_path.mkdir()
        (project_path / "dbt_project.yml").write_text(
            """name: parity_smoke
version: 1.0.0
config-version: 2
profile: parity_smoke
model-paths: [models]
"""
        )
        (project_path / "profiles.yml").write_text(
            """parity_smoke:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: smoke.duckdb
      schema: main
      threads: 1
"""
        )
        (models_path / "sample.sql").write_text("select 1 as id\n")

        try:
            result = _run_dbt(
                [
                    "parse",
                    "--project-dir",
                    str(project_path),
                    "--profiles-dir",
                    str(project_path),
                    "--no-partial-parse",
                    "--log-level-file",
                    "none",
                ],
                str(project_path),
                {},
            )

            assert result["returncode"] == 0, result["stderr"]
            manifest = json.loads(
                (project_path / "target" / "manifest.json").read_text()
            )
            assert manifest["metadata"]["dbt_version"] == "1.11.8"
            assert "model.parity_smoke.sample" in manifest["nodes"]

            # Exercise a second dbtRunner invocation in the same warm-worker
            # process and the 1.11 run-results artifact shape consumed by
            # DbtService's history/artifact parsing.
            results_path = project_path / "target" / "run_results.json"
            build = _run_dbt(
                [
                    "build",
                    "--project-dir",
                    str(project_path),
                    "--profiles-dir",
                    str(project_path),
                    "--log-level-file",
                    "none",
                ],
                str(project_path),
                {},
            )
            assert build["returncode"] == 0, build["stderr"]
            run_results = DbtService._read_run_results(results_path, None)
            assert run_results is not None
            assert run_results["metadata"]["dbt_version"] == "1.11.8"
            assert run_results["args"]["which"] == "build"
            assert DbtService._get_dbt_counts(build["stdout"], run_results) == (
                1,
                1,
                0,
            )
            assert run_results["results"][0]["unique_id"] == (
                "model.parity_smoke.sample"
            )

            listed = _run_dbt(
                [
                    "ls",
                    "--output",
                    "json",
                    "--resource-type",
                    "model",
                    "--project-dir",
                    str(project_path),
                    "--profiles-dir",
                    str(project_path),
                    "--log-level-file",
                    "none",
                ],
                str(project_path),
                {},
            )
            assert listed["returncode"] == 0, listed["stderr"]
            parsed = dbt_cli.parse_ls_output(listed["stdout"])
            assert parsed["count"] == 1
            assert parsed["rows"][0]["unique_id"] == "model.parity_smoke.sample"

            shown = _run_dbt(
                [
                    "show",
                    "--select",
                    "sample",
                    "--output",
                    "json",
                    "--project-dir",
                    str(project_path),
                    "--profiles-dir",
                    str(project_path),
                    "--log-level-file",
                    "none",
                ],
                str(project_path),
                {},
            )
            assert shown["returncode"] == 0, shown["stderr"]
            rows, columns = DbtService()._parse_dbt_show_output(shown["stdout"])
            assert columns == ["id"]
            assert rows == [{"id": 1}]
        finally:
            cleanup_event_logger()
