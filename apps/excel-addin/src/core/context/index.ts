export { officeDataSource } from "./datasource";
export type { ExcelDataSource, SelectionInfo, RangeFormat, RunScriptResult } from "./datasource";

export { inMemoryDataSource } from "./in-memory";
export type { InMemoryWorkbook, InMemorySheet, CellValue } from "./in-memory";

export { getWorkbookOutline, renderWorkbookOutline } from "./outline";

export { getSheetOutline, renderSheetOutline } from "./sheet-outline";
export type { FormulaCluster, SampleCell, SheetOutline } from "./sheet-outline";

export { normalizeFormula } from "./formula-norm";

export {
  extractFormulaRefs,
  MAX_TRACE_DEPTH,
  renderDependencyTrace,
  traceDependents,
  tracePrecedents,
} from "./dependencies";
export type {
  DependencyEntry,
  DependencyTraceResult,
  ExtractedRefs,
  TraceDirection,
  TraceOptions,
  TraceTarget,
  UnresolvedRef,
} from "./dependencies";

export { readRange } from "./range-read";
export { describeClipping } from "./clipping";
export type { ReadRangeOptions } from "./range-read";

export {
  columnIndexToLetter,
  columnLetterToIndex,
  formatA1,
  formatRange,
  parseA1,
  parseRange,
  rangeColumnCount,
  rangeRowCount,
  stripSheetQualifier,
} from "./address";
export type { CellRef, RangeRef } from "./address";

export type { NamedRangeInfo, RangeData, SheetSummary, WorkbookOutline } from "./types";
