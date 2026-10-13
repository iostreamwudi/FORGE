import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, mobileCanvasWidth } from '@/design-system';
import { initializeDatabase } from '@/data/database/client';
import { ForgeAppProvider, useForgeAppState } from '@/state/ForgeAppContext';

const authRoutes = new Set(['login', 'register', 'forgot-password', 'verify-email']);

export default function RootLayout() {
  useEffect(() => { initializeDatabase().catch((error: unknown) => console.warn('Database initialization failed', error)); }, []);
  const web = Platform.OS === 'web';
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ForgeAppProvider>
          <View style={web ? styles.webStage : styles.nativeStage}>
            <View style={web ? styles.webShell : styles.nativeStage}>
              <StatusBar style="light" />
              <AppNavigator />
            </View>
          </View>
        </ForgeAppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigator() {
  const { authSession, hydrated } = useForgeAppState();
  const segments = useSegments();
  const currentRoute = segments[0] ?? '';
  const isAuthRoute = authRoutes.has(currentRoute);

  const needsAuthRedirect = hydrated && ((!authSession && !isAuthRoute) || (Boolean(authSession) && isAuthRoute));

  useEffect(() => {
    if (!needsAuthRedirect) return;
    router.replace(authSession ? '/' : '/login');
  }, [authSession, needsAuthRedirect]);

  if (!hydrated) {
    return <View style={styles.authLoading}><ActivityIndicator color={colors.accent} /><View style={styles.loadingCopy}><View style={styles.loadingMark} /></View></View>;
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="active-workout" options={{ gestureEnabled: true, fullScreenGestureEnabled: true }} />
      <Stack.Screen name="workout-summary" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  nativeStage: { flex: 1 },
  webStage: { flex: 1, width: '100%', alignItems: 'center', backgroundColor: '#111315' },
  webShell: { flex: 1, width: mobileCanvasWidth, maxWidth: '100%', backgroundColor: colors.background },
  authLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.background },
  loadingCopy: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden' },
  loadingMark: { width: 18, height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
