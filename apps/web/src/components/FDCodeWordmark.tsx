import type { SVGProps } from "react";

export function FDCodeWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 96 64" xmlns="http://www.w3.org/2000/svg" aria-label="FD CODE">
      <path
        d="M8 8h34v10H19v12h20v10H19v16H8V8Zm43 0h17c17 0 25 9 25 24S85 56 68 56H51V8Zm11 10v28h6c9 0 14-5 14-14s-5-14-14-14h-6Z"
        fill="currentColor"
      />
    </svg>
  );
}
