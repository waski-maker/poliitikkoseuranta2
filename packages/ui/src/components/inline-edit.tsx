import * as React from 'react';
import { toast } from 'sonner';
import { cn } from '../lib.ts';

type Kind = 'text' | 'textarea' | 'date' | 'color' | 'number' | 'select' | 'url';

export interface InlineEditProps {
  value: string | number | null | undefined;
  onSave(value: string | null): Promise<unknown>;
  kind?: Kind;
  options?: { value: string; label: string }[];
  placeholder?: string;
  label: string;
  className?: string;
  display?: React.ReactNode;
  disabled?: boolean;
}

/**
 * Edit-in-place: click (or Enter) to edit, saves automatically on blur/Enter,
 * Esc cancels. No confirmation dialogs – an "Undo" toast restores the old value.
 */
export function InlineEdit({
  value,
  onSave,
  kind = 'text',
  options,
  placeholder = '–',
  label,
  className,
  display,
  disabled,
}: InlineEditProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value == null ? '' : String(value));
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setDraft(value == null ? '' : String(value)), [value]);

  const commit = async () => {
    const next = draft.trim() === '' ? null : draft.trim();
    const prev = value == null ? null : String(value);
    setEditing(false);
    if (next === prev) return;
    setSaving(true);
    try {
      await onSave(next);
      toast.success(`${label}: tallennettu`, {
        action: {
          label: 'Kumoa',
          onClick: () => void onSave(prev).then(() => toast(`${label}: palautettu`)),
        },
      });
    } catch (e) {
      setDraft(prev ?? '');
      toast.error(`${label}: tallennus epäonnistui`, { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (editing && !disabled) {
    const common = {
      'aria-label': label,
      autoFocus: true,
      value: draft,
      onBlur: () => void commit(),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          setDraft(value == null ? '' : String(value));
          setEditing(false);
        }
        if (e.key === 'Enter' && kind !== 'textarea') void commit();
      },
      className: 'w-full rounded-md border border-accent bg-surface px-2 py-1 text-sm outline-none',
    };
    if (kind === 'textarea')
      return <textarea {...common} rows={4} onChange={(e) => setDraft(e.target.value)} />;
    if (kind === 'select')
      return (
        <select {...common} onChange={(e) => setDraft(e.target.value)}>
          <option value="">–</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    if (kind === 'color')
      return (
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label}
            value={draft || '#888888'}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            className="size-8 cursor-pointer rounded border border-border bg-transparent"
          />
          <input {...common} onChange={(e) => setDraft(e.target.value)} />
        </span>
      );
    return (
      <input
        {...common}
        type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
        onChange={(e) => setDraft(e.target.value)}
      />
    );
  }
  const shown =
    display ??
    (value == null || value === '' ? (
      <span className="text-subtle">{placeholder}</span>
    ) : kind === 'select' ? (
      (options?.find((o) => o.value === String(value))?.label ?? String(value))
    ) : (
      String(value)
    ));
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      aria-label={`${label}: muokkaa`}
      className={cn(
        'group -mx-2 w-[calc(100%+1rem)] cursor-text rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent',
        saving && 'opacity-60',
        className,
      )}
    >
      {shown}
    </button>
  );
}
