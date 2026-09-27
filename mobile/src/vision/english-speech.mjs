/** Select an installed English voice without changing the device language.
 * Expo Speech 57 on Android constructs Locale(language) rather than parsing a
 * BCP-47 tag. Use the primary language there so a region tag cannot fall back to
 * the phone locale; an explicit voice supplies the preferred US accent.
 */
export function englishSpeechOptions(voices = [], platform = "android") {
  const english = voices.filter(voice => typeof voice?.identifier === "string" && voice.identifier.length > 0 &&
    typeof voice.language === "string" && /^en(?:[-_]|$)/i.test(voice.language));
  const preferred = english.find(voice => /^en[-_]us$/i.test(voice.language)) ?? english[0];
  return { language: platform === "android" ? "en" : "en-US", rate: 0.95,
    ...(preferred ? { voice: preferred.identifier } : {}) };
}
