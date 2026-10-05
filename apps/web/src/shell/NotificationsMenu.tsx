import * as React from 'react';
import { useNavigate } from 'react-router';
import { unwrap } from '@ps/sdk';
import { useApi, useMutation, useQuery, useQueryClient } from '@ps/sdk/react';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  formatRelative,
  toast,
} from '@ps/ui';
import { usePollInterval } from '../realtime/live.ts';

const tone = { info: 'neutral', success: 'success', warning: 'warning', error: 'danger' } as const;

/** In-app notifications (e.g. "analysis ready"); new ones also appear as toasts. */
export function NotificationsMenu({ icon }: { icon: React.ReactNode }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const interval = usePollInterval(true);
  const seen = React.useRef<Set<string> | null>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => unwrap(api.GET('/notifications', { params: { query: {} } })),
    refetchInterval: interval === false ? false : Math.max(interval, 10_000),
  });
  React.useEffect(() => {
    if (!q.data) return;
    if (seen.current) {
      for (const n of q.data.items) {
        if (!seen.current.has(n.id) && !n.readAt) {
          const fn = n.kind === 'error' ? toast.error : n.kind === 'success' ? toast.success : toast;
          fn(n.title, { description: n.body ?? undefined });
        }
      }
    }
    seen.current = new Set(q.data.items.map((n) => n.id));
  }, [q.data]);
  const markRead = useMutation({
    mutationFn: () => unwrap(api.POST('/notifications/read', { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  return (
    <DropdownMenu onOpenChange={(o) => !o && unread && markRead.mutate()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Ilmoitukset${unread ? ` (${unread} lukematonta)` : ''}`}
          className="relative"
        >
          {icon}
          {unread ? <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Ilmoitukset</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {q.data?.items.length ? (
          q.data.items.slice(0, 10).map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => n.link && navigate(n.link)} className="items-start">
              <div className="grid gap-0.5">
                <div className="flex items-center gap-2">
                  <Badge tone={tone[n.kind]}>
                    {n.kind === 'error'
                      ? 'Virhe'
                      : n.kind === 'success'
                        ? 'Valmis'
                        : n.kind === 'warning'
                          ? 'Varoitus'
                          : 'Tieto'}
                  </Badge>
                  <span className="text-xs text-subtle">{formatRelative(n.createdAt)}</span>
                </div>
                <span className={n.readAt ? 'text-muted' : 'font-medium'}>{n.title}</span>
                {n.body ? <span className="line-clamp-2 text-xs text-subtle">{n.body}</span> : null}
              </div>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2 py-6 text-center text-sm text-subtle">Ei ilmoituksia</div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
