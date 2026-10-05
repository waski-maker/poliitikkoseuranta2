import { Link } from 'react-router';
import { Button, EmptyState } from '@ps/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Sivua ei löytynyt"
      description="Osoite voi olla vanhentunut tai kirjoitettu väärin."
      action={
        <Button asChild>
          <Link to="/">Kojelautaan</Link>
        </Button>
      }
    />
  );
}
