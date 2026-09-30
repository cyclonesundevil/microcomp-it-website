import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { cardStyles } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { nflApi } from "../services/nflApi";
import type { MobileAlgorithmPerformanceResponse, ModelId, PerformanceTrendWeek } from "../types/api";
import { formatDateTime, formatNumber, formatPercent } from "../utils/format";

const MODELS: ModelId[] = ["baseline", "enhanced", "market_blend", "mean_reversion", "rothstein", "rothstein_plus", "rsm_stage7c"];

export function AlgorithmPerformanceScreen() {
  const [model, setModel] = useState<ModelId>("baseline");
  const [data, setData] = useState<MobileAlgorithmPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await nflApi.algorithmPerformance(model));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>Algorithm Performance Detail</Text>
        <Text style={cardStyles.subtitle}>Select an algorithm to view weekly trend data.</Text>
        <View style={styles.modelPicker}>
          {MODELS.map((item) => (
            <Pressable key={item} onPress={() => setModel(item)} style={[styles.modelChip, model === item && styles.modelChipActive]}>
              <Text style={[styles.modelChipText, model === item && styles.modelChipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {loading ? <LoadingState label={`Loading ${model} trend…`} /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}
      {!loading && !error && data && data.trend.weeks.length === 0 ? <EmptyState message="No trend data is available for this algorithm." /> : null}
      {!loading && !error && data && data.trend.weeks.length > 0 ? (
        <>
          <View style={cardStyles.card}>
            <Text style={cardStyles.title}>{data.trend.model}</Text>
            <Text style={cardStyles.subtitle}>Season {data.trend.season} · Generated {formatDateTime(data.trend.generated_at)}</Text>
          </View>
          {data.trend.weeks.map((week) => (
            <WeekTrendCard key={week.week} week={week} />
          ))}
        </>
      ) : null}
    </>
  );
}

function WeekTrendCard({ week }: { week: PerformanceTrendWeek }) {
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.row}>
        <Text style={cardStyles.title}>Week {week.week}</Text>
        <Text style={cardStyles.badge}>{week.completed_games} games</Text>
      </View>
      <TrendBar label="Spread" value={week.spread_win_rate} />
      <TrendBar label="Total" value={week.total_win_rate} />
      <Text style={cardStyles.subtitle}>Spread MAE {formatNumber(week.spread_mae)} · Total Score MAE {formatNumber(week.total_score_mae)}</Text>
    </View>
  );
}

function TrendBar({ label, value }: { label: string; value: number | null }) {
  const width = `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` as DimensionValue;
  return (
    <View style={styles.trendWrap}>
      <View style={cardStyles.row}>
        <Text style={cardStyles.label}>{label}</Text>
        <Text style={cardStyles.value}>{formatPercent(value)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.threshold, { left: "50%" }]} />
        <View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modelPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modelChip: {
    backgroundColor: "#0f172a",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modelChipActive: {
    backgroundColor: "#38bdf8",
  },
  modelChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
  },
  modelChipTextActive: {
    color: "#020617",
  },
  trendWrap: {
    gap: 6,
  },
  track: {
    backgroundColor: "#1e293b",
    borderRadius: 999,
    height: 12,
    overflow: "hidden",
    position: "relative",
  },
  fill: {
    backgroundColor: "#38bdf8",
    height: "100%",
  },
  threshold: {
    backgroundColor: "#ef4444",
    height: "100%",
    position: "absolute",
    width: 1,
    zIndex: 2,
  },
});
