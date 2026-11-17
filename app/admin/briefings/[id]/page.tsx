import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { identity } from "@/lib/auth";
import { runtime } from "@/lib/runtime";
import { adminDetail } from "@/lib/admin-queries";
import { AdminEditionDetail } from "@/components/admin-dashboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "회차 관리",
  robots: { index: false, follow: false },
};
export default async function Edition({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  if (!(await identity(await headers()))?.admin) redirect("/admin");
  const { id } = await params,
    { version } = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}-(pre|post)$/.test(id)) notFound();
  const { db } = await runtime(),
    result = await adminDetail(
      db,
      id,
      typeof version === "string" ? version : undefined,
    );
  if (!result || (version && !result.selected)) notFound();
  return <AdminEditionDetail {...result} />;
}
