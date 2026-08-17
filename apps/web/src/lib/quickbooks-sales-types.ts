export type QuickBooksSalesSummaryRow = {
  key: string;
  label: string;
  invoiceSales: number;
  creditMemos: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  creditMemoRate: number;
  grossProfit?: number | null;
  grossProfitPercent?: number | null;
  grossProfitUnavailableReason?: string | null;
  sampleCost?: number;
  lastYearNetSales?: number | null;
  netSalesChangePercent?: number | null;
};

export type QuickBooksSalesMonthColumn = {
  key: string;
  label: string;
};

export type QuickBooksSalesMonthlyRepRow = {
  key: string;
  label: string;
  months: Record<string, number>;
  total: number;
};

export type QuickBooksSalesTransactionRow = {
  id: string;
  type: "invoice" | "credit_memo";
  refNumber: string | null;
  txnDate: string | null;
  salesDate: string | null;
  account: string;
  rep: string;
  amount: number;
  items: QuickBooksSalesLineRow[];
};

export type QuickBooksSalesLineRow = {
  item: string;
  description: string | null;
  quantity: number | null;
  amount: number;
};

export type QuickBooksSalesDashboardFilters = {
  dateFrom?: string;
  dateTo?: string;
  rep?: string;
  documentType?: "all" | "invoice" | "credit_memo";
  account?: string;
  item?: string;
  document?: string;
  includeItems?: boolean;
  includeTransactions?: boolean;
};

export type QuickBooksSalesDashboardData = {
  generatedAt: string;
  salesDateFrom: string;
  salesDateTo: string;
  availableDateFrom: string;
  availableDateTo: string;
  dateBasis: string;
  invoiceCount: number;
  creditMemoCount: number;
  invoiceSales: number;
  creditMemos: number;
  netSales: number;
  lastInvoiceDate: string | null;
  lastCreditMemoDate: string | null;
  byRep: QuickBooksSalesSummaryRow[];
  byAccount: QuickBooksSalesSummaryRow[];
  byItem: QuickBooksSalesSummaryRow[];
  monthColumns: QuickBooksSalesMonthColumn[];
  byRepMonthly: QuickBooksSalesMonthlyRepRow[];
  transactions: QuickBooksSalesTransactionRow[];
  recentTransactions: QuickBooksSalesTransactionRow[];
  byItemLoaded?: boolean;
  transactionLimit?: number;
  unavailableReason?: string | null;
};
