import { Plus, Trash2 } from 'lucide-react';
import { usePermissions } from '@ps/sdk/react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineEdit,
  Skeleton,
  SourceMark,
  Table,
  Td,
  Th,
  toast,
} from '@ps/ui';
import { useEntityList, useEntityMutations, type EntityPath } from './hooks.ts';

export interface Column {
  key: string;
  label: string;
  kind?: 'text' | 'date' | 'number' | 'select';
  options?: { value: string; label: string }[];
  width?: string;
}

type Row = { id: string; source: string; manualFields: string[] } & Record<string, unknown>;

/**
 * Editable registry table: every cell edits in place with auto-save and undo,
 * "Lisää rivi" adds a row immediately (no dialog), deletion goes to the trash
 * with an undo toast.
 */
export function EntityTable({
  entity,
  columns,
  defaults,
  sort,
}: {
  entity: EntityPath;
  columns: Column[];
  defaults: () => Record<string, unknown>;
  sort?: (a: Row, b: Row) => number;
}) {
  const list = useEntityList<Row>(entity);
  const m = useEntityMutations(entity);
  const { can } = usePermissions();
  const editable = can('registries.edit');
  const rows = [...(list.data ?? [])].sort(sort ?? (() => 0));

  const addRow = async () => {
    try {
      await m.create.mutateAsync(defaults());
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async (id: string) => {
    await m.remove.mutateAsync(id);
    toast('Rivi siirretty roskakoriin', {
      action: { label: 'Kumoa', onClick: () => void m.restore.mutateAsync(id) },
    });
  };

  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (list.isLoading) return <Skeleton className="h-48" />;
  return (
    <Card>
      {rows.length ? (
        <Table>
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key} style={c.width ? { width: c.width } : undefined}>
                  {c.label}
                </Th>
              ))}
              <Th className="w-8">
                <span className="sr-only">Lähde</span>
              </Th>
              {editable ? (
                <Th className="w-10">
                  <span className="sr-only">Toiminnot</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group">
                {columns.map((c) => (
                  <Td key={c.key} className="py-1">
                    <InlineEdit
                      label={c.label}
                      kind={c.kind}
                      options={c.options}
                      disabled={!editable}
                      value={r[c.key] as string | number | null}
                      onSave={(v) =>
                        m.update.mutateAsync({
                          id: r.id,
                          patch: { [c.key]: c.kind === 'number' && v !== null ? Number(v) : v },
                        })
                      }
                    />
                  </Td>
                ))}
                <Td>
                  <SourceMark source={r.source} manual={r.manualFields.length > 0} />
                </Td>
                {editable ? (
                  <Td>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => void del(r.id)}
                      aria-label="Poista rivi"
                    >
                      <Trash2 />
                    </Button>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="p-4">
          <EmptyState title="Ei rivejä" />
        </div>
      )}
      {editable ? (
        <div className="border-t border-border p-2">
          <Button variant="ghost" size="sm" onClick={() => void addRow()} loading={m.create.isPending}>
            <Plus /> Lisää rivi
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
