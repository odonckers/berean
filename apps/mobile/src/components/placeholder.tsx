import { Screen } from '@/components/screen';
import { UIText } from '@/components/text';

type PlaceholderProps = {
  title: string;
  heading: string;
  body: string;
};

export function Placeholder({ title, heading, body }: PlaceholderProps) {
  return (
    <Screen title={title} search>
      <UIText variant="title">{heading}</UIText>
      <UIText secondary>{body}</UIText>
    </Screen>
  );
}
