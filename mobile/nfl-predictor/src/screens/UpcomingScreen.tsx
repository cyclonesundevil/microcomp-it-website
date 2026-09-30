import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { cardStyles } from "../components/AppShell";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews";
import { nflApi } from "../services/nflApi";
import type { MobileUpcomingResponse, UpcomingGame } from "../types/api";
import { formatDateTime, formatMatchup, formatNumber, signedSpread } from "../utils/format";

const MODEL_ORDER = ["baseline", "enhanced", "market_blend", "mean_reversion", "rothstein", "rothstein_plus", "rsm_stage7c"];

export function UpcomingScreen() {
  const [data, setData] = useState<MobileUpcomingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await nflApi.upcoming());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || data.games.length === 0) return <EmptyState message="No upcoming games are currently available." />;

  return (
    <>
      <View style={styles.summaryCard}>
        <Text style={cardStyles.title}>Week {data.week ?? "—"} board</Text>
        <Text style={cardStyles.subtitle}>Season {data.season ?? "—"} · Football week starts {data.football_week_start ?? "—"}</Text>
        <Text style={cardStyles.subtitle}>Last rebuild: {formatDateTime(data.last_rebuild_at)}</Text>
        {data.cache?.stale ? <Text style={styles.stale}>Cached source data may be stale.</Text> : null}
      </View>
      {data.games.map((game) => (
        <GameCard key={game.game_id ?? `${game.away_team}-${game.home_team}`} game={game} />
      ))}
    </>
  );
}

function GameCard({ game }: { game: UpcomingGame }) {
  const favorite = game.market.favorite?.team ? `${game.market.favorite.team} ${signedSpread(game.market.favorite.spread)}` : "No favorite";
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.row}>
        <View style={styles.flex}>
          <Text style={cardStyles.title}>{formatMatchup(game.away_team, game.home_team)}</Text>
          <Text style={cardStyles.subtitle}>{game.kickoff_date ?? "TBD"} {game.kickoff_time ?? ""}</Text>
        </View>
        <Text style={cardStyles.badge}>{game.game_status}</Text>
      </View>
      {game.game_status === "final" ? (
        <Text style={styles.final}>Final: {game.away_team} {formatNumber(game.away_score, 0)}, {game.home_team} {formatNumber(game.home_score, 0)}</Text>
      ) : null}
      <View style={styles.marketBox}>
        <Text style={cardStyles.label}>Market</Text>
        <Text style={cardStyles.value}>{favorite} / Total {formatNumber(game.market.total_line)}</Text>
      </View>
      <View style={styles.algorithms}>
        {MODEL_ORDER.map((model) => {
          const row = game.algorithms[model];
          if (!row) return null;
          return (
            <View key={model} style={styles.algorithmRow}>
              <View style={styles.flex}>
                <Text style={styles.modelName}>{model}</Text>
                <Text style={styles.status}>{row.status_label}{row.availability_adjusted ? " · adjusted" : ""}</Text>
              </View>
              {row.display_suppressed ? (
                <Text style={styles.ineligible}>Unavailable</Text>
              ) : (
                <Text style={styles.prediction}>{signedSpread(row.market_favorite_relative_spread)} / {formatNumber(row.predicted_total)}</Text>
              )}
            </View>
          );
        })}
      </View>
      {game.model_signals?.story ? (
        <Pressable style={styles.story}>
          <Text style={cardStyles.label}>Model Signals</Text>
          <Text style={cardStyles.subtitle}>{String(game.model_signals.story)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    ...cardStyles.card,
    backgroundColor: "#0b1220",
  },
  flex: {
    flex: 1,
  },
  stale: {
    color: "#fde68a",
    fontWeight: "700",
  },
  final: {
    color: "#bbf7d0",
    fontWeight: "800",
  },
  marketBox: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 12,
  },
  algorithms: {
    gap: 8,
  },
  algorithmRow: {
    alignItems: "center",
    borderTopColor: "#1e293b",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  modelName: {
    color: "#f8fafc",
    fontWeight: "800",
  },
  status: {
    color: "#94a3b8",
    fontSize: 12,
  },
  prediction: {
    color: "#e0f2fe",
    fontWeight: "900",
  },
  ineligible: {
    color: "#fca5a5",
    fontWeight: "800",
  },
  story: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 12,
  },
});
