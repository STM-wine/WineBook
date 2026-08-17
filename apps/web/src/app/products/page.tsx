import { redirect } from "next/navigation";

export default function ProductsPage() {
  redirect("/?view=product-workspace");
}
