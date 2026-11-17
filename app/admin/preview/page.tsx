import { notFound } from "next/navigation";
import { readConfig } from "@/lib/config";
import { adminSamples } from "@/data/admin-samples";
import { adminSearch, matchesAdminFilter } from "@/lib/admin";
import {
  AdminDashboard,
  AdminEditionDetail,
} from "@/components/admin-dashboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "관리자 화면 시연",
  robots: { index: false, follow: false },
};
export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = readConfig();
  if (c.APP_ENV !== "local" || c.DATA_MODE !== "sample") notFound();
  const params = await searchParams,
    fixtures = adminSamples();
  if (typeof params.id === "string") {
    const record = fixtures.find((r) => r.edition.id === params.id);
    if (!record) notFound();
    const selected =
      typeof params.version === "string"
        ? record.versions.find((v) => v.id === params.version)
        : record.selected;
    if (params.version && !selected) notFound();
    return (
      <AdminEditionDetail {...record} selected={selected ?? null} preview />
    );
  }
  const { filter, date, page } = adminSearch(params),
    all = fixtures.map((r) => r.edition);
  const editions = all.filter(
    (b) => matchesAdminFilter(b, filter) && (!date || b.date === date),
  );
  return (
    <AdminDashboard
      editions={editions.slice((page - 1) * 20, page * 20)}
      counts={{
        total: all.length,
        attention: all.filter((b) => matchesAdminFilter(b, "attention")).length,
        progress: all.filter((b) => matchesAdminFilter(b, "progress")).length,
        stored: all.filter((b) => matchesAdminFilter(b, "stored")).length,
      }}
      total={editions.length}
      filter={filter}
      date={date}
      page={page}
      lastScheduler={null}
      sample
      preview
    />
  );
}
