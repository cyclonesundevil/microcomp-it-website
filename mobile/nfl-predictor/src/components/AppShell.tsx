import React from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

export type ScreenKey = "upcoming" | "signals" | "weekly" | "algorithm";

const TABS: Array<{ key: ScreenKey; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "signals", label: "Signals" },
  { key: "weekly", label: "Weekly" },
  { key: "algorithm", label: "Trends" },
];

export function AppShell({
  active,
  onChange,
  children,
}: {
  active: ScreenKey;
  onChange: (screen: ScreenKey) => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MicroComp IT</Text>
        <Text style={styles.title}>NFL Predictor</Text>
        <Text style={styles.subtitle}>Read-only model comparison preview</Text>
      </View>
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active === tab.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, active === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#111827",
    borderColor: "#243244",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  title: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#1e293b",
    borderRadius: 999,
    color: "#bae6fd",
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
  },
});

const styles = StyleSheet.create({
  safe: {
    backgroundColor: "#020617",
    flex: 1,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  eyebrow: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "900",
  },
  subtitle: {
    color: "#94a3b8",
    marginTop: 4,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tab: {
    backgroundColor: "#0f172a",
    borderColor: "#1e293b",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: "#38bdf8",
    borderColor: "#7dd3fc",
  },
  tabText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  tabTextActive: {
    color: "#020617",
  },
  content: {
    gap: 14,
    padding: 14,
    paddingBottom: 32,
  },
});
