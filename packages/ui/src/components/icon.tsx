import * as Icons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

/** Renders a lucide icon by name (module manifests reference icons by name). */
export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const C = (Icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name] ?? Icons.Circle;
  return <C aria-hidden {...props} />;
}
