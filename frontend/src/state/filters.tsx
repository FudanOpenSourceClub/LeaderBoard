import { createContext, useContext, useState, type ReactNode } from "react";
import type { LeaderboardMetric, TimeRange } from "@leadboard/contracts";

interface FiltersState {
  range: TimeRange;
  setRange: (range: TimeRange) => void;
  group: string | undefined;
  setGroup: (group: string | undefined) => void;
  metric: LeaderboardMetric;
  setMetric: (metric: LeaderboardMetric) => void;
}

const FiltersContext = createContext<FiltersState | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<TimeRange>("all");
  const [group, setGroup] = useState<string | undefined>(undefined);
  const [metric, setMetric] = useState<LeaderboardMetric>("score");

  return (
    <FiltersContext.Provider value={{ range, setRange, group, setGroup, metric, setMetric }}>
      {children}
    </FiltersContext.Provider>
  );
}

export function useFilters(): FiltersState {
  const filters = useContext(FiltersContext);
  if (!filters) throw new Error("useFilters must be used inside FiltersProvider");
  return filters;
}
