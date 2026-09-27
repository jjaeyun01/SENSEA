const app = require('./app.json');
module.exports = () => ({
  ...app.expo,
  plugins: [
    ...app.expo.plugins,
    ['react-native-maps', {
      androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || '',
      iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY || '',
    }],
  ],
});
