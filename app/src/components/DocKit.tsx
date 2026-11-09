// Typography and layout for the docs and legal pages.
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, Info, AlertTriangle, Lightbulb } from "lucide-react";

export interface DocPage {
  slug: string;
  group: string;
  title: string;
  summary: string;
  Body: () => ReactNode;
}

// ---------------------------------------------------------------------------
// building blocks

export const H2 = ({ id, children }: { id?: string; children: ReactNode }) => (
  <h2 id={id} className="mt-12 scroll-mt-28 text-xl font-extrabold tracking-tight first:mt-0 md:text-[22px]">{children}</h2>
);
export const H3 = ({ children }: { children: ReactNode }) => <h3 className="mt-8 text-base font-bold text-ink md:text-[17px]">{children}</h3>;
export const P = ({ children }: { children: ReactNode }) => <p className="mt-4 text-[15px] leading-7 text-muted">{children}</p>;
export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>;
export const Code = ({ children }: { children: ReactNode }) => <code className="num rounded-md border border-line bg-bg px-1.5 py-0.5 text-[13px] text-accent">{children}</code>;

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-7 text-muted">
          <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="mt-6 space-y-4">
      {items.map((s, i) => (
        <li key={i} className="card flex gap-4 p-4 md:p-5">
          <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/12 text-sm font-bold text-accent">{i + 1}</span>
          <div className="min-w-0">
            <div className="font-bold text-ink">{s.title}</div>
            <div className="mt-1 text-[15px] leading-7 text-muted">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-line">
      {/* table on wide screens, stacked rows on phones */}
      <table className="hidden w-full text-left text-sm sm:table">
        <thead className="bg-panel2 text-xs uppercase tracking-wider text-faint">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className={`px-4 py-3 leading-6 ${j === 0 ? "font-semibold text-ink" : "text-muted"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="divide-y divide-line sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="space-y-1.5 p-4 text-sm">
            <div className="font-semibold text-ink">{r[0]}</div>
            {r.slice(1).map((c, j) => (
              <div key={j} className="flex gap-3">
                <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-faint">{head[j + 1]}</span>
                <span className="min-w-0 text-muted">{c}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return <div className="num mt-5 whitespace-pre-wrap break-words rounded-2xl border border-line bg-bg px-4 py-3.5 text-[13px] leading-6 text-ink">{children}</div>;
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "tip"; title?: string; children: ReactNode }) {
  const t = {
    info: { Icon: Info, cls: "border-accent/25 bg-accent/[0.05]", ic: "text-accent" },
    warn: { Icon: AlertTriangle, cls: "border-amber-400/25 bg-amber-400/[0.05]", ic: "text-amber-300" },
    tip: { Icon: Lightbulb, cls: "border-violet-400/25 bg-violet-400/[0.05]", ic: "text-violet-300" },
  }[tone];
  return (
    <div className={`mt-6 flex gap-3 rounded-2xl border p-4 ${t.cls}`}>
      <t.Icon size={17} className={`mt-1 shrink-0 ${t.ic}`} />
      <div className="min-w-0 text-[15px] leading-7 text-muted">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export const DocLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-semibold text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">{children}</Link>
);
export const ExtLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent">{children}</a>
);

// ---------------------------------------------------------------------------
// layout: sidebar + article + prev/next

export function DocLayout({ base, eyebrow, pages, slug, meta }: { base: string; eyebrow: string; pages: DocPage[]; slug?: string; meta?: ReactNode }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const idx = Math.max(0, pages.findIndex((p) => p.slug === slug));
  const page = pages[idx];
  const prev = pages[idx - 1];
  const next = pages[idx + 1];
  const groups = [...new Set(pages.map((p) => p.group))];

  const list = (
    <nav className="space-y-6">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-faint">{g}</div>
          <div className="space-y-0.5">
            {pages.filter((p) => p.group === g).map((p) => {
              const on = p.slug === page.slug;
              return (
                <button
                  key={p.slug}
                  onClick={() => { setOpen(false); nav(`${base}/${p.slug}`); }}
                  className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${on ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-panel2 hover:text-ink"}`}
                >
                  {p.title}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-6 md:px-8 md:pt-10">
      <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)] xl:gap-14">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-10">{list}</div>
        </aside>

        <article className="min-w-0 max-w-[780px]">
          {/* mobile contents */}
          <div className="mb-6 lg:hidden">
            <button onClick={() => setOpen((o) => !o)} className="card flex w-full items-center justify-between px-4 py-3 text-sm">
              <span className="text-muted">{page.group} · <span className="font-semibold text-ink">{page.title}</span></span>
              <ChevronDown size={16} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && <div className="card mt-2 p-3">{list}</div>}
          </div>

          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{eyebrow} · {page.group}</div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-[40px] md:leading-[1.1]">{page.title}</h1>
          <p className="mt-4 text-[17px] leading-8 text-muted">{page.summary}</p>
          {meta}
          <div className="mt-8 border-t border-line pt-8">
            <page.Body />
          </div>

          <div className="mt-14 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
            {prev ? (
              <Link to={`${base}/${prev.slug}`} className="card card-hover p-4">
                <div className="flex items-center gap-1.5 text-xs text-faint"><ArrowLeft size={13} /> Previous</div>
                <div className="mt-1 font-semibold">{prev.title}</div>
              </Link>
            ) : <span className="hidden sm:block" />}
            {next && (
              <Link to={`${base}/${next.slug}`} className="card card-hover p-4 sm:text-right">
                <div className="flex items-center gap-1.5 text-xs text-faint sm:justify-end">Next <ArrowRight size={13} /></div>
                <div className="mt-1 font-semibold">{next.title}</div>
              </Link>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
