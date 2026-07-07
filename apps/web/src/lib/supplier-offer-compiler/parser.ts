import type {
  SupplierOfferDocumentType,
  SupplierOfferExtractedRowDraft,
  SupplierOfferParserType
} from "./types";

export type SupplierOfferParseInput = {
  fileName: string;
  contentType?: string | null;
  bytes: Buffer;
  supplierId?: string | null;
  supplierName: string;
  documentType?: SupplierOfferDocumentType;
};

export type SupplierOfferParseResult = {
  parserType: SupplierOfferParserType;
  parserVersion: string;
  rows: SupplierOfferExtractedRowDraft[];
  diagnostics: Record<string, unknown>;
};

export type SupplierOfferParser = {
  canParse(input: Pick<SupplierOfferParseInput, "fileName" | "contentType">): boolean;
  parse(input: SupplierOfferParseInput): Promise<SupplierOfferParseResult>;
};

export const SUPPLIER_OFFER_PARSER_VERSION = "supplier-offer-parser-v1";

