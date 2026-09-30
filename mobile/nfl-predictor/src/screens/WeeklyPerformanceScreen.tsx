import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { cardStyles } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { nflApi } from "../services/nflApi";
import type { MobileWeeklyPerformanceResponse, WeeklyModelPerformance } from "../types/api";
import { formatDateTime, formatNumber, formatPercent } from "../utils/format";

export function WeeklyPerformanceScreen() {
  const [data, setData] = useState<MobileWeeklyPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await nflApi.weeklyPerformance());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading weekly performance…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || data.performance.models.length === 0) return <EmptyState message="No weekly performance is available yet." />;

  return (
    <>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Weekly Algorithm Performance</Text>
        <Text style={cardStyles.subtitle}>Season {data.performance.season}, week {data.performance.week} · {data.performance.completed_games} completed games</Text>
        <Text style={cardStyles.subtitle}>Generated: {formatDateTime(data.performance.generated_at)}</Text>
      </View>
      {data.performance.models.map((model) => (
        <PerformanceCard key={model.model} row={model} />
      ))}
    </>
  );
}

function PerformanceCard({ row }: { row: WeeklyModelPerformance }) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.title}>{row.model}</Text>
      <View style={styles.grid}>
        <Metric label="Spread %" value={formatPercent(row.spread_win_rate)} />
        <Metric label="Total %" value={formatPercent(row.total_win_rate)} />
        <Metric label="Spread MAE" value={formatNumber(row.spread_mae)} />
        <Metric label="Total Score MAE" value={formatNumber(row.total_score_mae)} />
      </View>
      <Text style={cardStyles.subtitle}>
        Spread {row.spread_wins}-{row.spread_losses}-{row.spread_pushes} · Total {row.total_wins}-{row.total_losses}-{row.total_pushes}
      </Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={cardStyles.label}>{label}</Text>
      <Text style={cardStyles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metric: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    minWidth: "45%",
    padding: 10,
  },
});
