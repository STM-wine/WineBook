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
  transactions: QuickBooksSalesTransactionRow[];
  recentTransactions: QuickBooksSalesTransactionRow[];
  unavailableReason?: string | null;
};
