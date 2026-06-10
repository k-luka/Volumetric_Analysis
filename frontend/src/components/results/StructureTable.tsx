import type { StructureVolume } from "../../types";

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function StructureTable({ rows }: { rows: StructureVolume[] }) {
  return (
    <div className="structure-volume-shell" role="table" aria-label="Advanced structure volumes">
      <div className="structure-volume-header" role="rowgroup">
        <div className="structure-volume-row" role="row">
          <span role="columnheader">Structure</span>
          <span role="columnheader">Region</span>
          <span role="columnheader">Left (mL)</span>
          <span role="columnheader">Right (mL)</span>
          <span role="columnheader">Total (mL)</span>
          <span role="columnheader">Asymmetry %</span>
        </div>
      </div>
      <div className="structure-volume-body" role="rowgroup">
        {rows.map((row) => (
          <div className="structure-volume-row" role="row" key={`${row.structure}-${row.group}`}>
            <span role="cell">{row.structure}</span>
            <span role="cell">{row.group}</span>
            <span role="cell">{fmt(row.leftMl)}</span>
            <span role="cell">{fmt(row.rightMl)}</span>
            <span role="cell">{fmt(row.totalMl)}</span>
            <span role="cell">{fmt(row.asymmetryPct)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
