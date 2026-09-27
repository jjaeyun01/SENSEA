const app = require('./app.json');
module.exports = () => ({
  ...app.expo,
  plugins: [
    ...app.expo.plugins,
    ['expo-audio', {
      microphonePermission: 'SENSEA measures relative environmental sound during active navigation. Audio is processed on-device and immediately deleted; only coarse-grid numeric levels are uploaded with your consent.',
      enableBackgroundRecording: false,
      enableBackgroundPlayback: false,
    }],
    ['react-native-maps', {
      androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '',
      iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || '',
    }],
  ],
});
