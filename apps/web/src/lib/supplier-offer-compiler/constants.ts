export const SUPPLIER_OFFER_DOCUMENT_TYPES = [
  "price_list",
  "inventory",
  "allocation",
  "closeout",
  "prearrival",
  "portfolio",
  "portal_export",
  "email_attachment",
  "unknown"
] as const;

export const SUPPLIER_OFFER_DOCUMENT_STATUSES = [
  "uploaded",
  "parsing",
  "parsed",
  "needs_document_review",
  "ready_for_review",
  "approved",
  "published",
  "rejected",
  "failed"
] as const;

export const SUPPLIER_OFFER_CANONICAL_FIELDS = [
  "producer",
  "wine_name",
  "vintage",
  "appellation",
  "region",
  "country",
  "grape",
  "bottle_size",
  "pack_size",
  "fob",
  "wholesale_price",
  "srp",
  "quantity",
  "arrival_date",
  "allocation_limit",
  "minimum_order",
  "discount",
  "deal_terms",
  "notes",
  "organic_biodynamic_notes"
] as const;

export const SUPPLIER_OFFER_REVIEW_TASK_TYPES = [
  "document_review",
  "field_review",
  "match_review",
  "pricing_review",
  "validation_review",
  "publish_review"
] as const;

export const SUPPLIER_OFFER_VALIDATION_SEVERITIES = ["blocker", "warning", "info"] as const;

export const SUPPLIER_OFFER_FIELD_REVIEW_STATUSES = [
  "unreviewed",
  "accepted",
  "corrected",
  "ignored",
  "rejected"
] as const;

export const SUPPLIER_OFFER_MATCH_SOURCES = [
  "supplier_catalog",
  "product",
  "quickbooks_item",
  "vinosmith",
  "recommendation"
] as const;

export const SUPPLIER_OFFER_MATCH_STATUSES = [
  "exact_match",
  "likely_match_needs_review",
  "new_vintage_candidate",
  "new_wine_candidate",
  "possible_duplicate",
  "conflict",
  "ignored",
  "accepted"
] as const;

export const SUPPLIER_OFFER_CONFIDENCE = {
  high: 0.9,
  review: 0.7,
  low: 0.5
} as const;

export const SUPPLIER_OFFER_PRICING_VERSION = "supplier-offer-pricing-v1";

