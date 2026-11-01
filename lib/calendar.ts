import { DateTime } from "luxon";
import calendar from "../data/calendar.json";
export type Session = "pre" | "post";
export const sessionLabel = (s: Session) => (s === "pre" ? "장전" : "장후");
export const earlyClose = (date: string) => calendar.earlyCloses.includes(date);
export function tradingDay(
  date: string,
  extraClosures: string[] = calendar.extraClosures,
) {
  const day = DateTime.fromISO(date, { zone: "America/New_York" });
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !day.isValid ||
    !calendar.years.includes(day.year)
  )
    return null;
  return (
    day.weekday <= 5 &&
    !calendar.holidays.includes(date) &&
    !extraClosures.includes(date)
  );
}
export function schedule(date: string, session: Session) {
  if (tradingDay(date) !== true) throw new Error("확인된 거래일이 아닙니다.");
  const at = DateTime.fromISO(
    `${date}T${session === "pre" ? "07:30" : "19:30"}`,
    { zone: "America/New_York" },
  );
  return {
    id: `${date}-${session}`,
    date,
    session,
    targetAt: at.toUTC().toISO()!,
    closeAt: DateTime.fromISO(
      `${date}T${calendar.earlyCloses.includes(date) ? "13:00" : "16:00"}`,
      { zone: "America/New_York" },
    )
      .toUTC()
      .toISO()!,
    earlyClose: calendar.earlyCloses.includes(date),
  };
}
export function upcoming(now: Date, count = 1) {
  const start = DateTime.fromJSDate(now, { zone: "America/New_York" }).startOf(
    "day",
  );
  const result: ReturnType<typeof schedule>[] = [];
  for (let d = 0; d < 16 && result.length < count; d++) {
    const date = start.plus({ days: d }).toISODate()!;
    if (tradingDay(date) === null) break;
    if (!tradingDay(date)) continue;
    for (const s of ["pre", "post"] as const) {
      const slot = schedule(date, s);
      if (new Date(slot.targetAt) > now && result.length < count)
        result.push(slot);
    }
  }
  return result;
}
export function dueSlots(now: Date, since: Date) {
  const result: ReturnType<typeof schedule>[] = [];
  let day = DateTime.fromJSDate(since, { zone: "America/New_York" }).startOf(
    "day",
  );
  const end = DateTime.fromJSDate(now, { zone: "America/New_York" }).plus({
    minutes: 30,
  });
  for (let i = 0; i < 32 && day <= end; i++, day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    if (!tradingDay(date)) continue;
    for (const session of ["pre", "post"] as const) {
      const slot = schedule(date, session);
      if (
        new Date(slot.targetAt).getTime() >= since.getTime() &&
        new Date(slot.targetAt).getTime() <= now.getTime() + 30 * 60000
      )
        result.push(slot);
    }
  }
  return result;
}
export function kst(iso: string) {
  return DateTime.fromISO(iso)
    .setZone("Asia/Seoul")
    .setLocale("ko")
    .toFormat("M월 d일 (ccc) HH:mm");
}
