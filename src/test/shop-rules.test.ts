import { describe, expect, it } from "vitest";

import { canDownload, formatForFile } from "@/lib/downloads";
import {
  formatKenyanPhone,
  friendlyResult,
  nairobiTimestamp,
  orderTotal,
  parseStkCallback,
} from "@/lib/mpesa";

describe("M-PESA phone numbers", () => {
  it("converts 07, 01, +254, 254, 00254, and +2540 numbers to 254 format", () => {
    expect(formatKenyanPhone("0712 345 678")).toBe("254712345678");
    expect(formatKenyanPhone("0112345678")).toBe("254112345678");
    expect(formatKenyanPhone("+254712345678")).toBe("254712345678");
    expect(formatKenyanPhone("+254 712 345 678")).toBe("254712345678");
    expect(formatKenyanPhone("+254 (0) 712 345 678")).toBe("254712345678");
    expect(formatKenyanPhone("+2540712345678")).toBe("254712345678");
    expect(formatKenyanPhone("2540712345678")).toBe("254712345678");
    expect(formatKenyanPhone("00254712345678")).toBe("254712345678");
    expect(formatKenyanPhone("712345678")).toBe("254712345678");
    expect(formatKenyanPhone("\u202A+254 712 345 678\u202C")).toBe("254712345678");
  });
  it("rejects numbers that are not Kenyan mobiles", () => {
    expect(formatKenyanPhone("12345")).toBeNull();
    expect(formatKenyanPhone("0812345678")).toBeNull();
  });
});

describe("Daraja timestamp", () => {
  it("uses Kenyan time (UTC+3)", () => {
    expect(nairobiTimestamp(new Date("2026-11-11T22:30:05Z"))).toBe("20261112013005");
  });
});

describe("order total", () => {
  it("adds design prices in whole shillings", () => {
    expect(orderTotal([4500, 1225])).toBe(5725);
  });
});

describe("downloads", () => {
  it("are allowed only after a successful payment for a design in the order", () => {
    expect(canDownload({ status: "paid", design_ids: ["roller-castle"] }, "roller-castle")).toBe(
      true,
    );
    expect(canDownload({ status: "pending", design_ids: ["roller-castle"] }, "roller-castle")).toBe(
      false,
    );
    expect(canDownload({ status: "failed", design_ids: ["roller-castle"] }, "roller-castle")).toBe(
      false,
    );
    expect(canDownload({ status: "paid", design_ids: ["roller-castle"] }, "iron-door")).toBe(false);
  });
  it("offers PDF, DWG, DXF, PNG and JPG files only", () => {
    expect(formatForFile("plan.PDF")).toBe("pdf");
    expect(formatForFile("plan.dwg")).toBe("dwg");
    expect(formatForFile("plan.dxf")).toBe("dxf");
    expect(formatForFile("plan.png")).toBe("png");
    expect(formatForFile("plan.jpeg")).toBe("jpg");
    expect(formatForFile("plan.exe")).toBeNull();
  });
});

describe("Safaricom callback", () => {
  it("reads a successful payment", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "m1",
          CheckoutRequestID: "ws_CO_1",
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: 1225 },
              { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
              { Name: "PhoneNumber", Value: 254712345678 },
            ],
          },
        },
      },
    });
    expect(parsed).toMatchObject({
      checkoutRequestId: "ws_CO_1",
      resultCode: 0,
      amount: 1225,
      receipt: "NLJ7RT61SV",
    });
  });
  it("ignores bodies that are not callbacks", () => {
    expect(parseStkCallback({ hello: "world" })).toBeNull();
  });
});

describe("payment failure reasons", () => {
  it("explains cancelled and timed-out payments in plain words", () => {
    expect(friendlyResult(1032, "Request cancelled by user")).toBe(
      "The payment was cancelled on the phone.",
    );
    expect(friendlyResult("1037", "DS timeout")).toBe(
      "The phone could not be reached, or the prompt timed out.",
    );
    expect(friendlyResult(9999, "Something else")).toBe("Something else");
  });
});

import { addToBasket, parseStoredBasket, removeFromBasket } from "@/lib/basket";
import { visibleCategories } from "@/lib/categories";
import { designGallery } from "@/lib/design-images";
import { orderStage } from "@/lib/order-stages";

describe("design pictures", () => {
  it("shows every picture listed for a design", () => {
    expect(
      designGallery({
        images: ["residential", "https://example.com/a.jpg"],
        image_key: "commercial",
      }),
    ).toHaveLength(2);
    expect(designGallery({ images: ["https://example.com/a.jpg"], image_key: "x" })[0]).toBe(
      "https://example.com/a.jpg",
    );
  });
  it("falls back to the main picture when no list is set", () => {
    expect(designGallery({ images: [], image_key: "residential" })).toHaveLength(1);
  });
});

describe("basket", () => {
  it("adds a design only once", () => {
    expect(addToBasket(addToBasket([], "roller-castle"), "roller-castle")).toEqual([
      "roller-castle",
    ]);
  });
  it("removes a design", () => {
    expect(removeFromBasket(["a", "b"], "a")).toEqual(["b"]);
  });
  it("ignores a broken saved basket", () => {
    expect(parseStoredBasket("not json")).toEqual([]);
    expect(parseStoredBasket('["a","a",3]')).toEqual(["a"]);
  });
});

describe("category visibility", () => {
  it("shows only categories that have at least one design available", () => {
    const categories = [
      { name: "Commercial", emoji: "🌆", sort_order: 2 },
      { name: "Residential", emoji: "🏠", sort_order: 1 },
      { name: "Empty Category", emoji: "📐", sort_order: 3 },
    ];
    const designs = [{ category: "Residential" }, { category: "Commercial" }];
    expect(visibleCategories(categories, designs).map((c) => c.name)).toEqual([
      "Residential",
      "Commercial",
    ]);
  });
});

describe("order dashboard stages", () => {
  const now = new Date("2026-11-13T12:00:00Z").getTime();
  it("classifies received, processing, completed, and rejected orders", () => {
    expect(
      orderStage(
        { status: "pending", created_at: "2026-11-13T11:58:00Z", downloaded_at: null },
        now,
      ),
    ).toBe("received");
    expect(
      orderStage({ status: "paid", created_at: "2026-11-13T11:30:00Z", downloaded_at: null }, now),
    ).toBe("processing");
    expect(
      orderStage(
        {
          status: "paid",
          created_at: "2026-11-13T10:00:00Z",
          downloaded_at: "2026-11-13T10:05:00Z",
        },
        now,
      ),
    ).toBe("completed");
    expect(
      orderStage(
        { status: "failed", created_at: "2026-11-13T10:00:00Z", downloaded_at: null },
        now,
      ),
    ).toBe("rejected");
    expect(
      orderStage(
        { status: "pending", created_at: "2026-11-13T11:00:00Z", downloaded_at: null },
        now,
      ),
    ).toBe("rejected");
  });
});

import {
  clampCrop,
  estimateBase64Bytes,
  fitDimensions,
  rotatedDimensions,
} from "@/lib/image-optimizer";

describe("image optimization & editing helpers", () => {
  it("scales oversized dimensions proportionally within maxDim", () => {
    expect(fitDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("swaps dimensions on 90/270 degree rotations", () => {
    expect(rotatedDimensions(1200, 800, 90)).toEqual({ width: 800, height: 1200 });
    expect(rotatedDimensions(1200, 800, 180)).toEqual({ width: 1200, height: 800 });
  });

  it("clamps crop boxes inside [0, 1] bounds", () => {
    expect(clampCrop({ x: -0.2, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });

  it("estimates encoded byte length from base64 data URLs", () => {
    expect(estimateBase64Bytes("data:image/webp;base64,AAAA")).toBe(3);
  });
});
