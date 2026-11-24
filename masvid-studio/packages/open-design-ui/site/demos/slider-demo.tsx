import { useState } from 'react';
import { Slider } from 'open-design-ui/slider';

export function SliderDemo() {
  const [preview, setPreview] = useState(40);
  const [value, setValue] = useState(40);

  return (
    <div className="w-full max-w-80">
      <div className="flex justify-between gap-3">
        <span>Opacity</span>
        <output aria-label="Opacity preview">{preview}%</output>
      </div>
      <Slider label="Opacity" min={0} max={100} step={1} value={value}
        onPreview={setPreview} onCommit={setValue} />
      <p className="mt-2 flex justify-between gap-3 text-sm">
        Committed value <span>{value}%</span>
      </p>
    </div>
  );
}
