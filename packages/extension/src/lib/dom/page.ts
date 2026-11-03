import type { Fill, FillResult, FormSnapshot } from '@formhand/core';
import { fillTarget, restore, type Previous } from './fill';
import { highlight, unhighlight } from './highlight';
import { FieldIds, scanDocument, type ScanOptions, type ScanResult } from './scan';

interface Batch {
  previous: Previous[];
  touched: Element[];
  fields: number;
}

/**
 * Everything the content script does for one page: scan, fill, undo. Fills refer to
 * ids from the latest scan; undo walks back one fill at a time.
 */
export class PageController {
  private readonly ids = new FieldIds();
  private last?: ScanResult;
  private readonly undoStack: Batch[] = [];

  constructor(
    private readonly doc: Document,
    private readonly options: ScanOptions & { locale?: string } = {},
  ) {}

  scan(): FormSnapshot {
    this.last = scanDocument(this.doc, this.ids, this.options);
    return this.last.snapshot;
  }

  fill(fills: Fill[]): FillResult {
    // Fields can appear after the first scan (a "Company" box shown after a checkbox), so rescan for unknown ids.
    if (!this.last || fills.some((f) => !this.last!.targets.has(f.id))) this.scan();
    const { snapshot, targets } = this.last!;
    const fieldsById = new Map(snapshot.fields.map((f) => [f.id, f]));
    const result: FillResult = { filled: [], skipped: [] };
    const batch: Batch = { previous: [], touched: [], fields: 0 };
    const active = this.doc.activeElement as HTMLElement | null;

    for (const fill of fills) {
      const field = fieldsById.get(fill.id);
      const target = targets.get(fill.id);
      if (!field || !target) {
        result.skipped.push({ id: fill.id, reason: 'no field with this id; read the form again' });
        continue;
      }
      try {
        const outcome = fillTarget(target, field, fill.value, this.options.locale);
        if (outcome.ok) {
          result.filled.push(fill.id);
          batch.previous.push(...outcome.previous);
          batch.touched.push(...outcome.touched);
        } else {
          result.skipped.push({ id: fill.id, reason: outcome.reason });
        }
      } catch (error) {
        result.skipped.push({ id: fill.id, reason: `the page threw an error: ${(error as Error).message}` });
      }
    }

    active?.focus?.({ preventScroll: true });
    batch.fields = result.filled.length;
    if (batch.fields) {
      this.undoStack.push(batch);
      highlight(batch.touched);
      batch.touched[0]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    return result;
  }

  /** Puts back the values from before the last fill; returns how many fields changed back. */
  undo(): number {
    const batch = this.undoStack.pop();
    if (!batch) return 0;
    restore(batch.previous);
    unhighlight(batch.touched);
    return batch.fields;
  }
}
