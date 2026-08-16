# Company Knowledge Graph Seed

Date: 2026-08-16

Stem Intelligence will eventually need a full company knowledge graph.

This should not start as a giant ontology project. It should start as a practical explanation layer that captures how Stem's business concepts relate to each other, which systems own which truths, and how managers should interpret numbers when workflows, source systems, and confidence levels do not line up perfectly.

## Why This Matters

Stem's operating data crosses multiple systems:

- QuickBooks owns financial truth.
- Vinosmith enriches catalog, price, order, and account context.
- Supabase/Stem Intelligence owns workflow state, approval logic, crosswalks, confidence labels, diagnostics, and future policy.
- Human managers own judgment: exceptions, approvals, commercial intent, and interpretation.

Without an explicit knowledge graph, the app will eventually show correct numbers that still feel confusing. Managers will ask reasonable questions like:

- Why does revenue not match?
- Is this a sales problem, a credit problem, or an enrichment gap?
- Is this item margin real, estimated, manual, sampled, or missing billback?
- Which source should I trust?
- Which workflow created this exception?
- What action, if any, should I take?

The knowledge graph should make those answers discoverable in the product.

## First Seed

Gross Profit Center is the first concrete subgraph:

- [Gross Profit Center Knowledge Graph](quickbooks/gross-profit-center-knowledge-graph.md)
- [Gross Profit Center Knowledge Graph JSON](quickbooks/gross-profit-center-knowledge-graph.json)

That subgraph captures the relationships among QuickBooks revenue, invoice lines, credit memo reversals, Vinosmith enrichment, billbacks, samples, manual prices, confidence buckets, and revenue tie-outs.

## Future Graph Domains

The company graph should eventually include:

| Domain | Example Concepts |
| --- | --- |
| Financial truth | invoices, credit memos, payments, COGS, revenue tie-outs, gross profit, margin |
| Commercial terms | price levels, billbacks, depletion allowances, manual prices, approval rules |
| Products | QuickBooks items, Vinosmith wines, supplier catalog wines, vintages, pack sizes, item crosswalks |
| Accounts | customers, account price levels, reps, ownership, effective dates, samples |
| Suppliers | suppliers, importers, producers, logistics, FOB, laid-in cost, purchasing terms |
| Ordering | reorder recommendations, PO drafts, buyer decisions, inventory, open orders |
| Workflows | credits/returns, sample activity, new item creation, price changes, manager approvals |
| Data quality | confidence buckets, source coverage, extract stability, missing enrichment, reconciliation checks |

## Design Principles

1. Source boundaries are graph facts.
   The graph should explicitly say which system owns each type of truth.

2. Confidence is part of the model.
   A number without confidence context is not enough for management decisions.

3. Exceptions are first-class.
   Credit-workflow artifacts, samples, manual overrides, missing enrichment, and historical drift should be modeled instead of hidden.

4. The graph should explain actions.
   It should help the app say whether a manager should trust, review, ignore, reconcile, or escalate a line.

5. Start with useful subgraphs.
   Build one domain at a time as workflows mature. Do not pause product work to design a perfect universal ontology.

## Product Implication

Later, Stem Intelligence should be able to answer manager questions in plain language from the graph:

- "This revenue ties to QuickBooks headers; the mismatch you saw came from an unstable extract."
- "This line has real QuickBooks revenue, but missing Vinosmith price enrichment, so billback is unknown."
- "This is a credit-workflow artifact; QuickBooks reversed the sale, and Vinosmith may no longer retain the original sold line."
- "This margin is based on current QuickBooks item cost, not audited historical COGS."
- "This sample should be reviewed as sample cost, not normal commercial margin."

The graph is not a reporting flourish. It is how the app becomes understandable to managers.
