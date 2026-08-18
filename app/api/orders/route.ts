import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errorMessage";
import { fetchPayedUnshippedOrders } from "@/lib/naver/client";
import { toShipments } from "@/lib/shipping/shipment";

export async function GET() {
  try {
    const orders = await fetchPayedUnshippedOrders();
    const shipments = toShipments(orders);
    return NextResponse.json({ shipments });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
