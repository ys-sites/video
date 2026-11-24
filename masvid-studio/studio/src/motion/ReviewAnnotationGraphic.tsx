import type { ReviewAnnotation, ReviewMark } from '../../../shared/review-comments';

function pathFor(mark: ReviewMark, width: number, height: number) {
  const points = mark.points.map(point => ({ x: point.x * width, y: point.y * height }));
  const [a, b] = points;
  if (!a || !b) return '';
  if (mark.kind === 'pen') return points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  if (mark.kind === 'rectangle') return `M ${a.x} ${a.y} H ${b.x} V ${b.y} H ${a.x} Z`;
  if (mark.kind === 'ellipse') {
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }
  const angle = Math.atan2(b.y - a.y, b.x - a.x), head = Math.min(Math.hypot(b.x - a.x, b.y - a.y) * 0.4, Math.min(width, height) * 0.04);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${b.x - head * Math.cos(angle - Math.PI / 6)} ${b.y - head * Math.sin(angle - Math.PI / 6)} L ${b.x} ${b.y} L ${b.x - head * Math.cos(angle + Math.PI / 6)} ${b.y - head * Math.sin(angle + Math.PI / 6)}`;
}

/** Shape geometry is content; the shared design system supplies the review ink. */
export function ReviewAnnotationGraphic({ annotation }: { annotation: ReviewAnnotation }) {
  return <g className="om-review-annotation-ink" fill="none" strokeLinecap="round" strokeLinejoin="round">
    {annotation.marks.map((mark, index) => mark.kind === 'text'
      ? <text key={index} className="om-review-annotation-label" x={mark.points[0].x * annotation.width} y={mark.points[0].y * annotation.height}
        fontSize={annotation.height * 0.035} dominantBaseline="hanging">{mark.text}</text>
      : <g key={index}><path className="om-review-annotation-outline" d={pathFor(mark, annotation.width, annotation.height)} strokeWidth={5} vectorEffect="non-scaling-stroke" />
        <path d={pathFor(mark, annotation.width, annotation.height)} strokeWidth={3} vectorEffect="non-scaling-stroke" /></g>)}
  </g>;
}
