import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { dispatchProductOrders } from "@/lib/naver/client";
import { DELIVERY_COMPANIES, type DeliveryCompanyCode } from "@/lib/naver/config";

type ShipRequestBody = {
  shipments: { trackingNumber: string; productOrderId: string }[];
  deliveryCompanyCode: DeliveryCompanyCode;
};

export async function POST(request: NextRequest) {
  const body: ShipRequestBody = await request.json();

  if (!Array.isArray(body.shipments) || body.shipments.length === 0) {
    return NextResponse.json({ error: "shipments가 비어 있습니다." }, { status: 400 });
  }
  if (!DELIVERY_COMPANIES.some((c) => c.code === body.deliveryCompanyCode)) {
    return NextResponse.json({ error: "택배사를 올바르게 선택하세요." }, { status: 400 });
  }

  try {
    const targets = body.shipments.map((s) => ({
      ...s,
      deliveryCompanyCode: body.deliveryCompanyCode,
    }));
    const results = await dispatchProductOrders(targets);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
