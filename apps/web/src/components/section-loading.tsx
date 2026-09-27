import { WineLoadingProgress } from "./wine-loading-progress";

export function SectionLoading({ title, message }: { title: string; message: string }) {
  return <section className="panel" aria-busy="true">
    <h1>{title}</h1>
    <WineLoadingProgress inline message={message} detail="You can keep using navigation while this section loads." />
    <div className="section-skeleton" aria-hidden="true" />
  </section>;
}
