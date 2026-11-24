import { useState } from 'react';
import { IconButton } from 'open-design-ui/icon-button';
import { RemixIcon } from '../../../design-system/react/RemixIcons';

export function IconButtonDemo() {
  const [muted, setMuted] = useState(false);
  return (
    <IconButton type="button" aria-label="Mute audio" aria-pressed={muted}
      icon={<RemixIcon name={muted ? 'volume-mute-line' : 'volume-up-line'} />}
      onClick={() => setMuted(value => !value)} />
  );
}
