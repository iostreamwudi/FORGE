import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, iconSize } from '@/design-system';

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'today-outline', train: 'barbell-outline', coach: 'sparkles-outline', nutrition: 'restaurant-outline', progress: 'stats-chart-outline', me: 'person-outline',
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs initialRouteName="index" screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.textSecondary, tabBarHideOnKeyboard: true,
      tabBarStyle: [styles.tabBar, { height: 64 + insets.bottom, paddingBottom: insets.bottom + 3 }],
      tabBarItemStyle: route.name === 'coach' ? styles.coachTabItem : styles.tabItem,
      tabBarLabelStyle: route.name === 'coach' ? styles.coachTabLabel : styles.tabLabel,
      tabBarIcon: ({ color, focused }) => route.name === 'coach'
        ? <View style={[styles.coachIconWrap, focused && styles.coachIconWrapFocused]}><Ionicons name={icons[route.name]} color={focused ? colors.background : color} size={28} /></View>
        : <Ionicons name={icons[route.name]} color={color} size={iconSize.navigation} />,
    })}>
      <Tabs.Screen name="index" options={{ title: '今日' }} />
      <Tabs.Screen name="train" options={{ title: '训练' }} />
      <Tabs.Screen name="coach" options={{ title: '教练' }} />
      <Tabs.Screen name="progress" options={{ title: '进展' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
      <Tabs.Screen name="nutrition" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: { backgroundColor: colors.tabSurface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle, paddingTop: 6, overflow: 'visible' },
  tabItem: { paddingVertical: 1, minWidth: 0, flex: 1 },
  coachTabItem: { paddingVertical: 1, minWidth: 0, flex: 1.12 },
  tabLabel: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  coachTabLabel: { fontSize: 12, lineHeight: 15, fontWeight: '800', marginTop: -2 },
  coachIconWrap: { width: 50, height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, marginTop: -15, borderWidth: 3, borderColor: colors.tabSurface },
  coachIconWrapFocused: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
});
