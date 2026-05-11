'use client';

/** Visible permalink for a report section (DOM `id` must match). */
export function ReportSlugFooter({ id, variant = 'footer' }) {
  if (!id) return null;
  const wrap =
    variant === 'inline'
      ? 'flex justify-end no-print'
      : 'mt-5 pt-3 border-t border-ink/6 flex justify-end no-print';
  return (
    <div className={wrap}>
      <a
        href={`#${id}`}
        className="font-mono text-[10px] text-ink-400 hover:text-teal-bright tabular break-all max-w-[min(100%,22rem)] text-right"
        title="Permalink to this section"
      >
        #{id}
      </a>
    </div>
  );
}
