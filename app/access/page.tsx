import { AccessForm } from "./access-form";

export default function AccessPage() {
  return (
    <main className="access-shell">
      <section className="access-card">
        <p className="eyebrow">PRIVATE RESEARCH SYSTEM</p>
        <h1>Personal Research Workbench</h1>
        <p className="access-copy">
          This deployment accepts one owner session. Enter the private challenge to
          continue.
        </p>
        <AccessForm />
      </section>
    </main>
  );
}
