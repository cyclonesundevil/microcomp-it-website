import React, { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { AppShell, type ScreenKey } from "./src/components/AppShell";
import { AlgorithmPerformanceScreen } from "./src/screens/AlgorithmPerformanceScreen";
import { ModelSignalsScreen } from "./src/screens/ModelSignalsScreen";
import { UpcomingScreen } from "./src/screens/UpcomingScreen";
import { WeeklyPerformanceScreen } from "./src/screens/WeeklyPerformanceScreen";

export default function App() {
  const [screen, setScreen] = useState<ScreenKey>("upcoming");

  return (
    <>
      <StatusBar style="light" />
      <AppShell active={screen} onChange={setScreen}>
        {screen === "upcoming" ? <UpcomingScreen /> : null}
        {screen === "signals" ? <ModelSignalsScreen /> : null}
        {screen === "weekly" ? <WeeklyPerformanceScreen /> : null}
        {screen === "algorithm" ? <AlgorithmPerformanceScreen /> : null}
      </AppShell>
    </>
  );
}
