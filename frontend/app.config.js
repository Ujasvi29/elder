// ============================================================================
// Dynamic Expo config — Phase 1 step 5.
//
// Was a static app.json until this file. Converted so a preview/production
// build can be validated before anything is bundled: EXPO_PUBLIC_API_URL must
// be set for those two profiles, or the build fails here — in the first
// seconds of config resolution — instead of producing an APK that silently
// resolves to localhost on the phone. See BUILD_LOG.md's 2026-08-26 entry for
// the incident this exists to prevent: every earlier preview build had no
// apiUrl configured at all and baked in a backend address the phone can never
// reach. development is exempt on purpose — the dev client resolves the
// backend address from Metro's own host at runtime instead (see
// src/shared/config.js's resolveApiUrl), exactly as it does today; this check
// would only get in the way of that path.
//
// EAS_BUILD_PROFILE / EAS_BUILD are set automatically by `eas build` — both
// are undefined for a plain local `expo start`, so this check is a no-op
// outside of an actual EAS build.
// ============================================================================

const EAS_BUILD_PROFILE = process.env.EAS_BUILD_PROFILE;
const IS_EAS_BUILD = process.env.EAS_BUILD === 'true';
const PROFILES_REQUIRING_API_URL = ['preview', 'production'];

if (IS_EAS_BUILD && PROFILES_REQUIRING_API_URL.includes(EAS_BUILD_PROFILE) && !process.env.EXPO_PUBLIC_API_URL) {
  throw new Error(
    `EXPO_PUBLIC_API_URL is not set for the "${EAS_BUILD_PROFILE}" build profile. ` +
      'This build cannot reach a backend without it. Set it as an EAS environment ' +
      'variable for this project (see SETUP.md) before building — refusing to build ' +
      'rather than silently baking in a localhost fallback that can never work on a ' +
      'real device.'
  );
}

module.exports = {
  expo: {
    name: 'ElderCare',
    slug: 'eldercare',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
    },
    android: {
      package: 'com.eldercare.app',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: [
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    // eas.projectId written here by `eas init` (see BUILD_LOG.md) — carried
    // over verbatim from the static app.json this file replaces.
    extra: {
      eas: {
        projectId: 'c89864ad-512c-4674-9258-236cb3b560f9',
      },
    },
    plugins: [
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'ElderCare uses your location so your family can see where you are if you press SOS.',
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      'expo-notifications',
      // TEMPORARY — local-dev-only, coarse, and must not reach a production
      // build. `android.usesCleartextTraffic` is not a real effect unless set
      // through this plugin — a bare `android.usesCleartextTraffic: true` key
      // directly on the config (what this project had before) is silently
      // ignored by Expo's prebuild and never reaches the compiled
      // AndroidManifest.xml at all. Confirmed the hard way: build aa8582c0
      // shipped with the bare key set and the flag missing from the manifest
      // — see BUILD_LOG.md, 2026-08-26.
      //
      // Without this, Android blocks all plain http:// requests app-wide by
      // default (targetSdkVersion 28+). EXPO_PUBLIC_API_URL is a LAN IP over
      // http:// during development, so this has to be true for any preview
      // build to reach a backend at all right now. Before a real production
      // build: either replace this with a network_security_config.xml scoped
      // to private/local IP ranges only, or drop it entirely once the
      // backend is reachable over https://. Do not let this ship as `true`
      // by accident — see SETUP.md's preview-build section.
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  },
};
