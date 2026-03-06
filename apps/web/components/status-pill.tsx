export function StatusPill({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <span className="pill" data-tone={tone}>
      {children}
    </span>
  );
}


