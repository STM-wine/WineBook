export type QuickBooksSalesSummaryRow = {
  key: string;
  label: string;
  invoiceSales: number;
  creditMemos: number;
  netSales: number;
  invoiceCount: number;
  creditMemoCount: number;
  creditMemoRate: number;
};

export type QuickBooksSalesTransactionRow = {
  id: string;
  type: "invoice" | "credit_memo";
  refNumber: string | null;
  txnDate: string | null;
  account: string;
  rep: string;
  amount: number;
};

export type QuickBooksSalesDashboardData = {
  generatedAt: string;
  salesDateFrom: string;
  salesDateTo: string;
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
  recentTransactions: QuickBooksSalesTransactionRow[];
  unavailableReason?: string | null;
};
