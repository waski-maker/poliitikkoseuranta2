import * as React from 'react';
import { Command as Cmdk } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';

/** Styled command palette shell (Ctrl/⌘+K). The app provides groups and items. */
export function CommandPalette({
  open,
  onOpenChange,
  search,
  onSearchChange,
  children,
  placeholder = 'Hae tai kirjoita komento…',
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  search: string;
  onSearchChange(v: string): void;
  children: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
          <DialogPrimitive.Title className="sr-only">Komentopaletti</DialogPrimitive.Title>
          <Cmdk shouldFilter={false} label="Komentopaletti" className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-subtle" aria-hidden />
              <Cmdk.Input
                value={search}
                onValueChange={onSearchChange}
                placeholder={placeholder}
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
              />
            </div>
            <Cmdk.List className="max-h-[60vh] overflow-y-auto p-2">{children}</Cmdk.List>
          </Cmdk>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CommandGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Cmdk.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle"
    >
      {children}
    </Cmdk.Group>
  );
}

export function CommandItem({
  onSelect,
  children,
  value,
}: {
  onSelect(): void;
  children: React.ReactNode;
  value: string;
}) {
  return (
    <Cmdk.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-subtle"
    >
      {children}
    </Cmdk.Item>
  );
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return <Cmdk.Empty className="px-2 py-8 text-center text-sm text-subtle">{children}</Cmdk.Empty>;
}
