import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { dispatchProductOrders, fetchDispatchedOrders } from "@/lib/naver/client";
import { DELIVERY_COMPANIES, type DeliveryCompanyCode } from "@/lib/naver/config";
import { toShippedShipments } from "@/lib/shipping/shipment";

export async function GET() {
  try {
    const orders = await fetchDispatchedOrders();
    const shipments = toShippedShipments(orders);
    return NextResponse.json({ shipments });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

type UpdateTrackingBody = {
  productOrderId: string;
  trackingNumber: string;
  deliveryCompanyCode: DeliveryCompanyCode;
};

// ⚠️ 운송장번호 수정용 별도 API가 공개 문서에서 확인되지 않아, 발송처리(dispatch) API를
// 같은 productOrderId로 다시 호출해 값을 덮어쓰는 방식으로 구현했다. 실제 반영 여부를 확인하세요.
export async function PATCH(request: NextRequest) {
  const body: UpdateTrackingBody = await request.json();

  if (!body.productOrderId || !body.trackingNumber) {
    return NextResponse.json({ error: "productOrderId/trackingNumber가 필요합니다." }, { status: 400 });
  }
  if (!DELIVERY_COMPANIES.some((c) => c.code === body.deliveryCompanyCode)) {
    return NextResponse.json({ error: "택배사를 올바르게 선택하세요." }, { status: 400 });
  }

  try {
    const results = await dispatchProductOrders([
      {
        productOrderId: body.productOrderId,
        trackingNumber: body.trackingNumber,
        deliveryCompanyCode: body.deliveryCompanyCode,
      },
    ]);
    return NextResponse.json({ results });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
