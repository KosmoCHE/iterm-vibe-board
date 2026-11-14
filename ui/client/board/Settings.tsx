// The settings, in a dialog over the board. The server keeps them in config.json, so
// every panel, in iTerm2 and in Paseo, shows what one of them set.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Settings } from "./host";
import { closesOnLeave, Icon, Select, T, Tint, useBoard } from "./parts";

const TEXT_SIZES = [85, 100, 115, 130, 150, 175]; // percent
const ARCHIVE_AFTER = [1, 3, 7, 14, 30, 90]; // days

export function SettingsDialog({ settings, onChange }: { settings: Settings; onChange: (change: Partial<Settings>, said: string) => void }) {
  const { c, set } = useBoard();
  const close = () => set(() => ({ settings: false }));
  const box = useRef<View>(null);
  useEffect(() => box.current?.focus(), []);
  const days = settings.archive_after_days;
  return (
    <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, padding: 10 }}>
      <Pressable accessibilityLabel="Close the settings" onPress={close} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}>
        <Tint color="black" opacity={0.35} />
      </Pressable>
      <View
        ref={box}
        role="dialog"
        aria-modal
        {...closesOnLeave(close)}
        accessibilityLabel="Settings"
        style={{ gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <T size={12} weight="700" style={{ flex: 1 }}>
            Settings
          </T>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close}>
            <Icon name="X" size={14} />
          </Pressable>
        </View>
        {/* A server from before the setting does not report it. */}
        {settings.text_size !== undefined && (
          <Setting label="Text size">
            <Select
              value={String(settings.text_size)}
              options={withCurrent(TEXT_SIZES, settings.text_size).map((n) => ({ value: String(n), label: `${n}%` }))}
              onChange={(value) => onChange({ text_size: Number(value) }, `Text size set to ${value}%`)}
            />
          </Setting>
        )}
        <Setting label="Archive finished tasks after">
          <Select
            value={days === null ? "" : String(days)}
            options={[...withCurrent(ARCHIVE_AFTER, days).map((n) => ({ value: String(n), label: n === 1 ? "1 day" : `${n} days` })), { value: "", label: "never" }]}
            onChange={(value) => {
              const n = value ? Number(value) : null;
              onChange({ archive_after_days: n }, n === null ? "Finished tasks stay on the board" : `Finished tasks are archived after ${n} ${n === 1 ? "day" : "days"}`);
            }}
          />
        </Setting>
      </View>
    </View>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  const { c } = useBoard();
  return (
    <View style={{ gap: 3 }}>
      <T color={c.foregroundMuted}>{label}</T>
      <View style={{ flexDirection: "row" }}>{children}</View>
    </View>
  );
}

/** The offered values, plus what config.json holds when that is none of them. */
function withCurrent(offered: number[], current: number | null): number[] {
  return current === null || offered.includes(current) ? offered : [...offered, current].sort((x, y) => x - y);
}
