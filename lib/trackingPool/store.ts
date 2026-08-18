import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

// 한진택배 사전인쇄 운송장 용지의 운송장번호 범위를 관리한다.
// 프린터에 새 용지 뭉치를 채울 때마다 시작~끝 번호를 등록해두면,
// 인쇄할 때마다 다음 번호를 순서대로 내어준다. 용지가 부족해지면(범위 소진)
// ShortageError를 던지므로, 화면에서 새 범위를 등록하거나 번호를 수동 지정한다.

type TrackingRange = {
  id: string;
  start: string;
  end: string;
  createdAt: string;
};

type PoolState = {
  ranges: TrackingRange[];
  nextNumber: string | null;
};

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "tracking-pool.json");

export class TrackingPoolShortageError extends Error {
  constructor() {
    super("등록된 운송장번호 범위가 모두 소진되었습니다. 새 범위를 등록하거나 번호를 직접 입력하세요.");
    this.name = "TrackingPoolShortageError";
  }
}

async function readState(): Promise<PoolState> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ranges: [], nextNumber: null };
  }
}

async function writeState(state: PoolState) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function sortRanges(ranges: TrackingRange[]) {
  return [...ranges].sort((a, b) => (BigInt(a.start) < BigInt(b.start) ? -1 : 1));
}

function findRangeContaining(ranges: TrackingRange[], value: bigint) {
  return ranges.find((r) => BigInt(r.start) <= value && value <= BigInt(r.end));
}

export async function getPoolStatus() {
  const state = await readState();
  const sorted = sortRanges(state.ranges);
  const current = state.nextNumber
    ? findRangeContaining(sorted, BigInt(state.nextNumber))
    : undefined;
  const remainingInCurrentRange = current
    ? Number(BigInt(current.end) - BigInt(state.nextNumber!) + BigInt(1))
    : 0;

  return {
    ranges: sorted,
    nextNumber: state.nextNumber,
    remainingInCurrentRange,
  };
}

export async function registerRange(start: string, end: string) {
  if (BigInt(start) > BigInt(end)) {
    throw new Error("시작 번호가 끝 번호보다 클 수 없습니다.");
  }

  const state = await readState();
  state.ranges.push({ id: randomUUID(), start, end, createdAt: new Date().toISOString() });
  state.ranges = sortRanges(state.ranges);

  if (!state.nextNumber) {
    state.nextNumber = state.ranges[0].start;
  }

  await writeState(state);
  return getPoolStatus();
}

// 용지 부족 등으로 현재 인쇄 중인 용지의 실제 운송장번호를 담당자가 직접 확인해 입력한 경우,
// 다음 번 자동 할당 시작점을 그 번호로 맞춘다.
export async function setNextNumber(number: string) {
  const state = await readState();
  state.nextNumber = number;
  await writeState(state);
  return getPoolStatus();
}

export async function allocateNext(): Promise<string> {
  const state = await readState();
  const sorted = sortRanges(state.ranges);

  if (!state.nextNumber) {
    throw new TrackingPoolShortageError();
  }

  let current = findRangeContaining(sorted, BigInt(state.nextNumber));
  if (!current) {
    // 현재 번호가 어떤 범위에도 속하지 않으면, 다음으로 시작하는 범위를 찾는다.
    current = sorted.find((r) => BigInt(r.start) >= BigInt(state.nextNumber!));
    if (!current) {
      throw new TrackingPoolShortageError();
    }
    state.nextNumber = current.start;
  }

  const allocated = state.nextNumber;
  state.nextNumber = (BigInt(allocated) + BigInt(1)).toString();

  await writeState(state);
  return allocated;
}
