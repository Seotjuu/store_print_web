export type OptionSegment = { label: string; value: string };

// "복숭아 품종: 말랑말랑한 황도 ( 단금도 ) / 복숭아 크기: 4kg ( 11과 ~ 13과 ) 대과"
// 같은 옵션 문자열을 "/" 기준으로 나누고, 각 항목의 "라벨:" 부분과 값을 분리한다.
export function parseOptionInfo(optionInfo: string): OptionSegment[] {
  return optionInfo.split("/").map((part) => {
    const trimmed = part.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      return { label: "", value: trimmed };
    }
    return {
      label: trimmed.slice(0, colonIndex + 1).trim(),
      value: trimmed.slice(colonIndex + 1).trim(),
    };
  });
}

export function optionInfoToHtml(optionInfo: string): string {
  return parseOptionInfo(optionInfo)
    .map((seg) => (seg.label ? `<strong>${seg.label}</strong> ${seg.value}` : seg.value))
    .join("<br/>");
}
