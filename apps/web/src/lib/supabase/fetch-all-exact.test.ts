import { describe, expect, it } from "vitest";
import { fetchAllExact } from "./fetch-all-exact";

describe("fetchAllExact", () => {
  it("returns every page only after matching the exact database count", async () => {
    const allRows = Array.from({ length: 2456 }, (_, id) => ({ id }));
    const ranges: Array<[number, number]> = [];
    const rows = await fetchAllExact("test rows", async (from, to) => {
      ranges.push([from, to]);
      return { data: allRows.slice(from, to + 1), error: null, count: allRows.length };
    });

    expect(rows).toHaveLength(2456);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("rejects a short page instead of treating it as end-of-data", async () => {
    let page = 0;
    await expect(fetchAllExact("test rows", async () => ({
      data: Array.from({ length: page++ === 0 ? 1000 : 400 }, (_, id) => ({ id })),
      error: null,
      count: 2000
    }))).rejects.toThrow("test rows was incomplete (expected 2000 rows, received 1400).");
  });

  it("rejects a changing count so mutable pagination cannot look complete", async () => {
    let page = 0;
    await expect(fetchAllExact("test rows", async () => ({
      data: Array.from({ length: 1000 }, (_, id) => ({ id })),
      error: null,
      count: page++ === 0 ? 2000 : 2100
    }))).rejects.toThrow("test rows row count changed during pagination");
  });
});
