#!/usr/bin/env python3
"""End-to-end dbt-core parity flow through the dbt-craft HTTP APIs."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx


CSV_FILES = (
    "jaffle_shop_customers.csv",
    "jaffle_shop_orders.csv",
    "stripe_payments.csv",
    "transactions_batch1.csv",
)
TERMINAL_STATUSES = {"success", "error", "cancelled"}
FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures"


class FlowError(RuntimeError):
    """A hard flow failure that should stop subsequent test steps."""


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or not value.strip():
        raise FlowError(f"required environment variable {name} is not set")
    return value.strip()


def compact(value: Any, limit: int = 500) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, default=str, sort_keys=True)
        except TypeError:
            text = str(value)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def lower_row(row: dict[str, Any]) -> dict[str, Any]:
    return {str(key).lower(): value for key, value in row.items()}


def decimal_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except InvalidOperation as exc:
        raise FlowError(f"expected a numeric value, received {value!r}") from exc


@dataclass
class CsvFacts:
    texts: dict[str, str]
    customer_count: int
    order_count: int
    successful_payment_total: Decimal
    transaction_count: int


@dataclass
class FlowState:
    project_id: str | None = None
    dev_connection_id: str | None = None
    prod_connection_id: str | None = None
    prod_target_id: str | None = None
    fixtures_uploaded: bool = False
    history_expectations: dict[str, tuple[str, str]] = field(default_factory=dict)


class DbtFlow:
    def __init__(self, adapter: str, cleanup: bool) -> None:
        self.adapter = adapter
        self.cleanup_requested = cleanup
        self.base_url = env("E2E_FRONTEND_URL", "http://localhost:3000").rstrip("/")
        self.csv_dir = Path(env("E2E_CSV_DIR", r"C:/Users/admin/Downloads"))
        self.request_timeout = float(env("E2E_HTTP_TIMEOUT", "180"))
        self.run_timeout = float(env("E2E_RUN_TIMEOUT", "1200"))
        self.poll_interval = float(env("E2E_POLL_INTERVAL", "2"))
        suffix = datetime.now(UTC).strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
        self.run_tag = suffix
        self.project_name = f"dbt_e2e_{suffix}"
        self.state = FlowState()
        self.failed = False
        self.secrets = [
            value
            for value in (
                os.environ.get("E2E_PG_PASSWORD", "demo_owner_pw"),
                os.environ.get("E2E_DBX_TOKEN"),
            )
            if value
        ]
        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(self.request_timeout),
            follow_redirects=True,
            headers={"User-Agent": "dbt-craft-e2e/1.0"},
        )
        if adapter == "postgres":
            self.database = "crm"
            self.dev_schema = "dbt_e2e"
        else:
            self.database = env("E2E_DBX_CATALOG", "workspace")
            self.dev_schema = "dbt_craft_e2e"
        self.prod_schema = f"{self.dev_schema}_prod"
        self.csv_facts: CsvFacts | None = None

    def close(self) -> None:
        self.client.close()

    def redact(self, text: str) -> str:
        redacted = text
        for secret in sorted(self.secrets, key=len, reverse=True):
            if len(secret) >= 3:
                redacted = redacted.replace(secret, "***REDACTED***")
        return redacted

    def step(self, number: int, name: str, action: Callable[[], str]) -> None:
        try:
            detail = action()
        except Exception as exc:
            self.failed = True
            message = self.redact(compact(str(exc)))
            print(f"[{number:02d}] FAIL {name}: {message}", flush=True)
            raise FlowError(message) from exc
        print(f"[{number:02d}] PASS {name}: {self.redact(compact(detail))}", flush=True)

    def request(
        self,
        method: str,
        path: str,
        *,
        expected: Iterable[int] = (200,),
        **kwargs: Any,
    ) -> httpx.Response:
        try:
            response = self.client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise FlowError(f"{method} {path} could not be completed: {exc}") from exc
        if response.status_code not in set(expected):
            body: Any
            try:
                body = response.json()
            except ValueError:
                body = response.text
            raise FlowError(
                f"{method} {path} returned HTTP {response.status_code}: "
                f"{self.redact(compact(body))}"
            )
        return response

    def json_request(
        self,
        method: str,
        path: str,
        *,
        expected: Iterable[int] = (200,),
        **kwargs: Any,
    ) -> Any:
        response = self.request(method, path, expected=expected, **kwargs)
        try:
            return response.json()
        except ValueError as exc:
            raise FlowError(f"{method} {path} returned non-JSON content") from exc

    @staticmethod
    def require_success(data: Any, operation: str) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise FlowError(f"{operation} returned an unexpected payload: {compact(data)}")
        if data.get("success") is not True:
            reason = data.get("error") or data.get("message") or data.get("output") or data
            raise FlowError(f"{operation} failed: {compact(reason)}")
        return data

    def authenticate_local_session(self) -> None:
        session = self.json_request("GET", "/api/auth/session")
        if isinstance(session, dict) and (session.get("user") or {}).get("id"):
            return

        csrf = self.json_request("GET", "/api/auth/csrf")
        token = csrf.get("csrfToken") if isinstance(csrf, dict) else None
        if not token:
            raise FlowError(
                "AUTH_DISABLED local login did not expose a CSRF token; is the frontend healthy?"
            )
        self.request(
            "POST",
            "/api/auth/callback/credentials",
            expected=(200, 302, 303),
            data={"csrfToken": token, "callbackUrl": f"{self.base_url}/"},
            headers={"X-Auth-Return-Redirect": "true"},
        )
        session = self.json_request("GET", "/api/auth/session")
        if not isinstance(session, dict) or not (session.get("user") or {}).get("id"):
            raise FlowError(
                "could not establish the AUTH_DISABLED local session; "
                "confirm the compose stack has AUTH_DISABLED=true"
            )

    def preflight(self) -> None:
        self.request("GET", "/", expected=(200,))
        self.authenticate_local_session()
        self.json_request("GET", "/api/dbt-runner/system/info")
        if self.adapter == "databricks":
            env("E2E_DBX_HOST")
            env("E2E_DBX_HTTP_PATH")
            env("E2E_DBX_TOKEN")
        print(
            f"[00] PASS preflight: frontend and dbt-runner reachable; adapter={self.adapter}",
            flush=True,
        )

    def connection_payload(self, schema: str, purpose: str) -> dict[str, Any]:
        if self.adapter == "postgres":
            return {
                "connectionType": "postgresql",
                "name": f"{self.project_name}_{purpose}",
                "host": "dbt-craft-demo-source",
                "port": 5432,
                "database": "crm",
                "username": "demo",
                "passwordEncrypted": env("E2E_PG_PASSWORD", "demo_owner_pw"),
                "sslMode": "disable",
                "extraConfig": {"schema": schema, "threads": 4},
            }
        return {
            "connectionType": "databricks",
            "name": f"{self.project_name}_{purpose}",
            "host": env("E2E_DBX_HOST"),
            "port": 443,
            "database": env("E2E_DBX_CATALOG", "workspace"),
            "username": "",
            "passwordEncrypted": env("E2E_DBX_TOKEN"),
            "extraConfig": {
                "auth_type": "pat",
                "http_path": env("E2E_DBX_HTTP_PATH"),
                "schema": schema,
                "threads": 4,
            },
        }

    def create_connection(self, schema: str, purpose: str) -> str:
        data = self.json_request(
            "POST", "/api/connections", json=self.connection_payload(schema, purpose)
        )
        connection_id = data.get("id") if isinstance(data, dict) else None
        if not connection_id:
            raise FlowError(f"connection creation returned no id: {compact(data)}")
        return str(connection_id)

    def test_connection(self, connection_id: str) -> dict[str, Any]:
        data = self.json_request(
            "POST", f"/api/connections/{quote(connection_id)}/test?type=connection"
        )
        return self.require_success(data, "connection test")

    def read_csv_facts(self) -> CsvFacts:
        texts: dict[str, str] = {}
        rows: dict[str, list[dict[str, str]]] = {}
        required_headers = {
            "jaffle_shop_customers.csv": {"id", "first_name", "last_name"},
            "jaffle_shop_orders.csv": {"id", "user_id", "order_date", "status"},
            "stripe_payments.csv": {
                "id",
                "orderid",
                "paymentmethod",
                "status",
                "amount",
                "created",
            },
            "transactions_batch1.csv": {
                "transaction_id",
                "service_type",
                "amount",
                "currency",
                "from_account",
                "to_account",
                "participant_code",
                "status",
                "response_code",
                "created_at",
            },
        }

        for filename in CSV_FILES:
            path = self.csv_dir / filename
            if not path.is_file():
                raise FlowError(f"CSV fixture not found: {path}")
            text = path.read_text(encoding="utf-8-sig")
            reader = csv.DictReader(text.splitlines())
            headers = {str(item).strip().lower() for item in (reader.fieldnames or [])}
            missing = required_headers[filename] - headers
            if missing:
                raise FlowError(f"{filename} is missing headers: {', '.join(sorted(missing))}")
            texts[filename] = text
            rows[filename] = [lower_row(row) for row in reader]

        customers = rows["jaffle_shop_customers.csv"]
        orders = rows["jaffle_shop_orders.csv"]
        payments = rows["stripe_payments.csv"]
        transactions = rows["transactions_batch1.csv"]
        customer_ids = {row["id"] for row in customers}
        order_customer = {row["id"]: row["user_id"] for row in orders}
        successful_payment_total = sum(
            (
                decimal_value(row["amount"]) / Decimal(100)
                for row in payments
                if row["status"].lower() == "success"
                and order_customer.get(row["orderid"]) in customer_ids
            ),
            Decimal(0),
        )
        return CsvFacts(
            texts=texts,
            customer_count=len(customer_ids),
            order_count=sum(1 for row in orders if row["user_id"] in customer_ids),
            successful_payment_total=successful_payment_total,
            transaction_count=len({row["transaction_id"] for row in transactions}),
        )

    def save_project_file(self, path: str, content: str) -> None:
        project_id = self.require_project_id()
        data = self.json_request(
            "POST",
            f"/api/dbt-runner/files/{quote(project_id)}/content",
            json={"path": path, "content": content},
        )
        self.require_success(data, f"save {path}")

    def delete_project_path(self, path: str, missing_ok: bool = False) -> None:
        project_id = self.require_project_id()
        expected = (200, 404) if missing_ok else (200,)
        response = self.request(
            "DELETE",
            f"/api/dbt-runner/files/{quote(project_id)}",
            params={"path": path},
            expected=expected,
        )
        if response.status_code == 200:
            self.require_success(response.json(), f"delete {path}")

    def require_project_id(self) -> str:
        if not self.state.project_id:
            raise FlowError("project has not been created")
        return self.state.project_id

    def start_run(
        self,
        payload: dict[str, Any],
        expected_command: str,
        *,
        expected_status: str = "success",
        endpoint: str = "/api/dbt-runner/dbt/runs",
    ) -> dict[str, Any]:
        started = self.json_request("POST", endpoint, expected=(200, 202), json=payload)
        run_id = started.get("run_id") or started.get("id") if isinstance(started, dict) else None
        if not run_id:
            raise FlowError(f"run launch returned no run id: {compact(started)}")
        self.state.history_expectations[str(run_id)] = (expected_command, expected_status)
        run = self.wait_for_run(str(run_id))
        if run.get("status") != expected_status:
            logs = run.get("error_message") or run.get("logs") or ""
            raise FlowError(
                f"run {run_id} ended as {run.get('status')}, expected {expected_status}: "
                f"{self.redact(compact(logs))}"
            )
        return run

    def wait_for_run(self, run_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + self.run_timeout
        while time.monotonic() < deadline:
            run = self.json_request(
                "GET",
                f"/api/dbt-runner/dbt/runs/{quote(run_id)}",
                params={"include_logs": "false"},
            )
            if isinstance(run, dict) and run.get("status") in TERMINAL_STATUSES:
                return run
            time.sleep(self.poll_interval)
        raise FlowError(f"run {run_id} did not finish within {self.run_timeout:g}s")

    def sync_run_operation(
        self, macro: str, args: dict[str, Any], target: str | None = None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "project_id": self.require_project_id(),
            "macro": macro,
            "args": args,
        }
        if target:
            payload["target"] = target
        result = self.require_success(
            self.json_request("POST", "/api/dbt-runner/dbt/run-operation", json=payload),
            f"run-operation {macro}",
        )
        run_id = result.get("run_id")
        if run_id:
            self.state.history_expectations[str(run_id)] = ("run_operation", "success")
        return result

    def run(self) -> None:
        self.preflight()

        def step_1() -> str:
            self.state.dev_connection_id = self.create_connection(self.dev_schema, "dev")
            return f"created {self.adapter} connection {self.state.dev_connection_id}"

        self.step(1, "create connection", step_1)

        def step_2() -> str:
            result = self.test_connection(str(self.state.dev_connection_id))
            return str(result.get("message") or "connection succeeded")

        self.step(2, "test connection", step_2)

        def step_3() -> str:
            project = self.json_request(
                "POST",
                "/api/projects",
                json={
                    "name": self.project_name,
                    "description": f"Automated dbt parity flow {self.run_tag}",
                    "connectionId": self.state.dev_connection_id,
                },
            )
            project_id = project.get("id") if isinstance(project, dict) else None
            if not project_id:
                raise FlowError(f"project creation returned no id: {compact(project)}")
            self.state.project_id = str(project_id)
            initialized = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/init",
                    json={
                        "project_id": self.state.project_id,
                        "project_name": self.project_name,
                        "template": "empty",
                    },
                ),
                "dbt init",
            )
            return f"project {self.state.project_id}; {initialized.get('message')}"

        self.step(3, "create and initialize empty project", step_3)

        def step_4() -> str:
            self.csv_facts = self.read_csv_facts()
            self.delete_project_path("models/example", missing_ok=True)
            fixture_files = [path for path in sorted(FIXTURE_ROOT.rglob("*")) if path.is_file()]
            for path in fixture_files:
                relative = path.relative_to(FIXTURE_ROOT).as_posix()
                self.save_project_file(relative, path.read_text(encoding="utf-8"))
            for filename, content in self.csv_facts.texts.items():
                self.save_project_file(f"seeds/{filename}", content)
            self.state.fixtures_uploaded = True
            return (
                f"uploaded {len(CSV_FILES)} inspected CSVs, {len(fixture_files)} dbt fixture files; "
                f"customers={self.csv_facts.customer_count}, "
                f"transactions={self.csv_facts.transaction_count}"
            )

        self.step(4, "upload seeds and project fixtures", step_4)

        def step_5() -> str:
            result = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/debug",
                    json={"project_id": self.require_project_id()},
                ),
                "dbt debug",
            )
            return "dbt debug completed with a valid profile and warehouse connection"

        self.step(5, "dbt debug", step_5)

        def step_6() -> str:
            run = self.start_run(
                {"project_id": self.require_project_id(), "command": "seed"}, "seed"
            )
            return f"run {run['id']} loaded all four seeds"

        self.step(6, "dbt seed", step_6)

        def step_7() -> str:
            run = self.start_run(
                {"project_id": self.require_project_id(), "command": "build"}, "build"
            )
            return (
                f"run {run['id']} succeeded; nodes={run.get('models_total', 0)}, "
                f"errors={run.get('models_error', 0)}"
            )

        self.step(7, "dbt build with tests", step_7)

        def step_8() -> str:
            result = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/ls",
                    json={"project_id": self.require_project_id()},
                ),
                "dbt ls",
            )
            rows = result.get("rows") or []
            found = {(row.get("resource_type"), row.get("name")) for row in rows}
            expected = {
                ("seed", Path(name).stem) for name in CSV_FILES
            } | {
                ("model", "stg_customers"),
                ("model", "stg_orders"),
                ("model", "stg_payments"),
                ("model", "stg_transactions"),
                ("model", "customer_orders"),
                ("model", "incremental_transactions"),
                ("test", "assert_customer_orders_nonnegative"),
            }
            missing = expected - found
            if missing:
                raise FlowError(f"dbt ls omitted expected nodes: {sorted(missing)}")
            return f"listed {result.get('count')} nodes; all required seeds/models/tests present"

        self.step(8, "dbt ls expected nodes", step_8)

        def step_9() -> str:
            facts = self.csv_facts
            if facts is None:
                raise FlowError("CSV expectations were not computed")
            result = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/preview",
                    json={
                        "project_id": self.require_project_id(),
                        "model_path": "models/marts/customer_orders.sql",
                        "limit": 1000,
                    },
                ),
                "dbt show customer_orders",
            )
            rows = [lower_row(row) for row in (result.get("data") or [])]
            if result.get("row_count") != facts.customer_count or len(rows) != facts.customer_count:
                raise FlowError(
                    f"mart row count was {result.get('row_count')}; "
                    f"CSV expectation is {facts.customer_count}"
                )
            order_count = sum(int(decimal_value(row.get("order_count"))) for row in rows)
            lifetime_value = sum(
                (decimal_value(row.get("lifetime_value")) for row in rows), Decimal(0)
            )
            if order_count != facts.order_count:
                raise FlowError(
                    f"mart order total was {order_count}; CSV expectation is {facts.order_count}"
                )
            if lifetime_value.quantize(Decimal("0.01")) != facts.successful_payment_total.quantize(
                Decimal("0.01")
            ):
                raise FlowError(
                    f"mart lifetime value total was {lifetime_value}; "
                    f"CSV expectation is {facts.successful_payment_total}"
                )
            return (
                f"rows={len(rows)}, orders={order_count}, "
                f"lifetime_value={lifetime_value.quantize(Decimal('0.01'))}"
            )

        self.step(9, "preview mart and reconcile CSV counts", step_9)

        def step_10() -> str:
            result = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/compile",
                    json={
                        "project_id": self.require_project_id(),
                        "model_path": "models/marts/customer_orders.sql",
                    },
                ),
                "dbt compile",
            )
            compiled = str(result.get("compiled_sql") or "")
            if not compiled.strip() or "customer_activity" not in compiled.lower():
                raise FlowError("compile succeeded but returned no recognizable compiled SQL")
            return f"compiled customer_orders ({len(compiled)} characters)"

        self.step(10, "dbt compile", step_10)

        def step_11() -> str:
            generated = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/docs/generate",
                    json={"project_id": self.require_project_id()},
                ),
                "dbt docs generate",
            )
            response = self.request(
                "GET", f"/api/dbt-docs/view/{quote(self.require_project_id())}"
            )
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type or "<html" not in response.text.lower():
                raise FlowError("docs view did not return an HTML document")
            manifest = self.json_request(
                "GET",
                f"/api/dbt-docs/static/{quote(self.require_project_id())}/manifest.json",
            )
            if not isinstance(manifest, dict) or not manifest.get("metadata"):
                raise FlowError("docs manifest asset was not reachable through the frontend route")
            return (
                f"generated catalog and reached docs view plus manifest asset "
                f"({len(response.content)} HTML bytes)"
            )

        self.step(11, "dbt docs generate and view", step_11)

        def step_12() -> str:
            result = self.sync_run_operation("e2e_echo", {"value": self.run_tag})
            output = str(result.get("stdout") or "")
            if self.run_tag not in output:
                raise FlowError("run-operation output did not contain the macro argument")
            return "e2e_echo received and logged its argument"

        self.step(12, "dbt run-operation with args", step_12)

        def step_13() -> str:
            run = self.start_run(
                {
                    "project_id": self.require_project_id(),
                    "command": "run",
                    "vars": {"minimum_amount": 0, "e2e_run": self.run_tag},
                    "selector_name": "txn_incremental",
                    "full_refresh": True,
                },
                "run",
            )
            model_ids = self.result_model_ids(run)
            expected_suffix = ".incremental_transactions"
            if len(model_ids) != 1 or not next(iter(model_ids)).endswith(expected_suffix):
                raise FlowError(f"selector ran unexpected models: {sorted(model_ids)}")
            preview = self.require_success(
                self.json_request(
                    "POST",
                    "/api/dbt-runner/dbt/preview",
                    json={
                        "project_id": self.require_project_id(),
                        "model_path": "models/incremental/incremental_transactions.sql",
                        "limit": 1000,
                    },
                ),
                "preview incremental_transactions",
            )
            expected_rows = self.csv_facts.transaction_count if self.csv_facts else None
            if preview.get("row_count") != expected_rows:
                raise FlowError(
                    f"incremental row count was {preview.get('row_count')}; "
                    f"CSV expectation is {expected_rows}"
                )
            return (
                f"full-refresh selector ran {next(iter(model_ids))} with vars; "
                f"rows={expected_rows}"
            )

        self.step(13, "vars, named selector, and full refresh", step_13)

        def step_14() -> str:
            test_path = "tests/assert_customer_orders_nonnegative.sql"
            original = (FIXTURE_ROOT / test_path).read_text(encoding="utf-8")
            self.save_project_file(test_path, "select 1 as intentional_e2e_failure\n")
            failed_run = self.start_run(
                {"project_id": self.require_project_id(), "command": "build"},
                "build",
                expected_status="error",
            )
            self.save_project_file(test_path, original)
            retry = self.start_run(
                {},
                "retry",
                endpoint=f"/api/dbt-runner/dbt/runs/{quote(str(failed_run['id']))}/retry",
            )
            return f"build {failed_run['id']} failed as expected; retry {retry['id']} succeeded"

        self.step(14, "repair a failed build and retry", step_14)

        def step_15() -> str:
            self.state.prod_connection_id = self.create_connection(self.prod_schema, "prod")
            self.test_connection(self.state.prod_connection_id)
            target = self.json_request(
                "POST",
                "/api/targets",
                json={
                    "projectId": self.require_project_id(),
                    "name": "prod",
                    "connectionId": self.state.prod_connection_id,
                },
            )
            target_id = target.get("id") if isinstance(target, dict) else None
            if not target_id:
                raise FlowError(f"target creation returned no id: {compact(target)}")
            self.state.prod_target_id = str(target_id)
            self.start_run(
                {
                    "project_id": self.require_project_id(),
                    "command": "build",
                    "target": "prod",
                },
                "build",
            )
            state = self.json_request(
                "GET", f"/api/dbt-runner/dbt/state/{quote(self.require_project_id())}"
            )
            targets = {item.get("target") for item in state.get("targets", [])}
            if "prod" not in targets:
                raise FlowError(f"saved state did not list prod: {compact(state)}")

            staging_path = "models/staging/stg_orders.sql"
            changed = (FIXTURE_ROOT / staging_path).read_text(encoding="utf-8")
            changed += f"\n-- state modification {self.run_tag}\n"
            self.save_project_file(staging_path, changed)
            modified_run = self.start_run(
                {
                    "project_id": self.require_project_id(),
                    "command": "build",
                    "selector": "state:modified+",
                    "state_target": "prod",
                    "defer": True,
                },
                "build",
            )
            model_ids = self.result_model_ids(modified_run)
            model_names = {item.rsplit(".", 1)[-1] for item in model_ids}
            expected_models = {"stg_orders", "customer_orders"}
            if model_names != expected_models:
                raise FlowError(
                    f"state:modified+ model subtree was {sorted(model_names)}, "
                    f"expected {sorted(expected_models)}"
                )
            return (
                f"prod state saved; deferred state:modified+ ran only "
                f"{', '.join(sorted(model_names))} and their tests"
            )

        self.step(15, "prod state and deferred modified subtree", step_15)

        def step_16() -> str:
            run = self.start_run(
                {
                    "project_id": self.require_project_id(),
                    "state_target": "prod",
                    "target": "dev",
                },
                "clone",
                endpoint="/api/dbt-runner/dbt/runs/clone",
            )
            return f"clone run {run['id']} succeeded from prod state into dev"

        self.step(16, "dbt clone from prod state", step_16)

        def step_17() -> str:
            history = self.json_request(
                "GET", "/api/runs", params={"projectId": self.require_project_id()}
            )
            if not isinstance(history, list):
                raise FlowError(f"history returned an unexpected payload: {compact(history)}")
            by_id = {str(item.get("id")): item for item in history}
            errors: list[str] = []
            for run_id, (expected_command, expected_status) in self.state.history_expectations.items():
                item = by_id.get(run_id)
                if item is None:
                    errors.append(f"{run_id}: missing")
                    continue
                if item.get("command") != expected_command:
                    errors.append(
                        f"{run_id}: command={item.get('command')} expected={expected_command}"
                    )
                if item.get("status") != expected_status:
                    errors.append(
                        f"{run_id}: status={item.get('status')} expected={expected_status}"
                    )
            if errors:
                raise FlowError("run history mismatch: " + "; ".join(errors))
            commands = sorted({command for command, _ in self.state.history_expectations.values()})
            return (
                f"verified {len(self.state.history_expectations)} runs and command labels: "
                f"{', '.join(commands)}"
            )

        self.step(17, "run history command fidelity", step_17)

        if self.cleanup_requested:
            self.cleanup()
        else:
            print(
                "[18] PASS optional cleanup: not requested; project, connections, and schemas retained",
                flush=True,
            )

    @staticmethod
    def result_model_ids(run: dict[str, Any]) -> set[str]:
        results = run.get("results")
        if isinstance(results, str):
            try:
                results = json.loads(results)
            except ValueError:
                results = None
        entries = results.get("results", []) if isinstance(results, dict) else []
        return {
            str(item.get("unique_id"))
            for item in entries
            if str(item.get("unique_id", "")).startswith("model.")
        }

    def cleanup(self) -> None:
        errors: list[str] = []

        def attempt(label: str, action: Callable[[], None]) -> None:
            try:
                action()
            except Exception as exc:
                errors.append(f"{label}: {self.redact(compact(str(exc)))}")

        project_id = self.state.project_id
        if project_id and self.state.fixtures_uploaded:
            if self.state.prod_target_id:
                attempt(
                    f"drop schema {self.prod_schema}",
                    lambda: self.sync_run_operation(
                        "drop_e2e_schema",
                        {"schema_name": self.prod_schema, "database_name": self.database},
                        "prod",
                    ),
                )
            attempt(
                f"drop schema {self.dev_schema}",
                lambda: self.sync_run_operation(
                    "drop_e2e_schema",
                    {"schema_name": self.dev_schema, "database_name": self.database},
                    "dev",
                ),
            )

        if project_id:
            attempt(
                "delete runner project storage",
                lambda: self.require_success(
                    self.json_request(
                        "POST",
                        "/api/dbt-runner/project/delete",
                        json={"project_id": project_id, "hard_delete": True},
                    ),
                    "runner project deletion",
                ),
            )
            attempt(
                "delete project row",
                lambda: self.require_success(
                    self.json_request(
                        "DELETE", "/api/projects", params={"id": project_id, "hard": "true"}
                    ),
                    "project deletion",
                ),
            )

        for label, connection_id in (
            ("prod connection", self.state.prod_connection_id),
            ("dev connection", self.state.dev_connection_id),
        ):
            if connection_id:
                attempt(
                    f"delete {label}",
                    lambda connection_id=connection_id: self.require_success(
                        self.json_request(
                            "DELETE",
                            "/api/connections",
                            params={"id": connection_id, "type": "connection"},
                        ),
                        f"delete {label}",
                    ),
                )

        if errors:
            self.failed = True
            print(f"[18] FAIL cleanup: {'; '.join(errors)}", flush=True)
        else:
            print("[18] PASS cleanup: schemas, project storage/row, and connections removed", flush=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adapter", choices=("postgres", "databricks"), required=True)
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="drop the dev/prod schemas and delete the generated project/connections",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    flow: DbtFlow | None = None
    interrupted = False
    try:
        flow = DbtFlow(args.adapter, args.cleanup)
        flow.run()
    except KeyboardInterrupt:
        interrupted = True
        if flow:
            flow.failed = True
            if args.cleanup:
                flow.cleanup()
        print("FAIL interrupted", file=sys.stderr, flush=True)
    except (FlowError, ValueError) as exc:
        if flow and args.cleanup:
            flow.cleanup()
        elif flow:
            print(
                "Cleanup was not requested; rerun with --cleanup after resolving the failure "
                "or remove the printed project manually.",
                file=sys.stderr,
                flush=True,
            )
        if flow:
            flow.failed = True
        else:
            print(f"FAIL configuration: {compact(str(exc))}", file=sys.stderr, flush=True)
    finally:
        if flow:
            flow.close()
    return 130 if interrupted else (1 if flow is None or flow.failed else 0)


if __name__ == "__main__":
    raise SystemExit(main())
