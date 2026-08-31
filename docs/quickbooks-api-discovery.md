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

## Confirmed local environment

Confirmed on the remote desktop:

- QuickBooks is **QuickBooks Accountant Desktop Plus 2024, Release R20P, 64-bit**.
- QuickBooks Web Connector is installed and working.
- Multiple QBWC applications are already listed, including Vinosmith and Melio.
- **Add Application** is available and opens a `.qwc` file picker.
- Integrated Applications are allowed; **Don't allow any applications to access
  this company file** is unchecked.
- Vinosmith-related integrated applications show a valid status.
- Vinosmith's properties permit it to read and modify the company file, access
  QuickBooks while QuickBooks is not running, and sign in as Admin.
- Melio auto-runs every one minute.
- Vinosmith is manual and is not configured to auto-run.
- Purchase Orders are enabled and actively used.
- Inventory is enabled.

This environment is ready for a separate Stem Intelligence QBWC proof of concept.
The POC still requires its own application identity, authorization, service-side
read-only safeguards, and a controlled manual test.

## QuickBooks Desktop integration path

The recommended path is **QuickBooks Web Connector (QBWC)** using **qbXML**.
QBWC runs in the same Windows environment as QuickBooks Desktop and initiates
outbound calls to a Stem-controlled HTTPS web service. The service returns qbXML
requests, QuickBooks processes them against the authorized local company file, and
QBWC sends the qbXML responses back to the service.

QuickBooks Online is not part of this plan. QBO OAuth, `realmId`, REST endpoints,
online access/refresh tokens, and a QBO sandbox are not applicable to Stem's
QuickBooks Desktop environment.

### Connector isolation

The existing Vinosmith and Melio connectors are production infrastructure and must
not be modified, removed, reused, disabled, repointed, or reconfigured. Their
presence confirms that the environment supports QBWC, multiple applications, and
integrated-app authorization.

Stem Intelligence needs a separate QBWC application and `.qwc` file. Its first
connector must use a test/staging service, run manually, and have auto-run disabled.
It must operate independently of Vinosmith and Melio.

### Stem `.qwc` requirements

A `.qwc` file is the XML configuration used by QBWC to add and connect a web
service. The Stem file must be created only after the minimal test service exists
and must define:

- `AppName`: `Stem Intelligence`;
- `AppURL`: a Stem-controlled test/staging HTTPS endpoint;
- `AppDescription`;
- an application support URL when available;
- `UserName`;
- unique GUIDs for `OwnerID` and `FileID`;
- `QBType`: `QBFS`;
- credentials and manual-run schedule behavior; and
- `IsReadOnly` when supported and appropriate.

None of these values should reuse Vinosmith's connector details. Do not create the
`.qwc` file or service during this documentation phase.

### Read-only safety boundary

QuickBooks may display broad **read and modify this company file** permission, as
it does for Vinosmith. The first Stem POC must therefore enforce read-only behavior
inside the Stem service:

- allowlist reviewed query/report requests only;
- start with `CustomerQueryRq` or a narrow `InvoiceQueryRq`;
- never generate or accept `AddRq`, `ModRq`, or `DelRq`;
- do not expose a generic qbXML passthrough;
- log request type and response status without credentials; and
- stop the session if an unapproved request type appears.

Raw POC responses must be stored only under ignored
`tmp/quickbooks-desktop/`. The first POC must not write to QuickBooks, Stem
production tables, or Supabase.

### qbXML discovery scope

Relevant read requests include `CustomerQueryRq`, item and inventory queries,
`InvoiceQueryRq`, `CreditMemoQueryRq`, `ReceivePaymentQueryRq`, `VendorQueryRq`,
`BillQueryRq`, `PurchaseOrderQueryRq`, and supported report queries. The exact
qbXML version and response fields depend on the Desktop release, country edition,
company-file configuration, and enabled features.

## Remaining environment checks

The local review resolved most initial environment questions. Before the POC,
confirm only:

1. QuickBooks country/locale edition.
2. Remote desktop/hosting provider and its third-party integration policies.
3. Exact installed QBWC version.
4. Mark/Junaid's company-file administrator access.
5. Whether a new Stem app can receive a less-permissive/read-only authorization or
   whether QuickBooks presents only broad read/modify permission.
6. Whether the remote desktop can reach the Stem HTTPS endpoint using modern TLS.
7. Whether the company file runs in single-user or multi-user mode during testing.
8. Whether a backup and administrator-approved test window are available.

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
not confirmed as a first-class field. Those findings are now merged to `main` in
`docs/vinosmith-api-discovery.md`.

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

## Questions the POC must answer

1. Which qbXML version does the installed QuickBooks version support?
2. Are the proposed unique Stem AppName, OwnerID, and FileID accepted?
3. Can the Stem app receive read-only authorization, or must the service operate
   safely under broad read/modify permission?
4. Can the Stem connector run independently without blocking, changing, or
   delaying Vinosmith?
5. Can QBWC authenticate to the Stem HTTPS service from the hosted desktop?
6. Does the manual Stem run coexist cleanly with Melio's one-minute auto-run?
7. Does authorization persist across sessions?
8. Must QuickBooks and the company file remain open?
9. What stable IDs, edit sequences, and modified timestamps support upserts?
10. How much data can each query return before iterator/pagination is required?
11. Which custom fields contain rep, SKU, vintage, pack, delivery, or other Stem
   metadata?
12. Do Desktop quantities and financial totals match Vinosmith and emailed reports
    for the same windows?
13. Can a controlled Stem write queue create one disposable QuickBooks item, read it
    back by `ListID`, and then stop without changing any ordering behavior?
14. Which exact chart-of-account, vendor, tax-code, and unit-of-measure references
    are required for Stem wine items in the live company file?

## Official references

- [Get started with QuickBooks Web Connector](https://developer.intuit.com/app/developer/qbdesktop/docs/get-started/get-started-with-quickbooks-web-connector)
- [QuickBooks Desktop SDK](https://developer.intuit.com/app/developer/qbdesktop/docs/get-started)
- [Connections, sessions, and authorizations](https://developer.intuit.com/app/developer/qbdesktop/docs/develop/connections-sessions-and-authorizations)
- [AccountQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/accountquery)
- [CustomerQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/customerquery)
- [InvoiceQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/invoicequery)
- [ItemQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/itemquery)
- [ItemInventoryAdd](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/iteminventoryadd)
- [ItemInventoryQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/iteminventoryquery)
- [ItemNonInventoryAdd](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/itemnoninventoryadd)
- [UnitOfMeasureSetQuery](https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/unitofmeasuresetquery)
- [QuickBooks Web Connector Programmer's Guide](https://static.developer.intuit.com/qbSDK-current/doc/pdf/QBWC_proguide.pdf)

## Recommended implementation phases

This is the recommended delivery plan for Junaid. Each phase should be reviewed and
accepted before work begins on the next phase.

## QuickBooks item creation write discovery

Stem's current QuickBooks Web Connector service is intentionally read-only. The
server-side client rejects any qbXML request whose type ends in `AddRq`, `ModRq`,
or `DelRq`, and the Web Connector handler calls that guard before sending a request
to QuickBooks. The placeholder `createWineInQuickBooks()` also intentionally
throws. New item creation therefore requires a separate, explicit write path rather
than loosening the current read-only recovery queue.

The business loop worth proving is:

1. WineBook creates a reviewed new-item candidate.
2. A controlled QuickBooks write queue sends one `ItemInventoryAddRq` for a
   disposable/test item.
3. QuickBooks returns `ItemInventoryRet` with `ListID`, `EditSequence`, `Name`,
   and `FullName`.
4. WineBook records the write request, response, actor, approval, and resulting
   QuickBooks identity.
5. A subsequent `ItemQueryRq` reads the item back and confirms that the local
   `quickbooks_items` mirror sees the same official item.
6. Only after that proof should WineBook test the Vinosmith side: product mapping,
   price write-back, and allocation Excel export.

This proof can be done before ordering logic changes. It should not change Order
Review, PO Drafts, recommendation quantities, or exports.

### Likely qbXML request

Most Stem products appear to behave like inventory items in the current QuickBooks
mirror: the `quickbooks_items` table stores quantity, average cost, purchase cost,
sales price, income account, COGS account, and asset account fields. The first
write proof should therefore target `ItemInventoryAddRq`, not a purchase order and
not a Vinosmith write.

Representative qbXML shape:

```xml
<?xml version="1.0"?>
<?qbxml version="16.0"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <ItemInventoryAddRq requestID="stem-item-create-test-001">
      <ItemInventoryAdd>
        <Name>STEM API TEST 2026-08-17</Name>
        <IsActive>true</IsActive>
        <SalesDesc>STEM API TEST - DO NOT SELL</SalesDesc>
        <SalesPrice>1.00</SalesPrice>
        <IncomeAccountRef>
          <ListID>CONFIRMED_INCOME_ACCOUNT_LIST_ID</ListID>
        </IncomeAccountRef>
        <PurchaseDesc>STEM API TEST - DO NOT BUY</PurchaseDesc>
        <PurchaseCost>1.00</PurchaseCost>
        <COGSAccountRef>
          <ListID>CONFIRMED_COGS_ACCOUNT_LIST_ID</ListID>
        </COGSAccountRef>
        <PrefVendorRef>
          <ListID>CONFIRMED_TEST_VENDOR_LIST_ID</ListID>
        </PrefVendorRef>
        <AssetAccountRef>
          <ListID>CONFIRMED_INVENTORY_ASSET_ACCOUNT_LIST_ID</ListID>
        </AssetAccountRef>
        <QuantityOnHand>0</QuantityOnHand>
        <TotalValue>0</TotalValue>
        <InventoryDate>2026-08-17</InventoryDate>
        <ExternalGUID>{PUT-A-STEM-GENERATED-GUID-HERE}</ExternalGUID>
      </ItemInventoryAdd>
      <IncludeRetElement>ListID</IncludeRetElement>
      <IncludeRetElement>EditSequence</IncludeRetElement>
      <IncludeRetElement>Name</IncludeRetElement>
      <IncludeRetElement>FullName</IncludeRetElement>
      <IncludeRetElement>IsActive</IncludeRetElement>
      <IncludeRetElement>SalesPrice</IncludeRetElement>
      <IncludeRetElement>PurchaseCost</IncludeRetElement>
    </ItemInventoryAddRq>
  </QBXMLMsgsRq>
</QBXML>
```

Important notes:

- `Name` is the core required identifier in the Intuit `ItemInventoryAdd`
  reference. For Stem, the app should also require accounting refs even when qbXML
  marks some of them optional, because missing or defaulted accounts are an
  accounting risk.
- Use `ListID` for account/vendor refs after querying the live company file.
  `FullName` can work, but `ListID` avoids name ambiguity and rename drift.
- Do not create opening inventory by accident. Test items should use
  `QuantityOnHand = 0`, `TotalValue = 0`, and a known `InventoryDate`.
- If Stem later creates a real item that already has inventory on hand outside
  QuickBooks, accounting must decide whether opening quantity/value belongs in the
  item add request or in a separate inventory adjustment. Intuit's inventory docs
  distinguish creating an item with starting quantity/value from creating a zero
  item and later increasing inventory through purchasing activity.
- `ExternalGUID` is available on item add requests in modern qbXML. Use a
  Stem-generated GUID for idempotency/traceability, but do not rely on it as the
  only duplicate guard until tested in the live Desktop file.
- Avoid colons in the item `Name` during tests because colons represent hierarchy
  in QuickBooks full names.

### Required preflight discovery

Before any `ItemInventoryAddRq`, run/read the following from QuickBooks and store
the selected refs in a locked configuration table or env-backed setting:

| Needed ref | Discovery request | Required decision |
| --- | --- | --- |
| Income account | `AccountQueryRq` filtered to `Income` | Which sales/income account should new wine items use? |
| COGS account | `AccountQueryRq` filtered to `CostOfGoodsSold` | Which COGS account should inventory items use? |
| Inventory asset account | `AccountQueryRq` filtered to `OtherCurrentAsset`, `OtherAsset`, or `FixedAsset`, or by known full name/special account | Which inventory asset account should hold item value? |
| Preferred vendor | `VendorQueryRq` with active vendors | Should the preferred vendor be the supplier/importer, a test vendor, or blank? |
| Sales tax code | Existing item samples plus sales-tax-code query if needed | Which code should taxable/non-taxable wine items use? |
| Unit of measure | `UnitOfMeasureSetQueryRq` if UOM is enabled | Whether Stem needs a UOM set for bottle/case behavior or should omit UOM in the first proof. |
| Parent item/class | Existing item samples plus `ItemQueryRq`/class query if needed | Whether wine items sit under a parent/category in QuickBooks. |

The current WineBook recovery queue already persists vendors and items, but it
does not yet persist chart-of-account rows, tax codes, classes, or UOM sets as
first-class tables. The write proof should add read-only discovery for the missing
refs before enabling the item add request.

### Read-only ref discovery from current mirror

Read-only Supabase mirror inspection on August 17, 2026 found 8,756 mirrored
QuickBooks items, including 2,156 active items. The latest persisted item pull was
an `ItemQueryRq` page at `2026-08-15T15:27:19.916Z`, with QuickBooks status OK.

Active item type counts:

| Item type | Active rows |
| --- | ---: |
| `Inventory` | 2,127 |
| `OtherCharge` | 15 |
| `Service` | 7 |
| `NonInventory` | 4 |
| `FixedAsset` | 2 |
| `SalesTax` | 1 |

Most active inventory items use one of two account-ref groups:

| Group | Active inventory rows | Income account | COGS account | Inventory asset account |
| --- | ---: | --- | --- | --- |
| Main Stem wine items | 1,720 | `Sales` / `80000008-1481823979` | `Cost of Goods Sold:Wine` / `8000004E-1482949059` | `Inventory Asset` / `80000042-1481827012` |
| GRW brokerage items | 407 | `Brokerage Income - GRW` / `8000010C-1755131943` | `COGS - GRW` / `8000010D-1755131991` | `Inventory Asset - GRW` / `8000010E-1755132023` |

The first QuickBooks item-create proof should use the **main Stem wine item**
account group unless accounting specifically wants to test GRW brokerage items.
Representative main Stem active inventory item names are SKU-like codes such as
`ADR000001`, `AE000001`, and `ALH000002`; their stored parent refs are blank in
the current mirror, so the first proof should not assume a parent item hierarchy.

Current gaps:

- `quickbooks_vendors` currently has 0 rows, and no recent `VendorQueryRq`
  response was found in `source_api_responses`; preferred vendor cannot be chosen
  from the mirror yet.
- No `AccountQueryRq` response was found. The account refs above were inferred
  from existing item rows and should be confirmed by an explicit account query
  before writing.
- No `UnitOfMeasureSetQueryRq` response was found. UOM should be omitted from the
  first test item unless accounting confirms a required UOM set.
- Sales tax code/class refs are not persisted as first-class discovery tables yet.

Next read-only QBWC request set before any write proof:

1. `AccountQueryRq` for `Income`, `CostOfGoodsSold`, `OtherCurrentAsset`,
   `OtherAsset`, and `FixedAsset` accounts, to confirm the exact active account
   refs above.
2. `VendorQueryRq` for active vendors, to choose a test preferred vendor or decide
   to omit `PrefVendorRef`.
3. `UnitOfMeasureSetQueryRq`, to detect whether the company file has UOM enabled
   and whether bottle/case UOM should ever be assigned by Stem.
4. Sales-tax-code/class discovery if the first real item-create flow needs those
   refs. They are not needed for the zero-quantity disposable item proof unless
   accounting requires them.

### Write-queue design

Do not reuse the read-only recovery queue for writes. Add a separate queue/table
with a narrow state machine:

- `draft`: generated by WineBook but not approved.
- `approved_for_test`: approved by an authorized user for one manual QBWC run.
- `queued`: ready for the next manual Web Connector update.
- `sent`: qbXML was returned from `sendRequestXML`.
- `succeeded`: `ItemInventoryAddRs` returned OK and a `ListID` was parsed.
- `failed`: QuickBooks returned an error or Web Connector failed.
- `confirmed`: subsequent `ItemQueryRq` found the created item by `ListID`.
- `cancelled`: intentionally abandoned before send.

Each row should store actor, approval timestamp, source candidate ID, idempotency
key/ExternalGUID, request XML checksum, response checksum, parsed status code,
status message, returned `ListID`, returned `EditSequence`, returned `FullName`,
and raw-response link. The queue should allow exactly one active write job during
the first proof.

The Web Connector handler should keep the existing read-only assertion for normal
sessions. A write session should require all of the following:

- explicit feature flag, disabled by default;
- specific write-mode job ID;
- manual QBWC run only, not auto-run;
- authorized actor/approval attached to that job;
- request type allowlist containing only `ItemInventoryAddRq` for the first proof;
- one request per session;
- no `ModRq` or `DelRq`;
- no purchase orders, bills, item receipts, inventory adjustments, or invoice
  writes in the item-create proof.

### Test sequence

1. Create or identify a safe QuickBooks test vendor and test account refs with
   accounting's approval.
2. Add read-only `AccountQueryRq` and optional `UnitOfMeasureSetQueryRq`
   discovery, then select the exact refs for the test item.
3. Build a local qbXML preview for one item named clearly as a test.
4. Validate the XML shape locally with unit tests and, if available on the Windows
   machine, Intuit's qbXML Validator/SDK tools.
5. Queue one approved write job.
6. Run Web Connector manually with Auto-Run disabled.
7. Parse `ItemInventoryAddRs`; fail closed on any non-OK status.
8. Immediately queue/read `ItemQueryRq` by returned `ListID`.
9. Persist the confirmed item in `quickbooks_items` and link it to the original
   WineBook candidate.
10. Stop. Do not create additional items until the first proof is reviewed.

### Decisions before real item creation

- Should real wine items be `ItemInventoryAddRq`, `ItemNonInventoryAddRq`, or a
  mix? Production data strongly suggests inventory items, but accounting should
  confirm.
- Which QuickBooks `Name` convention is authoritative: Stem SKU, Vinosmith wine
  code, human wine name, or a parented full-name structure?
- Should item `Name` ever change after creation, or should renames be blocked and
  handled manually?
- Which account refs should be defaulted, and are any supplier/category-specific?
- Should preferred vendor be required?
- Should sales price be written to QuickBooks, or should Vinosmith own active
  selling prices while QuickBooks stores a placeholder/current item price?
- Should purchase cost be FOB, current expected purchase cost, or left blank/zero
  until first bill/PO?
- Should initial quantity/value always be zero?
- Should a Vinosmith product be created manually after QuickBooks item creation,
  or can Vinosmith product update/linking consume the new QuickBooks item code?
- What is the rollback policy for a bad test item: mark inactive manually, rename,
  or leave as an audited test artifact?

## Initial Stem QBWC service skeleton

The Next.js app now has a minimal read-only QBWC proof-of-concept surface:

- `.qwc` download route:
  `/api/integrations/quickbooks-desktop/qwc`
- Web Connector SOAP endpoint:
  `/api/integrations/quickbooks-desktop/web-connector`
- Setup and troubleshooting checklist:
  `docs/quickbooks-web-connector-setup.md`
- Initial read-only request queue:
  `CustomerQueryRq`, `ItemQueryRq`, `InvoiceQueryRq`, `CreditMemoQueryRq`, and
  `ReceivePaymentQueryRq`

This first queue is intentionally aligned with the future sales dashboard rather
than a generic connectivity demo. Invoices alone are not enough for Stem because
credits and payments must be pulled from QuickBooks Desktop to calculate net sales
and avoid the current Vinosmith/QuickBooks credit mismatch.

Required environment variables before downloading/installing the `.qwc` file:

- `QUICKBOOKS_DESKTOP_APP_URL`: hosted HTTPS URL for
  `/api/integrations/quickbooks-desktop/web-connector`
- `QUICKBOOKS_DESKTOP_WEB_CONNECTOR_PASSWORD`: password typed into QBWC

Optional environment variables:

- `QUICKBOOKS_DESKTOP_WEB_CONNECTOR_USERNAME`, defaults to `stem-qbwc`
- `QUICKBOOKS_DESKTOP_APP_NAME`, defaults to `Stem Intelligence`
- `QUICKBOOKS_DESKTOP_APP_DESCRIPTION`
- `QUICKBOOKS_DESKTOP_APP_SUPPORT_URL`
- `QUICKBOOKS_DESKTOP_OWNER_ID`
- `QUICKBOOKS_DESKTOP_FILE_ID`
- `QUICKBOOKS_DESKTOP_QBXML_VERSION`, defaults to `16.0`
- `QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED`, defaults to `1000`
- `QUICKBOOKS_DESKTOP_LIST_REFRESH_MAX_RETURNED`, defaults to
  `QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED`
- `QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_LOOKBACK_DAYS`, defaults to `45`
- `QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_WINDOW_DAYS`, defaults to `7`
- `QUICKBOOKS_DESKTOP_OPERATIONAL_LIST_MODIFIED_LOOKBACK_DAYS`, defaults to `45`
- `QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_FROM` / `QUICKBOOKS_DESKTOP_OPERATIONAL_TXN_TO`
  override the rolling invoice, credit memo, and purchase order transaction-date
  window.
- `QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_FROM` /
  `QUICKBOOKS_DESKTOP_OPERATIONAL_MODIFIED_TO` override the rolling modified-date
  window for customers, vendors, and items.
- `QUICKBOOKS_DESKTOP_CAPTURE_RAW_RESPONSES`, set to `false` to disable local raw
  response capture

Every manual Web Connector run starts with the operational refresh: sales reps,
recently modified customers, vendors, and items, plus rolling-window invoices,
credit memos, and purchase orders with line detail. Transaction pulls are split
into smaller date windows so a busy sales period is not hidden behind a single
QuickBooks page limit. If the historical recovery queue still has pending work,
the connector appends one recovery request after the operational refresh so
backfill progress cannot replace the usual current data pull.

Raw qbXML requests, responses, and status summaries are written under ignored
`tmp/quickbooks-desktop/<session-ticket>/` for the POC. These files may contain
customer and financial data and must not be committed or shared broadly.

### Phase 1: Read-only QBWC proof of concept

- Create a minimal Stem-controlled HTTPS QBWC web service.
- Create a separate Stem Intelligence `.qwc` file.
- Use unique AppName, AppURL, OwnerID, FileID, credentials, and schedule.
- Authorize the new application in QuickBooks Desktop without modifying Vinosmith
  or Melio.
- Run the Stem connector manually only.
- Query a tiny `CustomerQueryRq` or `InvoiceQueryRq` sample.
- Save raw qbXML responses only under ignored `tmp/quickbooks-desktop/`.
- Do not enable auto-run.
- Do not write anything to QuickBooks.

### Phase 2: Read-only data discovery

- Query customers.
- Query items.
- Query invoices and invoice lines.
- Query credit memos.
- Query payments.
- Query vendors.
- Query purchase orders.
- Query inventory items when available.
- Identify stable `ListID`, `TxnID`, and `EditSequence` keys for upsert and
  de-duplication.
- Compare fields and same-date totals against Vinosmith and current emailed
  RB6/RADs reports.

### Phase 3: Normalized financial tables

- Design local normalized tables for QuickBooks financial data.
- Keep QuickBooks Desktop as the financial source of truth.
- Keep Vinosmith as the current operational and wine-metadata source.
- Keep the Stem app as the logic and intelligence layer.
- Do not replace any production source until parity is proven.

### Phase 4: Draft PO workflow inside Stem

- Generate recommended PO drafts inside Stem only.
- Do not write purchase orders to QuickBooks yet.
- Add an explicit approval flow.
- Add an immutable audit log.
- Validate QuickBooks vendor and item mappings.

### Phase 5: Controlled QuickBooks PO write-back

- Treat QuickBooks purchase orders as non-posting transactions, but still gate
  every write as a financial-system change.
- Begin only after accountant and leadership approval.
- Use `PurchaseOrderAdd`.
- Test first in a backup/test company file or with a tightly controlled test
  vendor/item.
- Prevent duplicate purchase orders and make retries idempotent.
- Require explicit approval immediately before every write.
- Log every qbXML request and response with actor and resulting QuickBooks IDs.
- Handle errors, partial failures, and rollback/cleanup manually during validation.
- Keep auto-run disabled until the workflow is fully validated.

### Phase 6: Future receiving workflow

- Evaluate whether `ItemReceiptAdd` should eventually receive inventory against
  QuickBooks purchase orders.
- Keep receiving separate from purchase-order creation.
- Do not include receiving in the first build.

### Accountant questions before write-back

1. Should Stem create actual QuickBooks purchase orders or only draft POs for
   accounting review?
2. Who must approve before a PO is pushed into QuickBooks?
3. Should QuickBooks or Stem assign PO numbers?
4. What should happen when a vendor or item does not exist in QuickBooks?
5. Are Item Receipts used when inventory arrives?
6. Should Stem ever modify or cancel QuickBooks POs, or only create them?
7. What audit trail is required?
8. Is there a test company file or safe test vendor/item?
