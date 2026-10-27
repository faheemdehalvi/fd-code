import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function FDCodeWordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 96 / 64;
  return (
    <Svg
      accessibilityLabel="FD CODE"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 96 64"
    >
      <ThemedPath
        d="M8 8h34v10H19v12h20v10H19v16H8V8Zm43 0h17c17 0 25 9 25 24S85 56 68 56H51V8Zm11 10v28h6c9 0 14-5 14-14s-5-14-14-14h-6Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
