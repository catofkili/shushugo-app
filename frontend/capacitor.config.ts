import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lsc.masternihongo',
  appName: 'Master 日语',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
  },

  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
    },
    LocalNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
