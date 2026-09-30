import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { cardStyles } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { nflApi } from "../services/nflApi";
import type { MobileModelSignalsResponse } from "../types/api";
import { formatMatchup, formatNumber, signedSpread } from "../utils/format";

export function ModelSignalsScreen() {
  const [data, setData] = useState<MobileModelSignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await nflApi.modelSignals());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading model signals…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || data.games.length === 0) return <EmptyState message="No model signals are available." />;

  return (
    <>
      <View style={cardStyles.card}>
        <Text style={cardStyles.title}>NFL Model Signals</Text>
        <Text style={cardStyles.subtitle}>Comparison tools only, not recommendations.</Text>
      </View>
      {data.games
        .slice()
        .sort((left, right) => Number(right.model_signals?.opportunity_score ?? 0) - Number(left.model_signals?.opportunity_score ?? 0))
        .map((game) => {
        const signals = game.model_signals;
        return (
          <View key={game.game_id ?? `${game.away_team}-${game.home_team}`} style={cardStyles.card}>
            <Text style={cardStyles.title}>{formatMatchup(game.away_team, game.home_team)}</Text>
            <Text style={cardStyles.subtitle}>{game.kickoff_date ?? "TBD"} {game.kickoff_time ?? ""}</Text>
            <View style={styles.badges}>
              <Text style={[cardStyles.badge, opportunityBadgeStyle(signals?.opportunity_tier)]}>
                {signals?.opportunity_label ?? "Market comparison"}
              </Text>
              <Text style={cardStyles.badge}>{signals?.agreement_label ?? "Insufficient model coverage"}</Text>
              <Text style={cardStyles.badge}>{signals?.market_alignment_label ?? "No market line available"}</Text>
              <Text style={cardStyles.badge}>{signals?.total_outlook_label ?? "No total signal"}</Text>
            </View>
            <View style={styles.metrics}>
              <Metric label="Spread gap" value={formatNumber(signals?.max_spread_market_gap)} />
              <Metric label="Total gap" value={formatNumber(signals?.max_total_market_gap)} />
              <Metric label="Spread range" value={formatNumber(signals?.model_spread_range)} />
              <Metric label="Total range" value={formatNumber(signals?.model_total_range)} />
              <Metric label="Favorite view" value={String(signals?.models_favoring_market_favorite ?? 0)} />
              <Metric label="Underdog view" value={String(signals?.models_favoring_market_underdog ?? 0)} />
            </View>
            <Text style={cardStyles.subtitle}>
              Market: {game.market.favorite?.team ?? "—"} {signedSpread(game.market.favorite?.spread)} / Total {formatNumber(game.market.total_line)}
            </Text>
            {signals?.story ? <Text style={styles.story}>{String(signals.story)}</Text> : null}
          </View>
        );
      })}
    </>
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

function opportunityBadgeStyle(tier: unknown) {
  if (tier === "high") return styles.highOpportunity;
  if (tier === "moderate") return styles.moderateOpportunity;
  return null;
}

const styles = StyleSheet.create({
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metrics: {
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
  story: {
    color: "#dbeafe",
    lineHeight: 20,
  },
  highOpportunity: {
    backgroundColor: "#34d399",
    color: "#052e16",
  },
  moderateOpportunity: {
    backgroundColor: "#7dd3fc",
    color: "#082f49",
  },
});
