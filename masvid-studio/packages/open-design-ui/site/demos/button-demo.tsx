import { useState } from 'react';
import { Button } from 'open-design-ui/button';

export function ButtonDemo() {
  const [saved, setSaved] = useState(false);

  return (
    <Button type="button" variant="primary" onClick={() => setSaved(true)}>
      {saved ? 'Saved' : 'Save changes'}
    </Button>
  );
}
