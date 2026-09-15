import { redirect } from "next/navigation";
import { PRODUCTS_DEFAULT_VIEW } from "@/components/dashboard-types";

export default function ProductsPage() {
  redirect(`/?view=${PRODUCTS_DEFAULT_VIEW}`);
}
