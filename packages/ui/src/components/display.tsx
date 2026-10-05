import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, needsOutline } from '../lib.ts';
import { useTheme } from './theme.tsx';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-xs', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-muted',
        accent: 'bg-accent-soft text-accent',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Small party colour mark; light colours get an outline so they stay visible in both themes. */
export function PartyDot({
  color,
  size = 10,
  title,
}: {
  color: string | null | undefined;
  size?: number;
  title?: string;
}) {
  const { resolved } = useTheme();
  const c = color ?? '#9ca3af';
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: c,
        boxShadow: needsOutline(c, resolved) ? 'inset 0 0 0 1px var(--ps-border-strong)' : undefined,
      }}
    />
  );
}

export function PartyBadge({
  abbreviation,
  color,
  name,
}: {
  abbreviation: string;
  color: string | null | undefined;
  name?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg"
      title={name}
    >
      <PartyDot color={color} size={8} />
      {abbreviation}
    </span>
  );
}

/** Small origin marker: open data vs. manually entered. */
export function SourceMark({ source, manual }: { source: string; manual?: boolean }) {
  const isManual = manual || source === 'manual';
  const label = isManual
    ? 'Käsin syötetty tai muokattu'
    : source === 'eduskunta'
      ? 'Eduskunnan avoin data'
      : source === 'seed'
        ? 'Alkudata'
        : 'Muu lähde';
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex size-4 items-center justify-center rounded text-[9px] font-semibold',
        isManual ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent',
      )}
    >
      {isManual ? 'K' : source === 'eduskunta' ? 'E' : 'A'}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-md bg-surface-2', className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Ladataan"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-subtle border-r-transparent',
        className,
      )}
    />
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-subtle">
      {children}
    </kbd>
  );
}

export function Progress({ value, max, label }: { value: number; max?: number | null; label?: string }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : null;
  return (
    <div className="grid gap-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={cn(
            'h-full rounded-full bg-accent transition-[width] duration-300',
            pct === null && 'w-1/3 animate-pulse-soft',
          )}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {label ? (
        <div className="flex justify-between text-xs text-subtle tabular">
          <span>{label}</span>
          {pct !== null ? <span>{pct} %</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-subtle">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </div>
  );
}
