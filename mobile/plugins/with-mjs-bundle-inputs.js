const { withAppBuildGradle } = require('expo/config-plugins');

const marker = '// SENSEA: include .mjs changes in Android bundle inputs.';
const gradleSnippet = `${marker}
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    sources.include("**/*.mjs")
}
`;

module.exports = function withMjsBundleInputs(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') {
      throw new Error('SENSEA MJS bundle inputs require the Expo Groovy app build.gradle.');
    }
    if (!result.modResults.contents.includes(marker)) {
      result.modResults.contents = `${result.modResults.contents.trimEnd()}\n\n${gradleSnippet}`;
    }
    return result;
  });
};
