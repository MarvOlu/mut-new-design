import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { designImage } from "@/lib/design-images";
import { formatKenyanPhone } from "@/lib/mpesa";
import { formatKsh } from "@/lib/shop-queries";
import { startCheckout, type Design } from "@/lib/shop.functions";

export function BasketSheet({
  open,
  onOpenChange,
  items,
  onRemove,
  onCleared,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Design[];
  onRemove: (id: string) => void;
  onCleared: () => void;
}) {
  const navigate = useNavigate();
  const checkout = useServerFn(startCheckout);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const total = items.reduce((s, d) => s + d.price, 0);
  const phoneValid = !!formatKenyanPhone(phone);

  async function pay() {
    if (!phoneValid) {
      toast.error("Enter a valid Kenyan phone number, e.g. 0712345678.");
      return;
    }
    setBusy(true);
    try {
      const res = await checkout({ data: { phone, designIds: items.map((d) => d.id) } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Check your phone and enter your M-PESA PIN.");
      onCleared();
      onOpenChange(false);
      navigate({ to: "/order/$orderId", params: { orderId: res.orderId } });
    } catch {
      toast.error("Could not reach M-PESA. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle className="font-display text-2xl">Your basket</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {items.length === 0 && <p className="text-muted-foreground">Your basket is empty.</p>}
          {items.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
            >
              <img
                src={designImage(d.image_key)}
                alt=""
                className="h-16 w-16 rounded-xl object-cover"
                loading="lazy"
                width={64}
                height={64}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{d.name}</p>
                <p className="text-sm text-muted-foreground">{formatKsh(d.price)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(d.id)}
                aria-label={`Remove ${d.name}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-4 border-t border-border bg-muted p-6">
          <div className="flex items-center justify-between font-display text-lg font-bold">
            <span>Total</span>
            <span>{formatKsh(total)}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mpesa-phone">M-PESA phone number</Label>
            <div className="relative">
              <Smartphone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="mpesa-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="0712345678"
                maxLength={13}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 rounded-full bg-card pl-9 text-base"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This phone will receive the M-PESA prompt.
            </p>
          </div>
          <Button
            variant="mpesa"
            size="xl"
            className="w-full"
            disabled={!items.length || busy}
            onClick={pay}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Sending M-PESA prompt…" : `Pay ${formatKsh(total)} with M-PESA`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
