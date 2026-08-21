import { getAccessToken } from "./auth";
import { NAVER_API_BASE } from "./config";
import type { DispatchResult, DispatchTarget, NaverProductOrder } from "./types";

// ⚠️ 아래 엔드포인트/응답 구조는 공개 문서·커뮤니티 예제를 바탕으로 한 최선의 추정입니다.
// 실제 계정으로 첫 호출을 해본 뒤, /api/naver-debug 로 raw 응답을 확인하고
// normalizeProductOrder() 의 필드 매핑을 실제 값에 맞게 조정하세요.
// 응답 스펙이 확정되지 않아 이 파일 안에서는 원시 JSON을 any로 다룬다.
/* eslint-disable @typescript-eslint/no-explicit-any */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_RETRY_COUNT = 3;

async function callNaverApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const accessToken = await getAccessToken();
    const res = await fetch(`${NAVER_API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      // 요청이 몰릴 때 네이버 API 게이트웨이가 429(GW.RATE_LIMIT)를 반환하므로,
      // 잠깐 대기 후 재시도한다. 그래도 실패하면 에러를 그대로 던진다.
      if (res.status === 429 && attempt < RATE_LIMIT_RETRY_COUNT) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`네이버 API 호출 실패 (${path}, ${res.status}): ${text}`);
    }

    return text ? JSON.parse(text) : ({} as T);
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// lastChangedFrom~lastChangedTo 구간은 최대 24시간까지만 허용되므로, 하루 단위로 나눠서 반복 호출한다.
async function fetchChangedProductOrderIdsInWindow(
  fromMs: number,
  toMs: number,
  lastChangedType: string
): Promise<string[]> {
  // lastChangedType은 한 번에 하나의 값만 허용된다 (콤마로 여러 값 전달 시 400 에러).
  const query = new URLSearchParams({
    lastChangedFrom: new Date(fromMs).toISOString(),
    lastChangedTo: new Date(toMs).toISOString(),
    lastChangedType,
  });

  const raw = await callNaverApi<any>(
    `/v1/pay-order/seller/product-orders/last-changed-statuses?${query.toString()}`
  );

  const list: any[] = raw?.data?.lastChangeStatuses ?? raw?.data ?? [];
  return list.map((item) => item.productOrderId ?? item.orderId).filter(Boolean);
}

async function fetchChangedProductOrderIds(sinceMs: number, lastChangedType: string): Promise<string[]> {
  const now = Date.now();
  const ids = new Set<string>();

  for (let windowStart = sinceMs; windowStart < now; windowStart += ONE_DAY_MS) {
    const windowEnd = Math.min(windowStart + ONE_DAY_MS, now);
    const windowIds = await fetchChangedProductOrderIdsInWindow(windowStart, windowEnd, lastChangedType);
    windowIds.forEach((id) => ids.add(id));
    // 하루 단위로 나눠 여러 번 호출하다 API 호출 제한(429)에 걸리지 않도록 약간의 간격을 둔다.
    if (windowEnd < now) await sleep(500);
  }

  return Array.from(ids);
}

// 실제 응답 구조를 확인해 normalizeProductOrder()의 필드 매핑을 검증/조정할 때 사용하는 디버그용 함수.
export async function fetchRawDebugSample(lookbackDays = 2, lastChangedType = "PAYED") {
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const changedIds = await fetchChangedProductOrderIds(sinceMs, lastChangedType);
  const detailsRaw = changedIds.length
    ? await callNaverApi<any>(`/v1/pay-order/seller/product-orders/query`, {
        method: "POST",
        body: JSON.stringify({ productOrderIds: changedIds }),
      })
    : null;

  return { changedIds, detailsRaw };
}

function normalizeProductOrder(raw: any): NaverProductOrder | null {
  const productOrder = raw?.productOrder ?? raw;
  // 받는사람 이름/주소는 productOrder.shippingAddress에, 운송장번호/택배사는 별도의
  // delivery 객체에 들어있다 (발송처리 전에는 delivery가 아예 없다). 두 객체를 혼동해서
  // 하나로 fallback 체인을 타면, 발송완료 주문에서 delivery가 shippingAddress 자리를
  // 가로채 이름/주소가 비어버리므로 반드시 분리해서 읽는다.
  const address = productOrder?.shippingAddress ?? raw?.shippingAddress ?? {};
  const delivery = raw?.delivery ?? {};
  if (!productOrder?.productOrderId) return null;

  return {
    productOrderId: productOrder.productOrderId,
    productName: productOrder.productName ?? productOrder.productOrderOption ?? "",
    quantity: Number(productOrder.quantity ?? 1),
    optionInfo: productOrder.productOption ?? undefined,
    shippingMemo: productOrder.shippingMemo ?? undefined,
    productOrderStatus: productOrder.productOrderStatus ?? "",
    placeOrderStatus: productOrder.placeOrderStatus ?? undefined,
    shippingAddress: {
      name: address?.name ?? "",
      tel1: address?.tel1 ?? address?.tel ?? undefined,
      tel2: address?.tel2 ?? undefined,
      baseAddress: address?.baseAddress ?? address?.address ?? "",
      detailAddress: address?.detailedAddress ?? address?.detailAddress ?? "",
    },
    ordererName: raw?.order?.ordererName ?? undefined,
    trackingNumber: delivery?.trackingNumber ?? undefined,
    // 실제 응답 필드명은 deliveryCompanyCode가 아니라 deliveryCompany다 (/api/naver-debug로 확인).
    deliveryCompanyCode: delivery?.deliveryCompany ?? undefined,
    paymentDate: raw?.order?.paymentDate ?? undefined,
  };
}

function sortByPaymentDateDescending(orders: NaverProductOrder[]): NaverProductOrder[] {
  return [...orders].sort((a, b) => {
    if (!a.paymentDate) return 1;
    if (!b.paymentDate) return -1;
    return a.paymentDate < b.paymentDate ? 1 : a.paymentDate > b.paymentDate ? -1 : 0;
  });
}

async function fetchProductOrderDetails(productOrderIds: string[]): Promise<NaverProductOrder[]> {
  if (productOrderIds.length === 0) return [];

  const raw = await callNaverApi<any>(`/v1/pay-order/seller/product-orders/query`, {
    method: "POST",
    body: JSON.stringify({ productOrderIds }),
  });

  const list: any[] = raw?.data ?? [];
  return list.map(normalizeProductOrder).filter((o): o is NaverProductOrder => o !== null);
}

// 아직 발송 처리(운송장 등록) 되지 않은 결제완료 주문 전체를 반환한다.
// placeOrderStatus "OK" 여부로 발주전/발주확인 상태를 구분해서 사용하면 된다.
export async function fetchPayedUnshippedOrders(
  lookbackDays = 3
): Promise<NaverProductOrder[]> {
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const changedIds = await fetchChangedProductOrderIds(sinceMs, "PAYED");
  const details = await fetchProductOrderDetails(changedIds);

  return sortByPaymentDateDescending(
    details.filter((order) => order.productOrderStatus === "PAYED"),
  );
}

// 최근 발송처리(운송장 등록) 된 주문 목록. 운송장번호 수정/재출력 화면에서 사용한다.
export async function fetchDispatchedOrders(
  lookbackDays = 7
): Promise<NaverProductOrder[]> {
  const sinceMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const changedIds = await fetchChangedProductOrderIds(sinceMs, "DISPATCHED");
  const details = await fetchProductOrderDetails(changedIds);

  return sortByPaymentDateDescending(
    details.filter((order) => Boolean(order.trackingNumber)),
  );
}

// ⚠️ 발주확인 처리 API. 정확한 엔드포인트가 공개 문서에서 확인되지 않아
// 커머스 API의 dispatch 엔드포인트와 동일한 REST 패턴으로 추정한 값이다.
// 실제 호출 결과(특히 404 여부)를 보고 필요 시 경로를 조정하세요.
export async function confirmProductOrders(productOrderIds: string[]): Promise<DispatchResult[]> {
  if (productOrderIds.length === 0) return [];

  const raw = await callNaverApi<any>(`/v1/pay-order/seller/product-orders/confirm`, {
    method: "POST",
    body: JSON.stringify({ productOrderIds }),
  });

  if (Array.isArray(raw?.data)) {
    return raw.data.map((r: any) => ({
      productOrderId: r.productOrderId,
      success: !r.errorType && !r.message,
      message: r.message,
    }));
  }

  return productOrderIds.map((id) => ({ productOrderId: id, success: true }));
}

export async function dispatchProductOrders(
  targets: DispatchTarget[]
): Promise<DispatchResult[]> {
  const dispatchDate = new Date().toISOString();

  const raw = await callNaverApi<any>(
    `/v1/pay-order/seller/product-orders/dispatch`,
    {
      method: "POST",
      body: JSON.stringify({
        dispatchProductOrders: targets.map((t) => ({
          productOrderId: t.productOrderId,
          deliveryMethod: "DELIVERY",
          deliveryCompanyCode: t.deliveryCompanyCode,
          trackingNumber: t.trackingNumber,
          dispatchDate: t.dispatchDate ?? dispatchDate,
        })),
      }),
    }
  );

  if (Array.isArray(raw?.data)) {
    return raw.data.map((r: any) => ({
      productOrderId: r.productOrderId,
      success: !r.errorType && !r.message,
      message: r.message,
    }));
  }

  // 실패/성공 상세가 없는 경우, 호출 자체가 200이면 전체 성공으로 간주.
  return targets.map((t) => ({ productOrderId: t.productOrderId, success: true }));
}
