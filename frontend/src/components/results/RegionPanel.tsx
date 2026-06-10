import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { defaultRegionColor } from "../../lib/regionColors";
import type { RegionSelection } from "../../lib/segLut";
import type { AtlasRegion } from "../../types";
import { ColorField } from "./ColorField";

export function RegionPanel({
  regions,
  selection,
  baseColor,
  baseOpacity,
  onBaseColor,
  onBaseOpacity,
  onRegionChange,
  onReset,
  onClose,
}: {
  regions: AtlasRegion[];
  selection: RegionSelection;
  baseColor: string;
  baseOpacity: number;
  onBaseColor: (hex: string) => void;
  onBaseOpacity: (v: number) => void;
  onRegionChange: (key: string, next: { on: boolean; color: string; opacity?: number }) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  // On open, move focus into the panel (its heading) so keyboard users land
  // inside the revealed disclosure instead of staying on the toggle. Closing
  // (× / Esc / Reset) restores focus to the toggle, handled by the caller.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Group regions by their .group, preserving catalog order within each group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { region: AtlasRegion; index: number }[]>();
    regions.forEach((region, index) => {
      if (!byGroup.has(region.group)) {
        byGroup.set(region.group, []);
        order.push(region.group);
      }
      byGroup.get(region.group)!.push({ region, index });
    });
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
  }, [regions]);

  return (
    <aside
      id="region-panel"
      className="region-panel"
      aria-label="Segmentation regions"
      // Esc closes the panel from anywhere inside it; the caller restores focus
      // to the toggle on close.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="region-panel-head">
        {/* tabIndex -1 so it can receive programmatic focus on open without
            entering the tab order. */}
        <strong ref={headingRef} tabIndex={-1}>
          Regions
        </strong>
        <button type="button" className="region-panel-close" aria-label="Close regions panel" onClick={onClose}>
          <X size={15} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>

      <div className="region-base-row">
        <span className="region-color-label">Whole-brain color</span>
        <ColorField
          label="Whole-brain"
          color={baseColor}
          onColor={onBaseColor}
          opacity={baseOpacity}
          onOpacity={onBaseOpacity}
        />
      </div>
      <button type="button" className="region-reset" onClick={onReset}>
        Reset to one color
      </button>

      <div className="region-groups">
        {groups.map(({ group, items }) => (
          <fieldset className="region-group" key={group}>
            <legend>{group}</legend>
            {items.map(({ region, index }) => {
              const sel = selection[region.key];
              const on = Boolean(sel?.on);
              const color = sel?.color ?? defaultRegionColor(index);
              const opacity = sel?.opacity ?? 1;
              const checkboxId = `region-on-${region.key}`;
              return (
                <div className={`region-row ${on ? "is-on" : ""}`} key={region.key}>
                  <div className="region-row-main">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="region-check"
                      checked={on}
                      aria-label={`Show ${region.name}`}
                      onChange={(event) =>
                        onRegionChange(region.key, { on: event.target.checked, color, opacity })
                      }
                    />
                    <label className="region-name" htmlFor={checkboxId}>
                      {region.name}
                    </label>
                    {/* Picking a color OR changing opacity enables the region
                        (intent to highlight it). Opacity now lives inside the
                        ColorField popover, not an inline row. */}
                    <ColorField
                      label={region.name}
                      color={color}
                      onColor={(hex) => onRegionChange(region.key, { on: true, color: hex, opacity })}
                      opacity={opacity}
                      onOpacity={(value) =>
                        onRegionChange(region.key, { on: true, color, opacity: value })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
    </aside>
  );
}
