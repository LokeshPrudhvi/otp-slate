import { useState, type ReactNode, type ComponentProps } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  type ViewStyle,
  type StyleProp,
  type TextInputProps,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { router, useSegments } from "expo-router";
import { colors, radius } from "../theme";
export type IconName = ComponentProps<typeof Feather>["name"];
export function Icon({
  name,
  color = colors.primary,
  size = 22,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Feather name={name} color={color} size={size} />;
}
export function Label({
  children,
  muted = false,
  style,
  ...props
}: ComponentProps<typeof Text> & {
  children: ReactNode;
  muted?: boolean;
  style?: ComponentProps<typeof Text>["style"];
}) {
  return (
    <Text {...props} style={[s.text, muted && { color: colors.muted }, style]}>
      {children}
    </Text>
  );
}
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.title}>
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  loading = false,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const color = danger ? colors.red : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: secondary ? "transparent" : color,
          borderColor: color,
        },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? color : "#fff"} />
      ) : (
        <>
          {icon && (
            <Icon name={icon} color={secondary ? color : "#fff"} size={18} />
          )}
          <Text style={[s.buttonText, { color: secondary ? color : "#fff" }]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={s.iconButton}
    >
      <Icon name={name} />
    </Pressable>
  );
}
export function Brand() {
  return (
    <View style={s.brand}>
      <View style={s.brandMark}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>
          OTP
        </Text>
        <View
          style={{
            height: 3,
            width: 23,
            backgroundColor: "#FFE169",
            borderRadius: 2,
          }}
        />
      </View>
      <Text style={{ fontSize: 21, fontWeight: "800", color: colors.primary }}>
        Slate
      </Text>
    </View>
  );
}
export function Screen({
  children,
  title,
  back = false,
  scroll = true,
  actions,
  refreshing = false,
  onRefresh,
  style,
}: {
  children: ReactNode;
  title?: string;
  back?: boolean;
  scroll?: boolean;
  actions?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const inTabs = useSegments().includes("(tabs)");
  const content = <View style={[s.content, style]}>{children}</View>;
  return (
    <SafeAreaView
      style={s.screen}
      edges={
        inTabs ? ["top", "left", "right"] : ["top", "left", "right", "bottom"]
      }
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.header}>
          {back ? (
            <IconButton
              name="arrow-left"
              label="Back"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
            />
          ) : (
            <Brand />
          )}
          <View style={{ flex: 1 }}>
            {title && (
              <Text numberOfLines={2} style={s.headerTitle}>
                {title}
              </Text>
            )}
          </View>
          {actions}
        </View>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
            refreshControl={
              onRefresh ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.primary}
                />
              ) : undefined
            }
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }, style]}
    >
      {children}
    </Pressable>
  ) : (
    <View style={[s.card, style]}>{children}</View>
  );
}
export function Field({
  label,
  error,
  style,
  dark = false,
  ...props
}: TextInputProps & { label: string; error?: string; dark?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label
        style={{
          fontWeight: "600",
          fontSize: 13,
          ...(dark ? { color: "#E5E5E5" } : {}),
        }}
      >
        {label}
      </Label>
      <View style={{ position: "relative" }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="#8492A5"
          {...props}
          secureTextEntry={props.secureTextEntry && !show}
          style={[
            s.input,
            dark && {
              backgroundColor: colors.darkCard,
              color: "#fff",
              borderColor: "#505050",
            },
            props.multiline && { height: 130, textAlignVertical: "top" },
            props.secureTextEntry && { paddingRight: 52 },
            style,
          ]}
        />
        {props.secureTextEntry && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={show ? "Hide password" : "Show password"}
            onPress={() => setShow(!show)}
            style={[s.iconButton, { position: "absolute", right: 2, top: 2 }]}
          >
            <Icon name={show ? "eye-off" : "eye"} size={20} />
          </Pressable>
        )}
      </View>
      {error && (
        <Label style={{ color: colors.red, fontSize: 12 }}>{error}</Label>
      )}
    </View>
  );
}
export function Chips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 3 }}
    >
      {items.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.value }}
          key={item.value}
          onPress={() => onChange(item.value)}
          style={[
            s.chip,
            value === item.value && {
              backgroundColor: colors.primary,
              borderColor: colors.primary,
            },
          ]}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: value === item.value ? "#fff" : colors.muted,
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function Badge({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: "teal" | "amber" | "purple" | "red";
}) {
  return (
    <View
      style={{
        backgroundColor: colors[`${tone}Light`],
        alignSelf: "flex-start",
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 5,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "700", color: colors[tone] }}>
        {children}
      </Text>
    </View>
  );
}
export function Progress({
  value,
  color = colors.teal,
}: {
  value: number;
  color?: string;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{
        height: 5,
        backgroundColor: "#E4EAF1",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          height: 5,
          width: `${Math.max(0, Math.min(100, value * 100))}%`,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={{
        backgroundColor: error ? colors.redLight : colors.primaryLight,
        padding: 14,
        borderRadius: radius.input,
      }}
    >
      <Label
        style={{ color: error ? colors.red : colors.primary, fontSize: 13 }}
      >
        {children}
      </Label>
    </View>
  );
}
export function State({
  pending,
  error,
  onRetry,
  empty,
}: {
  pending?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: string;
}) {
  return pending ? (
    <View accessibilityLabel="Loading content" style={{ gap: 14, padding: 22 }}>
      <ActivityIndicator size="large" color={colors.primary} />
      {[90, 75, 85].map((n, i) => (
        <View
          key={i}
          style={{
            height: 42,
            width: `${n}%`,
            backgroundColor: "#E3EAF3",
            borderRadius: 8,
          }}
        />
      ))}
      <Label muted>Getting your learning ready…</Label>
    </View>
  ) : error ? (
    <Card>
      <Icon name="wifi-off" />
      <Title>Could not load this</Title>
      <Label muted>{error.message}</Label>
      {onRetry && <Button title="Try again" onPress={onRetry} />}
    </Card>
  ) : empty ? (
    <Card>
      <Icon name="inbox" />
      <Title>{empty}</Title>
      <Label muted>Your assigned content will appear here.</Label>
    </Card>
  ) : null;
}
export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  dark = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  return (
    <View style={{ gap: 6 }}>
      <Label
        style={{
          fontSize: 13,
          fontWeight: "600",
          ...(dark ? { color: "#E5E5E5" } : {}),
        }}
      >
        {label}
      </Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          s.input,
          s.row,
          dark && { backgroundColor: colors.darkCard, borderColor: "#505050" },
          disabled && { opacity: 0.5 },
        ]}
      >
        <Label style={{ flex: 1, ...(dark ? { color: "#fff" } : {}) }}>
          {options.find((o) => o.value === value)?.label || "Select an option"}
        </Label>
        <Icon
          name="chevron-down"
          size={18}
          color={dark ? "#eee" : colors.primary}
        />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={s.scrim} onPress={() => setOpen(false)} />
        <SafeAreaView edges={["bottom"]} style={s.sheet}>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Title>{label}</Title>
            <IconButton
              name="x"
              label="Close selection"
              onPress={() => setOpen(false)}
            />
          </View>
          <Field label="Search" value={search} onChangeText={setSearch} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 360 }}
          >
            {options
              .filter((o) =>
                o.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map((o) => (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: o.value === value }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={[s.row, { paddingVertical: 15, gap: 12 }]}
                >
                  <Icon
                    name={o.value === value ? "check-circle" : "circle"}
                    size={20}
                  />
                  <Label style={{ flex: 1 }}>{o.label}</Label>
                </Pressable>
              ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 18, flexGrow: 1 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.primary },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: {
    width: 39,
    height: 43,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    color: colors.text,
  },
  text: { fontSize: 15, lineHeight: 22, color: colors.text },
  button: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  buttonText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  iconButton: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  card: {
    padding: 18,
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    boxShadow: "0px 3px 10px rgba(15,39,71,0.045)",
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#CAD5E3",
    backgroundColor: "#fff",
    borderRadius: radius.input,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#10203977",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 22,
    gap: 15,
  },
});
