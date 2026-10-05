import * as React from 'react';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import { cn } from '../lib.ts';
import { Button } from './button.tsx';

export interface Crumb {
  label: string;
  href?: string;
}

/** Page title with breadcrumb; every page uses it. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  renderLink,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
  renderLink?: (c: Crumb) => React.ReactNode;
}) {
  return (
    <header className="mb-6 grid gap-3">
      {crumbs?.length ? (
        <nav aria-label="Murupolku" className="flex flex-wrap items-center gap-1 text-[13px] text-subtle">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <ChevronRight className="size-3.5" aria-hidden /> : null}
              {c.href && renderLink ? (
                renderLink(c)
              ) : (
                <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-subtle">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <div className="mb-1 rounded-full bg-surface-2 p-3 text-subtle">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-sm text-sm text-subtle">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="grid gap-2">
        <p className="font-medium text-danger">Tietojen haku epäonnistui</p>
        <p className="text-muted">{message}</p>
        {onRetry ? (
          <div>
            <Button size="sm" onClick={onRetry}>
              Yritä uudelleen
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm tabular', className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('border-b border-border px-3 py-2 text-left text-xs font-medium text-subtle', className)}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-border px-3 py-2.5 align-middle', className)} {...props} />;
}
