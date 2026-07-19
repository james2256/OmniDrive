/** Renders up to 2 metadata key-value pairs as small blue pills, with a "+N" overflow indicator. */
export function MetadataBadges({ metadata }: { metadata?: string | Record<string, string> }) {
  if (!metadata) return null;
  try {
    const parsed: Record<string, string> =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const entries = Object.entries(parsed);
    if (entries.length === 0) return null;
    return (
      <div className="flex gap-1 ml-2 items-center">
        {entries.slice(0, 2).map(([k, v]) => (
          <span
            key={k}
            className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]"
            title={`${k}: ${v}`}
          >
            {v}
          </span>
        ))}
        {entries.length > 2 && (
          <span className="text-stone-400 text-[10px]">+{entries.length - 2}</span>
        )}
      </div>
    );
  } catch {
    return null;
  }
}
