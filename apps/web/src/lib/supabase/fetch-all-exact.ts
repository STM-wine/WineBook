export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<Row> = {
  data: Row[] | null;
  error: { message: string } | null;
  count: number | null;
};

export async function fetchAllExact<Row>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize = SUPABASE_PAGE_SIZE
) {
  const rows: Row[] = [];
  let expectedRowCount: number | null = null;

  for (let from = 0; ; from += pageSize) {
    const { data, error, count } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (count === null || count === undefined) {
      throw new Error(`${label} did not return a completeness count.`);
    }
    if (expectedRowCount === null) expectedRowCount = count;
    if (count !== expectedRowCount) {
      throw new Error(`${label} row count changed during pagination (expected ${expectedRowCount}, received ${count}).`);
    }

    const page = data || [];
    rows.push(...page);
    if (rows.length === expectedRowCount) return rows;
    if (rows.length > expectedRowCount || page.length < pageSize) {
      throw new Error(`${label} was incomplete (expected ${expectedRowCount} rows, received ${rows.length}).`);
    }
  }
}
