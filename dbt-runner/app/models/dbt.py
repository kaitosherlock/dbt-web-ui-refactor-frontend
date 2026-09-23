"""
Pydantic models for dbt operations.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


VARS_DESCRIPTION = (
    "dbt vars as an object; the server serialises it to one --vars JSON "
    "argument. Refused together with a --vars in the command or flags."
)


class DbtRunOptions(BaseModel):
    """Structured dbt flags the server serialises (app/services/command.py).

    Kept out of argv text so the client never quotes JSON or dates, and so a
    field the subcommand cannot take is refused with a message.
    """

    vars: Optional[Dict[str, Any]] = Field(None, description=VARS_DESCRIPTION)
    empty: bool = Field(False, description="--empty (run, build)")
    sample: Optional[str] = Field(
        None,
        max_length=32,
        description="--sample time spec '<count> <grain>', e.g. '3 days' (run, build)",
    )
    event_time_start: Optional[datetime] = Field(
        None, description="--event-time-start for microbatch models (run, build)"
    )
    event_time_end: Optional[datetime] = Field(
        None, description="--event-time-end for microbatch models (run, build)"
    )
    full_refresh: bool = Field(False, description="--full-refresh (run, build, seed)")
    selector_name: Optional[str] = Field(
        None,
        max_length=128,
        description="--selector: a selector defined in the project's selectors.yml",
    )


class DbtCommand(DbtRunOptions):
    """Request to execute a dbt command."""

    project_id: str = Field(..., description="Project identifier")
    command: str = Field(
        ..., description="dbt command (run, test, build, compile, etc.)"
    )
    selector: Optional[str] = Field(None, description="Model selector (--select)")
    target: Optional[str] = Field(
        None,
        description="profiles.yml output to run against (--target). "
        "Null uses the project's default target.",
    )
    flags: Optional[List[str]] = Field(None, description="Additional command flags")
    state_target: Optional[str] = Field(
        None, description="Named target whose server-owned artifacts provide dbt state"
    )
    defer: bool = Field(False, description="Defer unresolved refs to state")
    favor_state: bool = Field(
        False, description="Prefer state relations when deferring"
    )
    environment_variables: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to expose to dbt for this run"
    )


class DbtRetryRequest(BaseModel):
    """Retry the failed nodes from the project's latest dbt run results.

    No target or state options: dbt retry replays the failed invocation's own
    arguments from run_results.json and ignores them on the command line.
    """

    environment_variables: Optional[Dict[str, str]] = None


class DbtCloneRequest(BaseModel):
    """Clone selected relations from a server-owned state target."""

    project_id: str
    state_target: str
    target: Optional[str] = None
    selector: Optional[str] = None
    defer: bool = False
    favor_state: bool = False
    environment_variables: Optional[Dict[str, str]] = None


class CompileRequest(BaseModel):
    """Request to compile a specific dbt model."""

    project_id: str = Field(..., description="Project identifier")
    model_path: str = Field(..., description="Path to the model file")
    additional_args: Optional[str] = Field(
        None, description="Additional dbt CLI arguments for dbt compile"
    )
    environment_variables: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to expose to dbt for this compile"
    )
    target: Optional[str] = Field(
        None, description="profiles.yml output to use (--target). Null uses the project default."
    )
    vars: Optional[Dict[str, Any]] = Field(None, description=VARS_DESCRIPTION)


class PreviewRequest(BaseModel):
    """Request to preview model data using dbt show."""

    project_id: str = Field(..., description="Project identifier")
    model_path: str = Field(..., description="Path to the model file")
    limit: int = Field(100, ge=1, le=1000, description="Number of rows to preview")
    additional_args: Optional[str] = Field(
        None, description="Additional dbt CLI arguments for dbt show"
    )
    environment_variables: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to expose to dbt for this preview"
    )
    target: Optional[str] = Field(
        None, description="profiles.yml output to use (--target). Null uses the project default."
    )
    vars: Optional[Dict[str, Any]] = Field(None, description=VARS_DESCRIPTION)


class ExplainRequest(BaseModel):
    """Request to explain a compiled dbt model query plan."""

    project_id: str = Field(..., description="Project identifier")
    model_path: str = Field(..., description="Path to the model file")
    additional_args: Optional[str] = Field(
        None, description="Additional dbt CLI arguments for dbt compile"
    )
    environment_variables: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to expose to dbt for this explain"
    )
    target: Optional[str] = Field(
        None, description="profiles.yml output to use (--target). Null uses the project default."
    )
    vars: Optional[Dict[str, Any]] = Field(None, description=VARS_DESCRIPTION)


class QueryRequest(BaseModel):
    """Request to run a read-only inline SELECT via dbt show --inline."""

    project_id: str = Field(..., description="Project identifier")
    sql: str = Field(..., description="A single read-only SELECT statement")
    limit: int = Field(100, ge=1, le=1000, description="Max rows to return")
    target: Optional[str] = Field(
        None, description="profiles.yml output to query (--target)"
    )
    environment_variables: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to expose to dbt for this query"
    )


class LineageRequest(BaseModel):
    """Request to get data lineage for a model."""

    project_id: str = Field(..., description="Project identifier")
    model_path: str = Field(..., description="Path to the model file")


class DbtInitRequest(BaseModel):
    """Request to initialize a new dbt project from scratch."""

    project_id: str = Field(..., description="Project identifier")
    project_name: str = Field(..., description="Name for the new dbt project")
    template: str = Field(
        "empty",
        description="Starter template from the server's allowlist "
        "(GET /dbt/init/templates). 'empty' is plain `dbt init`.",
    )


class DbtLsRequest(DbtRunOptions):
    """List project resources with `dbt ls --output json`."""

    project_id: str
    select: Optional[str] = Field(None, max_length=2000, description="--select")
    exclude: Optional[str] = Field(None, max_length=2000, description="--exclude")
    resource_types: Optional[List[str]] = Field(
        None, description="--resource-type, repeated; values from dbt's list"
    )
    target: Optional[str] = None
    environment_variables: Optional[Dict[str, str]] = None


class DbtDebugRequest(BaseModel):
    """Check a project's profile and warehouse connection with `dbt debug`."""

    project_id: str
    target: Optional[str] = None
    environment_variables: Optional[Dict[str, str]] = None


class DbtRunOperationRequest(BaseModel):
    """Run one macro from the project's manifest with `dbt run-operation`."""

    project_id: str
    macro: str = Field(..., max_length=256, description="Macro name, optionally package.macro")
    args: Optional[Dict[str, Any]] = Field(
        None, description="Macro arguments; serialised to one --args JSON argument"
    )
    target: Optional[str] = None
    vars: Optional[Dict[str, Any]] = Field(None, description=VARS_DESCRIPTION)
    environment_variables: Optional[Dict[str, str]] = None


class DbtIntellisenseColumn(BaseModel):
    """Column metadata for dbt editor intellisense."""

    name: str
    data_type: Optional[str] = None
    description: Optional[str] = None


class DbtIntellisenseModel(BaseModel):
    """Model metadata for dbt editor intellisense."""

    name: str
    unique_id: str
    path: str
    description: Optional[str] = None
    columns: List[DbtIntellisenseColumn] = Field(default_factory=list)


class DbtIntellisenseSource(BaseModel):
    """Source metadata for dbt editor intellisense."""

    source_name: str
    table_name: str
    unique_id: str
    path: str
    description: Optional[str] = None
    columns: List[DbtIntellisenseColumn] = Field(default_factory=list)


class DbtIntellisenseMacro(BaseModel):
    """Macro metadata for dbt editor intellisense."""

    name: str
    package_name: Optional[str] = None
    unique_id: str
    path: str
    description: Optional[str] = None
    arguments: List[Dict[str, Any]] = Field(default_factory=list)


class DbtIntellisenseDoc(BaseModel):
    """Doc block metadata for dbt editor intellisense."""

    name: str
    unique_id: str
    path: str


class DbtIntellisenseResponse(BaseModel):
    """Normalized dbt metadata for Monaco autocomplete and definitions."""

    success: bool
    status: str
    generated_at: Optional[str] = None
    catalog_available: bool = False
    models: List[DbtIntellisenseModel] = Field(default_factory=list)
    sources: List[DbtIntellisenseSource] = Field(default_factory=list)
    macros: List[DbtIntellisenseMacro] = Field(default_factory=list)
    docs: List[DbtIntellisenseDoc] = Field(default_factory=list)


class FormatSqlRequest(BaseModel):
    """Request to pretty-print a dbt model's SQL."""

    sql: str = Field(..., description="SQL, possibly containing Jinja")
    dialect: Optional[str] = Field(
        None, description="sqlglot dialect. Defaults to the generic reader."
    )
