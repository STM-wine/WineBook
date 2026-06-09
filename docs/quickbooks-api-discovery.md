# QuickBooks Desktop Integration Discovery Plan

## Scope and correction

Stem uses **QuickBooks Desktop on a remote Windows desktop**, not QuickBooks
Online. The previous QuickBooks Online OAuth/REST assumptions are not applicable.

This is a documentation and discovery plan only. It does not add credentials,
install software, call QuickBooks, write data, or change production behavior.

QuickBooks remains Stem Wine Company's financial brain and expected financial
source of truth. The purpose of this discovery is to determine which Desktop data
can be retrieved safely, how it is represented in Stem's company file, and how it
compares with Vinosmith and the emailed RB6/RADs reports.

## Existing repository footprint

The repository has no live QuickBooks Desktop integration:

- No QBWC service, `.qwc` connector, qbXML generator/parser, or Desktop SDK
  dependency exists.
- No QuickBooks/Intuit credentials or integration environment variables exist.
- `createWineInQuickBooks()` is an intentional disabled placeholder.
- Approved purchase orders are exported for manual QuickBooks entry.
- The GRW converter supports SaasAnt/QuickBooks CSV output.
- Supabase schemas reserve QuickBooks item IDs, purchase-order IDs, sync statuses,
  and future QuickBooks source/run types.

These are useful integration boundaries, but they do not prove what the actual
Desktop company file contains or which Desktop edition/features are available.

## QuickBooks Desktop integration path

### QuickBooks Web Connector

The recommended integration path is **QuickBooks Web Connector (QBWC)**. QBWC is a
Windows application installed on the same machine as QuickBooks Desktop, or in the
same local environment. It acts as a bridge between the local QuickBooks company
file and a remote web service.

QBWC initiates communication outbound. Our service does not directly connect into
the remote desktop or open inbound firewall access to QuickBooks.

### Existing Vinosmith connector

QBWC is already installed and working on Stem's remote desktop for Vinosmith. That
existing connector is production infrastructure and must not be removed, edited,
reconfigured, repointed, or reused for Stem Intelligence.

Its successful operation is useful evidence that:

- the hosted desktop environment supports QBWC;
- the QuickBooks company file permits at least one integrated application; and
- the remote desktop can likely reach an external web service.

Those facts reduce transport risk, but they do not establish that a second app is
permitted or that it can receive read-only authorization. A Stem Intelligence
integration should be a separate QBWC application with its own `.qwc` file, app
name, credentials, schedule, OwnerID, FileID, and Stem-controlled HTTPS service.

The expected flow is:

1. QBWC runs beside QuickBooks Desktop on Stem's remote Windows desktop.
2. On a manual or scheduled run, QBWC calls an HTTPS web service that Stem controls.
3. The service authenticates the connector and returns a read-only qbXML query.
4. QBWC passes that qbXML to the local QuickBooks Desktop request processor.
5. QuickBooks processes the request against the authorized company file.
6. QBWC sends the qbXML response back to the Stem service.
7. The service stores the raw response and later normalizes it into Stem-owned
   tables.

### qbXML

QuickBooks Desktop exchanges XML messages defined by the Desktop SDK, called
**qbXML**. Examples of read requests include:

- `CustomerQueryRq`
- `ItemQueryRq` and `ItemInventoryQueryRq`
- `InvoiceQueryRq`
- `CreditMemoQueryRq`
- `ReceivePaymentQueryRq`
- `VendorQueryRq`
- `BillQueryRq`
- `PurchaseOrderQueryRq`
- report queries such as inventory valuation and transaction detail

The exact supported qbXML version and available fields depend on the installed
QuickBooks Desktop product, year, edition, country, company-file settings, and
enabled features.

### Difference from QuickBooks Online

| QuickBooks Online | QuickBooks Desktop |
| --- | --- |
| Hosted REST API | Local Desktop SDK/qbXML request processor |
| OAuth 2.0 and company realm ID | QuickBooks company-file authorization and QBWC credentials |
| Cloud service receives direct HTTPS requests | QBWC polls/calls our service from the Windows machine |
| JSON entities | qbXML requests and responses |
| No local QuickBooks process required | QuickBooks/QBWC must run in the authorized Desktop environment |

Do not design the Desktop integration around QBO OAuth tokens, realm IDs, or QBO
REST endpoints.

## Recommended first path

Use a separate Stem Intelligence QBWC application as a read-only extraction bridge:

1. Deploy a minimal HTTPS QBWC-compatible web service.
2. Create a new `.qwc` connector with a unique Stem Intelligence app name, OwnerID,
   FileID, service URL, and authentication/schedule configuration.
3. Add the new `.qwc` file through QBWC's application-add flow without modifying
   the existing Vinosmith entry.
4. Have a QuickBooks administrator authorize the integrated application for the
   correct company file.
5. Request read-only/no-write access if the installed version and authorization
   flow support it.
6. Configure an independent schedule that does not overlap or interfere with the
   Vinosmith connector.
7. Start with one narrow query, such as a small customer sample or invoices for a
   short date range.
8. Save returned qbXML only under ignored `tmp/quickbooks-desktop/`.
9. Do not send any `AddRq`, `ModRq`, or `DelRq` messages.

## Remote desktop checks for Mark and Junaid

Before implementation, confirm:

1. Exact QuickBooks Desktop year/version.
2. Product edition: Pro, Premier, Enterprise, or Accountant.
3. Country/locale edition.
4. Remote desktop or hosting provider.
5. Open QuickBooks Web Connector and confirm the existing Vinosmith connector is
   listed and working. Do not remove, edit, or disable it.
6. Record the installed QBWC version and confirm an **Add Application** option is
   available.
7. Confirm a second QBWC application can be added for the same company file.
8. Confirm Mark/Junaid have QuickBooks company-file administrator access.
9. Confirm the hosting provider permits additional third-party integrated
   applications.
10. Open QuickBooks Integrated Applications settings, confirm Vinosmith is listed,
    and confirm additional applications are allowed.
11. Confirm whether a second app requires a unique OwnerID/FileID pair and whether
    the app can be authorized read-only.
12. Confirm whether the Stem connector can have its own schedule without
    interfering with Vinosmith.
13. Confirm QuickBooks Desktop supports both Vinosmith and Stem Intelligence
    integrations concurrently.
14. Confirm whether unattended/scheduled access is allowed while the company file
    is open, and whether access is allowed when QuickBooks is not running.
15. Confirm the remote desktop can make outbound HTTPS requests to a
    Stem-controlled endpoint using modern TLS.
16. Confirm whether the company file runs in single-user or multi-user mode during the
    intended sync window.
17. Confirm backups and an administrator-approved test window are available before
    connector authorization.

## Source-of-truth strategy

### QuickBooks Desktop

QuickBooks Desktop should own clean financial and accounting facts:

- invoices and invoice line items;
- payments, balances, and terms;
- credit memos and accounting returns;
- recognized revenue, discounts, taxes, and booked freight;
- COGS/cost when available and correctly configured;
- customer financial/accounting records;
- item financial/accounting records;
- vendor bills and vendor credits; and
- purchase orders and their accounting status.

### Vinosmith

Vinosmith remains the current operational and wine-metadata source:

- wine/item enrichment;
- operational inventory and on-order context;
- customer and operational pricing enrichment;
- vintage, bottle size, pack size, Core, and external identifiers;
- producer, importer, country, region, vineyard, and descriptive wine data; and
- the current bridge until Stem owns more of this operational domain.

Verified Vinosmith discovery found usable `supplier_orders`, rich `wines` metadata,
`available/on_hand/on_hold/on_order` inventory, and price/bill-back data. BTG was
not confirmed as a first-class field. Those findings currently live on commit
`6dc811e` on `codex/vinosmith-distributor-api-discovery`, not on `main`.

### Stem app

The Stem app should own:

- normalized cross-system tables and source-ID mappings;
- ordering logic and settings;
- manual overrides and buyer decisions;
- BTG strategy where no clean upstream field exists;
- forecasting and recommendations;
- audit/parity diagnostics; and
- future learned recommendations and intelligence.

QuickBooks should remain the financial truth, while Stem may eventually replace
the Vinosmith-style operational metadata layer.

## Data to test

The read-only Desktop discovery should test:

1. Customers
   - `CustomerQueryRq`: list IDs, names, active status, billing/shipping addresses,
     terms, balances, sales-tax settings, custom fields, and timestamps.
2. Items
   - `ItemQueryRq` plus type-specific queries: list IDs, names/SKUs, descriptions,
     active state, sales price, purchase cost, account references, and custom fields.
3. Inventory
   - `ItemInventoryQueryRq`: quantity on hand, average cost, quantity on order,
     quantity on sales order, reorder/build fields, and item custom fields.
   - Inventory valuation/report queries for as-of-date quantities and asset values.
4. Invoices and invoice line items
   - `InvoiceQueryRq`: transaction IDs, edit sequences, numbers, dates, customer,
     addresses, terms, sales rep, class, item references, quantities, rates,
     amounts, discounts, taxes, freight, balances, links, and custom fields.
5. Credit memos
   - `CreditMemoQueryRq`: item lines, quantities, rates, amounts, dates, customer,
     applied links, tax, and return/credit semantics.
6. Payments
   - `ReceivePaymentQueryRq`: customer, date, amount, applied invoice links,
     payment method, deposit account, and unapplied balance.
7. Vendors
   - `VendorQueryRq`: list IDs, names, addresses, terms, active status, account
     number, and custom fields.
8. Bills and vendor credits
   - `BillQueryRq` and `VendorCreditQueryRq`: vendor, item/account lines, quantities,
     costs, freight, dates, linked transactions, and payment/open status.
9. Purchase orders
   - `PurchaseOrderQueryRq`: vendor, dates, status, expected dates, item lines,
     quantities, rates/costs, received/billed links, and custom fields.
10. Classes, sales reps, and terms
    - Query these lists if Stem uses them for rep, channel, territory, or payment
      classification.
11. Reports
    - Inventory Valuation Summary/Detail, Profit and Loss, General Ledger,
      Transaction Detail, sales by item/customer, and COGS-related reports where
      supported.

## Source-of-truth comparison

Desktop availability means a qbXML/Desktop SDK capability that still requires
validation against Stem's product version and company-file population.

| Field / concept | QuickBooks Desktop availability | Vinosmith availability | Recommended source | Notes |
| --- | --- | --- | --- | --- |
| Customer name/ID/address | Customer and transaction queries | Supplier orders/account data | QuickBooks financial primary | Preserve both system IDs in Stem. |
| Customer payment status | Receivables, balances, payments | Supplier-order payment fields | QuickBooks | Financial status belongs to accounting. |
| Sales rep | Sales-rep refs/custom fields/classes if configured | Supplier-order user | Unknown pending Desktop test | Confirm how Stem records reps. |
| Invoice number/date/lines | Invoice query | Supplier orders | QuickBooks | Accounting transaction truth. |
| Delivery date | Ship date/custom field may exist | Explicit delivery date | Unknown pending Desktop test | Use Vinosmith if Desktop does not maintain it consistently. |
| Item/SKU | Item list IDs, full names, custom fields | Wine ID/code | QuickBooks accounting primary; Stem crosswalk | Keep wine IDs and planning SKU too. |
| Wine name/vintage/bottle/pack | Mostly encoded names/custom fields | First-class enriched fields | Vinosmith current; Stem long term | QuickBooks is not a full wine domain model. |
| Quantity sold | Invoice and credit lines | Supplier-order lines | QuickBooks after parity | Confirm units/cases/bottles and credits. |
| Sales dollars/discounts/taxes | Transaction lines and totals | Sales totals/discounts | QuickBooks | Financial truth. |
| Freight | Invoice/bill item or account lines if booked | Operational/logistics context | Split | QuickBooks booked cost; Stem planning assumption. |
| COGS/cost | Average cost, accounts, transaction/report data | Current FOB, not realized COGS | QuickBooks | Validate configuration and report granularity. |
| FOB | Purchase cost/average cost may not mean FOB | `fob_price` | Unknown pending parity | Keep Vinosmith until Desktop meaning is proven. |
| Laid-in cost | May be reconstructed from bills/freight | Not directly available | Stem operational; QuickBooks validation | Separate estimated from booked cost. |
| Bill-back | Vendor credits/accounting transactions if recorded | Price bill-back fields | QuickBooks financial primary if booked | Test Stem's accounting convention. |
| Credits/returns | Credit memo/vendor credit/payment links | Semantics uncertain | QuickBooks | Required for net sales. |
| Inventory on hand | Inventory item query and reports | On-hand/available by warehouse | Unknown/split | Compare timing and warehouse semantics. |
| On-order quantity | Inventory item query and open POs | Direct operational field | Vinosmith current | Desktop may reconstruct from open POs. |
| Core/external identifier | Custom fields only if configured | First-class | Vinosmith current; Stem long term | Confirm Core meaning. |
| BTG | Custom field only if configured | Not confirmed | Stem app | BTG is ordering strategy. |
| Wine descriptive metadata | Not standard accounting data | Rich metadata | Vinosmith current; Stem long term | Do not overload QuickBooks. |
| Ordering logic/overrides/forecasting | Not accounting fields | Limited inputs | Stem app | Stem is the intelligence layer. |

## First safe proof of concept

The first POC should prove transport and read access, not data completeness:

1. Confirm the existing Vinosmith connector remains healthy and unchanged.
2. Deploy a minimal QBWC-compatible HTTPS web service implementing the required
   Web Connector methods.
3. Generate a separate Stem Intelligence `.qwc` connector with a unique app name,
   OwnerID, and FileID that points to a Stem test HTTPS endpoint.
4. Add the Stem connector beside Vinosmith through QBWC's Add Application flow.
5. Authorize only the new Stem app in QuickBooks Desktop with a company-file
   administrator; do not alter Vinosmith's authorization.
6. Give the Stem connector its own manual/test schedule so it cannot overlap with
   or disrupt the Vinosmith connector.
7. Select read-only/no-write access where available.
8. Return one small qbXML request:
   - a limited customer query, or
   - an invoice query for a short date range.
9. Receive and validate the qbXML response.
10. Save the raw request/response only beneath ignored
   `tmp/quickbooks-desktop/`.
11. Confirm repeated runs do not change QuickBooks data or affect Vinosmith syncs.
12. Stop before normalization or Supabase writes.

The service must reject or never generate mutation requests. Initial supported
request types should be an explicit allowlist of read-only `*QueryRq` and report
queries.

## Questions the POC must answer

1. Which qbXML version does the installed QuickBooks version support?
2. Can QuickBooks Desktop authorize both Vinosmith and Stem Intelligence at the
   same time?
3. Are unique OwnerID and FileID values required, and are the proposed Stem values
   accepted?
4. Can the Stem app receive read-only authorization?
5. Can the Stem connector run independently without blocking, changing, or
   delaying Vinosmith?
6. Can QBWC authenticate to the Stem HTTPS service from the hosted desktop?
7. Can the connector run manually and on its own schedule?
8. Does authorization remain read-only and persist across sessions?
9. Must QuickBooks and the company file remain open?
10. Can the connector run unattended under the hosting provider's policies?
11. What stable IDs, edit sequences, and modified timestamps support upserts?
12. How much data can each query return before iterator/pagination is required?
13. Which custom fields contain rep, SKU, vintage, pack, delivery, or other Stem
   metadata?
14. Do Desktop quantities and financial totals match Vinosmith and emailed reports
    for the same windows?

## Recommended next step

Mark/Junaid should complete the remote-desktop checklist and provide screenshots or
notes for:

- Help/About QuickBooks version and edition;
- QuickBooks Web Connector showing the existing Vinosmith app and the available
  Add Application action;
- File > App Management or Integrated Applications preferences showing Vinosmith
  and whether additional apps are allowed;
- installed QBWC version;
- hosting-provider restrictions; and
- whether an admin can authorize a read-only integrated application.

Do not remove or edit the Vinosmith connector during these checks. After the facts
are known, design a separate minimal Stem QBWC service and `.qwc` file with unique
application identity values. Do not build a broad extractor until the one-query
read-only POC works alongside Vinosmith.

## Official references

- [Get started with QuickBooks Web Connector](https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/get-started-with-quickbooks-web-connector)
- [QuickBooks Desktop SDK](https://developer.intuit.com/app/developer/qbdesktop/docs/get-started)
- [Connections, sessions, and authorizations](https://developer.intuit.com/app/developer/qbdesktop/docs/develop/connections-sessions-and-authorizations)
- [CustomerQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/customerquery)
- [InvoiceQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/invoicequery)
- [ItemQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/itemquery)
- [ItemInventoryQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/iteminventoryquery)
- [QuickBooks Web Connector Programmer's Guide](https://static.developer.intuit.com/qbSDK-current/doc/pdf/QBWC_proguide.pdf)
