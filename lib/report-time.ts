import { DateTime, IANAZone } from "luxon";

export const pairedTimePolicy = "kst-original-v1";
export type OriginalTime = { timestamp: string; zone?: string };
export type EvidenceTimeRole = "게시" | "관측" | "예정" | "발생";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern =
  /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?)(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;
const wallFormat = "yyyy-MM-dd HH:mm";
const eastern = "America/New_York";

export function isDateOnly(value: string) {
  return isoDate.test(value);
}

export function evidenceTimeUpperBound(value: string) {
  const parsed = Date.parse(value);
  // At UTC−12 the local date ends at 12:00 UTC on the following day.
  // This exclusive bound is for comparisons, never an observed time.
  return isDateOnly(value) ? parsed + 36 * 60 * 60 * 1000 : parsed;
}

function readWrittenTime({ timestamp, zone }: OriginalTime) {
  const match = dateTimePattern.exec(timestamp);
  if (!match || match[2] === "-00:00") return;
  const [, wall, offset] = match;
  if (zone && !IANAZone.isValidZone(zone)) return;
  if (!offset && !zone) return;
  const instant = DateTime.fromISO(timestamp, { zone, setZone: true });
  if (!instant.isValid) return;
  if (!zone) return { instant, label: offset === "Z" ? "UTC" : `UTC${offset}` };
  const local = instant.setZone(zone);
  if (
    local.toFormat("yyyy-MM-dd'T'HH:mm") !== wall.slice(0, 16) ||
    (offset && local.offset !== instant.offset) ||
    (!offset && local.getPossibleOffsets().length !== 1)
  )
    return;
  const label =
    zone === eastern
      ? local.isInDST
        ? "EDT"
        : "EST"
      : zone === "UTC"
        ? "UTC"
        : zone;
  return { instant: local, label };
}

export function matchesOriginalTime(
  recorded: string | null,
  original: OriginalTime,
) {
  if (!recorded) return false;
  const stored = readWrittenTime({ timestamp: recorded });
  const written = readWrittenTime(original);
  return (
    !!stored &&
    !!written &&
    stored.instant.toMillis() === written.instant.toMillis()
  );
}

export function formatSourceTime(
  recorded: string,
  original?: OriginalTime,
  // Kept for existing callers; roles are metadata, not part of the clock text.
  _role?: EvidenceTimeRole,
) {
  const stored = readWrittenTime({ timestamp: recorded });
  if (!stored) return "시각 미확인";
  const written = original
    ? readWrittenTime(original)
    : { instant: stored.instant.toUTC(), label: "UTC" };
  if (!written || stored.instant.toMillis() !== written.instant.toMillis())
    return "원문 시각 불일치";
  const korea = stored.instant.setZone("Asia/Seoul").toFormat(wallFormat);
  const originalClock = `${written.instant.toFormat(wallFormat)} ${written.label}`;
  return `${korea} KST (${originalClock})`;
}

export function formatSourcePublication(
  recorded: string,
  original?: OriginalTime,
) {
  return isDateOnly(recorded)
    ? `${recorded} (게시 시각 미확인)`
    : formatSourceTime(recorded, original);
}

export function formatMarketTime(recorded: string) {
  const stored = readWrittenTime({ timestamp: recorded });
  if (!stored) return "시각 미확인";
  const east = stored.instant.setZone(eastern);
  const korea = stored.instant.setZone("Asia/Seoul");
  return `${korea.toFormat(wallFormat)} KST (${east.toFormat(wallFormat)} ${east.isInDST ? "EDT" : "EST"})`;
}

export function formatKoreaTime(recorded: string) {
  const stored = readWrittenTime({ timestamp: recorded });
  return stored
    ? `${stored.instant.setZone("Asia/Seoul").toFormat(wallFormat)} KST`
    : "시각 미확인";
}
