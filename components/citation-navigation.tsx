"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type CitationTarget = { sourceId: string; referenceId: string };
const CitationContext = createContext<{
  target: CitationTarget | null;
  select: (target: CitationTarget) => void;
} | null>(null);

export function CitationProvider({ children }: { children: ReactNode }) {
  const [target, select] = useState<CitationTarget | null>(null);
  return (
    <CitationContext.Provider value={{ target, select }}>
      {children}
    </CitationContext.Provider>
  );
}

export function Citation({
  sourceId,
  referenceId,
  number,
  label,
}: CitationTarget & { number: number; label: string }) {
  const navigation = useContext(CitationContext);
  return (
    <a
      id={referenceId}
      href={`#source-${sourceId}`}
      aria-label={`출처 ${number}: ${label}`}
      onClick={() => navigation?.select({ sourceId, referenceId })}
    >
      [{number}]
    </a>
  );
}

export function SourceReturnLink({ sourceId }: { sourceId: string }) {
  const navigation = useContext(CitationContext);
  if (navigation?.target?.sourceId !== sourceId) return null;
  return (
    <a className="source-return" href={`#${navigation.target.referenceId}`}>
      읽던 위치로 돌아가기 ↑
    </a>
  );
}
