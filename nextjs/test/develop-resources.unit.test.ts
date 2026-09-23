import {
  filterResources,
  countByResourceType,
  formatResourceSummary,
  type DbtLsResourceRow,
} from "@/features/develop/model/resources"

describe("develop/model/resources", () => {
  const sampleRows: DbtLsResourceRow[] = [
    {
      unique_id: "model.jaffle_shop.customers",
      name: "customers",
      resource_type: "model",
      package_name: "jaffle_shop",
      original_file_path: "models/customers.sql",
      tags: ["core", "daily"],
      config: { materialized: "table", schema: "marts" },
    },
    {
      unique_id: "model.jaffle_shop.orders",
      name: "orders",
      resource_type: "model",
      package_name: "jaffle_shop",
      original_file_path: "models/orders.sql",
      tags: ["finance"],
      config: { materialized: "view" },
    },
    {
      unique_id: "seed.jaffle_shop.raw_customers",
      name: "raw_customers",
      resource_type: "seed",
      package_name: "jaffle_shop",
      original_file_path: "seeds/raw_customers.csv",
    },
    {
      unique_id: "test.jaffle_shop.not_null_customers_id",
      name: "not_null_customers_id",
      resource_type: "test",
      package_name: "jaffle_shop",
    },
  ]

  it("filters resources by search query matching name or tags", () => {
    const orders = filterResources(sampleRows, "orders")
    expect(orders).toHaveLength(1)
    expect(orders[0].name).toBe("orders")

    const byTag = filterResources(sampleRows, "core")
    expect(byTag).toHaveLength(1)
    expect(byTag[0].name).toBe("customers")
  })

  it("filters resources by resource type", () => {
    const seeds = filterResources(sampleRows, "", "seed")
    expect(seeds).toHaveLength(1)
    expect(seeds[0].resource_type).toBe("seed")

    const all = filterResources(sampleRows, "", "all")
    expect(all).toHaveLength(4)
  })

  it("combines search query and resource type filter", () => {
    const filtered = filterResources(sampleRows, "customer", "model")
    expect(filtered).toHaveLength(1)
    expect(filtered[0].unique_id).toBe("model.jaffle_shop.customers")
  })

  it("counts resources by type", () => {
    const counts = countByResourceType(sampleRows)
    expect(counts).toEqual({
      model: 2,
      seed: 1,
      test: 1,
    })
  })

  it("formats resource summary readable string", () => {
    const summary = formatResourceSummary(sampleRows)
    expect(summary).toBe("2 models, 1 seed, 1 test")
  })
})
