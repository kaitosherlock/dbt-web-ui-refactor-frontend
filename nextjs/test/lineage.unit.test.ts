import { describe, expect, it } from "vitest";
import { normalizeColumnLineage } from "../src/features/develop/model/lineage";

describe("normalizeColumnLineage", () => {
  it("passes through valid column lineage entries", () => {
    const raw = {
      user_id: [
        { column: "id", table: "raw_users" },
      ],
      full_name: [
        { column: "first_name", table: "raw_users", expression: "concat(first_name, ' ', last_name)" },
      ],
    };
    const res = normalizeColumnLineage(raw);
    expect(res.columnLineageError).toBeNull();
    expect(res.columnLineage).toEqual(raw);
  });

  it("extracts legacy column_lineage.error string and removes it from column map", () => {
    const raw = {
      error: "s.map is not a function",
    };
    const res = normalizeColumnLineage(raw);
    expect(res.columnLineageError).toBe("s.map is not a function");
    expect(res.columnLineage).toEqual({});
  });

  it("reads column_lineage_error from the new backend field", () => {
    const rawLineage = {
      customer_id: [{ column: "id", table: "stg_customers" }],
    };
    const res = normalizeColumnLineage(rawLineage, "Failed to resolve downstream macros");
    expect(res.columnLineageError).toBe("Failed to resolve downstream macros");
    expect(res.columnLineage).toEqual(rawLineage);
  });

  it("prefers column_lineage_error over legacy error when both exist", () => {
    const rawLineage = {
      error: "legacy error",
      customer_id: [{ column: "id", table: "stg_customers" }],
    };
    const res = normalizeColumnLineage(rawLineage, "new backend error");
    expect(res.columnLineageError).toBe("new backend error");
    expect(res.columnLineage).toEqual({
      customer_id: [{ column: "id", table: "stg_customers" }],
    });
  });

  it("discards non-array values in column_lineage to prevent s.map crashes", () => {
    const rawLineage = {
      valid_col: [{ column: "id", table: "stg_orders" }],
      invalid_string: "some string instead of array",
      invalid_number: 12345,
      invalid_object: { foo: "bar" },
      invalid_null: null,
    };
    const res = normalizeColumnLineage(rawLineage);
    expect(res.columnLineage).toEqual({
      valid_col: [{ column: "id", table: "stg_orders" }],
    });
  });

  it("handles null, undefined, and empty objects gracefully", () => {
    expect(normalizeColumnLineage(null)).toEqual({
      columnLineage: {},
      columnLineageError: null,
    });
    expect(normalizeColumnLineage(undefined)).toEqual({
      columnLineage: {},
      columnLineageError: null,
    });
    expect(normalizeColumnLineage({})).toEqual({
      columnLineage: {},
      columnLineageError: null,
    });
  });

  it("filters out invalid items inside column source arrays", () => {
    const rawLineage = {
      col_a: [
        { column: "valid_col", table: "valid_tbl" },
        null,
        "not an object",
        { column: 123, table: "foo" },
      ],
    };
    const res = normalizeColumnLineage(rawLineage);
    expect(res.columnLineage).toEqual({
      col_a: [{ column: "valid_col", table: "valid_tbl" }],
    });
  });
});
