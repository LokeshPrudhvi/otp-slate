import { View, Text } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme";
export function ProgressRing({
  value,
  total,
  label,
  size = 106,
  color = colors.teal,
  dark = false,
}: {
  value: number;
  total: number;
  label: string;
  size?: number;
  color?: string;
  dark?: boolean;
}) {
  const r = size / 2 - 7,
    c = 2 * Math.PI * r;
  return (
    <View
      accessibilityLabel={`${value} of ${total} ${label}`}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={dark ? "#494949" : "#E4EAF1"}
          strokeWidth={7}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeDasharray={`${c * Math.min(1, total ? value / total : 0)} ${c}`}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2},${size / 2}`}
        />
      </Svg>
      <Text
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: dark ? "#fff" : colors.text,
        }}
      >
        {value}
        <Text style={{ fontSize: 13, color: dark ? "#bbb" : colors.muted }}>
          /{total}
        </Text>
      </Text>
      <Text
        style={{
          fontSize: 11,
          color: dark ? "#bbb" : colors.muted,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
