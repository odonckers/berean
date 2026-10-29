import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Screen } from '@/components/screen';
import { ScriptureText, UIText } from '@/components/text';
import { useBerean } from '@/design/theme';
import { highlightSpokenNames, readingMeasure, type HighlightName } from '@/design/tokens';

// Design specimen until real chapters arrive. ASV (public domain).
const verses: { number: number; text: string; highlight?: HighlightName }[] = [
  { number: 1, text: 'In the beginning was the Word, and the Word was with God, and the Word was God.' },
  { number: 2, text: 'The same was in the beginning with God.' },
  {
    number: 3,
    text: 'All things were made through him; and without him was not anything made that hath been made.',
  },
  { number: 4, text: 'In him was life; and the life was the light of men.', highlight: 'yellow' },
  { number: 5, text: 'And the light shineth in the darkness; and the darkness apprehended it not.' },
  { number: 6, text: 'There came a man, sent from God, whose name was John.' },
  {
    number: 7,
    text: 'The same came for witness, that he might bear witness of the light, that all might believe through him.',
  },
  { number: 8, text: 'He was not the light, but came that he might bear witness of the light.' },
  {
    number: 9,
    text: 'There was the true light, even the light which lighteth every man, coming into the world.',
  },
  {
    number: 10,
    text: 'He was in the world, and the world was made through him, and the world knew him not.',
  },
  { number: 11, text: 'He came unto his own, and they that were his own received him not.' },
  {
    number: 12,
    text: 'But as many as received him, to them gave he the right to become children of God, even to them that believe on his name:',
  },
  {
    number: 13,
    text: 'who were born, not of blood, nor of the will of the flesh, nor of the will of man, but of God.',
  },
  {
    number: 14,
    text: 'And the Word became flesh, and dwelt among us (and we beheld his glory, glory as of the only begotten from the Father), full of grace and truth.',
  },
  {
    number: 15,
    text: 'John beareth witness of him, and crieth, saying, This was he of whom I said, He that cometh after me is become before me: for he was before me.',
  },
  { number: 16, text: 'For of his fulness we all received, and grace for grace.' },
  {
    number: 17,
    text: 'For the law was given through Moses; grace and truth came through Jesus Christ.',
  },
  {
    number: 18,
    text: 'No man hath seen God at any time; the only begotten Son, who is in the bosom of the Father, he hath declared him.',
  },
];

export default function ReadScreen() {
  const { colors, highlights, type, radii, spacing } = useBerean();
  const { fontScale } = useWindowDimensions();
  const measure = readingMeasure * fontScale;
  return (
    <Screen title="Read" search measure={measure}>
      {/* The reading column: capped at the measure, centered, so wide windows
          grow the margins. Phones are narrower than the cap. */}
      <View style={[styles.column, { maxWidth: measure, gap: spacing.md }]}>
        <ScriptureText variant="chapterHeading">John 1</ScriptureText>
        <ScriptureText variant="sectionHeading">The Word</ScriptureText>
        <View>
          {verses.map(({ number, text, highlight }) => (
            <ScriptureText
              key={number}
              accessibilityLabel={
                highlight
                  ? `Verse ${number}, highlighted, ${highlightSpokenNames[highlight]}. ${text}`
                  : `Verse ${number}. ${text}`
              }
              style={
                highlight && {
                  backgroundColor: highlights[highlight],
                  borderRadius: radii.chip,
                  marginHorizontal: -spacing.xs,
                  paddingHorizontal: spacing.xs,
                }
              }
            >
              <Text style={[type.verseNumber, { color: colors.textSecondary }]}>{number} </Text>
              {text}
            </ScriptureText>
          ))}
        </View>
        <UIText variant="caption" secondary>
          Sample passage (ASV). Real chapters come from the Berean core in Expo 4.
        </UIText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', alignSelf: 'center' },
});
