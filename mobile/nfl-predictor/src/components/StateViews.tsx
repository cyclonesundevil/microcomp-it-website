import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export function LoadingState({ label = "Loading NFL data…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#38bdf8" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Couldn’t load data</Text>
      <Text style={styles.muted}>{message}</Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  muted: {
    color: "#94a3b8",
    textAlign: "center",
  },
  errorTitle: {
    color: "#fecaca",
    fontSize: 18,
    fontWeight: "700",
  },
  button: {
    backgroundColor: "#0ea5e9",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#020617",
    fontWeight: "800",
  },
});
