'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AppShell from '../../../components/AppShell';
import AuthGuard from '../../../components/AuthGuard';
import ProjectWorkspace from '../../../components/ProjectWorkspace';
import { api } from '../../../lib/api';
import { useRegisterChatContext } from '../../../lib/chat-context';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [costs, setCosts] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [quoteSource, setQuoteSource] = useState(null);
  const [purchases, setPurchases] = useState([]);

  const load = async () => {
    setLoadError('');
    try {
      const [p, c, m, needs, orders] = await Promise.all([
        api(`/projects/${id}`),
        api(`/analytics/projects/${id}/costs`).catch(() => null),
        api(`/analytics/projects/${id}/materials`).catch(() => ({ materials: [], quote: null })),
        api(`/purchases/needs?project_id=${id}`).catch(() => []),
        api(`/purchases?project_id=${id}`).catch(() => []),
      ]);
      setProject(p);
      setCosts(c);
      setMaterials(Array.isArray(m) ? m : (m.materials || []));
      setQuoteSource(Array.isArray(m) ? null : (m.quote || null));
      const needRows = Array.isArray(needs) ? needs : [];
      const orderRows = Array.isArray(orders) ? orders : [];
      // Besoins atelier d’abord ; commandes en secours si pas de besoin lié
      setPurchases([
        ...needRows.map(n => ({
          id: `need-${n.id}`,
          kind: 'need',
          title: n.title,
          status: n.status,
          quantity: n.quantity,
          unit: n.unit,
          category: n.category,
          priority: n.priority,
        })),
        ...orderRows.map(o => ({
          id: `po-${o.id}`,
          kind: 'order',
          title: o.title || `Commande #${o.id}`,
          status: o.status,
        })),
      ]);
    } catch (err) {
      setProject(null);
      setLoadError(err.message || 'Chargement impossible');
    }
  };

  useEffect(() => { load(); }, [id]);

  useRegisterChatContext(project ? {
    type: 'project',
    id: project.id,
    label: project.name,
    meta: { client_name: project.client_name, costs },
  } : null);

  if (loadError) {
    return (
      <AuthGuard>
        <AppShell title="Projet">
          <div className="py-12 space-y-3">
            <p className="text-neya-error text-sm">{loadError}</p>
            <button type="button" className="btn-secondary text-xs" onClick={() => load()}>Réessayer</button>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  if (!project) {
    return <AuthGuard><AppShell title="Projet"><div className="text-neya-muted py-12">Chargement…</div></AppShell></AuthGuard>;
  }

  return (
    <AuthGuard>
      <AppShell title={project.name} subtitle={project.client_name || 'Workspace projet'}>
        <Suspense fallback={<div className="text-neya-muted py-8">Chargement…</div>}>
          <ProjectWorkspace
            project={project}
            costs={costs}
            materials={materials}
            quoteSource={quoteSource}
            purchases={purchases}
            onReload={load}
          />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}
