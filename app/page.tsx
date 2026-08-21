"use client";

import { useEffect, useState } from "react";
import { getErrorMessage } from "@/lib/errorMessage";
import { optionInfoToHtml, parseOptionInfo } from "@/lib/shipping/formatOption";
import type { Shipment, ShippedShipment } from "@/lib/shipping/shipment";
import {
  DELIVERY_COMPANIES,
  type DeliveryCompanyCode,
} from "@/lib/naver/config";

type PoolStatus = {
  ranges: { id: string; start: string; end: string; createdAt: string }[];
  nextNumber: string | null;
  remainingInCurrentRange: number;
};

type SenderInfo = {
  name: string;
  phone: string;
  address: string;
  addressDetail: string;
};

type ShipmentWithTracking = Shipment & { trackingNumber?: string };

// TODO: 테스트 중 실수로 실제 발송처리가 나가지 않도록 임시로 막아둔 스위치.
// 실제 운영 전환 시 true로 되돌릴 것.
const SHIP_API_ENABLED = false;

const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const QUIET_HOURS_START = 20; // 오후 8시
const QUIET_HOURS_END = 9; // 오전 9시

// 이 PC의 시스템 시간이 한국 시간(KST)으로 맞춰져 있다고 가정한다.
function isQuietHours(date: Date) {
  const hour = date.getHours();
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

function msUntilNextInterval(date: Date, intervalMs: number) {
  const elapsed = date.getTime() % intervalMs;
  return intervalMs - elapsed;
}

const StepBadge = ({ n }: { n: number }) => (
  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white text-lg font-bold shrink-0">
    {n}
  </span>
);

const StatusBadge = ({ state }: { state: Shipment["placeOrderState"] }) =>
  state === "CONFIRMED" ? (
    <span className="inline-block text-sm bg-green-100 text-green-800 rounded px-2 py-0.5 font-semibold">
      발주확인
    </span>
  ) : (
    <span className="inline-block text-sm bg-orange-100 text-orange-800 rounded px-2 py-0.5 font-semibold">
      발주전
    </span>
  );

const Page = () => {
  const [shipments, setShipments] = useState<ShipmentWithTracking[]>([]);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [quietNow, setQuietNow] = useState(() => isQuietHours(new Date()));
  const [deliveryCompanyCode, setDeliveryCompanyCode] =
    useState<DeliveryCompanyCode>(DELIVERY_COMPANIES[0].code);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shippedShipments, setShippedShipments] = useState<ShippedShipment[]>(
    [],
  );
  const [trackingEdits, setTrackingEdits] = useState<Record<string, string>>(
    {},
  );
  const [activeTab, setActiveTab] = useState<"ship" | "shipped">("ship");
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const requestConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialog({ message, onConfirm });
  };

  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const showAlert = (message: string) => setAlertMessage(message);

  const appendLog = (message: string) => {
    const time = new Date().toLocaleTimeString("ko-KR");
    setLog((prev) => [`[${time}] ${message}`, ...prev]);
  };

  const applyPoolStatus = (data: PoolStatus) => {
    setPoolStatus(data);
    // "시작 번호" 입력칸을 다음 사용할 번호의 실시간 표시창으로 겸용한다 —
    // 발송처리로 번호가 하나씩 소진될 때마다 이 값도 같이 올라간다.
    setRangeStart(data.nextNumber ?? "");
  };

  const loadPoolStatus = async () => {
    const res = await fetch("/api/tracking-pool");
    const data = await res.json();
    applyPoolStatus(data);
  };

  const loadOrders = async (auto = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "주문 조회 실패");
      setShipments(data.shipments);
      setSelectedIds(
        new Set(data.shipments.map((s: Shipment) => s.productOrderId)),
      );
      appendLog(
        `${auto ? "(자동) " : ""}물량 조회 완료: 총 ${data.shipments.length}건`,
      );
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // 매일 밤 8시 ~ 다음날 오전 9시 사이에는 자동 조회를 쉬고, 1분마다 야간 여부만 갱신한다.
  useEffect(() => {
    const tick = () => setQuietNow(isQuietHours(new Date()));
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 새로고침(첫 진입) 시 바로 한 번 물량 조회.
  useEffect(() => {
    if (!isQuietHours(new Date())) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 최초 진입 시 1회만 조회
      void loadOrders(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 정시 기준 10분 간격(0, 10, 20, 30, 40, 50분)으로 자동 물량 조회.
  useEffect(() => {
    const timeoutRef = { current: 0 as ReturnType<typeof setTimeout> | 0 };

    const runAndReschedule = async () => {
      if (!isQuietHours(new Date())) {
        await loadOrders(true);
      }
      timeoutRef.current = setTimeout(
        runAndReschedule,
        msUntilNextInterval(new Date(), AUTO_REFRESH_INTERVAL_MS),
      );
    };

    timeoutRef.current = setTimeout(
      runAndReschedule,
      msUntilNextInterval(new Date(), AUTO_REFRESH_INTERVAL_MS),
    );

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelected = (productOrderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productOrderId)) {
        next.delete(productOrderId);
      } else {
        next.add(productOrderId);
      }
      return next;
    });
  };

  const loadShippedShipments = async () => {
    try {
      const res = await fetch("/api/shipped");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "발송완료 목록 조회 실패");
      setShippedShipments(data.shipments);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 최초 진입 시 1회만 조회
    void loadShippedShipments();
  }, []);

  const saveTrackingNumber = (shipment: ShippedShipment) => {
    const newTrackingNumber = (
      trackingEdits[shipment.productOrderId] ?? shipment.trackingNumber
    ).trim();
    if (!newTrackingNumber) return;

    requestConfirm(
      `"${shipment.receiverName}" 건의 운송장번호를 ${newTrackingNumber}(으)로 저장할까요?`,
      async () => {
        setError(null);
        try {
          const res = await fetch("/api/shipped", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productOrderId: shipment.productOrderId,
              trackingNumber: newTrackingNumber,
              deliveryCompanyCode:
                shipment.deliveryCompanyCode || deliveryCompanyCode,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "운송장번호 변경 실패");
          appendLog(
            `운송장번호 변경: ${shipment.receiverName} → ${newTrackingNumber}`,
          );
          await loadShippedShipments();
        } catch (e: unknown) {
          setError(getErrorMessage(e));
        }
      },
    );
  };

  const reprintShipment = async (shipment: ShippedShipment) => {
    const senderRes = await fetch("/api/sender-info");
    const sender: SenderInfo = await senderRes.json();
    await printLabels([shipment], sender);
  };

  const registerRange = async () => {
    if (!rangeStart || !rangeEnd) return;
    const registeredStart = rangeStart;
    const registeredEnd = rangeEnd;
    setError(null);
    try {
      const res = await fetch("/api/tracking-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          start: registeredStart,
          end: registeredEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "운송장번호 범위 등록 실패");
      applyPoolStatus(data);
      setRangeEnd("");
      appendLog(`운송장번호 범위 등록: ${registeredStart} ~ ${registeredEnd}`);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const allocateTrackingNumber = async (): Promise<string | null> => {
    const res = await fetch("/api/tracking-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "allocate" }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    return data.trackingNumber as string;
  };

  const printLabels = async (
    targets: ShipmentWithTracking[],
    sender: SenderInfo,
  ) => {
    const printRoot = document.getElementById("print-root");
    if (!printRoot) return;

    printRoot.innerHTML = targets
      .map(
        (shipment) => `
        <div class="print-label">
          <div style="font-size:12px;border-bottom:1px solid #000;padding-bottom:4mm;margin-bottom:4mm;">
            <strong>보내는 사람</strong> ${sender.name} / ${sender.phone}<br/>
            ${sender.address} ${sender.addressDetail}
          </div>
          <div style="font-size:20px;font-weight:bold;letter-spacing:1px;margin-bottom:4mm;">운송장번호: ${shipment.trackingNumber}</div>
          <table style="font-size:13px;width:100%;border-collapse:collapse;">
            <tr><td style="padding:1mm 0;width:22mm;color:#555;">이름</td><td>${shipment.receiverName}</td></tr>
            <tr><td style="padding:1mm 0;color:#555;">전화번호</td><td>${shipment.receiverTel}</td></tr>
            <tr><td style="padding:1mm 0;color:#555;">주소</td><td>${shipment.baseAddress}</td></tr>
            <tr><td style="padding:1mm 0;color:#555;">상세주소</td><td>${shipment.detailAddress}</td></tr>
            <tr><td style="padding:1mm 0;color:#555;">발송 메시지</td><td>${shipment.shippingMemo ?? "-"}</td></tr>
            <tr><td style="padding:1mm 0;color:#555;">상품 선택 옵션</td><td>${shipment.productName} x ${shipment.quantity}개${shipment.optionInfo ? `<br/>${optionInfoToHtml(shipment.optionInfo)}` : ""}</td></tr>
          </table>
        </div>`,
      )
      .join("");

    window.print();
  };

  const runConfirm = () => {
    const targetIds = shipments
      .filter(
        (s) =>
          selectedIds.has(s.productOrderId) &&
          s.placeOrderState === "PRE_CONFIRM",
      )
      .map((s) => s.productOrderId);
    if (targetIds.length === 0) return;
    if (isQuietHours(new Date())) {
      setError("야간(오후 8시~오전 9시)에는 발주확인을 진행할 수 없습니다.");
      return;
    }

    requestConfirm(
      `선택한 ${targetIds.length}건을 발주확인 처리할까요?`,
      async () => {
        setLoading(true);
        setError(null);

        try {
          const confirmRes = await fetch("/api/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productOrderIds: targetIds }),
          });
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok)
            throw new Error(confirmData.error ?? "발주확인 처리 실패");

          const confirmedIds = new Set(targetIds);
          setShipments((prev) =>
            prev.map((s) =>
              confirmedIds.has(s.productOrderId)
                ? { ...s, placeOrderState: "CONFIRMED" }
                : s,
            ),
          );
          appendLog(`발주확인 처리 완료: ${targetIds.length}건`);
        } catch (e: unknown) {
          setError(getErrorMessage(e));
        } finally {
          setLoading(false);
        }
      },
    );
  };

  const runPrintAndShip = () => {
    const targetShipments = shipments.filter((s) =>
      selectedIds.has(s.productOrderId),
    );
    if (targetShipments.length === 0) return;
    if (isQuietHours(new Date())) {
      setError(
        "야간(오후 8시~오전 9시)에는 인쇄/발송처리를 진행할 수 없습니다.",
      );
      return;
    }
    if (targetShipments.some((s) => s.placeOrderState === "PRE_CONFIRM")) {
      setError(
        "선택한 건 중 발주확인이 안 된 건이 있습니다. 발주확인을 먼저 진행하세요.",
      );
      return;
    }

    requestConfirm(
      `선택한 ${targetShipments.length}건을 인쇄하고 발송처리할까요?`,
      () => void doPrintAndShip(targetShipments),
    );
  };

  const doPrintAndShip = async (targetShipments: ShipmentWithTracking[]) => {
    setLoading(true);
    setError(null);

    try {
      const senderRes = await fetch("/api/sender-info");
      const sender: SenderInfo = await senderRes.json();

      const withTracking: ShipmentWithTracking[] = [];
      for (const shipment of targetShipments) {
        const trackingNumber = await allocateTrackingNumber();
        if (!trackingNumber) {
          setRangeStart("");
          setRangeEnd("");
          showAlert(
            "등록된 운송장 용지가 모두 소진되었습니다. 새 시작/끝 번호를 등록한 뒤 다시 시도해주세요.",
          );
          throw new Error("운송장 용지가 부족해 작업을 중단했습니다.");
        }
        withTracking.push({ ...shipment, trackingNumber });
      }

      await printLabels(withTracking, sender);

      if (!SHIP_API_ENABLED) {
        appendLog(
          `(발송처리 API 비활성화 상태) 인쇄만 완료: ${withTracking.length}건`,
        );
        await loadPoolStatus();
        return;
      }

      const shipRes = await fetch("/api/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipments: withTracking.map((s) => ({
            trackingNumber: s.trackingNumber,
            productOrderId: s.productOrderId,
          })),
          deliveryCompanyCode,
        }),
      });
      const shipData = await shipRes.json();
      if (!shipRes.ok) throw new Error(shipData.error ?? "발송처리 실패");

      appendLog(`인쇄 + 발송처리 완료: ${withTracking.length}건`);
      const shippedIds = new Set(withTracking.map((s) => s.productOrderId));
      setShipments((prev) =>
        prev.filter((s) => !shippedIds.has(s.productOrderId)),
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        shippedIds.forEach((id) => next.delete(id));
        return next;
      });
      await loadPoolStatus();
      await loadShippedShipments();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const preConfirmCount = shipments.filter(
    (s) => s.placeOrderState === "PRE_CONFIRM",
  ).length;
  const confirmedCount = shipments.length - preConfirmCount;
  const selectedCount = shipments.filter((s) =>
    selectedIds.has(s.productOrderId),
  ).length;

  return (
    <div className="px-20 py-5 flex flex-col gap-5">
      <h1 className="text-2xl font-bold">스마트스토어 자동 발송 처리</h1>

      {quietNow && (
        <div className="text-base border border-amber-300 bg-amber-50 text-amber-800 rounded p-3">
          🌙 지금은 야간 시간(오후 8시 ~ 오전 9시)이라 자동 조회와
          인쇄/발송처리가 멈춰 있습니다. 오전 9시 이후 다시 정상적으로
          진행됩니다.
        </div>
      )}

      {error && (
        <div className="text-red-600 text-base whitespace-pre-wrap border border-red-300 bg-red-50 rounded p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-b">
        <button
          className={`px-5 py-3 text-lg font-semibold border-b-2 -mb-px ${
            activeTab === "ship"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500"
          }`}
          onClick={() => setActiveTab("ship")}
        >
          발송 처리
        </button>
        <button
          className={`px-5 py-3 text-lg font-semibold border-b-2 -mb-px ${
            activeTab === "shipped"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500"
          }`}
          onClick={() => setActiveTab("shipped")}
        >
          발송완료 목록
        </button>
      </div>

      {activeTab === "ship" && (
        <div className="w-full flex gap-2">
          <div className="w-1/2 flex flex-col gap-2">
            <section className="w-full border rounded-lg p-2 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StepBadge n={1} />
                <h2 className="text-lg font-semibold">
                  운송장 용지 범위 등록 (새 운송장 용지를 프린터에 넣었을 때만)
                </h2>
              </div>
              <div className="flex gap-2 items-end flex-wrap">
                <label className="flex flex-col text-base gap-1">
                  시작 번호
                  <input
                    className="border rounded px-3 py-2 text-lg"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    placeholder="예: 123456789012"
                  />
                </label>
                <label className="flex flex-col text-base gap-1">
                  끝 번호
                  <input
                    className="border rounded px-3 py-2 text-lg"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    placeholder="예: 123456789999"
                  />
                </label>
                <button
                  className="border rounded px-4 py-2 text-lg bg-gray-100"
                  onClick={registerRange}
                >
                  범위 등록
                </button>
                <button
                  className="border rounded px-4 py-2 text-lg bg-gray-100"
                  onClick={loadPoolStatus}
                >
                  상태 새로고침
                </button>
              </div>
              {poolStatus && (
                <div className="text-base text-gray-600">
                  다음 사용할 번호: {poolStatus.nextNumber ?? "없음"} / 남은
                  용지: {poolStatus.remainingInCurrentRange}장
                </div>
              )}
            </section>
            <section className="w-full border rounded-lg p-2 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <StepBadge n={3} />
                <h2 className="text-lg font-semibold">발주확인 / 발송처리</h2>
                <span className="text-sm text-gray-500">
                  (선택됨 {selectedCount}건)
                </span>
              </div>
              <div className="pl-12 flex items-center gap-4 text-lg">
                택배사
                {DELIVERY_COMPANIES.map((company) => (
                  <label key={company.code} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="deliveryCompanyCode"
                      checked={deliveryCompanyCode === company.code}
                      onChange={() => setDeliveryCompanyCode(company.code)}
                    />
                    {company.name}
                  </label>
                ))}
              </div>
              <div className="pl-12 flex gap-2">
                <button
                  className="border rounded px-5 py-3 text-lg bg-gray-100 disabled:opacity-40"
                  disabled={loading || selectedCount === 0 || quietNow}
                  onClick={runConfirm}
                >
                  발주확인
                </button>
                <button
                  className="border rounded px-5 py-3 text-lg bg-blue-600 text-white disabled:opacity-40"
                  disabled={loading || selectedCount === 0 || quietNow}
                  onClick={runPrintAndShip}
                >
                  발송처리 (인쇄)
                </button>
              </div>
            </section>

            <div className="overflow-y-auto max-h-96">
              <section className="text-sm text-gray-500 flex flex-col gap-1">
                {log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </section>
            </div>
          </div>

          <section className="w-1/2 border rounded-lg p-2 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <StepBadge n={2} />
              <h2 className="text-lg font-semibold">
                발주전 / 발주확인 물량 조회
              </h2>
              <span className="text-sm text-gray-500">
                (10분마다 자동 조회됩니다 · 발주전 {preConfirmCount}건, 발주확인{" "}
                {confirmedCount}건)
              </span>
              <button
                className="border rounded px-5 py-3 text-lg bg-gray-100 disabled:opacity-40"
                disabled={loading || quietNow}
                onClick={() => loadOrders(false)}
              >
                물량조회하기
              </button>
            </div>

            <ul className="text-base flex flex-col gap-3 max-h-150 overflow-y-auto">
              {shipments.map((shipment) => (
                <li
                  key={shipment.productOrderId}
                  className="border rounded p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(shipment.productOrderId)}
                      onChange={() => toggleSelected(shipment.productOrderId)}
                    />
                    <StatusBadge state={shipment.placeOrderState} />
                  </div>
                  <dl className="w-full grid grid-cols-[6rem_1fr] gap-y-1">
                    <dt className="text-gray-500">이름</dt>
                    <dd>{shipment.receiverName}</dd>
                    <dt className="text-gray-500">전화번호</dt>
                    <dd>{shipment.receiverTel}</dd>
                    <dt className="text-gray-500">주소</dt>
                    <dd>{shipment.baseAddress}</dd>
                    <dt className="text-gray-500">상세주소</dt>
                    <dd>{shipment.detailAddress}</dd>
                    <dt className="text-gray-500">발송 메시지</dt>
                    <dd>{shipment.shippingMemo || "-"}</dd>
                    <dt className="text-gray-500">상품 선택 옵션</dt>
                    <dd>
                      <div>
                        {shipment.productName} x{shipment.quantity}개
                      </div>
                      {shipment.optionInfo &&
                        parseOptionInfo(shipment.optionInfo).map((seg, i) => (
                          <div key={i}>
                            {seg.label && <strong>{seg.label}</strong>}{" "}
                            {seg.value}
                          </div>
                        ))}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {activeTab === "shipped" && (
        <section className="border rounded-lg p-6 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              발송완료 목록 (운송장번호 수정 / 재출력)
            </h2>
            <span className="text-sm text-gray-500">
              최근 7일 · {shippedShipments.length}건
            </span>
          </div>
          <ul className="text-base flex flex-col gap-3 pl-12 max-h-150 overflow-y-auto">
            {shippedShipments.map((shipment) => (
              <li key={shipment.productOrderId} className="border rounded p-3">
                <dl className="grid grid-cols-[6rem_1fr] gap-y-1 mb-3">
                  <dt className="text-gray-500">이름</dt>
                  <dd>{shipment.receiverName}</dd>
                  <dt className="text-gray-500">전화번호</dt>
                  <dd>{shipment.receiverTel}</dd>
                  <dt className="text-gray-500">주소</dt>
                  <dd>{shipment.baseAddress}</dd>
                  <dt className="text-gray-500">상세주소</dt>
                  <dd>{shipment.detailAddress}</dd>
                  <dt className="text-gray-500">발송 메시지</dt>
                  <dd>{shipment.shippingMemo || "-"}</dd>
                  <dt className="text-gray-500">상품 선택 옵션</dt>
                  <dd>
                    <div>
                      {shipment.productName} x{shipment.quantity}개
                    </div>
                    {shipment.optionInfo &&
                      parseOptionInfo(shipment.optionInfo).map((seg, i) => (
                        <div key={i}>
                          {seg.label && <strong>{seg.label}</strong>}{" "}
                          {seg.value}
                        </div>
                      ))}
                  </dd>
                  <dt className="text-gray-500">택배사</dt>
                  <dd>
                    {DELIVERY_COMPANIES.find(
                      (c) => c.code === shipment.deliveryCompanyCode,
                    )?.name ?? shipment.deliveryCompanyCode}
                  </dd>
                </dl>
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded px-3 py-2 text-lg"
                    value={
                      trackingEdits[shipment.productOrderId] ??
                      shipment.trackingNumber
                    }
                    onChange={(e) =>
                      setTrackingEdits((prev) => ({
                        ...prev,
                        [shipment.productOrderId]: e.target.value,
                      }))
                    }
                  />
                  <button
                    className="border rounded px-4 py-2 text-lg bg-gray-100"
                    onClick={() => saveTrackingNumber(shipment)}
                  >
                    운송장번호 저장
                  </button>
                  <button
                    className="border rounded px-4 py-2 text-lg bg-gray-100"
                    onClick={() => reprintShipment(shipment)}
                  >
                    재출력
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div id="print-root" />

      {confirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col gap-4 max-w-sm w-full shadow-lg">
            <div className="text-lg whitespace-pre-wrap">
              {confirmDialog.message}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="border rounded px-4 py-2 text-lg bg-gray-100"
                onClick={() => setConfirmDialog(null)}
              >
                취소
              </button>
              <button
                className="border rounded px-4 py-2 text-lg bg-blue-600 text-white"
                onClick={() => {
                  const { onConfirm } = confirmDialog;
                  setConfirmDialog(null);
                  onConfirm();
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {alertMessage && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col gap-4 max-w-sm w-full shadow-lg">
            <div className="text-lg whitespace-pre-wrap">{alertMessage}</div>
            <div className="flex justify-end">
              <button
                className="border rounded px-4 py-2 text-lg bg-blue-600 text-white"
                onClick={() => setAlertMessage(null)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Page;
