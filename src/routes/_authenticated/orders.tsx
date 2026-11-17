import { createFileRoute } from "@tanstack/react-router";
import { Banknote, ClipboardCheck, PackageCheck, PackageMinus } from "lucide-react";
import { PageHeader, StatCard } from "@/components/hospital/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentOrders } from "@/components/hospital/orders/PaymentOrders";
import { PurchaseOrders } from "@/components/hospital/orders/PurchaseOrders";
import { IssueOrders } from "@/components/hospital/orders/IssueOrders";
import { int, money } from "@/lib/hospital/format";
import { useHospitalDB } from "@/lib/hospital/store";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "أوامر الصرف واستلام الطلبيات | مستشفى الرحمة التخصصي" },
      {
        name: "description",
        content: "أوامر صرف النقدية بالاعتماد، طلبيات الشراء واستلامها على المخزن، وأذون الصرف المخزني للأقسام.",
      },
      { property: "og:title", content: "أوامر الصرف والطلبيات | مستشفى الرحمة التخصصي" },
      { property: "og:description", content: "دورة مستندية كاملة: طلب، اعتماد، صرف أو استلام." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const db = useHospitalDB();
  const pendingPay = db.paymentOrders.filter((o) => o.status === "pending");
  const toPay = db.paymentOrders.filter((o) => o.status === "approved");
  const toReceive = db.purchaseOrders.filter((o) => o.status === "approved" || o.status === "partial");
  const storeRequests = db.issueOrders.filter((o) => o.status === "pending" || o.status === "approved");
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="المصروفات والمخازن"
        title="أوامر الصرف والطلبيات"
        description="كل صرف نقدي يمر بأمر صرف، وكل طلبية شراء، وكل طلب قسم من المخزن — لا يُنفَّذ شيء منها إلا بعد موافقة المدير المالي."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="أوامر صرف بانتظار الاعتماد" value={int(pendingPay.length)} icon={ClipboardCheck} tone="copper" hint={`${money(pendingPay.reduce((s, o) => s + o.amount, 0))} ج.م`} />
        <StatCard label="معتمدة بانتظار الصرف" value={int(toPay.length)} icon={Banknote} tone="primary" hint={`${money(toPay.reduce((s, o) => s + o.amount, 0))} ج.م`} />
        <StatCard label="طلبيات بانتظار الاستلام" value={int(toReceive.length)} icon={PackageCheck} />
        <StatCard label="طلبات أقسام مفتوحة" value={int(storeRequests.length)} icon={PackageMinus} hint="بانتظار الاعتماد أو التسليم" />
      </div>
      <Tabs defaultValue="payment" dir="rtl">
        <TabsList className="mb-6 flex h-auto w-full justify-start gap-1 overflow-x-auto bg-muted p-1">
          <TabsTrigger value="payment" className="flex-none gap-1.5">
            <Banknote className="size-4" /> أوامر صرف النقدية
          </TabsTrigger>
          <TabsTrigger value="purchase" className="flex-none gap-1.5">
            <PackageCheck className="size-4" /> طلبيات الشراء والاستلام
          </TabsTrigger>
          <TabsTrigger value="issue" className="flex-none gap-1.5">
            <PackageMinus className="size-4" /> طلبات الأقسام من المخزن
          </TabsTrigger>
        </TabsList>
        <TabsContent value="payment">
          <PaymentOrders />
        </TabsContent>
        <TabsContent value="purchase">
          <PurchaseOrders />
        </TabsContent>
        <TabsContent value="issue">
          <IssueOrders />
        </TabsContent>
      </Tabs>
    </div>
  );
}
