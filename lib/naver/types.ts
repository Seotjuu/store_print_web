// 네이버 커머스 API 응답의 필요한 필드만 최소로 정의.
// 실제 응답 스펙은 https://apicenter.commerce.naver.com 문서/샘플 호출로 반드시 재검증할 것.

export type NaverProductOrder = {
  productOrderId: string;
  productName: string;
  quantity: number;
  optionInfo?: string;
  shippingMemo?: string;
  productOrderStatus: string;
  placeOrderStatus?: string;
  shippingAddress: {
    name: string;
    tel1?: string;
    tel2?: string;
    baseAddress: string;
    detailAddress: string;
  };
  ordererName?: string;
  trackingNumber?: string;
  deliveryCompanyCode?: string;
};

export type DispatchTarget = {
  productOrderId: string;
  deliveryCompanyCode: string;
  trackingNumber: string;
  dispatchDate?: string;
};

export type DispatchResult = {
  productOrderId: string;
  success: boolean;
  message?: string;
};
