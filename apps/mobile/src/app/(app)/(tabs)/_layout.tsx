import { Tabs } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "../../../theme";
import { useSession } from "../../../lib/session";
export default function TabLayout() {
  const { me } = useSession();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: "#fff", borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Feather name="home" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Learn",
          tabBarIcon: ({ color, size }) => (
            <Feather name="book-open" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="coding"
        options={{
          title: "Coding",
          href:
            me?.features.includes("practice") &&
            me?.access?.practiceModuleIds.includes("competitive-coding")
              ? undefined
              : null,
          tabBarIcon: ({ color, size }) => (
            <Feather name="code" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="careers"
        options={{
          title: "Careers",
          href: me?.features.some((f) => ["jobs", "resume"].includes(f))
            ? undefined
            : null,
          tabBarIcon: ({ color, size }) => (
            <Feather name="briefcase" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Feather
              name="more-horizontal"
              color={color as string}
              size={size}
            />
          ),
        }}
      />
    </Tabs>
  );
}
