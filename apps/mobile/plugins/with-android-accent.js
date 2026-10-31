// Android's own widgets (AlertDialog buttons, for one) take their colour
// from the app theme's colorPrimary / colorAccent, which Expo's default
// template leaves teal. This sets both to the Berean accent, #9B3F2A light
// and #E59A7C dark (src/design/tokens.ts), and points AppTheme at them.
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
} = require('expo/config-plugins');

const ACCENT = { light: '#9B3F2A', dark: '#E59A7C' };
const NAMES = ['colorPrimary', 'colorAccent'];

function assignAccent(xml, value) {
  return NAMES.reduce((out, name) => AndroidConfig.Colors.assignColorValue(out, { name, value }), xml);
}

module.exports = function withAndroidAccent(config) {
  config = withAndroidColors(config, (c) => {
    c.modResults = assignAccent(c.modResults, ACCENT.light);
    return c;
  });
  config = withAndroidColorsNight(config, (c) => {
    c.modResults = assignAccent(c.modResults, ACCENT.dark);
    return c;
  });
  return withAndroidStyles(config, (c) => {
    const parent = AndroidConfig.Styles.getAppThemeGroup();
    c.modResults = NAMES.reduce(
      (xml, name) =>
        AndroidConfig.Styles.assignStylesValue(xml, { add: true, name, value: `@color/${name}`, parent }),
      c.modResults,
    );
    return c;
  });
};
