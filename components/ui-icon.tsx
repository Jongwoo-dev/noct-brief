import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Info,
  Moon,
  Sunrise,
} from "lucide-react";

const icons = {
  back: ArrowLeft,
  forward: ArrowRight,
  calendar: CalendarDays,
  info: Info,
  pre: Sunrise,
  post: Moon,
};

// These icons accompany visible labels; they never supply an accessible name.
export function UiIcon({
  name,
  className = "",
}: {
  name: keyof typeof icons;
  className?: string;
}) {
  const Icon = icons[name];
  return (
    <Icon
      className={`ui-icon ${className}`}
      size={18}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    />
  );
}
