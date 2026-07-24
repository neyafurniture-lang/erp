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
  const [costs, setCosts] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [quoteSource, setQuoteSource] = useState(null);
  const [purchases, setPurchases] = useState([]);

  const load = async (maybeProject) => {
    // Mise à jour locale après PATCH heures (évite un GET qui peut renvoyer un meta stale)
    if (maybeProject && typeof maybeProject === 'object' && maybeProject.id != null) {
      setProject(maybeProject);
      return;
    }
    const [p, c, m, pur] = await Promise.all([
      api(`/projects/${id}`),
      api(`/analytics/projects/${id}/costs`).catch(() => null),
      api(`/analytics/projects/${id}/materials`).catch(() => ({ materials: [], quote: null })),
      api(`/purchases?project_id=${id}`).catch(() => []),
    ]);
    setProject(p);
    setCosts(c);
    setMaterials(Array.isArray(m) ? m : (m.materials || []));
    setQuoteSource(Array.isArray(m) ? null : (m.quote || null));
    setPurchases(pur);
  };

  useEffect(() => { load(); }, [id]);

  useRegisterChatContext(project ? {
    type: 'project',
    id: project.id,
    label: project.name,
    meta: { client_name: project.client_name, costs },
  } : null);

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
