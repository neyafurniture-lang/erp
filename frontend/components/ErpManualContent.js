'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';

export default function ErpManualContent() {
  const [manual, setManual] = useState(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    api('/manual')
      .then(setManual)
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!manual?.sections?.length) return;
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (hash) {
      setActiveId(hash);
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [manual]);

  useEffect(() => {
    if (!manual?.sections?.length) return;
    const ids = manual.sections.map(s => s.id);
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] }
    );
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [manual]);

  if (error) {
    return (
      <div className="card p-6 text-neya-error">
        Impossible de charger le manuel : {error}
      </div>
    );
  }

  if (!manual) {
    return (
      <div className="card p-8 text-center text-neya-muted">
        Chargement du manuel…
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
      <aside className="lg:w-56 shrink-0">
        <div className="lg:sticky lg:top-4 card p-4">
          <p className="section-title mb-3">Sommaire</p>
          <nav className="space-y-1 max-h-[70vh] overflow-y-auto">
            {manual.sections.map(s => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActiveId(s.id)}
                className={`block text-sm py-1.5 px-2 rounded transition-colors ${
                  activeId === s.id
                    ? 'bg-neya-orange/10 text-neya-orange font-medium'
                    : 'text-neya-muted hover:text-neya-ink hover:bg-neya-surface'
                }`}
              >
                <span className="mr-1.5" aria-hidden>{s.icon}</span>
                {s.title}
              </a>
            ))}
          </nav>
          <p className="text-[10px] text-neya-muted mt-4 pt-3 border-t border-neya-border">
            v{manual.version} · Dites « manuel » à l&apos;assistant
          </p>
        </div>
      </aside>

      <div className="flex-1 min-w-0 space-y-6">
        <header className="card p-6 bg-gradient-to-br from-neya-orange/5 to-transparent border-neya-orange/20">
          <h2 className="text-xl font-semibold text-neya-ink mb-2">{manual.title}</h2>
          <p className="text-neya-muted text-sm leading-relaxed">
            Guide complet pour faire fonctionner NEYA ERP : navigation, subtilités, dépannage et liens directs vers chaque module.
            L&apos;assistant vocal connaît ce manuel — posez vos questions ou ouvrez une section ci-dessous.
          </p>
        </header>

        {manual.sections.map(section => (
          <section
            key={section.id}
            id={section.id}
            className="card p-6 scroll-mt-24"
          >
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl" aria-hidden>{section.icon}</span>
              <div>
                <h3 className="text-lg font-semibold text-neya-ink">{section.title}</h3>
                <p className="text-sm text-neya-muted mt-0.5">{section.summary}</p>
              </div>
            </div>

            {section.links?.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {section.links.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-full border border-neya-border bg-neya-surface hover:border-neya-orange hover:text-neya-orange transition-colors"
                  >
                    {link.label} →
                  </Link>
                ))}
              </div>
            )}

            <ul className="space-y-3">
              {section.tips.map((tip, i) => (
                <li key={i} className="flex gap-3 text-sm text-neya-ink leading-relaxed">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-neya-orange/10 text-neya-orange text-xs font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
