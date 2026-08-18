import type { NaverProductOrder } from "@/lib/naver/types";

export type PlaceOrderState = "PRE_CONFIRM" | "CONFIRMED";

export type Shipment = {
  productOrderId: string;
  receiverName: string;
  receiverTel: string;
  baseAddress: string;
  detailAddress: string;
  productName: string;
  optionInfo?: string;
  quantity: number;
  shippingMemo?: string;
  placeOrderState: PlaceOrderState;
};

// 주문 1건 = 발송 1건. 합포장(주소 묶음) 없이 그대로 매핑한다.
// placeOrderStatus "OK" = 발주확인 완료(CONFIRMED), 그 외(아직 값이 없는 경우 등) = 발주전(PRE_CONFIRM).
export function toShipments(orders: NaverProductOrder[]): Shipment[] {
  return orders.map((order) => ({
    productOrderId: order.productOrderId,
    receiverName: order.shippingAddress.name,
    receiverTel: order.shippingAddress.tel1 ?? order.shippingAddress.tel2 ?? "",
    baseAddress: order.shippingAddress.baseAddress,
    detailAddress: order.shippingAddress.detailAddress,
    productName: order.productName,
    optionInfo: order.optionInfo,
    quantity: order.quantity,
    shippingMemo: order.shippingMemo,
    placeOrderState: order.placeOrderStatus === "OK" ? "CONFIRMED" : "PRE_CONFIRM",
  }));
}

export type ShippedShipment = Shipment & {
  trackingNumber: string;
  deliveryCompanyCode: string;
};

export function toShippedShipments(orders: NaverProductOrder[]): ShippedShipment[] {
  return toShipments(orders).map((shipment, i) => ({
    ...shipment,
    trackingNumber: orders[i].trackingNumber ?? "",
    deliveryCompanyCode: orders[i].deliveryCompanyCode ?? "",
  }));
}
