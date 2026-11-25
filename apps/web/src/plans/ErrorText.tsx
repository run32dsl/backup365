export function ErrorText({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} className="field-error">
      <span aria-hidden="true">✖</span> {children}
    </p>
  );
}
