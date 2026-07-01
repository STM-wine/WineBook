import "server-only";

export const DEFAULT_QUICKBOOKS_DESKTOP_QBXML_VERSION = "16.0";

export const QUICKBOOKS_READ_ONLY_REQUEST_TYPES = [
  "CustomerQueryRq",
  "ItemQueryRq",
  "ItemInventoryQueryRq",
  "InvoiceQueryRq",
  "CreditMemoQueryRq",
  "ReceivePaymentQueryRq",
  "VendorQueryRq",
  "PurchaseOrderQueryRq",
  "TxnDeletedQueryRq"
] as const;

export const QUICKBOOKS_WRITE_REQUEST_SUFFIXES = ["AddRq", "ModRq", "DelRq"] as const;

const DEFAULT_OWNER_IDS = ["0"] as const;
const READ_ONLY_REQUEST_TYPE_SET = new Set<string>(QUICKBOOKS_READ_ONLY_REQUEST_TYPES);

export type QuickBooksReadOnlyRequestType = (typeof QUICKBOOKS_READ_ONLY_REQUEST_TYPES)[number];
export type QuickBooksIteratorMode = "Start" | "Continue" | "Stop";
export type QuickBooksActiveStatus = "ActiveOnly" | "InactiveOnly" | "All";
export type QuickBooksPaidStatus = "All" | "PaidOnly" | "NotPaidOnly";
export type QuickBooksTxnDeletedType =
  | "Invoice"
  | "CreditMemo"
  | "ReceivePayment"
  | "PurchaseOrder"
  | "Bill"
  | "VendorCredit";

export type QuickBooksDateRange = {
  from?: string;
  to?: string;
};

export type QuickBooksIteratorOptions = {
  mode?: QuickBooksIteratorMode;
  iteratorId?: string;
};

export type QuickBooksQueryOptions = {
  requestId?: string;
  maxReturned?: number;
  iterator?: QuickBooksIteratorOptions;
  includeRetElements?: string[];
  ownerIds?: string[];
};

export type QuickBooksListQueryOptions = QuickBooksQueryOptions & {
  activeStatus?: QuickBooksActiveStatus;
  listIds?: string[];
  fullNames?: string[];
  modifiedDateRange?: QuickBooksDateRange;
};

export type QuickBooksTransactionQueryOptions = QuickBooksQueryOptions & {
  txnIds?: string[];
  refNumbers?: string[];
  modifiedDateRange?: QuickBooksDateRange;
  txnDateRange?: QuickBooksDateRange;
  entityListIds?: string[];
  entityFullNames?: string[];
  includeLineItems?: boolean;
  includeLinkedTxns?: boolean;
};

export type QuickBooksInvoiceQueryOptions = QuickBooksTransactionQueryOptions & {
  paidStatus?: QuickBooksPaidStatus;
};

export type QuickBooksTxnDeletedQueryOptions = QuickBooksQueryOptions & {
  txnDeletedTypes: QuickBooksTxnDeletedType[];
  deletedDateRange?: QuickBooksDateRange;
};

export type QuickBooksDesktopClientOptions = {
  qbxmlVersion?: string;
};

export type QuickBooksDesktopQbxmlRequest = {
  requestType: QuickBooksReadOnlyRequestType;
  requestId?: string;
  qbxmlVersion: string;
  qbxml: string;
};

export type QuickBooksSalesDashboardDiscoveryOptions = {
  maxReturned?: number;
};

type QuickBooksRequestBuildParts = {
  requestId?: string;
  iterator?: QuickBooksIteratorOptions;
  body: string[];
};

export type QuickBooksQwcFileOptions = {
  appName: string;
  appUrl: string;
  username: string;
  ownerId: string;
  fileId: string;
  appDescription?: string;
  appSupportUrl?: string;
  appId?: string;
  qbType?: "QBFS" | "QBPOS";
  style?: "Document" | "RPC";
  isReadOnly?: boolean;
};

export type QuickBooksQbxmlResponseStatus = {
  requestType: string;
  responseType: string;
  statusCode: number | null;
  statusSeverity: string | null;
  statusMessage: string | null;
  iteratorRemainingCount?: number | null;
  iteratorId?: string | null;
};

export class QuickBooksDesktopClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickBooksDesktopClientError";
  }
}

export function createQuickBooksDesktopReadOnlyClient(options: QuickBooksDesktopClientOptions = {}) {
  const qbxmlVersion =
    options.qbxmlVersion || process.env.QUICKBOOKS_DESKTOP_QBXML_VERSION || DEFAULT_QUICKBOOKS_DESKTOP_QBXML_VERSION;

  return {
    buildCustomerQuery(params: QuickBooksListQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "CustomerQueryRq", buildListQueryBody(params));
    },
    buildItemQuery(params: QuickBooksListQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "ItemQueryRq", buildListQueryBody(params));
    },
    buildItemInventoryQuery(params: QuickBooksListQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "ItemInventoryQueryRq", buildListQueryBody(params));
    },
    buildInvoiceQuery(params: QuickBooksInvoiceQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "InvoiceQueryRq", buildTransactionQueryBody("InvoiceQueryRq", params));
    },
    buildCreditMemoQuery(params: QuickBooksTransactionQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "CreditMemoQueryRq", buildTransactionQueryBody("CreditMemoQueryRq", params));
    },
    buildReceivePaymentQuery(params: QuickBooksTransactionQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "ReceivePaymentQueryRq", buildTransactionQueryBody("ReceivePaymentQueryRq", params));
    },
    buildVendorQuery(params: QuickBooksListQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "VendorQueryRq", buildListQueryBody(params));
    },
    buildPurchaseOrderQuery(params: QuickBooksTransactionQueryOptions = {}) {
      return buildQueryRequest(qbxmlVersion, "PurchaseOrderQueryRq", buildTransactionQueryBody("PurchaseOrderQueryRq", params));
    },
    buildTxnDeletedQuery(params: QuickBooksTxnDeletedQueryOptions) {
      return buildQueryRequest(qbxmlVersion, "TxnDeletedQueryRq", buildTxnDeletedQueryBody(params));
    }
  };
}

export type QuickBooksDesktopReadOnlyClient = ReturnType<typeof createQuickBooksDesktopReadOnlyClient>;

export function buildQuickBooksSalesDashboardDiscoveryRequests(
  options: QuickBooksSalesDashboardDiscoveryOptions = {}
): QuickBooksDesktopQbxmlRequest[] {
  const maxReturned = options.maxReturned || 10;
  const client = createQuickBooksDesktopReadOnlyClient();

  return [
    client.buildCustomerQuery({
      requestId: "sales-dashboard-customers",
      maxReturned,
      activeStatus: "All"
    }),
    client.buildItemQuery({
      requestId: "sales-dashboard-items",
      maxReturned,
      activeStatus: "All"
    }),
    client.buildInvoiceQuery({
      requestId: "sales-dashboard-invoices",
      maxReturned,
      paidStatus: "All",
      includeLineItems: true,
      includeLinkedTxns: true
    }),
    client.buildCreditMemoQuery({
      requestId: "sales-dashboard-credit-memos",
      maxReturned,
      includeLineItems: true,
      includeLinkedTxns: true
    }),
    client.buildReceivePaymentQuery({
      requestId: "sales-dashboard-payments",
      maxReturned,
      includeLineItems: false,
      includeLinkedTxns: true
    })
  ];
}

export function buildQuickBooksDesktopQwcFile(options: QuickBooksQwcFileOptions) {
  const qbType = options.qbType || "QBFS";
  const style = options.style || "Document";
  const isReadOnly = options.isReadOnly ?? true;

  if (!options.appName.trim()) {
    throw new QuickBooksDesktopClientError("QuickBooks .qwc AppName is required.");
  }
  if (!/^https:\/\//i.test(options.appUrl)) {
    throw new QuickBooksDesktopClientError("QuickBooks .qwc AppURL must be HTTPS for the hosted POC.");
  }
  if (!options.username.trim()) {
    throw new QuickBooksDesktopClientError("QuickBooks .qwc UserName is required.");
  }
  assertGuid(options.ownerId, "OwnerID");
  assertGuid(options.fileId, "FileID");

  return [
    '<?xml version="1.0"?>',
    "<QBWCXML>",
    xmlElement("AppName", options.appName),
    xmlElement("AppID", options.appId || ""),
    xmlElement("AppURL", options.appUrl),
    xmlElement("AppDescription", options.appDescription || "Stem Intelligence read-only QuickBooks Desktop discovery"),
    xmlElement("AppSupport", options.appSupportUrl || options.appUrl),
    xmlElement("UserName", options.username),
    xmlElement("OwnerID", options.ownerId),
    xmlElement("FileID", options.fileId),
    xmlElement("QBType", qbType),
    xmlElement("Style", style),
    xmlElement("IsReadOnly", isReadOnly ? "true" : "false"),
    "</QBWCXML>"
  ].join("\n");
}

export function assertQuickBooksReadOnlyQbxml(qbxml: string) {
  const requestTypes = extractQbxmlRequestTypes(qbxml);
  if (requestTypes.length === 0) {
    throw new QuickBooksDesktopClientError("QuickBooks qbXML contains no request messages.");
  }

  const unsafe = requestTypes.find((requestType) => isWriteRequestType(requestType));
  if (unsafe) {
    throw new QuickBooksDesktopClientError(`QuickBooks write request ${unsafe} is not allowed in the read-only client.`);
  }

  const unsupported = requestTypes.find((requestType) => !READ_ONLY_REQUEST_TYPE_SET.has(requestType));
  if (unsupported) {
    throw new QuickBooksDesktopClientError(`QuickBooks request ${unsupported} is not in the read-only allowlist.`);
  }
}

export function extractQbxmlRequestTypes(qbxml: string) {
  const requestTypes = new Set<string>();
  const requestTagPattern = /<([A-Za-z][A-Za-z0-9]*(?:QueryRq|AddRq|ModRq|DelRq))\b/g;
  let match = requestTagPattern.exec(qbxml);
  while (match) {
    requestTypes.add(match[1]);
    match = requestTagPattern.exec(qbxml);
  }
  return [...requestTypes];
}

export function parseQbxmlResponseStatuses(qbxmlResponse: string): QuickBooksQbxmlResponseStatus[] {
  const statuses: QuickBooksQbxmlResponseStatus[] = [];
  const responseTagPattern = /<([A-Za-z][A-Za-z0-9]*Rs)\b([^>]*)>/g;
  let match = responseTagPattern.exec(qbxmlResponse);
  while (match) {
    const responseType = match[1];
    if (responseType !== "QBXMLMsgsRs") {
      const attrs = parseXmlAttributes(match[2]);
      statuses.push({
        responseType,
        requestType: responseType.replace(/Rs$/, "Rq"),
        statusCode: attrs.statusCode ? Number(attrs.statusCode) : null,
        statusSeverity: attrs.statusSeverity || null,
        statusMessage: attrs.statusMessage || null,
        iteratorRemainingCount: attrs.iteratorRemainingCount ? Number(attrs.iteratorRemainingCount) : null,
        iteratorId: attrs.iteratorID || null
      });
    }
    match = responseTagPattern.exec(qbxmlResponse);
  }
  return statuses;
}

function buildQueryRequest(
  qbxmlVersion: string,
  requestType: QuickBooksReadOnlyRequestType,
  parts: QuickBooksRequestBuildParts,
): QuickBooksDesktopQbxmlRequest {
  const qbxml = buildQbxmlEnvelope(qbxmlVersion, buildRequestElement(requestType, parts));
  assertQuickBooksReadOnlyQbxml(qbxml);
  return {
    requestType,
    requestId: parts.requestId,
    qbxmlVersion,
    qbxml
  };
}

function buildQbxmlEnvelope(qbxmlVersion: string, requestXml: string) {
  return [
    '<?xml version="1.0"?>',
    '<?qbxml version="' + escapeXmlAttribute(qbxmlVersion) + '"?>',
    "<QBXML>",
    "  <QBXMLMsgsRq onError=\"stopOnError\">",
    indentXml(requestXml, 4),
    "  </QBXMLMsgsRq>",
    "</QBXML>"
  ].join("\n");
}

function buildRequestElement(requestType: QuickBooksReadOnlyRequestType, parts: QuickBooksRequestBuildParts) {
  const attrs = [
    parts.requestId ? `requestID="${escapeXmlAttribute(parts.requestId)}"` : null,
    parts.iterator?.mode ? `iterator="${escapeXmlAttribute(parts.iterator.mode)}"` : null,
    parts.iterator?.iteratorId ? `iteratorID="${escapeXmlAttribute(parts.iterator.iteratorId)}"` : null
  ].filter(Boolean);
  const openTag = attrs.length ? `<${requestType} ${attrs.join(" ")}>` : `<${requestType}>`;
  return [openTag, ...parts.body.map((part) => indentXml(part, 2)), `</${requestType}>`].join("\n");
}

function buildListQueryBody(params: QuickBooksListQueryOptions) {
  const body: string[] = [];
  pushCommonQueryParts(body, params);

  if (params.listIds?.length) {
    body.push(...params.listIds.map((value) => xmlElement("ListID", value)));
  } else if (params.fullNames?.length) {
    body.push(...params.fullNames.map((value) => xmlElement("FullName", value)));
  } else {
    body.push(xmlElement("ActiveStatus", params.activeStatus || "All"));
    pushModifiedDateRange(body, params.modifiedDateRange);
  }

  pushIncludeRetElements(body, params.includeRetElements);
  pushOwnerIds(body, params.ownerIds);
  return { requestId: params.requestId, iterator: params.iterator, body };
}

function buildTransactionQueryBody(
  requestType: "InvoiceQueryRq" | "CreditMemoQueryRq" | "ReceivePaymentQueryRq" | "PurchaseOrderQueryRq",
  params: QuickBooksInvoiceQueryOptions | QuickBooksTransactionQueryOptions
) {
  const body: string[] = [];
  pushCommonQueryParts(body, params);

  if (params.txnIds?.length) {
    body.push(...params.txnIds.map((value) => xmlElement("TxnID", value)));
  } else if (params.refNumbers?.length) {
    body.push(...params.refNumbers.map((value) => xmlElement("RefNumber", value)));
  } else {
    const filter: string[] = [];
    pushModifiedDateRange(filter, params.modifiedDateRange);
    pushTxnDateRange(filter, params.txnDateRange);
    pushEntityFilter(filter, params);
    if ("paidStatus" in params && params.paidStatus) {
      filter.push(xmlElement("PaidStatus", params.paidStatus));
    }
    if (filter.length) {
      body.push(xmlAggregate(transactionFilterName(requestType), filter));
    }
  }

  body.push(xmlElement("IncludeLineItems", params.includeLineItems ?? true));
  body.push(xmlElement("IncludeLinkedTxns", params.includeLinkedTxns ?? true));
  pushIncludeRetElements(body, params.includeRetElements);
  pushOwnerIds(body, params.ownerIds);
  return { requestId: params.requestId, iterator: params.iterator, body };
}

function transactionFilterName(
  requestType: "InvoiceQueryRq" | "CreditMemoQueryRq" | "ReceivePaymentQueryRq" | "PurchaseOrderQueryRq"
) {
  return requestType.replace(/QueryRq$/, "Filter");
}

function buildTxnDeletedQueryBody(params: QuickBooksTxnDeletedQueryOptions) {
  const body: string[] = [];
  pushCommonQueryParts(body, params);
  for (const txnDeletedType of params.txnDeletedTypes) {
    body.push(xmlElement("TxnDelType", txnDeletedType));
  }
  if (params.deletedDateRange?.from || params.deletedDateRange?.to) {
    const range: string[] = [];
    if (params.deletedDateRange.from) range.push(xmlElement("FromDeletedDate", params.deletedDateRange.from));
    if (params.deletedDateRange.to) range.push(xmlElement("ToDeletedDate", params.deletedDateRange.to));
    body.push(xmlAggregate("DeletedDateRangeFilter", range));
  }
  return { requestId: params.requestId, iterator: params.iterator, body };
}

function pushCommonQueryParts(body: string[], params: QuickBooksQueryOptions) {
  if (params.maxReturned !== undefined) {
    const maxReturned = Math.trunc(Number(params.maxReturned));
    if (!Number.isFinite(maxReturned) || maxReturned < 1) {
      throw new QuickBooksDesktopClientError("QuickBooks MaxReturned must be at least 1.");
    }
    body.push(xmlElement("MaxReturned", maxReturned));
  }
}

function pushModifiedDateRange(body: string[], dateRange?: QuickBooksDateRange) {
  if (!dateRange?.from && !dateRange?.to) return;
  const range: string[] = [];
  if (dateRange.from) range.push(xmlElement("FromModifiedDate", dateRange.from));
  if (dateRange.to) range.push(xmlElement("ToModifiedDate", dateRange.to));
  body.push(xmlAggregate("ModifiedDateRangeFilter", range));
}

function pushTxnDateRange(body: string[], dateRange?: QuickBooksDateRange) {
  if (!dateRange?.from && !dateRange?.to) return;
  const range: string[] = [];
  if (dateRange.from) range.push(xmlElement("FromTxnDate", dateRange.from));
  if (dateRange.to) range.push(xmlElement("ToTxnDate", dateRange.to));
  body.push(xmlAggregate("TxnDateRangeFilter", range));
}

function pushEntityFilter(body: string[], params: QuickBooksTransactionQueryOptions) {
  if (!params.entityListIds?.length && !params.entityFullNames?.length) return;
  const entityFilter: string[] = [];
  if (params.entityListIds?.length) {
    entityFilter.push(...params.entityListIds.map((value) => xmlElement("ListID", value)));
  } else if (params.entityFullNames?.length) {
    entityFilter.push(...params.entityFullNames.map((value) => xmlElement("FullName", value)));
  }
  body.push(xmlAggregate("EntityFilter", entityFilter));
}

function pushIncludeRetElements(body: string[], includeRetElements?: string[]) {
  if (!includeRetElements?.length) return;
  body.push(...includeRetElements.map((value) => xmlElement("IncludeRetElement", value)));
}

function pushOwnerIds(body: string[], ownerIds: string[] = [...DEFAULT_OWNER_IDS]) {
  for (const ownerId of ownerIds) {
    body.push(xmlElement("OwnerID", ownerId));
  }
}

function isWriteRequestType(requestType: string) {
  return QUICKBOOKS_WRITE_REQUEST_SUFFIXES.some((suffix) => requestType.endsWith(suffix));
}

function xmlAggregate(name: string, children: string[]) {
  return [`<${name}>`, ...children.map((child) => indentXml(child, 2)), `</${name}>`].join("\n");
}

function xmlElement(name: string, value: string | number | boolean) {
  return `<${name}>${escapeXmlText(String(value))}</${name}>`;
}

function indentXml(value: string, spaces: number) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function parseXmlAttributes(rawAttributes: string) {
  const attrs: Record<string, string> = {};
  const attrPattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*"([^"]*)"/g;
  let match = attrPattern.exec(rawAttributes);
  while (match) {
    attrs[match[1]] = unescapeXmlText(match[2]);
    match = attrPattern.exec(rawAttributes);
  }
  return attrs;
}

function unescapeXmlText(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function assertGuid(value: string, label: string) {
  if (!/^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i.test(value)) {
    throw new QuickBooksDesktopClientError(`QuickBooks .qwc ${label} must be a braced GUID.`);
  }
}
