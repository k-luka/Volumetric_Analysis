import { useEffect, useState } from "react";
import { getAtlasRegions } from "../lib/api";
import { SEG_MAX_LABEL } from "../lib/segLut";
import type { AtlasRegion } from "../types";

export type AtlasCatalogState = {
  regions: AtlasRegion[];
  maxLabel: number;
  status: "loading" | "ready" | "failed";
};

// Fetch the atlas region catalog once. On failure we fall back to an empty
// catalog with status "failed": the viewer still works (whole-brain single
// color via buildSegLut([], ...)), the region menu just never appears.
export function useAtlasCatalog(): AtlasCatalogState {
  const [state, setState] = useState<AtlasCatalogState>({
    regions: [],
    maxLabel: SEG_MAX_LABEL,
    status: "loading",
  });

  useEffect(() => {
    let mounted = true;
    getAtlasRegions()
      .then((data) => {
        if (!mounted) {
          return;
        }
        setState({
          regions: data.regions,
          maxLabel: data.maxLabel || SEG_MAX_LABEL,
          status: "ready",
        });
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setState({ regions: [], maxLabel: SEG_MAX_LABEL, status: "failed" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
