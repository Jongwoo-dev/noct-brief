import type { Content } from "@/lib/contract";
import { Citation } from "@/components/citation-navigation";

export function SourceReferences({
  sourceIds,
  content,
  referenceId,
}: {
  sourceIds: string[];
  content: Content;
  referenceId: string;
}) {
  return (
    <sup className="source-references">
      {"\u2060"}
      {sourceIds.map((id) => {
        const index = content.bundle.sources.findIndex((s) => s.id === id);
        const source = content.bundle.sources[index];
        return (
          <Citation
            key={id}
            sourceId={id}
            referenceId={`ref-${referenceId}-${id}`}
            number={index + 1}
            label={`${source.publisher}, ${source.title}`}
          />
        );
      })}
    </sup>
  );
}
