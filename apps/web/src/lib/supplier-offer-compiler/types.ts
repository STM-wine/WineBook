import type {
  SUPPLIER_OFFER_CANONICAL_FIELDS,
  SUPPLIER_OFFER_DOCUMENT_STATUSES,
  SUPPLIER_OFFER_DOCUMENT_TYPES,
  SUPPLIER_OFFER_FIELD_REVIEW_STATUSES,
  SUPPLIER_OFFER_MATCH_SOURCES,
  SUPPLIER_OFFER_MATCH_STATUSES,
  SUPPLIER_OFFER_REVIEW_TASK_TYPES,
  SUPPLIER_OFFER_VALIDATION_SEVERITIES
} from "./constants";

export type SupplierOfferDocumentType = (typeof SUPPLIER_OFFER_DOCUMENT_TYPES)[number];
export type SupplierOfferDocumentStatus = (typeof SUPPLIER_OFFER_DOCUMENT_STATUSES)[number];
export type SupplierOfferCanonicalField = (typeof SUPPLIER_OFFER_CANONICAL_FIELDS)[number];
export type SupplierOfferFieldReviewStatus = (typeof SUPPLIER_OFFER_FIELD_REVIEW_STATUSES)[number];
export type SupplierOfferReviewTaskType = (typeof SUPPLIER_OFFER_REVIEW_TASK_TYPES)[number];
export type SupplierOfferValidationSeverity = (typeof SUPPLIER_OFFER_VALIDATION_SEVERITIES)[number];
export type SupplierOfferMatchSource = (typeof SUPPLIER_OFFER_MATCH_SOURCES)[number];
export type SupplierOfferMatchStatus = (typeof SUPPLIER_OFFER_MATCH_STATUSES)[number];

export type SupplierOfferSourceKind = "spreadsheet_row" | "csv_row" | "pdf_table_row" | "email_block";
export type SupplierOfferParserType = "xlsx" | "csv" | "pdf_text" | "pdf_ocr" | "manual";
export type SupplierOfferDataType = "text" | "number" | "money" | "date" | "boolean" | "json";

export type SupplierOfferDocumentDraft = {
  supplierId?: string | null;
  supplierName: string;
  originalFilename: string;
  contentType?: string | null;
  byteSize?: number | null;
  checksum?: string | null;
  storagePath?: string | null;
  documentType?: SupplierOfferDocumentType;
  documentTypeConfidence?: number;
  offerDate?: string | null;
  validUntil?: string | null;
  metadata?: Record<string, unknown>;
};

export type SupplierOfferEvidence = {
  documentId?: string | null;
  parseRunId?: string | null;
  extractedRowId?: string | null;
  fileName?: string | null;
  sheetName?: string | null;
  rowNumber?: number | null;
  columnHeader?: string | null;
  columnKey?: string | null;
  cellRef?: string | null;
  pageNumber?: number | null;
  region?: Record<string, unknown> | null;
  rawValue?: string | null;
  rawRow?: Record<string, unknown> | null;
};

export type SupplierOfferExtractedFieldDraft = {
  canonicalField: SupplierOfferCanonicalField;
  sourceHeader?: string | null;
  sourceColumn?: string | null;
  sourceCellRef?: string | null;
  originalValue?: string | null;
  normalizedValue?: string | null;
  dataType?: SupplierOfferDataType;
  extractionMethod?: string;
  confidence: number;
  evidence: SupplierOfferEvidence;
};

export type SupplierOfferExtractedRowDraft = {
  sourceKind: SupplierOfferSourceKind;
  sheetName?: string | null;
  rowNumber?: number | null;
  pageNumber?: number | null;
  regionRef?: Record<string, unknown>;
  rawRow?: Record<string, unknown>;
  rawText?: string | null;
  rowConfidence: number;
  isSkipped?: boolean;
  skipReason?: string | null;
  fields: SupplierOfferExtractedFieldDraft[];
};

export type SupplierOfferCandidateDraft = {
  supplierId?: string | null;
  supplierName: string;
  documentType: SupplierOfferDocumentType;
  producer?: string | null;
  wineName?: string | null;
  vintage?: string | null;
  appellation?: string | null;
  region?: string | null;
  country?: string | null;
  grape?: string | null;
  bottleSize?: string | null;
  packSize?: number | null;
  fob?: number | null;
  wholesalePrice?: number | null;
  srp?: number | null;
  quantity?: number | null;
  arrivalDate?: string | null;
  allocationLimit?: string | null;
  minimumOrder?: string | null;
  discount?: string | null;
  dealTerms?: string | null;
  notes?: string | null;
  overallConfidence: number;
  fields: SupplierOfferExtractedFieldDraft[];
  metadata?: Record<string, unknown>;
};

export type SupplierOfferPricingTraceStep = {
  label: string;
  value?: number | string | null;
  formula?: string;
  source?: string;
  rule?: string;
};

export type SupplierOfferPricingTraceDraft = {
  pricingVersion: string;
  currency: string;
  fob: number;
  freight: number;
  tax: number;
  landedCost: number;
  targetGp: number;
  rawWholesale: number;
  roundingRule: string;
  suggestedWholesale: number;
  suggestedFrontline: number;
  dealPrice: number | null;
  calculatedMargin: number;
  traceSteps: SupplierOfferPricingTraceStep[];
  warnings: string[];
};

export type SupplierOfferValidationResultDraft = {
  fieldName?: SupplierOfferCanonicalField | null;
  ruleCode: string;
  severity: SupplierOfferValidationSeverity;
  message: string;
  details?: Record<string, unknown>;
};

export type SupplierOfferMatchCandidateDraft = {
  source: SupplierOfferMatchSource;
  sourceId: string;
  matchStatus: SupplierOfferMatchStatus;
  score: number;
  rank: number;
  matchedDisplayName?: string | null;
  matchedSupplier?: string | null;
  matchedVintage?: string | null;
  matchedPackSize?: number | null;
  matchedBottleSize?: string | null;
  matchedFob?: number | null;
  explanation: Record<string, unknown>;
};

export type SupplierOfferReviewTaskDraft = {
  taskType: SupplierOfferReviewTaskType;
  severity: SupplierOfferValidationSeverity;
  title: string;
  description?: string | null;
  createdByRule?: string | null;
  metadata?: Record<string, unknown>;
};

export type SupplierOfferCompiledCandidate = {
  candidate: SupplierOfferCandidateDraft;
  pricingTrace: SupplierOfferPricingTraceDraft;
  validationResults: SupplierOfferValidationResultDraft[];
  reviewTasks: SupplierOfferReviewTaskDraft[];
  matchCandidates: SupplierOfferMatchCandidateDraft[];
};

