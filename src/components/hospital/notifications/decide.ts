import type { Notice } from "@/lib/hospital/notifications";
import {
  decideInvoiceChange,
  decideIssueOrder,
  decidePatientDelete,
  decidePaymentOrder,
  decidePettyRequest,
  decidePurchaseOrder,
  decideRefund,
  decideAdvance,
  decideDayReopen,
} from "@/lib/hospital/store";

/** Sends the approver's decision on any request type; the reason is kept where the type stores one. */
export async function decideNotice(n: Notice, approve: boolean, note?: string): Promise<boolean> {
  const reason = note?.trim() || undefined;
  switch (n.kind) {
    case "payment":
      return !!decidePaymentOrder(n.id, approve, reason);
    case "petty":
      return !!decidePettyRequest(n.id, approve, reason);
    case "purchase":
      return !!decidePurchaseOrder(n.id, approve);
    case "issue":
      return !!decideIssueOrder(n.id, approve, reason);
    case "receipt":
      return !!decideInvoiceChange(n.id, approve);
    case "patientDelete":
      return decidePatientDelete(n.id, approve);
    case "refund":
      return decideRefund(n.id, approve, reason);
    case "advance":
      return decideAdvance(n.id, approve, reason);
    case "dayReopen":
      return decideDayReopen(n.id, approve, reason);
  }
}
