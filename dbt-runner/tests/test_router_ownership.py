"""Endpoints that act on a project or connection require a user who owns it.

Each route is driven over HTTP three ways: no Authorization header (401),
another user's project (404 - not 403, so existence is not confirmed), and the
owner (success). Ownership goes through the real `verify_project_ownership`
against a fake session, so the SQL filter it builds is what is tested.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.core import auth
from app.core.db import get_session
from app.core.dependencies import get_dbt_service
from app.routers import connection, dbt, process, project

OWNER = "00000000-0000-4000-8000-0000000000a1"
OTHER = "00000000-0000-4000-8000-0000000000b2"
LIVE = "00000000-0000-4000-8000-00000000000c"
TRASHED = "00000000-0000-4000-8000-00000000000d"
CONNECTION = "00000000-0000-4000-8000-00000000000e"


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def scalar(self):
        return None


class _Session:
    """Answers the ownership queries: OWNER has LIVE, TRASHED and CONNECTION."""

    async def execute(self, statement, params=None):
        sql = str(statement)
        params = params or {}
        if "FROM connections" in sql and "created_by" in sql:
            ok = params.get("cid") == CONNECTION and params.get("uid") == OWNER
            return _Result([(CONNECTION,)] if ok else [])
        if "FROM dbt_projects" in sql and "created_by" in sql and "pid" in params:
            owned = {LIVE} if "deleted_at IS NULL" in sql else {LIVE, TRASHED}
            ok = params["pid"] in owned and params.get("uid") == OWNER
            return _Result([(params["pid"],)] if ok else [])
        if "FROM dbt_projects" in sql and "created_by" in sql:
            return _Result([(LIVE,)] if params.get("uid") == OWNER else [])
        return _Result([])

    async def commit(self):
        return None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "auth_disabled", False)

    async def resolve(_session, sub, _email=None):
        return sub

    for module in (auth, project, process, connection, dbt):
        if hasattr(module, "resolve_user_id"):
            monkeypatch.setattr(module, "resolve_user_id", resolve)

    app = FastAPI()
    for module in (project, process, connection, dbt):
        app.include_router(module.router)
    app.dependency_overrides[get_session] = lambda: _Session()

    service = MagicMock()
    service.init_project = AsyncMock(return_value={"success": True})
    service.serve_docs = AsyncMock(return_value={"success": True})
    service.stop_docs = AsyncMock(return_value={"success": True})
    service.get_docs_status = MagicMock(return_value={"running": False})
    service.list_resources = AsyncMock(return_value={"success": True})
    service.debug_project = AsyncMock(return_value={"success": True})
    service.run_operation = AsyncMock(return_value={"success": True})
    service.list_all_docs_servers = MagicMock(
        return_value=[{"project_id": LIVE}, {"project_id": "someone-else"}]
    )
    app.dependency_overrides[get_dbt_service] = lambda: service

    def login(sub):
        # None leaves the real require_user in place: no header, so 401.
        if sub is None:
            app.dependency_overrides.pop(auth.require_user, None)
        else:
            app.dependency_overrides[auth.require_user] = lambda: {"sub": sub}

    with TestClient(app) as test_client:
        test_client.login = login
        yield test_client


@pytest.fixture
def storage(monkeypatch, tmp_path):
    projects = MagicMock()
    projects.get_path.return_value = tmp_path / "missing"
    store = MagicMock()
    store.delete_from_storage = AsyncMock(return_value=True)
    store.mark_deleted = AsyncMock(return_value=True)
    store.restore_project = AsyncMock(return_value=True)
    store.sync_from_storage = AsyncMock(return_value=True)
    store.sync_files_from_storage = AsyncMock(return_value=True)
    monkeypatch.setattr(project, "ProjectService", lambda: projects)
    monkeypatch.setattr(project, "get_storage_service", lambda: store)
    monkeypatch.setattr(project, "_delete_state", lambda _pid: True)
    return store


# (method, path template, json body template); {pid} is the project id.
PROJECT_ROUTES = [
    ("post", "/project/delete", {"project_id": "{pid}", "hard_delete": False}),
    ("post", "/project/delete", {"project_id": "{pid}", "hard_delete": True}),
    ("post", "/project/restore", {"project_id": "{pid}"}),
    ("post", "/project/sync/{pid}", None),
    ("post", "/process/cancel?project_id={pid}", None),
    ("get", "/process/status?project_id={pid}", None),
    ("post", "/dbt/init", {"project_id": "{pid}", "project_name": "demo"}),
    ("post", "/dbt/docs/serve", {"project_id": "{pid}"}),
    ("post", "/dbt/docs/stop?project_id={pid}", None),
    ("get", "/dbt/docs/status?project_id={pid}", None),
    ("get", "/dbt/docs/view/{pid}", None),
    ("get", "/dbt/docs/static/{pid}/manifest.json", None),
    ("post", "/dbt/ls", {"project_id": "{pid}"}),
    ("post", "/dbt/debug", {"project_id": "{pid}"}),
    ("get", "/dbt/macros/{pid}", None),
    ("post", "/dbt/run-operation", {"project_id": "{pid}", "macro": "grant"}),
]


def _call(client, method, path, body, pid):
    url = path.format(pid=pid)
    if body is None:
        return getattr(client, method)(url)
    payload = {k: (v.format(pid=pid) if isinstance(v, str) else v) for k, v in body.items()}
    return getattr(client, method)(url, json=payload)


@pytest.mark.parametrize("method,path,body", PROJECT_ROUTES)
def test_project_routes_require_a_user(client, storage, method, path, body):
    client.login(None)
    assert _call(client, method, path, body, LIVE).status_code == 401


@pytest.mark.parametrize("method,path,body", PROJECT_ROUTES)
def test_project_routes_hide_another_users_project(client, storage, method, path, body):
    client.login(OTHER)
    response = _call(client, method, path, body, LIVE)
    assert response.status_code == 404
    storage.delete_from_storage.assert_not_called()
    storage.mark_deleted.assert_not_called()
    storage.restore_project.assert_not_called()
    storage.sync_files_from_storage.assert_not_called()


@pytest.mark.parametrize(
    "method,path,body",
    [
        route
        for route in PROJECT_ROUTES
        if route[1].startswith(("/project", "/process", "/dbt/ls", "/dbt/debug", "/dbt/run-"))
    ],
)
def test_the_owner_can_act_on_their_project(client, storage, monkeypatch, method, path, body):
    monkeypatch.setattr(process.warm_worker_pool, "release_project", AsyncMock(return_value=False))
    monkeypatch.setattr(process.AsyncFileLock, "force_release", AsyncMock(return_value=False))
    client.login(OWNER)
    response = _call(client, method, path, body, LIVE)
    assert response.status_code == 200, response.text


def test_hard_delete_and_restore_reach_a_project_in_the_trash(client, storage):
    client.login(OWNER)
    purge = client.post("/project/delete", json={"project_id": TRASHED, "hard_delete": True})
    assert purge.status_code == 200
    storage.delete_from_storage.assert_awaited_once_with(TRASHED)
    assert client.post("/project/restore", json={"project_id": TRASHED}).status_code == 200
    # A soft delete or sync of a trashed project is not a thing the UI does.
    assert client.post("/project/delete", json={"project_id": TRASHED}).status_code == 404
    assert client.post(f"/project/sync/{TRASHED}").status_code == 404


def test_docs_list_shows_only_the_callers_projects(client):
    client.login(None)
    assert client.get("/dbt/docs/list").status_code == 401
    client.login(OWNER)
    assert client.get("/dbt/docs/list").json() == {"servers": [{"project_id": LIVE}], "count": 1}
    client.login(OTHER)
    assert client.get("/dbt/docs/list").json()["count"] == 0


def test_docs_static_cannot_leave_the_target_directory(client, monkeypatch, tmp_path):
    (tmp_path / "target").mkdir()
    (tmp_path / "target" / "manifest.json").write_text("{}")
    (tmp_path / "profiles.yml").write_text("password: hunter2")
    projects = MagicMock()
    projects.get_path_or_raise.return_value = tmp_path
    monkeypatch.setattr(dbt, "ProjectService", lambda: projects)
    client.login(OWNER)
    assert client.get(f"/dbt/docs/static/{LIVE}/manifest.json").status_code == 200
    for escape in ("../profiles.yml", "..%2Fprofiles.yml", "%2E%2E/profiles.yml"):
        response = client.get(f"/dbt/docs/static/{LIVE}/{escape}")
        assert response.status_code == 404, escape
        assert "hunter2" not in response.text


def test_connection_usage_requires_the_connection_owner(client):
    client.login(None)
    assert client.get(f"/connection/usage/{CONNECTION}").status_code == 401
    client.login(OTHER)
    assert client.get(f"/connection/usage/{CONNECTION}").status_code == 404
    client.login(OWNER)
    assert client.get(f"/connection/usage/{CONNECTION}").status_code == 200


def test_connection_probes_require_a_user(client):
    client.login(None)
    body = {"type": "duckdb", "name": "x", "config": {}}
    assert client.post("/connection/test", json=body).status_code == 401
    assert client.post("/connection/schema", json=body).status_code == 401


def test_macros_endpoint_reads_the_owners_manifest(client, tmp_path):
    from app.core.dependencies import get_dbt_service as dependency

    service = client.app.dependency_overrides[dependency]()
    service.project.get_path_or_raise.return_value = tmp_path
    client.login(OWNER)
    assert client.get(f"/dbt/macros/{LIVE}").json()["status"] == "missing_manifest"
    (tmp_path / "target").mkdir()
    (tmp_path / "target" / "manifest.json").write_text(
        '{"metadata": {"project_name": "shop"}, "macros": {"macro.shop.m": '
        '{"name": "m", "package_name": "shop", "macro_sql": "{% macro m(a) %}{% endmacro %}"}}}'
    )
    body = client.get(f"/dbt/macros/{LIVE}").json()
    assert body["status"] == "ready"
    assert [(m["name"], m["signature"]) for m in body["macros"]] == [
        ("m", [{"name": "a", "default": None}])
    ]
