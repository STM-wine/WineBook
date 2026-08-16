import { AccountPending, getAppContext } from "@/lib/auth";
import { buildGrossProfitWorkflowProof } from "@/lib/supabase/gross-profit-center";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { unstable_cache } from "next/cache";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type BucketSummary = {
  bucket: string;
  lines: number;
  grossSales: number;
  billbackEarned: number;
  grossProfit: number;
  grossMarginPct: number | null;
};

type ExampleRow = {
  transactionType: "invoice" | "credit_memo";
  refNumber: string | null;
  linkedInvoiceRefNumber: string | null;
  item: string | null;
  quantity: number | null;
  amountCents: number | null;
  bucket: string;
  reason: string;
};

export default async function GrossProfitCenterPage({ searchParams }: PageProps) {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;

  const defaultRange = defaultDateRange();
  const params = await searchParams;
  const dateFrom = validDate(singleParam(params?.from)) || defaultRange.from;
  const dateTo = validDate(singleParam(params?.to)) || defaultRange.to;
  const proofResult = await loadGrossProfitProof(dateFrom, dateTo);
  if ("error" in proofResult) {
    return (
      <>
        <header className="settings-header">
          <p className="eyebrow">Settings</p>
          <h1>Gross Profit Center</h1>
          <p className="muted">
            QuickBooks financial truth with Vinosmith enrichment, signed credit memo reversals, and confidence buckets for exception review.
          </p>
        </header>
        <section className="settings-panel">
          <h2>Proof unavailable</h2>
          <p className="muted">{proofResult.error}</p>
        </section>
      </>
    );
  }
  const proof = proofResult.proof;
  const revenueDelta = Number(proof.quickBooksRevenueDelta || 0);
  const revenueTies = Math.abs(revenueDelta) < 0.01;
  const confidenceBuckets = (proof.confidenceBuckets as BucketSummary[]).slice(0, 8);
  const examples = (proof.examples as ExampleRow[]).slice(0, 8);

  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Settings</p>
        <h1>Gross Profit Center</h1>
        <p className="muted">
          QuickBooks financial truth with Vinosmith enrichment, signed credit memo reversals, and confidence buckets for exception review.
        </p>
      </header>

      <section className="settings-panel">
        <form className="settings-publish-form" action="/settings/gross-profit-center">
          <label>
            From
            <input type="date" name="from" defaultValue={dateFrom} />
          </label>
          <label>
            To
            <input type="date" name="to" defaultValue={dateTo} />
          </label>
          <button className="button button-small" type="submit">
            Refresh
          </button>
        </form>
      </section>

      <div className="settings-metrics gross-profit-center-metrics">
        <div>
          <span>Revenue Tie-Out</span>
          <strong>{revenueTies ? "Tied" : "Review"}</strong>
          <small>Delta {currency(revenueDelta)}</small>
        </div>
        <div>
          <span>Net Sales</span>
          <strong>{currency(proof.grossSales)}</strong>
          <small>{number(proof.quickBooksFinancialLines)} financial lines</small>
        </div>
        <div>
          <span>Gross Profit</span>
          <strong>{currency(proof.grossProfit)}</strong>
          <small>{percent(proof.grossMarginPct)} margin</small>
        </div>
        <div>
          <span>Billback Earned</span>
          <strong>{currency(proof.billbackEarned)}</strong>
          <small>Economic GP basis</small>
        </div>
        <div>
          <span>Invoice Match</span>
          <strong>{percent(proof.positiveRevenueLineMatchRate)}</strong>
          <small>{percent(proof.positiveRevenueAmountMatchRate)} by dollars</small>
        </div>
      </div>

      <div className="settings-grid-two gross-profit-center-grid">
        <section className="settings-panel">
          <div className="settings-panel-header">
            <h2>QuickBooks Tie-Out</h2>
            <span className={`data-pill ${revenueTies ? "is-positive" : "is-warning"}`}>{revenueTies ? "Ready" : "Review"}</span>
          </div>
          <dl className="settings-definition-list">
            <div>
              <dt>Invoice header sales</dt>
              <dd>{currency(proof.quickBooksInvoiceHeaderSales)}</dd>
            </div>
            <div>
              <dt>Credit memo header sales</dt>
              <dd>{currency(proof.quickBooksCreditMemoHeaderSales)}</dd>
            </div>
            <div>
              <dt>Header net sales</dt>
              <dd>{currency(proof.quickBooksHeaderNetSales)}</dd>
            </div>
            <div>
              <dt>Line net sales</dt>
              <dd>{currency(proof.quickBooksLineNetSales)}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <h2>Cost Basis</h2>
          </div>
          <dl className="settings-definition-list">
            <div>
              <dt>Cost before billback</dt>
              <dd>{currency(proof.grossCostBeforeBillback)}</dd>
            </div>
            <div>
              <dt>Billback earned</dt>
              <dd>{currency(proof.billbackEarned)}</dd>
            </div>
            <div>
              <dt>Effective cost</dt>
              <dd>{currency(proof.effectiveCost)}</dd>
            </div>
            <div>
              <dt>Cost source</dt>
              <dd>{(proof.costSources?.[0]?.bucket || "Not available").replaceAll("_", " ")}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="settings-panel">
        <div className="settings-panel-header">
          <h2>Confidence Buckets</h2>
          <span className="data-pill">{number(confidenceBuckets.length)} buckets</span>
        </div>
        <div className="settings-table-wrap">
          <table className="settings-table gross-profit-center-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Lines</th>
                <th>Net Sales</th>
                <th>Billback</th>
                <th>Gross Profit</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {confidenceBuckets.map((bucket) => (
                <tr key={bucket.bucket}>
                  <td>
                    <strong>{bucketLabel(bucket.bucket)}</strong>
                    <small>{bucket.bucket}</small>
                  </td>
                  <td>{number(bucket.lines)}</td>
                  <td>{currency(bucket.grossSales)}</td>
                  <td>{currency(bucket.billbackEarned)}</td>
                  <td>{currency(bucket.grossProfit)}</td>
                  <td>{percent(bucket.grossMarginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel-header">
          <h2>Exception Examples</h2>
        </div>
        <div className="settings-list">
          {examples.map((example, index) => (
            <article key={`${example.refNumber || "unknown"}-${example.item || "item"}-${index}`}>
              <strong>
                {example.refNumber || "No ref"} · {example.transactionType === "credit_memo" ? "Credit memo" : "Invoice"}
              </strong>
              <span>{example.item || "Unknown item"}</span>
              <small>
                {bucketLabel(example.bucket)} · Qty {number(example.quantity)} · {currency((example.amountCents || 0) / 100)}
                {example.linkedInvoiceRefNumber ? ` · Linked invoice ${example.linkedInvoiceRefNumber}` : ""}
              </small>
              <small>{example.reason}</small>
            </article>
          ))}
          {examples.length === 0 ? (
            <article>
              <strong>No exception examples</strong>
              <span>Current range has no sampled examples for review.</span>
            </article>
          ) : null}
        </div>
      </section>
    </>
  );
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function loadGrossProfitProof(dateFrom: string, dateTo: string) {
  try {
    return {
      proof: await cachedGrossProfitProof(dateFrom, dateTo)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not load Gross Profit Center proof."
    };
  }
}

async function cachedGrossProfitProof(dateFrom: string, dateTo: string) {
  return unstable_cache(
    () =>
      buildGrossProfitProofWithRetry(dateFrom, dateTo, {
        includeLines: false,
        lineLimit: 0
      }),
    ["gross-profit-center-proof", dateFrom, dateTo],
    { revalidate: 300 }
  )();
}

async function buildGrossProfitProofWithRetry(
  dateFrom: string,
  dateTo: string,
  options: Parameters<typeof buildGrossProfitWorkflowProof>[3]
) {
  try {
    return await buildGrossProfitWorkflowProof(createServiceRoleClient(), dateFrom, dateTo, options);
  } catch (error) {
    if (!isStatementTimeout(error)) throw error;
    await sleep(500);
    return buildGrossProfitWorkflowProof(createServiceRoleClient(), dateFrom, dateTo, options);
  }
}

function isStatementTimeout(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("statement timeout");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultDateRange() {
  const now = new Date();
  return {
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: now.toISOString().slice(0, 10)
  };
}

function currency(value: number | string | null | undefined) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(numeric);
}

function number(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function percent(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    style: "percent"
  }).format(Number(value));
}

function bucketLabel(value: string) {
  return value
    .split("_")
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ")
    .replace("QB", "QuickBooks");
}
