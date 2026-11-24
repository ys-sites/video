import { inspect } from 'node:util';

// Keep the normal test reporter and exit status; also expose failures in Checks.
export default async function* gameTestFailures(events) {
  for await (const { type, data } of events) {
    if (type !== 'test:fail' || data.details?.error?.failureType === 'subtestsFailed') continue;
    const error = data.details?.error;
    const detail = inspect(error?.cause ?? error, { depth: 5, colors: false }).slice(0, 8000);
    const message = `${data.name}\n${data.file ?? ''}:${data.line ?? ''}\n${detail}`
      .replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    yield `::error title=Game Studio regression::${message}\n`;
  }
}
