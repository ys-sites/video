import { Tooltip } from "../ui/Tooltip";

export interface SliderStop {
  value: number;
  label: string;
}

export function snapSliderStop(raw: number, min: number, max: number, width: number, stops: readonly SliderStop[]) {
  // Cap the hit zone in both pixels and track units so short tracks still
  // have room for continuous adjustments between their stops.
  let distance = (max - min) * Math.min(4 / width, 0.035);
  let snapped: number | undefined;
  for (const stop of stops) {
    const delta = Math.abs(stop.value - raw);
    if (delta <= distance) {
      distance = delta;
      snapped = stop.value;
    }
  }
  return snapped;
}

export function FlatSliderStops({ stops, min, max, disabled }: {
  stops: readonly SliderStop[];
  min: number;
  max: number;
  disabled?: boolean;
}) {
  return stops.map(({ value, label }) => (
    <Tooltip key={value} label={label} disabled={disabled}>
      <span data-flat-slider-stop={label} className="motion-slider-stop" aria-hidden="true"
        style={{ left: `${((value - min) / (max - min)) * 100}%` }} />
    </Tooltip>
  ));
}
