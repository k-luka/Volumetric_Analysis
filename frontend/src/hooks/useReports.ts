import { useState, type Dispatch, type SetStateAction } from "react";
import { getReport, getReports } from "../lib/api";
import type { ReportDetail, ReportSummary } from "../types";

export type UseReports = {
  reports: ReportSummary[];
  setReports: Dispatch<SetStateAction<ReportSummary[]>>;
  activeReport: ReportDetail | null;
  setActiveReport: Dispatch<SetStateAction<ReportDetail | null>>;
  openReport: (id: string) => Promise<void>;
  refreshReports: (reportId?: string | null) => Promise<void>;
};

export function useReports(): UseReports {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [activeReport, setActiveReport] = useState<ReportDetail | null>(null);

  async function refreshReports(reportId?: string | null) {
    const list = await getReports();
    setReports(list);
    const id = reportId && list.some((report) => report.id === reportId) ? reportId : list[0]?.id;
    if (!id) {
      setActiveReport(null);
      return;
    }
    setActiveReport(await getReport(id));
  }

  // Mirrors App's `onOpenReport` fallback: on failure, re-fetch the list and
  // clear the active report if it was the one that failed. The thrown error is
  // re-raised so App can surface it via `setNotice(errorText(error))`.
  async function openReport(id: string) {
    try {
      setActiveReport(await getReport(id));
    } catch (error) {
      setReports(await getReports().catch(() => reports));
      setActiveReport((current) => (current?.id === id ? null : current));
      throw error;
    }
  }

  return { reports, setReports, activeReport, setActiveReport, openReport, refreshReports };
}
